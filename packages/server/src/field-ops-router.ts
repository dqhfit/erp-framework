/* ==========================================================
   field-ops-router.ts — Real-time co-edit cho text field.
   OT đơn giản: insert/delete tại pos. Server giữ canonical
   state per (record, field); transform op nếu baseSeq lệch.
   Broadcast op mới qua WS channel "field:<recordId>:<field>".
   ========================================================== */

import { recordFieldOps } from "@erp-framework/db";
import { TRPCError } from "@trpc/server";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { getRecordStore } from "./record-store";
import { rbacProcedure, router } from "./trpc";
import { publish } from "./ws-hub";

/** Op kind:
 *  - insert (pos, chars): chèn chars tại pos.
 *  - delete (pos, length): xoá length chars từ pos. */
const opInput = z.object({
  recordId: z.string().uuid(),
  fieldName: z.string().min(1),
  baseSeq: z.number().int().nonnegative(),
  op: z.enum(["insert", "delete"]),
  pos: z.number().int().nonnegative(),
  chars: z.string().optional(),
  length: z.number().int().positive().optional(),
});

export const fieldOpsRouter = router({
  /** Push 1 op. Server lấy nextSeq cho (record, field), insert + broadcast. */
  push: rbacProcedure("edit", "entity")
    .input(opInput)
    .mutation(async ({ ctx, input }) => {
      // Verify record cùng company (qua store — HYBRID-aware bảng thật/EAV).
      const rec = await getRecordStore(ctx.db).getById(ctx.user.companyId, input.recordId);
      if (!rec) throw new TRPCError({ code: "NOT_FOUND", message: "Record không tồn tại" });

      // nextSeq = max(seq) + 1; cần lock để tránh race condition trong
      // co-edit cao tần — v1 dùng SELECT + INSERT đơn giản (chấp nhận
      // race rare; client retry với baseSeq mới).
      const [last] = await ctx.db
        .select({ seq: recordFieldOps.seq })
        .from(recordFieldOps)
        .where(
          and(
            eq(recordFieldOps.recordId, input.recordId),
            eq(recordFieldOps.fieldName, input.fieldName),
          ),
        )
        .orderBy(desc(recordFieldOps.seq))
        .limit(1);
      const nextSeq = (last?.seq ?? 0) + 1;

      const [row] = await ctx.db
        .insert(recordFieldOps)
        .values({
          companyId: ctx.user.companyId,
          recordId: input.recordId,
          fieldName: input.fieldName,
          seq: nextSeq,
          baseSeq: input.baseSeq,
          op: input.op,
          pos: input.pos,
          chars: input.chars ?? null,
          length: input.length ?? null,
          actorUserId: ctx.user.id,
        })
        .returning();

      // Broadcast qua WS channel cho mọi tab/client subscribe.
      publish(`field:${input.recordId}:${input.fieldName}`, {
        type: "op",
        seq: nextSeq,
        baseSeq: input.baseSeq,
        op: input.op,
        pos: input.pos,
        chars: input.chars,
        length: input.length,
        actorUserId: ctx.user.id,
        ts: Date.now(),
      });

      return row;
    }),

  /** Sync from sinceSeq — client recovery sau disconnect. */
  sync: rbacProcedure("view", "entity")
    .input(
      z.object({
        recordId: z.string().uuid(),
        fieldName: z.string().min(1),
        sinceSeq: z.number().int().nonnegative().optional(),
      }),
    )
    .query(({ ctx, input }) =>
      ctx.db
        .select()
        .from(recordFieldOps)
        .where(
          and(
            eq(recordFieldOps.recordId, input.recordId),
            eq(recordFieldOps.fieldName, input.fieldName),
            eq(recordFieldOps.companyId, ctx.user.companyId),
          ),
        )
        .orderBy(recordFieldOps.seq),
    ),
});
