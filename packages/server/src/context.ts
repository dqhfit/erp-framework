/* context.ts — Context tRPC mỗi request. Đọc cookie phiên,
   tra bảng sessions + users để xác định người dùng hiện tại.

   ĐA CÔNG TY: vai trò HIỆU LỰC lấy theo công ty đang chọn
   (sessions.active_company_id → company_members.role). Nếu phiên
   chưa chọn công ty hợp lệ → dùng công ty đầu tiên user là thành viên. */
import type { CreateFastifyContextOptions } from "@trpc/server/adapters/fastify";
import type { FastifyReply } from "fastify";
import "@fastify/cookie"; // mang augmentation cookies/setCookie vào kiểu Fastify
import { and, eq, gt } from "drizzle-orm";
import { sessions, users, companyMembers } from "@erp-framework/db";
import type { Role } from "@erp-framework/core";
import { db } from "./db";
import { SESSION_COOKIE } from "./auth";

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  /** Vai trò hiệu lực trong công ty đang chọn. */
  role: Role;
  /** Công ty đang chọn. null = user chưa thuộc công ty nào. */
  companyId: string | null;
  /** false = dang ky qua invite link, cho admin duyet. true = binh thuong. */
  companyApproved: boolean;
  /** true = admin da vo hieu hoa tai khoan nay trong cong ty. */
  companyDisabled: boolean;
}

export interface Context {
  db: typeof db;
  user: SessionUser | null;
  sessionToken: string | null;
  reply: FastifyReply;
  /** IP client gọi — dùng cho rate-limit. Fastify trả "::1" cho IPv6 localhost. */
  ip: string;
}

/** Phân giải công ty hiệu lực + vai trò cho một user.
   preferredCompanyId: công ty phiên đang chọn (nếu có). Trả về null
   nếu user không là thành viên công ty nào. */
export async function resolveActiveCompany(
  database: typeof db,
  userId: string,
  preferredCompanyId: string | null,
): Promise<{ companyId: string; role: Role; approved: boolean; disabled: boolean } | null> {
  const memberships = await database
    .select({
      companyId: companyMembers.companyId,
      role: companyMembers.role,
      approved: companyMembers.approved,
      disabled: companyMembers.disabled,
    })
    .from(companyMembers)
    .where(eq(companyMembers.userId, userId));
  const picked = memberships.find((m) => m.companyId === preferredCompanyId) ?? memberships[0];
  if (!picked) return null;
  return {
    companyId: picked.companyId,
    role: picked.role as Role,
    approved: picked.approved,
    disabled: picked.disabled,
  };
}

export async function createContext({ req, res }: CreateFastifyContextOptions): Promise<Context> {
  let user: SessionUser | null = null;
  const token = req.cookies?.[SESSION_COOKIE] ?? null;

  if (token) {
    const rows = await db
      .select({
        id: users.id,
        email: users.email,
        name: users.name,
        defaultRole: users.role,
        activeCompanyId: sessions.activeCompanyId,
      })
      .from(sessions)
      .innerJoin(users, eq(sessions.userId, users.id))
      .where(and(eq(sessions.id, token), gt(sessions.expiresAt, new Date())));
    const row = rows[0];
    if (row) {
      const active = await resolveActiveCompany(db, row.id, row.activeCompanyId);
      // User đã bị gỡ khỏi MỌI công ty (không còn membership) → coi như chưa
      // đăng nhập, chặn phiên cũ còn sót truy cập hệ thống. User hợp lệ luôn
      // có ít nhất 1 membership (kể cả pending/disabled — active vẫn != null).
      if (active) {
        user = {
          id: row.id,
          email: row.email,
          name: row.name,
          role: active.role,
          companyId: active.companyId,
          companyApproved: active.approved,
          companyDisabled: active.disabled,
        };
      }
    }
  }

  return { db, user, sessionToken: token, reply: res, ip: req.ip };
}
