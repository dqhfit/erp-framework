/* ==========================================================
   procedures.ts — Client cho native procedure registry.
   Bọc procedures.* router (list/get/save/setEnabled/delete/invoke/test).
   ========================================================== */

import type { AppRouter } from "@erp-framework/server";
import { createTRPCClient, httpBatchLink } from "@trpc/client";

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

/** AI sinh draft Thủ tục từ mô tả tiếng Việt. */
export interface ProcedureAiDraft {
  name: string;
  label: string;
  description?: string;
  paramsSchema: Array<Record<string, unknown>>;
  code: string;
}

export function createProceduresClient(baseUrl: string) {
  const trpc = createTRPCClient<AppRouter>({
    links: [
      httpBatchLink({
        url: baseUrl.replace(/\/$/, "") + "/trpc",
        fetch: (input, init) => fetch(input, { ...init, credentials: "include" }),
      }),
    ],
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
    /** Gọi proc Tier D đã port (module-procs) — cho nút Duyệt/nghiệp vụ. */
    invokeModule: (name: string, args?: Record<string, unknown>) =>
      trpc.procedures.invokeModule.mutate({ name, args }) as Promise<{
        output: unknown;
        durationMs: number;
      }>,
    test: (code: string, args?: Record<string, unknown>) =>
      trpc.procedures.test.mutate({ code, args }),
    /** AI sinh draft procedure từ mô tả tiếng Việt. */
    generateAi: (prompt: string) =>
      trpc.procedures.generateAi.mutate({ prompt }) as unknown as Promise<ProcedureAiDraft>,
  };
}

export type ProceduresClient = ReturnType<typeof createProceduresClient>;
