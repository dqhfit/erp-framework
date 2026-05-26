/* trpc.ts — Khởi tạo tRPC + các loại procedure.
   - publicProcedure   : ai cũng gọi được
   - protectedProcedure: yêu cầu đăng nhập
   - rbacProcedure()   : yêu cầu quyền cụ thể theo RBAC (permissions.ts)
   - rateLimit()       : middleware giới hạn tốc độ theo IP (xem dưới) */

import { type Action, type ObjectType, roleCan } from "@erp-framework/core";
import { initTRPC, TRPCError } from "@trpc/server";
import type { Context } from "./context";

const t = initTRPC.context<Context>().create();

export const router = t.router;
/** Factory tạo caller server-side cho unit test — gọi procedure trực
 *  tiếp với mock context, bỏ qua HTTP layer. */
export const createCallerFactory = t.createCallerFactory;
export const publicProcedure = t.procedure;

/* ─── Rate-limit ──────────────────────────────────────────────
   In-memory sliding-window per (bucket, ip). KHÔNG dùng Redis vì
   self-host single-node là use case chính; restart server reset
   bộ đếm — chấp nhận được cho mục đích chống brute-force.
   Cleanup tự động: mỗi lần check, xoá entry đã hết hạn. */
interface Slot {
  count: number;
  resetAt: number;
}
const buckets: Map<string, Map<string, Slot>> = new Map();

/** Trả về middleware tRPC giới hạn `max` request mỗi `windowMs` từ 1 IP.
   `bucket` để tách giới hạn theo procedure (vd "auth.login" vs "auth.register"). */
export function rateLimit(bucket: string, max: number, windowMs: number) {
  return t.middleware(({ ctx, next }) => {
    const now = Date.now();
    let bm = buckets.get(bucket);
    if (!bm) {
      bm = new Map();
      buckets.set(bucket, bm);
    }
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

/** Yêu cầu đăng nhập. KHÔNG enforce approved/disabled — chỉ dùng cho
 *  endpoint white-list: auth.logout, auth.me, companies.list (user pending
 *  cần biết trạng thái), notifications.unreadCount (UI cần hide chip).
 *  Mọi endpoint khác THAO TÁC DATA phải dùng approvedProcedure hoặc
 *  rbacProcedure. */
export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Cần đăng nhập" });
  }
  return next({ ctx: { ...ctx, user: ctx.user } });
});

/** Yêu cầu đăng nhập + thuộc 1 công ty + được phê duyệt + không bị disable.
 *  Dùng cho endpoint user-personal không cần RBAC matrix nhưng vẫn phải
 *  block khi pending/disabled (vd agents.save, notifications.list). */
export const approvedProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (!ctx.user.companyId) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Ban chua thuoc cong ty nao -- hay yeu cau quan tri vien them ban vao cong ty.",
    });
  }
  if (!ctx.user.companyApproved) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Tai khoan cua ban dang cho quan tri vien phe duyet.",
    });
  }
  if (ctx.user.companyDisabled) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Tai khoan cua ban da bi vo hieu hoa.",
    });
  }
  return next({
    ctx: { ...ctx, user: { ...ctx.user, companyId: ctx.user.companyId } },
  });
});

/** Generic per-resource procedure factory (P2.4). Trích resourceId
 *  từ input (string UUID hoặc object có `.id`/`.resourceId`/`.<typeId>`)
 *  rồi gọi `policyCheck(ctx, resourceId, action)` — policy thuộc về
 *  từng resource type (vd agent-acl.assertCanActOnAgent).
 *  Build trên approvedProcedure để tự động enforce member status.
 *
 *  Lưu ý: middleware dùng `getRawInput()` (tRPC v11) thay vì `input`
 *  trực tiếp — `input` ở middleware-level chỉ tích luỹ từ `.input()`
 *  CHAIN trước, không bao gồm `.input()` consumer thêm sau khi nhận
 *  procedure builder. getRawInput() trả raw payload trước parse. */
export function resourceProcedure<Action extends string>(
  action: Action,
  policyCheck: (
    ctx: Context & { user: NonNullable<Context["user"]> & { companyId: string } },
    resourceId: string,
    action: Action,
  ) => Promise<void>,
  idField = "id",
) {
  return approvedProcedure.use(async ({ ctx, getRawInput, next }) => {
    const raw = await getRawInput();
    let id: string | undefined;
    if (typeof raw === "string") id = raw;
    else if (raw && typeof raw === "object") {
      const obj = raw as Record<string, unknown>;
      const cand = obj[idField] ?? obj.resourceId ?? obj.id;
      if (typeof cand === "string") id = cand;
    }
    if (!id) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Thiếu ${idField} trong input để xác định resource`,
      });
    }
    await policyCheck(ctx, id, action);
    return next();
  });
}

/** Procedure yêu cầu quyền `action` trên `obj` theo vai trò người dùng.
   Đồng thời ép buộc user phải thuộc một công ty (đa công ty) — sau
   procedure này `ctx.user.companyId` chắc chắn là string. */
export function rbacProcedure(action: Action, obj: ObjectType) {
  return protectedProcedure.use(({ ctx, next }) => {
    if (!ctx.user.companyId) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Ban chua thuoc cong ty nao -- hay yeu cau quan tri vien them ban vao cong ty.",
      });
    }
    if (!ctx.user.companyApproved) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Tai khoan cua ban dang cho quan tri vien phe duyet.",
      });
    }
    if (ctx.user.companyDisabled) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Tai khoan cua ban da bi vo hieu hoa.",
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
