/* ==========================================================
   saved-views.ts — Client cho saved views per entity per user.
   ========================================================== */
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import type { AppRouter } from "@erp-framework/server";

export interface SavedView {
  id: string;
  name: string;
  entityId: string;
  query: Record<string, unknown>;
  columns: string[] | null;
  isDefault: boolean;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SavedViewSaveInput {
  id?: string;
  entityId: string;
  name: string;
  query?: Record<string, unknown>;
  columns?: string[];
  isDefault?: boolean;
}

export function createSavedViewsClient(baseUrl: string) {
  const trpc = createTRPCClient<AppRouter>({
    links: [httpBatchLink({
      url: baseUrl.replace(/\/$/, "") + "/trpc",
      fetch: (input, init) => fetch(input, { ...init, credentials: "include" }),
    })],
  });
  return {
    list: (entityId: string) => trpc.savedViews.list.query(entityId),
    save: (input: SavedViewSaveInput) => trpc.savedViews.save.mutate(input),
    setDefault: (id: string, entityId: string) =>
      trpc.savedViews.setDefault.mutate({ id, entityId }),
    delete: (id: string) => trpc.savedViews.delete.mutate(id),
  };
}

export type SavedViewsClient = ReturnType<typeof createSavedViewsClient>;
