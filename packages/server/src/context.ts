/* context.ts — Context tRPC mỗi request. Đọc cookie phiên,
   tra bảng sessions + users để xác định người dùng hiện tại. */
import type { CreateFastifyContextOptions } from "@trpc/server/adapters/fastify";
import type { FastifyReply } from "fastify";
import "@fastify/cookie";  // mang augmentation cookies/setCookie vào kiểu Fastify
import { and, eq, gt } from "drizzle-orm";
import { sessions, users } from "@erp-framework/db";
import type { Role } from "@erp-framework/core";
import { db } from "./db";
import { SESSION_COOKIE } from "./auth";

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: Role;
}

export interface Context {
  db: typeof db;
  user: SessionUser | null;
  sessionToken: string | null;
  reply: FastifyReply;
}

export async function createContext(
  { req, res }: CreateFastifyContextOptions,
): Promise<Context> {
  let user: SessionUser | null = null;
  const token = req.cookies?.[SESSION_COOKIE] ?? null;

  if (token) {
    const rows = await db
      .select({
        id: users.id,
        email: users.email,
        name: users.name,
        role: users.role,
      })
      .from(sessions)
      .innerJoin(users, eq(sessions.userId, users.id))
      .where(and(eq(sessions.id, token), gt(sessions.expiresAt, new Date())));
    const row = rows[0];
    if (row) {
      user = { id: row.id, email: row.email, name: row.name, role: row.role };
    }
  }

  return { db, user, sessionToken: token, reply: res };
}
