/* ==========================================================
   legacy-menu.ts — Cockpit menu-driven: import bảng SYS_MENU_NEW của
   app cũ DQHF vào legacy_menu_map + dựng cây menu.

   - importLegacyMenu: đọc toàn bộ SYS_MENU_NEW qua MssqlClient, upsert
     theo (companyId, sourceCode). Re-import GIỮ portStatus/module/pageId
     (chỉ cập nhật metadata) → không mất tiến độ port.
   - listLegacyMenuTree: đọc legacy_menu_map của company, dựng cây lồng
     theo parentCode, sort theo (sort, name).
   ========================================================== */

import { legacyMenuMap } from "@erp-framework/db";
import type { MssqlClient } from "@erp-framework/mssql-client";
import { eq } from "drizzle-orm";
import type { DB } from "./db";

/** Tên bảng menu trong DB nguồn DQHF. */
const SOURCE_TABLE = "SYS_MENU_NEW";

/** Đọc 1 cột bất kể casing (DQHF cột UPPER, an toàn nếu driver đổi case). */
function pick(r: Record<string, unknown>, ...names: string[]): unknown {
  for (const n of names) {
    for (const key of Object.keys(r)) {
      if (key.toLowerCase() === n.toLowerCase()) return r[key];
    }
  }
  return undefined;
}

function asStr(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}
function asNum(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function asBool(v: unknown): boolean | null {
  if (v == null) return null;
  return v === true || v === 1 || v === "1" || v === "true" || v === "True";
}

export interface ImportLegacyMenuResult {
  total: number;
  imported: number;
  updated: number;
}

/** Import (upsert) toàn bộ SYS_MENU_NEW vào legacy_menu_map. */
export async function importLegacyMenu(
  db: DB,
  companyId: string,
  mssql: MssqlClient,
): Promise<ImportLegacyMenuResult> {
  const rows = await mssql.bulkRead<Record<string, unknown>>(SOURCE_TABLE, { limit: 100_000 });

  // Pre-fetch sourceCode đã có để đếm imported vs updated.
  const existing = new Set(
    (
      await db
        .select({ code: legacyMenuMap.sourceCode })
        .from(legacyMenuMap)
        .where(eq(legacyMenuMap.companyId, companyId))
    ).map((r) => r.code),
  );

  let imported = 0;
  let updated = 0;
  for (const r of rows) {
    const sourceCode = asStr(pick(r, "C_MENU"));
    if (!sourceCode) continue; // node không có mã → bỏ
    const values = {
      companyId,
      sourceId: asNum(pick(r, "id")) ?? 0,
      sourceCode,
      name: asStr(pick(r, "N_MENU")),
      level: asNum(pick(r, "C_LEVEL")),
      parentCode: asStr(pick(r, "C_MENU_UPPER")),
      sort: asNum(pick(r, "T_SORT")) ?? 0,
      winId: asStr(pick(r, "C_WIN_ID")),
      namespace: asStr(pick(r, "NAMESPACE")),
      system: asStr(pick(r, "C_SYSTEM")),
      isShowDialog: asBool(pick(r, "IsShowDialog")) ?? false,
      active: asBool(pick(r, "F_USE")) ?? true,
    };

    await db
      .insert(legacyMenuMap)
      .values(values)
      .onConflictDoUpdate({
        target: [legacyMenuMap.companyId, legacyMenuMap.sourceCode],
        // GIỮ portStatus/module/pageId — chỉ cập nhật metadata từ nguồn.
        set: {
          sourceId: values.sourceId,
          name: values.name,
          level: values.level,
          parentCode: values.parentCode,
          sort: values.sort,
          winId: values.winId,
          namespace: values.namespace,
          system: values.system,
          isShowDialog: values.isShowDialog,
          active: values.active,
          updatedAt: new Date(),
        },
      });

    if (existing.has(sourceCode)) updated++;
    else imported++;
  }

  return { total: imported + updated, imported, updated };
}

export interface MenuTreeNode {
  sourceCode: string;
  name: string | null;
  level: number | null;
  winId: string | null;
  namespace: string | null;
  active: boolean;
  isShowDialog: boolean;
  portStatus: string;
  module: string | null;
  pageId: string | null;
  sort: number;
  children: MenuTreeNode[];
}

/** Dựng cây menu lồng từ legacy_menu_map (theo parentCode). */
export async function listLegacyMenuTree(db: DB, companyId: string): Promise<MenuTreeNode[]> {
  const rows = await db.select().from(legacyMenuMap).where(eq(legacyMenuMap.companyId, companyId));

  const byCode = new Map<string, MenuTreeNode>();
  for (const r of rows) {
    byCode.set(r.sourceCode, {
      sourceCode: r.sourceCode,
      name: r.name,
      level: r.level,
      winId: r.winId,
      namespace: r.namespace,
      active: r.active,
      isShowDialog: r.isShowDialog,
      portStatus: r.portStatus,
      module: r.module,
      pageId: r.pageId,
      sort: r.sort,
      children: [],
    });
  }

  const roots: MenuTreeNode[] = [];
  for (const r of rows) {
    const node = byCode.get(r.sourceCode)!;
    const parent = r.parentCode ? byCode.get(r.parentCode) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node); // node mồ côi (cha ngoài tập / cấp 1) → root
  }

  const sortRec = (ns: MenuTreeNode[]): void => {
    ns.sort((a, b) => a.sort - b.sort || (a.name ?? "").localeCompare(b.name ?? ""));
    for (const n of ns) sortRec(n.children);
  };
  sortRec(roots);
  return roots;
}

/** Thống kê tiến độ port theo trạng thái + theo cấp (cho dashboard cockpit). */
export async function legacyMenuStats(
  db: DB,
  companyId: string,
): Promise<{
  total: number;
  byStatus: Record<string, number>;
  forms: number;
  byLevel: Record<number, number>;
  rbacNodes: number; // node cấp > 3 (thao tác RBAC, không hiện trên menu)
}> {
  const rows = await db
    .select({
      portStatus: legacyMenuMap.portStatus,
      level: legacyMenuMap.level,
      winId: legacyMenuMap.winId,
    })
    .from(legacyMenuMap)
    .where(eq(legacyMenuMap.companyId, companyId));

  const byStatus: Record<string, number> = {};
  const byLevel: Record<number, number> = {};
  let forms = 0;
  for (const r of rows) {
    byStatus[r.portStatus] = (byStatus[r.portStatus] ?? 0) + 1;
    if (r.winId) forms++;
    if (r.level != null) byLevel[r.level] = (byLevel[r.level] ?? 0) + 1;
  }
  const rbacNodes = Object.entries(byLevel)
    .filter(([l]) => Number(l) > 3)
    .reduce((sum, [, c]) => sum + c, 0);
  return { total: rows.length, byStatus, forms, byLevel, rbacNodes };
}
