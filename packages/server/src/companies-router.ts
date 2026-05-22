/* ==========================================================
   companies-router.ts — tRPC router quản lý đa công ty.
   - list / current / switch : công ty của user + chuyển công ty
   - create / rename         : tạo & đổi tên công ty (admin)
   - members / addMember /
     setMemberRole / removeMember : quản lý thành viên (admin)
   Vai trò HIỆU LỰC theo từng công ty — xem company_members.
   ========================================================== */
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { companies, companyMembers, users, sessions } from "@erp-framework/db";
import { router, protectedProcedure, rbacProcedure } from "./trpc";
import { hashPassword } from "./auth";

const roleEnum = z.enum(["admin", "editor", "viewer"]);

/** Chuẩn hoá tên → slug URL-an-toàn. */
function toSlug(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[đĐ]/g, "d")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "cong-ty";
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
    const [co] = await ctx.db.select().from(companies)
      .where(eq(companies.id, ctx.user.companyId));
    return co ? { ...co, role: ctx.user.role } : null;
  }),

  /* Chuyển công ty đang làm việc — cập nhật sessions.active_company_id. */
  switch: protectedProcedure
    .input(z.object({ companyId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [m] = await ctx.db.select({ id: companyMembers.id })
        .from(companyMembers)
        .where(and(
          eq(companyMembers.userId, ctx.user.id),
          eq(companyMembers.companyId, input.companyId),
        ));
      if (!m) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Bạn không thuộc công ty này" });
      }
      if (ctx.sessionToken) {
        await ctx.db.update(sessions)
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
      const [dup] = await ctx.db.select({ id: companies.id })
        .from(companies).where(eq(companies.slug, slug));
      if (dup) {
        throw new TRPCError({ code: "CONFLICT", message: `Slug "${slug}" đã tồn tại` });
      }
      const [co] = await ctx.db.insert(companies)
        .values({ name: input.name, slug }).returning();
      if (!co) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await ctx.db.insert(companyMembers)
        .values({ companyId: co.id, userId: ctx.user.id, role: "admin" });
      return co;
    }),

  /* Đổi tên công ty đang chọn. */
  rename: rbacProcedure("edit", "company")
    .input(z.object({ name: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const [co] = await ctx.db.update(companies)
        .set({ name: input.name })
        .where(eq(companies.id, ctx.user.companyId)).returning();
      return co;
    }),

  /* Thành viên của công ty đang chọn. */
  members: rbacProcedure("view", "company").query(({ ctx }) =>
    ctx.db
      .select({
        userId: users.id,
        email: users.email,
        name: users.name,
        role: companyMembers.role,
        joinedAt: companyMembers.createdAt,
      })
      .from(companyMembers)
      .innerJoin(users, eq(companyMembers.userId, users.id))
      .where(eq(companyMembers.companyId, ctx.user.companyId)),
  ),

  /* Thêm thành viên vào công ty đang chọn. Email chưa có tài khoản →
     tạo user mới (cần password). Email đã có → chỉ gắn quyền. */
  addMember: rbacProcedure("edit", "company")
    .input(z.object({
      email: z.string().email(),
      name: z.string().min(1).optional(),
      password: z.string().min(8).optional(),
      role: roleEnum.optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const role = input.role ?? "viewer";
      let [u] = await ctx.db.select({ id: users.id }).from(users)
        .where(eq(users.email, input.email));
      if (!u) {
        if (!input.password) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Email chưa có tài khoản — cần đặt mật khẩu (≥8 ký tự) để tạo mới.",
          });
        }
        [u] = await ctx.db.insert(users).values({
          email: input.email,
          name: input.name ?? input.email,
          passwordHash: await hashPassword(input.password),
          role,
        }).returning({ id: users.id });
      }
      if (!u) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await ctx.db.insert(companyMembers)
        .values({ companyId: ctx.user.companyId, userId: u.id, role })
        .onConflictDoUpdate({
          target: [companyMembers.companyId, companyMembers.userId],
          set: { role },
        });
      return { ok: true };
    }),

  /* Đổi vai trò một thành viên trong công ty đang chọn. */
  setMemberRole: rbacProcedure("edit", "company")
    .input(z.object({ userId: z.string().uuid(), role: roleEnum }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.update(companyMembers).set({ role: input.role })
        .where(and(
          eq(companyMembers.companyId, ctx.user.companyId),
          eq(companyMembers.userId, input.userId),
        ));
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
      await ctx.db.delete(companyMembers)
        .where(and(
          eq(companyMembers.companyId, ctx.user.companyId),
          eq(companyMembers.userId, input.userId),
        ));
      return { ok: true };
    }),
});
