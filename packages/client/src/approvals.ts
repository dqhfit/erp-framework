/* ==========================================================
   approvals.ts — Client governance: bọc các thủ tục
   governance.* của server (phê duyệt nhiều tầng).
   ========================================================== */
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import type { AppRouter } from "@erp-framework/server";

export type ApprovalStatus = "pending" | "approved" | "rejected";

export interface ApprovalCreateInput {
  title: string;
  detail?: string;
  kind?: string;
  requiredApprovals?: number;
}

/** Tạo client gọi governance.* của server. */
export function createApprovalsClient(baseUrl: string) {
  const trpc = createTRPCClient<AppRouter>({
    links: [httpBatchLink({
      url: baseUrl.replace(/\/$/, "") + "/trpc",
      fetch: (input, init) => fetch(input, { ...init, credentials: "include" }),
    })],
  });
  return {
    /** Danh sách yêu cầu phê duyệt (lọc theo trạng thái nếu cần). */
    list: (status?: ApprovalStatus) =>
      trpc.governance.list.query(status ? { status } : undefined),
    /** Tạo một yêu cầu phê duyệt. */
    create: (input: ApprovalCreateInput) =>
      trpc.governance.create.mutate(input),
    /** Duyệt / từ chối một yêu cầu. */
    decide: (id: string, decision: "approve" | "reject", comment?: string) =>
      trpc.governance.decide.mutate({ id, decision, comment }),
  };
}

export type ApprovalsClient = ReturnType<typeof createApprovalsClient>;
