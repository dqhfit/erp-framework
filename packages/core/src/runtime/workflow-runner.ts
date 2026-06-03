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
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

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

/** Gom giá trị input của node: mặc định từ value tĩnh của cổng input đã
 *  khai báo, rồi ghi đè bằng giá trị nối từ data-edge (output node nguồn
 *  + path của cổng output). */
function resolveNodeInputs(
  node: WfNode,
  edges: WfEdge[],
  byId: Map<string, WfNode>,
  nodeOutputs: Map<string, unknown>,
  portValues: Map<string, unknown>,
): Record<string, unknown> {
  const inputs: Record<string, unknown> = {};
  for (const p of portsOf(node, "inputs")) {
    if (p.value !== undefined) inputs[p.id] = p.value;
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

    const cfg = node.config ?? {};
    // Input của node: value tĩnh cổng input + ghi đè từ data-edge.
    const inputs = resolveNodeInputs(node, opt.edges, byId, nodeOutputs, portValues);
    const t0 = performance.now();
    let step: RunStep;
    let followLabels: string[] | null = null;
    // Raw output để các node sau bóc field qua data-edge.
    let rawOutput: unknown;

    try {
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
        case "agent_chain": {
          // Chained agent: chạy N step sequential, output step trước
          // làm input bổ sung step sau (qua vars.chain_prev). Mỗi step
          // dùng config riêng (prompts[i] / models[i]) hoặc share.
          if (!opt.callAgent) {
            step = mkStep(node, "skipped", "Không có agent runner", t0);
            break;
          }
          const steps = (cfg.steps as Array<Record<string, unknown>>) ?? [];
          const maxChainSteps = Math.min(Number(cfg.maxSteps ?? 5), 20);
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
          const realWait = Math.min(mins * 60_000, maxDelayMs);
          await sleep(realWait);
          step = mkStep(
            node,
            "ok",
            `Chờ ${mins} phút (thực chờ ${(realWait / 1000).toFixed(1)}s)`,
            t0,
          );
          break;
        }
        case "approval": {
          step = mkStep(node, "paused", `Chờ duyệt: "${node.label}" — workflow tạm dừng`, t0);
          overallStatus = "paused";
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
            overallStatus = "error";
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
            overallStatus = "error";
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
        default: {
          // Node type lạ → tra plugin trong registry.
          const plugin = opt.registry?.workflowNode(node.type);
          if (plugin) {
            const res = await plugin.run({ config: cfg, vars: { ...vars, ...inputs } });
            if (res.output) Object.assign(vars, res.output);
            if (res.branch) followLabels = [res.branch.toLowerCase()];
            rawOutput = res.output;
            step = mkStep(node, "ok", res.detail ?? `Node plugin "${node.type}"`, t0, res.output);
          } else {
            step = mkStep(node, "ok", node.label, t0);
          }
        }
      }
    } catch (e) {
      step = mkStep(node, "error", `Lỗi: ${(e as Error).message}`, t0);
      overallStatus = "error";
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

    // Approval/error → dừng nhánh này
    if (step.status === "paused" || step.status === "error") continue;

    // Đi tiếp theo edge CONTROL-FLOW (bỏ qua data-edge nối cổng).
    for (const e of opt.edges.filter((ed) => ed.source === id && !isDataEdge(ed))) {
      if (followLabels) {
        const lbl = (e.label ?? "").toLowerCase();
        if (!followLabels.includes(lbl)) continue;
      }
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
