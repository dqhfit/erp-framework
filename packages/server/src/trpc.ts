/* trpc.ts — Khởi tạo tRPC + các loại procedure.
   - publicProcedure   : ai cũng gọi được
   - protectedProcedure: yêu cầu đăng nhập
   - rbacProcedure()   : yêu cầu quyền cụ thể theo RBAC (permissions.ts)
   - rateLimit()       : middleware giới hạn tốc độ theo IP (xem dưới) */
import { initTRPC, TRPCError } from "@trpc/server";
import { roleCan, type Action, type ObjectType } from "@erp-framework/core";
import type { Context } from "./context";

const t = initTRPC.context<Context>().create();

export const router = t.router;
export const publicProcedure = t.procedure;

/* ─── Rate-limit ──────────────────────────────────────────────
   In-memory sliding-window per (bucket, ip). KHÔNG dùng Redis vì
   self-host single-node là use case chính; restart server reset
   bộ đếm — chấp nhận được cho mục đích chống brute-force.
   Cleanup tự động: mỗi lần check, xoá entry đã hết hạn. */
interface Slot { count: number; resetAt: number; }
const buckets: Map<string, Map<string, Slot>> = new Map();

/** Trả về middleware tRPC giới hạn `max` request mỗi `windowMs` từ 1 IP.
   `bucket` để tách giới hạn theo procedure (vd "auth.login" vs "auth.register"). */
export function rateLimit(bucket: string, max: number, windowMs: number) {
  return t.middleware(({ ctx, next }) => {
    const now = Date.now();
    let bm = buckets.get(bucket);
    if (!bm) { bm = new Map(); buckets.set(bucket, bm); }
    // Cleanup nhẹ: 1/16 lần check xoá các entry hết hạn của bucket này.
    if ((now & 0xf) === 0) {
      for (const [k, v] of bm) if (v.resetAt <= now) bm.delete(k);
    }
    const slot = bm.get(ctx.ip);
    if (!slot || slot.resetAt <= now) {
      bm.set(ctx.ip, { count: 1, resetAt: now + windowMs });
      return next();
    }
    if (slot.count >= max) {
      const wait = Math.max(1, Math.ceil((slot.resetAt - now) / 1000));
      throw new TRPCError({
        code: "TOO_MANY_REQUESTS",
        message: `Quá nhiều lần thử. Vui lòng đợi ${wait} giây.`,
      });
    }
    slot.count += 1;
    return next();
  });
}

export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Cần đăng nhập" });
  }
  return next({ ctx: { ...ctx, user: ctx.user } });
});

/** Procedure yêu cầu quyền `action` trên `obj` theo vai trò người dùng.
   Đồng thời ép buộc user phải thuộc một công ty (đa công ty) — sau
   procedure này `ctx.user.companyId` chắc chắn là string. */
export function rbacProcedure(action: Action, obj: ObjectType) {
  return protectedProcedure.use(({ ctx, next }) => {
    if (!ctx.user.companyId) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Bạn chưa thuộc công ty nào — hãy yêu cầu quản trị viên thêm bạn vào công ty.",
      });
    }
    if (!roleCan(ctx.user.role, action, obj)) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: `Vai trò "${ctx.user.role}" không có quyền ${action}:${obj}`,
      });
    }
    return next({
      ctx: { ...ctx, user: { ...ctx.user, companyId: ctx.user.companyId } },
    });
  });
}
