/* ==========================================================
   chat-router.ts — Chat noi bo nhan vien (DM 1-1 + nhom).
   Per-user, membership-gated: moi thao tac tren 1 cuoc tro chuyen
   deu kiem tra caller la thanh vien (scope theo company → cach ly tenant).
   Real-time qua ws-hub: kenh "chat:<conversationId>" (tin trong thread)
   + "chat-inbox:<userId>" (cap nhat danh sach/badge cho tung thanh vien).
   @mention tai dung notifyMentions (notifications + chuong).
   ========================================================== */
import {
  chatConversations,
  chatMembers,
  chatMessageReactions,
  chatMessages,
  companyMembers,
  users,
} from "@erp-framework/db";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "./db";
import { notifyMentions } from "./notifications-router";
import { approvedProcedure, rateLimit, router } from "./trpc";
import { getOnlineUserIds, publish } from "./ws-hub";

/** Caller co phai thanh vien cuoc tro chuyen (cung company)? Dung cho
 *  ca tRPC handler lan kiem tra subscribe WS (xem index.ts /ws). */
export async function isChatMember(
  db: DB,
  conversationId: string,
  userId: string,
  companyId: string,
): Promise<boolean> {
  const rows = await db
    .select({ userId: chatMembers.userId })
    .from(chatMembers)
    .innerJoin(chatConversations, eq(chatMembers.conversationId, chatConversations.id))
    .where(
      and(
        eq(chatMembers.conversationId, conversationId),
        eq(chatMembers.userId, userId),
        eq(chatConversations.companyId, companyId),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/** Cac userId con lai trong cuoc tro chuyen (tru `except`). */
async function otherMemberIds(db: DB, conversationId: string, except: string): Promise<string[]> {
  const rows = await db
    .select({ userId: chatMembers.userId })
    .from(chatMembers)
    .where(eq(chatMembers.conversationId, conversationId));
  return rows.map((r) => r.userId).filter((u) => u !== except);
}

/** Publish event vao inbox tung user (cap nhat list + badge). Best-effort. */
function publishInbox(userIds: string[], payload: unknown): void {
  for (const uid of userIds) publish(`chat-inbox:${uid}`, payload);
}

/** Gom reaction tho thanh [{ emoji, count, mine }] cho 1 tin nhan. */
function summarizeReactions(
  raw: { emoji: string; userId: string }[] | undefined,
  me: string,
): { emoji: string; count: number; mine: boolean }[] {
  if (!raw || raw.length === 0) return [];
  const map = new Map<string, { emoji: string; count: number; mine: boolean }>();
  for (const r of raw) {
    const e = map.get(r.emoji) ?? { emoji: r.emoji, count: 0, mine: false };
    e.count += 1;
    if (r.userId === me) e.mine = true;
    map.set(r.emoji, e);
  }
  return [...map.values()];
}

type ChatCtx = { db: DB; user: { id: string; name: string; companyId: string } };

/** Nem FORBIDDEN neu caller khong thuoc cuoc tro chuyen. */
async function assertMember(ctx: ChatCtx, conversationId: string): Promise<void> {
  const ok = await isChatMember(ctx.db, conversationId, ctx.user.id, ctx.user.companyId);
  if (!ok) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Ban khong thuoc cuoc tro chuyen nay." });
  }
}

/** Lay 1 tin nhan (scope company) de sua/xoa/react. Nem NOT_FOUND neu thieu.
 *  Caller tu kiem tra quyen (chu tin cho edit/remove; member cho react). */
async function loadOwnableMessage(
  ctx: ChatCtx,
  messageId: string,
): Promise<{ id: string; conversationId: string; senderUserId: string; deletedAt: Date | null }> {
  const [msg] = await ctx.db
    .select({
      id: chatMessages.id,
      conversationId: chatMessages.conversationId,
      senderUserId: chatMessages.senderUserId,
      deletedAt: chatMessages.deletedAt,
    })
    .from(chatMessages)
    .where(and(eq(chatMessages.id, messageId), eq(chatMessages.companyId, ctx.user.companyId)))
    .limit(1);
  if (!msg) throw new TRPCError({ code: "NOT_FOUND", message: "Tin nhan khong ton tai." });
  return msg;
}

/** publish bao boc try/catch — realtime loi KHONG vo thao tac chinh. */
function safePublish(channel: string, payload: unknown): void {
  try {
    publish(channel, payload);
  } catch (e) {
    console.error("[chat] realtime loi:", (e as Error).message);
  }
}

/** Dinh kem hop le: `url` PHAI la signed URL noi bo (/f/<token>) do server
 *  sinh — chong chen URL ngoai (XSS/SSRF khi render anh/link). */
const attachmentSchema = z.object({
  url: z
    .string()
    .max(2000)
    .regex(/^\/f\//, "URL đính kèm không hợp lệ"),
  name: z.string().min(1).max(255),
  mime: z.string().max(120).optional(),
  size: z.number().int().nonnegative().optional(),
});

export const chatRouter = router({
  /** Danh ba thanh vien cong ty (de bat dau chat). UI tu loc bo chinh minh. */
  directory: approvedProcedure.query(({ ctx }) =>
    ctx.db
      .select({
        userId: users.id,
        name: users.name,
        email: users.email,
        role: companyMembers.role,
      })
      .from(companyMembers)
      .innerJoin(users, eq(companyMembers.userId, users.id))
      .where(
        and(eq(companyMembers.companyId, ctx.user.companyId), eq(companyMembers.disabled, false)),
      ),
  ),

  /** Tong so tin chua doc (cho badge tren nav/topbar). */
  unreadTotal: approvedProcedure.query(async ({ ctx }) => {
    const rows = (await ctx.db.execute(sql`
      SELECT count(*)::int AS n
        FROM chat_members m
        JOIN chat_messages msg ON msg.conversation_id = m.conversation_id
         AND msg.deleted_at IS NULL
         AND msg.sender_user_id <> m.user_id
         AND (m.last_read_at IS NULL OR msg.created_at > m.last_read_at)
        JOIN chat_conversations c ON c.id = m.conversation_id
       WHERE m.user_id = ${ctx.user.id} AND c.company_id = ${ctx.user.companyId}
    `)) as unknown as Array<{ n: number }>;
    return { count: Number(rows[0]?.n ?? 0) };
  }),

  /** userId dang online trong cong ty (presence cham xanh). Poll ~20s. */
  presenceOnline: approvedProcedure.query(({ ctx }) => ({
    online: getOnlineUserIds(ctx.user.companyId),
  })),

  /** Tim tin nhan trong cac hoi thoai cua toi (ILIKE, cung company). */
  search: approvedProcedure
    .input(
      z.object({
        q: z.string().min(1).max(100),
        limit: z.number().int().positive().max(50).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const pattern = `%${input.q}%`;
      const rows = (await ctx.db.execute(sql`
        SELECT msg.id, msg.conversation_id AS "conversationId", msg.body,
               msg.created_at AS "createdAt", msg.sender_user_id AS "senderUserId"
          FROM chat_messages msg
          JOIN chat_members m ON m.conversation_id = msg.conversation_id AND m.user_id = ${ctx.user.id}
         WHERE msg.company_id = ${ctx.user.companyId}
           AND msg.deleted_at IS NULL
           AND msg.body ILIKE ${pattern}
         ORDER BY msg.created_at DESC
         LIMIT ${input.limit ?? 30}
      `)) as unknown as Array<Record<string, unknown>>;
      return rows;
    }),

  conversations: router({
    /** Danh sach cuoc tro chuyen cua toi + tin cuoi + so chua doc + thanh vien. */
    list: approvedProcedure.query(async ({ ctx }) => {
      const rows = (await ctx.db.execute(sql`
        SELECT c.id, c.kind, c.title,
               c.updated_at AS "updatedAt",
               m.last_read_at AS "lastReadAt",
               (SELECT count(*) FROM chat_messages msg
                  WHERE msg.conversation_id = c.id
                    AND msg.deleted_at IS NULL
                    AND msg.sender_user_id <> ${ctx.user.id}
                    AND (m.last_read_at IS NULL OR msg.created_at > m.last_read_at)
               )::int AS "unread",
               (SELECT json_build_object('body', x.body, 'createdAt', x.created_at,
                                         'senderUserId', x.sender_user_id)
                  FROM chat_messages x
                 WHERE x.conversation_id = c.id AND x.deleted_at IS NULL
                 ORDER BY x.created_at DESC LIMIT 1) AS "lastMessage",
               (SELECT json_agg(json_build_object('userId', u.id, 'name', u.name, 'email', u.email))
                  FROM chat_members mm JOIN users u ON u.id = mm.user_id
                 WHERE mm.conversation_id = c.id) AS "members"
          FROM chat_members m
          JOIN chat_conversations c ON c.id = m.conversation_id
         WHERE m.user_id = ${ctx.user.id} AND c.company_id = ${ctx.user.companyId}
         ORDER BY c.updated_at DESC
         LIMIT 200
      `)) as unknown as Array<Record<string, unknown>>;
      return rows.map((r) => ({ ...r, unread: Number(r.unread ?? 0) }));
    }),

    /** Mo (hoac tao) DM 1-1 voi 1 nguoi cung cong ty. Idempotent theo dm_key. */
    openDm: approvedProcedure
      .input(z.object({ userId: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        const me = ctx.user.id;
        const co = ctx.user.companyId;
        const other = input.userId;
        if (other === me) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Khong the tu nhan tin chinh minh.",
          });
        }
        // Doi phuong phai la thanh vien cong ty hien tai.
        const [peer] = await ctx.db
          .select({ userId: companyMembers.userId })
          .from(companyMembers)
          .where(and(eq(companyMembers.companyId, co), eq(companyMembers.userId, other)))
          .limit(1);
        if (!peer) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Nguoi dung khong thuoc cong ty." });
        }
        const dmKey = [me, other].sort().join(":");
        // DM da ton tai?
        const [existing] = await ctx.db
          .select({ id: chatConversations.id })
          .from(chatConversations)
          .where(and(eq(chatConversations.companyId, co), eq(chatConversations.dmKey, dmKey)))
          .limit(1);
        if (existing) return { conversationId: existing.id, created: false };
        // Tao moi — onConflictDoNothing chong race (unique dm_key).
        const [conv] = await ctx.db
          .insert(chatConversations)
          .values({ companyId: co, kind: "dm", dmKey, createdBy: me })
          .onConflictDoNothing()
          .returning({ id: chatConversations.id });
        if (!conv) {
          // Bi race: cuoc tro chuyen vua duoc tao boi request khac → doc lai.
          const [again] = await ctx.db
            .select({ id: chatConversations.id })
            .from(chatConversations)
            .where(and(eq(chatConversations.companyId, co), eq(chatConversations.dmKey, dmKey)))
            .limit(1);
          if (!again) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
          return { conversationId: again.id, created: false };
        }
        await ctx.db.insert(chatMembers).values([
          { conversationId: conv.id, userId: me, role: "owner" },
          { conversationId: conv.id, userId: other, role: "member" },
        ]);
        publishInbox([other], { type: "conversation", conversationId: conv.id });
        return { conversationId: conv.id, created: true };
      }),

    /** Tao nhom moi voi danh sach thanh vien (luon gom nguoi tao). */
    createGroup: approvedProcedure
      .input(
        z.object({
          title: z.string().min(1).max(120),
          userIds: z.array(z.string().uuid()).max(100).default([]),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const me = ctx.user.id;
        const co = ctx.user.companyId;
        const wanted = Array.from(new Set([me, ...input.userIds]));
        // Chi giu thanh vien thuoc cong ty.
        const valid = await ctx.db
          .select({ userId: companyMembers.userId })
          .from(companyMembers)
          .where(and(eq(companyMembers.companyId, co), inArray(companyMembers.userId, wanted)));
        const memberIds = Array.from(new Set([me, ...valid.map((v) => v.userId)]));
        const [conv] = await ctx.db
          .insert(chatConversations)
          .values({ companyId: co, kind: "group", title: input.title.trim(), createdBy: me })
          .returning({ id: chatConversations.id });
        if (!conv) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        await ctx.db.insert(chatMembers).values(
          memberIds.map((uid) => ({
            conversationId: conv.id,
            userId: uid,
            role: uid === me ? "owner" : "member",
          })),
        );
        publishInbox(
          memberIds.filter((u) => u !== me),
          { type: "conversation", conversationId: conv.id },
        );
        return { conversationId: conv.id };
      }),
  }),

  messages: router({
    /** Tin nhan cua 1 cuoc tro chuyen (cu → moi). Phan trang lui theo `before`. */
    list: approvedProcedure
      .input(
        z.object({
          conversationId: z.string().uuid(),
          before: z.string().datetime().optional(),
          limit: z.number().int().positive().max(100).optional(),
        }),
      )
      .query(async ({ ctx, input }) => {
        await assertMember(ctx, input.conversationId);
        const conds = [
          eq(chatMessages.conversationId, input.conversationId),
          isNull(chatMessages.deletedAt),
        ];
        if (input.before) conds.push(lt(chatMessages.createdAt, new Date(input.before)));
        const rows = await ctx.db
          .select({
            id: chatMessages.id,
            senderUserId: chatMessages.senderUserId,
            body: chatMessages.body,
            attachments: chatMessages.attachments,
            editedAt: chatMessages.editedAt,
            createdAt: chatMessages.createdAt,
          })
          .from(chatMessages)
          .where(and(...conds))
          .orderBy(desc(chatMessages.createdAt))
          .limit(input.limit ?? 50);
        rows.reverse(); // thu tu tang dan (cu truoc)
        if (rows.length === 0) return [];
        // Gom reaction cho cac tin vua lay.
        const reacts = await ctx.db
          .select({
            messageId: chatMessageReactions.messageId,
            emoji: chatMessageReactions.emoji,
            userId: chatMessageReactions.userId,
          })
          .from(chatMessageReactions)
          .where(
            inArray(
              chatMessageReactions.messageId,
              rows.map((r) => r.id),
            ),
          );
        const byMsg = new Map<string, { emoji: string; userId: string }[]>();
        for (const r of reacts) {
          const arr = byMsg.get(r.messageId) ?? [];
          arr.push({ emoji: r.emoji, userId: r.userId });
          byMsg.set(r.messageId, arr);
        }
        return rows.map((r) => ({
          ...r,
          reactions: summarizeReactions(byMsg.get(r.id), ctx.user.id),
        }));
      }),

    /** Gui tin nhan (text va/hoac dinh kem). Insert → publish + @mention. */
    send: approvedProcedure
      .use(rateLimit("chat.send", 60, 60_000))
      .input(
        z.object({
          conversationId: z.string().uuid(),
          body: z.string().max(4000).optional().default(""),
          attachments: z.array(attachmentSchema).max(10).optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const me = ctx.user.id;
        const co = ctx.user.companyId;
        await assertMember(ctx, input.conversationId);
        const body = input.body.trim();
        const attachments = input.attachments ?? [];
        if (!body && attachments.length === 0) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Tin nhan rong." });
        }
        const [msg] = await ctx.db
          .insert(chatMessages)
          .values({
            conversationId: input.conversationId,
            companyId: co,
            senderUserId: me,
            body,
            attachments: attachments.length > 0 ? attachments : null,
          })
          .returning();
        if (!msg) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        await ctx.db
          .update(chatConversations)
          .set({ updatedAt: new Date() })
          .where(eq(chatConversations.id, input.conversationId));
        // Preview cho inbox: tin chi co dinh kem → ten file.
        const preview = body ? body.slice(0, 120) : `📎 ${attachments[0]?.name ?? "Tệp đính kèm"}`;
        // Real-time + @mention — best-effort, loi KHONG vo viec gui.
        try {
          const payload = { type: "message", message: { ...msg, senderName: ctx.user.name } };
          publish(`chat:${input.conversationId}`, payload);
          const others = await otherMemberIds(ctx.db, input.conversationId, me);
          publishInbox(others, {
            type: "message",
            conversationId: input.conversationId,
            preview,
            senderName: ctx.user.name,
          });
          await notifyMentions(ctx.db, {
            companyId: co,
            actorUserId: me,
            body,
            targetUrl: `/chat?c=${input.conversationId}`,
            kind: "mention",
          });
        } catch (e) {
          console.error("[chat.send] realtime loi:", (e as Error).message);
        }
        return { id: msg.id, createdAt: msg.createdAt };
      }),

    /** Danh dau da doc tat ca tin trong cuoc tro chuyen (set last_read_at = now). */
    markRead: approvedProcedure
      .input(z.object({ conversationId: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        await assertMember(ctx, input.conversationId);
        await ctx.db
          .update(chatMembers)
          .set({ lastReadAt: new Date() })
          .where(
            and(
              eq(chatMembers.conversationId, input.conversationId),
              eq(chatMembers.userId, ctx.user.id),
            ),
          );
        return { ok: true };
      }),

    /** Sua tin nhan (chi chu tin, chua xoa). */
    edit: approvedProcedure
      .input(z.object({ messageId: z.string().uuid(), body: z.string().min(1).max(4000) }))
      .mutation(async ({ ctx, input }) => {
        const msg = await loadOwnableMessage(ctx, input.messageId);
        if (msg.senderUserId !== ctx.user.id) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Chi sua tin cua minh." });
        }
        if (msg.deletedAt) throw new TRPCError({ code: "BAD_REQUEST", message: "Tin da xoa." });
        const body = input.body.trim();
        if (!body) throw new TRPCError({ code: "BAD_REQUEST", message: "Tin nhan rong." });
        const editedAt = new Date();
        await ctx.db
          .update(chatMessages)
          .set({ body, editedAt })
          .where(eq(chatMessages.id, input.messageId));
        safePublish(`chat:${msg.conversationId}`, {
          type: "edit",
          id: input.messageId,
          body,
          editedAt,
        });
        return { ok: true };
      }),

    /** Xoa mem tin nhan (chi chu tin). */
    remove: approvedProcedure
      .input(z.object({ messageId: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        const msg = await loadOwnableMessage(ctx, input.messageId);
        if (msg.senderUserId !== ctx.user.id) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Chi xoa tin cua minh." });
        }
        await ctx.db
          .update(chatMessages)
          .set({ deletedAt: new Date() })
          .where(eq(chatMessages.id, input.messageId));
        safePublish(`chat:${msg.conversationId}`, { type: "delete", id: input.messageId });
        return { ok: true };
      }),

    /** Tha / go reaction emoji (toggle theo user+emoji). */
    react: approvedProcedure
      .input(z.object({ messageId: z.string().uuid(), emoji: z.string().min(1).max(16) }))
      .mutation(async ({ ctx, input }) => {
        const msg = await loadOwnableMessage(ctx, input.messageId);
        await assertMember(ctx, msg.conversationId); // phai thuoc hoi thoai moi react duoc
        const where = and(
          eq(chatMessageReactions.messageId, input.messageId),
          eq(chatMessageReactions.userId, ctx.user.id),
          eq(chatMessageReactions.emoji, input.emoji),
        );
        const [existing] = await ctx.db
          .select({ emoji: chatMessageReactions.emoji })
          .from(chatMessageReactions)
          .where(where)
          .limit(1);
        let added: boolean;
        if (existing) {
          await ctx.db.delete(chatMessageReactions).where(where);
          added = false;
        } else {
          await ctx.db
            .insert(chatMessageReactions)
            .values({ messageId: input.messageId, userId: ctx.user.id, emoji: input.emoji })
            .onConflictDoNothing();
          added = true;
        }
        safePublish(`chat:${msg.conversationId}`, {
          type: "react",
          messageId: input.messageId,
          emoji: input.emoji,
          userId: ctx.user.id,
          added,
        });
        return { added };
      }),

    /** Bao "dang go" cho thanh vien khac (real-time, khong luu DB). */
    typing: approvedProcedure
      .use(rateLimit("chat.typing", 30, 10_000))
      .input(z.object({ conversationId: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        await assertMember(ctx, input.conversationId);
        safePublish(`chat:${input.conversationId}`, {
          type: "typing",
          userId: ctx.user.id,
          name: ctx.user.name,
        });
        return { ok: true };
      }),
  }),
});
