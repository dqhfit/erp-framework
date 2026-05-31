/* ==========================================================
   print-templates.ts — Client wrapper cho tRPC printTemplates.*.
   Engine in PDF: scaffold template từ report, render preview HTML.
   PDF/HTML thật xuất qua route GET /print/:id (mở tab).
   ========================================================== */

import type { AppRouter } from "@erp-framework/server";
import { createTRPCClient, httpBatchLink } from "@trpc/client";

export interface PrintTemplateSummary {
  id: string;
  name: string;
  label: string;
  reportClass: string | null;
  dataProcedure: string | null;
  pageSize: string;
  orientation: string;
  updatedAt: string;
}

export function createPrintTemplatesClient(baseUrl: string) {
  const trpc = createTRPCClient<AppRouter>({
    links: [
      httpBatchLink({
        url: baseUrl.replace(/\/$/, "") + "/trpc",
        fetch: (input, init) => fetch(input, { ...init, credentials: "include" }),
      }),
    ],
  });
  return {
    list: () => trpc.printTemplates.list.query() as Promise<PrintTemplateSummary[]>,
    get: (id: string) => trpc.printTemplates.get.query({ id }),
    save: (input: {
      id?: string;
      name: string;
      label: string;
      reportClass?: string;
      dataProcedure?: string;
      html?: string;
      pageSize?: string;
      orientation?: "portrait" | "landscape";
    }) => trpc.printTemplates.save.mutate(input) as Promise<{ id: string }>,
    delete: (id: string) => trpc.printTemplates.delete.mutate({ id }) as Promise<{ ok: true }>,
    /** Scaffold template từ report blueprint → upsert, trả id. */
    scaffoldFromReport: (reportClass: string) =>
      trpc.printTemplates.scaffoldFromReport.mutate({ reportClass }) as Promise<{
        id: string;
        name: string;
        label: string;
      }>,
    /** Render preview HTML (data mẫu rỗng, không cần proc). */
    renderPreview: (id: string, sampleRows?: Array<Record<string, unknown>>) =>
      trpc.printTemplates.renderPreview.query({ id, sampleRows }) as Promise<{ html: string }>,
    /** URL route in trực tiếp (mở tab) — format html|pdf. */
    printUrl: (id: string, format: "html" | "pdf" = "html") =>
      `${baseUrl.replace(/\/$/, "")}/print/${id}?format=${format}`,
  };
}

export type PrintTemplatesClient = ReturnType<typeof createPrintTemplatesClient>;
