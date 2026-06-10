/* ==========================================================
   errors.ts — Client SDK cho errors.* router.
   - report: app tự gửi lỗi runtime về (mọi user đã duyệt).
   - list/get/setStatus/delete/clearResolved/stats: admin theo dõi.
   ========================================================== */

import type { AppRouter } from "@erp-framework/server";
import { createTRPCClient, httpBatchLink } from "@trpc/client";

export type ClientErrorLevel = "error" | "warn";
export type ClientErrorStatus = "open" | "resolved" | "ignored";
export type ClientErrorSource =
  | "window.onerror"
  | "unhandledrejection"
  | "react"
  | "manual"
  | "unknown";

export interface ErrorReportInput {
  message: string;
  stack?: string;
  componentStack?: string;
  source?: ClientErrorSource;
  level?: ClientErrorLevel;
  url?: string;
  userAgent?: string;
  meta?: Record<string, unknown>;
}

export interface ErrorListItem {
  id: string;
  level: ClientErrorLevel;
  source: string;
  message: string;
  url: string | null;
  status: ClientErrorStatus;
  count: number;
  userId: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
}

export interface ErrorDetail extends ErrorListItem {
  fingerprint: string;
  stack: string | null;
  componentStack: string | null;
  userAgent: string | null;
  meta: Record<string, unknown> | null;
  companyId: string;
  createdAt: string;
  updatedAt: string;
}

export interface ErrorStats {
  open: number;
  resolved: number;
  ignored: number;
  total: number;
}

export function createErrorsClient(baseUrl: string) {
  const trpc = createTRPCClient<AppRouter>({
    links: [
      httpBatchLink({
        url: baseUrl.replace(/\/$/, "") + "/trpc",
        fetch: (input, init) => fetch(input, { ...init, credentials: "include" }),
      }),
    ],
  });
  return {
    /** App gửi 1 lỗi về server (fail-safe — caller nuốt lỗi network). */
    report: (input: ErrorReportInput) =>
      trpc.errors.report.mutate(input) as unknown as Promise<{ ok: boolean }>,
    list: (filters?: {
      status?: ClientErrorStatus;
      level?: ClientErrorLevel;
      q?: string;
      limit?: number;
    }) => trpc.errors.list.query(filters) as unknown as Promise<ErrorListItem[]>,
    get: (id: string) => trpc.errors.get.query(id) as unknown as Promise<ErrorDetail>,
    setStatus: (input: { ids: string[]; status: ClientErrorStatus }) =>
      trpc.errors.setStatus.mutate(input) as unknown as Promise<{ ok: boolean; updated: number }>,
    delete: (input: { ids: string[] }) =>
      trpc.errors.delete.mutate(input) as unknown as Promise<{ ok: boolean; deleted: number }>,
    clearResolved: () =>
      trpc.errors.clearResolved.mutate() as unknown as Promise<{ ok: boolean; deleted: number }>,
    stats: () => trpc.errors.stats.query() as unknown as Promise<ErrorStats>,
  };
}

export type ErrorsClient = ReturnType<typeof createErrorsClient>;
