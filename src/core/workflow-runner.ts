/* ==========================================================
   workflow-runner.ts — Chạy workflow THẬT (khác Test Run mô phỏng).
   - Action   → gọi MCP tool thật
   - Condition→ eval formula expr, rẽ nhánh theo nhãn edge
   - Agent    → gọi LLM (qua callback)
   - Delay    → chờ thật (cap an toàn để khỏi treo UI)
   - Approval → tạm dừng nhánh, trả status "paused"
   Mỗi bước ghi vào activity log.
   ========================================================== */
import { evaluate } from "@/lib/formula";
import { logActivity } from "@/stores/activity";

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
  /** Gọi MCP tool thật */
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  /** Gọi LLM cho node agent — trả text + usage */
  callAgent?: (
    nodeConfig: Record<string, unknown>,
    vars: Record<string, unknown>,
  ) => Promise<{ text: string; model: string; usage: { input_tokens: number; output_tokens: number } }>;
  /** Biến khởi tạo (vd trigger payload) */
  initialVars?: Record<string, unknown>;
  /** Callback mỗi bước — cho UI cập nhật realtime */
  onStep?: (step: RunStep) => void;
  /** Cap số bước để chống loop */
  maxSteps?: number;
  /** Cap thời gian delay thật (ms) — tránh treo UI lâu */
  maxDelayMs?: number;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Lấy args literal từ config (workflow runner đơn giản: config.args là object) */
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
    let followLabels: string[] | null = null; // null = theo tất cả edge

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
            logActivity({
              kind: "run_agent", objectType: "workflow", target: opt.workflowName,
              detail: `Agent node "${node.label}"`,
              tokens: { input: res.usage.input_tokens, output: res.usage.output_tokens },
              model: res.model,
            });
            step = mkStep(node, "ok", `Agent trả lời (${res.text.length} ký tự)`, t0, res.text);
          }
          break;
        }
        case "delay": {
          const mins = Number(cfg.minutes ?? 0);
          const realWait = Math.min(mins * 60_000, maxDelayMs);
          await sleep(realWait);
          step = mkStep(node, "ok",
            `Chờ ${mins} phút (mô phỏng ${(realWait / 1000).toFixed(1)}s)`, t0);
          break;
        }
        case "approval": {
          step = mkStep(node, "paused", `Chờ duyệt: "${node.label}" — workflow tạm dừng`, t0);
          overallStatus = "paused";
          break;
        }
        default:
          step = mkStep(node, "ok", node.label, t0);
      }
    } catch (e) {
      step = mkStep(node, "error", `Lỗi: ${(e as Error).message}`, t0);
      overallStatus = "error";
    }

    steps.push(step);
    opt.onStep?.(step);

    // Approval/error → dừng nhánh này (không đi tiếp)
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

  logActivity({
    kind: "run_workflow", objectType: "workflow", target: opt.workflowName,
    detail: `Chạy ${steps.length} bước — kết quả: ${overallStatus}`,
  });

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
