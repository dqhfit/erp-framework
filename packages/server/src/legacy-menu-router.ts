/* ==========================================================
   legacy-menu-router.ts — tRPC cho cockpit menu-driven.
   - importFromMssql : đọc SYS_MENU_NEW qua connection MSSQL mặc định,
                       upsert vào legacy_menu_map (giữ tiến độ port).
   - listTree        : cây menu legacy lồng (cho UI cockpit).
   - stats           : tiến độ port (chua/dang/xong + số form).
   - setPortStatus   : đổi trạng thái port 1 node (thủ công).
   Toàn bộ rbacProcedure("edit","settings") — admin only.
   ========================================================== */

import { existsSync } from "node:fs";
import { legacyMenuMap, legacyReports } from "@erp-framework/db";
import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { importLegacyMenu, legacyMenuStats, listLegacyMenuTree } from "./legacy-menu";
import { resolveAllMenuNodes, resolveTablesForProcs, slugifyModule } from "./legacy-menu-resolve";
import { parseAllReports } from "./legacy-report-parse";
import { openDefaultMssql } from "./migration-router";
import { enqueueMigrationJob } from "./migration-worker";
import { logActivity } from "./activity";
import { rbacProcedure, router } from "./trpc";

export const legacyMenuRouter = router({
  /** Kiểm tra trạng thái cấu hình cần thiết cho cockpit (DQHF_SOURCE_DIR, MSSQL). */
  checkSetup: rbacProcedure("edit", "settings").query(async ({ ctx }) => {
    const dqhfDir = process.env.DQHF_SOURCE_DIR ?? null;
    const dqhfExists = dqhfDir ? existsSync(dqhfDir) : false;

    // Kiểm tra connection MSSQL mặc định (không throw — chỉ trả flag)
    let mssqlOk = false;
    try {
      const client = await openDefaultMssql(ctx.db, ctx.user.companyId);
      await client.close();
      mssqlOk = true;
    } catch {
      mssqlOk = false;
    }

    return {
      dqhfDir,
      dqhfDirSet: dqhfDir !== null,
      dqhfDirExists: dqhfExists,
      mssqlOk,
    };
  }),

  /** Lưu hàng loạt kết quả resolve đã phân tích sẵn từ client (browser-side).
   *  Dùng khi source C# nằm trên máy dev, không mount được vào server. */
  bulkResolve: rbacProcedure("edit", "settings")
    .input(
      z.array(
        z.object({
          sourceCode: z.string().min(1),
          procs: z.array(z.string()),
          controls: z.array(z.string()),
          repos: z.array(z.string()),
          reports: z.array(z.string()),
          filesScanned: z.number().int().min(0),
          note: z.string().optional(),
        }),
      ),
    )
    .mutation(async ({ ctx, input }) => {
      let resolved = 0;
      let withProcs = 0;
      let noForm = 0;
      for (const r of input) {
        await ctx.db
          .update(legacyMenuMap)
          .set({
            resolved: {
              procs: r.procs,
              controls: r.controls,
              repos: r.repos,
              reports: r.reports,
              filesScanned: r.filesScanned,
              ...(r.note ? { note: r.note } : {}),
            },
            resolvedAt: new Date(),
          })
          .where(
            and(
              eq(legacyMenuMap.companyId, ctx.user.companyId),
              eq(legacyMenuMap.sourceCode, r.sourceCode),
            ),
          );
        resolved++;
        if (r.procs.length) withProcs++;
        if (r.note) noForm++;
      }
      return { totalForms: input.length, resolved, withProcs, noForm };
    }),

  /** Xóa DQHF_SOURCE_DIR khỏi process.env (session-only). */
  clearSourceDir: rbacProcedure("edit", "settings").mutation(() => {
    delete process.env.DQHF_SOURCE_DIR;
    return { ok: true };
  }),

  /** Đặt DQHF_SOURCE_DIR tại runtime (session-only, mất khi restart server).
   *  Validate thư mục tồn tại trước khi set. */
  setSourceDir: rbacProcedure("edit", "settings")
    .input(z.object({ dir: z.string().min(1) }))
    .mutation(async ({ input }) => {
      const dir = input.dir.trim();
      if (!existsSync(dir)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Thư mục không tồn tại: ${dir}`,
        });
      }
      process.env.DQHF_SOURCE_DIR = dir;
      return { ok: true, dir };
    }),

  /** Import (upsert) toàn bộ SYS_MENU_NEW từ DB nguồn mặc định. */
  importFromMssql: rbacProcedure("edit", "settings").mutation(async ({ ctx }) => {
    const client = await openDefaultMssql(ctx.db, ctx.user.companyId);
    try {
      const r = await importLegacyMenu(ctx.db, ctx.user.companyId, client);
      await logActivity(ctx.db, {
        companyId: ctx.user.companyId,
        actorUserId: ctx.user.id,
        kind: "legacy_menu.import",
        detail: `Import menu cũ: ${r.imported} mới, ${r.updated} cập nhật (tổng ${r.total})`,
      }).catch(() => undefined);
      return r;
    } finally {
      await client.close();
    }
  }),

  /** Cây menu legacy lồng (parent → children). */
  listTree: rbacProcedure("edit", "settings").query(async ({ ctx }) => {
    return await listLegacyMenuTree(ctx.db, ctx.user.companyId);
  }),

  /** Thống kê tiến độ port. */
  stats: rbacProcedure("edit", "settings").query(async ({ ctx }) => {
    return await legacyMenuStats(ctx.db, ctx.user.companyId);
  }),

  /** Resolver: đọc source C# DQHF (env DQHF_SOURCE_DIR) → với mỗi node có
   *  form, suy ra tập proc/control/repo → lưu legacy_menu_map.resolved.
   *  Cần chạy nơi có source .cs (dev/mount). */
  resolveFromSource: rbacProcedure("edit", "settings").mutation(async ({ ctx }) => {
    const root = process.env.DQHF_SOURCE_DIR;
    if (!root) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message:
          "Chưa đặt env DQHF_SOURCE_DIR (đường dẫn source DQHF) — resolver cần đọc file .cs.",
      });
    }
    if (!existsSync(root)) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: `DQHF_SOURCE_DIR không tồn tại: ${root}`,
      });
    }
    return await resolveAllMenuNodes(ctx.db, ctx.user.companyId, root);
  }),

  /** Parse blueprint mọi report (rpt_*) menu tham chiếu → legacy_reports.
   *  Cần env DQHF_SOURCE_DIR (đọc rpt*.Designer.cs). Chạy sau resolveFromSource. */
  parseReports: rbacProcedure("edit", "settings").mutation(async ({ ctx }) => {
    const root = process.env.DQHF_SOURCE_DIR;
    if (!root) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "Chưa đặt env DQHF_SOURCE_DIR — parser report cần đọc rpt*.Designer.cs.",
      });
    }
    if (!existsSync(root)) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: `DQHF_SOURCE_DIR không tồn tại: ${root}`,
      });
    }
    return await parseAllReports(ctx.db, ctx.user.companyId, root);
  }),

  /** Liệt kê blueprint report đã parse (cho cockpit hiển thị). */
  listReports: rbacProcedure("edit", "settings").query(async ({ ctx }) => {
    return await ctx.db
      .select({
        reportClass: legacyReports.reportClass,
        title: legacyReports.title,
        kind: legacyReports.kind,
        dataProcs: legacyReports.dataProcs,
        columns: legacyReports.columns,
        groups: legacyReports.groups,
        summaries: legacyReports.summaries,
        hasBeforePrint: legacyReports.hasBeforePrint,
        pageId: legacyReports.pageId,
      })
      .from(legacyReports)
      .where(eq(legacyReports.companyId, ctx.user.companyId));
  }),

  /** Lấy kết quả resolve (procs/controls/repos) của 1 node — cho panel chi tiết. */
  getResolved: rbacProcedure("edit", "settings")
    .input(z.object({ sourceCode: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .select({
          name: legacyMenuMap.name,
          winId: legacyMenuMap.winId,
          namespace: legacyMenuMap.namespace,
          portStatus: legacyMenuMap.portStatus,
          module: legacyMenuMap.module,
          pageId: legacyMenuMap.pageId,
          resolved: legacyMenuMap.resolved,
          resolvedAt: legacyMenuMap.resolvedAt,
        })
        .from(legacyMenuMap)
        .where(
          and(
            eq(legacyMenuMap.companyId, ctx.user.companyId),
            eq(legacyMenuMap.sourceCode, input.sourceCode),
          ),
        )
        .limit(1);
      return row ?? null;
    }),

  /** Port 1 mục menu: từ procs đã resolve → bảng (MSSQL) → enqueue discover
   *  scoped (module riêng) → đánh dấu portStatus=dang. Trả module + jobId. */
  portNode: rbacProcedure("edit", "settings")
    .input(
      z.object({
        sourceCode: z.string().min(1),
        module: z
          .string()
          .regex(/^[a-z][a-z0-9_]*$/)
          .optional(),
        maxTables: z.number().int().min(1).max(200).default(60),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [node] = await ctx.db
        .select({
          name: legacyMenuMap.name,
          sourceCode: legacyMenuMap.sourceCode,
          resolved: legacyMenuMap.resolved,
        })
        .from(legacyMenuMap)
        .where(
          and(
            eq(legacyMenuMap.companyId, ctx.user.companyId),
            eq(legacyMenuMap.sourceCode, input.sourceCode),
          ),
        )
        .limit(1);
      if (!node) throw new TRPCError({ code: "NOT_FOUND", message: "Node menu không tồn tại." });

      const resolved = node.resolved as { procs?: string[] } | null;
      const procs = resolved?.procs ?? [];
      if (!procs.length) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "Mục này chưa resolve hoặc không có proc — chạy Resolve hoặc seed bảng thủ công.",
        });
      }

      // procs → bảng qua MSSQL (lọc nhiễu).
      const client = await openDefaultMssql(ctx.db, ctx.user.companyId);
      let seedTables: string[];
      try {
        ({ tables: seedTables } = await resolveTablesForProcs(procs, client));
      } finally {
        await client.close();
      }
      if (!seedTables.length) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Không suy ra được bảng từ proc (proc đã đổi tên?) — seed bảng thủ công.",
        });
      }

      const module = input.module ?? slugifyModule(node.name, `menu_${node.sourceCode}`);
      const jobId = await enqueueMigrationJob({
        action: "discover",
        module,
        args: { seedTables, maxTables: input.maxTables },
        userId: ctx.user.id,
        companyId: ctx.user.companyId,
      });

      await ctx.db
        .update(legacyMenuMap)
        .set({ portStatus: "dang", module, updatedAt: new Date() })
        .where(
          and(
            eq(legacyMenuMap.companyId, ctx.user.companyId),
            eq(legacyMenuMap.sourceCode, input.sourceCode),
          ),
        );

      await logActivity(ctx.db, {
        companyId: ctx.user.companyId,
        actorUserId: ctx.user.id,
        kind: "legacy_menu.port",
        detail: `Port menu "${node.name}" → module ${module} (discover ${seedTables.length} bảng)`,
      }).catch(() => undefined);

      return { module, jobId, seedTables };
    }),

  /** Đổi trạng thái port 1 node (thủ công; cockpit cũng tự set khi port). */
  setPortStatus: rbacProcedure("edit", "settings")
    .input(
      z.object({
        sourceCode: z.string().min(1),
        status: z.enum(["chua", "dang", "xong"]),
        module: z.string().optional(),
        pageId: z.string().uuid().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .update(legacyMenuMap)
        .set({
          portStatus: input.status,
          module: input.module ?? undefined,
          pageId: input.pageId ?? undefined,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(legacyMenuMap.companyId, ctx.user.companyId),
            eq(legacyMenuMap.sourceCode, input.sourceCode),
          ),
        )
        .returning({ id: legacyMenuMap.id });
      if (!row) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Node menu không tồn tại." });
      }
      return { ok: true, status: input.status };
    }),
});
