/* ==========================================================
   companies-router.ts — tRPC router quản lý đa công ty.
   - list / current / switch : công ty của user + chuyển công ty
   - create / rename         : tạo & đổi tên công ty (admin)
   - members / addMember /
     setMemberRole / removeMember : quản lý thành viên (admin)
   Vai trò HIỆU LỰC theo từng công ty — xem company_members.
   ========================================================== */
import { z } from "zod";
import { and, eq, isNull, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import {
  companies,
  companyMembers,
  users,
  sessions,
  userInvites,
  inviteLinks,
} from "@erp-framework/db";
import { router, protectedProcedure, rbacProcedure } from "./trpc";
import { hashPassword, newSessionToken } from "./auth";
import { logActivity } from "./activity";
import type { DB } from "./db";

/* TTL của invite token: 7 ngày, đồng nhất với session TTL. */
export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Sinh invite token mới + lưu DB. Trả về raw token (chỉ tồn tại trong
   bộ nhớ máy gọi — không lưu lại). Reset invite cũ pending của cặp
   (user, company) — chỉ có 1 invite hoạt động tại một thời điểm. */
export async function createInvite(
  db: DB,
  userId: string,
  companyId: string,
  role: "admin" | "editor" | "viewer",
  invitedBy: string | null,
): Promise<string> {
  const token = newSessionToken();
  // Xoá invite pending cũ (chưa accept) của cặp (user, company).
  await db
    .delete(userInvites)
    .where(
      and(
        eq(userInvites.userId, userId),
        eq(userInvites.companyId, companyId),
        isNull(userInvites.acceptedAt),
      ),
    );
  await db.insert(userInvites).values({
    userId,
    companyId,
    token,
    role,
    invitedBy,
    expiresAt: new Date(Date.now() + INVITE_TTL_MS),
  });
  return token;
}

const roleEnum = z.enum(["admin", "editor", "viewer"]);

/** Chuẩn hoá tên → slug URL-an-toàn. */
function toSlug(s: string): string {
  return (
    s
      .toLowerCase()
      .normalize("NFKD")
      .replace(/\p{Diacritic}/gu, "")
      .replace(/[đĐ]/g, "d")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "cong-ty"
  );
}

export const companiesRouter = router({
  /* Danh sách công ty user là thành viên — dùng cho company switcher. */
  list: protectedProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db
      .select({
        id: companies.id,
        name: companies.name,
        slug: companies.slug,
        role: companyMembers.role,
      })
      .from(companyMembers)
      .innerJoin(companies, eq(companyMembers.companyId, companies.id))
      .where(eq(companyMembers.userId, ctx.user.id));
    return rows.map((r) => ({ ...r, isActive: r.id === ctx.user.companyId }));
  }),

  /* Công ty đang chọn của phiên hiện tại. */
  current: protectedProcedure.query(async ({ ctx }) => {
    if (!ctx.user.companyId) return null;
    const [co] = await ctx.db.select().from(companies).where(eq(companies.id, ctx.user.companyId));
    return co ? { ...co, role: ctx.user.role } : null;
  }),

  /* Chuyển công ty đang làm việc — cập nhật sessions.active_company_id. */
  switch: protectedProcedure
    .input(z.object({ companyId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [m] = await ctx.db
        .select({ id: companyMembers.id })
        .from(companyMembers)
        .where(
          and(
            eq(companyMembers.userId, ctx.user.id),
            eq(companyMembers.companyId, input.companyId),
          ),
        );
      if (!m) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Bạn không thuộc công ty này" });
      }
      if (ctx.sessionToken) {
        await ctx.db
          .update(sessions)
          .set({ activeCompanyId: input.companyId })
          .where(eq(sessions.id, ctx.sessionToken));
      }
      return { ok: true, companyId: input.companyId };
    }),

  /* Tạo công ty mới — người tạo trở thành admin của công ty đó. */
  create: rbacProcedure("create", "company")
    .input(z.object({ name: z.string().min(1), slug: z.string().min(1).optional() }))
    .mutation(async ({ ctx, input }) => {
      const slug = toSlug(input.slug ?? input.name);
      const [dup] = await ctx.db
        .select({ id: companies.id })
        .from(companies)
        .where(eq(companies.slug, slug));
      if (dup) {
        throw new TRPCError({ code: "CONFLICT", message: `Slug "${slug}" đã tồn tại` });
      }
      const [co] = await ctx.db.insert(companies).values({ name: input.name, slug }).returning();
      if (!co) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await ctx.db
        .insert(companyMembers)
        .values({ companyId: co.id, userId: ctx.user.id, role: "admin" });
      return co;
    }),

  /* Đổi tên công ty đang chọn. */
  rename: rbacProcedure("edit", "company")
    .input(z.object({ name: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const [co] = await ctx.db
        .update(companies)
        .set({ name: input.name })
        .where(eq(companies.id, ctx.user.companyId))
        .returning();
      return co;
    }),

  /* Thành viên của công ty đang chọn. Kèm "pending = true" nếu user
     chưa accept invite (passwordHash rỗng — placeholder do addMember
     tạo). UI hiện chip "chờ accept" + nút "Gửi lại link". */
  members: rbacProcedure("view", "company").query(({ ctx }) =>
    ctx.db
      .select({
        userId: users.id,
        email: users.email,
        name: users.name,
        role: companyMembers.role,
        joinedAt: companyMembers.createdAt,
        // passwordHash rong = invite chua accept → user "pending invite".
        pending: sql<boolean>`(${users.passwordHash} = '')`,
        // approved=false = dang ky qua invite link, cho admin duyet.
        approved: companyMembers.approved,
        // disabled=true = admin da vo hieu hoa tai khoan nay.
        disabled: companyMembers.disabled,
      })
      .from(companyMembers)
      .innerJoin(users, eq(companyMembers.userId, users.id))
      .where(eq(companyMembers.companyId, ctx.user.companyId)),
  ),

  /* Thêm thành viên vào công ty đang chọn.
     - input.password CÓ        → tạo user + set password ngay (legacy path).
     - input.password KHÔNG có   → tạo user với passwordHash="" placeholder,
                                   sinh invite token, trả về inviteLink.
     - Email đã có user          → chỉ gắn quyền, KHÔNG đụng password.
     Return: { ok, inviteLink?, userId, pending } — admin copy link gửi cho user. */
  addMember: rbacProcedure("edit", "company")
    .input(
      z.object({
        email: z.string().email(),
        name: z.string().min(1).optional(),
        password: z.string().min(8).optional(),
        role: roleEnum.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const role = input.role ?? "viewer";
      let [u] = await ctx.db
        .select({ id: users.id, passwordHash: users.passwordHash })
        .from(users)
        .where(eq(users.email, input.email));
      let createdNew = false;
      if (!u) {
        // Tạo user mới — password OPTIONAL: nếu không có thì để rỗng
        // (placeholder), sinh invite link để user tự đặt sau.
        const passwordHash = input.password ? await hashPassword(input.password) : ""; // empty = "pending invite" — verifyPassword sẽ trả false.
        const [created] = await ctx.db
          .insert(users)
          .values({
            email: input.email,
            name: input.name ?? input.email,
            passwordHash,
            role,
          })
          .returning({ id: users.id, passwordHash: users.passwordHash });
        if (!created) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        u = created;
        createdNew = true;
      }
      await ctx.db
        .insert(companyMembers)
        .values({ companyId: ctx.user.companyId, userId: u.id, role })
        .onConflictDoUpdate({
          target: [companyMembers.companyId, companyMembers.userId],
          set: { role },
        });

      const isPending = u.passwordHash === "";
      let inviteLink: string | undefined;
      if (isPending) {
        const token = await createInvite(ctx.db, u.id, ctx.user.companyId, role, ctx.user.id);
        inviteLink = `/invite?token=${token}`;
        await logActivity(ctx.db, {
          companyId: ctx.user.companyId,
          kind: "user.invite_sent",
          objectType: "user",
          target: u.id,
          detail: `${createdNew ? "Tạo + mời" : "Mời lại"} ${input.email} (role=${role})`,
          actorUserId: ctx.user.id,
        });
      }
      return { ok: true, userId: u.id, pending: isPending, inviteLink };
    }),

  /** Gửi lại invite cho user pending — sinh token mới, xoá token cũ. */
  resendInvite: rbacProcedure("edit", "company")
    .input(z.object({ userId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [u] = await ctx.db
        .select({
          id: users.id,
          email: users.email,
          passwordHash: users.passwordHash,
        })
        .from(users)
        .where(eq(users.id, input.userId));
      if (!u) throw new TRPCError({ code: "NOT_FOUND", message: "User không tồn tại" });
      if (u.passwordHash !== "") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "User đã đặt mật khẩu — không cần gửi lại link.",
        });
      }
      const [m] = await ctx.db
        .select({ role: companyMembers.role })
        .from(companyMembers)
        .where(
          and(eq(companyMembers.userId, u.id), eq(companyMembers.companyId, ctx.user.companyId)),
        );
      if (!m) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "User không phải thành viên công ty này.",
        });
      }
      const token = await createInvite(ctx.db, u.id, ctx.user.companyId, m.role, ctx.user.id);
      await logActivity(ctx.db, {
        companyId: ctx.user.companyId,
        kind: "user.invite_sent",
        objectType: "user",
        target: u.id,
        detail: `Gửi lại link cho ${u.email}`,
        actorUserId: ctx.user.id,
      });
      return { ok: true, inviteLink: `/invite?token=${token}` };
    }),

  /* Đổi vai trò một thành viên trong công ty đang chọn. */
  setMemberRole: rbacProcedure("edit", "company")
    .input(z.object({ userId: z.string().uuid(), role: roleEnum }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .update(companyMembers)
        .set({ role: input.role })
        .where(
          and(
            eq(companyMembers.companyId, ctx.user.companyId),
            eq(companyMembers.userId, input.userId),
          ),
        );
      return { ok: true };
    }),

  /* Gỡ một thành viên khỏi công ty đang chọn (không tự gỡ chính mình). */
  removeMember: rbacProcedure("edit", "company")
    .input(z.object({ userId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      if (input.userId === ctx.user.id) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Không thể tự gỡ chính mình khỏi công ty",
        });
      }
      await ctx.db
        .delete(companyMembers)
        .where(
          and(
            eq(companyMembers.companyId, ctx.user.companyId),
            eq(companyMembers.userId, input.userId),
          ),
        );
      // Nếu user không còn là thành viên công ty nào → huỷ mọi phiên để họ
      // KHÔNG còn vào được hệ thống (trước đây phiên cũ vẫn sống → user đã
      // bị gỡ vẫn đăng nhập được). Còn công ty khác thì giữ phiên: context
      // tự chuyển active sang công ty còn lại.
      const remaining = await ctx.db
        .select({ id: companyMembers.id })
        .from(companyMembers)
        .where(eq(companyMembers.userId, input.userId));
      if (remaining.length === 0) {
        await ctx.db.delete(sessions).where(eq(sessions.userId, input.userId));
      }
      return { ok: true };
    }),

  /* Admin đặt lại mật khẩu cho một thành viên.
     - Chỉ admin mới gọi được (RBAC edit + kiểm role).
     - Không tự reset mật khẩu chính mình (dùng change-password thay thế).
     - Xoá toàn bộ session hiện tại của user đó để buộc đăng nhập lại. */
  resetMemberPassword: rbacProcedure("edit", "company")
    .input(
      z.object({
        userId: z.string().uuid(),
        newPassword: z.string().min(8, "Mật khẩu tối thiểu 8 ký tự"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Chỉ admin được reset mật khẩu" });
      }
      if (input.userId === ctx.user.id) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Không thể reset mật khẩu của chính mình qua tính năng này",
        });
      }
      const [m] = await ctx.db
        .select({ userId: companyMembers.userId })
        .from(companyMembers)
        .where(
          and(
            eq(companyMembers.companyId, ctx.user.companyId),
            eq(companyMembers.userId, input.userId),
          ),
        );
      if (!m) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "User không phải thành viên công ty này",
        });
      }
      const [u] = await ctx.db
        .select({ email: users.email })
        .from(users)
        .where(eq(users.id, input.userId));
      await ctx.db
        .update(users)
        .set({ passwordHash: await hashPassword(input.newPassword) })
        .where(eq(users.id, input.userId));
      // Buộc đăng xuất khỏi tất cả thiết bị.
      await ctx.db.delete(sessions).where(eq(sessions.userId, input.userId));
      await logActivity(ctx.db, {
        companyId: ctx.user.companyId,
        kind: "user.password_reset",
        objectType: "user",
        target: input.userId,
        detail: `Admin reset mật khẩu cho ${u?.email ?? input.userId}`,
        actorUserId: ctx.user.id,
      });
      return { ok: true };
    }),

  /** Phe duyet thanh vien dang ky qua invite link -- set approved=true. */
  approveMember: rbacProcedure("edit", "company")
    .input(z.object({ userId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [m] = await ctx.db
        .select({ userId: companyMembers.userId })
        .from(companyMembers)
        .where(
          and(
            eq(companyMembers.companyId, ctx.user.companyId),
            eq(companyMembers.userId, input.userId),
          ),
        );
      if (!m) throw new TRPCError({ code: "NOT_FOUND", message: "Không tìm thấy thành viên" });
      await ctx.db
        .update(companyMembers)
        .set({ approved: true })
        .where(
          and(
            eq(companyMembers.companyId, ctx.user.companyId),
            eq(companyMembers.userId, input.userId),
          ),
        );
      const [u] = await ctx.db
        .select({ email: users.email })
        .from(users)
        .where(eq(users.id, input.userId));
      await logActivity(ctx.db, {
        companyId: ctx.user.companyId,
        kind: "user.invite_accepted",
        objectType: "user",
        target: input.userId,
        detail: `Admin phe duyet thanh vien ${u?.email ?? input.userId}`,
        actorUserId: ctx.user.id,
      });
      return { ok: true };
    }),

  /** Tu choi + xoa thanh vien dang cho phe duyet. Neu user khong con
     o cong ty nao khac thi xoa luon account (tranh account bị bỏ hoang). */
  rejectMember: rbacProcedure("edit", "company")
    .input(z.object({ userId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [m] = await ctx.db
        .select({ approved: companyMembers.approved })
        .from(companyMembers)
        .where(
          and(
            eq(companyMembers.companyId, ctx.user.companyId),
            eq(companyMembers.userId, input.userId),
          ),
        );
      if (!m) throw new TRPCError({ code: "NOT_FOUND", message: "Không tìm thấy thành viên" });
      // Xoa membership.
      await ctx.db
        .delete(companyMembers)
        .where(
          and(
            eq(companyMembers.companyId, ctx.user.companyId),
            eq(companyMembers.userId, input.userId),
          ),
        );
      // Neu user khong con membership nao khac → xoa account.
      const remaining = await ctx.db
        .select({ id: companyMembers.id })
        .from(companyMembers)
        .where(eq(companyMembers.userId, input.userId));
      if (remaining.length === 0) {
        await ctx.db.delete(sessions).where(eq(sessions.userId, input.userId));
        await ctx.db.delete(users).where(eq(users.id, input.userId));
      }
      return { ok: true };
    }),

  /** Vo hieu hoa tai khoan thanh vien trong cong ty hien tai. */
  disableMember: rbacProcedure("edit", "company")
    .input(z.object({ userId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [m] = await ctx.db
        .select({ userId: companyMembers.userId })
        .from(companyMembers)
        .where(
          and(
            eq(companyMembers.companyId, ctx.user.companyId),
            eq(companyMembers.userId, input.userId),
          ),
        );
      if (!m) throw new TRPCError({ code: "NOT_FOUND", message: "Không tìm thấy thành viên" });
      await ctx.db
        .update(companyMembers)
        .set({ disabled: true })
        .where(
          and(
            eq(companyMembers.companyId, ctx.user.companyId),
            eq(companyMembers.userId, input.userId),
          ),
        );
      // Xoa phien dang nhap cua user de buoc ho dang xuat ngay lap tuc.
      await ctx.db.delete(sessions).where(eq(sessions.userId, input.userId));
      return { ok: true };
    }),

  /** Khoi phuc tai khoan thanh vien da bi vo hieu hoa. */
  enableMember: rbacProcedure("edit", "company")
    .input(z.object({ userId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [m] = await ctx.db
        .select({ userId: companyMembers.userId })
        .from(companyMembers)
        .where(
          and(
            eq(companyMembers.companyId, ctx.user.companyId),
            eq(companyMembers.userId, input.userId),
          ),
        );
      if (!m) throw new TRPCError({ code: "NOT_FOUND", message: "Không tìm thấy thành viên" });
      await ctx.db
        .update(companyMembers)
        .set({ disabled: false })
        .where(
          and(
            eq(companyMembers.companyId, ctx.user.companyId),
            eq(companyMembers.userId, input.userId),
          ),
        );
      return { ok: true };
    }),

  /** Tạo generic invite link — không cần biết email trước. Bất kỳ ai có
     link đều tự điền thông tin và đăng ký vào công ty. Dùng 1 lần. */
  createInviteLink: rbacProcedure("edit", "company")
    .input(z.object({ role: roleEnum.optional() }))
    .mutation(async ({ ctx, input }) => {
      const role = input.role ?? "viewer";
      const token = newSessionToken();
      await ctx.db.insert(inviteLinks).values({
        companyId: ctx.user.companyId,
        role,
        token,
        createdBy: ctx.user.id,
        expiresAt: new Date(Date.now() + INVITE_TTL_MS),
      });
      await logActivity(ctx.db, {
        companyId: ctx.user.companyId,
        kind: "user.invite_sent",
        objectType: "company",
        detail: `Tạo invite link chung (role=${role})`,
        actorUserId: ctx.user.id,
      });
      return { ok: true, inviteLink: `/join?token=${token}` };
    }),

  /** Danh sách invite links còn hiệu lực (chưa dùng + chưa hết hạn). */
  listInviteLinks: rbacProcedure("view", "company").query(async ({ ctx }) => {
    const rows = await ctx.db
      .select({
        id: inviteLinks.id,
        role: inviteLinks.role,
        expiresAt: inviteLinks.expiresAt,
        usedAt: inviteLinks.usedAt,
        createdAt: inviteLinks.createdAt,
        token: inviteLinks.token,
      })
      .from(inviteLinks)
      .where(eq(inviteLinks.companyId, ctx.user.companyId));
    return rows;
  }),

  /** Xoá (thu hồi) một invite link. */
  deleteInviteLink: rbacProcedure("edit", "company")
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .delete(inviteLinks)
        .where(and(eq(inviteLinks.id, input.id), eq(inviteLinks.companyId, ctx.user.companyId)));
      return { ok: true };
    }),
});
