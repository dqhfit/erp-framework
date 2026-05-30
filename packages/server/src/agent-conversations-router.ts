/* ==========================================================
   agent-conversations-router.ts — Lịch sử trò chuyện user ↔ agent.
   Per-user (approvedProcedure): mỗi tài khoản chỉ thấy/xoá cuộc trò
   chuyện của mình. saveExchange tạo conversation lần đầu (title từ câu
   hỏi đầu) rồi append từng cặp user/assistant.
   ========================================================== */
import { z } from "zod";
import { and, asc, desc, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { agentConversations, agentMessages } from "@erp-framework/db";
import { approvedProcedure, router } from "./trpc";

export const agentConversationsRouter = router({
  /** Danh sách cuộc trò chuyện của user (mới nhất trước). */
  list: approvedProcedure.query(({ ctx }) =>
    ctx.db
      .select({
        id: agentConversations.id,
        title: agentConversations.title,
        agentId: agentConversations.agentId,
        updatedAt: agentConversations.updatedAt,
        createdAt: agentConversations.createdAt,
      })
      .from(agentConversations)
      .where(
        and(
          eq(agentConversations.companyId, ctx.user.companyId),
          eq(agentConversations.userId, ctx.user.id),
        ),
      )
      .orderBy(desc(agentConversations.updatedAt))
      .limit(200),
  ),

  /** Tin nhắn của 1 cuộc trò chuyện (chỉ chủ sở hữu). */
  messages: approvedProcedure.input(z.string().uuid()).query(async ({ ctx, input }) => {
    const [c] = await ctx.db
      .select({ id: agentConversations.id })
      .from(agentConversations)
      .where(
        and(
          eq(agentConversations.id, input),
          eq(agentConversations.companyId, ctx.user.companyId),
          eq(agentConversations.userId, ctx.user.id),
        ),
      );
    if (!c) throw new TRPCError({ code: "NOT_FOUND", message: "Cuộc trò chuyện không tồn tại." });
    return ctx.db
      .select({ role: agentMessages.role, content: agentMessages.content })
      .from(agentMessages)
      .where(eq(agentMessages.conversationId, input))
      .orderBy(asc(agentMessages.createdAt));
  }),

  /** Lưu 1 lượt trao đổi (user + assistant). conversationId rỗng → tạo mới
   *  (title = câu hỏi đầu, cắt 80 ký tự). Trả về conversationId để client giữ. */
  saveExchange: approvedProcedure
    .input(
      z.object({
        conversationId: z.string().uuid().nullish(),
        agentId: z.string().uuid().nullish(),
        userText: z.string().min(1),
        assistantText: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      let convId = input.conversationId ?? null;
      if (convId) {
        const [c] = await ctx.db
          .select({ id: agentConversations.id })
          .from(agentConversations)
          .where(
            and(
              eq(agentConversations.id, convId),
              eq(agentConversations.companyId, ctx.user.companyId),
              eq(agentConversations.userId, ctx.user.id),
            ),
          );
        if (!c)
          throw new TRPCError({ code: "NOT_FOUND", message: "Cuộc trò chuyện không tồn tại." });
      } else {
        const title = input.userText.trim().slice(0, 80) || "Cuộc trò chuyện";
        const [c] = await ctx.db
          .insert(agentConversations)
          .values({
            companyId: ctx.user.companyId,
            userId: ctx.user.id,
            agentId: input.agentId ?? null,
            title,
          })
          .returning({ id: agentConversations.id });
        if (!c) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        convId = c.id;
      }
      await ctx.db.insert(agentMessages).values([
        { conversationId: convId, role: "user", content: input.userText },
        { conversationId: convId, role: "assistant", content: input.assistantText },
      ]);
      await ctx.db
        .update(agentConversations)
        .set({ updatedAt: new Date() })
        .where(eq(agentConversations.id, convId));
      return { conversationId: convId };
    }),

  /** Đổi tiêu đề cuộc trò chuyện. */
  rename: approvedProcedure
    .input(z.object({ id: z.string().uuid(), title: z.string().min(1).max(120) }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .update(agentConversations)
        .set({ title: input.title.trim(), updatedAt: new Date() })
        .where(
          and(
            eq(agentConversations.id, input.id),
            eq(agentConversations.companyId, ctx.user.companyId),
            eq(agentConversations.userId, ctx.user.id),
          ),
        );
      return { ok: true };
    }),

  /** Xoá 1 cuộc trò chuyện (cascade xoá tin nhắn). Chỉ chủ sở hữu. */
  delete: approvedProcedure.input(z.string().uuid()).mutation(async ({ ctx, input }) => {
    await ctx.db
      .delete(agentConversations)
      .where(
        and(
          eq(agentConversations.id, input),
          eq(agentConversations.companyId, ctx.user.companyId),
          eq(agentConversations.userId, ctx.user.id),
        ),
      );
    return { ok: true };
  }),

  /** Xoá TẤT CẢ lịch sử của user (dọn sạch). */
  deleteAll: approvedProcedure.mutation(async ({ ctx }) => {
    await ctx.db
      .delete(agentConversations)
      .where(
        and(
          eq(agentConversations.companyId, ctx.user.companyId),
          eq(agentConversations.userId, ctx.user.id),
        ),
      );
    return { ok: true };
  }),
});
