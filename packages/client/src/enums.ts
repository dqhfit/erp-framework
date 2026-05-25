/* ==========================================================
   enums.ts — Client cho reusable enum (option set) đa ngôn ngữ.
   Bọc enums.* router (list/get/save/setEnabled/delete).
   ========================================================== */
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import type { AppRouter } from "@erp-framework/server";

export interface EnumValue {
  value: string;
  label: string;
  labelEn?: string;
}

export interface EnumSaveInput {
  name: string;
  label: string;
  labelEn?: string;
  description?: string;
  values: EnumValue[];
  enabled?: boolean;
}

export function createEnumsClient(baseUrl: string) {
  const trpc = createTRPCClient<AppRouter>({
    links: [httpBatchLink({
      url: baseUrl.replace(/\/$/, "") + "/trpc",
      fetch: (input, init) => fetch(input, { ...init, credentials: "include" }),
    })],
  });
  return {
    list: () => trpc.enums.list.query(),
    get: (id: string) => trpc.enums.get.query(id),
    save: (input: EnumSaveInput) => trpc.enums.save.mutate(input),
    setEnabled: (id: string, enabled: boolean) =>
      trpc.enums.setEnabled.mutate({ id, enabled }),
    delete: (id: string) => trpc.enums.delete.mutate(id),
  };
}

export type EnumsClient = ReturnType<typeof createEnumsClient>;
