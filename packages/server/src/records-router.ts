/* ==========================================================
   records-router.ts — CRUD dữ liệu động (entity records).
   Tách khỏi router.ts (Sprint 1 P2.8 step 2).
   - list/get/create/update + bulk ops
   - delete/restore/hardDelete + cascade onDelete behavior
   - history/asOf/revert (version)
   - semanticSearch + findDuplicates
   - descendants/ancestors (tree self-ref)
   - appendTimeseries/queryTimeseries
   - export (CSV)
   ========================================================== */

import { fieldCan, pluginRegistry, validateRecord } from "@erp-framework/core";
import {
  approvalRequests,
  entities,
  entityRecordTimeseries,
  entityRecordVersions,
} from "@erp-framework/db";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { logAuditImmutable } from "./audit-immutable";
import { findDuplicateRecords } from "./duplicate-detection";
import { fireEntityWebhooks } from "./entity-webhooks-router";
import { assertEntityNotMirror } from "./entity-write-guard";
import { makeCallTool } from "./mcp-client";
import { makeInvokeProcedure } from "./procedure-runner";
import { indexRecordEmbedding, semanticSearchRecords } from "./record-embedding";
import { getRecordStore } from "./record-store";
import { recordTree } from "./record-tree";
import { applyRollups, invalidateRollupsFor } from "./rollup";
import {
  applyCascadeOnDelete,
  assertUnique,
  assertValid,
  clearUniqueTrueFields,
  decryptDataOut,
  deepEqual,
  encryptDataIn,
  loadEntityFields,
  loadUserGroupIds,
  nextSequence,
  queryParams,
  resolveProcBinding,
  scanBackRefs,
  stripUnreadableFields,
  stripUnwritableFields,
} from "./router-helpers";
import { rbacProcedure, router } from "./trpc";
import { triggerEntityWorkflows } from "./workflow-triggers";
import { publish as publishWs } from "./ws-hub";

export const recordsRouter = router({
  list: rbacProcedure("view", "entity")
    .input(
      z.object({
        entityId: z.string().uuid(),
        query: queryParams,
        includeDeleted: z.boolean().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      // Procedure binding dispatch — nếu entity.meta.bindings.list = "proc:<name>",
      // delegate sang procedure-runner. Procedure phải trả { rows, total } | rows[].
      const proc = await resolveProcBinding(ctx.db, ctx.user.companyId, input.entityId, "list");
      if (proc) {
        const r = await makeInvokeProcedure({
          db: ctx.db,
          companyId: ctx.user.companyId,
          callTool: makeCallTool(ctx.db, ctx.user.companyId),
          actorUserId: ctx.user.id,
        })(proc, { query: input.query ?? {} });
        const out = r.output as { rows?: unknown[]; total?: number } | unknown[] | null;
        const rows = Array.isArray(out) ? out : (out?.rows ?? []);
        const total = Array.isArray(out) ? rows.length : (out?.total ?? rows.length);
        return { rows, total };
      }
      const result = await getRecordStore(ctx.db).list(ctx.user.companyId, input.entityId, {
        filters: input.query?.filters,
        q: input.query?.q,
        sort: input.query?.sort,
        limit: input.query?.limit,
        offset: input.query?.offset,
        includeDeleted: input.includeDeleted ?? false,
      });
      const listFields = await loadEntityFields(ctx.db, ctx.user.companyId, input.entityId);
      // Rollup fields (aggregate cross-row, vd tổng tiền đơn = sum dòng chi tiết)
      // — tính per-row, có cache (rollup_cache + rollup_invalidated). Bỏ qua nếu
      // entity không có field rollup nào (zero overhead cho list thường).
      let outRows = result.rows;
      if (listFields.some((f) => f.type === "rollup" && f.rollup)) {
        outRows = await Promise.all(
          outRows.map(async (r) => ({
            ...r,
            data: await applyRollups(
              ctx.db,
              ctx.user.companyId,
              listFields,
              r.id,
              (r.data ?? {}) as Record<string, unknown>,
              { rollupCache: r.rollupCache, rollupInvalidated: r.rollupInvalidated },
            ),
          })),
        );
      }
      // Field-level RBAC: strip cột không có quyền đọc khỏi TỪNG row.
      // (get/export đã strip từ trước — list bị sót, vá 2026-06-11.)
      const needStrip = listFields.some(
        (f) => (f.readableBy?.length ?? 0) > 0 || (f.readableByGroups?.length ?? 0) > 0,
      );
      if (!needStrip) return { ...result, rows: outRows };
      const gIdsList = await loadUserGroupIds(ctx.db, ctx.user.id);
      return {
        ...result,
        rows: outRows.map((r) => ({
          ...r,
          data: stripUnreadableFields(
            listFields,
            (r.data ?? {}) as Record<string, unknown>,
            ctx.user.role,
            gIdsList,
          ),
        })),
      };
    }),

  /* Tổng hợp cột (footer summary lưới server-paged) — tính SERVER-SIDE trên
     TẬP đã lọc (toàn bảng). Field-level RBAC: bỏ qua cột user không có quyền
     đọc. Procedure-binding entity (list=proc) → bỏ qua (không có store thật). */
  aggregate: rbacProcedure("view", "entity")
    .input(
      z.object({
        entityId: z.string().uuid(),
        query: queryParams,
        includeDeleted: z.boolean().optional(),
        aggregates: z
          .array(
            z.object({
              field: z.string().min(1),
              fn: z.enum(["sum", "avg", "count", "min", "max"]),
            }),
          )
          .max(50),
      }),
    )
    .query(async ({ ctx, input }) => {
      const proc = await resolveProcBinding(ctx.db, ctx.user.companyId, input.entityId, "list");
      if (proc) return {} as Record<string, number>;
      // Lọc aggregate về cột user có quyền đọc (field-level RBAC).
      const aggFields = await loadEntityFields(ctx.db, ctx.user.companyId, input.entityId);
      const gIds = await loadUserGroupIds(ctx.db, ctx.user.id);
      const byName = new Map(aggFields.map((f) => [f.name, f]));
      const allowed = input.aggregates.filter((a) => {
        const f = byName.get(a.field);
        // count không lộ giá trị field; field lạ → bỏ. Field có → cần quyền đọc.
        if (a.fn === "count") return true;
        return f ? fieldCan(ctx.user.role, "read", f, gIds) : false;
      });
      if (allowed.length === 0) return {} as Record<string, number>;
      return getRecordStore(ctx.db).aggregate(ctx.user.companyId, input.entityId, {
        filters: input.query?.filters,
        q: input.query?.q,
        includeDeleted: input.includeDeleted ?? false,
        aggregates: allowed,
      });
    }),

  get: rbacProcedure("view", "entity")
    .input(z.string().uuid())
    .query(async ({ ctx, input }) => {
      // Trả cả khi soft-deleted để UI cho phép restore từ trang chi tiết.
      const row = await getRecordStore(ctx.db).getById(ctx.user.companyId, input);
      if (!row) return null;
      // Procedure get-binding: cho phép procedure decorate/enrich row trả về.
      const proc = await resolveProcBinding(ctx.db, ctx.user.companyId, row.entityId, "get");
      if (proc) {
        const r = await makeInvokeProcedure({
          db: ctx.db,
          companyId: ctx.user.companyId,
          callTool: makeCallTool(ctx.db, ctx.user.companyId),
          actorUserId: ctx.user.id,
        })(proc, { id: input, row });
        return r.output ?? row;
      }
      // Decrypt + apply rollup fields (with cache) + strip unreadable.
      const fields = await loadEntityFields(ctx.db, ctx.user.companyId, row.entityId);
      const decoded = decryptDataOut(fields, row.data as Record<string, unknown>);
      const withRollups = await applyRollups(ctx.db, ctx.user.companyId, fields, row.id, decoded, {
        rollupCache: row.rollupCache,
        rollupInvalidated: row.rollupInvalidated,
      });
      return {
        ...row,
        data: stripUnreadableFields(
          fields,
          withRollups,
          ctx.user.role,
          await loadUserGroupIds(ctx.db, ctx.user.id),
        ),
      };
    }),

  create: rbacProcedure("create", "entity")
    .input(z.object({ entityId: z.string().uuid(), data: z.record(z.string(), z.unknown()) }))
    .mutation(async ({ ctx, input }) => {
      await assertEntityNotMirror(ctx.user.companyId, input.entityId);
      const fields = await loadEntityFields(ctx.db, ctx.user.companyId, input.entityId);
      // Strip field user không có quyền write (field-level RBAC).
      const writable = stripUnwritableFields(
        fields,
        input.data,
        ctx.user.role,
        await loadUserGroupIds(ctx.db, ctx.user.id),
      );
      const data = assertValid(fields, writable, false);
      // Sinh value cho field type "sequence" — server-side, atomic.
      const [ent] = await ctx.db
        .select({ name: entities.name })
        .from(entities)
        .where(eq(entities.id, input.entityId));
      const entName = ent?.name ?? input.entityId;
      for (const f of fields) {
        if (f.type === "sequence" && data[f.name] == null) {
          data[f.name] = await nextSequence(ctx.db, ctx.user.companyId, entName, f);
        }
      }
      const store = getRecordStore(ctx.db);
      await assertUnique(store, ctx.user.companyId, input.entityId, fields, data);
      const encrypted = encryptDataIn(fields, data);
      const row = await store.insert(ctx.user.companyId, input.entityId, encrypted, ctx.user.id);
      if (!row) return row;
      // Nếu entity có meta.uniqueTrueFields → clear boolean đó trên các record khác.
      await clearUniqueTrueFields(ctx.db, ctx.user.companyId, input.entityId, row.id, data);
      // Fire outgoing webhooks (best-effort, không block).
      fireEntityWebhooks(ctx.db, {
        companyId: ctx.user.companyId,
        entityId: input.entityId,
        event: "create",
        record: row,
      });
      // Index embedding (best-effort, không block).
      indexRecordEmbedding(ctx.db, ctx.user.companyId, input.entityId, fields, row.id, data);
      // Invalidate rollup cache ở entity đích (best-effort).
      void invalidateRollupsFor(ctx.db, ctx.user.companyId, entName);
      // Publish event cho GraphQL subscriptions + WS clients.
      publishWs(`record:${entName}:${ctx.user.companyId}`, {
        type: "create",
        entityName: entName,
        recordId: row.id,
        data: row.data,
      });
      // Decrypt + ẩn field user không có quyền read trước khi trả response.
      const decoded = decryptDataOut(fields, row.data as Record<string, unknown>);
      // Workflow trigger 'entity_changed' (best-effort, không block).
      void triggerEntityWorkflows(ctx.db, {
        companyId: ctx.user.companyId,
        entityId: input.entityId,
        entityName: entName,
        event: "create",
        recordId: row.id,
        data: decoded,
      });
      return {
        ...row,
        data: stripUnreadableFields(
          fields,
          decoded,
          ctx.user.role,
          await loadUserGroupIds(ctx.db, ctx.user.id),
        ),
      };
    }),

  update: rbacProcedure("edit", "entity")
    .input(
      z.object({
        recordId: z.string().uuid(),
        data: z.record(z.string(), z.unknown()),
        expectedVersion: z.number().int().nonnegative().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Lấy state hiện tại để check version + tính diff.
      const store = getRecordStore(ctx.db);
      const rec = await store.loadState(ctx.user.companyId, input.recordId);
      if (!rec) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Record không tồn tại" });
      }
      if (rec.deletedAt) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Record đã xoá — restore trước khi sửa",
        });
      }
      if (input.expectedVersion !== undefined && input.expectedVersion !== rec.version) {
        throw new TRPCError({
          code: "CONFLICT",
          message: `Version mismatch: bạn đang sửa bản v${input.expectedVersion}, hiện tại đã là v${rec.version}`,
        });
      }
      await assertEntityNotMirror(ctx.user.companyId, rec.entityId);
      const fields = await loadEntityFields(ctx.db, ctx.user.companyId, rec.entityId);
      // Strip field user không có quyền write trước khi validate.
      const writable = stripUnwritableFields(
        fields,
        input.data,
        ctx.user.role,
        await loadUserGroupIds(ctx.db, ctx.user.id),
      );
      const data = assertValid(fields, writable, true);
      // Sequence không cho update — bỏ key sequence ra khỏi data.
      for (const f of fields) {
        if (f.type === "sequence") delete data[f.name];
      }
      await assertUnique(store, ctx.user.companyId, rec.entityId, fields, data, input.recordId);

      // Approval gate — nếu touch field requiresApproval, tạo approval
      // pending thay vì update thẳng. Editor trở lên có thể tự duyệt
      // sau ở UI approvals; viewer thì phải chờ admin.
      const touchedApprovalFields = fields.filter((f) => f.requiresApproval && f.name in data);
      if (touchedApprovalFields.length > 0 && ctx.user.role !== "admin") {
        const [appr] = await ctx.db
          .insert(approvalRequests)
          .values({
            companyId: ctx.user.companyId,
            title: `Sửa ${touchedApprovalFields.map((f) => f.label || f.name).join(", ")}`,
            detail: `Record ${input.recordId.slice(0, 8)}`,
            kind: "entity_update",
            entityId: rec.entityId,
            recordId: input.recordId,
            patch: data,
            createdBy: ctx.user.id,
          })
          .returning();
        return {
          status: "pending_approval" as const,
          approvalId: appr?.id,
          message: "Thay đổi đã gửi duyệt — sẽ áp dụng sau khi được approve.",
        };
      }

      // Tính diff per-field (cũ vs mới) — chỉ trên field có trong patch.
      const oldData = (rec.data ?? {}) as Record<string, unknown>;
      const diff: Record<string, { old: unknown; new: unknown }> = {};
      for (const [k, v] of Object.entries(data)) {
        if (!deepEqual(oldData[k], v)) diff[k] = { old: oldData[k] ?? null, new: v };
      }

      // Encrypt field marked encrypted trước khi merge.
      const encrypted = encryptDataIn(fields, data);
      // Merge JSONB + tăng version atomic. Audit version ghi sau khi update OK.
      const row = await store.merge(ctx.user.companyId, input.recordId, encrypted, rec.version + 1);
      // Nếu entity có meta.uniqueTrueFields → clear boolean đó trên các record khác.
      if (row)
        await clearUniqueTrueFields(ctx.db, ctx.user.companyId, rec.entityId, input.recordId, data);

      // Ghi audit version (best-effort: lỗi không rollback update).
      if (row && Object.keys(diff).length > 0) {
        try {
          await ctx.db.insert(entityRecordVersions).values({
            companyId: ctx.user.companyId,
            recordId: input.recordId,
            version: row.version,
            data: row.data as Record<string, unknown>,
            diff,
            actorUserId: ctx.user.id,
          });
        } catch (e) {
          console.error("[records.update] ghi version lỗi:", (e as Error).message);
        }
      }
      if (row) {
        fireEntityWebhooks(ctx.db, {
          companyId: ctx.user.companyId,
          entityId: rec.entityId,
          event: "update",
          record: row,
          before: oldData,
          after: row.data,
        });
        // Re-index embedding (best-effort).
        indexRecordEmbedding(
          ctx.db,
          ctx.user.companyId,
          rec.entityId,
          fields,
          row.id,
          row.data as Record<string, unknown>,
        );
        // Invalidate rollup cache (best-effort) — cần entity name.
        const [ent] = await ctx.db
          .select({ name: entities.name })
          .from(entities)
          .where(eq(entities.id, rec.entityId));
        if (ent) void invalidateRollupsFor(ctx.db, ctx.user.companyId, ent.name);
        // Immutable audit cho compliance — không sửa/xoá được sau insert.
        void logAuditImmutable(ctx.db, {
          companyId: ctx.user.companyId,
          kind: "record_update",
          objectType: "entity",
          target: ent?.name,
          targetId: input.recordId,
          actorUserId: ctx.user.id,
          detail: `Update record ${input.recordId} v${row.version}`,
          diff,
        });
        // Publish event cho GraphQL subscriptions + WS clients.
        if (ent) {
          publishWs(`record:${ent.name}:${ctx.user.companyId}`, {
            type: "update",
            entityName: ent.name,
            recordId: input.recordId,
            data: row.data,
          });
        }
        // Workflow trigger 'entity_changed' (best-effort, không block).
        // data: bản giải mã của record sau update (decryptDataOut row.data).
        void triggerEntityWorkflows(ctx.db, {
          companyId: ctx.user.companyId,
          entityId: rec.entityId,
          entityName: ent?.name,
          event: "update",
          recordId: input.recordId,
          data: decryptDataOut(fields, row.data as Record<string, unknown>),
        });
      }
      return row;
    }),

  semanticSearch: rbacProcedure("view", "entity")
    .input(
      z.object({
        entityName: z.string().min(1),
        query: z.string().min(1),
        limit: z.number().int().positive().max(50).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      return semanticSearchRecords(
        ctx.db,
        ctx.user.companyId,
        input.entityName,
        input.query,
        input.limit ?? 10,
      );
    }),

  /* Tree traversal — entity có lookup self-ref (vd folder.parent_id trỏ
       folder.id). Trả id + level (depth from anchor). Recursive CTE PG. */
  descendants: rbacProcedure("view", "entity")
    .input(
      z.object({
        recordId: z.string().uuid(),
        fkField: z.string().min(1),
        maxDepth: z.number().int().positive().max(20).optional(),
      }),
    )
    .query(({ ctx, input }) =>
      recordTree(
        ctx.db,
        ctx.user.companyId,
        input.recordId,
        input.fkField,
        input.maxDepth ?? 10,
        "descendants",
      ),
    ),

  ancestors: rbacProcedure("view", "entity")
    .input(
      z.object({
        recordId: z.string().uuid(),
        fkField: z.string().min(1),
        maxDepth: z.number().int().positive().max(20).optional(),
      }),
    )
    .query(({ ctx, input }) =>
      recordTree(
        ctx.db,
        ctx.user.companyId,
        input.recordId,
        input.fkField,
        input.maxDepth ?? 10,
        "ancestors",
      ),
    ),

  /* Time-series endpoints — ghi/đọc giá trị theo thời gian cho field
       type "timeseries" (sensor/telemetry/price). Tách bảng riêng để
       index theo (record, field, ts DESC) tốt cho query range. */
  appendTimeseries: rbacProcedure("edit", "entity")
    .input(
      z.object({
        recordId: z.string().uuid(),
        fieldName: z.string().min(1),
        value: z.number(),
        ts: z.string().datetime().optional(),
        meta: z.record(z.string(), z.unknown()).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Verify record cùng company (qua store — HYBRID-aware bảng thật/EAV).
      const rec = await getRecordStore(ctx.db).getById(ctx.user.companyId, input.recordId);
      if (!rec) throw new TRPCError({ code: "NOT_FOUND", message: "Record không tồn tại" });
      const [row] = await ctx.db
        .insert(entityRecordTimeseries)
        .values({
          companyId: ctx.user.companyId,
          recordId: input.recordId,
          fieldName: input.fieldName,
          ts: input.ts ? new Date(input.ts) : new Date(),
          value: input.value,
          meta: input.meta ?? null,
        })
        .returning();
      return row;
    }),

  queryTimeseries: rbacProcedure("view", "entity")
    .input(
      z.object({
        recordId: z.string().uuid(),
        fieldName: z.string().min(1),
        fromTs: z.string().datetime().optional(),
        toTs: z.string().datetime().optional(),
        limit: z.number().int().positive().max(5000).optional(),
        agg: z.enum(["raw", "avg", "min", "max", "sum"]).optional(),
        bucket: z.enum(["minute", "hour", "day"]).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const limit = input.limit ?? 1000;
      if (input.agg && input.agg !== "raw" && input.bucket) {
        // Aggregated query — date_trunc + agg.
        const aggFn = sql.raw(input.agg);
        const bucket = sql.raw(`'${input.bucket}'`);
        const rows = (await ctx.db.execute(sql`
            SELECT date_trunc(${bucket}, ts) AS bucket, ${aggFn}(value)::float AS value
            FROM entity_record_timeseries
            WHERE company_id = ${ctx.user.companyId}::uuid
              AND record_id = ${input.recordId}::uuid
              AND field_name = ${input.fieldName}
              ${input.fromTs ? sql`AND ts >= ${input.fromTs}::timestamp` : sql``}
              ${input.toTs ? sql`AND ts <= ${input.toTs}::timestamp` : sql``}
            GROUP BY bucket ORDER BY bucket DESC LIMIT ${limit}
          `)) as unknown as Array<{ bucket: string; value: number }>;
        return rows;
      }
      // Raw query.
      return ctx.db
        .select()
        .from(entityRecordTimeseries)
        .where(
          and(
            eq(entityRecordTimeseries.companyId, ctx.user.companyId),
            eq(entityRecordTimeseries.recordId, input.recordId),
            eq(entityRecordTimeseries.fieldName, input.fieldName),
            input.fromTs
              ? sql`${entityRecordTimeseries.ts} >= ${input.fromTs}::timestamp`
              : sql`true`,
            input.toTs ? sql`${entityRecordTimeseries.ts} <= ${input.toTs}::timestamp` : sql`true`,
          ),
        )
        .orderBy(desc(entityRecordTimeseries.ts))
        .limit(limit);
    }),

  findDuplicates: rbacProcedure("view", "entity")
    .input(
      z.object({
        entityId: z.string().uuid(),
        fields: z.array(z.string()).min(1),
        values: z.record(z.string(), z.string()),
        limit: z.number().int().positive().max(20).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      return findDuplicateRecords(
        ctx.db,
        ctx.user.companyId,
        input.entityId,
        input.fields,
        input.values,
        input.limit ?? 5,
      );
    }),

  delete: rbacProcedure("delete", "entity")
    .input(z.string().uuid())
    .mutation(async ({ ctx, input }) => {
      // Lấy record trước khi xoá để gửi webhook.
      const store = getRecordStore(ctx.db);
      const before = await store.getById(ctx.user.companyId, input);
      if (before) await assertEntityNotMirror(ctx.user.companyId, before.entityId);
      // Cascade: scan các entity khác có lookup/multi-lookup trỏ tới
      // record này, áp dụng onDelete behavior (restrict/setnull/cascade).
      // Backend-aware (EAV + bảng thật); ghi qua store.
      await applyCascadeOnDelete(ctx.db, store, ctx.user.companyId, input, ctx.user.id);
      // SOFT delete bản thân: set deleted_at; data còn nguyên cho restore.
      await store.softDelete(ctx.user.companyId, input);
      if (before) {
        fireEntityWebhooks(ctx.db, {
          companyId: ctx.user.companyId,
          entityId: before.entityId,
          event: "delete",
          record: before,
        });
        // Workflow trigger 'entity_changed' (best-effort). entityName để
        // trống → helper tự tra. data không gửi (record đã xoá mềm).
        void triggerEntityWorkflows(ctx.db, {
          companyId: ctx.user.companyId,
          entityId: before.entityId,
          event: "delete",
          recordId: input,
        });
      }
    }),

  backRefs: rbacProcedure("view", "entity")
    .input(z.string().uuid())
    .query(async ({ ctx, input }) => {
      // Trả danh sách entity-source + count + sampleIds cho các record
      // active có field lookup/multi-lookup trỏ tới recordId này.
      return scanBackRefs(ctx.db, ctx.user.companyId, input);
    }),

  restore: rbacProcedure("edit", "entity")
    .input(z.string().uuid())
    .mutation(async ({ ctx, input }) => {
      await getRecordStore(ctx.db).restore(ctx.user.companyId, input);
      return { ok: true };
    }),

  hardDelete: rbacProcedure("delete", "entity")
    .input(z.string().uuid())
    .mutation(async ({ ctx, input }) => {
      // Xoá thật sự — cascade xoá luôn entity_record_versions (FK cascade).
      // Yêu cầu thêm: chỉ admin mới được xoá vĩnh viễn.
      if (ctx.user.role !== "admin") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Chỉ admin được xoá vĩnh viễn (hardDelete)",
        });
      }
      await getRecordStore(ctx.db).hardDelete(ctx.user.companyId, input);
    }),

  history: rbacProcedure("view", "entity")
    .input(z.string().uuid())
    .query(async ({ ctx, input }) => {
      // Verify record thuộc đúng công ty trước khi trả version list
      // (qua store — HYBRID-aware bảng thật/EAV).
      const rec = await getRecordStore(ctx.db).getById(ctx.user.companyId, input);
      if (!rec) throw new TRPCError({ code: "NOT_FOUND", message: "Record không tồn tại" });
      return ctx.db
        .select()
        .from(entityRecordVersions)
        .where(
          and(
            eq(entityRecordVersions.recordId, input),
            eq(entityRecordVersions.companyId, ctx.user.companyId),
          ),
        )
        .orderBy(desc(entityRecordVersions.version));
    }),

  /* Time-travel query — trả state record tại timestamp ts.
       Chiến thuật: tìm version cuối có createdAt <= ts → return data
       snapshot. Nếu không có version nào trước ts → record chưa tồn tại
       hoặc chưa có history (trả record hiện tại nếu createdAt <= ts). */
  asOf: rbacProcedure("view", "entity")
    .input(
      z.object({
        recordId: z.string().uuid(),
        ts: z.string().datetime(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const targetTs = new Date(input.ts);
      // Qua store — HYBRID-aware bảng thật/EAV.
      const rec = await getRecordStore(ctx.db).getById(ctx.user.companyId, input.recordId);
      if (!rec) throw new TRPCError({ code: "NOT_FOUND", message: "Record không tồn tại" });
      // Tìm version snapshot mới nhất trước ts.
      const [version] = await ctx.db
        .select()
        .from(entityRecordVersions)
        .where(
          and(
            eq(entityRecordVersions.recordId, input.recordId),
            eq(entityRecordVersions.companyId, ctx.user.companyId),
            sql`${entityRecordVersions.createdAt} <= ${targetTs.toISOString()}::timestamp`,
          ),
        )
        .orderBy(desc(entityRecordVersions.version))
        .limit(1);
      if (version) {
        return {
          recordId: input.recordId,
          asOf: input.ts,
          version: version.version,
          data: version.data,
        };
      }
      // Không có version nào trước ts; nếu record đã tồn tại trước ts
      // (createdAt <= ts) → data hiện tại nhưng không có lịch sử ghi
      // version → có thể đã được sửa nhưng chưa kịp ghi. Trả null
      // hoặc current data tuỳ ngữ nghĩa user mong đợi.
      if (rec.createdAt <= targetTs) {
        return {
          recordId: input.recordId,
          asOf: input.ts,
          version: 0,
          data: rec.data,
          note: "Không có version snapshot — data hiện tại đoán đúng vì record tồn tại trước ts",
        };
      }
      return null;
    }),

  revert: rbacProcedure("edit", "entity")
    .input(
      z.object({
        recordId: z.string().uuid(),
        targetVersion: z.number().int().nonnegative(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Lấy snapshot của version đích.
      const [target] = await ctx.db
        .select()
        .from(entityRecordVersions)
        .where(
          and(
            eq(entityRecordVersions.recordId, input.recordId),
            eq(entityRecordVersions.companyId, ctx.user.companyId),
            eq(entityRecordVersions.version, input.targetVersion),
          ),
        );
      if (!target) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `Không tìm thấy version ${input.targetVersion}`,
        });
      }
      const store = getRecordStore(ctx.db);
      const cur = await store.loadState(ctx.user.companyId, input.recordId);
      if (!cur) throw new TRPCError({ code: "NOT_FOUND", message: "Record không tồn tại" });

      // Replace toàn bộ data (không merge — revert là thay nguyên khối).
      const targetData = target.data as Record<string, unknown>;
      const oldData = (cur.data ?? {}) as Record<string, unknown>;
      const diff: Record<string, { old: unknown; new: unknown }> = {};
      const allKeys = new Set([...Object.keys(oldData), ...Object.keys(targetData)]);
      for (const k of allKeys) {
        if (!deepEqual(oldData[k], targetData[k])) {
          diff[k] = { old: oldData[k] ?? null, new: targetData[k] ?? null };
        }
      }
      const row = await store.replace(
        ctx.user.companyId,
        input.recordId,
        targetData,
        cur.version + 1,
      );

      if (row) {
        try {
          await ctx.db.insert(entityRecordVersions).values({
            companyId: ctx.user.companyId,
            recordId: input.recordId,
            version: row.version,
            data: targetData,
            diff,
            actorUserId: ctx.user.id,
          });
        } catch (e) {
          console.error("[records.revert] ghi version lỗi:", (e as Error).message);
        }
      }
      return row;
    }),

  /* ── Bulk operations — cap 1000 ids/rows/lần. Lớn hơn → async job.
       Mỗi op write tạo audit version riêng. Báo cáo per-item errors. */
  bulkUpdate: rbacProcedure("edit", "entity")
    .input(
      z.object({
        entityId: z.string().uuid(),
        ids: z.array(z.string().uuid()).min(1).max(1000),
        patch: z.record(z.string(), z.unknown()),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertEntityNotMirror(ctx.user.companyId, input.entityId);
      const fields = await loadEntityFields(ctx.db, ctx.user.companyId, input.entityId);
      // Strip field user không có quyền write trước khi validate
      // (field-level RBAC — áp dụng đồng nhất với records.update).
      const writable = stripUnwritableFields(
        fields,
        input.patch,
        ctx.user.role,
        await loadUserGroupIds(ctx.db, ctx.user.id),
      );
      const data = assertValid(fields, writable, true);
      const store = getRecordStore(ctx.db);
      let updated = 0;
      const errors: Array<{ id: string; message: string }> = [];
      for (const id of input.ids) {
        try {
          const cur = await store.loadState(ctx.user.companyId, id, input.entityId);
          if (!cur || cur.deletedAt) {
            errors.push({ id, message: "Không tồn tại hoặc đã xoá" });
            continue;
          }
          const oldData = (cur.data ?? {}) as Record<string, unknown>;
          const diff: Record<string, { old: unknown; new: unknown }> = {};
          for (const [k, v] of Object.entries(data)) {
            if (!deepEqual(oldData[k], v)) diff[k] = { old: oldData[k] ?? null, new: v };
          }
          const row = await store.merge(ctx.user.companyId, id, data, cur.version + 1);
          if (row && Object.keys(diff).length > 0) {
            await ctx.db.insert(entityRecordVersions).values({
              companyId: ctx.user.companyId,
              recordId: id,
              version: row.version,
              data: row.data as Record<string, unknown>,
              diff,
              actorUserId: ctx.user.id,
            });
          }
          updated += 1;
        } catch (e) {
          errors.push({ id, message: (e as Error).message });
        }
      }
      return { updated, errors };
    }),

  /* Dry-run kiểm tra batch update TRƯỚC khi ghi — KHÔNG ghi gì (.query). Mỗi
     item: tồn tại + chưa xoá + field-level RBAC write + validate + unique. Trả
     [{id, ok, error?}] để UI báo dòng nào sẽ lỗi trước khi commit bulk. */
  bulkValidate: rbacProcedure("edit", "entity")
    .input(
      z.object({
        entityId: z.string().uuid(),
        items: z
          .array(z.object({ id: z.string().uuid(), changes: z.record(z.string(), z.unknown()) }))
          .min(1)
          .max(1000),
      }),
    )
    .query(async ({ ctx, input }) => {
      const store = getRecordStore(ctx.db);
      const fields = await loadEntityFields(ctx.db, ctx.user.companyId, input.entityId);
      const gIds = await loadUserGroupIds(ctx.db, ctx.user.id);
      let mirrorErr: string | null = null;
      try {
        await assertEntityNotMirror(ctx.user.companyId, input.entityId);
      } catch (e) {
        mirrorErr = (e as Error).message;
      }
      const results: Array<{ id: string; ok: boolean; error?: string }> = [];
      for (const it of input.items) {
        if (mirrorErr) {
          results.push({ id: it.id, ok: false, error: mirrorErr });
          continue;
        }
        try {
          const cur = await store.loadState(ctx.user.companyId, it.id, input.entityId);
          if (!cur || cur.deletedAt) throw new Error("Không tồn tại hoặc đã xoá");
          const writable = stripUnwritableFields(fields, it.changes, ctx.user.role, gIds);
          const data = assertValid(fields, writable, true);
          for (const f of fields) if (f.type === "sequence") delete data[f.name];
          await assertUnique(store, ctx.user.companyId, input.entityId, fields, data, it.id);
          results.push({ id: it.id, ok: true });
        } catch (e) {
          results.push({ id: it.id, ok: false, error: (e as Error).message });
        }
      }
      return { results };
    }),

  bulkDelete: rbacProcedure("delete", "entity")
    .input(
      z.object({
        entityId: z.string().uuid(),
        ids: z.array(z.string().uuid()).min(1).max(1000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertEntityNotMirror(ctx.user.companyId, input.entityId);
      const store = getRecordStore(ctx.db);
      let deleted = 0;
      const errors: Array<{ id: string; message: string }> = [];
      for (const id of input.ids) {
        try {
          await applyCascadeOnDelete(ctx.db, store, ctx.user.companyId, id, ctx.user.id);
          await store.softDelete(ctx.user.companyId, id);
          deleted += 1;
        } catch (e) {
          errors.push({ id, message: (e as Error).message });
        }
      }
      return { deleted, errors };
    }),

  bulkImport: rbacProcedure("create", "entity")
    .input(
      z.object({
        entityId: z.string().uuid(),
        rows: z.array(z.record(z.string(), z.unknown())).min(1).max(1000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertEntityNotMirror(ctx.user.companyId, input.entityId);
      const fields = await loadEntityFields(ctx.db, ctx.user.companyId, input.entityId);
      const store = getRecordStore(ctx.db);
      const gIds = await loadUserGroupIds(ctx.db, ctx.user.id);
      let imported = 0;
      const errors: Array<{ index: number; message: string }> = [];
      for (let i = 0; i < input.rows.length; i++) {
        try {
          const r = input.rows[i]!;
          // Strip field user không có quyền write per row (field-level RBAC).
          const writable = stripUnwritableFields(fields, r, ctx.user.role, gIds);
          const v = validateRecord(fields, writable, { registry: pluginRegistry });
          if (!v.ok) {
            errors.push({
              index: i,
              message: v.errors
                .map((e: { field: string; message: string }) => `${e.field}: ${e.message}`)
                .join("; "),
            });
            continue;
          }
          await store.insert(
            ctx.user.companyId,
            input.entityId,
            v.data as Record<string, unknown>,
            ctx.user.id,
          );
          imported += 1;
        } catch (e) {
          errors.push({ index: i, message: (e as Error).message });
        }
      }
      return { imported, errors };
    }),

  export: rbacProcedure("view", "entity")
    .input(
      z.object({
        entityId: z.string().uuid(),
        format: z.enum(["csv", "json"]),
        query: queryParams,
      }),
    )
    .query(async ({ ctx, input }) => {
      const fields = await loadEntityFields(ctx.db, ctx.user.companyId, input.entityId);
      const { rows } = await getRecordStore(ctx.db).list(ctx.user.companyId, input.entityId, {
        filters: input.query?.filters,
        q: input.query?.q,
        limit: 5000,
        withTotal: false,
      });
      // Strip field unreadable + decrypt per row trước khi export
      // (field-level RBAC — viewer không thấy field admin-only kể cả
      // qua CSV/JSON download).
      const gIdsExport = await loadUserGroupIds(ctx.db, ctx.user.id);
      const safeRows = rows.map((r) => {
        const decoded = decryptDataOut(fields, (r.data ?? {}) as Record<string, unknown>);
        return { ...r, data: stripUnreadableFields(fields, decoded, ctx.user.role, gIdsExport) };
      });
      if (input.format === "json") {
        return {
          format: "json" as const,
          content: JSON.stringify(
            safeRows.map((r) => r.data),
            null,
            2,
          ),
        };
      }
      // CSV: collect headers từ tất cả keys, escape RFC 4180 (quote tất cả).
      const allKeys = new Set<string>();
      for (const r of safeRows) {
        for (const k of Object.keys((r.data ?? {}) as Record<string, unknown>)) {
          allKeys.add(k);
        }
      }
      const headers = [...allKeys];
      const esc = (v: unknown): string => {
        if (v == null) return "";
        const s = typeof v === "string" ? v : JSON.stringify(v);
        return `"${s.replace(/"/g, '""')}"`;
      };
      const body = safeRows
        .map((r) => {
          const d = (r.data ?? {}) as Record<string, unknown>;
          return headers.map((h) => esc(d[h])).join(",");
        })
        .join("\n");
      const content = `${headers.map((h) => `"${h}"`).join(",")}\n${body}`;
      return { format: "csv" as const, content };
    }),
});
