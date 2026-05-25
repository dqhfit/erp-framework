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

/** AI sinh draft Danh mục từ mô tả tiếng Việt. Trả về form đã điền sẵn. */
export interface EnumAiDraft {
  name: string;
  label: string;
  labelEn?: string;
  description?: string;
  values: EnumValue[];
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
    /** AI sinh draft từ mô tả tiếng Việt — gọi xong client preview rồi save. */
    generateAi: (prompt: string, hintCount?: number) =>
      trpc.enums.generateAi.mutate({ prompt, hintCount }) as unknown as Promise<EnumAiDraft>,
  };
}

export type EnumsClient = ReturnType<typeof createEnumsClient>;
