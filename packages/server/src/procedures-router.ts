/* ==========================================================
   procedures-router.ts — tRPC router cho native procedure.
   - list/get  : view, theo công ty
   - save      : upsert theo (companyId, name); validate JS parse được
   - delete    : xoá
   - setEnabled: bật/tắt runtime
   - invoke    : chạy procedure đã lưu với args, trả output
   - test      : chạy ad-hoc code (chưa lưu) để preview trong designer
   ========================================================== */
import { type EntityFieldDef, fieldCan, type Role } from "@erp-framework/core";
import { entities, procedures } from "@erp-framework/db";
import { TRPCError } from "@trpc/server";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { logActivity } from "./activity";
import { callLlmJson } from "./llm-json";
import { makeCallTool } from "./mcp-client";
import { getModuleProcByName } from "./module-procs";
import { makeInvokeProcedure } from "./procedure-runner";
import { rbacProcedure, router } from "./trpc";

/** Strip args theo paramsSchema[].writableBy/readableBy (field-level RBAC).
 *  Param không có writableBy → cho phép mọi role (default open).
 *  Áp dụng ở invoke trước khi gọi runner để code không thấy giá trị
 *  user không có quyền truyền (vd "approve_amount" chỉ admin được set). */
function stripArgsByRbac(
  paramsSchema: Array<Record<string, unknown>>,
  args: Record<string, unknown>,
  role: Role,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...args };
  for (const p of paramsSchema) {
    const name = String(p.name ?? "");
    if (!name) continue;
    const writableBy = Array.isArray(p.writableBy) ? (p.writableBy as Role[]) : undefined;
    if (writableBy && !fieldCan(role, "write", { writableBy })) {
      delete out[name];
    }
  }
  return out;
}

const NAME_RE = /^[a-z][a-z0-9_]*$/;

/** Constructor của async function. Code thủ tục là 1 *async function body*
 *  (dùng top-level await; runtime wrap trong `(async () => { ... })()`).
 *  Validate bằng `new Function` (đồng bộ) sẽ ném "await is only valid in
 *  async functions..." với code hợp lệ → phải dùng AsyncFunction để khớp. */
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor as new (
  ...args: string[]
) => unknown;

/** Validate code parse được (chỉ syntax, KHÔNG exec), cho phép await/return
 *  ở top level đúng như runtime. Trả message lỗi, hoặc null nếu hợp lệ. */
function procedureSyntaxError(code: string): string | null {
  try {
    new AsyncFunction(code);
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}

/** Danh mục entity của công ty cho AI codegen — để AI chỉ tham chiếu entity
 *  CÓ THẬT, tránh lỗi runtime "Entity không tồn tại". Cắt bớt để khỏi phình
 *  prompt (≤80 entity, ≤40 field/entity). */
function buildEntityCatalog(
  rows: Array<{ name: string; label: string | null; fields: unknown }>,
): string {
  if (rows.length === 0) {
    return "(Công ty CHƯA có entity nào — KHÔNG gọi db.*/entity.* với entity không tồn tại.)";
  }
  const lines = rows.slice(0, 80).map((e) => {
    const fs = Array.isArray(e.fields) ? (e.fields as EntityFieldDef[]) : [];
    const fieldStr =
      fs
        .slice(0, 40)
        .map((f) => `${f.name}:${f.type}`)
        .join(", ") + (fs.length > 40 ? ", …" : "");
    return `- ${e.name}${e.label ? ` (${e.label})` : ""}: ${fieldStr || "(chưa có field)"}`;
  });
  if (rows.length > 80) lines.push(`… và ${rows.length - 80} entity khác`);
  return lines.join("\n");
}

const procInput = z.object({
  name: z.string().regex(NAME_RE, "name phải snake_case bắt đầu bằng chữ"),
  label: z.string().min(1),
  description: z.string().optional(),
  paramsSchema: z.array(z.record(z.string(), z.unknown())).optional(),
  returnSchema: z.record(z.string(), z.unknown()).optional(),
  code: z.string().min(1),
  enabled: z.boolean().optional(),
});

export const proceduresRouter = router({
  list: rbacProcedure("view", "procedure").query(({ ctx }) =>
    ctx.db
      .select()
      .from(procedures)
      .where(eq(procedures.companyId, ctx.user.companyId))
      .orderBy(desc(procedures.updatedAt)),
  ),

  get: rbacProcedure("view", "procedure")
    .input(z.string().uuid())
    .query(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .select()
        .from(procedures)
        .where(and(eq(procedures.id, input), eq(procedures.companyId, ctx.user.companyId)));
      return row ?? null;
    }),

  save: rbacProcedure("edit", "procedure")
    .input(procInput)
    .mutation(async ({ ctx, input }) => {
      // Validate parse được (chỉ check syntax, không exec) — cho phép
      // top-level await đúng như runtime wrap async.
      const synErr = procedureSyntaxError(input.code);
      if (synErr) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Code lỗi syntax: ${synErr}`,
        });
      }
      const values = {
        label: input.label,
        description: input.description ?? null,
        paramsSchema: input.paramsSchema ?? [],
        returnSchema: input.returnSchema ?? null,
        code: input.code,
        ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
        updatedAt: new Date(),
      };
      const [ex] = await ctx.db
        .select({ id: procedures.id })
        .from(procedures)
        .where(and(eq(procedures.companyId, ctx.user.companyId), eq(procedures.name, input.name)));
      if (ex) {
        const [row] = await ctx.db
          .update(procedures)
          .set(values)
          .where(eq(procedures.id, ex.id))
          .returning();
        return row;
      }
      const [row] = await ctx.db
        .insert(procedures)
        .values({
          companyId: ctx.user.companyId,
          name: input.name,
          createdBy: ctx.user.id,
          ...values,
        })
        .returning();
      return row;
    }),

  setEnabled: rbacProcedure("edit", "procedure")
    .input(z.object({ id: z.string().uuid(), enabled: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .update(procedures)
        .set({ enabled: input.enabled, updatedAt: new Date() })
        .where(and(eq(procedures.id, input.id), eq(procedures.companyId, ctx.user.companyId)));
      return { ok: true };
    }),

  delete: rbacProcedure("edit", "procedure")
    .input(z.string().uuid())
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .delete(procedures)
        .where(and(eq(procedures.id, input), eq(procedures.companyId, ctx.user.companyId)));
    }),

  invoke: rbacProcedure("run", "procedure")
    .input(
      z.object({
        name: z.string(),
        args: z.record(z.string(), z.unknown()).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Load paramsSchema để strip args theo field-level RBAC.
      const [proc] = await ctx.db
        .select({ paramsSchema: procedures.paramsSchema })
        .from(procedures)
        .where(and(eq(procedures.name, input.name), eq(procedures.companyId, ctx.user.companyId)));
      const schema = (proc?.paramsSchema ?? []) as Array<Record<string, unknown>>;
      const safeArgs = stripArgsByRbac(schema, input.args ?? {}, ctx.user.role);

      const invoke = makeInvokeProcedure({
        db: ctx.db,
        companyId: ctx.user.companyId,
        callTool: makeCallTool(ctx.db, ctx.user.companyId),
        actorUserId: ctx.user.id,
      });
      try {
        const r = await invoke(input.name, safeArgs);
        await logActivity(ctx.db, {
          companyId: ctx.user.companyId,
          kind: "run_procedure",
          objectType: "procedure",
          target: input.name,
          detail: `Procedure chạy ${r.durationMs}ms`,
          actorUserId: ctx.user.id,
        });
        return r;
      } catch (e) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: (e as Error).message });
      }
    }),

  /** Gọi proc Tier D đã port (module-procs registry) tại RUNTIME — cho nút
   *  trang (vd Duyệt → trDanhsachDexuatDuyetBgd). Khác `invoke` (Tier B
   *  sandbox). Proc tự có guard mirror (proc-table assertWritable) + field
   *  RBAC; gate run/procedure ở đây. */
  invokeModule: rbacProcedure("run", "procedure")
    .input(
      z.object({
        name: z.string().min(1),
        args: z.record(z.string(), z.unknown()).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const entry = await getModuleProcByName(input.name);
      if (!entry) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `Proc Tier D '${input.name}' không có trong registry`,
        });
      }
      const t0 = Date.now();
      try {
        const result = await entry.fn(ctx.db, ctx.user.companyId, input.args ?? {});
        await logActivity(ctx.db, {
          companyId: ctx.user.companyId,
          kind: "run_procedure",
          objectType: "procedure",
          target: input.name,
          detail: `Module proc ${entry.module}/${entry.name}`,
          actorUserId: ctx.user.id,
        }).catch(() => undefined);
        return { output: result, durationMs: Date.now() - t0 };
      } catch (e) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: (e as Error).message });
      }
    }),

  // Chạy thử code chưa lưu — designer-only. Vẫn yêu cầu edit role.
  test: rbacProcedure("edit", "procedure")
    .input(
      z.object({
        code: z.string().min(1),
        args: z.record(z.string(), z.unknown()).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Tận dụng invoke bằng cách insert tạm? Đơn giản hơn: import
      // hàm runCode chưa export — tạm thời chạy bằng cách lưu 1 row
      // disabled với tên prefix `__test_<uuid>` rồi xoá. Tránh ô nhiễm
      // DB: dùng transaction rollback.
      const tempName = `__test_${Math.random().toString(36).slice(2, 10)}`;
      const [row] = await ctx.db
        .insert(procedures)
        .values({
          companyId: ctx.user.companyId,
          name: tempName,
          label: "Test",
          code: input.code,
          enabled: true,
          createdBy: ctx.user.id,
        })
        .returning();
      try {
        const invoke = makeInvokeProcedure({
          db: ctx.db,
          companyId: ctx.user.companyId,
          callTool: makeCallTool(ctx.db, ctx.user.companyId),
          actorUserId: ctx.user.id,
        });
        const r = await invoke(tempName, input.args ?? {});
        return r;
      } catch (e) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: (e as Error).message });
      } finally {
        if (row) {
          await ctx.db.delete(procedures).where(eq(procedures.id, row.id));
        }
      }
    }),

  /** AI: sinh draft Thủ tục (procedure) từ mô tả tiếng Việt.
   *  Vd: "Tính tổng giá trị đơn hàng theo tháng" → name + label + code JS.
   *  Trả về { name, label, description, paramsSchema, code } —
   *  client preview/test trước khi save. */
  generateAi: rbacProcedure("create", "procedure")
    .input(
      z.object({
        prompt: z.string().min(5).max(1000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Nạp danh mục entity thật của công ty để AI KHÔNG bịa tên entity
      // (nguyên nhân lỗi runtime "Entity không tồn tại").
      const entRows = await ctx.db
        .select({ name: entities.name, label: entities.label, fields: entities.fields })
        .from(entities)
        .where(eq(entities.companyId, ctx.user.companyId))
        .orderBy(entities.name);
      const entityCatalog = buildEntityCatalog(entRows);

      const r = await callLlmJson<{
        name?: string;
        label?: string;
        description?: string;
        paramsSchema?: Array<Record<string, unknown>>;
        code?: string;
      }>(ctx.db, ctx.user.companyId, {
        system:
          "Bạn là trợ lý viết Thủ tục (native JS procedure) cho hệ thống ERP. " +
          "Thủ tục chạy server-side trong isolated-vm (timeout 5s, RAM 128MB).\n\n" +
          "API có sẵn trong scope global (KHÔNG cần import):\n" +
          "- args: Record<string, unknown>  // tham số gọi vào\n" +
          "- db.queryRecords(entityName, filter)  // SELECT records\n" +
          "- db.findById(entityName, id)\n" +
          "- entity.insert(entityName, data)\n" +
          "- entity.update(entityName, id, patch)\n" +
          "- entity.delete(entityName, id)\n" +
          "- callTool(name, args)   // gọi MCP tool\n" +
          "- callProc(name, args)   // gọi thủ tục khác\n" +
          "- fetch(url, init)       // HTTP\n" +
          "- console.log(...)       // log debug\n" +
          "Mọi op tự động scope theo công ty user.\n\n" +
          "Trả về CHỈ MỘT JSON object dạng:\n" +
          "{\n" +
          '  "name": "<snake_case, vd tinh_tong_don_hang>",\n' +
          '  "label": "<nhãn tiếng Việt ngắn>",\n' +
          '  "description": "<1-2 câu mô tả>",\n' +
          '  "paramsSchema": [\n' +
          '    {"name":"<paramName>", "type":"string|number|boolean|date", "required":true, "description":"<...>"},\n' +
          "    ...\n" +
          "  ],\n" +
          '  "code": "<JS code, async function, dùng args + helper, return giá trị>"\n' +
          "}\n\n" +
          "code là 1 async function body (KHÔNG bọc `async function() {}` ngoài) — " +
          "server tự wrap. Dùng async/await. Return data hoặc throw new Error(msg). " +
          "KHÔNG kèm markdown, KHÔNG giải thích.\n\n" +
          "DANH SÁCH ENTITY CỦA CÔNG TY (entityName + field). CHỈ dùng entity " +
          "trong danh sách này, TUYỆT ĐỐI KHÔNG bịa tên; nếu yêu cầu cần entity " +
          "chưa có thì throw new Error mô tả rõ entity còn thiếu:\n" +
          entityCatalog,
        user: input.prompt,
        maxTokens: 2500,
        temperature: 0.2,
      });

      if (!r || !r.code) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            "AI không sinh được Thủ tục hợp lệ — kiểm tra LLM profile hoặc thử lại với mô tả rõ hơn.",
        });
      }

      // Validate code parse được (chỉ syntax, không exec) — async wrapper.
      const aiSynErr = procedureSyntaxError(r.code);
      if (aiSynErr) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `AI sinh code lỗi syntax: ${aiSynErr}. Thử lại hoặc viết tay.`,
        });
      }

      const slugify = (s: string) =>
        String(s)
          .toLowerCase()
          .normalize("NFD")
          .replace(/[̀-ͯ]/g, "")
          .replace(/[^a-z0-9_]+/g, "_")
          .replace(/^_+|_+$/g, "")
          .slice(0, 50);

      return {
        name: slugify(r.name ?? input.prompt),
        label: String(r.label ?? "").trim() || input.prompt.slice(0, 80),
        description: r.description ? String(r.description).trim() : undefined,
        paramsSchema: Array.isArray(r.paramsSchema) ? r.paramsSchema : [],
        code: r.code,
      };
    }),
});
