/* ==========================================================
   objects.ts — Client cho metadata low-code: entities / pages /
   workflows / agents. Bọc router cùng tên của @erp-framework/server.
   App dùng client này để thay localStorage bằng PostgreSQL.
   ========================================================== */

import type { DataSourceConfig, FilterOp } from "@erp-framework/core";
import type { AppRouter } from "@erp-framework/server";
import { createTRPCClient, httpBatchLink } from "@trpc/client";

function makeTrpc(baseUrl: string) {
  return createTRPCClient<AppRouter>({
    links: [
      httpBatchLink({
        url: baseUrl.replace(/\/$/, "") + "/trpc",
        // Gửi kèm cookie phiên — RBAC server cần.
        fetch: (input, init) => fetch(input, { ...init, credentials: "include" }),
      }),
    ],
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
  fkField?: string;
  defaultVisible?: boolean;
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
  /** Manager-agent (org chart). null = gỡ cấp trên. */
  managerId?: string | null;
}

/** Role per cặp (user × agent) — quyết định quyền khi agent isPrivate. */
export type AgentMemberRole = "owner" | "operator" | "observer";

export interface AgentMemberRow {
  userId: string;
  role: AgentMemberRole;
  addedBy: string | null;
  addedAt: Date | string;
  userName: string | null;
  userEmail: string | null;
}
export interface WorkflowSaveInput {
  id?: string;
  name: string;
  triggerType?: "manual" | "webhook" | "cron" | "entity_changed" | "iot_telemetry";
  /** Filter trigger (vd {deviceId, channel} cho iot_telemetry). */
  triggerConfig?: Record<string, unknown>;
  graph?: Record<string, unknown>;
  isActive?: boolean;
}
export interface ScheduleSaveInput {
  id?: string;
  workflowId: string;
  cronExpr: string;
  enabled?: boolean;
}
export interface DataSourceSaveInput {
  id?: string;
  name: string;
  label: string;
  icon?: string;
  config: DataSourceConfig;
}
export interface DataSourceQuery {
  limit?: number;
  offset?: number;
  filters?: Record<string, { op: FilterOp; value: unknown }>;
  sort?: { key: string; dir: "asc" | "desc" };
  q?: string;
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
      /** Bật/tắt cho agent tra cứu entity qua records_search (Agentic RAG). */
      setAgentSearchable: (entityId: string, enabled: boolean) =>
        trpc.entities.setAgentSearchable.mutate({ entityId, enabled }),
    },
    pages: {
      list: () => trpc.pages.list.query(),
      get: (id: string) => trpc.pages.get.query(id),
      save: (input: PageSaveInput) => trpc.pages.save.mutate(input),
      delete: (id: string) => trpc.pages.delete.mutate(id),
      publish: (id: string, mode: "private" | "public") => trpc.pages.publish.mutate({ id, mode }),
      unpublish: (id: string) => trpc.pages.unpublish.mutate(id),
      getPublic: (id: string) => trpc.pages.getPublic.query(id),
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
      // Tiếp tục run đang chờ duyệt (node approval): đặt quyết định rồi chạy
      // tiếp từ checkpoint (node đã chạy không lặp lại).
      resumeApproval: (runId: string, nodeId: string, decision: "approved" | "rejected") =>
        trpc.workflows.resumeApproval.mutate({ runId, nodeId, decision }),
      // Template gallery: thư viện workflow dựng sẵn.
      listTemplates: () => trpc.workflows.listTemplates.query(),
      instantiateTemplate: (templateId: string) =>
        trpc.workflows.instantiateTemplate.mutate({ templateId }),
      applyTemplate: (workflowId: string, templateId: string) =>
        trpc.workflows.applyTemplate.mutate({ workflowId, templateId }),
      // Guardrails: bài học từ node fail lặp lại (Loops!-style).
      guardrails: {
        list: (workflowId: string) => trpc.workflows.guardrails.list.query(workflowId),
        update: (id: string, lesson: string) =>
          trpc.workflows.guardrails.update.mutate({ id, lesson }),
        archive: (id: string) => trpc.workflows.guardrails.archive.mutate(id),
      },
    },
    agents: {
      list: () => trpc.agents.list.query(),
      get: (id: string) => trpc.agents.get.query(id),
      save: (input: AgentSaveInput) => trpc.agents.save.mutate(input),
      delete: (id: string) => trpc.agents.delete.mutate(id),
      // 7 template memory mặc định cho UI dùng làm "Khôi phục mặc định".
      memoryTemplates: (id: string) => trpc.agents.memoryTemplates.query(id),
      // ── Membership (N:M) ──
      /** Trả về primaryAgentId + danh sách agentId user đang là member. */
      myAgents: () => trpc.agents.myAgents.query(),
      /** Đặt agent chính của user (null = bỏ chọn). */
      setPrimary: (agentId: string | null) => trpc.agents.setPrimary.mutate({ agentId }),
      /** Liệt kê thành viên của 1 agent. */
      listMembers: (agentId: string) => trpc.agents.listMembers.query(agentId),
      /** Thêm hoặc đổi role 1 thành viên. */
      addMember: (input: { agentId: string; userId: string; role: AgentMemberRole }) =>
        trpc.agents.addMember.mutate(input),
      /** Gỡ 1 thành viên. */
      removeMember: (input: { agentId: string; userId: string }) =>
        trpc.agents.removeMember.mutate(input),
      /** Danh sách 38 template agent theo phòng ban (dữ liệu tĩnh server). */
      listTemplates: () => trpc.agents.listTemplates.query(),
      /** Tạo agent mới từ template vào company của user. */
      instantiateTemplate: (templateId: string) =>
        trpc.agents.instantiateTemplate.mutate({ templateId }),
      /** Ghi đè systemPrompt/tools/temperature/model của agent theo template mới nhất (giữ memory). */
      applyTemplate: (agentId: string, templateId: string) =>
        trpc.agents.applyTemplate.mutate({ agentId, templateId }),
    },
    schedules: {
      list: () => trpc.schedules.list.query(),
      save: (input: ScheduleSaveInput) => trpc.schedules.save.mutate(input),
      delete: (id: string) => trpc.schedules.delete.mutate(id),
    },
    dataSources: {
      list: () => trpc.dataSources.list.query(),
      get: (id: string) => trpc.dataSources.get.query(id),
      save: (input: DataSourceSaveInput) => trpc.dataSources.save.mutate(input),
      delete: (id: string) => trpc.dataSources.delete.mutate(id),
      /** Field phẳng đã chiếu (cho widget render). */
      meta: (id: string) => trpc.dataSources.meta.query(id),
      /** Đọc dữ liệu joined (bảng phẳng). */
      listRecords: (dataSourceId: string, query?: DataSourceQuery) =>
        trpc.dataSources.listRecords.query({ dataSourceId, query }),
      /** Chạy thử 1 config tuỳ ý (chưa lưu) — cho editor SQL "chạy vùng chọn". */
      preview: (config: DataSourceConfig, query?: DataSourceQuery) =>
        trpc.dataSources.preview.query({ config, query }),
      getRecord: (dataSourceId: string, recordId: string) =>
        trpc.dataSources.getRecord.query({ dataSourceId, recordId }),
      createRecord: (dataSourceId: string, data: Record<string, unknown>) =>
        trpc.dataSources.createRecord.mutate({ dataSourceId, data }),
      updateRecord: (
        dataSourceId: string,
        recordId: string,
        data: Record<string, unknown>,
        expectedVersion?: number,
      ) => trpc.dataSources.updateRecord.mutate({ dataSourceId, recordId, data, expectedVersion }),
      deleteRecord: (dataSourceId: string, recordId: string) =>
        trpc.dataSources.deleteRecord.mutate({ dataSourceId, recordId }),
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
    preferences: {
      load: () => trpc.preferences.load.query(),
      save: (prefs: Record<string, unknown>) => trpc.preferences.save.mutate(prefs),
    },
    viewerGroups: {
      list: () => trpc.viewerGroups.list.query(),
      create: (name: string, color?: string) => trpc.viewerGroups.create.mutate({ name, color }),
      rename: (id: string, name: string, color?: string) =>
        trpc.viewerGroups.rename.mutate({ id, name, color }),
      delete: (id: string) => trpc.viewerGroups.delete.mutate(id),
      setMembers: (groupId: string, userIds: string[]) =>
        trpc.viewerGroups.setMembers.mutate({ groupId, userIds }),
      setPageGroups: (pageId: string, groupIds: string[]) =>
        trpc.viewerGroups.setPageGroups.mutate({ pageId, groupIds }),
      getMyGroups: () => trpc.viewerGroups.getMyGroups.query(),
    },
  };
}

export type ObjectsClient = ReturnType<typeof createObjectsClient>;
