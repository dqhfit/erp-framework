/* ==========================================================
   run-heartbeat.ts — Heartbeat: cho agent "tự thức dậy" theo lịch
   và hành động một nhịp. Khác cron chạy workflow — ở đây chính
   AGENT chạy (vòng lặp LLM + MCP tool) với chỉ dẫn lưu sẵn.

   Nạp heartbeat + agent từ DB → chạy runAgentChat một lượt →
   ghi nhật ký + cập nhật last_run / last_status / last_summary.
   ========================================================== */
import { desc, eq } from "drizzle-orm";
import { agentHeartbeats, agents } from "@erp-framework/db";
import type { DB } from "./db";
import { runAgentChat, type ToolDef } from "./agent-chat";
import { makeCallTool } from "./mcp-client";
import { logActivity } from "./activity";
import { assertWithinBudget } from "./budget";

interface AgentCfg {
  systemPrompt?: string;
  model?: string;
  tools?: unknown;
}

/** Chạy MỘT nhịp heartbeat theo id. Trả về trạng thái + tóm tắt. */
export async function runHeartbeat(
  db: DB,
  heartbeatId: string,
): Promise<{ status: "completed" | "error"; summary: string }> {
  const [hb] = await db.select().from(agentHeartbeats)
    .where(eq(agentHeartbeats.id, heartbeatId));
  if (!hb) throw new Error(`Heartbeat không tồn tại: ${heartbeatId}`);

  const [agent] = await db.select().from(agents)
    .where(eq(agents.id, hb.agentId));
  if (!agent) throw new Error(`Agent không tồn tại: ${hb.agentId}`);

  // Chặn cứng theo ngân sách công ty.
  await assertWithinBudget(db, hb.companyId);

  const cfg = (agent.config ?? {}) as AgentCfg;
  const rawTools = Array.isArray(cfg.tools) ? cfg.tools : [];
  const tools: ToolDef[] = rawTools.filter(
    (t): t is ToolDef =>
      !!t && typeof (t as ToolDef).name === "string"
      && typeof (t as ToolDef).schema === "object",
  );

  let finalText = "";
  let usage = { input: 0, output: 0 };
  let errMsg = "";

  await runAgentChat({
    db,
    companyId: hb.companyId,
    system: cfg.systemPrompt
      ?? "Bạn là agent ERP tự động. Thực hiện chỉ dẫn ngắn gọn, súc tích.",
    messages: [{ role: "user", content: hb.prompt }],
    tools,
    callTool: makeCallTool(db, hb.companyId),
    onEvent: (e) => {
      if (e.type === "done") { finalText = e.text; usage = e.usage; }
      else if (e.type === "error") { errMsg = e.message; }
    },
  });

  // status suy ra SAU khi chạy — TS không theo dõi gán trong closure.
  const status: "completed" | "error" = errMsg ? "error" : "completed";
  const summary = errMsg
    || finalText.trim()
    || "(agent không trả về nội dung)";

  await logActivity(db, {
    companyId: hb.companyId,
    kind: "heartbeat",
    objectType: "agent",
    target: agent.name,
    detail: `Heartbeat — ${status}: ${summary.slice(0, 240)}`,
    tokensInput: usage.input || undefined,
    tokensOutput: usage.output || undefined,
    model: cfg.model,
  });

  await db.update(agentHeartbeats).set({
    lastRun: new Date(),
    lastStatus: status,
    lastSummary: summary.slice(0, 2000),
    runCount: hb.runCount + 1,
  }).where(eq(agentHeartbeats.id, hb.id));

  return { status, summary };
}

/** Heartbeat đang bật của một công ty (mới nhất trước). */
export function listHeartbeats(db: DB, companyId: string) {
  return db.select().from(agentHeartbeats)
    .where(eq(agentHeartbeats.companyId, companyId))
    .orderBy(desc(agentHeartbeats.createdAt));
}
