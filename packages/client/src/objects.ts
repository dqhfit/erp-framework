/* ==========================================================
   objects.ts — Client cho metadata low-code: entities / pages /
   workflows / agents. Bọc router cùng tên của @erp-framework/server.
   App dùng client này để thay localStorage bằng PostgreSQL.
   ========================================================== */
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import type { AppRouter } from "@erp-framework/server";

function makeTrpc(baseUrl: string) {
  return createTRPCClient<AppRouter>({
    links: [httpBatchLink({
      url: baseUrl.replace(/\/$/, "") + "/trpc",
      // Gửi kèm cookie phiên — RBAC server cần.
      fetch: (input, init) => fetch(input, { ...init, credentials: "include" }),
    })],
  });
}

/* ─── Input shapes (khớp zod input của router) ───────────── */
/* Field shape — khớp fieldDef của router. id/ref là khoá phụ tầng
   app, khai báo tường minh để field round-trip nguyên vẹn. */
export interface EntityFieldInput {
  name: string;
  label: string;
  type: string;
  required?: boolean;
  options?: string[];
  relationEntityId?: string;
  formula?: string;
  filterable?: boolean;
  sortable?: boolean;
  id?: string;
  ref?: string;
}
export interface EntitySaveInput {
  id?: string;
  name: string;
  label: string;
  icon?: string;
  fields: EntityFieldInput[];
  meta?: Record<string, unknown>;
}
export interface PageSaveInput {
  id?: string;
  name: string;
  label: string;
  icon?: string;
  content?: Record<string, unknown>;
}
export interface AgentSaveInput {
  id?: string;
  name: string;
  model: string;
  config?: Record<string, unknown>;
}
export interface WorkflowSaveInput {
  id?: string;
  name: string;
  triggerType?: "manual" | "webhook" | "cron" | "entity_changed";
  graph?: Record<string, unknown>;
  isActive?: boolean;
}
export interface ScheduleSaveInput {
  id?: string;
  workflowId: string;
  cronExpr: string;
  enabled?: boolean;
}

/** Tạo client CRUD cho 4 loại đối tượng low-code. */
export function createObjectsClient(baseUrl: string) {
  const trpc = makeTrpc(baseUrl);
  return {
    entities: {
      list: () => trpc.entities.list.query(),
      get: (id: string) => trpc.entities.get.query(id),
      save: (input: EntitySaveInput) => trpc.entities.save.mutate(input),
      delete: (id: string) => trpc.entities.delete.mutate(id),
    },
    pages: {
      list: () => trpc.pages.list.query(),
      get: (id: string) => trpc.pages.get.query(id),
      save: (input: PageSaveInput) => trpc.pages.save.mutate(input),
      delete: (id: string) => trpc.pages.delete.mutate(id),
    },
    workflows: {
      list: () => trpc.workflows.list.query(),
      get: (id: string) => trpc.workflows.get.query(id),
      save: (input: WorkflowSaveInput) => trpc.workflows.save.mutate(input),
      delete: (id: string) => trpc.workflows.delete.mutate(id),
      // Publish: chốt bản nháp graph → publishedGraph (runner chạy bản này).
      publish: (id: string) => trpc.workflows.publish.mutate(id),
      // Chạy workflow THẬT phía server (gọi MCP/LLM thật, ghi workflow_runs).
      trigger: (workflowId: string, context?: Record<string, unknown>) =>
        trpc.workflows.trigger.mutate({ workflowId, context }),
      // Lịch sử các lần chạy gần đây (gồm steps).
      runs: (workflowId: string) => trpc.workflows.runs.query(workflowId),
    },
    agents: {
      list: () => trpc.agents.list.query(),
      get: (id: string) => trpc.agents.get.query(id),
      save: (input: AgentSaveInput) => trpc.agents.save.mutate(input),
      delete: (id: string) => trpc.agents.delete.mutate(id),
    },
    schedules: {
      list: () => trpc.schedules.list.query(),
      save: (input: ScheduleSaveInput) => trpc.schedules.save.mutate(input),
      delete: (id: string) => trpc.schedules.delete.mutate(id),
    },
    activity: {
      list: () => trpc.activity.list.query(),
      clear: () => trpc.activity.clear.mutate(),
    },
    budget: {
      get: () => trpc.budget.get.query(),
      save: (monthlyUsd: number) => trpc.budget.save.mutate({ monthlyUsd }),
    },
    transfer: {
      export: () => trpc.transfer.export.query(),
      import: (bundle: {
        entities?: Record<string, unknown>[];
        pages?: Record<string, unknown>[];
        workflows?: Record<string, unknown>[];
        agents?: Record<string, unknown>[];
      }) => trpc.transfer.import.mutate(bundle),
    },
  };
}

export type ObjectsClient = ReturnType<typeof createObjectsClient>;
