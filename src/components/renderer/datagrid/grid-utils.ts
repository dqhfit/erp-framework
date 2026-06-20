/* DataGrid helpers thuần — types + conditional-format + sticky/sized style +
   gộp nhóm cột (banded header) + summary footer + export CSV/XLSX.
   Tách từ DataGrid.tsx (pilot refactor). */
import type {
  Column,
  ColumnDef,
  ColumnFiltersState,
  ColumnOrderState,
  ColumnPinningState,
  ColumnSizingState,
  GroupingState,
  Row,
  SortingState,
  VisibilityState,
} from "@tanstack/react-table";
import type { CSSProperties } from "react";

export interface SavedGridState {
  sorting: SortingState;
  globalFilter: string;
  grouping: GroupingState;
  columnFilters: ColumnFiltersState;
  columnVisibility?: VisibilityState;
  columnSizing?: ColumnSizingState;
  columnOrder?: ColumnOrderState;
  columnPinning?: ColumnPinningState;
}

/** Số dòng/trang mặc định + tuỳ chọn — phân trang client-side để chỉ render
 *  một trang DOM mỗi lần (hiệu năng), không cắt dữ liệu đã tải. */
export const DEFAULT_PAGE_SIZE = 50;
export const PAGE_SIZE_OPTIONS = [25, 50, 100, 200];

/* ── Summary (footer tổng hợp kiểu DevExpress) ─────────────────── */
export type SummaryType = "sum" | "avg" | "count" | "min" | "max";
/** Rule conditional-format khai báo (cấu hình được, serialize JSON): khi giá
 *  trị ô thoả `op value` → áp `className`. */
export interface FormatRule {
  op: "lt" | "lte" | "gt" | "gte" | "eq" | "neq" | "contains";
  value: number | string;
  className: string;
}
/** Meta cột — techName + summary (footer) + cellClass (hook lập trình) +
 *  formatRules (khai báo, cho UI cấu hình conditional formatting sau). */
export interface GridColMeta {
  techName?: string;
  summary?: SummaryType;
  /** Chặn auto-tổng (vd cột chữ như "Hiệu ứng" lỡ chứa giá trị số → không cộng). */
  noSummary?: boolean;
  cellClass?: (value: unknown) => string | undefined;
  formatRules?: FormatRule[];
  /** Ô gọn — giảm padding ngang (vd cột hành động). */
  compact?: boolean;
  /** Nhãn hiển thị ở "Chọn cột hiển thị" khi header là HÀM/JSX (toString ra mã
   *  rác) — vd cột hành động đặt label "Hành động". */
  label?: string;
}

export function evalFormatRules(value: unknown, rules: FormatRule[]): string | undefined {
  const sv = value == null ? "" : String(value);
  const nv = Number(sv.replace(/[,\s]/g, ""));
  for (const r of rules) {
    const rn = typeof r.value === "number" ? r.value : Number(r.value);
    let hit = false;
    if (r.op === "contains") hit = sv.toLowerCase().includes(String(r.value).toLowerCase());
    else if (!Number.isNaN(nv) && !Number.isNaN(rn)) {
      hit =
        r.op === "lt"
          ? nv < rn
          : r.op === "lte"
            ? nv <= rn
            : r.op === "gt"
              ? nv > rn
              : r.op === "gte"
                ? nv >= rn
                : r.op === "eq"
                  ? nv === rn
                  : nv !== rn;
    } else {
      hit =
        r.op === "eq" ? sv === String(r.value) : r.op === "neq" ? sv !== String(r.value) : false;
    }
    if (hit) return r.className;
  }
  return undefined;
}

/** Class conditional-format của 1 ô: meta.cellClass (hook) → formatRules
 *  (khai báo) → mặc định (số ÂM → đỏ). */
export function cellFormatClass(value: unknown, meta: GridColMeta | undefined): string | undefined {
  if (meta?.cellClass) return meta.cellClass(value);
  if (meta?.formatRules?.length) {
    const c = evalFormatRules(value, meta.formatRules);
    if (c) return c;
  }
  if (value == null || value === "") return undefined;
  const n = typeof value === "number" ? value : Number(String(value).replace(/[,\s]/g, ""));
  if (!Number.isNaN(n) && n < 0) return "text-danger";
  return undefined;
}

/** Style sticky cho cột đã ghim (frozen) — trái: left offset; phải: right. */
export function pinnedStyle<T>(column: Column<T>): CSSProperties | undefined {
  const pin = column.getIsPinned();
  if (!pin) return undefined;
  return pin === "left"
    ? { position: "sticky", left: column.getStart("left"), zIndex: 11 }
    : { position: "sticky", right: column.getAfter("right"), zIndex: 11 };
}

/** Style cho ô <th> tiêu đề: LUÔN sticky top (dính trên cùng khi cuộn dọc),
 *  kèm left/right nếu cột đã ghim. Đặt THẲNG trên <th> vì border-collapse
 *  khiến sticky đặt trên <thead> không ăn ở nhiều trình duyệt. `topOffset` >0
 *  cho tiêu đề lồng nhiều cấp (mỗi hàng dính ở độ cao tích luỹ riêng). */
export function headerStickyStyle<T>(column: Column<T>, topOffset = 0): CSSProperties {
  const pin = column.getIsPinned();
  const s: CSSProperties = { position: "sticky", top: topOffset, zIndex: pin ? 22 : 12 };
  if (pin === "left") s.left = column.getStart("left");
  else if (pin === "right") s.right = column.getAfter("right");
  return s;
}

/** Cột có size tường minh (cột điều khiển: hành động/checkbox) → ghim CỨNG
 *  width = minWidth = maxWidth để table-auto KHÔNG kéo giãn cột lấp chỗ trống
 *  (chỉ đặt `width` thôi vẫn bị giãn). Cột dữ liệu (size null) → undefined (auto). */
export function sizedWidth<T>(column: Column<T>): CSSProperties {
  const w = column.getSize();
  // table-fixed cần width trên MỌI cột để ô clip (truncate/overflow-hidden)
  // đúng bề rộng cột. Cột điều khiển (size khai báo) ghim cứng width=min=max;
  // cột dữ liệu chỉ đặt width để table-fixed còn phân bổ chỗ trống khi tổng
  // bề rộng các cột < bề rộng bảng.
  return column.columnDef.size == null ? { width: w } : { width: w, minWidth: w, maxWidth: w };
}

/** Kẹp bề rộng autofit: +đệm, trần 360. Cột CHỮ sàn 48 + đệm 8 (tránh quá hẹp /
 *  clip chữ). Cột COMPACT (hành động/checkbox — nội dung là nút icon, không phải
 *  chữ) dùng sàn 24 + đệm 2 để BÁM SÁT tổng bề rộng các nút, không phình thừa. */
export function clampColW(w: number, opts?: { min?: number; pad?: number }): number {
  const min = opts?.min ?? 48;
  const pad = opts?.pad ?? 8;
  return Math.max(min, Math.min(Math.round(w) + pad, 360));
}
/** Tham số clamp cho cột compact (nội dung nút icon) — bám sát, không sàn 48. */
export const COMPACT_CLAMP = { min: 24, pad: 2 } as const;

/** Nhóm tiêu đề cột (banded header kiểu DQHF) — gộp nhiều cột con dưới 1 dải
 *  tiêu đề bao trên. Con là tên field (lá) hoặc nhóm con (lồng nhiều cấp).
 *  Khai báo ở `cfg.columnGroups` của widget list/grid. */
export interface ColumnGroupNode {
  /** Nhãn dải tiêu đề (vd "Dán veneer"). */
  header: string;
  /** Con: tên field (id cột lá) hoặc nhóm con (lồng). */
  children: Array<string | ColumnGroupNode>;
}

/** id cột (accessorKey hoặc id) — để map field name → ColumnDef. */
export function colDefId<T>(c: ColumnDef<T, unknown>): string {
  const cc = c as { id?: string; accessorKey?: string };
  return cc.id ?? cc.accessorKey ?? "";
}

/** Biến mảng cột PHẲNG → cột LỒNG theo `groups`. Cột không thuộc nhóm nào
 *  (vd checkbox chọn dòng, field ngoài cấu hình) giữ ở cấp gốc, đứng TRƯỚC các
 *  dải nhóm — theo thứ tự gốc. Field lạ trong cấu hình (không khớp cột) bỏ qua;
 *  nhóm rỗng (mọi con đều lạ) cũng bỏ. */
export function groupColumns<T>(
  flat: ColumnDef<T, unknown>[],
  groups: ColumnGroupNode[],
): ColumnDef<T, unknown>[] {
  const byId = new Map<string, ColumnDef<T, unknown>>();
  for (const c of flat) {
    const id = colDefId(c);
    if (id) byId.set(id, c);
  }
  const used = new Set<string>();
  let gi = 0;
  const build = (node: string | ColumnGroupNode): ColumnDef<T, unknown> | null => {
    if (typeof node === "string") {
      const c = byId.get(node);
      if (!c) return null;
      used.add(node);
      return c;
    }
    const kids = node.children.map(build).filter((c): c is ColumnDef<T, unknown> => c != null);
    if (!kids.length) return null;
    return { id: `__grp${gi++}__`, header: node.header, columns: kids };
  };
  const grouped = groups.map(build).filter((c): c is ColumnDef<T, unknown> => c != null);
  const ungrouped = flat.filter((c) => {
    const id = colDefId(c);
    return !id || !used.has(id);
  });
  return [...ungrouped, ...grouped];
}

export const toNum = (v: unknown): number => {
  if (v == null || v === "") return Number.NaN;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[,\s]/g, ""));
  return n;
};
/** Cột số: lấy mẫu ≤30 giá trị non-null, tất cả là số → numeric (auto-sum). */
export function isNumericColumn<T>(rows: Row<T>[], colId: string): boolean {
  let seen = 0;
  for (const r of rows) {
    const v = r.getValue(colId);
    if (v == null || v === "") continue;
    if (Number.isNaN(toNum(v))) return false;
    if (++seen >= 30) break;
  }
  return seen > 0;
}
export function computeSummary<T>(rows: Row<T>[], colId: string, type: SummaryType): number {
  if (type === "count") return rows.length;
  const nums = rows.map((r) => toNum(r.getValue(colId))).filter((n) => !Number.isNaN(n));
  if (nums.length === 0) return 0;
  if (type === "sum") return nums.reduce((a, b) => a + b, 0);
  if (type === "avg") return nums.reduce((a, b) => a + b, 0) / nums.length;
  if (type === "min") return Math.min(...nums);
  return Math.max(...nums);
}
export const SUMMARY_LABEL: Record<SummaryType, string> = {
  sum: "Σ",
  avg: "TB",
  count: "SL",
  min: "Min",
  max: "Max",
};
export const fmtNum = (n: number) => n.toLocaleString("vi-VN", { maximumFractionDigits: 2 });

/** Xuất CSV (Excel mở được — có BOM UTF-8) các cột đang hiện + rows đã lọc/sắp. */
export function exportRowsCsv<T>(
  cols: Array<{ id: string; header: string }>,
  rows: Row<T>[],
  filename: string,
) {
  const esc = (s: string) => (/[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const head = cols.map((c) => esc(c.header)).join(",");
  const body = rows.map((r) => cols.map((c) => esc(String(r.getValue(c.id) ?? ""))).join(","));
  const csv = `﻿${[head, ...body].join("\r\n")}`;
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${filename || "export"}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/** Xuất .xlsx THẬT (workbook Excel) các cột đang hiện + rows đã lọc/sắp.
 *  Lazy-load `write-excel-file` (dynamic import → tách chunk riêng, chỉ tải
 *  khi người dùng bấm xuất, không nuốt main bundle). */
export async function exportRowsXlsx<T>(
  cols: Array<{ id: string; header: string }>,
  rows: Row<T>[],
  filename: string,
) {
  const { default: writeXlsxFile } = await import("write-excel-file/browser");
  const header = cols.map((c) => ({ value: c.header, fontWeight: "bold" as const }));
  const body = rows.map((r) =>
    cols.map((c) => {
      const v = r.getValue(c.id);
      if (typeof v === "number" && Number.isFinite(v)) return { type: Number, value: v } as const;
      if (v == null || v === "") return { type: String, value: "" } as const;
      return { type: String, value: String(v) } as const;
    }),
  );
  // biome-ignore lint/suspicious/noExplicitAny: cell-shape của write-excel-file (Row[][]) khó biểu diễn tĩnh
  await writeXlsxFile([header, ...body] as any).toFile(`${filename || "export"}.xlsx`);
}
