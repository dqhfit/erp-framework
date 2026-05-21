/* trpc.ts — Khởi tạo tRPC + các loại procedure.
   - publicProcedure   : ai cũng gọi được
   - protectedProcedure: yêu cầu đăng nhập
   - rbacProcedure()   : yêu cầu quyền cụ thể theo RBAC (permissions.ts) */
import { initTRPC, TRPCError } from "@trpc/server";
import { roleCan, type Action, type ObjectType } from "@erp-framework/core";
import type { Context } from "./context";

const t = initTRPC.context<Context>().create();

export const router = t.router;
export const publicProcedure = t.procedure;

export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Cần đăng nhập" });
  }
  return next({ ctx: { ...ctx, user: ctx.user } });
});

/** Procedure yêu cầu quyền `action` trên `obj` theo vai trò người dùng. */
export function rbacProcedure(action: Action, obj: ObjectType) {
  return protectedProcedure.use(({ ctx, next }) => {
    if (!roleCan(ctx.user.role, action, obj)) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: `Vai trò "${ctx.user.role}" không có quyền ${action}:${obj}`,
      });
    }
    return next();
  });
}
