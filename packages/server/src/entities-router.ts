/* ==========================================================
   entities-router.ts — CRUD metadata entity (low-code designer).
   Tách khỏi router.ts (Sprint 1 P2.8 step 3).
   ========================================================== */
import { z } from "zod";
import { and, eq, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { entities, entityRecords } from "@erp-framework/db";
import { validateRecord, pluginRegistry, type EntityFieldDef } from "@erp-framework/core";
import { router, rbacProcedure } from "./trpc";
import { entityInput } from "./router-helpers";
import {
  applyFieldChange,
  ensureEntityTable,
  type EntityStorage,
  renameFieldOnTable,
  searchableFields,
  syncEntityTableSchema,
} from "./entity-table-ddl";
import { demoteEntityToEav, promoteEntityToTable } from "./entity-promote";
import { isHybridTablesEnabled } from "./record-store";

export const entitiesRouter = router({
  list: rbacProcedure("view", "entity").query(({ ctx }) =>
    ctx.db.select().from(entities).where(eq(entities.companyId, ctx.user.companyId)),
  ),

  get: rbacProcedure("view", "entity")
    .input(z.string().uuid())
    .query(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .select()
        .from(entities)
        .where(and(eq(entities.id, input), eq(entities.companyId, ctx.user.companyId)));
      return row ?? null;
    }),

  // Upsert: id do client cấp → INSERT nếu chưa có, UPDATE nếu đã có
  // (chỉ trong phạm vi công ty — id của công ty khác bị từ chối).
  save: rbacProcedure("edit", "entity")
    .input(entityInput)
    .mutation(async ({ ctx, input }) => {
      // Chuẩn hoá tên: trim khoảng trắng thừa (tránh "order" vs "order ").
      const name = input.name.trim();
      if (!name) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Tên entity không được để trống." });
      }
      const values = {
        name,
        label: input.label,
        icon: input.icon ?? null,
        fields: input.fields,
        ...(input.meta !== undefined ? { meta: input.meta } : {}),
      };
      // Khi bật HYBRID: entity MỚI → tạo bảng thật er_<id> + ghi meta.storage.
      // (Cờ tắt = bỏ qua, entity dùng EAV như cũ — hành vi không đổi.)
      const finishNew = async (row: typeof entities.$inferSelect | undefined) => {
        if (!row || !isHybridTablesEnabled()) return row;
        const storage = await ensureEntityTable(ctx.db, row.id, input.fields as EntityFieldDef[]);
        const meta = { ...((row.meta ?? {}) as Record<string, unknown>), storage };
        const [updated] = await ctx.db
          .update(entities)
          .set({ meta, updatedAt: new Date() })
          .where(eq(entities.id, row.id))
          .returning();
        return updated ?? row;
      };
      // Chống trùng lặp: tìm entity cùng tên (case-insensitive, đã trim) trong
      // công ty. Nếu là entity KHÁC (id khác) → báo lỗi thân thiện thay vì để
      // DB ném "duplicate key" thô. DB unique (company_id, name) vẫn là backstop
      // chống race exact-match.
      const [dup] = await ctx.db
        .select({ id: entities.id, name: entities.name })
        .from(entities)
        .where(
          and(
            eq(entities.companyId, ctx.user.companyId),
            sql`lower(${entities.name}) = lower(${name})`,
          ),
        );
      if (dup && dup.id !== input.id) {
        throw new TRPCError({
          code: "CONFLICT",
          message: `Đã có entity tên "${dup.name}" trong công ty — chọn tên khác.`,
        });
      }
      if (input.id) {
        const [ex] = await ctx.db
          .select({ companyId: entities.companyId, meta: entities.meta })
          .from(entities)
          .where(eq(entities.id, input.id));
        if (ex && ex.companyId !== ctx.user.companyId) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Đối tượng thuộc công ty khác" });
        }
        if (ex) {
          const [row] = await ctx.db
            .update(entities)
            .set({ ...values, updatedAt: new Date() })
            .where(eq(entities.id, input.id))
            .returning();
          // Entity tier='table' → đồng bộ cột (ADD/DROP field) + ghi meta.storage mới.
          const oldStorage = (ex.meta as { storage?: EntityStorage } | null)?.storage;
          if (row && oldStorage?.tier === "table") {
            const next = await syncEntityTableSchema(
              ctx.db,
              oldStorage,
              input.fields as EntityFieldDef[],
            );
            const meta = { ...((row.meta ?? {}) as Record<string, unknown>), storage: next };
            const [r2] = await ctx.db
              .update(entities)
              .set({ meta, updatedAt: new Date() })
              .where(eq(entities.id, input.id))
              .returning();
            return r2 ?? row;
          }
          return row;
        }
        const [row] = await ctx.db
          .insert(entities)
          .values({ id: input.id, companyId: ctx.user.companyId, ...values })
          .returning();
        return finishNew(row);
      }
      const [row] = await ctx.db
        .insert(entities)
        .values({ companyId: ctx.user.companyId, ...values })
        .returning();
      return finishNew(row);
    }),

  delete: rbacProcedure("delete", "entity")
    .input(z.string().uuid())
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .delete(entities)
        .where(and(eq(entities.id, input), eq(entities.companyId, ctx.user.companyId)));
    }),

  /* Bật/tắt cho phép agent tra cứu entity này qua tool records_search
     (Agentic RAG P3). Lưu cờ vào meta.agentSearchable — deny-by-default:
     tắt = agent KHÔNG truy được. Merge meta (không ghi đè key khác). */
  setAgentSearchable: rbacProcedure("edit", "entity")
    .input(z.object({ entityId: z.string().uuid(), enabled: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .select({ meta: entities.meta })
        .from(entities)
        .where(and(eq(entities.id, input.entityId), eq(entities.companyId, ctx.user.companyId)));
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Không tìm thấy entity." });
      const meta = {
        ...((row.meta ?? {}) as Record<string, unknown>),
        agentSearchable: input.enabled,
      };
      await ctx.db
        .update(entities)
        .set({ meta, updatedAt: new Date() })
        .where(and(eq(entities.id, input.entityId), eq(entities.companyId, ctx.user.companyId)));
      return { ok: true, agentSearchable: input.enabled };
    }),

  /* Nâng cấp entity từ EAV sang bảng thật (HYBRID Phase 2). Tạo bảng er_<id>,
     copy mọi record (giữ id + cột hệ thống + ext), ghi locator, flip meta.storage.
     Yêu cầu ERP_HYBRID_TABLES=1. Trả số liệu migrate + lỗi từng record. */
  promoteToTable: rbacProcedure("edit", "entity")
    .input(z.string().uuid())
    .mutation(({ ctx, input }) => promoteEntityToTable(ctx.db, ctx.user.companyId, input)),

  /* Rollback: bảng thật → EAV. Copy er_<id> ngược vào entity_records, xoá
     meta.storage + locator + DROP bảng er_. Chạy khi cờ HYBRID còn bật. */
  demoteToEav: rbacProcedure("edit", "entity")
    .input(z.string().uuid())
    .mutation(({ ctx, input }) => demoteEntityToEav(ctx.db, ctx.user.companyId, input)),

  /* Safe field rename — cập nhật entities.fields[].name + di trú
       data: jsonb_set new key từ old key + xoá old key. Atomic per-row,
       không transaction lớn (giữ unblocked). */
  renameField: rbacProcedure("edit", "entity")
    .input(
      z.object({
        entityId: z.string().uuid(),
        oldKey: z.string().min(1),
        newKey: z.string().regex(/^[a-z_][a-z0-9_]*$/i, "newKey phải là identifier (chữ/số/_)"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [ent] = await ctx.db
        .select()
        .from(entities)
        .where(and(eq(entities.id, input.entityId), eq(entities.companyId, ctx.user.companyId)));
      if (!ent) throw new TRPCError({ code: "NOT_FOUND", message: "Entity không tồn tại" });
      const fields = (ent.fields ?? []) as EntityFieldDef[];
      if (!fields.find((f) => f.name === input.oldKey)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `Field "${input.oldKey}" không có` });
      }
      if (fields.find((f) => f.name === input.newKey)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `Field "${input.newKey}" đã tồn tại` });
      }
      // Update fields[] — đổi name.
      const newFields = fields.map((f) =>
        f.name === input.oldKey ? { ...f, name: input.newKey } : f,
      );
      // Entity tier='table': đổi key map (cột) / đổi key trong ext jsonb — KHÔNG
      // đụng entity_records (record sống ở bảng thật).
      const storage = (ent.meta as { storage?: EntityStorage } | null)?.storage;
      if (storage?.tier === "table") {
        const next = await renameFieldOnTable(ctx.db, storage, input.oldKey, input.newKey);
        next.searchable = searchableFields(newFields); // đổi tên field searchable → cập nhật
        const meta = { ...((ent.meta ?? {}) as Record<string, unknown>), storage: next };
        await ctx.db
          .update(entities)
          .set({ fields: newFields, meta, updatedAt: new Date() })
          .where(eq(entities.id, input.entityId));
        return { ok: true, migrated: newFields };
      }
      await ctx.db
        .update(entities)
        .set({ fields: newFields, updatedAt: new Date() })
        .where(eq(entities.id, input.entityId));
      // Migrate data (EAV): di chuyển value từ old key sang new key trong mỗi record.
      // jsonb_set(jsonb #- '{oldKey}', '{newKey}', data->'oldKey')
      await ctx.db.execute(sql`
          UPDATE entity_records SET
            data = jsonb_set(data - ${input.oldKey}, ARRAY[${input.newKey}],
              COALESCE(data->${input.oldKey}, 'null'::jsonb)),
            updated_at = now()
          WHERE entity_id = ${input.entityId}::uuid
            AND company_id = ${ctx.user.companyId}::uuid
            AND data ? ${input.oldKey}
        `);
      return { ok: true, migrated: newFields };
    }),

  /* Field type change — load record, coerce mỗi giá trị field qua
       validate. Báo cáo errors[] cho record không coerce được. v1 sửa
       record OK + skip lỗi (user xem rồi quyết định). */
  changeFieldType: rbacProcedure("edit", "entity")
    .input(
      z.object({
        entityId: z.string().uuid(),
        fieldName: z.string().min(1),
        newType: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [ent] = await ctx.db
        .select()
        .from(entities)
        .where(and(eq(entities.id, input.entityId), eq(entities.companyId, ctx.user.companyId)));
      if (!ent) throw new TRPCError({ code: "NOT_FOUND", message: "Entity không tồn tại" });
      const fields = (ent.fields ?? []) as EntityFieldDef[];
      const oldField = fields.find((f) => f.name === input.fieldName);
      if (!oldField) throw new TRPCError({ code: "BAD_REQUEST", message: "Field không có" });
      const newField: EntityFieldDef = { ...oldField, type: input.newType };
      // Entity tier='table': đổi pgType / chuyển column↔ext qua DDL (best-effort
      // cast). KHÔNG coerce per-record kiểu EAV (record ở bảng thật).
      const tblStorage = (ent.meta as { storage?: EntityStorage } | null)?.storage;
      if (tblStorage?.tier === "table") {
        const next = await applyFieldChange(ctx.db, tblStorage, input.fieldName, newField);
        const newFields = fields.map((f) => (f.name === input.fieldName ? newField : f));
        next.searchable = searchableFields(newFields); // cờ searchable có thể đổi theo loại
        const meta = { ...((ent.meta ?? {}) as Record<string, unknown>), storage: next };
        await ctx.db
          .update(entities)
          .set({ fields: newFields, meta, updatedAt: new Date() })
          .where(eq(entities.id, input.entityId));
        return {
          migrated: 0,
          errors: [] as Array<{ id: string; oldValue: unknown; message: string }>,
        };
      }
      // Coerce thử trên các record (chỉ 1 field) + report.
      const recs = await ctx.db
        .select({ id: entityRecords.id, data: entityRecords.data })
        .from(entityRecords)
        .where(
          and(
            eq(entityRecords.entityId, input.entityId),
            eq(entityRecords.companyId, ctx.user.companyId),
          ),
        );
      let migrated = 0;
      const errors: Array<{ id: string; oldValue: unknown; message: string }> = [];
      for (const r of recs) {
        const data = (r.data ?? {}) as Record<string, unknown>;
        if (!(input.fieldName in data)) continue;
        const v = validateRecord(
          [newField],
          { [input.fieldName]: data[input.fieldName] },
          { registry: pluginRegistry },
        );
        if (!v.ok) {
          errors.push({
            id: r.id,
            oldValue: data[input.fieldName],
            message: v.errors.map((e) => e.message).join("; "),
          });
          continue;
        }
        if (v.data[input.fieldName] !== data[input.fieldName]) {
          data[input.fieldName] = v.data[input.fieldName];
          await ctx.db
            .update(entityRecords)
            .set({ data, updatedAt: new Date() })
            .where(eq(entityRecords.id, r.id));
        }
        migrated += 1;
      }
      // Update entity fields metadata.
      const newFields = fields.map((f) => (f.name === input.fieldName ? newField : f));
      await ctx.db
        .update(entities)
        .set({ fields: newFields, updatedAt: new Date() })
        .where(eq(entities.id, input.entityId));
      return { migrated, errors };
    }),
});
