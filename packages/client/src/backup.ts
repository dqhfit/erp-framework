/* ==========================================================
   backup.ts — Client cho module Backup (Google Drive). Bọc
   router backup.* server-side.
   ========================================================== */
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import type { AppRouter } from "@erp-framework/server";

function makeTrpc(baseUrl: string) {
  return createTRPCClient<AppRouter>({
    links: [httpBatchLink({
      url: baseUrl.replace(/\/$/, "") + "/trpc",
      fetch: (input, init) => fetch(input, { ...init, credentials: "include" }),
    })],
  });
}

export interface BackupConfigView {
  gdriveFolderId: string;
  scheduleCron: string | null;
  hasKey: boolean;
  updatedAt: string | Date;
}

export interface BackupRun {
  id: string;
  status: "running" | "done" | "error";
  trigger: "manual" | "cron";
  dbDriveFileId: string | null;
  dbBytes: number | null;
  uploadsSynced: number;
  uploadsSkipped: number;
  uploadsBytes: number;
  error: string | null;
  startedAt: string | Date;
  finishedAt: string | Date | null;
}

export function createBackupClient(baseUrl: string) {
  const trpc = makeTrpc(baseUrl);
  return {
    config: {
      get: () => trpc.backup.config.get.query(),
      save: (input: {
        gdriveFolderId: string;
        keyJson?: string;
        scheduleCron?: string | null;
      }) => trpc.backup.config.save.mutate(input),
      test: (keyJson: string, gdriveFolderId: string) =>
        trpc.backup.config.test.mutate({ keyJson, gdriveFolderId }),
    },
    runNow: () => trpc.backup.runNow.mutate(),
    runs: {
      list: (limit?: number) =>
        trpc.backup.runs.list.query({ limit: limit ?? 10 }),
    },
  };
}

export type BackupClient = ReturnType<typeof createBackupClient>;
