/* ==========================================================
   enums-router.ts — Reusable enum (option set) đa ngôn ngữ.
   Field type "enum"/"multi-enum" tham chiếu qua id; nhiều field
   chia chung một enum (vd order_status, priority, color…).
   ========================================================== */
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { enums } from "@erp-framework/db";
import { router, rbacProcedure } from "./trpc";
import { callLlmJson } from "./llm-json";

const NAME_RE = /^[a-z][a-z0-9_]*$/;

const enumValue = z.object({
  value: z.string().min(1),
  label: z.string().min(1),
  labelEn: z.string().optional(),
});

const enumInput = z.object({
  name: z.string().regex(NAME_RE, "name phải snake_case bắt đầu bằng chữ"),
  label: z.string().min(1),
  labelEn: z.string().optional(),
  description: z.string().optional(),
  values: z.array(enumValue),
  enabled: z.boolean().optional(),
});

export const enumsRouter = router({
  list: rbacProcedure("view", "enum")
    .query(({ ctx }) => ctx.db.select().from(enums)
      .where(eq(enums.companyId, ctx.user.companyId))
      .orderBy(desc(enums.updatedAt))),

  get: rbacProcedure("view", "enum")
    .input(z.string().uuid())
    .query(async ({ ctx, input }) => {
      const [row] = await ctx.db.select().from(enums)
        .where(and(eq(enums.id, input),
          eq(enums.companyId, ctx.user.companyId)));
      return row ?? null;
    }),

  save: rbacProcedure("edit", "enum")
    .input(enumInput)
    .mutation(async ({ ctx, input }) => {
      const values = {
        label: input.label,
        labelEn: input.labelEn ?? null,
        description: input.description ?? null,
        values: input.values,
        ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
        updatedAt: new Date(),
      };
      const [ex] = await ctx.db.select({ id: enums.id })
        .from(enums)
        .where(and(eq(enums.companyId, ctx.user.companyId),
          eq(enums.name, input.name)));
      if (ex) {
        const [row] = await ctx.db.update(enums)
          .set(values).where(eq(enums.id, ex.id)).returning();
        return row;
      }
      const [row] = await ctx.db.insert(enums).values({
        companyId: ctx.user.companyId,
        name: input.name,
        createdBy: ctx.user.id,
        ...values,
      }).returning();
      return row;
    }),

  setEnabled: rbacProcedure("edit", "enum")
    .input(z.object({ id: z.string().uuid(), enabled: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.update(enums)
        .set({ enabled: input.enabled, updatedAt: new Date() })
        .where(and(eq(enums.id, input.id),
          eq(enums.companyId, ctx.user.companyId)));
      return { ok: true };
    }),

  delete: rbacProcedure("delete", "enum")
    .input(z.string().uuid())
    .mutation(async ({ ctx, input }) => {
      await ctx.db.delete(enums).where(and(
        eq(enums.id, input),
        eq(enums.companyId, ctx.user.companyId)));
    }),

  /** AI: sinh draft Danh mục từ mô tả tiếng Việt.
   *  Vd: "Trạng thái đơn hàng" → values draft/confirmed/shipped/...
   *  Trả về { name, label, labelEn, description, values[] } —
   *  client preview/sửa trước khi save. */
  generateAi: rbacProcedure("create", "enum")
    .input(z.object({
      prompt: z.string().min(3).max(500),
      /** Số lượng giá trị mong muốn (mặc định 5-8, max 30). */
      hintCount: z.number().int().min(2).max(30).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const targetCount = input.hintCount ?? 6;
      const r = await callLlmJson<{
        name?: string; label?: string; labelEn?: string;
        description?: string;
        values?: Array<{ value?: string; label?: string; labelEn?: string }>;
      }>(ctx.db, ctx.user.companyId, {
        system:
          "Bạn là trợ lý thiết kế Danh mục (enum) cho hệ thống ERP đa ngôn ngữ. "
          + "Người dùng mô tả ý tưởng — bạn sinh draft sẵn để họ chỉnh sửa.\n\n"
          + 'Trả về CHỈ MỘT JSON object dạng:\n'
          + '{\n'
          + '  "name": "<snake_case, bắt đầu chữ thường, vd order_status>",\n'
          + '  "label": "<nhãn tiếng Việt ngắn, vd Trạng thái đơn hàng>",\n'
          + '  "labelEn": "<English label, vd Order Status>",\n'
          + '  "description": "<1 câu mô tả>",\n'
          + '  "values": [\n'
          + '    {"value":"<snake_case>", "label":"<tiếng Việt>", "labelEn":"<English>"},\n'
          + '    ...\n'
          + '  ]\n'
          + '}\n\n'
          + `Tạo khoảng ${targetCount} giá trị, sắp xếp theo thứ tự logic. `
          + "value snake_case không dấu. label tiếng Việt có dấu, ngắn gọn. "
          + "KHÔNG kèm markdown, KHÔNG giải thích.",
        user: input.prompt,
        maxTokens: 1500,
        temperature: 0.3,
      });

      if (!r || !r.values || !Array.isArray(r.values)) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "AI không sinh được Danh mục hợp lệ — kiểm tra LLM profile hoặc thử lại với mô tả rõ hơn.",
        });
      }

      // Sanitize: bảo đảm value snake_case + label không rỗng.
      const cleanValue = (s: unknown): string => String(s ?? "")
        .toLowerCase()
        .normalize("NFD").replace(/[̀-ͯ]/g, "")
        .replace(/[^a-z0-9_]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .slice(0, 50);
      const values = r.values
        .map((v) => ({
          value: cleanValue(v.value ?? v.label),
          label: String(v.label ?? v.value ?? "").trim().slice(0, 100),
          labelEn: v.labelEn ? String(v.labelEn).trim().slice(0, 100) : undefined,
        }))
        .filter((v) => v.value && v.label);

      return {
        name: cleanValue(r.name ?? input.prompt),
        label: String(r.label ?? "").trim() || input.prompt.slice(0, 80),
        labelEn: r.labelEn ? String(r.labelEn).trim() : undefined,
        description: r.description ? String(r.description).trim() : undefined,
        values,
      };
    }),
});
