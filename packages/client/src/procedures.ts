/* ==========================================================
   procedures.ts — Client cho native procedure registry.
   Bọc procedures.* router (list/get/save/setEnabled/delete/invoke/test).
   ========================================================== */
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import type { AppRouter } from "@erp-framework/server";

export interface ProcedureSaveInput {
  name: string;
  label: string;
  description?: string;
  paramsSchema?: Array<Record<string, unknown>>;
  returnSchema?: Record<string, unknown>;
  code: string;
  enabled?: boolean;
}

export interface ProcedureInvokeResult {
  output: unknown;
  logs: string[];
  durationMs: number;
}

export function createProceduresClient(baseUrl: string) {
  const trpc = createTRPCClient<AppRouter>({
    links: [httpBatchLink({
      url: baseUrl.replace(/\/$/, "") + "/trpc",
      fetch: (input, init) => fetch(input, { ...init, credentials: "include" }),
    })],
  });
  return {
    list: () => trpc.procedures.list.query(),
    get: (id: string) => trpc.procedures.get.query(id),
    save: (input: ProcedureSaveInput) => trpc.procedures.save.mutate(input),
    setEnabled: (id: string, enabled: boolean) =>
      trpc.procedures.setEnabled.mutate({ id, enabled }),
    delete: (id: string) => trpc.procedures.delete.mutate(id),
    invoke: (name: string, args?: Record<string, unknown>) =>
      trpc.procedures.invoke.mutate({ name, args }),
    test: (code: string, args?: Record<string, unknown>) =>
      trpc.procedures.test.mutate({ code, args }),
  };
}

export type ProceduresClient = ReturnType<typeof createProceduresClient>;
