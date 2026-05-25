/* ==========================================================
   record-comments.ts — Client cho comments per record + replies.
   ========================================================== */
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import type { AppRouter } from "@erp-framework/server";

export interface RecordComment {
  id: string;
  recordId: string;
  parentId: string | null;
  authorUserId: string | null;
  body: string;
  createdAt: string;
}

export function createRecordCommentsClient(baseUrl: string) {
  const trpc = createTRPCClient<AppRouter>({
    links: [httpBatchLink({
      url: baseUrl.replace(/\/$/, "") + "/trpc",
      fetch: (input, init) => fetch(input, { ...init, credentials: "include" }),
    })],
  });
  return {
    list: (recordId: string) => trpc.recordComments.list.query(recordId),
    add: (recordId: string, body: string, parentId?: string) =>
      trpc.recordComments.add.mutate({ recordId, body, parentId }),
    delete: (id: string) => trpc.recordComments.delete.mutate(id),
  };
}

export type RecordCommentsClient = ReturnType<typeof createRecordCommentsClient>;
