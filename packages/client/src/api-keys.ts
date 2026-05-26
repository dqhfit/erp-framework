/* ==========================================================
   api-keys.ts — Client bọc thủ tục apiKeys.* của server.
   REST API key (sk_xxx) cho mobile/external/3rd-party gọi
   /api/v1/entities/:name/* với header X-API-Key + scopes.
   ========================================================== */

import type { AppRouter } from "@erp-framework/server";
import { createTRPCClient, httpBatchLink } from "@trpc/client";

export interface ApiKeyListItem {
  id: string;
  label: string;
  prefix: string;
  clientId: string | null;
  scopes: string[];
  enabled: boolean;
  /** ISO-8601 string (tRPC httpBatchLink serialize Date qua JSON). */
  lastUsedAt: string | null;
  createdAt: string;
}

export interface ApiKeyCreateResult {
  /** UUID row trong api_keys. */
  id: string | undefined;
  /** Plaintext key "sk_<48hex>" — CHỈ trả 1 lần lúc tạo. */
  plaintext: string;
  prefix: string;
  clientId: string;
}

export function createApiKeysClient(baseUrl: string) {
  const trpc = createTRPCClient<AppRouter>({
    links: [
      httpBatchLink({
        url: `${baseUrl.replace(/\/$/, "")}/trpc`,
        fetch: (input, init) => fetch(input, { ...init, credentials: "include" }),
      }),
    ],
  });
  return {
    list: () =>
      trpc.apiKeys.list.query().then(
        (rows) =>
          rows.map((r) => ({
            id: r.id,
            label: r.label,
            prefix: r.prefix,
            clientId: r.clientId,
            scopes: (r.scopes ?? []) as string[],
            enabled: r.enabled,
            lastUsedAt: r.lastUsedAt,
            createdAt: r.createdAt,
          })) as ApiKeyListItem[],
      ),
    create: (label: string, scopes: string[]) =>
      trpc.apiKeys.create.mutate({ label, scopes }) as Promise<ApiKeyCreateResult>,
    /** Update scopes — dùng để sửa key cũ scope=[] thành explicit. */
    updateScopes: (id: string, scopes: string[]) =>
      trpc.apiKeys.updateScopes.mutate({ id, scopes }),
    setEnabled: (id: string, enabled: boolean) => trpc.apiKeys.setEnabled.mutate({ id, enabled }),
    delete: (id: string) => trpc.apiKeys.delete.mutate(id),
  };
}

export type ApiKeysClient = ReturnType<typeof createApiKeysClient>;
