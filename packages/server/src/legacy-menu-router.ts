/* ==========================================================
   legacy-menu-router.ts — tRPC cho cockpit menu-driven.
   - importFromMssql : đọc SYS_MENU_NEW qua connection MSSQL mặc định,
                       upsert vào legacy_menu_map (giữ tiến độ port).
   - listTree        : cây menu legacy lồng (cho UI cockpit).
   - stats           : tiến độ port (chua/dang/xong + số form).
   - setPortStatus   : đổi trạng thái port 1 node (thủ công).
   Toàn bộ rbacProcedure("edit","settings") — admin only.
   ========================================================== */

import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { legacyMenuMap, legacyReports, pages } from "@erp-framework/db";
import { TRPCError } from "@trpc/server";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { logActivity } from "./activity";
import type { DB } from "./db";
import { importLegacyMenu, legacyMenuStats, listLegacyMenuTree } from "./legacy-menu";
import { resolveAllMenuNodes, resolveTablesForProcs, slugifyModule } from "./legacy-menu-resolve";
import { parseAllReports } from "./legacy-report-parse";
import { openDefaultMssql } from "./migration-router";
import { enqueueMigrationJob } from "./migration-worker";
import { approvedProcedure, rbacProcedure, router } from "./trpc";

/** Merge 1 patch vào cột overrides (jsonb): overrides = coalesce(overrides,{}) || patch.
 *  Ghi lại chỉnh tay để reapplyMenuOverrides() áp lại sau mỗi lần re-import DQHF. */
function mergeOverridesSql(patch: Record<string, unknown>) {
  return sql`coalesce(${legacyMenuMap.overrides}, '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb`;
}

interface StructRow {
  sourceCode: string;
  parentCode: string | null;
  level: number | null;
  sort: number;
  custom: boolean;
  name: string | null;
}

/** Nạp tối thiểu (code/parent/level/sort/custom/name) toàn company cho thao tác cấu trúc. */
async function loadStructure(db: DB, companyId: string): Promise<StructRow[]> {
  return await db
    .select({
      sourceCode: legacyMenuMap.sourceCode,
      parentCode: legacyMenuMap.parentCode,
      level: legacyMenuMap.level,
      sort: legacyMenuMap.sort,
      custom: legacyMenuMap.custom,
      name: legacyMenuMap.name,
    })
    .from(legacyMenuMap)
    .where(eq(legacyMenuMap.companyId, companyId));
}

/** Tập hậu duệ (gồm chính nó) của 1 node — chặn chuyển cha gây vòng. */
function descendantsOf(all: StructRow[], code: string): Set<string> {
  const childrenByParent = new Map<string | null, string[]>();
  for (const r of all) {
    const list = childrenByParent.get(r.parentCode) ?? [];
    list.push(r.sourceCode);
    childrenByParent.set(r.parentCode, list);
  }
  const out = new Set<string>([code]);
  const stack = [code];
  while (stack.length) {
    const cur = stack.pop();
    if (cur === undefined) break;
    for (const child of childrenByParent.get(cur) ?? []) {
      if (!out.has(child)) {
        out.add(child);
        stack.push(child);
      }
    }
  }
  return out;
}

/** sort kế tiếp (cuối nhóm) trong nhóm cùng cha. */
function nextSortInGroup(all: StructRow[], parentCode: string | null): number {
  const sibs = all.filter((r) => r.parentCode === parentCode);
  return sibs.length ? Math.max(...sibs.map((s) => s.sort)) + 10 : 0;
}

export const legacyMenuRouter = router({
  /** Cây điều hướng theo MENU DQHF — dùng chung Portal (viewer) + Sidebar
   *  (admin). Trả thông tin nav tối thiểu + lọc node có nhánh dẫn tới trang
   *  (ẩn nhánh rỗng). Phân quyền: admin/editor thấy cả trang DRAFT (chưa
   *  publish) để vừa điều hướng vừa quản lý; viewer chỉ thấy trang ĐÃ PUBLISH. */
  navTree: approvedProcedure.query(async ({ ctx }) => {
    const includeDrafts = ctx.user.role === "admin" || ctx.user.role === "editor";
    const rows = await ctx.db
      .select({
        sourceCode: legacyMenuMap.sourceCode,
        name: legacyMenuMap.name,
        level: legacyMenuMap.level,
        parentCode: legacyMenuMap.parentCode,
        sort: legacyMenuMap.sort,
        pageId: legacyMenuMap.pageId,
        pageName: pages.name,
        published: pages.published,
      })
      .from(legacyMenuMap)
      .leftJoin(pages, eq(legacyMenuMap.pageId, pages.id))
      .where(and(eq(legacyMenuMap.companyId, ctx.user.companyId), eq(legacyMenuMap.active, true)));
    // Lá hợp lệ = node có trang tồn tại (pageName != null) + (đã publish HOẶC
    // user là admin/editor được xem draft).
    const isVisibleLeaf = (r: (typeof rows)[number]) =>
      r.pageId != null && r.pageName != null && (r.published === true || includeDrafts);
    // Chỉ giữ node lá hợp lệ HOẶC node nhóm có hậu duệ dẫn tới lá hợp lệ.
    const byCode = new Map(rows.map((r) => [r.sourceCode, r]));
    const hasLeaf = new Set<string>();
    for (const r of rows) {
      if (isVisibleLeaf(r)) {
        let cur: string | null = r.sourceCode;
        while (cur && !hasLeaf.has(cur)) {
          hasLeaf.add(cur);
          cur = byCode.get(cur)?.parentCode ?? null;
        }
      }
    }
    return rows
      .filter((r) => hasLeaf.has(r.sourceCode))
      .map((r) => ({
        code: r.sourceCode,
        name: r.name,
        level: r.level,
        parentCode: r.parentCode,
        sort: r.sort,
        pageId: isVisibleLeaf(r) ? r.pageId : null,
      }));
  }),

  /** Liệt kê MỌI node menu legacy (kể cả nhóm + node chưa gán trang) kèm tên
   *  trang đang gán — phục vụ UI "Gán trang cho menu". Khác navTree: KHÔNG lọc
   *  bỏ nhánh rỗng (admin cần thấy hết để gán). Admin/editor settings. */
  pageBindings: rbacProcedure("edit", "settings").query(async ({ ctx }) => {
    // KHÔNG lọc active — admin cần thấy cả node đang ẩn để quản/hiện lại.
    const rows = await ctx.db
      .select({
        sourceCode: legacyMenuMap.sourceCode,
        name: legacyMenuMap.name,
        level: legacyMenuMap.level,
        parentCode: legacyMenuMap.parentCode,
        sort: legacyMenuMap.sort,
        winId: legacyMenuMap.winId,
        active: legacyMenuMap.active,
        custom: legacyMenuMap.custom,
        portStatus: legacyMenuMap.portStatus,
        pageId: legacyMenuMap.pageId,
        pageLabel: pages.label,
        pageName: pages.name,
        pagePublished: pages.published,
      })
      .from(legacyMenuMap)
      .leftJoin(pages, eq(legacyMenuMap.pageId, pages.id))
      .where(eq(legacyMenuMap.companyId, ctx.user.companyId));
    return rows;
  }),

  /** Gán (hoặc gỡ) trang cho 1 node menu legacy theo sourceCode. pageId=null →
   *  gỡ liên kết. Khi gán: page phải thuộc công ty. Đánh dấu portStatus='xong'
   *  khi gán (node đã có trang đích) — KHÔNG đụng status khi gỡ. */
  setNodePage: rbacProcedure("edit", "settings")
    .input(
      z.object({
        sourceCode: z.string().min(1),
        pageId: z.string().uuid().nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (input.pageId) {
        const [pg] = await ctx.db
          .select({ id: pages.id })
          .from(pages)
          .where(and(eq(pages.id, input.pageId), eq(pages.companyId, ctx.user.companyId)))
          .limit(1);
        if (!pg) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Trang không tồn tại." });
        }
      }
      const [row] = await ctx.db
        .update(legacyMenuMap)
        .set({
          pageId: input.pageId,
          // Gán → coi như đã có đích (xong); gỡ → giữ nguyên status.
          ...(input.pageId ? { portStatus: "xong" } : {}),
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
      await logActivity(ctx.db, {
        companyId: ctx.user.companyId,
        actorUserId: ctx.user.id,
        kind: "legacy_menu.set_page",
        detail: input.pageId
          ? `Gán trang ${input.pageId} cho menu ${input.sourceCode}`
          : `Gỡ trang khỏi menu ${input.sourceCode}`,
      }).catch(() => undefined);
      return { ok: true, pageId: input.pageId };
    }),

  /** Đổi tên 1 node menu (ghi raw + override để giữ qua re-import). */
  renameNode: rbacProcedure("edit", "settings")
    .input(z.object({ sourceCode: z.string().min(1), name: z.string().trim().min(1).max(200) }))
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .update(legacyMenuMap)
        .set({
          name: input.name,
          overrides: mergeOverridesSql({ name: input.name }),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(legacyMenuMap.companyId, ctx.user.companyId),
            eq(legacyMenuMap.sourceCode, input.sourceCode),
          ),
        )
        .returning({ id: legacyMenuMap.id });
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Node menu không tồn tại." });
      return { ok: true };
    }),

  /** Ẩn/hiện 1 node (active). Node ẩn biến mất khỏi portal nhưng vẫn quản được ở UI admin. */
  setNodeActive: rbacProcedure("edit", "settings")
    .input(z.object({ sourceCode: z.string().min(1), active: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .update(legacyMenuMap)
        .set({
          active: input.active,
          overrides: mergeOverridesSql({ active: input.active }),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(legacyMenuMap.companyId, ctx.user.companyId),
            eq(legacyMenuMap.sourceCode, input.sourceCode),
          ),
        )
        .returning({ id: legacyMenuMap.id });
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Node menu không tồn tại." });
      return { ok: true, active: input.active };
    }),

  /** Chuyển 1 node sang cha khác (hoặc ra gốc parentCode=null). Chặn vòng. */
  moveNode: rbacProcedure("edit", "settings")
    .input(z.object({ sourceCode: z.string().min(1), parentCode: z.string().nullable() }))
    .mutation(async ({ ctx, input }) => {
      if (input.parentCode === input.sourceCode)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Không thể đặt node làm cha của chính nó.",
        });
      const all = await loadStructure(ctx.db, ctx.user.companyId);
      const node = all.find((n) => n.sourceCode === input.sourceCode);
      if (!node) throw new TRPCError({ code: "NOT_FOUND", message: "Node menu không tồn tại." });
      let parent: StructRow | null = null;
      if (input.parentCode !== null) {
        parent = all.find((n) => n.sourceCode === input.parentCode) ?? null;
        if (!parent)
          throw new TRPCError({ code: "NOT_FOUND", message: "Node cha đích không tồn tại." });
        if (descendantsOf(all, input.sourceCode).has(input.parentCode))
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Không thể chuyển vào nhánh con của chính nó (gây vòng).",
          });
      }
      const newLevel = parent ? (parent.level ?? 0) + 1 : 1;
      const newSort = nextSortInGroup(all, input.parentCode);
      await ctx.db
        .update(legacyMenuMap)
        .set({
          parentCode: input.parentCode,
          level: newLevel,
          sort: newSort,
          overrides: mergeOverridesSql({
            parentCode: input.parentCode,
            level: newLevel,
            sort: newSort,
          }),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(legacyMenuMap.companyId, ctx.user.companyId),
            eq(legacyMenuMap.sourceCode, input.sourceCode),
          ),
        );
      return { ok: true };
    }),

  /** Đổi thứ tự 1 node trong nhóm cùng cha (lên/xuống). Chuẩn hoá lại sort cả nhóm. */
  reorderNode: rbacProcedure("edit", "settings")
    .input(z.object({ sourceCode: z.string().min(1), direction: z.enum(["up", "down"]) }))
    .mutation(async ({ ctx, input }) => {
      const all = await loadStructure(ctx.db, ctx.user.companyId);
      const node = all.find((n) => n.sourceCode === input.sourceCode);
      if (!node) throw new TRPCError({ code: "NOT_FOUND", message: "Node menu không tồn tại." });
      const sibs = all
        .filter((n) => n.parentCode === node.parentCode)
        .sort((a, b) => a.sort - b.sort || (a.name ?? "").localeCompare(b.name ?? "", "vi"));
      const ids = sibs.map((s) => s.sourceCode);
      const idx = ids.indexOf(input.sourceCode);
      const swapWith = input.direction === "up" ? idx - 1 : idx + 1;
      if (swapWith < 0 || swapWith >= ids.length) return { ok: true, moved: false };
      const [moved] = ids.splice(idx, 1);
      ids.splice(swapWith, 0, moved as string);
      const sortByCode = new Map(sibs.map((s) => [s.sourceCode, s.sort]));
      await ctx.db.transaction(async (tx) => {
        let pos = 0;
        for (const code of ids) {
          const newSort = pos * 10;
          pos++;
          if (sortByCode.get(code) === newSort) continue;
          await tx
            .update(legacyMenuMap)
            .set({
              sort: newSort,
              overrides: mergeOverridesSql({ sort: newSort }),
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(legacyMenuMap.companyId, ctx.user.companyId),
                eq(legacyMenuMap.sourceCode, code),
              ),
            );
        }
      });
      return { ok: true, moved: true };
    }),

  /** Thêm node menu tự tạo (custom) dưới 1 cha (hoặc gốc). Sống sót re-import vì
   *  source_code riêng không có trong SYS_MENU_NEW. */
  addNode: rbacProcedure("edit", "settings")
    .input(z.object({ parentCode: z.string().nullable(), name: z.string().trim().min(1).max(200) }))
    .mutation(async ({ ctx, input }) => {
      const all = await loadStructure(ctx.db, ctx.user.companyId);
      let parent: StructRow | null = null;
      if (input.parentCode !== null) {
        parent = all.find((n) => n.sourceCode === input.parentCode) ?? null;
        if (!parent) throw new TRPCError({ code: "NOT_FOUND", message: "Node cha không tồn tại." });
      }
      const sourceCode = `CUST-${randomUUID()}`;
      const level = parent ? (parent.level ?? 0) + 1 : 1;
      const sort = nextSortInGroup(all, input.parentCode);
      await ctx.db.insert(legacyMenuMap).values({
        companyId: ctx.user.companyId,
        sourceId: 0,
        sourceCode,
        name: input.name,
        level,
        parentCode: input.parentCode,
        sort,
        custom: true,
        active: true,
        portStatus: "chua",
      });
      await logActivity(ctx.db, {
        companyId: ctx.user.companyId,
        actorUserId: ctx.user.id,
        kind: "legacy_menu.add_node",
        detail: `Thêm mục menu "${input.name}"`,
      }).catch(() => undefined);
      return { ok: true, sourceCode };
    }),

  /** Xoá 1 node — CHỈ node custom + không còn con. Node DQHF gốc dùng Ẩn thay vì xoá. */
  deleteNode: rbacProcedure("edit", "settings")
    .input(z.object({ sourceCode: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const all = await loadStructure(ctx.db, ctx.user.companyId);
      const node = all.find((n) => n.sourceCode === input.sourceCode);
      if (!node) throw new TRPCError({ code: "NOT_FOUND", message: "Node menu không tồn tại." });
      if (!node.custom)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Chỉ xoá được mục tự thêm. Mục từ DQHF hãy dùng Ẩn.",
        });
      if (all.some((n) => n.parentCode === input.sourceCode))
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Mục còn mục con — xoá hoặc chuyển mục con trước.",
        });
      await ctx.db
        .delete(legacyMenuMap)
        .where(
          and(
            eq(legacyMenuMap.companyId, ctx.user.companyId),
            eq(legacyMenuMap.sourceCode, input.sourceCode),
          ),
        );
      return { ok: true };
    }),

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
        // PROC-CENTRIC: truyền đúng proc form gọi → discover chỉ migrate các
        // proc này + bảng chúng dùng, KHÔNG gom proc lạ theo bảng. seedTables
        // vẫn truyền làm bảng nền.
        args: { seedTables, seedProcs: procs, maxTables: input.maxTables },
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
