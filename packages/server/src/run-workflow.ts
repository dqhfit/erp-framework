/* ==========================================================
   run-workflow.ts — Thực thi workflow phía server.
   Nạp graph từ DB → chạy runWorkflow (lõi @erp-framework/core)
   → ghi kết quả vào bảng workflow_runs.

   callTool gọi MCP thật (mcp-client), callAgent gọi LLM thật
   (llm-client) — đều đọc cấu hình từ DB. Có thể tiêm callback
   riêng qua ExecuteOptions để test/ghi đè.
   ========================================================== */

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
