/* ==========================================================
   plugins.ts — Client plugin registry: bọc các thủ tục
   plugins.* của server (đăng ký / bật-tắt / xuất manifest).
   ========================================================== */
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import type { AppRouter } from "@erp-framework/server";

export interface PluginSaveInput {
  name: string;
  version?: string;
  manifest?: Record<string, unknown>;
  enabled?: boolean;
}

/** Tạo client gọi plugins.* của server. */
export function createPluginsClient(baseUrl: string) {
  const trpc = createTRPCClient<AppRouter>({
    links: [httpBatchLink({
      url: baseUrl.replace(/\/$/, "") + "/trpc",
      fetch: (input, init) => fetch(input, { ...init, credentials: "include" }),
    })],
  });
  return {
    /** Plugin đã đăng ký của công ty. */
    list: () => trpc.plugins.list.query(),
    /** Đăng ký / cập nhật plugin (upsert theo tên). */
    save: (input: PluginSaveInput) => trpc.plugins.save.mutate(input),
    /** Bật / tắt một plugin lúc chạy. */
    setEnabled: (id: string, enabled: boolean) =>
      trpc.plugins.setEnabled.mutate({ id, enabled }),
    /** Gỡ đăng ký plugin. */
    delete: (id: string) => trpc.plugins.delete.mutate(id),
    /** Xuất manifest một plugin để chia sẻ. */
    export: (id: string) => trpc.plugins.export.query(id),
  };
}

export type PluginsClient = ReturnType<typeof createPluginsClient>;
