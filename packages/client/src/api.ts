/* ==========================================================
   ApiDataSource — hiện thực DataSource bằng cách gọi tRPC
   AppRouter của @erp-framework/server. Đây là logic MẠNG nên
   nằm ở @erp-framework/client, KHÔNG ở core (core giữ thuần).
   ========================================================== */

import type {
  DataSource,
  DataSourceMeta,
  DataSourceRow,
  EntityConfig,
  EntityFieldDef,
  EntityRecord,
  FilterOp,
  Paginated,
  QueryParams,
} from "@erp-framework/core/datasource";
import { createTRPCClient, httpBatchLink } from "@trpc/client";

/** Tham số truy vấn nguồn dữ liệu (filter/sort theo key field phẳng). */
export interface DataSourceQueryParams {
  limit?: number;
  offset?: number;
  filters?: Record<string, { op: FilterOp; value: unknown }>;
  sort?: { key: string; dir: "asc" | "desc" };
  q?: string;
}

import type { AppRouter } from "@erp-framework/server";

/* tRPC client — kiểu suy ra từ factory để khỏi phụ thuộc tên type nội bộ. */
function makeClient(baseUrl: string) {
  return createTRPCClient<AppRouter>({
    links: [
      httpBatchLink({
        url: baseUrl.replace(/\/$/, "") + "/trpc",
        // Gửi kèm cookie phiên — RBAC server cần, kể cả khác origin.
        fetch: (input, init) => fetch(input, { ...init, credentials: "include" }),
      }),
    ],
  });
}
type Trpc = ReturnType<typeof makeClient>;

/* Server trả về Drizzle row (shape thô) — map sang DTO bên dưới
   để xử lý lệch null↔undefined và kiểu jsonb. */
interface RawEntity {
  id: string;
  name: string;
  label: string;
  icon: string | null;
  fields: unknown;
}
interface RawRecord {
  id: string;
  entityId: string;
  schemaVersion: string;
  data: unknown;
  createdBy: string | null;
  createdAt: string | Date;
  updatedAt: string | Date;
}

function isoOf(v: string | Date): string {
  return typeof v === "string" ? v : new Date(v).toISOString();
}
function toEntity(r: RawEntity): EntityConfig {
  return {
    id: r.id,
    name: r.name,
    label: r.label,
    icon: r.icon ?? undefined,
    fields: (r.fields ?? []) as EntityFieldDef[],
  };
}
function toRecord(r: RawRecord): EntityRecord {
  return {
    id: r.id,
    entityId: r.entityId,
    schemaVersion: r.schemaVersion,
    data: (r.data ?? {}) as Record<string, unknown>,
    createdBy: r.createdBy ?? undefined,
    createdAt: isoOf(r.createdAt),
    updatedAt: isoOf(r.updatedAt),
  };
}

export class ApiDataSource implements DataSource {
  constructor(private readonly trpc: Trpc) {}

  async listEntities(): Promise<EntityConfig[]> {
    const rows = await this.trpc.entities.list.query();
    return (rows as RawEntity[]).map(toEntity);
  }
  async getEntity(id: string): Promise<EntityConfig | null> {
    const row = await this.trpc.entities.get.query(id);
    return row ? toEntity(row as RawEntity) : null;
  }
  async saveEntity(entity: EntityConfig): Promise<EntityConfig> {
    // id rỗng → bỏ id để server INSERT (zod .uuid() từ chối chuỗi rỗng).
    const { id, ...rest } = entity;
    const row = await this.trpc.entities.save.mutate(id ? entity : rest);
    return toEntity(row as RawEntity);
  }
  async deleteEntity(id: string): Promise<void> {
    await this.trpc.entities.delete.mutate(id);
  }

  /* HYBRID storage (ngoài DataSource interface): nâng entity EAV → bảng thật,
     hoặc rollback. Trả số liệu migrate (xem entity-promote ở server). */
  promoteEntityToTable(id: string) {
    return this.trpc.entities.promoteToTable.mutate(id);
  }
  demoteEntityToEav(id: string) {
    return this.trpc.entities.demoteToEav.mutate(id);
  }
  /** Dọn bản EAV sau khi đã ở bảng thật (verify đếm khớp mới xoá). */
  cleanupEavForEntity(id: string) {
    return this.trpc.entities.cleanupEav.mutate(id) as Promise<{
      deleted: number;
      kept: boolean;
      reason?: string;
    }>;
  }

  async getRecords(entityId: string, query?: QueryParams): Promise<Paginated<EntityRecord>> {
    // Tách includeDeleted ra cấp ngoài (server router nhận như input phẳng).
    const { includeDeleted, ...serverQuery } = query ?? {};
    const res = await this.trpc.records.list.query({
      entityId,
      query: Object.keys(serverQuery).length ? serverQuery : undefined,
      includeDeleted,
    });
    return {
      rows: (res.rows as RawRecord[]).map(toRecord),
      total: res.total,
    };
  }
  /** Tổng hợp cột (sum/avg/count/min/max) SERVER-SIDE trên tập đã lọc (toàn
   *  bảng) — cho footer summary lưới server-paged. Trả map field→giá trị. */
  async aggregateRecords(
    entityId: string,
    opts: {
      query?: QueryParams;
      aggregates: Array<{ field: string; fn: "sum" | "avg" | "count" | "min" | "max" }>;
    },
  ): Promise<Record<string, number>> {
    const { includeDeleted, ...serverQuery } = opts.query ?? {};
    return this.trpc.records.aggregate.query({
      entityId,
      query: Object.keys(serverQuery).length ? serverQuery : undefined,
      includeDeleted,
      aggregates: opts.aggregates,
    }) as Promise<Record<string, number>>;
  }
  /** Bulk delete - cap 1000 ids. Trả {deleted, errors[]}. */
  async bulkDeleteRecords(
    entityId: string,
    ids: string[],
  ): Promise<{
    deleted: number;
    errors: Array<{ id: string; message: string }>;
  }> {
    return this.trpc.records.bulkDelete.mutate({ entityId, ids });
  }
  /** Bulk update - cap 1000. patch áp dụng cho tất cả ids. */
  async bulkUpdateRecords(
    entityId: string,
    ids: string[],
    patch: Record<string, unknown>,
  ): Promise<{ updated: number; errors: Array<{ id: string; message: string }> }> {
    return this.trpc.records.bulkUpdate.mutate({ entityId, ids, patch });
  }
  /** Export records as CSV/JSON. */
  async exportRecords(
    entityId: string,
    format: "csv" | "json",
    query?: QueryParams,
  ): Promise<{ format: "csv" | "json"; content: string }> {
    const { includeDeleted: _, ...serverQuery } = query ?? {};
    const r = await this.trpc.records.export.query({
      entityId,
      format,
      query: Object.keys(serverQuery).length ? serverQuery : undefined,
    });
    return r;
  }
  async getRecord(recordId: string): Promise<EntityRecord | null> {
    const row = await this.trpc.records.get.query(recordId);
    return row ? toRecord(row as RawRecord) : null;
  }
  async createRecord(entityId: string, data: Record<string, unknown>): Promise<EntityRecord> {
    const row = await this.trpc.records.create.mutate({ entityId, data });
    return toRecord(row as RawRecord);
  }
  async updateRecord(
    recordId: string,
    data: Record<string, unknown>,
    expectedVersion?: number,
  ): Promise<EntityRecord> {
    const row = await this.trpc.records.update.mutate({
      recordId,
      data,
      expectedVersion,
    });
    return toRecord(row as RawRecord);
  }
  async deleteRecord(recordId: string): Promise<void> {
    // Soft delete: server set deleted_at; bản ghi vẫn restore được.
    await this.trpc.records.delete.mutate(recordId);
  }

  /* ── Nguồn dữ liệu (DataSource ORM-like): row PHẲNG đã join ── */
  async getDataSourceMeta(dataSourceId: string): Promise<DataSourceMeta> {
    return this.trpc.dataSources.meta.query(dataSourceId) as Promise<DataSourceMeta>;
  }
  async getDataSourceRecords(
    dataSourceId: string,
    query?: DataSourceQueryParams,
  ): Promise<{ rows: DataSourceRow[]; total: number }> {
    return this.trpc.dataSources.listRecords.query({ dataSourceId, query }) as Promise<{
      rows: DataSourceRow[];
      total: number;
    }>;
  }
  async getDataSourceRecord(dataSourceId: string, recordId: string): Promise<DataSourceRow | null> {
    return this.trpc.dataSources.getRecord.query({
      dataSourceId,
      recordId,
    }) as Promise<DataSourceRow | null>;
  }
  async createDataSourceRecord(
    dataSourceId: string,
    data: Record<string, unknown>,
  ): Promise<DataSourceRow | null> {
    return this.trpc.dataSources.createRecord.mutate({
      dataSourceId,
      data,
    }) as Promise<DataSourceRow | null>;
  }
  async updateDataSourceRecord(
    dataSourceId: string,
    recordId: string,
    data: Record<string, unknown>,
    expectedVersion?: number,
  ): Promise<DataSourceRow | null> {
    return this.trpc.dataSources.updateRecord.mutate({
      dataSourceId,
      recordId,
      data,
      expectedVersion,
    }) as Promise<DataSourceRow | null>;
  }
  async deleteDataSourceRecord(dataSourceId: string, recordId: string): Promise<void> {
    await this.trpc.dataSources.deleteRecord.mutate({ dataSourceId, recordId });
  }
  async restoreRecord(recordId: string): Promise<void> {
    await this.trpc.records.restore.mutate(recordId);
  }
  async hardDeleteRecord(recordId: string): Promise<void> {
    await this.trpc.records.hardDelete.mutate(recordId);
  }
  async getRecordHistory(recordId: string): Promise<
    Array<{
      id: string;
      version: number;
      data: Record<string, unknown>;
      diff: Record<string, { old: unknown; new: unknown }>;
      actorUserId: string | null;
      createdAt: string;
    }>
  > {
    const rows = await this.trpc.records.history.query(recordId);
    return (
      rows as Array<{
        id: string;
        version: number;
        data: unknown;
        diff: unknown;
        actorUserId: string | null;
        createdAt: string | Date;
      }>
    ).map((r) => ({
      id: r.id,
      version: r.version,
      data: (r.data ?? {}) as Record<string, unknown>,
      diff: (r.diff ?? {}) as Record<string, { old: unknown; new: unknown }>,
      actorUserId: r.actorUserId,
      createdAt: isoOf(r.createdAt),
    }));
  }
  async revertRecord(recordId: string, targetVersion: number): Promise<EntityRecord> {
    const row = await this.trpc.records.revert.mutate({ recordId, targetVersion });
    return toRecord(row as RawRecord);
  }

  async triggerWorkflow(workflowId: string, context?: unknown): Promise<{ runId: string }> {
    return this.trpc.workflows.trigger.mutate({
      workflowId,
      context: (context as Record<string, unknown> | undefined) ?? undefined,
    });
  }
}

/** Tạo nhanh ApiDataSource từ URL gốc server (vd http://127.0.0.1:8910). */
export function createApiDataSource(baseUrl: string): ApiDataSource {
  return new ApiDataSource(makeClient(baseUrl));
}
