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
          .select({ companyId: entities.companyId })
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
          return row;
        }
        const [row] = await ctx.db
          .insert(entities)
          .values({ id: input.id, companyId: ctx.user.companyId, ...values })
          .returning();
        return row;
      }
      const [row] = await ctx.db
        .insert(entities)
        .values({ companyId: ctx.user.companyId, ...values })
        .returning();
      return row;
    }),

  delete: rbacProcedure("delete", "entity")
    .input(z.string().uuid())
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .delete(entities)
        .where(and(eq(entities.id, input), eq(entities.companyId, ctx.user.companyId)));
    }),

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
      await ctx.db
        .update(entities)
        .set({ fields: newFields, updatedAt: new Date() })
        .where(eq(entities.id, input.entityId));
      // Migrate data: di chuyển value từ old key sang new key trong mỗi record.
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
