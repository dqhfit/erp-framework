/* ==========================================================
   run-workflow.ts — Thực thi workflow phía server.
   Nạp graph từ DB → chạy runWorkflow (lõi @erp-framework/core)
   → ghi kết quả vào bảng workflow_runs.

   callTool gọi MCP thật (mcp-client), callAgent gọi LLM thật
   (llm-client) — đều đọc cấu hình từ DB. Có thể tiêm callback
   riêng qua ExecuteOptions để test/ghi đè.
   ========================================================== */

import { lookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import { isIP } from "node:net";
import {
  pluginRegistry,
  type Role,
  type RunWorkflowOptions,
  roleCan,
  runWorkflow,
  type WfEdge,
  type WfNode,
} from "@erp-framework/core";
import { workflowRuns, workflows } from "@erp-framework/db";
import { and, desc, eq } from "drizzle-orm";
import { logActivity } from "./activity";
import { assertWithinBudget } from "./budget";
import { makeRunCode } from "./code-runner";
import type { DB } from "./db";
import { knowledgeSearch } from "./knowledge-search";
import { makeCallAgent } from "./llm-client";
import { makeCallTool } from "./mcp-client";
import { makeInvokeProcedure } from "./procedure-runner";

/** Shape graph do WorkflowDesigner lưu (node kiểu ReactFlow). */
interface RawGraph {
  nodes?: Array<{
    id: string;
    type?: string;
    data?: { kind?: string; label?: string; config?: Record<string, unknown> };
  }>;
  edges?: Array<{
    source: string;
    target: string;
    label?: unknown;
    sourceHandle?: unknown;
    targetHandle?: unknown;
  }>;
}

export interface ExecuteOptions {
  callTool?: RunWorkflowOptions["callTool"];
  callAgent?: RunWorkflowOptions["callAgent"];
  context?: Record<string, unknown>;
  scheduleId?: string;
  /** Nếu có: từ chối chạy nếu workflow không thuộc công ty này (đa công ty). */
  companyId?: string;
  /** Role của user trigger workflow. Nếu có node config requiresRole
   *  cao hơn → fail-closed trước khi chạy (P3.3). Caller scheduler không
   *  truyền → bỏ qua check (auto-run = system, trusted). */
  actorRole?: Role;
  /** Độ sâu lồng workflow (node subworkflow/foreach gọi executeWorkflow).
   *  Guard chống đệ quy vô hạn — vượt MAX_WF_DEPTH thì ném lỗi. */
  _depth?: number;
}

/** Giới hạn lồng sub-workflow (giống MAX_DEPTH của procedure-runner). */
const MAX_WF_DEPTH = 5;

/** IPv4 nội bộ/đặc biệt: loopback, RFC1918, link-local, CGNAT, "this host". */
function isPrivateIpv4(ip: string): boolean {
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return true; // dạng lạ → chặn
  const [a, b] = p as [number, number, number, number];
  if (a === 10 || a === 127 || a === 0) return true; // 10/8, 127/8, 0/8
  if (a === 169 && b === 254) return true; // 169.254/16 link-local (cloud metadata)
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12
  if (a === 192 && b === 168) return true; // 192.168/16
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64/10 CGNAT
  return false;
}

/** IP (v4/v6) thuộc dải nội bộ/loopback/link-local → chặn SSRF. */
function isPrivateIp(addr: string, family: number): boolean {
  if (family === 4) return isPrivateIpv4(addr);
  const a = addr.toLowerCase();
  if (a === "::1" || a === "::") return true; // loopback / unspecified
  if (a.startsWith("fe80") || a.startsWith("fc") || a.startsWith("fd")) return true; // link-local / ULA
  const mapped = a.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/); // IPv4-mapped
  if (mapped?.[1]) return isPrivateIpv4(mapped[1]);
  return false;
}

/** Resolve + validate URL công khai (1 LẦN). Trả URL parsed + danh sách IP
 *  đã validate (không nội bộ). Throw nếu scheme/allowlist/SSRF vi phạm.
 *  Caller dùng IP trả về để GHIM kết nối (chống DNS-rebinding TOCTOU). */
async function resolvePublic(
  rawUrl: string,
): Promise<{ u: URL; addrs: Array<{ address: string; family: number }> }> {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    throw new Error("URL không hợp lệ");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new Error(`Scheme bị chặn (chỉ http/https): ${u.protocol}`);
  }
  const allow = (process.env.HTTP_NODE_ALLOWED_HOSTS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (allow.length && !allow.includes(u.hostname)) {
    throw new Error(`Host không nằm trong allowlist: ${u.hostname}`);
  }
  const literal = isIP(u.hostname);
  if (literal) {
    if (isPrivateIp(u.hostname, literal)) throw new Error(`Chặn IP nội bộ (SSRF): ${u.hostname}`);
    return { u, addrs: [{ address: u.hostname, family: literal }] };
  }
  const addrs = await lookup(u.hostname, { all: true });
  for (const a of addrs) {
    if (isPrivateIp(a.address, a.family)) {
      throw new Error(`Host phân giải tới IP nội bộ (SSRF): ${u.hostname} → ${a.address}`);
    }
  }
  if (!addrs.length) throw new Error(`Không phân giải được host: ${u.hostname}`);
  return { u, addrs };
}

/** Chặn SSRF: chỉ http/https, host không phân giải tới IP nội bộ. Có thể siết
 *  thêm bằng allowlist host (env HTTP_NODE_ALLOWED_HOSTS, phân tách dấu phẩy).
 *  Export để test regression. */
export async function assertPublicUrl(rawUrl: string): Promise<void> {
  await resolvePublic(rawUrl);
}

/** Gửi 1 request GHIM tới IP đã validate (pin) — fetch/agent KHÔNG tự phân
 *  giải lại nên đóng được khe DNS-rebinding giữa validate và connect. Vẫn
 *  giữ Host header + SNI theo hostname gốc nên HTTPS/cert vẫn đúng. */
function pinnedRequest(
  u: URL,
  pin: { address: string; family: number },
  method: string,
  headers: Record<string, string>,
  bodyStr: string | undefined,
  timeoutMs: number,
): Promise<{ status: number; location: string | null; text: string }> {
  return new Promise((resolve, reject) => {
    const isHttps = u.protocol === "https:";
    const mod = isHttps ? https : http;
    const reqq = mod.request(
      {
        protocol: u.protocol,
        hostname: u.hostname,
        servername: isHttps ? u.hostname : undefined, // SNI theo hostname gốc
        port: u.port || (isHttps ? 443 : 80),
        method,
        path: u.pathname + u.search,
        headers,
        // PIN: chỉ nối tới IP đã validate — chặn rebinding sau khi validate.
        lookup: (_host, _opts, cb) => cb(null, pin.address, pin.family),
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c as Buffer));
        res.on("end", () =>
          resolve({
            status: res.statusCode ?? 0,
            location: typeof res.headers.location === "string" ? res.headers.location : null,
            text: Buffer.concat(chunks).toString("utf8"),
          }),
        );
      },
    );
    reqq.setTimeout(timeoutMs, () => reqq.destroy(new Error(`HTTP timeout sau ${timeoutMs}ms`)));
    reqq.on("error", reject);
    if (bodyStr != null) reqq.write(bodyStr);
    reqq.end();
  });
}

/** Gọi HTTP cho node "http" — node:http/https request GHIM IP (chống SSRF
 *  DNS-rebinding) + timeout. Body object → JSON; response JSON parse được →
 *  object, không thì giữ text. Redirect thủ công ≤3 hop, resolve+validate+pin
 *  lại mỗi hop (chống bypass qua Location). */
async function defaultRunHttp(req: {
  url: string;
  method: string;
  headers: Record<string, unknown>;
  body?: unknown;
}): Promise<{ status: number; body: unknown }> {
  const timeoutMs = Number(process.env.HTTP_NODE_TIMEOUT_MS ?? 15_000);
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(req.headers ?? {})) headers[k] = String(v);
  let bodyStr: string | undefined;
  if (req.method !== "GET" && req.method !== "HEAD" && req.body != null) {
    bodyStr = typeof req.body === "string" ? req.body : JSON.stringify(req.body);
    if (!Object.keys(headers).some((h) => h.toLowerCase() === "content-type")) {
      headers["content-type"] = "application/json";
    }
  }
  let url = req.url;
  // Theo redirect thủ công, GHIM IP mỗi hop (resolve+validate 1 lần/hop rồi
  // nối tới đúng IP đó) — đóng khe DNS-rebinding kể cả sau Location.
  for (let hop = 0; hop <= 3; hop++) {
    const { u, addrs } = await resolvePublic(url);
    const pin = addrs[0];
    if (!pin) throw new Error(`Không phân giải được host: ${u.hostname}`);
    const res = await pinnedRequest(u, pin, req.method, headers, bodyStr, timeoutMs);
    const loc = res.status >= 300 && res.status < 400 ? res.location : null;
    if (!loc) {
      let body: unknown = res.text;
      try {
        body = JSON.parse(res.text);
      } catch {
        // giữ nguyên text nếu không phải JSON
      }
      return { status: res.status, body };
    }
    url = new URL(loc, url).toString();
  }
  throw new Error("HTTP quá nhiều redirect (>3)");
}

/** Kiểm tra mọi node có config.requiresRole đều ≤ actorRole. Ném Error
 *  nếu có node cần quyền cao hơn — fail-closed thay vì skip để tránh
 *  workflow chạy nửa vời với edge bị đứt. */
function assertNodeRoleRequirements(nodes: WfNode[], actorRole: Role): void {
  for (const n of nodes) {
    const cfg = (n.config ?? {}) as { requiresRole?: Role };
    const need = cfg.requiresRole;
    if (!need) continue;
    // requiresRole là action "edit" trên ObjectType giả "workflow" —
    // nếu role không edit được workflow thì cũng không trigger được node
    // có gate. Simple level check: admin > editor > viewer.
    const rank: Record<Role, number> = { viewer: 0, editor: 1, admin: 2 };
    if (rank[actorRole] < rank[need]) {
      throw new Error(
        `Workflow bị chặn — node "${n.label}" (${n.type}) yêu cầu role "${need}" ` +
          `nhưng user hiện tại là "${actorRole}". Nâng quyền hoặc bỏ requiresRole của node.`,
      );
    }
  }
}
// roleCan unused for now — giữ import nếu cần check phức tạp hơn sau này.
void roleCan;

/** Chạy một workflow theo id, ghi 1 bản ghi workflow_runs. */
export async function executeWorkflow(
  db: DB,
  workflowId: string,
  opts: ExecuteOptions = {},
): Promise<{ runId: string; status: "completed" | "paused" | "error"; stepCount: number }> {
  const depth = opts._depth ?? 0;
  if (depth > MAX_WF_DEPTH) {
    throw new Error(
      `Sub-workflow lồng quá sâu (>${MAX_WF_DEPTH}) — có thể vòng đệ quy ` +
        "(workflow tự gọi chính nó hoặc A→B→A). Cắt vòng lặp trong thiết kế.",
    );
  }
  const [wf] = await db.select().from(workflows).where(eq(workflows.id, workflowId));
  if (!wf) throw new Error(`Workflow không tồn tại: ${workflowId}`);
  // Đa công ty: workflow phải thuộc đúng công ty của người gọi.
  if (opts.companyId && wf.companyId !== opts.companyId) {
    throw new Error(`Workflow không tồn tại: ${workflowId}`);
  }
  // Chặn cứng theo ngân sách — vượt hạn mức tháng của công ty thì không chạy.
  await assertWithinBudget(db, wf.companyId);

  // Runner chạy bản ĐÃ PUBLISH; chưa publish thì tạm dùng bản nháp.
  const graph = (wf.publishedGraph ?? wf.graph ?? {}) as RawGraph;
  const nodes: WfNode[] = (graph.nodes ?? []).map((n) => ({
    id: n.id,
    type: n.data?.kind ?? n.type ?? "action",
    label: n.data?.label ?? n.id,
    config: n.data?.config,
  }));
  const edges: WfEdge[] = (graph.edges ?? []).map((e) => ({
    source: e.source,
    target: e.target,
    label: typeof e.label === "string" ? e.label : undefined,
    // Giữ handle để runner phân biệt data-edge (cổng) vs control-flow.
    sourceHandle: typeof e.sourceHandle === "string" ? e.sourceHandle : undefined,
    targetHandle: typeof e.targetHandle === "string" ? e.targetHandle : undefined,
  }));

  // P3.3 — field-level RBAC trên workflow step. Fail-closed nếu có
  // node yêu cầu role cao hơn user trigger.
  if (opts.actorRole) {
    assertNodeRoleRequirements(nodes, opts.actorRole);
  }

  // Bản ghi run — trạng thái "running"
  const [run] = await db
    .insert(workflowRuns)
    .values({
      companyId: wf.companyId,
      workflowId,
      scheduleId: opts.scheduleId ?? null,
      status: "running",
      vars: opts.context ?? {},
    })
    .returning();
  if (!run) throw new Error("Không tạo được bản ghi workflow_run");

  // Chạy lõi runtime — truyền registry để runner thực thi được
  // node do plugin định nghĩa (xem nhánh default trong runWorkflow).
  const callTool = opts.callTool ?? makeCallTool(db, wf.companyId);
  /* Timeout cứng: bảo vệ pg-boss pool (5 worker) khỏi loop vô hạn
     trong subworkflow recursive hoặc agent gọi LLM hang.
     Default 5 phút; override qua env WORKFLOW_TIMEOUT_MS. */
  const timeoutMs = Number(process.env.WORKFLOW_TIMEOUT_MS ?? 300_000);
  let timeoutHandle: NodeJS.Timeout | undefined;
  try {
    const result = await Promise.race([
      runWorkflow({
        workflowId,
        workflowName: wf.name,
        nodes,
        edges,
        callTool,
        callAgent: opts.callAgent ?? makeCallAgent(db),
        initialVars: opts.context,
        registry: pluginRegistry,
        runCode: makeRunCode({ callTool, companyId: wf.companyId }),
        invokeProcedure: makeInvokeProcedure({
          db,
          companyId: wf.companyId,
          callTool,
          actorUserId: null,
        }),
        // Node subworkflow/foreach: chạy workflow con qua chính executeWorkflow
        // (tăng _depth để guard đệ quy). Mỗi sub-run vẫn ghi workflow_runs riêng
        // → giữ observability + scope companyId. Đọc lại vars đã ghi để trả về.
        runSubWorkflow: async (subId, initialVars) => {
          const r = await executeWorkflow(db, subId, {
            companyId: wf.companyId,
            context: initialVars,
            // Truyền actorRole xuống workflow con để gate requiresRole áp cả
            // node trong sub-workflow (nếu không, viewer trigger cha → bypass
            // gate của node con). undefined (scheduler/system) → bỏ qua như cũ.
            actorRole: opts.actorRole,
            _depth: depth + 1,
          });
          const [subRun] = await db.select().from(workflowRuns).where(eq(workflowRuns.id, r.runId));
          return {
            status: r.status,
            vars: (subRun?.vars ?? {}) as Record<string, unknown>,
          };
        },
        runHttp: defaultRunHttp,
        // Ngân sách giữa chừng: chặn trước mỗi node agent/llm/agent_chain để
        // workflow phẳng nhiều node LLM không vượt xa hạn mức trong 1 run.
        assertBudget: () => assertWithinBudget(db, wf.companyId),
        // Node "knowledge": tra Knowledge Base công ty (hybrid vector+FTS).
        searchKnowledge: async (query, kopt) => {
          const sk =
            kopt.sourceKind === "file" || kopt.sourceKind === "entity" || kopt.sourceKind === "text"
              ? kopt.sourceKind
              : undefined;
          const hits = await knowledgeSearch(db, wf.companyId, query, {
            limit: kopt.limit,
            sourceKind: sk,
          });
          return hits.map((h) => ({
            content: h.content,
            sourceTitle: h.sourceTitle,
            score: h.score,
          }));
        },
      }),
      new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(
          () =>
            reject(
              new Error(
                `Workflow "${wf.name}" timeout sau ${timeoutMs}ms — ` +
                  "có thể loop vô hạn hoặc agent LLM hang. " +
                  "Tăng WORKFLOW_TIMEOUT_MS nếu cần workflow lâu.",
              ),
            ),
          timeoutMs,
        );
      }),
    ]).finally(() => {
      if (timeoutHandle) clearTimeout(timeoutHandle);
    });

    // Ghi kết quả cuối
    await db
      .update(workflowRuns)
      .set({
        status: result.status,
        steps: result.steps,
        vars: result.vars,
        finishedAt: new Date(),
      })
      .where(eq(workflowRuns.id, run.id));

    // Ghi nhật ký hành động (gộp token của các bước agent).
    const tIn = result.steps.reduce((n, s) => n + (s.tokens?.input_tokens ?? 0), 0);
    const tOut = result.steps.reduce((n, s) => n + (s.tokens?.output_tokens ?? 0), 0);
    await logActivity(db, {
      companyId: wf.companyId,
      kind: "run_workflow",
      objectType: "workflow",
      target: wf.name,
      detail: `Chạy workflow — ${result.status} (${result.steps.length} bước)`,
      tokensInput: tIn || undefined,
      tokensOutput: tOut || undefined,
      model: result.steps.find((s) => s.model)?.model,
    });

    return { runId: run.id, status: result.status, stepCount: result.steps.length };
  } catch (e) {
    // #1: đừng để run kẹt "running" khi throw (timeout WORKFLOW_TIMEOUT_MS,
    // runWorkflow lỗi, budget/SSRF giữa chừng…). Ghi error + finishedAt rồi
    // re-throw. Nuốt lỗi của chính lệnh update để không che lỗi gốc.
    await db
      .update(workflowRuns)
      .set({ status: "error", finishedAt: new Date(), vars: { _error: (e as Error).message } })
      .where(eq(workflowRuns.id, run.id))
      .catch(() => {});
    throw e;
  }
}

/** Lịch sử các lần chạy gần đây của một workflow (trong phạm vi công ty). */
export function recentRuns(db: DB, workflowId: string, companyId: string, limit = 20) {
  return db
    .select()
    .from(workflowRuns)
    .where(and(eq(workflowRuns.workflowId, workflowId), eq(workflowRuns.companyId, companyId)))
    .orderBy(desc(workflowRuns.startedAt))
    .limit(limit);
}
