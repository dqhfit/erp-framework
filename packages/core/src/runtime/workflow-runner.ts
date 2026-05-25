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
  type: string;            // trigger|action|condition|agent|approval|delay
  label: string;
  config?: Record<string, unknown>;
}
export interface WfEdge {
  source: string;
  target: string;
  label?: string;          // "true"/"false"/"yes"/"no"/...
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
  ) => Promise<{ text: string; model: string; usage: { input_tokens: number; output_tokens: number } }>;
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

export async function runWorkflow(opt: RunWorkflowOptions): Promise<RunResult> {
  const maxSteps = opt.maxSteps ?? 50;
  const maxDelayMs = opt.maxDelayMs ?? 3000;
  const byId = new Map(opt.nodes.map((n) => [n.id, n]));
  const steps: RunStep[] = [];
  const vars: Record<string, unknown> = { ...(opt.initialVars ?? {}) };

  const triggers = opt.nodes.filter((n) => n.type === "trigger");
  if (!opt.nodes.length) {
    return { status: "error", steps: [], vars };
  }
  if (!triggers.length) {
    const s: RunStep = {
      nodeId: "", kind: "error", label: "—", status: "error",
      detail: "Workflow không có node Trigger.", durationMs: 0,
    };
    return { status: "error", steps: [s], vars };
  }

  const visited = new Set<string>();
  const queue: string[] = triggers.map((t) => t.id);
  let overallStatus: RunResult["status"] = "completed";

  while (queue.length && steps.length < maxSteps) {
    const id = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);
    const node = byId.get(id);
    if (!node) continue;

    const cfg = node.config ?? {};
    const t0 = performance.now();
    let step: RunStep;
    let followLabels: string[] | null = null;

    try {
      switch (node.type) {
        case "trigger": {
          step = mkStep(node, "ok", `Trigger kích hoạt`, t0);
          break;
        }
        case "action": {
          const tool = typeof cfg.tool === "string" ? cfg.tool : "";
          if (!tool) {
            step = mkStep(node, "skipped", "Chưa cấu hình tool — bỏ qua", t0);
          } else {
            const out = await opt.callTool(tool, resolveArgs(cfg));
            if (out && typeof out === "object" && !Array.isArray(out)) {
              Object.assign(vars, out as Record<string, unknown>);
            }
            step = mkStep(node, "ok", `Đã gọi tool \`${tool}\``, t0, out);
          }
          break;
        }
        case "condition": {
          const expr = typeof cfg.expr === "string" ? cfg.expr : "";
          if (!expr) {
            step = mkStep(node, "skipped", "Chưa có biểu thức — đi tất cả nhánh", t0);
          } else {
            const r = evaluate(expr, vars);
            const truthy = !!r.value;
            followLabels = truthy ? ["true", "yes", "đúng", ""] : ["false", "no", "sai"];
            step = mkStep(node, r.ok ? "ok" : "error",
              r.ok ? `Điều kiện = ${truthy ? "ĐÚNG" : "SAI"} → nhánh ${truthy ? "true" : "false"}`
                   : `Lỗi biểu thức: ${r.error}`, t0, r.value);
          }
          break;
        }
        case "agent": {
          if (!opt.callAgent) {
            step = mkStep(node, "skipped", "Không có agent runner", t0);
          } else {
            const res = await opt.callAgent(cfg, vars);
            vars[`agent_${node.id}`] = res.text;
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
          let totalIn = 0, totalOut = 0;
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
          step = mkStep(node, "ok",
            `Chain ${outputs.length}/${steps.length} agent (${prevText.length} ký tự cuối)`,
            t0, outputs);
          step.tokens = { input_tokens: totalIn, output_tokens: totalOut };
          break;
        }
        case "delay": {
          const mins = Number(cfg.minutes ?? 0);
          const realWait = Math.min(mins * 60_000, maxDelayMs);
          await sleep(realWait);
          step = mkStep(node, "ok",
            `Chờ ${mins} phút (thực chờ ${(realWait / 1000).toFixed(1)}s)`, t0);
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
            step = mkStep(node, "error",
              "Server không cấu hình sandbox cho code-node", t0);
            overallStatus = "error";
            break;
          }
          const r = await opt.runCode(code, { vars, nodeId: id });
          if (r.output && typeof r.output === "object" && !Array.isArray(r.output)) {
            Object.assign(vars, r.output);
          }
          const detail = r.logs.length
            ? r.logs.join("\n")
            : `Code chạy ${r.durationMs}ms`;
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
            step = mkStep(node, "error",
              "Server không cấu hình procedure runner", t0);
            overallStatus = "error";
            break;
          }
          const r = await opt.invokeProcedure(name, resolveArgs(cfg));
          if (r.output && typeof r.output === "object" && !Array.isArray(r.output)) {
            Object.assign(vars, r.output as Record<string, unknown>);
          }
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
            const res = await plugin.run({ config: cfg, vars });
            if (res.output) Object.assign(vars, res.output);
            if (res.branch) followLabels = [res.branch.toLowerCase()];
            step = mkStep(node, "ok",
              res.detail ?? `Node plugin "${node.type}"`, t0, res.output);
          } else {
            step = mkStep(node, "ok", node.label, t0);
          }
        }
      }
    } catch (e) {
      step = mkStep(node, "error", `Lỗi: ${(e as Error).message}`, t0);
      overallStatus = "error";
    }

    steps.push(step);
    opt.onStep?.(step);

    // Approval/error → dừng nhánh này
    if (step.status === "paused" || step.status === "error") continue;

    // Đi tiếp theo edge
    for (const e of opt.edges.filter((ed) => ed.source === id)) {
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
