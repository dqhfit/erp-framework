/* ==========================================================
   datasources-router.ts — CRUD metadata "Nguồn dữ liệu" + đọc/ghi
   dữ liệu joined (ORM-like). Metadata mirror entities-router.
   Dữ liệu: đọc qua datasource-resolver (join batch-stitch), ghi qua
   records caller (tái dùng nguyên side-effect: sequence/validate/
   webhook/audit/rollup) — base entity là gốc ghi.
   ========================================================== */

import type { DataSourceConfig } from "@erp-framework/core";
import { dataSources } from "@erp-framework/db";
import { TRPCError } from "@trpc/server";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { resolveFields, resolveGet, resolveList, splitWriteData } from "./datasource-resolver";
import { recordsRouter } from "./records-router";
import { createCallerFactory, rbacProcedure, router } from "./trpc";

/* ─── Zod ─────────────────────────────────────────────────── */

const filterOp = z.enum([
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
]);

const dsRelation = z.object({
  id: z.string().min(1),
  alias: z.string(),
  fromRelationId: z.string().nullable(),
  fromField: z.string().min(1),
  toField: z.string().optional(),
  targetEntityId: z.string().uuid(),
  joinKind: z.enum(["left", "inner"]).default("left"),
});

const dsAggregate = z.object({
  key: z.string().min(1),
  label: z.string(),
  agg: z.enum(["count", "sum", "avg", "min", "max"]),
  sourceRelationId: z.string().optional(),
  matchField: z.string().optional(),
  targetEntityId: z.string().uuid(),
  targetField: z.string().min(1),
  valueField: z.string().optional(),
  via: z
    .object({
      farEntityId: z.string().uuid(),
      farField: z.string().min(1),
      farKeyField: z.string().optional(),
    })
    .optional(),
});

const dsField = z.object({
  key: z.string().min(1),
  sourceRelationId: z.string().min(1), // "base" hoặc id relation
  sourceField: z.string().min(1),
  label: z.string(),
  type: z.string(),
  writable: z.boolean().optional(),
  // Lookup tới entity master: ref = entity đích; refValueField = field dùng
  // làm value (lookup theo TÊN/mã thay vì UUID id). Xem DataSourceField.
  ref: z.string().optional(),
  refValueField: z.string().optional(),
  // Nhật ký: base field tự điền+lưu từ cột projection của ref khi đổi mã ref
  // (key cột projection, vd "material_tenvt"). Xem DataSourceField.snapshotFrom.
  snapshotFrom: z.string().optional(),
});

const dsComputed = z.object({
  key: z.string().min(1),
  label: z.string(),
  expr: z.string(),
  type: z.string().optional(),
});

/** Schema config DataSource — export để MCP migration (datasource_create_draft)
 *  validate cùng MỘT hợp đồng với tRPC, tránh 2 đường vào lệch nhau. */
export const dsConfig = z.object({
  baseEntityId: z.string().default(""), // "" khi datasource vừa tạo, chưa cấu hình
  relations: z.array(dsRelation).default([]),
  fields: z.array(dsField).default([]),
  aggregates: z.array(dsAggregate).optional(),
  computed: z.array(dsComputed).optional(),
  baseFilters: z.record(z.string(), z.object({ op: filterOp, value: z.unknown() })).optional(),
  sort: z.object({ key: z.string(), dir: z.enum(["asc", "desc"]) }).optional(),
  defaultLimit: z.number().int().positive().max(10_000).optional(),
});

export const dataSourceInput = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1),
  label: z.string().min(1),
  icon: z.string().optional(),
  config: dsConfig,
});

const dsQuery = z.object({
  limit: z.number().int().positive().max(10_000).optional(),
  offset: z.number().int().nonnegative().optional(),
  filters: z.record(z.string(), z.object({ op: filterOp, value: z.unknown() })).optional(),
  sort: z.object({ key: z.string(), dir: z.enum(["asc", "desc"]) }).optional(),
  q: z.string().optional(),
});

const callRecords = createCallerFactory(recordsRouter);

/* Chuẩn hoá config (jsonb có thể thiếu key khi datasource cũ/rỗng). */
function normCfg(raw: unknown): DataSourceConfig {
  const c = (raw ?? {}) as Partial<DataSourceConfig>;
  return {
    baseEntityId: c.baseEntityId ?? "",
    relations: c.relations ?? [],
    fields: c.fields ?? [],
    aggregates: c.aggregates,
    computed: c.computed,
    baseFilters: c.baseFilters,
    sort: c.sort,
    defaultLimit: c.defaultLimit,
  };
}

/* ─── Router ──────────────────────────────────────────────── */

export const dataSourcesRouter = router({
  /* ── Metadata (mirror entities) ── */
  list: rbacProcedure("view", "datasource").query(({ ctx }) =>
    ctx.db.select().from(dataSources).where(eq(dataSources.companyId, ctx.user.companyId)),
  ),

  get: rbacProcedure("view", "datasource")
    .input(z.string().uuid())
    .query(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .select()
        .from(dataSources)
        .where(and(eq(dataSources.id, input), eq(dataSources.companyId, ctx.user.companyId)));
      return row ?? null;
    }),

  save: rbacProcedure("edit", "datasource")
    .input(dataSourceInput)
    .mutation(async ({ ctx, input }) => {
      const name = input.name.trim();
      if (!name)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Tên nguồn dữ liệu không được trống.",
        });
      const values = {
        name,
        label: input.label,
        icon: input.icon ?? null,
        config: input.config,
      };
      const [dup] = await ctx.db
        .select({ id: dataSources.id, name: dataSources.name })
        .from(dataSources)
        .where(
          and(
            eq(dataSources.companyId, ctx.user.companyId),
            sql`lower(${dataSources.name}) = lower(${name})`,
          ),
        );
      if (dup && dup.id !== input.id) {
        throw new TRPCError({
          code: "CONFLICT",
          message: `Đã có nguồn dữ liệu tên "${dup.name}" — chọn tên khác.`,
        });
      }
      if (input.id) {
        const [ex] = await ctx.db
          .select({ companyId: dataSources.companyId })
          .from(dataSources)
          .where(eq(dataSources.id, input.id));
        if (ex && ex.companyId !== ctx.user.companyId)
          throw new TRPCError({ code: "FORBIDDEN", message: "Đối tượng thuộc công ty khác" });
        if (ex) {
          const [row] = await ctx.db
            .update(dataSources)
            .set({ ...values, updatedAt: new Date() })
            .where(eq(dataSources.id, input.id))
            .returning();
          return row;
        }
        const [row] = await ctx.db
          .insert(dataSources)
          .values({ id: input.id, companyId: ctx.user.companyId, ...values })
          .returning();
        return row;
      }
      const [row] = await ctx.db
        .insert(dataSources)
        .values({ companyId: ctx.user.companyId, ...values })
        .returning();
      return row;
    }),

  delete: rbacProcedure("delete", "datasource")
    .input(z.string().uuid())
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .delete(dataSources)
        .where(and(eq(dataSources.id, input), eq(dataSources.companyId, ctx.user.companyId)));
    }),

  /* ── Metadata field phẳng cho widget render ── */
  meta: rbacProcedure("view", "datasource")
    .input(z.string().uuid())
    .query(async ({ ctx, input }) => {
      const cfg = await loadCfg(ctx.db, ctx.user.companyId, input);
      const fields = await resolveFields(ctx.db, ctx.user.companyId, cfg.config);
      return {
        id: cfg.id,
        name: cfg.name,
        label: cfg.label,
        baseEntityId: cfg.config.baseEntityId,
        fields,
        // Quan hệ join → widget map ref field (fromField) sang cột projection
        // (đổi mã vật tư → auto điền Tên vật tư client-side, không chờ refetch).
        relations: cfg.config.relations,
      };
    }),

  /* ── Dữ liệu (join read) ── */
  listRecords: rbacProcedure("view", "datasource")
    .input(z.object({ dataSourceId: z.string().uuid(), query: dsQuery.optional() }))
    .query(async ({ ctx, input }) => {
      const cfg = await loadCfg(ctx.db, ctx.user.companyId, input.dataSourceId);
      return resolveList(ctx.db, ctx.user.companyId, ctx.user.role, cfg.config, input.query ?? {});
    }),

  /* ── Chạy thử 1 config TUỲ Ý (chưa lưu) — cho editor SQL "chạy vùng chọn".
       An toàn: vẫn qua resolveList nên scope companyId + strip field theo role;
       entity_records company-scoped → entityId lạ trả 0 dòng. KHÔNG ghi gì. */
  preview: rbacProcedure("view", "datasource")
    .input(z.object({ config: dsConfig, query: dsQuery.optional() }))
    .query(({ ctx, input }) =>
      resolveList(
        ctx.db,
        ctx.user.companyId,
        ctx.user.role,
        normCfg(input.config),
        input.query ?? {},
      ),
    ),

  getRecord: rbacProcedure("view", "datasource")
    .input(z.object({ dataSourceId: z.string().uuid(), recordId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const cfg = await loadCfg(ctx.db, ctx.user.companyId, input.dataSourceId);
      return resolveGet(ctx.db, ctx.user.companyId, ctx.user.role, cfg.config, input.recordId);
    }),

  /* ── Ghi (write-back qua records caller; base = gốc) ── */
  createRecord: rbacProcedure("create", "datasource")
    .input(z.object({ dataSourceId: z.string().uuid(), data: z.record(z.string(), z.unknown()) }))
    .mutation(async ({ ctx, input }) => {
      const cfg = await loadCfg(ctx.db, ctx.user.companyId, input.dataSourceId);
      if (!cfg.config.baseEntityId)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Nguồn dữ liệu chưa chọn entity gốc.",
        });
      const split = splitWriteData(cfg.config, input.data);
      const caller = callRecords(ctx);
      const rec = await caller.create({ entityId: cfg.config.baseEntityId, data: split.base });
      if (!rec)
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Tạo record thất bại." });
      return resolveGet(ctx.db, ctx.user.companyId, ctx.user.role, cfg.config, rec.id);
    }),

  updateRecord: rbacProcedure("edit", "datasource")
    .input(
      z.object({
        dataSourceId: z.string().uuid(),
        recordId: z.string().uuid(), // = base record id
        data: z.record(z.string(), z.unknown()),
        expectedVersion: z.number().int().nonnegative().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const cfg = await loadCfg(ctx.db, ctx.user.companyId, input.dataSourceId);
      const split = splitWriteData(cfg.config, input.data);
      const caller = callRecords(ctx);
      // 1. Cập nhật field base trên record gốc.
      if (Object.keys(split.base).length > 0) {
        await caller.update({
          recordId: input.recordId,
          data: split.base,
          expectedVersion: input.expectedVersion,
        });
      }
      // 2. Field join writable → cập nhật record liên quan theo __ids.
      if (Object.keys(split.joins).length > 0) {
        const cur = await resolveGet(
          ctx.db,
          ctx.user.companyId,
          ctx.user.role,
          cfg.config,
          input.recordId,
        );
        const idmap = cur?.__ids ?? {};
        for (const [relId, patch] of Object.entries(split.joins)) {
          const targetId = idmap[relId];
          if (targetId) await caller.update({ recordId: targetId, data: patch });
        }
      }
      return resolveGet(ctx.db, ctx.user.companyId, ctx.user.role, cfg.config, input.recordId);
    }),

  deleteRecord: rbacProcedure("delete", "datasource")
    .input(z.object({ dataSourceId: z.string().uuid(), recordId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      // Xoá chỉ record base (gốc); record join không bị xoá qua datasource.
      const caller = callRecords(ctx);
      await caller.delete(input.recordId);
      return { ok: true };
    }),
});

/* Load datasource + chuẩn hoá config; throw NOT_FOUND nếu không có/khác công ty. */
async function loadCfg(
  db: Parameters<typeof resolveList>[0],
  companyId: string,
  id: string,
): Promise<{ id: string; name: string; label: string; config: DataSourceConfig }> {
  const [row] = await db
    .select()
    .from(dataSources)
    .where(and(eq(dataSources.id, id), eq(dataSources.companyId, companyId)));
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Không tìm thấy nguồn dữ liệu." });
  return { id: row.id, name: row.name, label: row.label, config: normCfg(row.config) };
}
