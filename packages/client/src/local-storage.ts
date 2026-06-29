/* ==========================================================
   LocalStorageDataSource — cài đặt DataSource trên localStorage.
   Dùng TẠM trong P1 để frontend chạy độc lập khi backend chưa
   xong. KHÔNG dùng production: dữ liệu chỉ ở trình duyệt.
   ========================================================== */
import type {
  DataSource,
  EntityConfig,
  EntityRecord,
  QueryParams,
  Paginated,
  FilterOp,
} from "@erp-framework/core/datasource";

const K_ENTITIES = "erp-ds-entities";
const K_RECORDS = "erp-ds-records";

function uid(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    "id_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
  );
}
function nowIso(): string {
  return new Date().toISOString();
}
function read<T>(key: string): T[] {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T[]) : [];
  } catch {
    return [];
  }
}
function write<T>(key: string, rows: T[]): void {
  localStorage.setItem(key, JSON.stringify(rows));
}

function matchOp(op: FilterOp, left: unknown, right: unknown): boolean {
  switch (op) {
    case "=":
      return left === right;
    case "!=":
      return left !== right;
    case ">":
      return (left as number) > (right as number);
    case ">=":
      return (left as number) >= (right as number);
    case "<":
      return (left as number) < (right as number);
    case "<=":
      return (left as number) <= (right as number);
    case "contains":
      return String(left ?? "")
        .toLowerCase()
        .includes(String(right ?? "").toLowerCase());
    case "in":
      return Array.isArray(right) && right.includes(left);
    case "is-true":
      return left === true || left === "true";
    case "is-not-true":
      return !(left === true || left === "true");
    case "is-empty":
      return left == null || left === "";
    case "is-not-empty":
      return left != null && left !== "";
    case "between": {
      const arr = Array.isArray(right) ? right : [];
      const s = String(left ?? "");
      if (arr[0] != null && arr[0] !== "" && s < String(arr[0])) return false;
      if (arr[1] != null && arr[1] !== "" && s > String(arr[1])) return false;
      return true;
    }
    default:
      return false;
  }
}

export class LocalStorageDataSource implements DataSource {
  async listEntities(): Promise<EntityConfig[]> {
    return read<EntityConfig>(K_ENTITIES);
  }

  async getEntity(id: string): Promise<EntityConfig | null> {
    return read<EntityConfig>(K_ENTITIES).find((e) => e.id === id) ?? null;
  }

  async saveEntity(entity: EntityConfig): Promise<EntityConfig> {
    const rows = read<EntityConfig>(K_ENTITIES);
    const next: EntityConfig = { ...entity, id: entity.id || uid() };
    const i = rows.findIndex((e) => e.id === next.id);
    if (i >= 0) rows[i] = next;
    else rows.push(next);
    write(K_ENTITIES, rows);
    return next;
  }

  async deleteEntity(id: string): Promise<void> {
    write(
      K_ENTITIES,
      read<EntityConfig>(K_ENTITIES).filter((e) => e.id !== id),
    );
    write(
      K_RECORDS,
      read<EntityRecord>(K_RECORDS).filter((r) => r.entityId !== id),
    );
  }

  async getRecords(entityId: string, query: QueryParams = {}): Promise<Paginated<EntityRecord>> {
    let rows = read<EntityRecord>(K_RECORDS).filter((r) => r.entityId === entityId);

    if (query.filters) {
      for (const [field, cond] of Object.entries(query.filters)) {
        rows = rows.filter((r) => matchOp(cond.op, r.data[field], cond.value));
      }
    }
    if (query.sort) {
      const { field, dir } = query.sort;
      rows = [...rows].sort((a, b) => {
        const av = a.data[field];
        const bv = b.data[field];
        if (av === bv) return 0;
        const cmp = (av as number) > (bv as number) ? 1 : -1;
        return dir === "desc" ? -cmp : cmp;
      });
    }

    const total = rows.length;
    const offset = query.offset ?? 0;
    const limit = query.limit ?? total;
    return { rows: rows.slice(offset, offset + limit), total };
  }

  async getRecord(recordId: string): Promise<EntityRecord | null> {
    return read<EntityRecord>(K_RECORDS).find((r) => r.id === recordId) ?? null;
  }

  async createRecord(entityId: string, data: Record<string, unknown>): Promise<EntityRecord> {
    const rows = read<EntityRecord>(K_RECORDS);
    const rec: EntityRecord = {
      id: uid(),
      entityId,
      schemaVersion: "1",
      data,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    rows.push(rec);
    write(K_RECORDS, rows);
    return rec;
  }

  async updateRecord(recordId: string, data: Record<string, unknown>): Promise<EntityRecord> {
    const rows = read<EntityRecord>(K_RECORDS);
    const i = rows.findIndex((r) => r.id === recordId);
    if (i < 0) throw new Error(`Record không tồn tại: ${recordId}`);
    const cur = rows[i]!;
    const next: EntityRecord = {
      ...cur,
      data: { ...cur.data, ...data },
      updatedAt: nowIso(),
    };
    rows[i] = next;
    write(K_RECORDS, rows);
    return next;
  }

  async deleteRecord(recordId: string): Promise<void> {
    write(
      K_RECORDS,
      read<EntityRecord>(K_RECORDS).filter((r) => r.id !== recordId),
    );
  }

  async triggerWorkflow(): Promise<{ runId: string }> {
    throw new Error(
      "triggerWorkflow chưa hỗ trợ ở LocalStorageDataSource — cần ApiDataSource (P3).",
    );
  }
}
