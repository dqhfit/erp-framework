/* ==========================================================
   feedback-router.ts — User submit bất cập + đề xuất cải thiện.
   Pipeline: new → in_progress → done (+ wontfix).
   AI enrichment async qua pg-boss queue feedback-ai.
   Tương tác: upvote idempotent + comments + @mention + notify admin.
   ========================================================== */

import {
  feedbackComments,
  feedbackMergeBatches,
  feedbacks,
  feedbackVotes,
  users,
} from "@erp-framework/db";
import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { logActivity } from "./activity";
import { embedTexts } from "./embeddings";
import { enqueueFeedbackAi } from "./feedback-ai";
import { callLlmJson } from "./llm-json";
import { notifyAdmins, notifyMentions } from "./notifications-router";
import { rbacProcedure, router } from "./trpc";

const AREA_VALUES = [
  "entity",
  "workflow",
  "agent",
  "settings",
  "ui",
  "performance",
  "other",
] as const;
const ZArea = z.enum(AREA_VALUES);
const ZSeverity = z.enum(["nice_to_have", "normal", "blocker"]);
const ZStatus = z.enum(["new", "in_progress", "done", "wontfix"]);

/** Author trong vòng 1h hoặc admin được phép edit/delete. */
function canMutate(authorId: string, role: string, createdAt: Date, userId: string): boolean {
  if (role === "admin") return true;
  if (authorId !== userId) return false;
  return Date.now() - createdAt.getTime() < 60 * 60 * 1000;
}

const AREA_LABEL: Record<string, string> = {
  entity: "Thực thể / dữ liệu",
  workflow: "Quy trình",
  agent: "Agent",
  settings: "Cấu hình",
  ui: "Giao diện",
  performance: "Hiệu năng",
  other: "Khác",
};

type MergeRow = {
  id: string;
  title: string;
  body: string;
  suggestion: string | null;
  area: string;
  severity: string;
  status: string;
  voteCount: number;
  authorUserId: string;
  createdAt: Date;
};

/** Điều kiện lọc feedback dùng chung cho gộp + lưu đợt. Không chọn status
 *  cụ thể → mặc định lấy các mục CHƯA xử lý (new + in_progress). */
function feedbackFilterConds(
  companyId: string,
  userId: string,
  input: { status?: z.infer<typeof ZStatus>; area?: z.infer<typeof ZArea>; mine?: boolean },
) {
  const conds = [eq(feedbacks.companyId, companyId), isNull(feedbacks.deletedAt)];
  if (input.status) conds.push(eq(feedbacks.status, input.status));
  else conds.push(inArray(feedbacks.status, ["new", "in_progress"]));
  if (input.area) conds.push(eq(feedbacks.area, input.area));
  if (input.mine) conds.push(eq(feedbacks.authorUserId, userId));
  return conds;
}

/** Ghép danh sách feedback thành 1 tài liệu markdown, nhóm theo khu vực.
 *  Hàm thuần (không I/O) — dễ unit-test. */
export function buildMergeMarkdown(rows: MergeRow[], authorMap: Map<string, string>): string {
  if (rows.length === 0) return "# Tổng hợp phản hồi & đề xuất\n\n_Không có mục nào._\n";
  const byArea = new Map<string, MergeRow[]>();
  for (const r of rows) {
    const list = byArea.get(r.area);
    if (list) list.push(r);
    else byArea.set(r.area, [r]);
  }
  const lines: string[] = [`# Tổng hợp phản hồi & đề xuất (${rows.length} mục)`, ""];
  for (const [area, items] of byArea) {
    lines.push(`## ${AREA_LABEL[area] ?? area} (${items.length})`, "");
    for (const r of items) {
      const author = authorMap.get(r.authorUserId) ?? "Ẩn danh";
      const date = r.createdAt.toISOString().slice(0, 10);
      lines.push(`### ${r.title}`);
      lines.push(
        `- Trạng thái: ${r.status} · Mức độ: ${r.severity} · Vote: ${r.voteCount} · ${author} · ${date}`,
      );
      lines.push(`- Tình trạng: ${r.body.trim()}`);
      if (r.suggestion?.trim()) lines.push(`- Đề xuất: ${r.suggestion.trim()}`);
      lines.push("");
    }
  }
  return lines.join("\n");
}

export const feedbackRouter = router({
  list: rbacProcedure("view", "feedback")
    .input(
      z
        .object({
          status: ZStatus.optional(),
          area: ZArea.optional(),
          mine: z.boolean().optional(),
          limit: z.number().int().positive().max(200).optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const conds = [eq(feedbacks.companyId, ctx.user.companyId), isNull(feedbacks.deletedAt)];
      if (input?.status) conds.push(eq(feedbacks.status, input.status));
      if (input?.area) conds.push(eq(feedbacks.area, input.area));
      if (input?.mine) conds.push(eq(feedbacks.authorUserId, ctx.user.id));
      const rows = await ctx.db
        .select({
          id: feedbacks.id,
          title: feedbacks.title,
          area: feedbacks.area,
          severity: feedbacks.severity,
          status: feedbacks.status,
          voteCount: feedbacks.voteCount,
          aiSummary: feedbacks.aiSummary,
          aiTags: feedbacks.aiTags,
          authorUserId: feedbacks.authorUserId,
          createdAt: feedbacks.createdAt,
        })
        .from(feedbacks)
        .where(and(...conds))
        .orderBy(desc(feedbacks.voteCount), desc(feedbacks.createdAt))
        .limit(input?.limit ?? 100);
      return rows;
    }),

  get: rbacProcedure("view", "feedback")
    .input(z.string().uuid())
    .query(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .select()
        .from(feedbacks)
        .where(
          and(
            eq(feedbacks.id, input),
            eq(feedbacks.companyId, ctx.user.companyId),
            isNull(feedbacks.deletedAt),
          ),
        );
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Feedback không tồn tại" });
      const [vote] = await ctx.db
        .select({ userId: feedbackVotes.userId })
        .from(feedbackVotes)
        .where(and(eq(feedbackVotes.feedbackId, input), eq(feedbackVotes.userId, ctx.user.id)));
      // KHÔNG trả embedding (768 floats) ra client — tốn băng thông, không dùng.
      const { embedding: _omit, ...safe } = row;
      void _omit;
      return { ...safe, myVote: !!vote };
    }),

  create: rbacProcedure("create", "feedback")
    .input(
      z.object({
        title: z.string().min(3).max(200),
        body: z.string().min(10).max(10_000),
        suggestion: z.string().max(10_000).optional(),
        area: ZArea,
        url: z.string().max(500).optional(),
        entityRef: z
          .object({
            entityId: z.string().uuid().optional(),
            recordId: z.string().uuid().optional(),
          })
          .optional(),
        severity: ZSeverity.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .insert(feedbacks)
        .values({
          companyId: ctx.user.companyId,
          authorUserId: ctx.user.id,
          title: input.title.trim(),
          body: input.body,
          suggestion: input.suggestion?.trim() || null,
          area: input.area,
          url: input.url ?? null,
          entityRef: input.entityRef ?? null,
          severity: input.severity ?? "normal",
          status: "new",
        })
        .returning();
      if (!row) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const url = `/feedback/${row.id}`;
      // Fire-and-forget — không chặn user response.
      void enqueueFeedbackAi(row.id).catch((e) =>
        console.warn("[feedback] enqueue AI lỗi:", (e as Error).message),
      );
      void notifyAdmins(ctx.db, {
        companyId: ctx.user.companyId,
        actorUserId: ctx.user.id,
        body: `[Feedback mới] ${row.title}`,
        targetUrl: url,
        kind: "feedback_new",
      });
      void notifyMentions(ctx.db, {
        companyId: ctx.user.companyId,
        actorUserId: ctx.user.id,
        body: `${row.title}\n${row.body}`,
        targetUrl: url,
        kind: "feedback_mention",
      });
      void logActivity(ctx.db, {
        companyId: ctx.user.companyId,
        kind: "feedback.create",
        target: row.id,
        detail: row.title,
        actorUserId: ctx.user.id,
      });
      return row;
    }),

  update: rbacProcedure("edit", "feedback")
    .input(
      z.object({
        id: z.string().uuid(),
        title: z.string().min(3).max(200).optional(),
        body: z.string().min(10).max(10_000).optional(),
        suggestion: z.string().max(10_000).optional(),
        area: ZArea.optional(),
        severity: ZSeverity.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .select()
        .from(feedbacks)
        .where(and(eq(feedbacks.id, input.id), eq(feedbacks.companyId, ctx.user.companyId)));
      if (!row) throw new TRPCError({ code: "NOT_FOUND" });
      if (!canMutate(row.authorUserId, ctx.user.role, row.createdAt, ctx.user.id)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Chỉ author trong 1h hoặc admin được sửa",
        });
      }
      const patch: Record<string, unknown> = { updatedAt: new Date() };
      if (input.title !== undefined) patch.title = input.title.trim();
      if (input.body !== undefined) patch.body = input.body;
      if (input.suggestion !== undefined) patch.suggestion = input.suggestion;
      if (input.area !== undefined) patch.area = input.area;
      if (input.severity !== undefined) patch.severity = input.severity;
      await ctx.db.update(feedbacks).set(patch).where(eq(feedbacks.id, input.id));
      // Re-enqueue AI nếu nội dung thay đổi.
      if (input.title || input.body || input.suggestion) {
        void enqueueFeedbackAi(input.id).catch(() => {});
      }
      return { ok: true };
    }),

  setStatus: rbacProcedure("edit", "feedback")
    .input(
      z.object({
        id: z.string().uuid(),
        status: ZStatus,
        resolutionNote: z.string().max(2000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .select()
        .from(feedbacks)
        .where(and(eq(feedbacks.id, input.id), eq(feedbacks.companyId, ctx.user.companyId)));
      if (!row) throw new TRPCError({ code: "NOT_FOUND" });
      if (row.status === input.status) return { ok: true };
      await ctx.db
        .update(feedbacks)
        .set({
          status: input.status,
          resolutionNote: input.resolutionNote ?? row.resolutionNote,
          updatedAt: new Date(),
        })
        .where(eq(feedbacks.id, input.id));

      // Notify author + những người đã comment.
      const targets = new Set<string>();
      if (row.authorUserId !== ctx.user.id) targets.add(row.authorUserId);
      const cs = await ctx.db
        .select({ authorUserId: feedbackComments.authorUserId })
        .from(feedbackComments)
        .where(eq(feedbackComments.feedbackId, input.id));
      for (const c of cs) if (c.authorUserId !== ctx.user.id) targets.add(c.authorUserId);
      const url = `/feedback/${input.id}`;
      const body = `Feedback "${row.title}" đổi trạng thái → ${input.status}`;
      if (targets.size > 0) {
        // Reuse insert pattern: 1 row mỗi target.
        await ctx.db.insert((await import("@erp-framework/db")).notifications).values(
          [...targets].map((uid) => ({
            companyId: ctx.user.companyId,
            userId: uid,
            kind: "feedback_status",
            targetUrl: url,
            actorUserId: ctx.user.id,
            body,
          })),
        );
      }
      void logActivity(ctx.db, {
        companyId: ctx.user.companyId,
        kind: "feedback.status",
        target: input.id,
        detail: `${row.status} → ${input.status}`,
        actorUserId: ctx.user.id,
      });
      return { ok: true };
    }),

  delete: rbacProcedure("delete", "feedback")
    .input(z.string().uuid())
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .select({
          authorUserId: feedbacks.authorUserId,
          createdAt: feedbacks.createdAt,
        })
        .from(feedbacks)
        .where(and(eq(feedbacks.id, input), eq(feedbacks.companyId, ctx.user.companyId)));
      if (!row) throw new TRPCError({ code: "NOT_FOUND" });
      if (!canMutate(row.authorUserId, ctx.user.role, row.createdAt, ctx.user.id)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Chỉ author trong 1h hoặc admin được xoá",
        });
      }
      await ctx.db
        .update(feedbacks)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(eq(feedbacks.id, input));
      return { ok: true };
    }),

  vote: rbacProcedure("view", "feedback")
    .input(z.string().uuid())
    .mutation(async ({ ctx, input }) => {
      // ON CONFLICT DO NOTHING — idempotent.
      await ctx.db
        .insert(feedbackVotes)
        .values({
          feedbackId: input,
          userId: ctx.user.id,
        })
        .onConflictDoNothing();
      await ctx.db.execute(sql`
        UPDATE feedbacks SET vote_count = (
          SELECT count(*) FROM feedback_votes WHERE feedback_id = ${input}
        ) WHERE id = ${input}
      `);
      return { ok: true };
    }),

  unvote: rbacProcedure("view", "feedback")
    .input(z.string().uuid())
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .delete(feedbackVotes)
        .where(and(eq(feedbackVotes.feedbackId, input), eq(feedbackVotes.userId, ctx.user.id)));
      await ctx.db.execute(sql`
        UPDATE feedbacks SET vote_count = (
          SELECT count(*) FROM feedback_votes WHERE feedback_id = ${input}
        ) WHERE id = ${input}
      `);
      return { ok: true };
    }),

  /* ── Comments — clone style record-comments-router.ts ─────────── */
  listComments: rbacProcedure("view", "feedback")
    .input(z.string().uuid())
    .query(async ({ ctx, input }) => {
      const [fb] = await ctx.db
        .select({ id: feedbacks.id })
        .from(feedbacks)
        .where(and(eq(feedbacks.id, input), eq(feedbacks.companyId, ctx.user.companyId)));
      if (!fb) throw new TRPCError({ code: "NOT_FOUND" });
      return ctx.db
        .select({
          id: feedbackComments.id,
          parentId: feedbackComments.parentId,
          authorUserId: feedbackComments.authorUserId,
          body: feedbackComments.body,
          createdAt: feedbackComments.createdAt,
        })
        .from(feedbackComments)
        .where(and(eq(feedbackComments.feedbackId, input), isNull(feedbackComments.deletedAt)))
        .orderBy(asc(feedbackComments.createdAt));
    }),

  addComment: rbacProcedure("view", "feedback")
    .input(
      z.object({
        feedbackId: z.string().uuid(),
        parentId: z.string().uuid().optional(),
        body: z.string().min(1).max(5000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [fb] = await ctx.db
        .select({ id: feedbacks.id, title: feedbacks.title })
        .from(feedbacks)
        .where(
          and(eq(feedbacks.id, input.feedbackId), eq(feedbacks.companyId, ctx.user.companyId)),
        );
      if (!fb) throw new TRPCError({ code: "NOT_FOUND" });
      const [row] = await ctx.db
        .insert(feedbackComments)
        .values({
          companyId: ctx.user.companyId,
          feedbackId: input.feedbackId,
          parentId: input.parentId ?? null,
          authorUserId: ctx.user.id,
          body: input.body,
        })
        .returning();
      void notifyMentions(ctx.db, {
        companyId: ctx.user.companyId,
        actorUserId: ctx.user.id,
        body: input.body,
        targetUrl: `/feedback/${input.feedbackId}`,
        kind: "feedback_mention",
      });
      return row;
    }),

  deleteComment: rbacProcedure("view", "feedback")
    .input(z.string().uuid())
    .mutation(async ({ ctx, input }) => {
      const [c] = await ctx.db
        .select({
          authorUserId: feedbackComments.authorUserId,
          createdAt: feedbackComments.createdAt,
        })
        .from(feedbackComments)
        .where(
          and(eq(feedbackComments.id, input), eq(feedbackComments.companyId, ctx.user.companyId)),
        );
      if (!c) throw new TRPCError({ code: "NOT_FOUND" });
      if (!canMutate(c.authorUserId, ctx.user.role, c.createdAt, ctx.user.id)) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      await ctx.db
        .update(feedbackComments)
        .set({ deletedAt: new Date() })
        .where(eq(feedbackComments.id, input));
      return { ok: true };
    }),

  /* Tìm feedback tương tự qua cosine (<=>). Gọi từ submit modal trước
     khi user bấm Submit — chặn duplicate sớm. */
  findSimilar: rbacProcedure("view", "feedback")
    .input(
      z.object({
        title: z.string().min(3),
        body: z.string().optional().default(""),
        limit: z.number().int().positive().max(10).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      let vec: number[];
      try {
        const r = await embedTexts(ctx.db, ctx.user.companyId, [`${input.title}\n${input.body}`]);
        if (!r[0]) return [];
        vec = r[0];
      } catch (e) {
        // Embedding profile chưa cấu hình → không cản UI.
        console.warn("[feedback/similar] embed lỗi:", (e as Error).message);
        return [];
      }
      const limit = input.limit ?? 3;
      // pgvector: <=> = cosine distance (0 = giống nhất). Similarity = 1 - dist.
      const vecLit = sql`${"[" + vec.join(",") + "]"}::vector`;
      const rows = await ctx.db.execute<{
        id: string;
        title: string;
        status: string;
        vote_count: number;
        similarity: number;
      }>(sql`
        SELECT id, title, status, vote_count,
               1 - (embedding <=> ${vecLit}) AS similarity
        FROM feedbacks
        WHERE company_id = ${ctx.user.companyId}
          AND deleted_at IS NULL
          AND embedding IS NOT NULL
          AND status IN ('new', 'in_progress')
        ORDER BY embedding <=> ${vecLit}
        LIMIT ${limit}
      `);
      // pg trả ResultRow — chuẩn hoá ra mảng.
      const list = Array.isArray(rows)
        ? rows
        : ((rows as unknown as { rows: (typeof rows)[] }).rows ?? []);
      return list.filter((r: { similarity: number }) => r.similarity > 0.6);
    }),

  /* Admin gộp tất cả feedback (theo filter đang xem) thành 1 tài liệu copy được.
     - ai=false (mặc định): ghép thẳng markdown, nhanh, luôn chạy được.
     - ai=true: nhờ LLM tổng hợp/khử trùng. FAIL-SAFE: LLM lỗi/chưa cấu hình →
       trả bản ghép thẳng kèm cờ aiFailed (xem CLAUDE.md mục AI fail-safe). */
  mergeExport: rbacProcedure("edit", "feedback")
    .input(
      z.object({
        status: ZStatus.optional(),
        area: ZArea.optional(),
        mine: z.boolean().optional(),
        ai: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Chỉ admin được gộp phản hồi" });
      }
      const conds = feedbackFilterConds(ctx.user.companyId, ctx.user.id, input);

      const rows = await ctx.db
        .select({
          id: feedbacks.id,
          title: feedbacks.title,
          body: feedbacks.body,
          suggestion: feedbacks.suggestion,
          area: feedbacks.area,
          severity: feedbacks.severity,
          status: feedbacks.status,
          voteCount: feedbacks.voteCount,
          authorUserId: feedbacks.authorUserId,
          createdAt: feedbacks.createdAt,
        })
        .from(feedbacks)
        .where(and(...conds))
        .orderBy(asc(feedbacks.area), desc(feedbacks.voteCount), desc(feedbacks.createdAt));

      // Tên tác giả: 1 query gom theo id.
      const authorIds = [...new Set(rows.map((r) => r.authorUserId))];
      const authorMap = new Map<string, string>();
      if (authorIds.length > 0) {
        const us = await ctx.db
          .select({ id: users.id, name: users.name })
          .from(users)
          .where(inArray(users.id, authorIds));
        for (const u of us) authorMap.set(u.id, u.name);
      }

      const rawMarkdown = buildMergeMarkdown(rows, authorMap);
      // items: danh sách rút gọn để UI hiện checkbox + đổi trạng thái — KHỚP
      // đúng tập đã gộp (cùng filter/default), tránh lệch với bản markdown.
      const items = rows.map((r) => ({ id: r.id, title: r.title, status: r.status }));
      if (!input.ai) {
        return { markdown: rawMarkdown, count: rows.length, mode: "raw" as const, items };
      }

      // Nhánh AI — bao try + fail-safe về bản ghép thẳng.
      let aiDoc: string | null = null;
      try {
        const r = await callLlmJson<{ document: string }>(ctx.db, ctx.user.companyId, {
          system:
            "Bạn là trợ lý tổng hợp phản hồi sản phẩm ERP. Đầu vào là danh sách phản hồi/đề " +
            "xuất dạng markdown. Hãy gộp thành MỘT tài liệu gọn gàng bằng tiếng Việt: gom các " +
            "mục trùng hoặc liên quan, tóm tắt vấn đề chung, nêu đề xuất hành động, sắp theo " +
            'mức ưu tiên. Trả JSON đúng dạng {"document": "<nội dung markdown>"}.',
          user: rawMarkdown,
          maxTokens: 2048,
          userId: ctx.user.id,
        });
        aiDoc = r?.document?.trim() || null;
      } catch (e) {
        console.warn("[feedback/merge] AI tổng hợp lỗi:", (e as Error).message);
      }
      if (!aiDoc) {
        return {
          markdown: rawMarkdown,
          count: rows.length,
          mode: "raw" as const,
          items,
          aiFailed: true,
        };
      }
      return { markdown: aiDoc, count: rows.length, mode: "ai" as const, items };
    }),

  /* Admin đổi trạng thái HÀNG LOẠT cho các feedback đã chọn (vd sau khi gộp,
     đánh dấu in_progress). Chỉ cập nhật mục thực sự đổi status + notify author. */
  bulkSetStatus: rbacProcedure("edit", "feedback")
    .input(
      z.object({
        ids: z.array(z.string().uuid()).min(1).max(200),
        status: ZStatus,
        resolutionNote: z.string().max(2000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const rows = await ctx.db
        .select({
          id: feedbacks.id,
          authorUserId: feedbacks.authorUserId,
          title: feedbacks.title,
          status: feedbacks.status,
        })
        .from(feedbacks)
        .where(
          and(
            eq(feedbacks.companyId, ctx.user.companyId),
            inArray(feedbacks.id, input.ids),
            isNull(feedbacks.deletedAt),
          ),
        );
      const toUpdate = rows.filter((r) => r.status !== input.status);
      if (toUpdate.length === 0) return { ok: true, updated: 0 };

      const ids = toUpdate.map((r) => r.id);
      const patch: { status: typeof input.status; updatedAt: Date; resolutionNote?: string } = {
        status: input.status,
        updatedAt: new Date(),
      };
      if (input.resolutionNote !== undefined) patch.resolutionNote = input.resolutionNote;
      await ctx.db
        .update(feedbacks)
        .set(patch)
        .where(and(eq(feedbacks.companyId, ctx.user.companyId), inArray(feedbacks.id, ids)));

      // Notify author mỗi mục (bỏ qua chính mình).
      const targets = toUpdate.filter((r) => r.authorUserId !== ctx.user.id);
      if (targets.length > 0) {
        const { notifications } = await import("@erp-framework/db");
        await ctx.db.insert(notifications).values(
          targets.map((r) => ({
            companyId: ctx.user.companyId,
            userId: r.authorUserId,
            kind: "feedback_status",
            targetUrl: `/feedback/${r.id}`,
            actorUserId: ctx.user.id,
            body: `Feedback "${r.title}" đổi trạng thái → ${input.status}`,
          })),
        );
      }
      void logActivity(ctx.db, {
        companyId: ctx.user.companyId,
        kind: "feedback.bulk_status",
        target: ids.join(","),
        detail: `${ids.length} mục → ${input.status}`,
        actorUserId: ctx.user.id,
      });
      return { ok: true, updated: ids.length };
    }),

  /* ── Đợt gộp (merge batch) — admin "đánh dấu" 1 lần gộp ───────────── */
  /** Lưu tập feedback đang gộp (theo filter) thành 1 đợt để đổi trạng thái
      hàng loạt sau. feedbackIds là snapshot tại thời điểm lưu. */
  saveMergeBatch: rbacProcedure("edit", "feedback")
    .input(
      z.object({
        status: ZStatus.optional(),
        area: ZArea.optional(),
        mine: z.boolean().optional(),
        label: z.string().max(200).optional(),
        note: z.string().max(2000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Chỉ admin được lưu đợt gộp" });
      }
      const conds = feedbackFilterConds(ctx.user.companyId, ctx.user.id, input);
      const rows = await ctx.db
        .select({ id: feedbacks.id })
        .from(feedbacks)
        .where(and(...conds));
      if (rows.length === 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Không có mục nào để lưu" });
      }
      const ids = rows.map((r) => r.id);
      const label =
        input.label?.trim() || `Đợt gộp ${new Date().toISOString().slice(0, 16).replace("T", " ")}`;
      const [row] = await ctx.db
        .insert(feedbackMergeBatches)
        .values({
          companyId: ctx.user.companyId,
          createdBy: ctx.user.id,
          label,
          note: input.note?.trim() || null,
          filterSnapshot: { status: input.status, area: input.area, mine: input.mine ?? false },
          feedbackIds: ids,
          itemCount: ids.length,
        })
        .returning();
      void logActivity(ctx.db, {
        companyId: ctx.user.companyId,
        kind: "feedback.merge_batch",
        target: row?.id ?? "",
        detail: `${label} (${ids.length} mục)`,
        actorUserId: ctx.user.id,
      });
      return row;
    }),

  listMergeBatches: rbacProcedure("view", "feedback").query(async ({ ctx }) => {
    if (ctx.user.role !== "admin") {
      throw new TRPCError({ code: "FORBIDDEN", message: "Chỉ admin xem đợt gộp" });
    }
    return ctx.db
      .select({
        id: feedbackMergeBatches.id,
        label: feedbackMergeBatches.label,
        note: feedbackMergeBatches.note,
        itemCount: feedbackMergeBatches.itemCount,
        createdAt: feedbackMergeBatches.createdAt,
      })
      .from(feedbackMergeBatches)
      .where(eq(feedbackMergeBatches.companyId, ctx.user.companyId))
      .orderBy(desc(feedbackMergeBatches.createdAt))
      .limit(100);
  }),

  /** Chi tiết 1 đợt + danh sách item HIỆN TẠI (bỏ mục đã xoá). */
  getMergeBatch: rbacProcedure("view", "feedback")
    .input(z.string().uuid())
    .query(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Chỉ admin xem đợt gộp" });
      }
      const [batch] = await ctx.db
        .select()
        .from(feedbackMergeBatches)
        .where(
          and(
            eq(feedbackMergeBatches.id, input),
            eq(feedbackMergeBatches.companyId, ctx.user.companyId),
          ),
        );
      if (!batch) throw new TRPCError({ code: "NOT_FOUND", message: "Đợt gộp không tồn tại" });
      const ids = Array.isArray(batch.feedbackIds) ? (batch.feedbackIds as string[]) : [];
      let items: Array<{ id: string; title: string; status: string }> = [];
      if (ids.length > 0) {
        items = await ctx.db
          .select({ id: feedbacks.id, title: feedbacks.title, status: feedbacks.status })
          .from(feedbacks)
          .where(
            and(
              eq(feedbacks.companyId, ctx.user.companyId),
              inArray(feedbacks.id, ids),
              isNull(feedbacks.deletedAt),
            ),
          );
      }
      return { ...batch, items };
    }),

  deleteMergeBatch: rbacProcedure("edit", "feedback")
    .input(z.string().uuid())
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Chỉ admin xoá đợt gộp" });
      }
      await ctx.db
        .delete(feedbackMergeBatches)
        .where(
          and(
            eq(feedbackMergeBatches.id, input),
            eq(feedbackMergeBatches.companyId, ctx.user.companyId),
          ),
        );
      return { ok: true };
    }),
});
