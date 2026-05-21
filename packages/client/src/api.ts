/* ==========================================================
   ApiDataSource — hiện thực DataSource bằng cách gọi tRPC
   AppRouter của @erp-framework/server. Đây là logic MẠNG nên
   nằm ở @erp-framework/client, KHÔNG ở core (core giữ thuần).
   ========================================================== */
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import type {
  DataSource, EntityConfig, EntityFieldDef, EntityRecord,
  QueryParams, Paginated,
} from "@erp-framework/core/datasource";
import type { AppRouter } from "@erp-framework/server";

/* tRPC client — kiểu suy ra từ factory để khỏi phụ thuộc tên type nội bộ. */
function makeClient(baseUrl: string) {
  return createTRPCClient<AppRouter>({
    links: [httpBatchLink({
      url: baseUrl.replace(/\/$/, "") + "/trpc",
      // Gửi kèm cookie phiên — RBAC server cần, kể cả khác origin.
      fetch: (input, init) => fetch(input, { ...init, credentials: "include" }),
    })],
  });
}
type Trpc = ReturnType<typeof makeClient>;

/* Server trả về Drizzle row (shape thô) — map sang DTO bên dưới
   để xử lý lệch null↔undefined và kiểu jsonb. */
interface RawEntity {
  id: string; name: string; label: string;
  icon: string | null; fields: unknown;
}
interface RawRecord {
  id: string; entityId: string; schemaVersion: string;
  data: unknown; createdBy: string | null;
  createdAt: string | Date; updatedAt: string | Date;
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

  async getRecords(
    entityId: string,
    query?: QueryParams,
  ): Promise<Paginated<EntityRecord>> {
    const res = await this.trpc.records.list.query({ entityId, query });
    return {
      rows: (res.rows as RawRecord[]).map(toRecord),
      total: res.total,
    };
  }
  async getRecord(recordId: string): Promise<EntityRecord | null> {
    const row = await this.trpc.records.get.query(recordId);
    return row ? toRecord(row as RawRecord) : null;
  }
  async createRecord(
    entityId: string,
    data: Record<string, unknown>,
  ): Promise<EntityRecord> {
    const row = await this.trpc.records.create.mutate({ entityId, data });
    return toRecord(row as RawRecord);
  }
  async updateRecord(
    recordId: string,
    data: Record<string, unknown>,
  ): Promise<EntityRecord> {
    const row = await this.trpc.records.update.mutate({ recordId, data });
    return toRecord(row as RawRecord);
  }
  async deleteRecord(recordId: string): Promise<void> {
    await this.trpc.records.delete.mutate(recordId);
  }

  async triggerWorkflow(
    workflowId: string,
    context?: unknown,
  ): Promise<{ runId: string }> {
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
