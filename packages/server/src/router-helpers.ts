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
import { z } from "zod";
import { and, eq, sql, type SQL } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import {
  entities, entityRecords, agentMembers,
} from "@erp-framework/db";
import {
  validateRecord, pluginRegistry, fieldCan,
  type EntityFieldDef, type OnDeleteBehavior, type Role,
} from "@erp-framework/core";
import type { DB } from "./db";
import { encryptSecret, decryptSecret } from "./crypto";

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
  try { return JSON.parse(dec); } catch { return dec; }
}

/** Encrypt field marked `encrypted: true` trước khi insert/update. */
export function encryptDataIn(fields: EntityFieldDef[], data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...data };
  for (const f of fields) {
    if (f.encrypted && f.name in out && out[f.name] != null) {
      out[f.name] = encryptField(out[f.name]);
    }
  }
  return out;
}

/** Decrypt field marked `encrypted: true` trước khi serve. */
export function decryptDataOut(fields: EntityFieldDef[], data: Record<string, unknown>): Record<string, unknown> {
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
  type: z.string(),  // chuỗi tuỳ ý — cho phép cả kiểu do plugin thêm
  required: z.boolean().optional(),
  options: z.array(z.string()).optional(),
  relationEntityId: z.string().optional(),
  formula: z.string().optional(),
  filterable: z.boolean().optional(),
  sortable: z.boolean().optional(),
  id: z.string().optional(),
  ref: z.string().optional(),
});

export const entityInput = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1),
  label: z.string().min(1),
  icon: z.string().optional(),
  fields: z.array(fieldDef),
  // meta: dữ liệu phụ tầng app (mcp, mcpBindings…) — không ràng buộc schema.
  meta: z.record(z.unknown()).optional(),
});

/* Trang / workflow / agent — metadata low-code do designer tạo. */
export const pageInput = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1),
  label: z.string().min(1),
  icon: z.string().optional(),
  content: z.record(z.unknown()).optional(),
});

export const agentInput = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1),
  model: z.string().min(1),
  config: z.record(z.unknown()).optional(),
  // managerId: agent cấp trên (org chart). null = gỡ cấp trên.
  managerId: z.string().uuid().nullable().optional(),
});

export const workflowInput = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1),
  triggerType: z.enum(["manual", "webhook", "cron", "entity_changed"]).optional(),
  graph: z.record(z.unknown()).optional(),
  isActive: z.boolean().optional(),
});

/* Lịch chạy workflow (cron). pg-boss quét bảng schedules mỗi phút. */
export const scheduleInput = z.object({
  id: z.string().uuid().optional(),
  workflowId: z.string().uuid(),
  cronExpr: z.string().min(1),
  enabled: z.boolean().optional(),
});

export const filterOp = z.enum(["=", "!=", ">", ">=", "<", "<=", "contains", "in"]);

export const queryParams = z.object({
  filters: z.record(z.object({ op: filterOp, value: z.unknown() })).optional(),
  sort: z.object({ field: z.string(), dir: z.enum(["asc", "desc"]) }).optional(),
  limit: z.number().int().positive().max(500).optional(),
  offset: z.number().int().nonnegative().optional(),
  /** Full-text search — match @@ trên search_tsv (Postgres). */
  q: z.string().optional(),
}).optional();

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
  if (query?.q && query.q.trim()) {
    conds.push(sql`${entityRecords.searchTsv}::tsvector @@ websearch_to_tsquery('simple', ${query.q.trim()})`);
  }
  for (const [field, cond] of Object.entries(query?.filters ?? {})) {
    const txt = sql`(${entityRecords.data}->>${field})`;
    switch (cond.op) {
      case "=":  conds.push(sql`${txt} = ${String(cond.value)}`); break;
      case "!=": conds.push(sql`${txt} <> ${String(cond.value)}`); break;
      case "contains":
        conds.push(sql`${txt} ILIKE ${"%" + String(cond.value) + "%"}`); break;
      case ">":  conds.push(sql`${txt}::numeric >  ${Number(cond.value)}`); break;
      case ">=": conds.push(sql`${txt}::numeric >= ${Number(cond.value)}`); break;
      case "<":  conds.push(sql`${txt}::numeric <  ${Number(cond.value)}`); break;
      case "<=": conds.push(sql`${txt}::numeric <= ${Number(cond.value)}`); break;
      case "in": {
        const arr = Array.isArray(cond.value) ? cond.value.map(String) : [];
        conds.push(sql`${txt} = ANY(${arr})`);
        break;
      }
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
  const [row] = await db.select({ fields: entities.fields })
    .from(entities)
    .where(and(eq(entities.id, entityId), eq(entities.companyId, companyId)));
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Entity không tồn tại" });
  return (row.fields ?? []) as EntityFieldDef[];
}

/** Ném BAD_REQUEST nếu validate-on-write thất bại. */
export function assertValid(fields: EntityFieldDef[], data: Record<string, unknown>, partial: boolean) {
  const v = validateRecord(fields, data, { partial, registry: pluginRegistry });
  if (!v.ok) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Dữ liệu không hợp lệ — "
        + v.errors.map((e) => `${e.field}: ${e.message}`).join("; "),
    });
  }
  return v.data;
}

/** Quét tất cả entity trong công ty có field lookup/multi-lookup, tìm các
 *  record active đang trỏ tới targetRecordId. */
export async function scanBackRefs(
  db: DB, companyId: string, targetRecordId: string,
): Promise<Array<{
  entityId: string; entityName: string; entityLabel: string;
  fieldKey: string; fieldType: string; count: number; sampleIds: string[];
}>> {
  const ents = await db.select({
    id: entities.id, name: entities.name, label: entities.label,
    fields: entities.fields,
  }).from(entities).where(eq(entities.companyId, companyId));

  const out: Array<{
    entityId: string; entityName: string; entityLabel: string;
    fieldKey: string; fieldType: string; count: number; sampleIds: string[];
  }> = [];

  for (const ent of ents) {
    const fields = (ent.fields ?? []) as Array<{
      name: string; type: string; relationEntityId?: string;
    }>;
    for (const f of fields) {
      if (f.type !== "lookup" && f.type !== "multilookup"
          && f.type !== "multi-lookup" && f.type !== "relation") continue;
      const isMulti = f.type === "multilookup" || f.type === "multi-lookup";
      const filter = isMulti
        ? sql`${entityRecords.data}->${f.name} @> ${JSON.stringify(targetRecordId)}::jsonb`
        : sql`${entityRecords.data}->>${f.name} = ${targetRecordId}`;
      const rows = await db.select({ id: entityRecords.id }).from(entityRecords)
        .where(and(
          eq(entityRecords.companyId, companyId),
          eq(entityRecords.entityId, ent.id),
          sql`${entityRecords.deletedAt} IS NULL`,
          filter,
        ))
        .limit(50);
      if (rows.length > 0) {
        out.push({
          entityId: ent.id, entityName: ent.name, entityLabel: ent.label,
          fieldKey: f.name, fieldType: f.type,
          count: rows.length, sampleIds: rows.slice(0, 5).map((r) => r.id),
        });
      }
    }
  }
  return out;
}

/** Áp dụng hành vi onDelete (restrict/setnull/cascade) cho mọi back-ref.
 *  Default = restrict (an toàn nhất). */
export async function applyCascadeOnDelete(
  db: DB, companyId: string, targetRecordId: string, actorUserId: string,
): Promise<void> {
  const backRefs = await scanBackRefs(db, companyId, targetRecordId);
  if (backRefs.length === 0) return;

  const ents = await db.select({
    id: entities.id, fields: entities.fields,
  }).from(entities).where(eq(entities.companyId, companyId));
  const entFields = new Map(ents.map((e) => [e.id, (e.fields ?? []) as Array<{
    name: string; type: string; onDelete?: OnDeleteBehavior;
  }>]));

  for (const ref of backRefs) {
    const f = entFields.get(ref.entityId)?.find((ff) => ff.name === ref.fieldKey);
    const behavior: OnDeleteBehavior = f?.onDelete ?? "restrict";

    if (behavior === "restrict") {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Không xoá được — còn ${ref.count} record ở "${ref.entityLabel}" trỏ tới (field "${ref.fieldKey}"). Đổi onDelete hoặc xoá các record nguồn trước.`,
      });
    }

    const allRefs = await db.select({
      id: entityRecords.id, data: entityRecords.data, version: entityRecords.version,
    }).from(entityRecords).where(and(
      eq(entityRecords.companyId, companyId),
      eq(entityRecords.entityId, ref.entityId),
      sql`${entityRecords.deletedAt} IS NULL`,
      ref.fieldType === "multilookup" || ref.fieldType === "multi-lookup"
        ? sql`${entityRecords.data}->${ref.fieldKey} @> ${JSON.stringify(targetRecordId)}::jsonb`
        : sql`${entityRecords.data}->>${ref.fieldKey} = ${targetRecordId}`,
    ));

    if (behavior === "setnull") {
      for (const r of allRefs) {
        const data = { ...(r.data as Record<string, unknown>) };
        if (ref.fieldType === "multilookup" || ref.fieldType === "multi-lookup") {
          const arr = (data[ref.fieldKey] as string[] | undefined) ?? [];
          data[ref.fieldKey] = arr.filter((id) => id !== targetRecordId);
        } else {
          data[ref.fieldKey] = null;
        }
        await db.update(entityRecords).set({
          data, version: r.version + 1, updatedAt: new Date(),
        }).where(eq(entityRecords.id, r.id));
      }
    } else if (behavior === "cascade") {
      for (const r of allRefs) {
        await applyCascadeOnDelete(db, companyId, r.id, actorUserId);
        await db.update(entityRecords).set({
          deletedAt: new Date(), updatedAt: new Date(),
        }).where(eq(entityRecords.id, r.id));
      }
    }
  }
}

/** Sinh giá trị sequence atomic per (company, entity, field). */
export async function nextSequence(
  db: DB, companyId: string, entityName: string,
  field: { name: string; sequencePrefix?: string; sequencePadding?: number },
): Promise<string> {
  const [row] = await db.execute(sql`
    INSERT INTO entity_sequences (company_id, entity_name, field_key, next_value)
    VALUES (${companyId}::uuid, ${entityName}, ${field.name}, 2)
    ON CONFLICT (company_id, entity_name, field_key)
    DO UPDATE SET next_value = entity_sequences.next_value + 1, updated_at = now()
    RETURNING next_value - 1 AS used
  `) as unknown as Array<{ used: number }>;
  const used = row?.used ?? 1;
  const pad = field.sequencePadding ?? 0;
  const num = pad > 0 ? String(used).padStart(pad, "0") : String(used);
  return (field.sequencePrefix ?? "") + num;
}

/* ─── RBAC field-level ────────────────────────────────────── */

/** Loại bỏ key user không có quyền GHI (writableBy) trước khi validate. */
export function stripUnwritableFields(
  fields: EntityFieldDef[], data: Record<string, unknown>, role: Role,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    const f = fields.find((ff) => ff.name === k);
    if (!f) { out[k] = v; continue; }
    if (fieldCan(role, "write", f)) out[k] = v;
  }
  return out;
}

/** Loại bỏ key user không có quyền ĐỌC (readableBy) khỏi response. */
export function stripUnreadableFields(
  fields: EntityFieldDef[], data: Record<string, unknown>, role: Role,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    const f = fields.find((ff) => ff.name === k);
    if (!f) { out[k] = v; continue; }
    if (fieldCan(role, "read", f)) out[k] = v;
  }
  return out;
}

/* ─── Validation ─────────────────────────────────────────── */

/** Kiểm unique cho các field đánh `unique: true`. */
export async function assertUnique(
  db: DB, companyId: string, entityId: string, fields: EntityFieldDef[],
  data: Record<string, unknown>, excludeRecordId?: string,
): Promise<void> {
  for (const f of fields) {
    if (!f.unique) continue;
    if (!(f.name in data)) continue;
    const val = data[f.name];
    if (val == null || val === "") continue;
    const dup = await db.select({ id: entityRecords.id }).from(entityRecords)
      .where(and(
        eq(entityRecords.companyId, companyId),
        eq(entityRecords.entityId, entityId),
        sql`${entityRecords.deletedAt} IS NULL`,
        sql`${entityRecords.data}->>${f.name} = ${String(val)}`,
        excludeRecordId ? sql`${entityRecords.id} <> ${excludeRecordId}::uuid` : sql`true`,
      ))
      .limit(1);
    if (dup.length > 0) {
      throw new TRPCError({
        code: "CONFLICT",
        message: `Trùng giá trị unique: field "${f.label || f.name}" đã có record khác`,
      });
    }
  }
}

/* ─── Utility ────────────────────────────────────────────── */

/** Deep equality nông cho JSONB primitive/object. */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null) return a == b;
  if (typeof a !== typeof b) return false;
  if (typeof a !== "object") return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Đọc entity.meta.bindings[op]; trả tên procedure nếu prefix là "proc:". */
export async function resolveProcBinding(
  db: DB, companyId: string, entityId: string,
  op: "list" | "get" | "create" | "update" | "delete",
): Promise<string | null> {
  const [row] = await db.select({ meta: entities.meta }).from(entities)
    .where(and(eq(entities.id, entityId), eq(entities.companyId, companyId)));
  const b = (row?.meta as { bindings?: Record<string, string> } | null)?.bindings?.[op];
  if (!b || typeof b !== "string") return null;
  return b.startsWith("proc:") ? b.slice(5).trim() : null;
}

/** Khi user tạo agent mới: tự động chèn họ vào `agent_members` với role=owner. */
export async function autoAddOwner(db: DB, agentId: string, userId: string): Promise<void> {
  await db.insert(agentMembers).values({
    agentId, userId, role: "owner", addedBy: userId,
  }).onConflictDoNothing();
}
