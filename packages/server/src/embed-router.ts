/* ==========================================================
   embed-router.ts — Token nhúng builder vào sản phẩm khác.
   Mỗi token gắn với một công ty + phạm vi (scope). Trang designer
   mở kèm ?embed=1&token=… : EmbedGate (__root.tsx) gọi `verify`
   để kiểm token TRƯỚC khi hiển thị; token thu hồi → chặn ngay.
   - verify : (CÔNG KHAI) xác thực một token nhúng còn hiệu lực
   - list   : token nhúng của công ty
   - create : tạo token mới (sinh chuỗi ngẫu nhiên)
   - revoke : thu hồi token

   Lưu ý: `verify` cổng giao diện nhúng; các API dữ liệu (/trpc)
   vẫn yêu cầu phiên đăng nhập như thường — token nhúng KHÔNG cấp
   quyền truy cập dữ liệu thay cho đăng nhập.
   ========================================================== */
import { z } from "zod";
import { randomBytes } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { embedTokens } from "@erp-framework/db";
import { router, publicProcedure, rbacProcedure } from "./trpc";

export const embedRouter = router({
  // Xác thực token nhúng — CÔNG KHAI (trang nhúng chưa chắc đã đăng
  // nhập khi gọi). Trả về scope nếu token tồn tại & chưa bị thu hồi.
  verify: publicProcedure
    .input(z.string().min(1))
    .query(async ({ ctx, input }) => {
      const [row] = await ctx.db.select({ scope: embedTokens.scope })
        .from(embedTokens).where(eq(embedTokens.token, input));
      return row
        ? { valid: true as const, scope: row.scope }
        : { valid: false as const };
    }),

  list: rbacProcedure("view", "settings")
    .query(({ ctx }) => ctx.db.select().from(embedTokens)
      .where(eq(embedTokens.companyId, ctx.user.companyId))
      .orderBy(desc(embedTokens.createdAt))),

  create: rbacProcedure("edit", "settings")
    .input(z.object({
      label: z.string().optional(),
      scope: z.enum(["all", "page", "workflow", "entity"]).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const token = randomBytes(24).toString("base64url");
      const [row] = await ctx.db.insert(embedTokens).values({
        companyId: ctx.user.companyId,
        token,
        label: input.label ?? "",
        scope: input.scope ?? "all",
      }).returning();
      return row;
    }),

  revoke: rbacProcedure("edit", "settings")
    .input(z.string().uuid())
    .mutation(async ({ ctx, input }) => {
      await ctx.db.delete(embedTokens).where(and(
        eq(embedTokens.id, input),
        eq(embedTokens.companyId, ctx.user.companyId)));
    }),
});
