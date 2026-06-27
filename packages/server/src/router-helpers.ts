/* ==========================================================
   router-helpers.ts — Shared helpers cho các sub-router (records,
   entities, workflows, agents, …). Trước đây inline trong router.ts
   2289 dòng — tách ra để mỗi sub-router có thể import độc lập.

   Phân nhóm:
   - Crypto: encrypt/decrypt field marked `encrypted: true`
   - Zod schemas: input validators dùng chung (fieldDef, entityInput, …)
   - DB query helpers: buildRecordWhere, loadEntityFields, scanBackRefs, …
   - RBAC: stripUnreadableFields, stripUnwritableFields
   - Validation: assertValid, assertUnique
   - Utility: deepEqual, resolveProcBinding, autoAddOwner, nextSequence
   ========================================================== */

import {
  type EntityFieldDef,
  fieldCan,
  type OnDeleteBehavior,
  pluginRegistry,
  type Role,
  validateRecord,
} from "@erp-framework/core";
import { entities, entityRecords, userViewerGroups } from "@erp-framework/db";
import { TRPCError } from "@trpc/server";
import { and, eq, type SQL, sql } from "drizzle-orm";
import { z } from "zod";
import { decryptSecret, encryptSecret } from "./crypto";
import type { DB } from "./db";
import { assertIdent, type EntityStorage } from "./entity-table-ddl";
import type { RecordStore } from "./record-store";
import { upsertResourceMember } from "./resource-acl";

/* ─── Crypto helpers ─────────────────────────────────────── */

/** Tag để phân biệt giá trị đã encrypt với plaintext cũ. Decrypt thử nhiều
 *  format để backward-compat (legacy chưa encrypt vẫn đọc được). */
export const ENC_PREFIX = "enc:v1:";

export function encryptField(plain: unknown): string {
  if (plain == null) return "";
  const s = typeof plain === "string" ? plain : JSON.stringify(plain);
  return ENC_PREFIX + encryptSecret(s);
}

export function decryptField(v: unknown): unknown {
  if (typeof v !== "string") return v;
  if (!v.startsWith(ENC_PREFIX)) return v; // plaintext legacy
  const dec = decryptSecret(v.slice(ENC_PREFIX.length));
  try {
    return JSON.parse(dec);
  } catch {
    return dec;
  }
}

/** Encrypt field marked `encrypted: true` trước khi insert/update. */
export function encryptDataIn(
  fields: EntityFieldDef[],
  data: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...data };
  for (const f of fields) {
    if (f.encrypted && f.name in out && out[f.name] != null) {
      out[f.name] = encryptField(out[f.name]);
    }
  }
  return out;
}

/** Decrypt field marked `encrypted: true` trước khi serve. */
export function decryptDataOut(
  fields: EntityFieldDef[],
  data: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...data };
  for (const f of fields) {
    if (f.encrypted && f.name in out) {
      out[f.name] = decryptField(out[f.name]);
    }
  }
  return out;
}

/* ─── Zod schemas (input validators) ─────────────────────── */

/* Khoá phụ tầng app (id field, ref lookup) khai báo TƯỜNG MINH để
   field round-trip nguyên vẹn — KHÔNG dùng .passthrough() vì nó
   thêm index-signature vào kiểu suy luận, làm vỡ ApiDataSource
   (EntityFieldDef không có index-signature). */
export const fieldDef = z.object({
  name: z.string(),
  label: z.string(),
  labelEn: z.string().optional(),
  type: z.string(), // chuỗi tuỳ ý — cho phép cả kiểu do plugin thêm
  required: z.boolean().optional(),
  options: z.array(z.string()).optional(),
  relationEntityId: z.string().optional(),
  formula: z.string().optional(),
  filterable: z.boolean().optional(),
  sortable: z.boolean().optional(),
  id: z.string().optional(),
  ref: z.string().optional(),
  enumId: z.string().optional(),
  onDelete: z.enum(["restrict", "setnull", "cascade"]).optional(),
  searchable: z.boolean().optional(),
  unique: z.boolean().optional(),
  readableBy: z.array(z.enum(["admin", "editor", "viewer"])).optional(),
  writableBy: z.array(z.enum(["admin", "editor", "viewer"])).optional(),
  readableByGroups: z.array(z.string()).optional(),
  writableByGroups: z.array(z.string()).optional(),
  readableByUsers: z.array(z.string()).optional(),
  writableByUsers: z.array(z.string()).optional(),
  sequencePrefix: z.string().optional(),
  sequencePadding: z.number().int().optional(),
  format: z.record(z.string(), z.unknown()).optional(),
  // collection field: childEntityId lưu qua `ref`, FK field name lưu qua `fkField`
  fkField: z.string().optional(),
  defaultVisible: z.boolean().optional(),
});

export const entityInput = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1),
  label: z.string().min(1),
  icon: z.string().optional(),
  fields: z.array(fieldDef),
  // meta: dữ liệu phụ tầng app (mcp, mcpBindings…) — không ràng buộc schema.
  meta: z.record(z.string(), z.unknown()).optional(),
});

/* Trang / workflow / agent — metadata low-code do designer tạo. */
export const pageInput = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1),
  label: z.string().min(1),
  icon: z.string().optional(),
  content: z.union([z.array(z.unknown()), z.record(z.string(), z.unknown())]).optional(),
});

export const agentInput = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1),
  model: z.string().min(1),
  config: z.record(z.string(), z.unknown()).optional(),
  // managerId: agent cấp trên (org chart). null = gỡ cấp trên.
  managerId: z.string().uuid().nullable().optional(),
});

export const workflowInput = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1),
  triggerType: z.enum(["manual", "webhook", "cron", "entity_changed", "iot_telemetry"]).optional(),
  /* Cấu hình filter riêng cho từng triggerType (vd {deviceId, channel} cho
     iot_telemetry). Mỗi triggerType tự quy ước schema con. */
  triggerConfig: z.record(z.string(), z.unknown()).optional(),
  graph: z.record(z.string(), z.unknown()).optional(),
  isActive: z.boolean().optional(),
});

/* Lịch chạy workflow (cron). pg-boss quét bảng schedules mỗi phút. */
export const scheduleInput = z.object({
  id: z.string().uuid().optional(),
  workflowId: z.string().uuid(),
  cronExpr: z.string().min(1),
  enabled: z.boolean().optional(),
});

export const filterOp = z.enum([
  "=",
  "!=",
  ">",
  ">=",
  "<",
  "<=",
  "contains",
  "in",
  "is-not-true",
  "is-true",
  "is-empty",
  "is-not-empty",
  "between",
]);

export const queryParams = z
  .object({
    filters: z.record(z.string(), z.object({ op: filterOp, value: z.unknown() })).optional(),
    sort: z.object({ field: z.string(), dir: z.enum(["asc", "desc"]) }).optional(),
    limit: z.number().int().positive().max(10_000).optional(),
    offset: z.number().int().nonnegative().optional(),
    /** Full-text search — match @@ trên search_tsv (Postgres). */
    q: z.string().optional(),
  })
  .optional();

export type QueryParamsInput = z.infer<typeof queryParams>;

/* ─── DB query helpers ───────────────────────────────────── */

/* Dựng WHERE cho record động. Toán tử khoảng cần expression
   index mới nhanh — xem UPGRADE-PLAN 3.5.
   - includeDeleted=false (mặc định): chỉ lấy record active (deleted_at IS NULL).
   - includeDeleted=true: lấy hết để UI hiện tab "Đã xoá". */
export function buildRecordWhere(
  companyId: string,
  entityId: string,
  query: QueryParamsInput,
  includeDeleted: boolean = false,
): SQL | undefined {
  const conds: SQL[] = [
    eq(entityRecords.companyId, companyId),
    eq(entityRecords.entityId, entityId),
  ];
  if (!includeDeleted) {
    conds.push(sql`${entityRecords.deletedAt} IS NULL`);
  }
  if (query?.q?.trim()) {
    conds.push(
      sql`${entityRecords.searchTsv}::tsvector @@ websearch_to_tsquery('simple', ${query.q.trim()})`,
    );
  }
  for (const [field, cond] of Object.entries(query?.filters ?? {})) {
    const txt = sql`(${entityRecords.data}->>${field})`;
    switch (cond.op) {
      case "=":
        conds.push(sql`${txt} = ${String(cond.value)}`);
        break;
      case "!=":
        conds.push(sql`${txt} <> ${String(cond.value)}`);
        break;
      case "contains":
        conds.push(sql`${txt} ILIKE ${`%${String(cond.value)}%`}`);
        break;
      case ">":
        conds.push(sql`${txt}::numeric >  ${Number(cond.value)}`);
        break;
      case ">=":
        conds.push(sql`${txt}::numeric >= ${Number(cond.value)}`);
        break;
      case "<":
        conds.push(sql`${txt}::numeric <  ${Number(cond.value)}`);
        break;
      case "<=":
        conds.push(sql`${txt}::numeric <= ${Number(cond.value)}`);
        break;
      case "in": {
        const arr = Array.isArray(cond.value) ? cond.value.map(String) : [];
        conds.push(sql`${txt} = ANY(${arr})`);
        break;
      }
      case "is-not-true":
        // NULL-safe: NULL và 'false' đều khớp (khác với '!=' bỏ qua NULL)
        conds.push(sql`COALESCE(${txt}, 'false') <> 'true'`);
        break;
      case "is-true":
        conds.push(sql`COALESCE(${txt}, 'false') = 'true'`);
        break;
    }
  }
  return and(...conds);
}

/** Nạp định nghĩa field của một entity (trong phạm vi công ty).
   Ném NOT_FOUND nếu entity vắng hoặc thuộc công ty khác. */
export async function loadEntityFields(
  db: DB,
  companyId: string,
  entityId: string,
): Promise<EntityFieldDef[]> {
  const [row] = await db
    .select({ fields: entities.fields })
    .from(entities)
    .where(and(eq(entities.id, entityId), eq(entities.companyId, companyId)));
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Entity không tồn tại" });
  return (row.fields ?? []) as EntityFieldDef[];
}

/** Ném BAD_REQUEST nếu validate-on-write thất bại. */
export function assertValid(
  fields: EntityFieldDef[],
  data: Record<string, unknown>,
  partial: boolean,
) {
  const v = validateRecord(fields, data, { partial, registry: pluginRegistry });
  if (!v.ok) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Dữ liệu không hợp lệ — ${v.errors.map((e) => `${e.field}: ${e.message}`).join("; ")}`,
    });
  }
  return v.data;
}

/** storage (tier='table') từ entities.meta, hoặc null nếu entity còn EAV. */
function storageOfMeta(meta: unknown): EntityStorage | null {
  const s = (meta as { storage?: EntityStorage } | null)?.storage;
  return s?.tier === "table" ? s : null;
}

/** Field type có phải lookup/relation? + có phải multi (đa-trị, lưu ở ext). */
function lookupKind(t: string): { lookup: boolean; multi: boolean } {
  const multi = t === "multilookup" || t === "multi-lookup";
  return { lookup: multi || t === "lookup" || t === "relation", multi };
}

/** Id các record active của 1 entity đang trỏ tới targetRecordId qua field.
 *  Backend-aware: entity tier='table' → quét bảng er_ (cột FK / ext); else EAV. */
async function refRecordIds(
  db: DB,
  companyId: string,
  entityId: string,
  storage: EntityStorage | null,
  fieldName: string,
  isMulti: boolean,
  targetRecordId: string,
  limit: number,
): Promise<string[]> {
  if (storage) {
    const tbl = sql.raw(`"${assertIdent(storage.tableName)}"`);
    const col = storage.columns[fieldName]?.col;
    const cond = isMulti
      ? sql`ext->${fieldName} @> ${JSON.stringify(targetRecordId)}::jsonb`
      : col
        ? sql`(${sql.raw(`"${assertIdent(col)}"`)})::text = ${targetRecordId}`
        : sql`ext->>${fieldName} = ${targetRecordId}`;
    const rows = (await db.execute(
      sql`SELECT id FROM ${tbl} WHERE company_id = ${companyId}::uuid AND deleted_at IS NULL AND ${cond} LIMIT ${limit}`,
    )) as unknown as Array<{ id: string }>;
    return rows.map((r) => r.id);
  }
  const cond = isMulti
    ? sql`${entityRecords.data}->${fieldName} @> ${JSON.stringify(targetRecordId)}::jsonb`
    : sql`${entityRecords.data}->>${fieldName} = ${targetRecordId}`;
  const rows = await db
    .select({ id: entityRecords.id })
    .from(entityRecords)
    .where(
      and(
        eq(entityRecords.companyId, companyId),
        eq(entityRecords.entityId, entityId),
        sql`${entityRecords.deletedAt} IS NULL`,
        cond,
      ),
    )
    .limit(limit);
  return rows.map((r) => r.id);
}

/** Quét tất cả entity trong công ty có field lookup/multi-lookup, tìm các
 *  record active đang trỏ tới targetRecordId. Backend-aware (EAV + bảng thật). */
export async function scanBackRefs(
  db: DB,
  companyId: string,
  targetRecordId: string,
): Promise<
  Array<{
    entityId: string;
    entityName: string;
    entityLabel: string;
    fieldKey: string;
    fieldType: string;
    count: number;
    sampleIds: string[];
  }>
> {
  const ents = await db
    .select({
      id: entities.id,
      name: entities.name,
      label: entities.label,
      fields: entities.fields,
      meta: entities.meta,
    })
    .from(entities)
    .where(eq(entities.companyId, companyId));

  const out: Array<{
    entityId: string;
    entityName: string;
    entityLabel: string;
    fieldKey: string;
    fieldType: string;
    count: number;
    sampleIds: string[];
  }> = [];

  for (const ent of ents) {
    const storage = storageOfMeta(ent.meta);
    const fields = (ent.fields ?? []) as Array<{ name: string; type: string }>;
    for (const f of fields) {
      const { lookup, multi } = lookupKind(f.type);
      if (!lookup) continue;
      const ids = await refRecordIds(
        db,
        companyId,
        ent.id,
        storage,
        f.name,
        multi,
        targetRecordId,
        50,
      );
      if (ids.length > 0) {
        out.push({
          entityId: ent.id,
          entityName: ent.name,
          entityLabel: ent.label,
          fieldKey: f.name,
          fieldType: f.type,
          count: ids.length,
          sampleIds: ids.slice(0, 5),
        });
      }
    }
  }
  return out;
}

/** Áp dụng hành vi onDelete (restrict/setnull/cascade) cho mọi back-ref.
 *  Default = restrict (an toàn nhất). Detection backend-aware; GHI qua `store`
 *  (dispatch EAV/bảng thật) nên không cần biết backend ở đây. */
export async function applyCascadeOnDelete(
  db: DB,
  store: RecordStore,
  companyId: string,
  targetRecordId: string,
  actorUserId: string,
): Promise<void> {
  const backRefs = await scanBackRefs(db, companyId, targetRecordId);
  if (backRefs.length === 0) return;

  const ents = await db
    .select({ id: entities.id, fields: entities.fields, meta: entities.meta })
    .from(entities)
    .where(eq(entities.companyId, companyId));
  const entFields = new Map(
    ents.map((e) => [
      e.id,
      (e.fields ?? []) as Array<{ name: string; type: string; onDelete?: OnDeleteBehavior }>,
    ]),
  );
  const entStorage = new Map(ents.map((e) => [e.id, storageOfMeta(e.meta)]));

  for (const ref of backRefs) {
    const f = entFields.get(ref.entityId)?.find((ff) => ff.name === ref.fieldKey);
    const behavior: OnDeleteBehavior = f?.onDelete ?? "restrict";

    if (behavior === "restrict") {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Không xoá được — còn ${ref.count} record ở "${ref.entityLabel}" trỏ tới (field "${ref.fieldKey}"). Đổi onDelete hoặc xoá các record nguồn trước.`,
      });
    }

    const { multi } = lookupKind(ref.fieldType);
    const ids = await refRecordIds(
      db,
      companyId,
      ref.entityId,
      entStorage.get(ref.entityId) ?? null,
      ref.fieldKey,
      multi,
      targetRecordId,
      10_000,
    );

    if (behavior === "setnull") {
      for (const id of ids) {
        const rec = await store.getById(companyId, id);
        if (!rec) continue;
        const data = rec.data as Record<string, unknown>;
        const newVal = multi
          ? ((data[ref.fieldKey] as string[] | undefined) ?? []).filter((x) => x !== targetRecordId)
          : null;
        await store.merge(companyId, id, { [ref.fieldKey]: newVal }, rec.version + 1);
      }
    } else if (behavior === "cascade") {
      for (const id of ids) {
        await applyCascadeOnDelete(db, store, companyId, id, actorUserId);
        await store.softDelete(companyId, id);
      }
    }
  }
}

/** Sinh giá trị sequence atomic per (company, entity, field). */
export async function nextSequence(
  db: DB,
  companyId: string,
  entityName: string,
  field: { name: string; sequencePrefix?: string; sequencePadding?: number },
): Promise<string> {
  const [row] = (await db.execute(sql`
    INSERT INTO entity_sequences (company_id, entity_name, field_key, next_value)
    VALUES (${companyId}::uuid, ${entityName}, ${field.name}, 2)
    ON CONFLICT (company_id, entity_name, field_key)
    DO UPDATE SET next_value = entity_sequences.next_value + 1, updated_at = now()
    RETURNING next_value - 1 AS used
  `)) as unknown as Array<{ used: number }>;
  const used = row?.used ?? 1;
  const pad = field.sequencePadding ?? 0;
  const num = pad > 0 ? String(used).padStart(pad, "0") : String(used);
  return (field.sequencePrefix ?? "") + num;
}

/* ─── RBAC field-level ────────────────────────────────────── */

/** Cache nhóm của user (60s) — group membership đổi hiếm, tránh 1 query
 *  phụ trên MỌI records.list/update. Đổi nhóm có hiệu lực trễ tối đa 60s. */
const groupIdsCache = new Map<string, { ids: string[]; exp: number }>();

/** Nạp danh sách viewer-group ids của user (cho fieldCan tầng nhóm). */
export async function loadUserGroupIds(db: DB, userId: string): Promise<string[]> {
  const hit = groupIdsCache.get(userId);
  if (hit && hit.exp > Date.now()) return hit.ids;
  const rows = await db
    .select({ g: userViewerGroups.groupId })
    .from(userViewerGroups)
    .where(eq(userViewerGroups.userId, userId));
  const ids = rows.map((r) => r.g);
  groupIdsCache.set(userId, { ids, exp: Date.now() + 60_000 });
  return ids;
}

/** Loại bỏ key user không có quyền GHI (writableBy + writableByGroups + writableByUsers). */
export function stripUnwritableFields(
  fields: EntityFieldDef[],
  data: Record<string, unknown>,
  role: Role,
  groupIds: string[] = [],
  userId?: string,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    const f = fields.find((ff) => ff.name === k);
    if (!f) {
      out[k] = v;
      continue;
    }
    if (fieldCan(role, "write", f, groupIds, userId)) out[k] = v;
  }
  return out;
}

/** Loại bỏ key user không có quyền ĐỌC (readableBy + readableByGroups + readableByUsers). */
export function stripUnreadableFields(
  fields: EntityFieldDef[],
  data: Record<string, unknown>,
  role: Role,
  groupIds: string[] = [],
  userId?: string,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    const f = fields.find((ff) => ff.name === k);
    if (!f) {
      out[k] = v;
      continue;
    }
    if (fieldCan(role, "read", f, groupIds, userId)) out[k] = v;
  }
  return out;
}

/* ─── Validation ─────────────────────────────────────────── */

/** Khi lưu record có field boolean `uniqueTrue: true` bằng true → clear
 *  field đó trên mọi record khác cùng entity+company (chỉ 1 được true).
 *  Đọc danh sách field từ `entity.meta.uniqueTrueFields` (string[]).
 *  Hỗ trợ cả tier EAV (ext trên entity_records) lẫn bảng thật (ext cột). */
export async function clearUniqueTrueFields(
  db: DB,
  companyId: string,
  entityId: string,
  recordId: string,
  data: Record<string, unknown>,
): Promise<void> {
  const [ent] = await db
    .select({ meta: entities.meta, name: entities.name })
    .from(entities)
    .where(eq(entities.id, entityId));
  if (!ent) return;
  const uniqueTrueFields: string[] =
    ((ent.meta as Record<string, unknown>)?.uniqueTrueFields as string[]) ?? [];
  if (uniqueTrueFields.length === 0) return;

  // Lấy tableName từ meta.storage nếu tier=table
  const storage = (ent.meta as Record<string, unknown>)?.storage as EntityStorage | undefined;
  const tableName = storage?.tableName;

  for (const fieldName of uniqueTrueFields) {
    if (data[fieldName] !== true) continue;
    if (tableName) {
      // Bảng thật: update ext trực tiếp — 1 câu SQL, nhanh
      await db.execute(
        sql`UPDATE ${sql.raw(
          `"${assertIdent(tableName)}"`,
        )} SET ext = ext || ${JSON.stringify({ [fieldName]: false })}::jsonb
          WHERE company_id = ${companyId}::uuid
            AND id != ${recordId}::uuid
            AND (ext->>${fieldName}) = 'true'`,
      );
    } else {
      // EAV: update ext trên entity_records
      await db.execute(
        sql`UPDATE entity_records
            SET ext = ext || ${JSON.stringify({ [fieldName]: false })}::jsonb
          WHERE company_id = ${companyId}::uuid
            AND entity_id = ${entityId}::uuid
            AND id != ${recordId}::uuid
            AND (ext->>${fieldName}) = 'true'`,
      );
    }
  }
}

/** Kiểm unique cho các field đánh `unique: true`. Đi qua RecordStore →
 *  dispatch đúng backend (EAV `entity_records` hoặc bảng thật `er_<id>`). */
export async function assertUnique(
  store: RecordStore,
  companyId: string,
  entityId: string,
  fields: EntityFieldDef[],
  data: Record<string, unknown>,
  excludeRecordId?: string,
): Promise<void> {
  for (const f of fields) {
    if (!f.unique) continue;
    if (!(f.name in data)) continue;
    const val = data[f.name];
    if (val == null || val === "") continue;
    const dup = await store.existsWithFieldValue(
      companyId,
      entityId,
      f.name,
      String(val),
      excludeRecordId,
    );
    if (dup) {
      throw new TRPCError({
        code: "CONFLICT",
        message: `Trùng giá trị unique: field "${f.label || f.name}" đã có record khác`,
      });
    }
  }
}

/* ─── Utility ────────────────────────────────────────────── */

/** Deep equality nông cho JSONB primitive/object. null/undefined coi như
 *  nhau (JSONB không phân biệt). */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  const aNullish = a === null || a === undefined;
  const bNullish = b === null || b === undefined;
  if (aNullish || bNullish) return aNullish && bNullish;
  if (typeof a !== typeof b) return false;
  if (typeof a !== "object") return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Đọc entity.meta.bindings[op]; trả tên procedure nếu prefix là "proc:". */
export async function resolveProcBinding(
  db: DB,
  companyId: string,
  entityId: string,
  op: "list" | "get" | "create" | "update" | "delete",
): Promise<string | null> {
  const [row] = await db
    .select({ meta: entities.meta })
    .from(entities)
    .where(and(eq(entities.id, entityId), eq(entities.companyId, companyId)));
  const b = (row?.meta as { bindings?: Record<string, string> } | null)?.bindings?.[op];
  if (!b || typeof b !== "string") return null;
  return b.startsWith("proc:") ? b.slice(5).trim() : null;
}

/** Khi user tạo agent mới: tự động chèn họ vào resource_members với role=owner. */
export async function autoAddOwner(db: DB, agentId: string, userId: string): Promise<void> {
  await upsertResourceMember(db, "agent", agentId, userId, "owner", userId);
}
