/* ==========================================================
   embed.ts — Client embed: bọc các thủ tục embed.* của server
   (token nhúng builder vào sản phẩm khác).
   ========================================================== */
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import type { AppRouter } from "@erp-framework/server";

export type EmbedScope = "all" | "page" | "workflow" | "entity";

/** Tạo client gọi embed.* của server. */
export function createEmbedClient(baseUrl: string) {
  const trpc = createTRPCClient<AppRouter>({
    links: [httpBatchLink({
      url: baseUrl.replace(/\/$/, "") + "/trpc",
      fetch: (input, init) => fetch(input, { ...init, credentials: "include" }),
    })],
  });
  return {
    /** Xác thực một token nhúng (công khai — dùng ở EmbedGate). */
    verify: (token: string) => trpc.embed.verify.query(token),
    /** Danh sách token nhúng của công ty. */
    list: () => trpc.embed.list.query(),
    /** Tạo token nhúng mới. */
    create: (label?: string, scope?: EmbedScope) =>
      trpc.embed.create.mutate({ label, scope }),
    /** Thu hồi một token. */
    revoke: (id: string) => trpc.embed.revoke.mutate(id),
  };
}

export type EmbedClient = ReturnType<typeof createEmbedClient>;
