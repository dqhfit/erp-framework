/* ==========================================================
   agent-chats.ts — Client lịch sử trò chuyện user ↔ agent.
   Bọc router agentChats.* (list / messages / saveExchange / rename /
   delete / deleteAll). Per-user (approvedProcedure).
   ========================================================== */
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import type { AppRouter } from "@erp-framework/server";

export interface SaveExchangeInput {
  conversationId?: string | null;
  agentId?: string | null;
  userText: string;
  assistantText: string;
}

export function createAgentChatClient(baseUrl: string) {
  const trpc = createTRPCClient<AppRouter>({
    links: [
      httpBatchLink({
        url: baseUrl.replace(/\/$/, "") + "/trpc",
        fetch: (input, init) => fetch(input, { ...init, credentials: "include" }),
      }),
    ],
  });
  return {
    /** Danh sách cuộc trò chuyện của user (mới nhất trước). */
    list: () => trpc.agentChats.list.query(),
    /** Tin nhắn của 1 cuộc trò chuyện. */
    messages: (id: string) => trpc.agentChats.messages.query(id),
    /** Lưu 1 lượt (user + assistant). Trả conversationId. */
    saveExchange: (input: SaveExchangeInput) => trpc.agentChats.saveExchange.mutate(input),
    /** Đổi tiêu đề. */
    rename: (id: string, title: string) => trpc.agentChats.rename.mutate({ id, title }),
    /** Xoá 1 cuộc trò chuyện. */
    delete: (id: string) => trpc.agentChats.delete.mutate(id),
    /** Xoá toàn bộ lịch sử. */
    deleteAll: () => trpc.agentChats.deleteAll.mutate(),
  };
}

export type AgentChatClient = ReturnType<typeof createAgentChatClient>;
