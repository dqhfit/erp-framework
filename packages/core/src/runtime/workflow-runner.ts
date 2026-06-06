/* ==========================================================
   workflow-runner.ts — Chạy workflow THẬT (khác Test Run mô phỏng).
   - Action   → gọi tool thật (callback)
   - Condition→ eval formula expr, rẽ nhánh theo nhãn edge
   - Agent    → gọi LLM (callback)
   - Delay    → chờ thật (cap an toàn)
   - Approval → tạm dừng nhánh, trả status "paused"

   Phiên bản @erp-framework/core: THUẦN — không phụ thuộc store/UI.
   Mỗi bước báo qua onStep; caller (server/app) tự ghi log từ
   RunResult.steps (token usage của agent nằm ở step.tokens/model).
   ========================================================== */
import { evaluate } from "../formula/index";
import type { PluginRegistry } from "../plugin/registry";

export interface WfNode {
  id: string;
  type: string; // trigger|action|condition|agent|approval|delay
  label: string;
  config?: Record<string, unknown>;
}
export interface WfEdge {
  source: string;
  target: string;
  label?: string; // "true"/"false"/"yes"/"no"/...
  /** Handle nguồn/đích. Data-edge: sourceHandle="out:<portId>",
   *  targetHandle="in:<portId>". Control-edge: rỗng / "yes" / "no". */
  sourceHandle?: string;
  targetHandle?: string;
}

/** Cổng dữ liệu của node.
 *  - Input: `value` (giá trị tĩnh khi không nối edge).
 *  - Output: `formula` (biểu thức tính giá trị cổng — tham chiếu cổng input
 *    bằng `{inPortId}` và vars; ƯU TIÊN nếu có) HOẶC `path` (dot-path bóc
 *    field từ raw output của node). */
export interface WfPort {
  id: string;
  label?: string;
  path?: string;
  value?: unknown;
  formula?: string;
}

export interface RunStep {
  nodeId: string;
  kind: string;
  label: string;
  status: "ok" | "error" | "skipped" | "paused";
  detail: string;
  output?: unknown;
  durationMs: number;
  /** Token usage nếu là node agent — caller dùng để tính cost. */
  tokens?: { input_tokens: number; output_tokens: number };
  model?: string;
}

export interface RunResult {
  status: "completed" | "paused" | "error";
  steps: RunStep[];
  vars: Record<string, unknown>;
}

export interface RunWorkflowOptions {
  workflowId: string;
  workflowName: string;
  nodes: WfNode[];
  edges: WfEdge[];
  /** Gọi tool thật (MCP…) */
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  /** Gọi LLM cho node agent — trả text + usage */
  callAgent?: (
    nodeConfig: Record<string, unknown>,
    vars: Record<string, unknown>,
  ) => Promise<{
    text: string;
    model: string;
    usage: { input_tokens: number; output_tokens: number };
  }>;
  /** Biến khởi tạo (vd trigger payload) */
  initialVars?: Record<string, unknown>;
  /** Callback mỗi bước — cho UI/log cập nhật realtime */
  onStep?: (step: RunStep) => void;
  /** Cap số bước để chống loop */
  maxSteps?: number;
  /** Cap thời gian delay thật (ms) */
  maxDelayMs?: number;
  /** Registry plugin — để chạy node type tuỳ biến. */
  registry?: PluginRegistry;
  /**
   * Chạy code-node trong sandbox (server thường dùng isolated-vm).
   * Core không kèm sandbox để giữ platform-agnostic; nếu không truyền,
   * node type "code" sẽ trả lỗi.
   */
  runCode?: (
    code: string,
    ctx: { vars: Record<string, unknown>; nodeId: string },
  ) => Promise<{
    output?: Record<string, unknown>;
    logs: string[];
    durationMs: number;
  }>;
  /**
   * Gọi native procedure theo tên (xem procedure-runner ở server).
   * Tương tự runCode, core chỉ định nghĩa contract.
   */
  invokeProcedure?: (
    name: string,
    args: Record<string, unknown>,
  ) => Promise<{ output: unknown; logs: string[]; durationMs: number }>;
  /**
   * Chạy một workflow CON theo id (node subworkflow/foreach). Server thường
   * cài bằng cách gọi lại executeWorkflow (có depth-guard chống lồng vô hạn).
   * Core chỉ định nghĩa contract; thiếu callback → node trả lỗi.
   */
  runSubWorkflow?: (
    workflowId: string,
    initialVars: Record<string, unknown>,
  ) => Promise<{ status: string; vars: Record<string, unknown> }>;
  /**
   * Gọi HTTP request cho node "http". Server cài bằng fetch (có timeout/guard);
   * core chỉ định nghĩa contract — thiếu callback → node trả lỗi.
   */
  runHttp?: (req: {
    url: string;
    method: string;
    headers: Record<string, unknown>;
    body?: unknown;
  }) => Promise<{ status: number; body: unknown; headers?: Record<string, unknown> }>;
  /**
   * Tra cứu Knowledge Base (RAG) cho node "knowledge". Server cài bằng
   * knowledgeSearch (hybrid vector + FTS); core chỉ định nghĩa contract —
   * thiếu callback → node trả skipped.
   */
  searchKnowledge?: (
    query: string,
    opts: { limit?: number; sourceKind?: string },
  ) => Promise<Array<{ content: string; sourceTitle: string; score: number }>>;
  /**
   * Kiểm tra ngân sách TRƯỚC mỗi node tốn LLM (agent/llm/agent_chain). Throw
   * → dừng hẳn workflow (không vào nhánh "error"). Server cài bằng
   * assertWithinBudget; thiếu callback → bỏ qua (không chặn giữa chừng).
   */
  assertBudget?: () => Promise<void>;
  /**
   * Tiếp tục một run đã tạm dừng (vd approval): các step đã chạy (ok/skipped)
   * được seed là "đã xong" — KHÔNG chạy lại (chống side-effect trùng như gửi
   * mail/tạo record); node "paused" được đưa lại vào hàng đợi để chạy tiếp với
   * quyết định mới truyền qua initialVars (vd approval_<id>="approved").
   */
  checkpoint?: { steps: RunStep[] };
}

/** Cap số phần tử lặp của node foreach — chống mảng khổng lồ treo runner. */
const MAX_FOREACH = 1000;

/** Số sub-workflow foreach chạy SONG SONG (bounded) — cân bằng tốc độ vs tải
   DB/LLM, tránh chạm WORKFLOW_TIMEOUT khi mảng lớn. Kết quả giữ đúng thứ tự. */
const FOREACH_CONCURRENCY = 5;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Đọc cấu hình độ tin cậy per-node: retry/backoff + timeout.
 *  config.retry = { max, backoffMs }; config.timeoutMs = số ms. */
function readReliability(cfg: Record<string, unknown>): {
  retryMax: number;
  backoffMs: number;
  timeoutMs: number;
} {
  const r =
    cfg.retry && typeof cfg.retry === "object" ? (cfg.retry as Record<string, unknown>) : {};
  return {
    retryMax: Math.max(0, Math.floor(Number(r.max ?? 0)) || 0),
    backoffMs: Math.max(0, Number(r.backoffMs ?? 0) || 0),
    timeoutMs: Math.max(0, Number(cfg.timeoutMs ?? 0) || 0),
  };
}

/** Lấy args literal từ config (config.args là object). */
function resolveArgs(config: Record<string, unknown>): Record<string, unknown> {
  const a = config.args;
  return a && typeof a === "object" && !Array.isArray(a) ? (a as Record<string, unknown>) : {};
}

/** Bóc giá trị theo đường dẫn dot ("a.b.c"). Rỗng = trả nguyên object. */
function resolvePath(obj: unknown, path?: string): unknown {
  if (!path) return obj;
  let cur: unknown = obj;
  for (const part of path.split(".")) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

/** Edge mang DỮ LIỆU (nối cổng) thay vì control-flow. */
function isDataEdge(e: WfEdge): boolean {
  return (
    (e.sourceHandle?.startsWith("out:") ?? false) || (e.targetHandle?.startsWith("in:") ?? false)
  );
}

/** Mọi node cấp data-edge cho `nodeId` đã chạy chưa (có trong nodeOutputs)?
 *  Dùng để ưu tiên node đủ nguồn dữ liệu — node nguồn chạy TRƯỚC node đích. */
function dataDepsMet(nodeId: string, edges: WfEdge[], nodeOutputs: Map<string, unknown>): boolean {
  for (const e of edges) {
    if (e.target !== nodeId || e.source === nodeId) continue;
    if (!isDataEdge(e)) continue;
    if (!nodeOutputs.has(e.source)) return false;
  }
  return true;
}

/** Đọc mảng cổng từ config (inputs/outputs). */
function portsOf(node: WfNode | undefined, key: "inputs" | "outputs"): WfPort[] {
  const v = node?.config?.[key];
  return Array.isArray(v) ? (v as WfPort[]) : [];
}

/** Gom giá trị input của node. Thứ tự ưu tiên (cao → thấp):
 *  data-edge (nối cổng node trước) > formula cổng (eval theo vars — dùng cho
 *  tham chiếu biến/entity field) > value tĩnh. */
function resolveNodeInputs(
  node: WfNode,
  edges: WfEdge[],
  byId: Map<string, WfNode>,
  nodeOutputs: Map<string, unknown>,
  portValues: Map<string, unknown>,
  vars: Record<string, unknown>,
): Record<string, unknown> {
  const inputs: Record<string, unknown> = {};
  for (const p of portsOf(node, "inputs")) {
    if (typeof p.formula === "string" && p.formula.trim()) {
      // Cổng nguồn "công thức/biến": eval theo vars (vd {entity.data.total}).
      inputs[p.id] = evaluate(p.formula, { ...vars }).value;
    } else if (p.value !== undefined) {
      inputs[p.id] = p.value;
    }
  }
  for (const e of edges) {
    if (e.target !== node.id) continue;
    if (!e.targetHandle?.startsWith("in:") || !e.sourceHandle?.startsWith("out:")) continue;
    const inPortId = e.targetHandle.slice(3);
    const outPortId = e.sourceHandle.slice(4);
    // Giá trị cổng output đã được tính khi node nguồn chạy (formula/path).
    const key = `${e.source}:${outPortId}`;
    if (portValues.has(key)) {
      inputs[inPortId] = portValues.get(key);
    } else {
      // Fallback (node nguồn chưa chạy / cổng không khai báo) → bóc path thô.
      const outPort = portsOf(byId.get(e.source), "outputs").find((o) => o.id === outPortId);
      inputs[inPortId] = resolvePath(nodeOutputs.get(e.source), outPort?.path);
    }
  }
  return inputs;
}

export async function runWorkflow(opt: RunWorkflowOptions): Promise<RunResult> {
  const maxSteps = opt.maxSteps ?? 50;
  const maxDelayMs = opt.maxDelayMs ?? 3000;
  const byId = new Map(opt.nodes.map((n) => [n.id, n]));
  const steps: RunStep[] = [];
  const vars: Record<string, unknown> = { ...(opt.initialVars ?? {}) };
  // Raw output mỗi node — nguồn cho data-edge (cổng I/O giữa các node).
  const nodeOutputs = new Map<string, unknown>();
  // Giá trị từng cổng output đã tính (key "<nodeId>:<portId>"). Cổng có
  // formula → eval; còn lại → bóc path từ raw output.
  const portValues = new Map<string, unknown>();

  const triggers = opt.nodes.filter((n) => n.type === "trigger");
  if (!opt.nodes.length) {
    return { status: "error", steps: [], vars };
  }
  if (!triggers.length) {
    const s: RunStep = {
      nodeId: "",
      kind: "error",
      label: "—",
      status: "error",
      detail: "Workflow không có node Trigger.",
      durationMs: 0,
    };
    return { status: "error", steps: [s], vars };
  }

  const visited = new Set<string>();
  const queue: string[] = triggers.map((t) => t.id);
  let overallStatus: RunResult["status"] = "completed";

  // Resume từ checkpoint: seed node đã chạy (ok/skipped) làm "đã xong" + dựng
  // lại nodeOutputs/portValues cho data-edge; hàng đợi = node "paused" (chạy
  // lại với quyết định mới). Descendant sẽ tự nối vào queue khi paused chạy.
  if (opt.checkpoint) {
    for (const s of opt.checkpoint.steps) {
      if (s.status !== "ok" && s.status !== "skipped") continue;
      visited.add(s.nodeId);
      nodeOutputs.set(s.nodeId, s.output);
      for (const p of portsOf(byId.get(s.nodeId), "outputs")) {
        const v =
          typeof p.formula === "string" && p.formula.trim()
            ? evaluate(p.formula, { ...vars }).value
            : resolvePath(s.output, p.path);
        portValues.set(`${s.nodeId}:${p.id}`, v);
      }
    }
    queue.length = 0;
    for (const s of opt.checkpoint.steps) {
      if (s.status === "paused" && !visited.has(s.nodeId)) queue.push(s.nodeId);
    }
  }

  while (queue.length && steps.length < maxSteps) {
    // Topo theo data-dependency: ưu tiên node CHƯA chạy đã đủ nguồn dữ
    // liệu (mọi node cấp data-edge đã chạy) → nguồn luôn chạy trước đích,
    // kể cả khi 2 nhánh song song. Không node nào đủ → lấy node đầu hàng
    // để tránh deadlock (nguồn không reachable / nối vòng → input thiếu =
    // undefined, giữ tiến độ).
    let pick = queue.findIndex(
      (nid) => !visited.has(nid) && dataDepsMet(nid, opt.edges, nodeOutputs),
    );
    if (pick === -1) pick = 0;
    const id = queue.splice(pick, 1)[0]!;
    if (visited.has(id)) continue;
    visited.add(id);
    const node = byId.get(id);
    if (!node) continue;

    // Ngân sách giữa chừng: trước node tốn LLM, kiểm tra hạn mức. Throw RA
    // NGOÀI (không bọc try) → dừng hẳn workflow thay vì thành node-error có
    // thể bị nhánh "error" nuốt. Sub-workflow tự check ở đầu executeWorkflow.
    if (
      opt.assertBudget &&
      (node.type === "agent" || node.type === "llm" || node.type === "agent_chain")
    ) {
      await opt.assertBudget();
    }

    const cfg = node.config ?? {};
    // Input của node: value tĩnh cổng input + ghi đè từ data-edge.
    const inputs = resolveNodeInputs(node, opt.edges, byId, nodeOutputs, portValues, vars);
    const t0 = performance.now();
    let step!: RunStep;
    let followLabels: string[] | null = null;
    // Raw output để các node sau bóc field qua data-edge.
    let rawOutput: unknown;

    // Độ tin cậy per-node: timeout (Promise.race) + retry/backoff khi lỗi.
    const rel = readReliability(cfg);
    for (let attempt = 0; ; attempt++) {
      followLabels = null;
      rawOutput = undefined;
      try {
        // Thân node bọc trong IIFE để áp timeout per-node nếu cấu hình.
        const body = (async () => {
          switch (node.type) {
            case "trigger": {
              // Output của trigger = payload khởi tạo (vars hiện có).
              rawOutput = { ...vars };
              step = mkStep(node, "ok", `Trigger kích hoạt`, t0);
              break;
            }
            case "action": {
              const tool = typeof cfg.tool === "string" ? cfg.tool : "";
              if (!tool) {
                step = mkStep(node, "skipped", "Chưa cấu hình tool — bỏ qua", t0);
              } else {
                // Input cổng ghi đè args literal (cổng input = tên arg).
                const out = await opt.callTool(tool, { ...resolveArgs(cfg), ...inputs });
                if (out && typeof out === "object" && !Array.isArray(out)) {
                  Object.assign(vars, out as Record<string, unknown>);
                }
                rawOutput = out;
                step = mkStep(node, "ok", `Đã gọi tool \`${tool}\``, t0, out);
              }
              break;
            }
            case "condition": {
              const expr = typeof cfg.expr === "string" ? cfg.expr : "";
              if (!expr) {
                step = mkStep(node, "skipped", "Chưa có biểu thức — đi tất cả nhánh", t0);
              } else {
                // Cổng input phủ lên vars khi eval (tham chiếu {portId}).
                const r = evaluate(expr, { ...vars, ...inputs });
                const truthy = !!r.value;
                followLabels = truthy ? ["true", "yes", "đúng", ""] : ["false", "no", "sai"];
                rawOutput = r.value;
                step = mkStep(
                  node,
                  r.ok ? "ok" : "error",
                  r.ok
                    ? `Điều kiện = ${truthy ? "ĐÚNG" : "SAI"} → nhánh ${truthy ? "true" : "false"}`
                    : `Lỗi biểu thức: ${r.error}`,
                  t0,
                  r.value,
                );
              }
              break;
            }
            case "agent": {
              if (!opt.callAgent) {
                step = mkStep(node, "skipped", "Không có agent runner", t0);
              } else {
                // Cổng input "system"/"prompt" ghi đè config tương ứng.
                const agentCfg: Record<string, unknown> = { ...cfg };
                if ("system" in inputs) agentCfg.system = inputs.system;
                if ("prompt" in inputs) agentCfg.prompt = inputs.prompt;
                const res = await opt.callAgent(agentCfg, vars);
                vars[`agent_${node.id}`] = res.text;
                rawOutput = res.text;
                step = mkStep(node, "ok", `Agent trả lời (${res.text.length} ký tự)`, t0, res.text);
                step.tokens = res.usage;
                step.model = res.model;
              }
              break;
            }
            case "llm": {
              // Node LLM ĐỘC LẬP: một lượt gọi LLM (system + prompt) → text.
              // Khác "agent" ở trình bày tối giản (chỉ prompt/system/model, không
              // gắn Agent entity) → dùng song song với node Agent trong cùng
              // workflow. Cùng cơ chế callAgent (vốn là 1-shot completion).
              if (!opt.callAgent) {
                step = mkStep(node, "skipped", "Không có LLM runner", t0);
              } else {
                const llmCfg: Record<string, unknown> = { ...cfg };
                if ("system" in inputs) llmCfg.system = inputs.system;
                if ("prompt" in inputs) llmCfg.prompt = inputs.prompt;
                const res = await opt.callAgent(llmCfg, vars);
                vars[`llm_${node.id}`] = res.text;
                rawOutput = res.text;
                step = mkStep(node, "ok", `LLM trả lời (${res.text.length} ký tự)`, t0, res.text);
                step.tokens = res.usage;
                step.model = res.model;
              }
              break;
            }
            case "knowledge": {
              // Tra Knowledge Base (RAG). Cổng input "query" ghi đè config.query.
              // Output: vars.knowledge_<id> = context ghép đoạn (cho node LLM/agent
              // sau dùng), vars.knowledge_<id>_hits = danh sách hit thô.
              if (!opt.searchKnowledge) {
                step = mkStep(node, "skipped", "Server không cấu hình searchKnowledge", t0);
                break;
              }
              const q =
                typeof inputs.query === "string" && inputs.query.trim()
                  ? inputs.query
                  : typeof cfg.query === "string"
                    ? cfg.query
                    : "";
              if (!q.trim()) {
                step = mkStep(node, "skipped", "Chưa có truy vấn — bỏ qua", t0);
                break;
              }
              const topK = Math.max(1, Math.min(20, Number(cfg.topK ?? 5)));
              const sourceKind =
                typeof cfg.sourceKind === "string" && cfg.sourceKind ? cfg.sourceKind : undefined;
              const hits = await opt.searchKnowledge(q, { limit: topK, sourceKind });
              const context = hits
                .map((h, i) => `[${i + 1}] ${h.sourceTitle}\n${h.content}`)
                .join("\n\n");
              vars[`knowledge_${node.id}`] = context;
              vars[`knowledge_${node.id}_hits`] = hits;
              rawOutput = { hits, context };
              step = mkStep(node, "ok", `Tra KB: ${hits.length} đoạn khớp`, t0, hits);
              break;
            }
            case "agent_chain": {
              // Chained agent: chạy N step sequential, output step trước
              // làm input bổ sung step sau (qua vars.chain_prev). Mỗi step
              // dùng config riêng (prompts[i] / models[i]) hoặc share.
              if (!opt.callAgent) {
                step = mkStep(node, "skipped", "Không có agent runner", t0);
                break;
              }
              const steps = (cfg.steps as Array<Record<string, unknown>>) ?? [];
              // `|| 5`: maxSteps phi số (NaN) hoặc 0 → mặc định 5, tránh
              // Math.min(NaN,20)=NaN làm vòng lặp không chạy mà vẫn báo "ok".
              const maxChainSteps = Math.min(Number(cfg.maxSteps) || 5, 20);
              if (!Array.isArray(steps) || steps.length === 0) {
                step = mkStep(node, "skipped", "agent_chain cần config.steps[]", t0);
                break;
              }
              let totalIn = 0,
                totalOut = 0;
              let prevText = "";
              const outputs: string[] = [];
              for (let i = 0; i < Math.min(steps.length, maxChainSteps); i++) {
                const stepCfg = { ...steps[i], chain_prev: prevText };
                const r = await opt.callAgent(stepCfg, { ...vars, chain_prev: prevText });
                outputs.push(r.text);
                prevText = r.text;
                totalIn += r.usage.input_tokens;
                totalOut += r.usage.output_tokens;
              }
              vars[`agent_chain_${node.id}`] = outputs;
              rawOutput = outputs;
              step = mkStep(
                node,
                "ok",
                `Chain ${outputs.length}/${steps.length} agent (${prevText.length} ký tự cuối)`,
                t0,
                outputs,
              );
              step.tokens = { input_tokens: totalIn, output_tokens: totalOut };
              break;
            }
            case "delay": {
              // Cổng input "minutes" ghi đè config.minutes.
              const mins = Number(inputs.minutes ?? cfg.minutes ?? 0);
              const ms = Math.max(0, mins * 60_000);
              // Đã được lên lịch resume sau khi hết hạn (server set
              // delay_done_<id> khi pg-boss job tới giờ) → đi tiếp.
              if (vars[`delay_done_${node.id}`]) {
                step = mkStep(node, "ok", `Đã chờ xong ${mins} phút`, t0);
                break;
              }
              if (ms <= maxDelayMs) {
                // Delay ngắn → chờ thật trong tiến trình (không chặn lâu).
                await sleep(ms);
                step = mkStep(node, "ok", `Chờ ${mins} phút`, t0);
                break;
              }
              // Delay dài hơn cap → KHÔNG sleep chặn worker; tạm dừng để server
              // lên lịch (pg-boss) resume sau `ms`. output.__delayMs cho server
              // biết thời lượng; resume set delay_done_<id> để node đi tiếp.
              step = mkStep(node, "paused", `Chờ ${mins} phút — đã lên lịch tiếp tục`, t0, {
                __delayMs: ms,
              });
              break;
            }
            case "approval": {
              // Quyết định duyệt (khi resume server set vars["approval_<id>"]
              // hoặc cổng input "decision"): "approved"/"rejected" → đi nhánh
              // tương ứng; chưa có → tạm dừng chờ duyệt.
              const decision = String(
                vars[`approval_${node.id}`] ?? inputs.decision ?? "",
              ).toLowerCase();
              if (decision === "approved" || decision === "rejected") {
                followLabels = [decision];
                step = mkStep(
                  node,
                  "ok",
                  decision === "approved"
                    ? "Đã duyệt → nhánh approved"
                    : "Từ chối → nhánh rejected",
                  t0,
                  decision,
                );
              } else {
                step = mkStep(node, "paused", `Chờ duyệt: "${node.label}" — workflow tạm dừng`, t0);
              }
              break;
            }
            case "code": {
              const code = typeof cfg.code === "string" ? cfg.code : "";
              if (!code.trim()) {
                step = mkStep(node, "skipped", "Chưa có code — bỏ qua", t0);
                break;
              }
              if (!opt.runCode) {
                step = mkStep(node, "error", "Server không cấu hình sandbox cho code-node", t0);
                break;
              }
              // Cổng input phủ lên vars truyền vào sandbox.
              const r = await opt.runCode(code, { vars: { ...vars, ...inputs }, nodeId: id });
              if (r.output && typeof r.output === "object" && !Array.isArray(r.output)) {
                Object.assign(vars, r.output);
              }
              rawOutput = r.output;
              const detail = r.logs.length ? r.logs.join("\n") : `Code chạy ${r.durationMs}ms`;
              step = mkStep(node, "ok", detail, t0, r.output);
              break;
            }
            case "procedure": {
              const name = typeof cfg.name === "string" ? cfg.name : "";
              if (!name) {
                step = mkStep(node, "skipped", "Chưa chọn procedure — bỏ qua", t0);
                break;
              }
              if (!opt.invokeProcedure) {
                step = mkStep(node, "error", "Server không cấu hình procedure runner", t0);
                break;
              }
              // Cổng input ghi đè args literal (cổng input = tên arg).
              const r = await opt.invokeProcedure(name, { ...resolveArgs(cfg), ...inputs });
              if (r.output && typeof r.output === "object" && !Array.isArray(r.output)) {
                Object.assign(vars, r.output as Record<string, unknown>);
              }
              rawOutput = r.output;
              const detail = r.logs.length
                ? r.logs.join("\n")
                : `Procedure "${name}" chạy ${r.durationMs}ms`;
              step = mkStep(node, "ok", detail, t0, r.output);
              break;
            }
            case "http": {
              // Gọi HTTP API ngoài. Cổng input ghi đè url/body. Body object
              // của response (JSON) merge vào vars; status >= 400 → coi lỗi.
              const url = typeof inputs.url === "string" ? inputs.url : (cfg.url as string) || "";
              if (!url) {
                step = mkStep(node, "skipped", "Chưa có URL — bỏ qua", t0);
                break;
              }
              if (!opt.runHttp) {
                step = mkStep(node, "error", "Server không cấu hình runHttp", t0);
                break;
              }
              const method = (typeof cfg.method === "string" ? cfg.method : "GET").toUpperCase();
              const headers =
                cfg.headers && typeof cfg.headers === "object"
                  ? (cfg.headers as Record<string, unknown>)
                  : {};
              const body = inputs.body ?? cfg.body;
              const res = await opt.runHttp({ url, method, headers, body });
              if (res.body && typeof res.body === "object" && !Array.isArray(res.body)) {
                Object.assign(vars, res.body as Record<string, unknown>);
              }
              rawOutput = res.body;
              step = mkStep(
                node,
                res.status >= 400 ? "error" : "ok",
                `HTTP ${method} → ${res.status}`,
                t0,
                res.body,
              );
              break;
            }
            case "setvar": {
              // Đặt/biến đổi biến qua formula — không cần code. Mỗi assignment
              // {key, formula}: formula eval theo {vars, inputs}; rỗng → lấy
              // inputs[key]. Kết quả gán vào vars và là rawOutput của node.
              const assigns = Array.isArray(cfg.assignments)
                ? (cfg.assignments as Array<{ key?: string; formula?: string }>)
                : [];
              const out: Record<string, unknown> = {};
              for (const a of assigns) {
                if (!a.key) continue;
                const v =
                  typeof a.formula === "string" && a.formula.trim()
                    ? evaluate(a.formula, { ...vars, ...inputs }).value
                    : inputs[a.key];
                vars[a.key] = v;
                out[a.key] = v;
              }
              rawOutput = out;
              step = mkStep(node, "ok", `Đặt ${Object.keys(out).length} biến`, t0, out);
              break;
            }
            case "switch": {
              // Router đa nhánh: eval expr → so khớp với cases[].value → đi nhánh
              // có edge.label = case.label; không khớp → nhánh "default".
              const expr = typeof cfg.expr === "string" ? cfg.expr : "";
              const cases = Array.isArray(cfg.cases)
                ? (cfg.cases as Array<{ value?: unknown; label?: string }>)
                : [];
              if (!expr) {
                step = mkStep(node, "skipped", "Chưa có biểu thức — đi nhánh default", t0);
                followLabels = ["default"];
                break;
              }
              const r = evaluate(expr, { ...vars, ...inputs });
              rawOutput = r.value;
              if (!r.ok) {
                step = mkStep(node, "error", `Lỗi biểu thức: ${r.error}`, t0);
                break;
              }
              // So khớp dạng chuỗi để an toàn với số/boolean.
              const got = String(r.value);
              const hit = cases.find((c) => String(c.value) === got);
              const lbl = hit?.label ? hit.label : "default";
              followLabels = [lbl.toLowerCase()];
              step = mkStep(node, "ok", `Switch = ${got} → nhánh "${lbl}"`, t0, r.value);
              break;
            }
            case "subworkflow": {
              const subId = typeof cfg.workflowId === "string" ? cfg.workflowId : "";
              if (!subId) {
                step = mkStep(node, "skipped", "Chưa chọn workflow con — bỏ qua", t0);
                break;
              }
              if (!opt.runSubWorkflow) {
                step = mkStep(node, "error", "Server không cấu hình runSubWorkflow", t0);
                break;
              }
              // Cổng input phủ lên vars truyền làm initialVars của workflow con.
              const sub = await opt.runSubWorkflow(subId, { ...vars, ...inputs });
              Object.assign(vars, sub.vars);
              rawOutput = sub.vars;
              step = mkStep(
                node,
                sub.status === "error" ? "error" : "ok",
                `Workflow con chạy — ${sub.status}`,
                t0,
                sub.vars,
              );
              break;
            }
            case "foreach": {
              const subId = typeof cfg.workflowId === "string" ? cfg.workflowId : "";
              if (!subId) {
                step = mkStep(node, "skipped", "Chưa chọn workflow con — bỏ qua", t0);
                break;
              }
              if (!opt.runSubWorkflow) {
                step = mkStep(node, "error", "Server không cấu hình runSubWorkflow", t0);
                break;
              }
              // Mảng lặp: ưu tiên cổng input "items", rồi tới itemsExpr (formula).
              let arr: unknown = inputs.items;
              if (arr === undefined && typeof cfg.itemsExpr === "string" && cfg.itemsExpr.trim()) {
                arr = evaluate(cfg.itemsExpr, { ...vars, ...inputs }).value;
              }
              if (!Array.isArray(arr)) {
                step = mkStep(node, "skipped", "Cổng/biểu thức items không phải mảng", t0);
                break;
              }
              if (arr.length > MAX_FOREACH) {
                step = mkStep(
                  node,
                  "error",
                  `foreach quá ${MAX_FOREACH} phần tử (${arr.length})`,
                  t0,
                );
                break;
              }
              const itemVar = typeof cfg.itemVar === "string" && cfg.itemVar ? cfg.itemVar : "item";
              // Chạy song song có giới hạn (worker pool); kết quả ghi theo
              // index nên thứ tự foreach_<id> luôn khớp mảng đầu vào.
              const runSub = opt.runSubWorkflow;
              const items = arr;
              const results: Array<Record<string, unknown>> = new Array(items.length);
              let failed = 0;
              let nextIdx = 0;
              const worker = async () => {
                while (true) {
                  const i = nextIdx++;
                  if (i >= items.length) break;
                  const sub = await runSub(subId, {
                    ...vars,
                    ...inputs,
                    [itemVar]: items[i],
                    index: i,
                  });
                  if (sub.status === "error") failed++;
                  results[i] = sub.vars;
                }
              };
              const poolSize = Math.min(FOREACH_CONCURRENCY, items.length);
              await Promise.all(Array.from({ length: poolSize }, () => worker()));
              vars[`foreach_${node.id}`] = results;
              rawOutput = results;
              step = mkStep(
                node,
                failed ? "error" : "ok",
                `Lặp ${arr.length} phần tử${failed ? ` (${failed} lỗi)` : ""}`,
                t0,
                results,
              );
              break;
            }
            default: {
              // Node type lạ → tra plugin trong registry.
              const plugin = opt.registry?.workflowNode(node.type);
              if (plugin) {
                const res = await plugin.run({ config: cfg, vars: { ...vars, ...inputs } });
                if (res.output) Object.assign(vars, res.output);
                if (res.branch) followLabels = [res.branch.toLowerCase()];
                rawOutput = res.output;
                step = mkStep(
                  node,
                  "ok",
                  res.detail ?? `Node plugin "${node.type}"`,
                  t0,
                  res.output,
                );
              } else {
                step = mkStep(node, "ok", node.label, t0);
              }
            }
          }
        })();
        if (rel.timeoutMs > 0) {
          await Promise.race([
            body,
            new Promise<never>((_, rej) =>
              setTimeout(
                () => rej(new Error(`Node timeout sau ${rel.timeoutMs}ms`)),
                rel.timeoutMs,
              ),
            ),
          ]);
        } else {
          await body;
        }
      } catch (e) {
        step = mkStep(
          node,
          "error",
          `Lỗi${attempt ? ` (sau ${attempt} lần thử lại)` : ""}: ${(e as Error).message}`,
          t0,
        );
      }
      // Retry khi node lỗi và còn lượt; ok/skipped/paused → dừng vòng.
      if (step.status === "error" && attempt < rel.retryMax) {
        await sleep(rel.backoffMs);
        continue;
      }
      break;
    }

    // Lưu raw output cho data-edge của node sau (kể cả undefined).
    nodeOutputs.set(id, rawOutput);
    // Tính giá trị từng cổng output: có formula → eval theo {vars, inputs}
    // (tham chiếu cổng input bằng {inPortId}); còn lại → bóc path từ raw.
    for (const p of portsOf(node, "outputs")) {
      const v =
        typeof p.formula === "string" && p.formula.trim()
          ? evaluate(p.formula, { ...vars, ...inputs }).value
          : resolvePath(rawOutput, p.path);
      portValues.set(`${id}:${p.id}`, v);
    }
    steps.push(step);
    opt.onStep?.(step);

    // Approval → tạm dừng workflow, dừng nhánh này.
    if (step.status === "paused") {
      overallStatus = "paused";
      continue;
    }

    // Node lỗi: nếu có edge nhánh "error" → đi nhánh xử lý lỗi (KHÔNG đánh dấu
    // workflow lỗi); không có nhánh → dừng nhánh + đánh dấu lỗi (như cũ).
    if (step.status === "error") {
      const errTargets = opt.edges.filter(
        (ed) => ed.source === id && !isDataEdge(ed) && (ed.label ?? "").toLowerCase() === "error",
      );
      if (errTargets.length) {
        for (const e of errTargets) if (!visited.has(e.target)) queue.push(e.target);
      } else {
        overallStatus = "error";
      }
      continue;
    }

    // Đi tiếp theo edge CONTROL-FLOW (bỏ qua data-edge nối cổng). Nhãn "error"
    // là dành riêng cho nhánh lỗi → không đi khi node chạy bình thường.
    // (followLabels được gán trong IIFE nên TS không suy được kiểu — ép lại.)
    const follow = followLabels as string[] | null;
    for (const e of opt.edges.filter((ed) => ed.source === id && !isDataEdge(ed))) {
      const lbl = (e.label ?? "").toLowerCase();
      if (lbl === "error") continue;
      if (follow && !follow.includes(lbl)) continue;
      if (!visited.has(e.target)) queue.push(e.target);
    }
  }

  if (steps.length >= maxSteps) overallStatus = "error";

  return { status: overallStatus, steps, vars };
}

function mkStep(
  node: WfNode,
  status: RunStep["status"],
  detail: string,
  t0: number,
  output?: unknown,
): RunStep {
  return {
    nodeId: node.id,
    kind: node.type,
    label: node.label,
    status,
    detail,
    output,
    durationMs: Math.round(performance.now() - t0),
  };
}
