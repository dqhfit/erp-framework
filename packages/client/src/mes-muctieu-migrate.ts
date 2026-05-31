/* mes-muctieu-migrate.ts — Client cho tRPC mesMucTieuMigrate.* */

import type { AppRouter } from "@erp-framework/server";
import { createTRPCClient, httpBatchLink } from "@trpc/client";

export interface MssqlMonthItem {
  nam: number;
  thang: number;
  ma_bo_phan: string;
  so_muc_thuong: number;
}

export interface MigratePreview {
  header: number;
  chitiet: number;
}

export interface MigrateResult {
  ok: boolean;
  headersUpserted: number;
  chitietUpserted: number;
}

export interface RelatedForm {
  id: string;
  sourceCode: string;
  name: string | null;
  winId: string | null;
  portStatus: string;
  module: string | null;
}

export function createMesMucTieuMigrateClient(baseUrl: string) {
  const trpc = createTRPCClient<AppRouter>({
    links: [
      httpBatchLink({
        url: baseUrl.replace(/\/$/, "") + "/trpc",
        fetch: (input, init) => fetch(input, { ...init, credentials: "include" }),
      }),
    ],
  });

  return {
    listAvailable: () => trpc.mesMucTieuMigrate.listAvailable.query() as Promise<MssqlMonthItem[]>,
    preview: (nam: number, thang: number, maBoPhan: string) =>
      trpc.mesMucTieuMigrate.preview.query({ nam, thang, maBoPhan }) as Promise<MigratePreview>,
    migrateMonth: (nam: number, thang: number, maBoPhan: string) =>
      trpc.mesMucTieuMigrate.migrateMonth.mutate({
        nam,
        thang,
        maBoPhan,
      }) as Promise<MigrateResult>,
    markPorted: (sourceCode: string) => trpc.mesMucTieuMigrate.markPorted.mutate({ sourceCode }),
    listRelatedForms: () =>
      trpc.mesMucTieuMigrate.listRelatedForms.query() as Promise<RelatedForm[]>,
  };
}

export type MesMucTieuMigrateClient = ReturnType<typeof createMesMucTieuMigrateClient>;
