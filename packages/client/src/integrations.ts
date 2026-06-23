/* ==========================================================
   integrations.ts — Client cho router integrations.* (SearXNG web search).
   ========================================================== */

import type { AppRouter } from "@erp-framework/server";
import { createTRPCClient, httpBatchLink } from "@trpc/client";

function makeTrpc(baseUrl: string) {
  return createTRPCClient<AppRouter>({
    links: [
      httpBatchLink({
        url: baseUrl.replace(/\/$/, "") + "/trpc",
        fetch: (input, init) => fetch(input, { ...init, credentials: "include" }),
      }),
    ],
  });
}

export interface WebSearchConfigView {
  configured: boolean;
  source: "company" | "env" | "default";
  endpointMasked: string;
}

export function createIntegrationsClient(baseUrl: string) {
  const trpc = makeTrpc(baseUrl);
  return {
    webSearch: {
      get: () => trpc.integrations.webSearch.get.query(),
      save: (url: string) => trpc.integrations.webSearch.save.mutate({ url }),
      test: (url?: string) => trpc.integrations.webSearch.test.mutate(url ? { url } : {}),
    },
  };
}

export type IntegrationsClient = ReturnType<typeof createIntegrationsClient>;
