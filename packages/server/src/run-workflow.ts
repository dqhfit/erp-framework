/* ==========================================================
   run-workflow.ts — Thực thi workflow phía server.
   Nạp graph từ DB → chạy runWorkflow (lõi @erp-framework/core)
   → ghi kết quả vào bảng workflow_runs.

   callTool gọi MCP thật (mcp-client), callAgent gọi LLM thật
   (llm-client) — đều đọc cấu hình từ DB. Có thể tiêm callback
   riêng qua ExecuteOptions để test/ghi đè.
   ========================================================== */
import { desc, eq } from "drizzle-orm";
import { workflows, workflowRuns } from "@erp-framework/db";
import {
  runWorkflow, pluginRegistry,
  type WfNode, type WfEdge, type RunWorkflowOptions,
} from "@erp-framework/core";
import type { DB } from "./db";
import { makeCallTool } from "./mcp-client";
import { makeCallAgent } from "./llm-client";
import { logActivity } from "./activity";

/** Shape graph do WorkflowDesigner lưu (node kiểu ReactFlow). */
interface RawGraph {
  nodes?: Array<{
    id: string;
    type?: string;
    data?: { kind?: string; label?: string; config?: Record<string, unknown> };
  }>;
  edges?: Array<{ source: string; target: string; label?: unknown }>;
}

export interface ExecuteOptions {
  callTool?: RunWorkflowOptions["callTool"];
  callAgent?: RunWorkflowOptions["callAgent"];
  context?: Record<string, unknown>;
  scheduleId?: string;
}

/** Chạy một workflow theo id, ghi 1 bản ghi workflow_runs. */
export async function executeWorkflow(
  db: DB,
  workflowId: string,
  opts: ExecuteOptions = {},
): Promise<{ runId: string; status: "completed" | "paused" | "error"; stepCount: number }> {
  const [wf] = await db.select().from(workflows)
    .where(eq(workflows.id, workflowId));
  if (!wf) throw new Error(`Workflow không tồn tại: ${workflowId}`);

  const graph = (wf.graph ?? {}) as RawGraph;
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
  }));

  // Bản ghi run — trạng thái "running"
  const [run] = await db.insert(workflowRuns).values({
    workflowId,
    scheduleId: opts.scheduleId ?? null,
    status: "running",
    vars: opts.context ?? {},
  }).returning();
  if (!run) throw new Error("Không tạo được bản ghi workflow_run");

  // Chạy lõi runtime — truyền registry để runner thực thi được
  // node do plugin định nghĩa (xem nhánh default trong runWorkflow).
  const result = await runWorkflow({
    workflowId,
    workflowName: wf.name,
    nodes,
    edges,
    callTool: opts.callTool ?? makeCallTool(db),
    callAgent: opts.callAgent ?? makeCallAgent(db),
    initialVars: opts.context,
    registry: pluginRegistry,
  });

  // Ghi kết quả cuối
  await db.update(workflowRuns).set({
    status: result.status,
    steps: result.steps,
    vars: result.vars,
    finishedAt: new Date(),
  }).where(eq(workflowRuns.id, run.id));

  // Ghi nhật ký hành động (gộp token của các bước agent).
  const tIn = result.steps.reduce((n, s) => n + (s.tokens?.input_tokens ?? 0), 0);
  const tOut = result.steps.reduce((n, s) => n + (s.tokens?.output_tokens ?? 0), 0);
  await logActivity(db, {
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

/** Lịch sử các lần chạy gần đây của một workflow. */
export function recentRuns(db: DB, workflowId: string, limit = 20) {
  return db.select().from(workflowRuns)
    .where(eq(workflowRuns.workflowId, workflowId))
    .orderBy(desc(workflowRuns.startedAt))
    .limit(limit);
}
