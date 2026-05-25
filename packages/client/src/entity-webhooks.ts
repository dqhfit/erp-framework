/* ==========================================================
   entity-webhooks.ts — Client CRUD cho outgoing entity webhooks.
   ========================================================== */
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import type { AppRouter } from "@erp-framework/server";

export interface EntityWebhook {
  id: string;
  entityId: string;
  name: string;
  url: string;
  events: string[];
  headers: Record<string, string> | null;
  secret: string | null;
  enabled: boolean;
  lastFiredAt: string | null;
  lastStatus: number | null;
}

export interface EntityWebhookSaveInput {
  id?: string;
  entityId: string;
  name: string;
  url: string;
  events?: Array<"create" | "update" | "delete">;
  headers?: Record<string, string>;
  secret?: string;
  enabled?: boolean;
}

export function createEntityWebhooksClient(baseUrl: string) {
  const trpc = createTRPCClient<AppRouter>({
    links: [httpBatchLink({
      url: baseUrl.replace(/\/$/, "") + "/trpc",
      fetch: (input, init) => fetch(input, { ...init, credentials: "include" }),
    })],
  });
  return {
    list: (entityId: string) => trpc.entityWebhooks.list.query(entityId),
    save: (input: EntityWebhookSaveInput) => trpc.entityWebhooks.save.mutate(input),
    delete: (id: string) => trpc.entityWebhooks.delete.mutate(id),
  };
}

export type EntityWebhooksClient = ReturnType<typeof createEntityWebhooksClient>;
