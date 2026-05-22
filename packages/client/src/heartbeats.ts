/* ==========================================================
   heartbeats.ts — Client heartbeat: bọc các thủ tục heartbeats.*
   của server. Heartbeat = agent tự thức dậy theo lịch cron và
   hành động một nhịp. Dùng cùng cơ chế cookie phiên.
   ========================================================== */
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import type { AppRouter } from "@erp-framework/server";

export interface HeartbeatSaveInput {
  id?: string;
  agentId: string;
  cronExpr: string;
  enabled?: boolean;
  prompt: string;
}

/** Tạo client gọi heartbeats.* của server. */
export function createHeartbeatsClient(baseUrl: string) {
  const trpc = createTRPCClient<AppRouter>({
    links: [httpBatchLink({
      url: baseUrl.replace(/\/$/, "") + "/trpc",
      fetch: (input, init) => fetch(input, { ...init, credentials: "include" }),
    })],
  });
  return {
    /** Danh sách heartbeat của công ty (lọc theo agent nếu truyền agentId). */
    list: (agentId?: string) =>
      trpc.heartbeats.list.query(agentId ? { agentId } : undefined),
    /** Tạo / cập nhật một heartbeat. */
    save: (input: HeartbeatSaveInput) => trpc.heartbeats.save.mutate(input),
    /** Xoá heartbeat. */
    delete: (id: string) => trpc.heartbeats.delete.mutate(id),
    /** Chạy thử ngay một nhịp — trả về { status, summary }. */
    runNow: (id: string) => trpc.heartbeats.runNow.mutate(id),
  };
}

export type HeartbeatsClient = ReturnType<typeof createHeartbeatsClient>;
