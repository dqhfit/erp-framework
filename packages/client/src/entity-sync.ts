/* ==========================================================
   entity-sync.ts — Client đồng bộ MCP: bọc các thủ tục
   entitySync.* của server. Mỗi entity tối đa 1 cấu hình sync;
   scheduler server chạy theo cron, runNow chạy tức thì.
   Dùng cùng cơ chế cookie phiên.
   ========================================================== */
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import type { AppRouter } from "@erp-framework/server";

export interface EntitySyncSaveInput {
  entityId: string;
  cronExpr: string;
  enabled?: boolean;
  pkField?: string;
}

export interface EntitySyncRunResult {
  status: "completed" | "error";
  created: number;
  updated: number;
  total: number;
  summary: string;
}

/** Tạo client gọi entitySync.* của server. */
export function createEntitySyncClient(baseUrl: string) {
  const trpc = createTRPCClient<AppRouter>({
    links: [httpBatchLink({
      url: baseUrl.replace(/\/$/, "") + "/trpc",
      fetch: (input, init) => fetch(input, { ...init, credentials: "include" }),
    })],
  });
  return {
    /** Tất cả cấu hình sync của công ty. */
    list: () => trpc.entitySync.list.query(),
    /** Cấu hình sync của một entity (null nếu chưa có). */
    get: (entityId: string) => trpc.entitySync.get.query(entityId),
    /** Tạo / cập nhật cấu hình sync (upsert theo entityId). */
    save: (input: EntitySyncSaveInput) => trpc.entitySync.save.mutate(input),
    /** Xoá cấu hình sync. */
    delete: (id: string) => trpc.entitySync.delete.mutate(id),
    /** Chạy đồng bộ ngay — trả về số bản ghi thêm/cập nhật. */
    runNow: (id: string) => trpc.entitySync.runNow.mutate(id),
  };
}

export type EntitySyncClient = ReturnType<typeof createEntitySyncClient>;
