/* ==========================================================
   config.ts — Client cho cấu hình hệ thống: MCP config + LLM
   profiles. Bọc router mcp.* / llm.* của server. Thay cho
   "bridge server" cũ — config giờ lưu trong PostgreSQL.
   ========================================================== */
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import type { AppRouter } from "@erp-framework/server";

export interface LlmProfileInput {
  name: string;
  adapter: string;
  model: string;
  endpoint?: string;
  apiKeyEnc?: string;
  temperature?: number;
  maxTokens?: number;
}

/** Profile CÁ NHÂN — thêm runtime ("server" server gọi được / "browser" model
 *  local máy user). */
export interface LlmProfileMineInput extends LlmProfileInput {
  runtime?: "server" | "browser";
}

/** Tạo client gọi mcp.* / llm.* của server. */
export function createConfigClient(baseUrl: string) {
  const trpc = createTRPCClient<AppRouter>({
    links: [
      httpBatchLink({
        url: baseUrl.replace(/\/$/, "") + "/trpc",
        fetch: (input, init) => fetch(input, { ...init, credentials: "include" }),
      }),
    ],
  });
  return {
    getMcp: () => trpc.mcp.get.query(),
    saveMcp: (config: object) =>
      trpc.mcp.save.mutate({ config: config as Record<string, unknown> }),
    listLlm: () => trpc.llm.list.query(),
    saveLlm: (p: LlmProfileInput) => trpc.llm.save.mutate(p),
    deleteLlm: (name: string) => trpc.llm.delete.mutate(name),
    // Profile cá nhân (mọi user approved tự cấu hình model riêng).
    listLlmMine: () => trpc.llm.listMine.query(),
    saveLlmMine: (p: LlmProfileMineInput) => trpc.llm.saveMine.mutate(p),
    deleteLlmMine: (name: string) => trpc.llm.deleteMine.mutate(name),
  };
}
