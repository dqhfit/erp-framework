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
import { and, eq, isNull, sql } from "drizzle-orm";
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

/** Trang RỖNG = placeholder/tạm (chưa có widget nào). content có 2 dạng: mảng
 *  components trực tiếp, hoặc object {components:[...]} (trang tạm mới tạo = {}).
 *  Dùng để dọn trang tạm khi bị thay bằng trang khác trên cùng 1 mục menu. */
function isEmptyPageContent(content: unknown): boolean {
  if (content == null) return true;
  if (Array.isArray(content)) return content.length === 0;
  if (typeof content === "object") {
    const comps = (content as { components?: unknown }).components;
    return !Array.isArray(comps) || comps.length === 0;
  }
  return true;
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
        overrides: legacyMenuMap.overrides,
      })
      .from(legacyMenuMap)
      // Bỏ qua trang đã xoá mềm → pageName null → node không còn là lá hợp lệ.
      .leftJoin(pages, and(eq(legacyMenuMap.pageId, pages.id), isNull(pages.deletedAt)))
      .where(and(eq(legacyMenuMap.companyId, ctx.user.companyId), eq(legacyMenuMap.active, true)));
    // Route tĩnh (trang built-in id="/...") lưu ở overrides.staticRoute.
    const routeOf = (r: (typeof rows)[number]): string | null => {
      const ov = r.overrides as { staticRoute?: unknown } | null;
      return typeof ov?.staticRoute === "string" ? ov.staticRoute : null;
    };
    // Đích điều hướng của node: trang DB hợp lệ (publish HOẶC admin/editor xem
    // draft), nếu không thì route tĩnh. Trả về string đích hoặc null.
    const targetOf = (r: (typeof rows)[number]): string | null => {
      if (r.pageId != null && r.pageName != null && (r.published === true || includeDrafts))
        return r.pageId;
      return routeOf(r);
    };
    // Lá hợp lệ = có đích điều hướng (trang hợp lệ hoặc route tĩnh).
    const isVisibleLeaf = (r: (typeof rows)[number]) => targetOf(r) != null;
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
        // pageId mang ĐÍCH điều hướng: uuid trang DB HOẶC route tĩnh ("/...").
        // Frontend phân biệt bằng tiền tố "/".
        pageId: targetOf(r),
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
        // pageId = id trang ĐÃ JOIN (loại trang xoá mềm) → trang trong thùng rác
        // hiện "chưa gán" ở UI, nhưng cột page_id thật vẫn giữ để restore trả lại.
        pageId: pages.id,
        pageLabel: pages.label,
        pageName: pages.name,
        pagePublished: pages.published,
        overrides: legacyMenuMap.overrides,
      })
      .from(legacyMenuMap)
      .leftJoin(pages, and(eq(legacyMenuMap.pageId, pages.id), isNull(pages.deletedAt)))
      .where(eq(legacyMenuMap.companyId, ctx.user.companyId));
    // Tách route tĩnh + đánh dấu thư mục khỏi overrides → field riêng cho UI gán.
    return rows.map(({ overrides, ...r }) => {
      const ov = overrides as { staticRoute?: unknown; kind?: unknown } | null;
      return {
        ...r,
        staticRoute: typeof ov?.staticRoute === "string" ? ov.staticRoute : null,
        // kind='folder' = thư mục thuần (kể cả chưa có con) → UI không cho gán trang.
        kind: ov?.kind === "folder" ? "folder" : null,
      };
    });
  }),

  /** Gán (hoặc gỡ) trang cho 1 node menu legacy theo sourceCode. pageId=null →
   *  gỡ liên kết. Khi gán: page phải thuộc công ty. Đánh dấu portStatus='xong'
   *  khi gán (node đã có trang đích) — KHÔNG đụng status khi gỡ.
   *  Gán trang còn NHÁP → mặc định XUẤT BẢN RIÊNG TƯ (để hiện trên menu cổng);
   *  KHÔNG hạ trang đang public xuống private. */
  setNodePage: rbacProcedure("edit", "settings")
    .input(
      z.object({
        sourceCode: z.string().min(1),
        // Đích gán: uuid trang DB, HOẶC route tĩnh trang built-in ("/..."),
        // HOẶC null để gỡ. Route lưu ở overrides.staticRoute (không là FK).
        pageId: z
          .string()
          .nullable()
          .refine(
            (v) =>
              v == null ||
              v.startsWith("/") ||
              /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v),
            { message: "pageId phải là uuid trang hoặc route built-in (/...)." },
          ),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const raw = input.pageId;
      const isRoute = raw?.startsWith("/") ?? false;
      let autoPublished = false;
      // Trang đang gán ở mục này TRƯỚC khi thay (để dọn trang tạm rỗng nếu bị thay).
      let oldPageId: string | null = null;
      // CHẶN gán trang/route vào THƯ MỤC: thư mục = mục có con HOẶC đánh dấu
      // overrides.kind='folder'. Trang phải đặt LÀM MỤC CON bên trong, không gán
      // lên chính thư mục (gây node vừa-nhóm-vừa-lá → vỡ điều hướng).
      if (raw) {
        const [target] = await ctx.db
          .select({ overrides: legacyMenuMap.overrides, pageId: legacyMenuMap.pageId })
          .from(legacyMenuMap)
          .where(
            and(
              eq(legacyMenuMap.companyId, ctx.user.companyId),
              eq(legacyMenuMap.sourceCode, input.sourceCode),
            ),
          )
          .limit(1);
        oldPageId = target?.pageId ?? null;
        const markedFolder = (target?.overrides as { kind?: unknown } | null)?.kind === "folder";
        const [child] = await ctx.db
          .select({ id: legacyMenuMap.id })
          .from(legacyMenuMap)
          .where(
            and(
              eq(legacyMenuMap.companyId, ctx.user.companyId),
              eq(legacyMenuMap.parentCode, input.sourceCode),
            ),
          )
          .limit(1);
        if (markedFolder || child) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Không gán trang vào thư mục. Hãy thêm trang làm mục con bên trong thư mục.",
          });
        }
      }
      // Trang DB thật (uuid) → kiểm tra tồn tại + auto-publish nháp.
      if (raw && !isRoute) {
        const [pg] = await ctx.db
          .select({ id: pages.id, published: pages.published })
          .from(pages)
          .where(
            and(
              eq(pages.id, raw),
              eq(pages.companyId, ctx.user.companyId),
              isNull(pages.deletedAt),
            ),
          )
          .limit(1);
        if (!pg) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Trang không tồn tại hoặc đã xoá." });
        }
        // Trang nháp → xuất bản riêng tư khi gán vào menu.
        if (!pg.published) {
          await ctx.db
            .update(pages)
            .set({ published: true, publishMode: "private", updatedAt: new Date() })
            .where(and(eq(pages.id, raw), eq(pages.companyId, ctx.user.companyId)));
          autoPublished = true;
        }
      }
      const [row] = await ctx.db
        .update(legacyMenuMap)
        .set({
          // page_id (FK) chỉ giữ uuid trang DB; route tĩnh → null FK.
          pageId: isRoute ? null : raw,
          // overrides.staticRoute: set khi gán route (giữ qua re-import DQHF nhờ
          // reapplyMenuOverrides bỏ qua key này); xoá key khi gán trang/gỡ.
          overrides: isRoute
            ? mergeOverridesSql({ staticRoute: raw })
            : sql`coalesce(${legacyMenuMap.overrides}, '{}'::jsonb) - 'staticRoute'`,
          // Gán (trang hoặc route) → coi như đã có đích (xong); gỡ → giữ status.
          ...(raw ? { portStatus: "xong" } : {}),
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
      // THAY trang: nếu trang CŨ bị thay là trang RỖNG (placeholder/tạm) → xoá mềm
      // để khỏi bỏ lại trang rác. Trang cũ CÓ dữ liệu → giữ (về trạng thái chưa gắn).
      let deletedOldPage = false;
      if (raw && oldPageId && oldPageId !== raw) {
        const [oldPg] = await ctx.db
          .select({ content: pages.content })
          .from(pages)
          .where(
            and(
              eq(pages.id, oldPageId),
              eq(pages.companyId, ctx.user.companyId),
              isNull(pages.deletedAt),
            ),
          )
          .limit(1);
        if (oldPg && isEmptyPageContent(oldPg.content)) {
          // Node hiện tại đã đổi page_id ở trên → chỉ xoá khi KHÔNG còn mục menu
          // nào khác trỏ tới trang này (tránh xoá trang đang dùng chỗ khác).
          const [stillUsed] = await ctx.db
            .select({ id: legacyMenuMap.id })
            .from(legacyMenuMap)
            .where(
              and(
                eq(legacyMenuMap.companyId, ctx.user.companyId),
                eq(legacyMenuMap.pageId, oldPageId),
              ),
            )
            .limit(1);
          if (!stillUsed) {
            await ctx.db
              .update(pages)
              .set({ deletedAt: new Date(), updatedAt: new Date() })
              .where(and(eq(pages.id, oldPageId), eq(pages.companyId, ctx.user.companyId)));
            deletedOldPage = true;
          }
        }
      }
      await logActivity(ctx.db, {
        companyId: ctx.user.companyId,
        actorUserId: ctx.user.id,
        kind: "legacy_menu.set_page",
        detail: raw
          ? `Gán ${isRoute ? `trang built-in ${raw}` : `trang ${raw}`} cho menu ${input.sourceCode}${
              autoPublished ? " (xuất bản riêng tư)" : ""
            }${deletedOldPage ? " (xoá trang tạm cũ)" : ""}`
          : `Gỡ trang khỏi menu ${input.sourceCode}`,
      }).catch(() => undefined);
      return { ok: true, pageId: raw, autoPublished, deletedOldPage };
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
    .input(
      z.object({
        parentCode: z.string().nullable(),
        name: z.string().trim().min(1).max(200),
        // "folder" = thư mục (đánh dấu overrides.kind, KHÔNG cho gán trang).
        // "page"/bỏ trống = mục thường (gán trang được).
        kind: z.enum(["folder", "page"]).optional(),
      }),
    )
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
        // Đánh dấu thư mục để phân biệt cả khi CHƯA có con (reapplyMenuOverrides
        // bỏ qua key 'kind' nên giữ qua re-import DQHF).
        overrides: input.kind === "folder" ? { kind: "folder" } : null,
      });
      await logActivity(ctx.db, {
        companyId: ctx.user.companyId,
        actorUserId: ctx.user.id,
        kind: "legacy_menu.add_node",
        detail: `Thêm ${input.kind === "folder" ? "thư mục" : "mục"} menu "${input.name}"`,
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
