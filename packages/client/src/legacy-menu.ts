/* ==========================================================
   legacy-menu.ts — Client wrapper cho tRPC legacyMenu.*.
   Dùng từ UI Cockpit (Settings/Cockpit) để import cây menu app cũ
   (SYS_MENU_NEW), resolve form→proc/bảng, và port từng mục.
   ========================================================== */

import type { AppRouter } from "@erp-framework/server";
import { createTRPCClient, httpBatchLink } from "@trpc/client";

export interface LegacyMenuNode {
  sourceCode: string;
  name: string | null;
  level: number | null;
  winId: string | null;
  namespace: string | null;
  active: boolean;
  isShowDialog: boolean;
  portStatus: string; // chua | dang | xong
  module: string | null;
  pageId: string | null;
  sort: number;
  children: LegacyMenuNode[];
}

export interface LegacyMenuStats {
  total: number;
  byStatus: Record<string, number>;
  forms: number;
  byLevel: Record<number, number>;
  rbacNodes: number;
}

export interface LegacyMenuResolved {
  procs: string[];
  controls: string[];
  reports?: string[];
  repos: string[];
  filesScanned?: number;
  note?: string;
}

export interface LegacyReport {
  reportClass: string;
  title: string | null;
  kind: "table" | "document" | string;
  dataProcs: string[];
  columns: string[];
  groups: string[];
  summaries: string[];
  hasBeforePrint: number;
  pageId: string | null;
}

export interface LegacyMenuNodeDetail {
  name: string | null;
  winId: string | null;
  namespace: string | null;
  portStatus: string;
  module: string | null;
  pageId: string | null;
  resolved: LegacyMenuResolved | null;
  resolvedAt: string | null;
}

/** 1 dòng cho UI "Gán trang cho menu" — node + trang đang gán (nếu có). */
export interface LegacyPageBinding {
  sourceCode: string;
  name: string | null;
  level: number | null;
  parentCode: string | null;
  sort: number;
  winId: string | null;
  active: boolean;
  custom: boolean;
  portStatus: string;
  pageId: string | null;
  pageLabel: string | null;
  pageName: string | null;
  pagePublished: boolean | null;
}

export function createLegacyMenuClient(baseUrl: string) {
  const trpc = createTRPCClient<AppRouter>({
    links: [
      httpBatchLink({
        url: baseUrl.replace(/\/$/, "") + "/trpc",
        fetch: (input, init) => fetch(input, { ...init, credentials: "include" }),
      }),
    ],
  });
  return {
    /** Kiểm tra cấu hình cockpit: DQHF_SOURCE_DIR + MSSQL connection. */
    checkSetup: () =>
      trpc.legacyMenu.checkSetup.query() as Promise<{
        dqhfDir: string | null;
        dqhfDirSet: boolean;
        dqhfDirExists: boolean;
        mssqlOk: boolean;
      }>,
    /** Lưu hàng loạt kết quả resolve phân tích từ browser (client-side analysis). */
    bulkResolve: (
      items: Array<{
        sourceCode: string;
        procs: string[];
        controls: string[];
        repos: string[];
        reports: string[];
        filesScanned: number;
        note?: string;
      }>,
    ) =>
      trpc.legacyMenu.bulkResolve.mutate(items) as Promise<{
        totalForms: number;
        resolved: number;
        withProcs: number;
        noForm: number;
      }>,
    /** Xóa DQHF_SOURCE_DIR khỏi process.env server (session-only). */
    clearSourceDir: () => trpc.legacyMenu.clearSourceDir.mutate() as Promise<{ ok: true }>,
    /** Đặt DQHF_SOURCE_DIR tại runtime (session-only). Validate thư mục tồn tại. */
    setSourceDir: (dir: string) =>
      trpc.legacyMenu.setSourceDir.mutate({ dir }) as Promise<{ ok: true; dir: string }>,
    /** Import (upsert) toàn bộ SYS_MENU_NEW từ connection MSSQL mặc định. */
    importFromMssql: () =>
      trpc.legacyMenu.importFromMssql.mutate() as Promise<{
        total: number;
        imported: number;
        updated: number;
      }>,
    /** Cây menu legacy lồng. */
    listTree: () => trpc.legacyMenu.listTree.query() as Promise<LegacyMenuNode[]>,
    /** Cây điều hướng END-USER: node + pageId (trang published) — cho portal. */
    navTree: () =>
      trpc.legacyMenu.navTree.query() as Promise<
        Array<{
          code: string;
          name: string | null;
          level: number | null;
          parentCode: string | null;
          sort: number;
          pageId: string | null;
        }>
      >,
    /** Liệt kê MỌI node + trang đang gán (cho UI gán trang vào menu). */
    pageBindings: () => trpc.legacyMenu.pageBindings.query() as Promise<LegacyPageBinding[]>,
    /** Gán/gỡ trang cho 1 node menu (pageId=null → gỡ). */
    setNodePage: (sourceCode: string, pageId: string | null) =>
      trpc.legacyMenu.setNodePage.mutate({ sourceCode, pageId }) as Promise<{
        ok: true;
        pageId: string | null;
      }>,
    /** Đổi tên 1 node menu. */
    renameNode: (sourceCode: string, name: string) =>
      trpc.legacyMenu.renameNode.mutate({ sourceCode, name }) as Promise<{ ok: true }>,
    /** Ẩn/hiện 1 node (active=false → ẩn khỏi portal). */
    setNodeActive: (sourceCode: string, active: boolean) =>
      trpc.legacyMenu.setNodeActive.mutate({ sourceCode, active }) as Promise<{
        ok: true;
        active: boolean;
      }>,
    /** Chuyển 1 node sang cha khác (parentCode=null → ra gốc). */
    moveNode: (sourceCode: string, parentCode: string | null) =>
      trpc.legacyMenu.moveNode.mutate({ sourceCode, parentCode }) as Promise<{ ok: true }>,
    /** Đổi thứ tự 1 node trong nhóm cùng cha (lên/xuống). */
    reorderNode: (sourceCode: string, direction: "up" | "down") =>
      trpc.legacyMenu.reorderNode.mutate({ sourceCode, direction }) as Promise<{
        ok: true;
        moved: boolean;
      }>,
    /** Thêm node menu tự tạo dưới 1 cha (parentCode=null → gốc). */
    addNode: (parentCode: string | null, name: string) =>
      trpc.legacyMenu.addNode.mutate({ parentCode, name }) as Promise<{
        ok: true;
        sourceCode: string;
      }>,
    /** Xoá 1 node (chỉ node custom không còn con). */
    deleteNode: (sourceCode: string) =>
      trpc.legacyMenu.deleteNode.mutate({ sourceCode }) as Promise<{ ok: true }>,
    /** Thống kê tiến độ port. */
    stats: () => trpc.legacyMenu.stats.query() as Promise<LegacyMenuStats>,
    /** Resolve source C# (env DQHF_SOURCE_DIR) → procs/controls/repos mỗi node. */
    resolveFromSource: () =>
      trpc.legacyMenu.resolveFromSource.mutate() as Promise<{
        totalForms: number;
        resolved: number;
        withProcs: number;
        noForm: number;
      }>,
    /** Parse blueprint report (rpt_*) → legacy_reports. */
    parseReports: () =>
      trpc.legacyMenu.parseReports.mutate() as Promise<{
        totalReports: number;
        parsed: number;
        table: number;
        document: number;
      }>,
    /** Liệt kê blueprint report đã parse. */
    listReports: () => trpc.legacyMenu.listReports.query() as Promise<LegacyReport[]>,
    /** Chi tiết resolve 1 node. */
    getResolved: (sourceCode: string) =>
      trpc.legacyMenu.getResolved.query({ sourceCode }) as Promise<LegacyMenuNodeDetail | null>,
    /** Port 1 mục: procs → bảng → discover scoped → portStatus=dang. */
    portNode: (sourceCode: string, opts: { module?: string; maxTables?: number } = {}) =>
      trpc.legacyMenu.portNode.mutate({ sourceCode, ...opts }) as Promise<{
        module: string;
        jobId: string;
        seedTables: string[];
      }>,
    /** Đổi trạng thái port thủ công. */
    setPortStatus: (
      sourceCode: string,
      status: "chua" | "dang" | "xong",
      opts: { module?: string; pageId?: string } = {},
    ) =>
      trpc.legacyMenu.setPortStatus.mutate({ sourceCode, status, ...opts }) as Promise<{
        ok: true;
        status: string;
      }>,
  };
}

export type LegacyMenuClient = ReturnType<typeof createLegacyMenuClient>;
