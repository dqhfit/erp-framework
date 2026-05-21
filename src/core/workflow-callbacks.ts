/* ==========================================================
   workflow-callbacks.ts — Callback chạy thật dùng chung cho
   workflow runner (WorkflowRunPanel + scheduler). callTool gọi
   MCP, callAgent gọi LLM qua profile mặc định.
   ========================================================== */
import { callMcpTool } from "@/hooks/useMcpClient";
import { llmRegistry } from "@/core/llm/registry";
import { useSettings } from "@/stores/settings";

/** Gọi MCP tool thật. */
export function callToolReal(
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  return callMcpTool(name, args);
}

/** Gọi LLM cho node agent — dùng profile chỉ định trong config, hoặc profile đầu tiên. */
export async function callAgentReal(
  cfg: Record<string, unknown>,
  vars: Record<string, unknown>,
): Promise<{ text: string; model: string; usage: { input_tokens: number; output_tokens: number } }> {
  const profiles = useSettings.getState().llmProfiles;
  const wanted = typeof cfg.profile === "string" ? cfg.profile : "";
  const name = wanted && profiles[wanted] ? wanted : Object.keys(profiles)[0];
  if (!name) throw new Error("Chưa có LLM profile nào — vào Cấu hình LLM để thêm.");
  const profile = profiles[name]!;
  const system = typeof cfg.system === "string" ? cfg.system
    : "Bạn là một agent trong workflow ERP. Trả lời ngắn gọn.";
  const prompt = typeof cfg.prompt === "string" ? cfg.prompt
    : `Dữ liệu workflow hiện tại:\n${JSON.stringify(vars, null, 2)}`;
  const res = await llmRegistry.send(name, {
    system,
    messages: [{ role: "user", content: prompt }],
  });
  return { text: res.text, model: profile.model, usage: res.usage };
}
