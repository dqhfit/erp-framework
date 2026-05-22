/* ==========================================================
   knowledge-router.ts — tRPC router cho Knowledge Base (RAG).
   - sources.list/get/delete : quản lý nguồn tri thức
   - addText / addEntity     : tạo nguồn rồi đẩy vào hàng đợi nạp
   - reindex                 : nạp lại một nguồn
   - search                  : tra cứu ANN cosine
   - embeddingProfile.get/save : cấu hình profile embedding (dùng
     chung bảng llm_profiles, kind='embedding', mỗi công ty một bản)
   Mọi truy vấn lọc theo công ty đang chọn (đa công ty).
   ========================================================== */
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { knowledgeSources, entities, llmProfiles } from "@erp-framework/db";
import { router, rbacProcedure } from "./trpc";
import { enqueueKbIngest } from "./jobs";
import { knowledgeSearch } from "./knowledge-search";
import { encryptSecret, decryptSecret } from "./crypto";

export const knowledgeRouter = router({
  /* ── Quản lý nguồn tri thức ── */
  sources: router({
    list: rbacProcedure("view", "knowledge")
      .query(({ ctx }) => ctx.db.select().from(knowledgeSources)
        .where(eq(knowledgeSources.companyId, ctx.user.companyId))
        .orderBy(desc(knowledgeSources.createdAt))),

    get: rbacProcedure("view", "knowledge")
      .input(z.string().uuid())
      .query(async ({ ctx, input }) => {
        const [row] = await ctx.db.select().from(knowledgeSources)
          .where(and(eq(knowledgeSources.id, input),
            eq(knowledgeSources.companyId, ctx.user.companyId)));
        return row ?? null;
      }),

    delete: rbacProcedure("delete", "knowledge")
      .input(z.string().uuid())
      .mutation(async ({ ctx, input }) => {
        // Xoá nguồn → cascade xoá knowledge_chunks (FK on delete cascade).
        await ctx.db.delete(knowledgeSources).where(and(
          eq(knowledgeSources.id, input),
          eq(knowledgeSources.companyId, ctx.user.companyId)));
      }),

    /* Sửa nguồn: tiêu đề (mọi loại), nội dung (chỉ kind=text),
       lịch tự nạp lại reindexCron (chỉ kind=entity). Sửa nội dung
       → đặt lại status=pending và nạp lại. */
    update: rbacProcedure("edit", "knowledge")
      .input(z.object({
        id: z.string().uuid(),
        title: z.string().min(1).optional(),
        text: z.string().optional(),
        reindexCron: z.string().nullable().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const [src] = await ctx.db.select().from(knowledgeSources)
          .where(and(eq(knowledgeSources.id, input.id),
            eq(knowledgeSources.companyId, ctx.user.companyId)));
        if (!src) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Nguồn không tồn tại" });
        }
        // Sửa nội dung chỉ cho nguồn text; lịch cron chỉ cho nguồn entity.
        if (input.text !== undefined && src.kind !== "text") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Chỉ nguồn văn bản dán tay mới sửa được nội dung.",
          });
        }
        if (input.reindexCron && src.kind !== "entity") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Tự động nạp lại chỉ áp dụng cho nguồn dữ liệu entity.",
          });
        }

        // Sửa nội dung text → đặt lại trạng thái + nạp lại.
        const reindex = input.text !== undefined;
        const textPatch = reindex
          ? {
              meta: { ...(src.meta as Record<string, unknown>), text: input.text },
              status: "pending",
              error: null,
            }
          : {};

        await ctx.db.update(knowledgeSources).set({
          updatedAt: new Date(),
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...textPatch,
          ...(input.reindexCron !== undefined ? { reindexCron: input.reindexCron } : {}),
        }).where(eq(knowledgeSources.id, input.id));
        if (reindex) await enqueueKbIngest(input.id);
        return { ok: true };
      }),
  }),

  /* ── Thêm nguồn: văn bản dán tay ── */
  addText: rbacProcedure("create", "knowledge")
    .input(z.object({
      title: z.string().min(1),
      text: z.string().min(1),
    }))
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db.insert(knowledgeSources).values({
        companyId: ctx.user.companyId,
        kind: "text",
        title: input.title,
        status: "pending",
        meta: { text: input.text },
        createdBy: ctx.user.id,
      }).returning();
      if (!row) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await enqueueKbIngest(row.id);
      return row;
    }),

  /* ── Thêm nguồn: dữ liệu một entity ── */
  addEntity: rbacProcedure("create", "knowledge")
    .input(z.object({
      entityId: z.string().uuid(),
      title: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const [ent] = await ctx.db.select().from(entities)
        .where(and(eq(entities.id, input.entityId),
          eq(entities.companyId, ctx.user.companyId)));
      if (!ent) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Entity không tồn tại" });
      }
      const [row] = await ctx.db.insert(knowledgeSources).values({
        companyId: ctx.user.companyId,
        kind: "entity",
        title: input.title?.trim() || `Dữ liệu: ${ent.label}`,
        status: "pending",
        meta: { entityId: input.entityId },
        createdBy: ctx.user.id,
      }).returning();
      if (!row) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await enqueueKbIngest(row.id);
      return row;
    }),

  /* ── Nạp lại một nguồn ── */
  reindex: rbacProcedure("edit", "knowledge")
    .input(z.string().uuid())
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db.select({ id: knowledgeSources.id })
        .from(knowledgeSources).where(and(
          eq(knowledgeSources.id, input),
          eq(knowledgeSources.companyId, ctx.user.companyId)));
      if (!row) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Nguồn không tồn tại" });
      }
      await ctx.db.update(knowledgeSources)
        .set({ status: "pending", error: null, updatedAt: new Date() })
        .where(eq(knowledgeSources.id, input));
      await enqueueKbIngest(input);
      return { ok: true };
    }),

  /* ── Tra cứu ── */
  search: rbacProcedure("view", "knowledge")
    .input(z.object({
      query: z.string().min(1),
      limit: z.number().int().positive().max(20).optional(),
    }))
    .query(({ ctx, input }) =>
      knowledgeSearch(ctx.db, ctx.user.companyId, input.query, input.limit ?? 5)),

  /* ── Cấu hình profile embedding (một bản / công ty) ── */
  embeddingProfile: router({
    get: rbacProcedure("view", "settings")
      .query(async ({ ctx }) => {
        const [row] = await ctx.db.select().from(llmProfiles)
          .where(and(eq(llmProfiles.companyId, ctx.user.companyId),
            eq(llmProfiles.kind, "embedding")));
        if (!row) return null;
        return {
          adapter: row.adapter,
          model: row.model,
          endpoint: row.endpoint,
          apiKeyEnc: row.apiKeyEnc ? decryptSecret(row.apiKeyEnc) : null,
        };
      }),

    save: rbacProcedure("edit", "settings")
      .input(z.object({
        adapter: z.enum(["ollama", "openai"]),
        model: z.string().min(1),
        endpoint: z.string().optional(),
        apiKeyEnc: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const values = {
          adapter: input.adapter,
          model: input.model,
          kind: "embedding",
          endpoint: input.endpoint?.trim() || null,
          apiKeyEnc: input.apiKeyEnc ? encryptSecret(input.apiKeyEnc) : null,
        };
        const [ex] = await ctx.db.select({ id: llmProfiles.id })
          .from(llmProfiles).where(and(
            eq(llmProfiles.companyId, ctx.user.companyId),
            eq(llmProfiles.kind, "embedding")));
        if (ex) {
          await ctx.db.update(llmProfiles).set(values)
            .where(eq(llmProfiles.id, ex.id));
        } else {
          await ctx.db.insert(llmProfiles).values({
            companyId: ctx.user.companyId, name: "embedding", ...values,
          });
        }
        return { ok: true };
      }),
  }),
});
