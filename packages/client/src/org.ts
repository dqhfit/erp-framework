/* ==========================================================
   org.ts — Client org chart: đọc danh sách agent và gán agent
   cấp trên (managerId) để dựng sơ đồ phân cấp agent.
   Dùng lại agents.list / agents.save của server.
   ========================================================== */
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import type { AppRouter } from "@erp-framework/server";

/** Tạo client org chart. */
export function createOrgClient(baseUrl: string) {
  const trpc = createTRPCClient<AppRouter>({
    links: [httpBatchLink({
      url: baseUrl.replace(/\/$/, "") + "/trpc",
      fetch: (input, init) => fetch(input, { ...init, credentials: "include" }),
    })],
  });
  return {
    /** Danh sách agent của công ty (kèm managerId để dựng cây). */
    listAgents: () => trpc.agents.list.query(),
    /** Gán / gỡ agent cấp trên. managerId = null để gỡ. */
    setManager: (
      agent: { id: string; name: string; model: string },
      managerId: string | null,
    ) => trpc.agents.save.mutate({
      id: agent.id, name: agent.name, model: agent.model, managerId,
    }),
  };
}

export type OrgClient = ReturnType<typeof createOrgClient>;
