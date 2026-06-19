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

import {
  entities,
  knowledgeSources,
  knowledgeSourceViewerGroups,
  llmProfiles,
  viewerGroups,
} from "@erp-framework/db";
import { TRPCError } from "@trpc/server";
import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, isNull, ne } from "drizzle-orm";
import { z } from "zod";
import { decryptSecret, encryptSecret } from "./crypto";
import { enqueueKbIngest } from "./jobs";
import { knowledgeAccessibleSql, resolveKnowledgeAcl } from "./knowledge-acl";
import { knowledgeSearch } from "./knowledge-search";
import { clearResourceMembers, listResourceMembers, upsertResourceMember } from "./resource-acl";
import { rbacProcedure, router } from "./trpc";

export const knowledgeRouter = router({
  /* ── Quản lý nguồn tri thức ── */
  sources: router({
    list: rbacProcedure("view", "knowledge")
      .input(
        z
          .object({
            // scope lọc tab Documents: "mine" = của tôi, "shared" = được chia sẻ,
            // "company" = toàn công ty. undefined = tất cả (dùng cho KB search).
            scope: z.enum(["mine", "shared", "company"]).optional(),
          })
          .optional(),
      )
      .query(async ({ ctx, input }) => {
        // Admin xem mọi nguồn (acl=null); user thường lọc theo visibility +
        // nhóm/user được cấp. Xem knowledge-acl.ts.
        const acl = await resolveKnowledgeAcl(ctx.db, ctx.user.role, ctx.user.id);
        const baseWhere = acl
          ? and(eq(knowledgeSources.companyId, ctx.user.companyId), knowledgeAccessibleSql(acl))
          : eq(knowledgeSources.companyId, ctx.user.companyId);

        const scope = input?.scope;
        let scopeWhere = undefined;
        if (scope === "mine") {
          scopeWhere = eq(knowledgeSources.createdBy, ctx.user.id);
        } else if (scope === "shared") {
          // Được chia sẻ riêng: restricted/private có mình trong members/groups,
          // nhưng KHÔNG phải do mình tạo.
          scopeWhere = and(
            ne(knowledgeSources.createdBy, ctx.user.id),
            ne(knowledgeSources.visibility, "company"),
            ne(knowledgeSources.visibility, "public"),
          );
        } else if (scope === "company") {
          scopeWhere = eq(knowledgeSources.visibility, "company");
        }

        return ctx.db
          .select()
          .from(knowledgeSources)
          .where(scopeWhere ? and(baseWhere, scopeWhere) : baseWhere)
          .orderBy(desc(knowledgeSources.createdAt));
      }),

    get: rbacProcedure("view", "knowledge")
      .input(z.string().uuid())
      .query(async ({ ctx, input }) => {
        const acl = await resolveKnowledgeAcl(ctx.db, ctx.user.role, ctx.user.id);
        const [row] = await ctx.db
          .select()
          .from(knowledgeSources)
          .where(
            and(
              eq(knowledgeSources.id, input),
              eq(knowledgeSources.companyId, ctx.user.companyId),
              ...(acl ? [knowledgeAccessibleSql(acl)] : []),
            ),
          );
        return row ?? null;
      }),

    delete: rbacProcedure("delete", "knowledge")
      .input(z.string().uuid())
      .mutation(async ({ ctx, input }) => {
        // Xoá nguồn → cascade xoá knowledge_chunks + knowledge_source_viewer_groups
        // (FK on delete cascade). resource_members là bảng generic KHÔNG có FK
        // resource_id → tự dọn để tránh rác membership.
        await ctx.db
          .delete(knowledgeSources)
          .where(
            and(eq(knowledgeSources.id, input), eq(knowledgeSources.companyId, ctx.user.companyId)),
          );
        await clearResourceMembers(ctx.db, "knowledge", input);
      }),

    /* Sửa nguồn: tiêu đề (mọi loại), nội dung (chỉ kind=text),
       lịch tự nạp lại reindexCron (chỉ kind=entity). Sửa nội dung
       → đặt lại status=pending và nạp lại. */
    update: rbacProcedure("edit", "knowledge")
      .input(
        z.object({
          id: z.string().uuid(),
          title: z.string().min(1).optional(),
          text: z.string().optional(),
          reindexCron: z.string().nullable().optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const [src] = await ctx.db
          .select()
          .from(knowledgeSources)
          .where(
            and(
              eq(knowledgeSources.id, input.id),
              eq(knowledgeSources.companyId, ctx.user.companyId),
            ),
          );
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

        await ctx.db
          .update(knowledgeSources)
          .set({
            updatedAt: new Date(),
            ...(input.title !== undefined ? { title: input.title } : {}),
            ...textPatch,
            ...(input.reindexCron !== undefined ? { reindexCron: input.reindexCron } : {}),
          })
          .where(eq(knowledgeSources.id, input.id));
        if (reindex) await enqueueKbIngest(input.id);
        return { ok: true };
      }),

    /* ── Phân quyền truy cập nguồn: visibility + nhóm + user (P #3) ── */
    acl: rbacProcedure("view", "knowledge")
      .input(z.string().uuid())
      .query(async ({ ctx, input }) => {
        const [src] = await ctx.db
          .select({ id: knowledgeSources.id, visibility: knowledgeSources.visibility })
          .from(knowledgeSources)
          .where(
            and(eq(knowledgeSources.id, input), eq(knowledgeSources.companyId, ctx.user.companyId)),
          );
        if (!src) throw new TRPCError({ code: "NOT_FOUND", message: "Nguồn không tồn tại" });
        const groups = await ctx.db
          .select({ groupId: knowledgeSourceViewerGroups.groupId })
          .from(knowledgeSourceViewerGroups)
          .where(eq(knowledgeSourceViewerGroups.sourceId, input));
        const members = await listResourceMembers(ctx.db, "knowledge", input);
        return {
          visibility: src.visibility,
          groupIds: groups.map((g) => g.groupId),
          userIds: members.map((m) => m.userId),
        };
      }),

    setAcl: rbacProcedure("edit", "knowledge")
      .input(
        z.object({
          id: z.string().uuid(),
          // "private": chỉ người tạo; "restricted": có members; "company": mọi user;
          // "public": ai có link. Khi có member mà chọn private → tự động restricted.
          visibility: z.enum(["private", "company", "restricted", "public"]),
          groupIds: z.array(z.string().uuid()).default([]),
          userIds: z.array(z.string().uuid()).default([]),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const [src] = await ctx.db
          .select({ id: knowledgeSources.id, shareToken: knowledgeSources.shareToken })
          .from(knowledgeSources)
          .where(
            and(
              eq(knowledgeSources.id, input.id),
              eq(knowledgeSources.companyId, ctx.user.companyId),
            ),
          );
        if (!src) throw new TRPCError({ code: "NOT_FOUND", message: "Nguồn không tồn tại" });

        // Chỉ nhận nhóm thuộc đúng công ty (chống gán chéo tenant).
        const validGroupIds = input.groupIds.length
          ? (
              await ctx.db
                .select({ id: viewerGroups.id })
                .from(viewerGroups)
                .where(
                  and(
                    inArray(viewerGroups.id, input.groupIds),
                    eq(viewerGroups.companyId, ctx.user.companyId),
                  ),
                )
            ).map((g) => g.id)
          : [];

        // Private + có member → effective restricted (member thắng).
        const hasMembers = validGroupIds.length > 0 || input.userIds.length > 0;
        const effectiveVisibility =
          input.visibility === "private" && hasMembers ? "restricted" : input.visibility;

        // Nếu chuyển khỏi "public" → xoá share_token để vô hiệu link cũ.
        const tokenPatch =
          effectiveVisibility !== "public" && src.shareToken ? { shareToken: null as null } : {};

        await ctx.db
          .update(knowledgeSources)
          .set({ visibility: effectiveVisibility, updatedAt: new Date(), ...tokenPatch })
          .where(eq(knowledgeSources.id, input.id));

        // Thay thế toàn bộ nhóm được gắn.
        await ctx.db
          .delete(knowledgeSourceViewerGroups)
          .where(eq(knowledgeSourceViewerGroups.sourceId, input.id));
        if (validGroupIds.length > 0) {
          await ctx.db
            .insert(knowledgeSourceViewerGroups)
            .values(validGroupIds.map((groupId) => ({ sourceId: input.id, groupId })));
        }

        // Thay thế toàn bộ user được cấp riêng (resource_members type=knowledge).
        await clearResourceMembers(ctx.db, "knowledge", input.id);
        for (const userId of input.userIds) {
          await upsertResourceMember(ctx.db, "knowledge", input.id, userId, "viewer", ctx.user.id);
        }
        return { ok: true };
      }),

    /* Sinh share link công khai (set visibility="public" + share_token). */
    generateShareLink: rbacProcedure("edit", "knowledge")
      .input(z.string().uuid())
      .mutation(async ({ ctx, input }) => {
        const [src] = await ctx.db
          .select({ id: knowledgeSources.id, shareToken: knowledgeSources.shareToken })
          .from(knowledgeSources)
          .where(
            and(eq(knowledgeSources.id, input), eq(knowledgeSources.companyId, ctx.user.companyId)),
          );
        if (!src) throw new TRPCError({ code: "NOT_FOUND", message: "Nguồn không tồn tại" });

        // Tái dùng token nếu đã có (idempotent).
        const token = src.shareToken ?? randomUUID();
        await ctx.db
          .update(knowledgeSources)
          .set({ visibility: "public", shareToken: token, updatedAt: new Date() })
          .where(eq(knowledgeSources.id, input));
        return { token };
      }),

    /* Thu hồi share link: xoá token + đặt lại visibility về "company". */
    revokeShareLink: rbacProcedure("edit", "knowledge")
      .input(z.string().uuid())
      .mutation(async ({ ctx, input }) => {
        await ctx.db
          .update(knowledgeSources)
          .set({ visibility: "company", shareToken: null, updatedAt: new Date() })
          .where(
            and(eq(knowledgeSources.id, input), eq(knowledgeSources.companyId, ctx.user.companyId)),
          );
        return { ok: true };
      }),
  }),

  /* ── Thêm nguồn: văn bản dán tay ── */
  addText: rbacProcedure("create", "knowledge")
    .input(
      z.object({
        title: z.string().min(1),
        text: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .insert(knowledgeSources)
        .values({
          companyId: ctx.user.companyId,
          kind: "text",
          title: input.title,
          status: "pending",
          meta: { text: input.text },
          createdBy: ctx.user.id,
        })
        .returning();
      if (!row) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await enqueueKbIngest(row.id);
      return row;
    }),

  /* ── Thêm nguồn: dữ liệu một entity ── */
  addEntity: rbacProcedure("create", "knowledge")
    .input(
      z.object({
        entityId: z.string().uuid(),
        title: z.string().optional(),
        // "embed" (mặc định): nhúng toàn bộ record vào KB. "live": KHÔNG nhúng,
        // truy vấn trực tiếp lúc tra cứu (on-demand) — hợp dữ liệu lớn.
        mode: z.enum(["embed", "live"]).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [ent] = await ctx.db
        .select()
        .from(entities)
        .where(and(eq(entities.id, input.entityId), eq(entities.companyId, ctx.user.companyId)));
      if (!ent) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Entity không tồn tại" });
      }
      const live = input.mode === "live";
      const [row] = await ctx.db
        .insert(knowledgeSources)
        .values({
          companyId: ctx.user.companyId,
          kind: "entity",
          title: input.title?.trim() || `Dữ liệu: ${ent.label}`,
          // Live: sẵn sàng ngay (không cần nạp/embed). Embed: pending → worker nạp.
          status: live ? "ready" : "pending",
          chunkCount: 0,
          meta: live ? { entityId: input.entityId, mode: "live" } : { entityId: input.entityId },
          createdBy: ctx.user.id,
        })
        .returning();
      if (!row) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      if (!live) await enqueueKbIngest(row.id);
      return row;
    }),

  /* ── Nạp lại một nguồn ── */
  reindex: rbacProcedure("edit", "knowledge")
    .input(z.string().uuid())
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .select({ id: knowledgeSources.id })
        .from(knowledgeSources)
        .where(
          and(eq(knowledgeSources.id, input), eq(knowledgeSources.companyId, ctx.user.companyId)),
        );
      if (!row) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Nguồn không tồn tại" });
      }
      await ctx.db
        .update(knowledgeSources)
        .set({ status: "pending", error: null, updatedAt: new Date() })
        .where(eq(knowledgeSources.id, input));
      await enqueueKbIngest(input);
      return { ok: true };
    }),

  /* ── Tra cứu ── */
  search: rbacProcedure("view", "knowledge")
    .input(
      z.object({
        query: z.string().min(1),
        limit: z.number().int().positive().max(20).optional(),
        sourceKind: z.enum(["file", "entity", "text"]).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      // Lọc kết quả theo quyền user/nhóm (admin → acl=null → không lọc).
      const acl = await resolveKnowledgeAcl(ctx.db, ctx.user.role, ctx.user.id);
      return knowledgeSearch(ctx.db, ctx.user.companyId, input.query, {
        limit: input.limit ?? 5,
        sourceKind: input.sourceKind,
        acl: acl ?? undefined,
      });
    }),

  /* ── Cấu hình profile embedding (một bản / công ty) ── */
  embeddingProfile: router({
    get: rbacProcedure("view", "settings").query(async ({ ctx }) => {
      const [row] = await ctx.db
        .select()
        .from(llmProfiles)
        .where(
          and(
            eq(llmProfiles.companyId, ctx.user.companyId),
            eq(llmProfiles.kind, "embedding"),
            isNull(llmProfiles.userId),
          ),
        );
      if (!row) return null;
      return {
        adapter: row.adapter,
        model: row.model,
        endpoint: row.endpoint,
        apiKeyEnc: row.apiKeyEnc ? decryptSecret(row.apiKeyEnc) : null,
      };
    }),

    save: rbacProcedure("edit", "settings")
      .input(
        z.object({
          adapter: z.enum(["ollama", "openai"]),
          model: z.string().min(1),
          endpoint: z.string().optional(),
          apiKeyEnc: z.string().optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const values = {
          adapter: input.adapter,
          model: input.model,
          kind: "embedding",
          endpoint: input.endpoint?.trim() || null,
          apiKeyEnc: input.apiKeyEnc ? encryptSecret(input.apiKeyEnc) : null,
        };
        const [ex] = await ctx.db
          .select({ id: llmProfiles.id })
          .from(llmProfiles)
          .where(
            and(
              eq(llmProfiles.companyId, ctx.user.companyId),
              eq(llmProfiles.kind, "embedding"),
              isNull(llmProfiles.userId),
            ),
          );
        if (ex) {
          await ctx.db.update(llmProfiles).set(values).where(eq(llmProfiles.id, ex.id));
        } else {
          await ctx.db.insert(llmProfiles).values({
            companyId: ctx.user.companyId,
            name: "embedding",
            ...values,
          });
        }
        return { ok: true };
      }),
  }),
});
