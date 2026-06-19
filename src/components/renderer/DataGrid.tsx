import {
  type Column,
  type ColumnDef,
  type ColumnFiltersState,
  type ColumnOrderState,
  type ColumnPinningState,
  type ColumnSizingState,
  type ExpandedState,
  flexRender,
  type GroupingState,
  getCoreRowModel,
  getExpandedRowModel,
  getFacetedRowModel,
  getFacetedUniqueValues,
  getFilteredRowModel,
  getGroupedRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  type PaginationState,
  type Row,
  type RowSelectionState,
  type SortingState,
  useReactTable,
  type VisibilityState,
} from "@tanstack/react-table";
import {
  type CSSProperties,
  Fragment,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { I } from "@/components/Icons";
import { PasteGridModal } from "@/components/renderer/PasteGridModal";
import { Chip, Input } from "@/components/ui";
import { useDragScroll } from "@/hooks/useDragScroll";
import { useIsMobile } from "@/hooks/useMediaQuery";
import { useT } from "@/hooks/useT";
import { idbGet, idbSet } from "@/lib/page-state-idb";
import { cn } from "@/lib/utils";

interface SavedGridState {
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
const DEFAULT_PAGE_SIZE = 50;
const PAGE_SIZE_OPTIONS = [25, 50, 100, 200];

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
interface GridColMeta {
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

function evalFormatRules(value: unknown, rules: FormatRule[]): string | undefined {
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
function cellFormatClass(value: unknown, meta: GridColMeta | undefined): string | undefined {
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
function pinnedStyle<T>(column: Column<T>): CSSProperties | undefined {
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
function headerStickyStyle<T>(column: Column<T>, topOffset = 0): CSSProperties {
  const pin = column.getIsPinned();
  const s: CSSProperties = { position: "sticky", top: topOffset, zIndex: pin ? 22 : 12 };
  if (pin === "left") s.left = column.getStart("left");
  else if (pin === "right") s.right = column.getAfter("right");
  return s;
}

/** Cột có size tường minh (cột điều khiển: hành động/checkbox) → ghim CỨNG
 *  width = minWidth = maxWidth để table-auto KHÔNG kéo giãn cột lấp chỗ trống
 *  (chỉ đặt `width` thôi vẫn bị giãn). Cột dữ liệu (size null) → undefined (auto). */
function sizedWidth<T>(column: Column<T>): CSSProperties {
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
function clampColW(w: number, opts?: { min?: number; pad?: number }): number {
  const min = opts?.min ?? 48;
  const pad = opts?.pad ?? 8;
  return Math.max(min, Math.min(Math.round(w) + pad, 360));
}
/** Tham số clamp cho cột compact (nội dung nút icon) — bám sát, không sàn 48. */
const COMPACT_CLAMP = { min: 24, pad: 2 } as const;

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
function colDefId<T>(c: ColumnDef<T, unknown>): string {
  const cc = c as { id?: string; accessorKey?: string };
  return cc.id ?? cc.accessorKey ?? "";
}

/** Biến mảng cột PHẲNG → cột LỒNG theo `groups`. Cột không thuộc nhóm nào
 *  (vd checkbox chọn dòng, field ngoài cấu hình) giữ ở cấp gốc, đứng TRƯỚC các
 *  dải nhóm — theo thứ tự gốc. Field lạ trong cấu hình (không khớp cột) bỏ qua;
 *  nhóm rỗng (mọi con đều lạ) cũng bỏ. */
function groupColumns<T>(
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

const toNum = (v: unknown): number => {
  if (v == null || v === "") return Number.NaN;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[,\s]/g, ""));
  return n;
};
/** Cột số: lấy mẫu ≤30 giá trị non-null, tất cả là số → numeric (auto-sum). */
function isNumericColumn<T>(rows: Row<T>[], colId: string): boolean {
  let seen = 0;
  for (const r of rows) {
    const v = r.getValue(colId);
    if (v == null || v === "") continue;
    if (Number.isNaN(toNum(v))) return false;
    if (++seen >= 30) break;
  }
  return seen > 0;
}
function computeSummary<T>(rows: Row<T>[], colId: string, type: SummaryType): number {
  if (type === "count") return rows.length;
  const nums = rows.map((r) => toNum(r.getValue(colId))).filter((n) => !Number.isNaN(n));
  if (nums.length === 0) return 0;
  if (type === "sum") return nums.reduce((a, b) => a + b, 0);
  if (type === "avg") return nums.reduce((a, b) => a + b, 0) / nums.length;
  if (type === "min") return Math.min(...nums);
  return Math.max(...nums);
}
const SUMMARY_LABEL: Record<SummaryType, string> = {
  sum: "Σ",
  avg: "TB",
  count: "SL",
  min: "Min",
  max: "Max",
};
const fmtNum = (n: number) => n.toLocaleString("vi-VN", { maximumFractionDigits: 2 });

/** Xuất CSV (Excel mở được — có BOM UTF-8) các cột đang hiện + rows đã lọc/sắp. */
function exportRowsCsv<T>(
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
async function exportRowsXlsx<T>(
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

/** Ngưỡng cardinality để dựng datalist gợi ý. Cột có > ngưỡng giá trị phân
 *  biệt (mã/tên...) thì datalist vô dụng + sort mỗi render rất tốn → bỏ qua,
 *  chỉ giữ ô lọc contains. */
const FACET_MAX_DISTINCT = 200;

/** Ô lọc 1 cột (filter row) — input contains + datalist gợi ý giá trị phân
 *  biệt (faceted) như dropdown lọc của DevExpress. Chỉ gợi ý khi cardinality
 *  thấp (≤ FACET_MAX_DISTINCT) để khỏi sort hàng nghìn chuỗi mỗi render. */
function FacetFilterInput<T>({
  column,
  placeholder,
  faceted,
}: {
  column: Column<T>;
  placeholder: string;
  /** Gợi ý datalist từ giá trị phân biệt. Tắt ở server mode (facet chỉ phủ
   *  1 trang → gợi ý sai lệch). */
  faceted: boolean;
}) {
  const listId = `facet-${column.id}`;
  const facets = faceted ? column.getFacetedUniqueValues() : undefined;
  const options =
    facets && facets.size > 0 && facets.size <= FACET_MAX_DISTINCT
      ? Array.from(facets.keys())
          .filter((v) => v != null && String(v).trim() !== "")
          .map((v) => String(v))
          .sort((a, b) => a.localeCompare(b))
      : [];
  return (
    <>
      <input
        list={options.length ? listId : undefined}
        placeholder={placeholder}
        value={(column.getFilterValue() as string) ?? ""}
        onChange={(e) => column.setFilterValue(e.target.value || undefined)}
        className="input h-6 text-xs px-2 font-normal w-full"
      />
      {options.length > 0 && (
        <datalist id={listId}>
          {options.map((o) => (
            <option key={o} value={o} />
          ))}
        </datalist>
      )}
    </>
  );
}

export interface DataGridProps<T> {
  columns: ColumnDef<T, unknown>[];
  /** Nhóm tiêu đề cột (banded header nhiều cấp). Khi set, `columns` phẳng được
   *  gói lại thành cây cột con theo cấu hình; cột ngoài nhóm giữ nguyên. */
  columnGroups?: ColumnGroupNode[];
  /** Gom HÀNG theo cột mặc định (ids cột) khi CHƯA có view lưu — vd ["phanloai"].
   *  User vẫn đổi được; lựa chọn của user lưu IDB sẽ override ở lần sau. */
  defaultGrouping?: string[];
  data: T[];
  emptyText?: string;
  className?: string;
  /** Nhãn hiển thị ở toolbar. */
  label?: string;
  /** Hiển thị thanh toolbar (search + count). Default: true. */
  toolbar?: boolean;
  /** Key IDB để persist sort/filter qua session. Format: "${pageId}:${widgetId}". */
  stateKey?: string;
  /** Callback khi user click 1 row — dùng cho master-detail pattern. */
  onRowClick?: (row: T) => void;
  /** Predicate đánh dấu row đang được chọn (highlight border + bg). */
  isRowSelected?: (row: T) => boolean;
  /** V2 P5: controlled globalFilter — khi pass, override state nội bộ.
   *  ListWidget set khi cfg.searchStateKey để bind 2 chiều với pageState. */
  globalFilter?: string;
  onGlobalFilterChange?: (value: string) => void;
  /** Số dòng/trang. Mặc định 50. Controls chỉ hiện khi có >1 trang. */
  pageSize?: number;
  /** Master-detail: nếu set, mỗi dòng có nút ▸ mở panel chi tiết bên dưới
   *  (vd lưới con / record liên quan). Trả node render trong hàng chi tiết. */
  renderDetail?: (row: T) => ReactNode;
  /** Chế độ phân trang/sắp/lọc SERVER-SIDE (cho bảng lớn). Khi set: grid không
   *  tự sort/filter/paginate trên client mà phát `onQueryChange` để caller fetch
   *  đúng trang từ server. `data` lúc này CHỈ là 1 trang. Group/summary/faceted
   *  bị tắt (cần toàn bộ dòng). Sort 1 cột (server chỉ nhận 1 sort). */
  server?: ServerPagingController;
  /** Khi set: hiện nút "Dán dữ liệu" ở toolbar → mở PasteGridModal map cột +
   *  nhận TSV dán vào → caller cập nhật theo {rowId, changes}. Chỉ lưới sửa-được. */
  onPasteApply?: (
    updates: Array<{ rowId: string; changes: Record<string, string> }>,
  ) => void | Promise<void>;
  /** Cùng nút "Dán dữ liệu": tạo dòng MỚI từ dữ liệu dán (chế độ thêm/upsert). */
  onPasteCreate?: (records: Array<Record<string, string>>) => void | Promise<void>;
  /** Field cố định gắn vào mọi dòng tạo mới (vd masp = sản phẩm đang lọc). */
  pasteCreateDefaults?: Record<string, string>;
  /** Khi set: hiện nút "＋ Thêm dòng" (lên đầu / xuống cuối) ở toolbar → caller
   *  chèn 1 dòng nháp editable vào lưới. Chỉ lưới sửa-được + chế độ gom (batch). */
  onAddRow?: (pos: "top" | "bottom") => void;
  /** Khi bật: hiện DÒNG "＋ Thêm dòng mới" trong lưới (bấm = onAddRow(addRowPos)).
   *  Cần onAddRow. Bật qua tuỳ chọn cfg.addRowAtEnd của widget list sửa-được. */
  inlineAddRow?: boolean;
  /** Vị trí dòng "＋ Thêm dòng mới" (+ dòng nháp tạo ra): ĐẦU hay CUỐI lưới.
   *  Mặc định "bottom". cfg.addRowPos. */
  addRowPos?: "top" | "bottom";
  /** Nhảy tới trang đầu/cuối khi token đổi — để sau khi thêm dòng mới (top/bottom)
   *  lưới tự lật tới trang chứa dòng đó (tránh dòng mới nằm trang khác do phân trang). */
  pageJump?: { token: number; to: "first" | "last" };
  /** Sắp xếp mặc định khi chưa có view lưu — vd {field:"id",dir:"desc"} để bản
   *  ghi mới nhất lên đầu. Bản ghi sửa giữ vị trí (id không đổi). */
  defaultSort?: { field: string; dir: "asc" | "desc" };
  /** Bật CHỌN DÒNG (checkbox). Khi true: toolbar có nút bật/tắt cột tích; tích
   *  tiêu đề = chọn/bỏ MỌI dòng đã lọc; server mode thêm "Chọn tất cả N dòng". */
  enableSelection?: boolean;
  /** Tập id dòng có giá trị thay đổi chưa lưu (pending). Grid tô nền
   *  `var(--changed-row-bg)` cho các dòng này. */
  changedRowIds?: Set<string>;
  /** Báo caller khi tập chọn đổi. allMatching=true (server mode) = đã chọn TẤT
   *  CẢ dòng khớp filter (vượt trang đang tải) — caller xử lý theo query. */
  onSelectionChange?: (info: { rows: T[]; allMatching: boolean; count: number }) => void;
  /** Callback xuất TOÀN BỘ dữ liệu (kể cả trang chưa tải). Khi set, nút xuất
   *  gọi callback này thay vì chỉ xuất dòng đang tải (dùng cho server-paged). */
  onExportAll?: (format: "xlsx" | "csv") => Promise<void>;
  /** Hành động hàng loạt hiện ở thanh chọn (ngoài "Xuất CSV đã chọn" có sẵn). */
  bulkActions?: Array<{
    label: string;
    icon?: ReactNode;
    danger?: boolean;
    onClick: (rows: T[], allMatching: boolean) => void;
  }>;
}

/** Query grid phát ra cho caller khi ở chế độ server-side. */
export interface ServerGridQuery {
  pageIndex: number;
  pageSize: number;
  /** 1 cột sort (server-side chỉ hỗ trợ 1). */
  sort?: { field: string; dir: "asc" | "desc" };
  /** Ô search toàn cục → full-text `q` server-side. */
  globalFilter?: string;
  /** Lọc từng cột → server filters {op:"contains"}. */
  columnFilters?: { id: string; value: string }[];
}

/** Bộ điều khiển server-side do caller (hook fetch) cấp cho DataGrid. */
export interface ServerPagingController {
  /** Tổng số dòng toàn bảng (để dựng pageCount + đếm). */
  total: number;
  /** Đang fetch trang — hiện indicator. */
  loading?: boolean;
  /** Grid gọi khi state phân trang/sắp/lọc đổi (đã debounce). */
  onQueryChange: (q: ServerGridQuery) => void;
  /** Tổng hợp cột (server-side, toàn bảng) cho footer — colId → {type,value}.
   *  Khi có → footer summary hiện ở server mode (thay vì tắt). */
  summary?: Record<string, { type: SummaryType; value: number }>;
}

export function DataGrid<T>({
  columns,
  columnGroups,
  defaultGrouping,
  data,
  emptyText,
  className,
  label,
  toolbar = true,
  stateKey,
  onRowClick,
  isRowSelected,
  globalFilter: gfControlled,
  onGlobalFilterChange,
  pageSize,
  renderDetail,
  server,
  onPasteApply,
  onPasteCreate,
  pasteCreateDefaults,
  onAddRow,
  inlineAddRow,
  addRowPos,
  pageJump,
  defaultSort,
  enableSelection,
  onSelectionChange,
  bulkActions,
  changedRowIds,
  onExportAll,
}: DataGridProps<T>) {
  const t = useT();
  const isMobile = useIsMobile();
  // Chế độ xem: lưới (bảng) ↔ card. Mặc định desktop = lưới, mobile = card.
  const [viewMode, setViewMode] = useState<"grid" | "card">(isMobile ? "card" : "grid");
  // Phóng to DataGrid phủ toàn màn hình (toolbar + header cố định, chỉ dòng cuộn).
  const [maximized, setMaximized] = useState(false);
  // Modal dán dữ liệu (paste TSV → cập nhật theo cột khóa).
  const [pasteOpen, setPasteOpen] = useState(false);
  useEffect(() => {
    if (!maximized) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMaximized(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [maximized]);
  const serverMode = !!server;
  // Ref giữ controller mới nhất — tránh để identity object của caller lọt vào
  // deps effect (sẽ fire mỗi render → fetch loop).
  const serverRef = useRef(server);
  serverRef.current = server;
  const [sorting, setSorting] = useState<SortingState>(
    defaultSort ? [{ id: defaultSort.field, desc: defaultSort.dir === "desc" }] : [],
  );
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: pageSize && pageSize > 0 ? pageSize : DEFAULT_PAGE_SIZE,
  });
  const [globalFilterInner, setGlobalFilterInner] = useState("");
  const isControlled = gfControlled !== undefined;
  const globalFilter = isControlled ? gfControlled : globalFilterInner;
  const setGlobalFilter = (next: string | ((cur: string) => string)) => {
    const v = typeof next === "function" ? next(globalFilter) : next;
    if (isControlled) {
      onGlobalFilterChange?.(v);
    } else {
      setGlobalFilterInner(v);
    }
  };
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [grouping, setGrouping] = useState<GroupingState>(defaultGrouping ?? []);
  const [expanded, setExpanded] = useState<ExpandedState>(true);
  const [filterRowOpen, setFilterRowOpen] = useState(false);
  const [groupPickerOpen, setGroupPickerOpen] = useState(false);
  const groupPickerRef = useRef<HTMLDivElement>(null);
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const [colChooserOpen, setColChooserOpen] = useState(false);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const exportBtnRef = useRef<HTMLDivElement>(null);
  const colChooserRef = useRef<HTMLDivElement>(null);
  const groupDropdownRef = useRef<HTMLDivElement>(null);
  const colDropdownRef = useRef<HTMLDivElement>(null);
  const exportDropdownRef = useRef<HTMLDivElement>(null);
  const [columnSizing, setColumnSizing] = useState<ColumnSizingState>({});
  const [columnOrder, setColumnOrder] = useState<ColumnOrderState>([]);
  const [dragColId, setDragColId] = useState<string | null>(null);
  const [dragSortId, setDragSortId] = useState<string | null>(null);
  const [dragGroupId, setDragGroupId] = useState<string | null>(null);
  const [columnPinning, setColumnPinning] = useState<ColumnPinningState>({ left: [], right: [] });
  // Master-detail: id dòng đang mở panel chi tiết.
  const [openDetail, setOpenDetail] = useState<Set<string>>(new Set());
  // Chọn dòng: state TanStack + cờ hiện cột tích + cờ "đã chọn tất cả dòng khớp"
  // (server mode — vượt trang đang tải, biểu diễn bằng cờ thay vì từng id).
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [showSelectCol, setShowSelectCol] = useState(false);
  const [allMatching, setAllMatching] = useState(false);
  // Container cuộn (để đo nội dung ô khi autofit) + cờ "đã nạp xong state lưu"
  // (chặn autofit-on-load đè kích thước cột người dùng đã lưu).
  const scrollRef = useRef<HTMLDivElement>(null);
  const [restoreSettled, setRestoreSettled] = useState(false);
  const autofitDoneRef = useRef(false);
  useDragScroll(scrollRef);

  // Tiêu đề lồng nhiều cấp: gói cột phẳng thành cây nhóm khi có cấu hình.
  const tableColumns = useMemo(
    () => (columnGroups?.length ? groupColumns(columns, columnGroups) : columns),
    [columns, columnGroups],
  );
  // Header lồng → đo độ cao tích luỹ từng hàng tiêu đề để mỗi hàng dính (sticky)
  // đúng vị trí xếp chồng khi cuộn dọc (không đè lên nhau). filterTop = tổng
  // cao các hàng header (cho hàng ô lọc dính ngay dưới).
  const theadRef = useRef<HTMLTableSectionElement>(null);
  const [hdrTops, setHdrTops] = useState<number[]>([]);
  const [filterTop, setFilterTop] = useState(0);
  // Không deps: đo lại sau mỗi render (cột/độ cao có thể đổi) — đã chặn set dư
  // bằng so sánh giá trị nên không vòng lặp; ResizeObserver bắt thay đổi kích thước.
  useLayoutEffect(() => {
    const thead = theadRef.current;
    if (!thead) return;
    const measure = () => {
      const rows = Array.from(
        thead.querySelectorAll<HTMLTableRowElement>(":scope > tr.dg-hdr-row"),
      );
      const tops: number[] = [];
      let acc = 0;
      for (const r of rows) {
        tops.push(acc);
        acc += r.offsetHeight;
      }
      setHdrTops((prev) =>
        prev.length === tops.length && prev.every((v, i) => v === tops[i]) ? prev : tops,
      );
      setFilterTop((prev) => (prev === acc ? prev : acc));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(thead);
    return () => ro.disconnect();
  });

  // Restore state from IDB once on mount
  const restoredRef = useRef(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: chỉ restore 1 lần khi mount theo stateKey, các setter ổn định không cần liệt kê
  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    if (!stateKey) {
      setRestoreSettled(true); // không lưu state → coi như đã nạp xong (cho autofit-on-load).
      return;
    }
    idbGet<SavedGridState>(stateKey)
      .then((saved) => {
        if (!saved) return;
        if (saved.sorting?.length) setSorting(saved.sorting);
        if (saved.globalFilter) setGlobalFilter(saved.globalFilter);
        if (saved.grouping?.length) setGrouping(saved.grouping);
        if (saved.columnFilters?.length) setColumnFilters(saved.columnFilters);
        if (saved.columnVisibility) setColumnVisibility(saved.columnVisibility);
        if (saved.columnSizing) setColumnSizing(saved.columnSizing);
        if (saved.columnOrder?.length) setColumnOrder(saved.columnOrder);
        if (saved.columnPinning) setColumnPinning(saved.columnPinning);
      })
      .finally(() => setRestoreSettled(true));
  }, [stateKey]);

  // Debounce save to IDB on state change
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!stateKey) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void idbSet(stateKey, {
        sorting,
        globalFilter,
        grouping,
        columnFilters,
        columnVisibility,
        columnSizing,
        columnOrder,
        columnPinning,
      });
    }, 400);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [
    stateKey,
    sorting,
    globalFilter,
    grouping,
    columnFilters,
    columnVisibility,
    columnSizing,
    columnOrder,
    columnPinning,
  ]);

  // Close group picker on outside click
  useEffect(() => {
    if (!groupPickerOpen) return;
    const handler = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!groupPickerRef.current?.contains(t) && !groupDropdownRef.current?.contains(t)) {
        setGroupPickerOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [groupPickerOpen]);

  // Close column chooser on outside click
  useEffect(() => {
    if (!colChooserOpen) return;
    const handler = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!colChooserRef.current?.contains(t) && !colDropdownRef.current?.contains(t)) {
        setColChooserOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [colChooserOpen]);

  const table = useReactTable({
    data,
    columns: tableColumns,
    state: {
      sorting,
      globalFilter,
      columnFilters,
      grouping,
      expanded,
      pagination,
      columnVisibility,
      columnSizing,
      columnOrder,
      columnPinning,
      rowSelection,
    },
    onRowSelectionChange: setRowSelection,
    enableRowSelection: !!enableSelection,
    // Chọn dòng bám theo id dữ liệu (ổn định qua lọc/sắp/trang). Chỉ bật khi
    // có selection để KHÔNG đổi hành vi (row.id = index) của lưới khác.
    ...(enableSelection
      ? {
          getRowId: (row: T, index: number) => {
            const r = row as { id?: unknown };
            return r.id != null ? String(r.id) : `__row${index}`;
          },
        }
      : {}),
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    onColumnFiltersChange: setColumnFilters,
    onGroupingChange: setGrouping,
    onExpandedChange: setExpanded,
    onPaginationChange: setPagination,
    onColumnVisibilityChange: setColumnVisibility,
    onColumnSizingChange: setColumnSizing,
    onColumnOrderChange: setColumnOrder,
    onColumnPinningChange: setColumnPinning,
    enableColumnResizing: true,
    columnResizeMode: "onChange",
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getFacetedRowModel: getFacetedRowModel(),
    getFacetedUniqueValues: getFacetedUniqueValues(),
    getGroupedRowModel: getGroupedRowModel(),
    getExpandedRowModel: getExpandedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    globalFilterFn: "includesString",
    // Server mode: 1 cột sort (server chỉ nhận 1); client mode: ctrl+click đa cột.
    enableMultiSort: !serverMode,
    isMultiSortEvent: (e) => (e as MouseEvent).ctrlKey || (e as MouseEvent).metaKey,
    groupedColumnMode: false,
    // ListWidget tạo mảng `data` mới mỗi render khi filter/search client-side →
    // auto-reset theo identity sẽ nhảy trang liên tục. Tự reset theo NỘI DUNG
    // (filter/độ dài/grouping) ở effect bên dưới thay vì theo tham chiếu mảng.
    autoResetPageIndex: false,
    // Server-side: grid KHÔNG tự sort/filter/paginate — caller fetch đúng trang.
    ...(server
      ? {
          manualPagination: true,
          manualSorting: true,
          manualFiltering: true,
          rowCount: server.total,
          pageCount: Math.max(1, Math.ceil(server.total / Math.max(1, pagination.pageSize))),
        }
      : {}),
  });

  // tableRef để effect truy cập table.getAllLeafColumns() mà không cần đưa table
  // vào deps (table có thể tạo mới mỗi render do TanStack mutable-update).
  const tableRef = useRef(table);
  tableRef.current = table;

  // Prune stale column IDs khỏi columnOrder sau khi IDB restore xong.
  // Xảy ra khi entity đổi schema (field xoá/đổi tên) → columnOrder cũ chứa id
  // không tồn tại → TanStack Table log [Table] Column with id 'X' does not exist.
  const orderPrunedRef = useRef(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: tableRef stable — không cần trong deps
  useEffect(() => {
    if (!restoreSettled || orderPrunedRef.current) return;
    orderPrunedRef.current = true;
    const validIds = new Set(tableRef.current.getAllLeafColumns().map((c) => c.id));
    setColumnOrder((prev) => {
      if (prev.length === 0) return prev;
      const pruned = prev.filter((id) => validIds.has(id));
      return pruned.length === prev.length ? prev : pruned;
    });
  }, [restoreSettled]);

  // ── Autofit cột theo nội dung. table-fixed clip ô nên scrollWidth chỉ đo được
  // khi nội dung TRÀN; dùng Range đo bề rộng NỘI DUNG THẬT (co được cả 2 chiều,
  // kể cả cột hẹp hơn mặc định). +đệm padding ngang ô. ──
  const measureCol = useCallback((colId: string): number | null => {
    const root = scrollRef.current;
    if (!root) return null;
    const cells = root.querySelectorAll<HTMLElement>(`[data-col="${CSS.escape(colId)}"]`);
    if (!cells.length) return null;
    const range = document.createRange();
    let max = 0;
    cells.forEach((el) => {
      // Header: đo RIÊNG span nội dung (data-col-content), BỎ nút resize ghim
      // `absolute right-0` — nếu trùm cả nút thì Range kéo tới mép phải ô → đo ra
      // đúng bề rộng HIỆN TẠI của cột (không co theo nội dung) → nhắp đúp chỉ nhích
      // thêm chút mỗi lần thay vì fit. Ô dữ liệu không có marker → đo cả ô như cũ.
      const target = el.querySelector<HTMLElement>("[data-col-content]") ?? el;
      range.selectNodeContents(target);
      // bề rộng nội dung (Range không tính padding ô) + đệm padding ngang ô.
      const pad = Number.parseFloat(getComputedStyle(el).paddingLeft) * 2 || 0;
      const w = range.getBoundingClientRect().width + pad;
      if (w > max) max = w;
    });
    return max > 0 ? max : null;
  }, []);
  /** Autofit 1 cột → ghi columnSizing (persist). Double-click viền cột gọi cái này. */
  const autofitColumn = useCallback(
    (colId: string) => {
      const w = measureCol(colId);
      if (w == null) return;
      const compact = (table.getColumn(colId)?.columnDef.meta as GridColMeta | undefined)?.compact;
      setColumnSizing((s) => ({
        ...s,
        [colId]: clampColW(w, compact ? COMPACT_CLAMP : undefined),
      }));
    },
    [measureCol, table],
  );
  /** Autofit TẤT CẢ cột đang hiện. */
  const autofitAll = useCallback(() => {
    if (!scrollRef.current) return;
    const next: ColumnSizingState = {};
    for (const col of table.getVisibleLeafColumns()) {
      const w = measureCol(col.id);
      if (w == null) continue;
      const compact = (col.columnDef.meta as GridColMeta | undefined)?.compact;
      next[col.id] = clampColW(w, compact ? COMPACT_CLAMP : undefined);
    }
    if (Object.keys(next).length) setColumnSizing((s) => ({ ...s, ...next }));
  }, [measureCol, table]);

  // Autofit-on-load: lần đầu có dữ liệu + đã nạp xong state lưu, mà CHƯA có size
  // lưu → tự co cột theo nội dung (1 lần). Có size đã lưu → tôn trọng, không đè.
  // biome-ignore lint/correctness/useExhaustiveDependencies: chạy 1 lần (guard ref), không phụ thuộc columnSizing
  useEffect(() => {
    if (autofitDoneRef.current || !restoreSettled || data.length === 0) return;
    autofitDoneRef.current = true;
    if (Object.keys(columnSizing).length > 0) return; // đã có size → tôn trọng
    const id = requestAnimationFrame(() => autofitAll());
    return () => cancelAnimationFrame(id);
  }, [restoreSettled, data.length, autofitAll]);

  // Server mode: phát query ra caller khi phân trang/sắp/lọc đổi (debounce 250ms
  // để gõ search/lọc không bắn mỗi ký tự). Dùng serverMode (boolean ổn định) +
  // serverRef thay vì `server` object để khỏi loop theo identity.
  useEffect(() => {
    if (!serverMode) return;
    const id = setTimeout(() => {
      serverRef.current?.onQueryChange({
        pageIndex: pagination.pageIndex,
        pageSize: pagination.pageSize,
        sort: sorting[0]
          ? { field: sorting[0].id, dir: sorting[0].desc ? "desc" : "asc" }
          : undefined,
        globalFilter: globalFilter.trim() || undefined,
        columnFilters: columnFilters
          .map((f) => ({ id: f.id, value: String(f.value ?? "") }))
          .filter((f) => f.value !== ""),
      });
    }, 250);
    return () => clearTimeout(id);
  }, [serverMode, pagination.pageIndex, pagination.pageSize, sorting, globalFilter, columnFilters]);

  // Đồng bộ khi widget đổi cấu hình số dòng/trang.
  useEffect(() => {
    if (pageSize && pageSize > 0) {
      setPagination((p) => (p.pageSize === pageSize ? p : { pageIndex: 0, pageSize }));
    }
  }, [pageSize]);

  // Reset về trang đầu khi tập dữ liệu/bộ lọc đổi — bám NỘI DUNG (không bám
  // identity mảng) để tránh reset mỗi render khi ListWidget lọc client-side.
  const colFiltersKey = JSON.stringify(columnFilters);
  const groupingKey = grouping.join(",");
  const sortKey = JSON.stringify(sorting);
  // Client mode: reset trang khi tập dữ liệu/lọc đổi (bám NỘI DUNG, kể cả
  // data.length). Server mode: KHÔNG bám data.length (= page size, đổi mỗi trang
  // → loop) — chỉ reset khi lọc/sắp đổi.
  // biome-ignore lint/correctness/useExhaustiveDependencies: chủ đích bám khoá nội dung, không bám object filter.
  useEffect(() => {
    if (serverMode) return;
    setPagination((p) => (p.pageIndex === 0 ? p : { ...p, pageIndex: 0 }));
  }, [serverMode, globalFilter, colFiltersKey, groupingKey, data.length]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: server mode reset theo lọc/sắp (không theo trang/độ dài data)
  useEffect(() => {
    if (!serverMode) return;
    setPagination((p) => (p.pageIndex === 0 ? p : { ...p, pageIndex: 0 }));
  }, [serverMode, globalFilter, colFiltersKey, sortKey]);

  // Thêm dòng mới (top/bottom) → lật tới trang chứa dòng đó. ĐẶT SAU effect reset
  // theo data.length ở trên (thêm dòng làm length đổi → reset về trang 0); effect
  // này khai báo sau nên chạy SAU → thắng, đưa về đúng trang đầu/cuối. token đổi
  // mỗi lần thêm; getPageCount() đã phản ánh số trang mới.
  // biome-ignore lint/correctness/useExhaustiveDependencies: chỉ phản ứng theo token
  useEffect(() => {
    if (!pageJump) return;
    table.setPageIndex(pageJump.to === "first" ? 0 : Math.max(0, table.getPageCount() - 1));
  }, [pageJump?.token]);

  const sortableColumns = table
    .getAllColumns()
    .filter((c) => c.getCanGroup() && c.id !== "__expand__");
  const allSortableCols = table
    .getAllLeafColumns()
    .filter((c) => c.getCanSort() && !["__expand__", "__select__", "__rowacts__"].includes(c.id));
  const activeFilterCount = columnFilters.length;
  const filteredRows = table.getFilteredRowModel().rows;
  const filteredCount = filteredRows.length;

  // Cột lá đang hiện (bỏ cột điều khiển) — cho export + column chooser.
  const leafCols = table
    .getVisibleLeafColumns()
    .filter((c) => c.id !== "__expand__" && c.id !== "__select__");
  const exportCols = leafCols.map((c) => ({
    id: c.id,
    header: c.columnDef.header?.toString() ?? c.id,
  }));

  // ── Chọn dòng ──────────────────────────────────────────────────
  const selecting = !!enableSelection && showSelectCol;
  // Số ô dẫn đầu (trước cột dữ liệu): tích chọn + nút mở chi tiết.
  const leadCols = (selecting ? 1 : 0) + (renderDetail ? 1 : 0);
  // Dòng "＋ Thêm dòng mới" trong lưới — vị trí đầu/cuối theo addRowPos.
  const inlineAddPos: "top" | "bottom" | null =
    inlineAddRow && onAddRow ? (addRowPos ?? "bottom") : null;
  const addRowTr = inlineAddPos ? (
    <tr
      key="__addrow"
      className={cn("border-border", inlineAddPos === "top" ? "border-b" : "border-t")}
    >
      <td colSpan={columns.length + leadCols} className="p-0">
        <button
          type="button"
          onClick={() => onAddRow?.(inlineAddPos)}
          className="w-full flex items-center gap-1.5 px-3 py-1.5 text-xs text-muted hover:text-accent hover:bg-accent/5 transition-colors"
        >
          <I.Plus size={13} /> Thêm dòng mới
        </button>
      </td>
    </tr>
  ) : null;
  const selectedRows = table.getSelectedRowModel().rows;
  const selectedOriginals = selectedRows.map((r) => r.original);
  // "Tất cả khớp": server mode = server.total; client mode = số dòng đã lọc.
  const matchTotal = serverMode && server ? server.total : filteredCount;
  const selectedCount = allMatching ? matchTotal : selectedRows.length;
  const someSelected = selectedRows.length > 0 || allMatching;
  const headerChecked = allMatching || table.getIsAllRowsSelected();
  const headerIndeterminate = !headerChecked && table.getIsSomeRowsSelected();
  const clearSelection = () => {
    table.resetRowSelection();
    setAllMatching(false);
  };
  // Server mode còn dòng chưa tải (đã chọn hết trang mà total > đang tải) → mời
  // "chọn tất cả N dòng khớp".
  const canSelectAllMatching =
    serverMode && !allMatching && table.getIsAllRowsSelected() && matchTotal > selectedRows.length;
  // Báo caller mỗi khi tập chọn đổi.
  // biome-ignore lint/correctness/useExhaustiveDependencies: phát theo rowSelection + allMatching, dữ liệu đọc tại thời điểm chạy
  useEffect(() => {
    onSelectionChange?.({ rows: selectedOriginals, allMatching, count: selectedCount });
  }, [rowSelection, allMatching]);
  // Đóng menu export khi click ngoài vùng nút.
  useEffect(() => {
    if (!exportMenuOpen) return;
    const handler = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!exportBtnRef.current?.contains(t) && !exportDropdownRef.current?.contains(t)) {
        setExportMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [exportMenuOpen]);
  // Summary footer (DevExpress-style): cột set meta.summary → kiểu đó; cột số
  // không set → auto "sum". Có ≥1 cột summary mới hiện footer.
  // Server mode: tính client trên 1 trang là SAI → dùng server.summary (toàn
  // bảng) nếu caller cấp; không có → tắt footer.
  const clientSummaryByCol = new Map<string, { type: SummaryType; value: number }>();
  if (!serverMode) {
    for (const col of leafCols) {
      const colMeta = col.columnDef.meta as GridColMeta | undefined;
      const type: SummaryType | null = colMeta?.summary
        ? colMeta.summary
        : colMeta?.noSummary
          ? null
          : isNumericColumn(filteredRows, col.id)
            ? "sum"
            : null;
      if (type)
        clientSummaryByCol.set(col.id, {
          type,
          value: computeSummary(filteredRows, col.id, type),
        });
    }
  }
  const summaryByCol = serverMode
    ? new Map<string, { type: SummaryType; value: number }>(Object.entries(server?.summary ?? {}))
    : clientSummaryByCol;
  const showSummary = serverMode
    ? summaryByCol.size > 0
    : filteredCount > 0 && summaryByCol.size > 0;

  // Phân trang. Server mode: total + range tính theo server.total (data = 1 trang).
  const totalCount = serverMode && server ? server.total : filteredCount;
  const pageCount = table.getPageCount();
  const rangeFrom = totalCount === 0 ? 0 : pagination.pageIndex * pagination.pageSize + 1;
  const rangeTo = Math.min(totalCount, (pagination.pageIndex + 1) * pagination.pageSize);
  const pageBtn =
    "p-0.5 rounded text-muted hover:bg-hover/40 disabled:opacity-30 disabled:hover:bg-transparent";

  const doExport = async (format: "xlsx" | "csv") => {
    setExportMenuOpen(false);
    setExporting(true);
    try {
      if (onExportAll) {
        await onExportAll(format);
      } else if (format === "xlsx") {
        await exportRowsXlsx(
          exportCols,
          table.getSortedRowModel().rows.filter((r) => !r.getIsGrouped()),
          label || "export",
        );
      } else {
        exportRowsCsv(
          exportCols,
          table.getSortedRowModel().rows.filter((r) => !r.getIsGrouped()),
          label || "export",
        );
      }
    } finally {
      setExporting(false);
    }
  };

  return (
    <div
      className={cn(
        "flex flex-col",
        // Phóng to: phủ toàn màn hình, nền đặc, chỉ vùng dòng cuộn bên trong.
        maximized ? "fixed inset-0 z-[800] bg-bg p-2" : "h-full",
        className,
      )}
    >
      {toolbar && (
        <div className="border-b border-border bg-panel-2/40 shrink-0">
          {/* Toolbar: 1 hàng duy nhất — label(co cố định) + search(flex-1) + nút(co cố định) */}
          <div className="relative z-20 flex items-center gap-1 px-2 py-1 min-w-0">
            {/* Tên list + đếm dòng xếp dọc */}
            {label && (
              <div className="flex flex-col shrink-0 mr-0.5 leading-none">
                <span className="text-xs font-semibold text-muted truncate">{label}</span>
                <span className="text-[10px] text-muted/60 mt-0.5">
                  {serverMode
                    ? t("datagrid.row_count_server", { total: totalCount })
                    : t("datagrid.row_count", { filtered: filteredCount, total: data.length })}
                </span>
              </div>
            )}

            {/* Ô tìm kiếm — flex-1 lấp đầy khoảng trống giữa label và nút */}
            <div className="relative flex-1 min-w-[80px]">
              <I.Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted" />
              <Input
                placeholder={t("datagrid.search_placeholder")}
                value={globalFilter}
                onChange={(e) => setGlobalFilter(e.target.value)}
                className="pl-7! pr-2! h-7 text-xs w-full"
              />
            </div>

            {/* Nút bật/tắt chọn dòng — hiện khi đang lọc */}
            {globalFilter && (
              <button
                type="button"
                onClick={() =>
                  setShowSelectCol((v) => {
                    if (v) clearSelection();
                    return !v;
                  })
                }
                title={showSelectCol ? "Tắt chọn dòng" : "Bật chọn dòng"}
                className={cn(
                  "inline-flex items-center gap-1 px-1.5 h-6 rounded text-xs border transition-colors shrink-0",
                  selecting
                    ? "border-accent/60 text-accent bg-accent/10"
                    : "border-border text-muted hover:text-text hover:border-border",
                )}
              >
                <I.Check size={12} />
                {someSelected && <span>{selectedCount}</span>}
              </button>
            )}

            {serverMode && server?.loading && (
              <I.Loader size={12} className="shrink-0 animate-spin text-muted" />
            )}

            {/* Đếm dòng inline — chỉ hiện khi không có label */}
            {!label && (
              <span className="text-[10px] text-muted/70 shrink-0 px-0.5">
                {serverMode
                  ? t("datagrid.row_count_server", { total: totalCount })
                  : t("datagrid.row_count", { filtered: filteredCount, total: data.length })}
              </span>
            )}

            {/* Dải nút — min-w-0 cho phép bị nén; overflow-x-auto cuộn khi chật */}
            <div className="flex items-center gap-1 overflow-x-auto min-w-0">
              {/* Column filter toggle */}
              <button
                type="button"
                onClick={() => setFilterRowOpen((v) => !v)}
                title={
                  activeFilterCount > 0 ? `Lọc cột (${activeFilterCount} đang bật)` : "Lọc cột"
                }
                className={cn(
                  "inline-flex items-center gap-1 px-1.5 h-6 rounded text-xs border transition-colors shrink-0",
                  filterRowOpen || activeFilterCount > 0
                    ? "border-primary/60 text-primary bg-primary/10"
                    : "border-border text-muted hover:text-text hover:border-border",
                )}
              >
                <I.Filter size={11} />
                {activeFilterCount > 0 && <span>{activeFilterCount}</span>}
              </button>

              {/* Group-by / sort / select picker — trigger only; dropdown thoát ra ngoài overflow */}
              <div ref={groupPickerRef}>
                <button
                  type="button"
                  onClick={() => setGroupPickerOpen((v) => !v)}
                  title="Nhóm · Sắp xếp · Chọn dòng"
                  className={cn(
                    "inline-flex items-center gap-1 px-1.5 h-6 rounded text-xs border transition-colors",
                    grouping.length > 0 || sorting.length > 0 || showSelectCol
                      ? "border-accent/50 text-accent bg-accent/10"
                      : "border-border text-muted hover:text-text hover:border-border",
                  )}
                >
                  <I.Layers size={11} />
                  <I.ChevronDown size={10} />
                </button>
              </div>

              {/* Chuyển đổi xem: lưới ↔ card — 1 nút toggle */}
              <button
                type="button"
                onClick={() => setViewMode((v) => (v === "grid" ? "card" : "grid"))}
                title={viewMode === "grid" ? "Chuyển sang dạng card" : "Chuyển sang dạng lưới"}
                className={cn(
                  "inline-flex items-center justify-center px-1.5 h-6 rounded border border-border transition-colors shrink-0",
                  viewMode === "card"
                    ? "bg-accent/15 text-accent border-accent/40"
                    : "text-muted hover:text-text hover:border-border",
                )}
              >
                {viewMode === "grid" ? <I.Layout size={12} /> : <I.Table size={12} />}
              </button>

              {/* Phóng to / thu nhỏ lưới toàn màn hình */}
              <button
                type="button"
                onClick={() => setMaximized((m) => !m)}
                title={maximized ? "Thu nhỏ (Esc)" : "Phóng to toàn màn hình"}
                className="inline-flex items-center justify-center px-1.5 h-6 rounded text-xs border border-border text-muted hover:text-text hover:border-border transition-colors shrink-0"
              >
                {maximized ? <I.X size={12} /> : <I.Maximize size={11} />}
              </button>

              {/* Tự co tất cả cột vừa nội dung */}
              <button
                type="button"
                onClick={autofitAll}
                title="Tự co tất cả cột vừa nội dung (hoặc nhắp đúp viền từng cột)"
                className="inline-flex items-center justify-center w-6 h-6 rounded text-xs border border-border text-muted hover:text-text hover:border-border transition-colors"
              >
                <I.Wand size={11} />
              </button>

              {/* Dán dữ liệu (paste TSV cập nhật theo cột khóa) */}
              {onPasteApply && (
                <button
                  type="button"
                  onClick={() => setPasteOpen(true)}
                  title="Dán dữ liệu cập nhật (từ Excel)"
                  className="inline-flex items-center gap-1 px-1.5 h-6 rounded text-xs border border-border text-muted hover:text-text hover:border-border transition-colors shrink-0"
                >
                  <I.ClipboardList size={11} />
                </button>
              )}

              {/* Thêm dòng nháp vào lưới — lên ĐẦU (＋↑) hoặc xuống CUỐI (＋↓) */}
              {onAddRow && (
                <div className="inline-flex shrink-0 overflow-hidden rounded border border-border">
                  <button
                    type="button"
                    onClick={() => onAddRow("top")}
                    title="Thêm dòng mới lên ĐẦU lưới"
                    className="inline-flex items-center gap-0.5 px-1.5 h-6 text-xs text-muted hover:bg-hover hover:text-text"
                  >
                    <I.Plus size={11} />
                    <I.ChevronUp size={11} />
                  </button>
                  <button
                    type="button"
                    onClick={() => onAddRow("bottom")}
                    title="Thêm dòng mới xuống CUỐI lưới"
                    className="inline-flex items-center gap-0.5 px-1.5 h-6 text-xs text-muted hover:bg-hover hover:text-text border-l border-border"
                  >
                    <I.Plus size={11} />
                    <I.ChevronDown size={11} />
                  </button>
                </div>
              )}

              {/* Column chooser — trigger only */}
              <div ref={colChooserRef}>
                <button
                  type="button"
                  onClick={() => setColChooserOpen((v) => !v)}
                  title={t("datagrid.columns")}
                  className="inline-flex items-center gap-1 px-1.5 h-6 rounded text-xs border border-border text-muted hover:text-text hover:border-border transition-colors"
                >
                  <I.Table size={11} />
                  <I.ChevronDown size={10} />
                </button>
              </div>

              {/* Export — trigger only */}
              <div ref={exportBtnRef}>
                <button
                  type="button"
                  onClick={() => setExportMenuOpen((v) => !v)}
                  disabled={exporting}
                  title="Tải xuống"
                  className="inline-flex items-center gap-1 px-1.5 h-6 rounded text-xs border border-border text-muted hover:text-text hover:border-border transition-colors disabled:opacity-50"
                >
                  {exporting ? (
                    <I.Loader size={11} className="animate-spin" />
                  ) : (
                    <I.Download size={11} />
                  )}
                  <I.ChevronDown size={10} />
                </button>
              </div>
            </div>

            {/* Group/sort/select dropdown — ngoài overflow-x-auto, không bị cắt */}
            {groupPickerOpen && (
              <div
                ref={groupDropdownRef}
                className="absolute top-full left-0 mt-1 z-50 bg-panel border border-border rounded shadow-lg min-w-[200px] py-1 max-h-[70vh] overflow-y-auto"
              >
                {/* ── Sắp xếp ── */}
                <div className="px-3 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted/60">
                  Sắp xếp
                </div>
                {sorting.map((s) => {
                  const col = table.getColumn(s.id);
                  if (!col) return null;
                  return (
                    <div
                      key={s.id}
                      draggable
                      onDragStart={() => setDragSortId(s.id)}
                      onDragEnd={() => setDragSortId(null)}
                      onDragOver={(e) => {
                        if (dragSortId && dragSortId !== s.id) e.preventDefault();
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        if (!dragSortId || dragSortId === s.id) return;
                        const from = sorting.findIndex((x) => x.id === dragSortId);
                        const to = sorting.findIndex((x) => x.id === s.id);
                        if (from === -1 || to === -1) return;
                        const next = [...sorting];
                        next.splice(to, 0, ...next.splice(from, 1));
                        setSorting(next);
                        setDragSortId(null);
                      }}
                      className={cn(
                        "flex items-center gap-1 px-2 text-xs",
                        dragSortId === s.id && "opacity-40",
                      )}
                    >
                      <I.Grip size={10} className="shrink-0 text-muted/40 cursor-grab" />
                      <button
                        type="button"
                        onClick={() =>
                          setSorting(
                            sorting.map((x) => (x.id === s.id ? { ...x, desc: !x.desc } : x)),
                          )
                        }
                        className="flex flex-1 items-center gap-1.5 py-1 text-left hover:text-text transition-colors"
                      >
                        {s.desc ? (
                          <I.ChevronDown size={11} className="shrink-0 text-accent" />
                        ) : (
                          <I.ChevronUp size={11} className="shrink-0 text-accent" />
                        )}
                        <span className="text-text">
                          {(col.columnDef.header as string | undefined) ?? s.id}
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setSorting(sorting.filter((x) => x.id !== s.id))}
                        className="shrink-0 text-muted/40 hover:text-danger transition-colors"
                      >
                        <I.X size={10} />
                      </button>
                    </div>
                  );
                })}
                {allSortableCols
                  .filter((col) => !sorting.find((s) => s.id === col.id))
                  .map((col) => (
                    <button
                      key={col.id}
                      type="button"
                      onClick={() => setSorting([...sorting, { id: col.id, desc: false }])}
                      className="flex w-full items-center gap-1.5 px-2 py-1 text-xs text-muted hover:text-text hover:bg-hover/40 transition-colors"
                    >
                      <I.ChevronsUpDown size={11} className="shrink-0 text-muted/30" />
                      {(col.columnDef.header as string | undefined) ?? col.id}
                    </button>
                  ))}
                {sorting.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setSorting([])}
                    className="w-full text-left px-3 py-1 text-xs text-danger hover:bg-hover/40 transition-colors"
                  >
                    Bỏ tất cả sắp xếp
                  </button>
                )}

                {/* ── Nhóm theo ── */}
                {!serverMode && (
                  <>
                    <div className="border-t border-border my-1" />
                    <div className="px-3 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted/60">
                      Nhóm theo
                    </div>
                    {/* Active groups — draggable để đổi thứ tự cấp nhóm */}
                    {grouping.map((colId) => {
                      const col = table.getColumn(colId);
                      if (!col) return null;
                      return (
                        <div
                          key={colId}
                          draggable
                          onDragStart={() => setDragGroupId(colId)}
                          onDragEnd={() => setDragGroupId(null)}
                          onDragOver={(e) => {
                            if (dragGroupId && dragGroupId !== colId) e.preventDefault();
                          }}
                          onDrop={(e) => {
                            e.preventDefault();
                            if (!dragGroupId || dragGroupId === colId) return;
                            const from = grouping.indexOf(dragGroupId);
                            const to = grouping.indexOf(colId);
                            if (from === -1 || to === -1) return;
                            const next = [...grouping];
                            next.splice(to, 0, ...next.splice(from, 1));
                            setGrouping(next);
                            setDragGroupId(null);
                          }}
                          className={cn(
                            "flex items-center gap-1 px-2 text-xs",
                            dragGroupId === colId && "opacity-40",
                          )}
                        >
                          <I.Grip size={10} className="shrink-0 text-muted/40 cursor-grab" />
                          <span className="flex flex-1 items-center gap-1.5 py-1 text-text">
                            <I.Layers size={11} className="shrink-0 text-accent" />
                            {(col.columnDef.header as string | undefined) ?? colId}
                          </span>
                          <button
                            type="button"
                            onClick={() => setGrouping((prev) => prev.filter((g) => g !== colId))}
                            className="shrink-0 text-muted/40 hover:text-danger transition-colors"
                          >
                            <I.X size={10} />
                          </button>
                        </div>
                      );
                    })}
                    {/* Inactive groups — click để thêm */}
                    {sortableColumns
                      .filter((col) => !grouping.includes(col.id))
                      .map((col) => (
                        <button
                          key={col.id}
                          type="button"
                          onClick={() => {
                            setGrouping((prev) => [...prev, col.id]);
                            setExpanded(true);
                          }}
                          className="flex w-full items-center gap-1.5 px-2 py-1 text-xs text-muted hover:text-text hover:bg-hover/40 transition-colors"
                        >
                          <I.Layers size={11} className="shrink-0 text-muted/30" />
                          {(col.columnDef.header as string | undefined) ?? col.id}
                        </button>
                      ))}
                    {grouping.length > 1 && (
                      <button
                        type="button"
                        onClick={() => {
                          setGrouping([]);
                          setGroupPickerOpen(false);
                        }}
                        className="w-full text-left px-3 py-1 text-xs text-danger hover:bg-hover/40 transition-colors"
                      >
                        Bỏ tất cả nhóm
                      </button>
                    )}
                  </>
                )}

                {/* ── Tích chọn dòng ── */}
                {enableSelection && (
                  <>
                    <div className="border-t border-border my-1" />
                    <button
                      type="button"
                      onClick={() =>
                        setShowSelectCol((v) => {
                          if (v) clearSelection();
                          return !v;
                        })
                      }
                      className="w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-hover/40 transition-colors"
                    >
                      <div
                        className={cn(
                          "w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0",
                          showSelectCol ? "bg-accent border-accent" : "border-border",
                        )}
                      >
                        {showSelectCol && <I.Check size={9} className="text-white" />}
                      </div>
                      <span className={showSelectCol ? "text-text" : "text-muted"}>Chọn dòng</span>
                    </button>
                  </>
                )}
              </div>
            )}

            {/* Col chooser dropdown — ngoài overflow-x-auto */}
            {colChooserOpen && (
              <div
                ref={colDropdownRef}
                className="absolute top-full right-0 mt-1 z-50 bg-panel border border-border rounded shadow-lg min-w-[180px] max-w-[360px] max-h-[320px] overflow-auto py-1"
              >
                <div className="w-max min-w-full">
                  {table
                    .getAllLeafColumns()
                    .filter((c) => c.id !== "__expand__" && c.id !== "__select__")
                    .map((col) => {
                      const pin = col.getIsPinned();
                      return (
                        <div
                          key={col.id}
                          draggable
                          onDragStart={() => setDragColId(col.id)}
                          onDragOver={(e) => {
                            if (dragColId && dragColId !== col.id) e.preventDefault();
                          }}
                          onDrop={(e) => {
                            e.preventDefault();
                            if (dragColId && dragColId !== col.id) {
                              const cur = table.getState().columnOrder;
                              const order = cur.length
                                ? [...cur]
                                : table.getAllLeafColumns().map((c) => c.id);
                              const from = order.indexOf(dragColId);
                              const to = order.indexOf(col.id);
                              if (from !== -1 && to !== -1) {
                                order.splice(to, 0, ...order.splice(from, 1));
                                setColumnOrder(order);
                              }
                            }
                            setDragColId(null);
                          }}
                          onDragEnd={() => setDragColId(null)}
                          className={cn(
                            "flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-hover/40",
                            dragColId === col.id && "opacity-40",
                          )}
                        >
                          <I.Grip size={11} className="shrink-0 cursor-grab text-muted/40" />
                          <label className="flex items-center gap-2 flex-1 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={col.getIsVisible()}
                              onChange={col.getToggleVisibilityHandler()}
                              disabled={!col.getCanHide()}
                            />
                            <span className="whitespace-nowrap">
                              {(() => {
                                const m = col.columnDef.meta as GridColMeta | undefined;
                                return typeof col.columnDef.header === "string"
                                  ? col.columnDef.header
                                  : (m?.label ?? m?.techName ?? col.id);
                              })()}
                            </span>
                          </label>
                          <div className="flex items-center gap-0.5 shrink-0">
                            <button
                              type="button"
                              title={t("datagrid.pin_left")}
                              onClick={() => col.pin(pin === "left" ? false : "left")}
                              className={cn(
                                "p-0.5 rounded hover:bg-hover/60",
                                pin === "left" ? "text-accent" : "text-muted/50",
                              )}
                            >
                              <I.PanelLeft size={12} />
                            </button>
                            <button
                              type="button"
                              title={t("datagrid.pin_right")}
                              onClick={() => col.pin(pin === "right" ? false : "right")}
                              className={cn(
                                "p-0.5 rounded hover:bg-hover/60",
                                pin === "right" ? "text-accent" : "text-muted/50",
                              )}
                            >
                              <I.PanelRight size={12} />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                </div>
              </div>
            )}

            {/* Export dropdown — ngoài overflow-x-auto */}
            {exportMenuOpen && (
              <div
                ref={exportDropdownRef}
                className="absolute right-0 top-full mt-1 z-50 bg-panel border border-border rounded shadow-lg py-1 min-w-[200px]"
              >
                <button
                  type="button"
                  onClick={() => doExport("xlsx")}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-text hover:bg-hover transition-colors"
                >
                  <I.FileSpreadsheet size={13} className="text-success" />
                  Excel (.xlsx)
                  {onExportAll && <span className="ml-auto text-muted/60">toàn bộ</span>}
                </button>
                <button
                  type="button"
                  onClick={() => doExport("csv")}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-text hover:bg-hover transition-colors"
                >
                  <I.FileText size={13} className="text-muted" />
                  CSV (.csv)
                  {onExportAll && <span className="ml-auto text-muted/60">toàn bộ</span>}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {selecting && someSelected && (
        <div className="flex items-center gap-2 px-2 py-1 border-b border-border bg-accent/5 text-xs shrink-0 flex-wrap">
          <span className="font-medium text-accent">Đã chọn {selectedCount} dòng</span>
          {canSelectAllMatching && (
            <button
              type="button"
              onClick={() => {
                table.toggleAllRowsSelected(true);
                setAllMatching(true);
              }}
              className="underline text-accent hover:text-accent-2"
            >
              Chọn tất cả {matchTotal} dòng khớp
            </button>
          )}
          <div className="ml-auto flex items-center gap-1.5 flex-wrap">
            {bulkActions?.map((a) => (
              <button
                key={a.label}
                type="button"
                onClick={() => a.onClick(selectedOriginals, allMatching)}
                className={cn(
                  "inline-flex items-center gap-1 px-2 h-6 rounded border text-xs transition-colors",
                  a.danger
                    ? "border-danger/50 text-danger hover:bg-danger/10"
                    : "border-border text-muted hover:text-text hover:border-border",
                )}
              >
                {a.icon}
                {a.label}
              </button>
            ))}
            <button
              type="button"
              onClick={() =>
                exportRowsCsv(exportCols, selectedRows, `${label || "export"}-da-chon`)
              }
              title="Xuất CSV các dòng đã chọn (đã tải)"
              className="inline-flex items-center gap-1 px-2 h-6 rounded border border-border text-muted hover:text-text hover:border-border text-xs"
            >
              <I.Download size={11} /> Xuất đã chọn
            </button>
            <button
              type="button"
              onClick={clearSelection}
              className="inline-flex items-center gap-1 px-2 h-6 rounded border border-border text-muted hover:text-text hover:border-border text-xs"
            >
              <I.X size={11} /> Bỏ chọn
            </button>
          </div>
        </div>
      )}

      {viewMode === "card" ? (
        <div className="flex-1 overflow-auto p-2 space-y-2">
          {table.getRowModel().rows.length === 0 ? (
            <div className="text-center py-8 text-muted text-sm">
              {emptyText ?? t("datagrid.empty")}
            </div>
          ) : (
            table.getRowModel().rows.map((row) => {
              if (row.getIsGrouped()) {
                const colId = row.groupingColumnId ?? "";
                const colHeader = table.getColumn(colId)?.columnDef.header?.toString() ?? colId;
                return (
                  <button
                    key={row.id}
                    type="button"
                    onClick={row.getToggleExpandedHandler()}
                    className="w-full flex items-center gap-2 px-3 py-2 rounded-md bg-panel-2/60 border border-border text-xs font-semibold text-muted"
                  >
                    {row.getIsExpanded() ? (
                      <I.ChevronDown size={12} />
                    ) : (
                      <I.ChevronRight size={12} />
                    )}
                    <span className="text-text/70">{colHeader}:</span>
                    <span className="text-text">{String(row.groupingValue ?? "—")}</span>
                    <Chip className="ml-auto text-[10px] py-0">{row.subRows.length}</Chip>
                  </button>
                );
              }
              const selected = isRowSelected?.(row.original) ?? false;
              const clickable = !!onRowClick;
              return (
                <div
                  key={row.id}
                  onClick={clickable ? () => onRowClick(row.original) : undefined}
                  onKeyDown={
                    clickable
                      ? (e) => {
                          if (e.key === "Enter") onRowClick(row.original);
                        }
                      : undefined
                  }
                  role={clickable ? "button" : undefined}
                  tabIndex={clickable ? 0 : undefined}
                  className={cn(
                    "relative rounded-md border p-2.5 space-y-1 transition-colors",
                    clickable && "cursor-pointer",
                    selected
                      ? "bg-accent/10 border-accent ring-1 ring-accent"
                      : "border-border bg-panel hover:bg-hover/20",
                  )}
                >
                  {selecting && (
                    <span className="absolute right-2 top-2" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        aria-label="Chọn dòng"
                        checked={row.getIsSelected()}
                        onChange={row.getToggleSelectedHandler()}
                        className="accent-accent cursor-pointer"
                      />
                    </span>
                  )}
                  {row.getVisibleCells().map((cell) => {
                    if (cell.getIsPlaceholder()) return null;
                    const hdr = cell.column.columnDef.header;
                    const headerLabel = typeof hdr === "string" ? hdr : cell.column.id;
                    return (
                      <div key={cell.id} className="flex gap-2 items-baseline text-sm">
                        <span className="text-[11px] uppercase tracking-wide text-muted min-w-[88px] shrink-0">
                          {headerLabel}
                        </span>
                        <span className="flex-1 min-w-0 break-words">
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </span>
                      </div>
                    );
                  })}
                </div>
              );
            })
          )}
        </div>
      ) : (
        <div ref={scrollRef} className="flex-1 overflow-auto relative datagrid-scroll">
          {/* Gợi ý khi đang kéo tiêu đề cột: thả vào lưới để ẩn. pointer-events-none
              để không chặn drop trên tbody lẫn reorder trên header. */}
          {dragColId && (
            <div className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 z-20 px-3 py-1.5 rounded-full bg-accent text-white text-xs font-medium shadow-lg flex items-center gap-1.5">
              <I.EyeOff size={13} /> Thả vào lưới để ẩn cột
            </div>
          )}
          {/* table-fixed + width:100%/minWidth=tổng cột: mỗi cột có bề rộng
              XÁC ĐỊNH nên ô whitespace-nowrap CLIP gọn trong cột (table-layout
              auto KHÔNG cho truncate/overflow ăn → text tràn đè cột bên). Tổng
              cột > container → cuộn ngang; < container → giãn lấp đầy. */}
          <table
            className="table-fixed border-collapse text-sm"
            style={{
              width: "100%",
              minWidth:
                table.getVisibleLeafColumns().reduce((s, c) => s + c.getSize(), 0) +
                (selecting ? 36 : 0) +
                (renderDetail ? 28 : 0),
            }}
          >
            {/* table-fixed lấy bề rộng cột từ <col> (ưu tiên hơn ô hàng đầu) hoặc
                từ ô HÀNG ĐẦU. Có banded header → hàng đầu là DẢI NHÓM (th colSpan,
                KHÔNG mang width) nên width đặt trên <th> LÁ (nằm ở hàng dưới) bị
                table-fixed BỎ QUA → kéo đổi rộng cột trong dải không ăn. <colgroup>
                mang width từng cột lá nên resize ăn cả khi có band lẫn không. */}
            <colgroup>
              {selecting && <col style={{ width: 36 }} />}
              {renderDetail && <col style={{ width: 28 }} />}
              {/* PHẢI theo thứ tự GHIM (trái → giữa → phải) GIỐNG ô thân
                  (row.getVisibleCells). getVisibleLeafColumns KHÔNG sắp theo pin →
                  khi ghim cột, <col> lệch hàng với ô → cột ghim lấy nhầm width cột
                  khác + kéo resize đổi nhầm cột. */}
              {[
                ...table.getLeftVisibleLeafColumns(),
                ...table.getCenterVisibleLeafColumns(),
                ...table.getRightVisibleLeafColumns(),
              ].map((col) => (
                <col key={col.id} style={{ width: col.getSize() }} />
              ))}
              {/* Cột ĐỆM auto (không có ô) — hút phần dư khi tổng cột < bề rộng bảng,
                  giữ MỌI cột thật ĐÚNG width của nó (width:100% sẽ kéo giãn TỈ LỆ mọi
                  cột nếu không có đệm → cột hành động phình rộng hơn cụm nút). Tổng cột
                  ≥ bảng thì đệm = 0 (cuộn ngang như cũ). */}
              <col data-spacer="" />
            </colgroup>
            <thead ref={theadRef} className="bg-panel-2 z-10">
              {(() => {
                // Header lồng nhiều cấp: TanStack đặt LÁ THẬT ở hàng DƯỚI CÙNG,
                // các hàng trên là PLACEHOLDER của lá (lá nông xuyên qua). Vẽ mỗi
                // lá ĐÚNG 1 LẦN ở hàng TRÊN CÙNG nó xuất hiện (placeholder đầu) +
                // rowSpan phủ xuống đáy → lá nông thành ô cao, cột thẳng hàng. Ô
                // NHÓM = header có cột con thật (không phải placeholder).
                const headerRows = table.getHeaderGroups();
                const totalRows = headerRows.length;
                const renderedLeaves = new Set<string>();
                return headerRows.map((hg, rowIndex) => (
                  <tr key={hg.id} className="dg-hdr-row border-b border-border">
                    {selecting && rowIndex === 0 && (
                      <th
                        className="w-9 px-1 bg-panel-2 text-center"
                        style={{ position: "sticky", top: 0, zIndex: 12 }}
                        rowSpan={totalRows}
                      >
                        <input
                          type="checkbox"
                          aria-label="Chọn tất cả dòng đã lọc"
                          checked={headerChecked}
                          ref={(el) => {
                            if (el) el.indeterminate = headerIndeterminate;
                          }}
                          onChange={() => {
                            if (headerChecked) clearSelection();
                            else table.toggleAllRowsSelected(true);
                          }}
                          className="accent-accent cursor-pointer align-middle"
                        />
                      </th>
                    )}
                    {renderDetail && rowIndex === 0 && (
                      <th
                        className="w-7 px-1 bg-panel-2"
                        style={{ position: "sticky", top: 0, zIndex: 12 }}
                        rowSpan={totalRows}
                        aria-hidden
                      />
                    )}
                    {hg.headers.map((header) => {
                      const top = hdrTops[rowIndex] ?? 0;
                      // Ô NHÓM (dải bao trên): căn giữa, span nhiều cột, KHÔNG
                      // sort/kéo/đổi rộng — chỉ là nhãn nhóm.
                      const isGroup = !header.isPlaceholder && header.subHeaders.length > 0;
                      if (isGroup) {
                        return (
                          <th
                            key={header.id}
                            colSpan={header.colSpan}
                            // Kéo DẢI NHÓM thả vào lưới -> ẩn HẾT cột lá trong nhóm
                            // (tbody onDrop phân giải getLeafColumns). Trước đây band
                            // không draggable nên dragColId không set -> không ẩn được.
                            draggable
                            onDragStart={() => setDragColId(header.column.id)}
                            onDragEnd={() => setDragColId(null)}
                            style={{ position: "sticky", top, zIndex: 12 }}
                            className={cn(
                              "text-center px-2 py-0.5 font-semibold text-[11px] uppercase tracking-wide text-muted whitespace-nowrap bg-panel-2 border-x border-border/60 dark:border-border",
                              dragColId === header.column.id && "opacity-40",
                            )}
                          >
                            {flexRender(header.column.columnDef.header, header.getContext())}
                          </th>
                        );
                      }
                      // Ô LÁ (placeholder xuyên hàng HOẶC lá đáy) — vẽ 1 lần ở vị
                      // trí trên cùng, bỏ các lần xuất hiện dưới (đã phủ rowSpan).
                      if (renderedLeaves.has(header.column.id)) return null;
                      renderedLeaves.add(header.column.id);
                      const rowSpan = totalRows - rowIndex;
                      const sorted = header.column.getIsSorted();
                      const sortIndex = header.column.getSortIndex();
                      // Tên cột kỹ thuật (tuỳ chọn) — cột nào set meta.techName thì
                      // hiện thêm dòng mono dưới nhãn (vd lưới dữ liệu entity).
                      const techName = (
                        header.column.columnDef.meta as { techName?: string } | undefined
                      )?.techName;
                      return (
                        <th
                          key={header.id}
                          colSpan={header.colSpan}
                          rowSpan={rowSpan}
                          draggable={!header.column.getIsGrouped()}
                          onDragStart={(e) => {
                            // Resize handle nằm TRONG <th draggable> → kéo đổi rộng cột
                            // cũng nổ dragstart. Đang resize thì KHÔNG khởi tạo kéo-ẩn-cột
                            // (nếu không gợi ý "thả để ẩn" hiện nhầm khi chỉnh rộng cột).
                            if (table.getState().columnSizingInfo.isResizingColumn) {
                              e.preventDefault();
                              return;
                            }
                            setDragColId(header.column.id);
                          }}
                          // Buông tiêu đề (thả ở đâu cũng vậy, kể cả huỷ/ra ngoài) → tắt gợi ý.
                          onDragEnd={() => setDragColId(null)}
                          onDragOver={(e) => {
                            if (dragColId && dragColId !== header.column.id) e.preventDefault();
                          }}
                          onDrop={(e) => {
                            e.preventDefault();
                            if (dragColId && dragColId !== header.column.id) {
                              const cur = table.getState().columnOrder;
                              const order = cur.length
                                ? [...cur]
                                : table.getAllLeafColumns().map((c) => c.id);
                              const from = order.indexOf(dragColId);
                              const to = order.indexOf(header.column.id);
                              if (from !== -1 && to !== -1) {
                                order.splice(to, 0, ...order.splice(from, 1));
                                setColumnOrder(order);
                              }
                            }
                            setDragColId(null);
                          }}
                          data-col={header.column.id}
                          style={{
                            ...headerStickyStyle(header.column, top),
                            // Cột điều khiển ghim cứng width; cột dữ liệu auto chia phần còn lại.
                            ...sizedWidth(header.column),
                          }}
                          className={cn(
                            "relative text-left py-0.5 font-semibold text-xs uppercase tracking-wide text-muted whitespace-nowrap bg-panel-2 border-r border-border/40 dark:border-border",
                            // Cột điều khiển (compact) padding sát để cột hẹp tối đa.
                            (header.column.columnDef.meta as GridColMeta | undefined)?.compact
                              ? "px-0.5"
                              : "px-2",
                            dragColId === header.column.id && "opacity-40",
                          )}
                        >
                          <span
                            // Đánh dấu vùng NỘI DUNG header để autofit (nhắp đúp viền)
                            // đo đúng bề rộng chữ — KHÔNG dính nút resize absolute.
                            data-col-content=""
                            onClick={
                              header.column.getCanSort()
                                ? header.column.getToggleSortingHandler()
                                : undefined
                            }
                            className={cn(
                              "inline-flex flex-col leading-tight",
                              header.column.getCanSort() &&
                                "cursor-pointer hover:text-text select-none",
                            )}
                          >
                            <span className="inline-flex items-center gap-1">
                              {flexRender(header.column.columnDef.header, header.getContext())}
                              {sorted === "asc" && <I.ChevronUp size={11} />}
                              {sorted === "desc" && <I.ChevronDown size={11} />}
                              {sorted && sorting.length > 1 && (
                                <span className="text-[9px] text-muted/70 font-normal">
                                  {sortIndex + 1}
                                </span>
                              )}
                            </span>
                            {techName && (
                              <span className="font-mono text-[9px] normal-case tracking-normal font-normal text-muted/60">
                                {techName}
                              </span>
                            )}
                          </span>
                          {/* Resize handle: kéo viền đổi rộng cột; NHẮP ĐÚP → autofit nội dung. */}
                          {header.column.getCanResize() && (
                            <button
                              type="button"
                              aria-label="Kéo đổi rộng cột (nhắp đúp: tự co theo nội dung)"
                              title="Kéo để đổi rộng · Nhắp đúp để tự co theo nội dung"
                              onMouseDown={header.getResizeHandler()}
                              onTouchStart={header.getResizeHandler()}
                              onClick={(e) => e.stopPropagation()}
                              onDoubleClick={(e) => {
                                e.stopPropagation();
                                autofitColumn(header.column.id);
                              }}
                              className={cn(
                                // Vùng kéo rộng 10px ghim mép phải (dễ trúng hơn 6px cũ,
                                // nhất là cột hẹp / cột lá trong dải nhiều cấp ô thấp).
                                "absolute right-0 top-0 h-full w-2.5 cursor-col-resize select-none touch-none hover:bg-accent/40",
                                header.column.getIsResizing() && "bg-accent",
                              )}
                            />
                          )}
                        </th>
                      );
                    })}
                    {/* Ô đệm cho cột spacer (<col data-spacer="">) — hút phần dư khi
                      màn hình rộng. Không có ô này thì vùng spacer trong thead trống,
                      tbody row 1 hiện xuyên qua → "header nằm chung với dòng 1". */}
                    {rowIndex === 0 && (
                      <th
                        aria-hidden
                        rowSpan={totalRows}
                        style={{ position: "sticky", top: 0, zIndex: 12 }}
                        className="bg-panel-2"
                      />
                    )}
                  </tr>
                ));
              })()}
              {/* Hàng ô lọc từng cột — theo cột LÁ (banded header: nhóm không lọc). */}
              {filterRowOpen && (
                <tr className="border-b border-border bg-panel-2/60">
                  {selecting && <th className="w-9 px-1" aria-hidden />}
                  {renderDetail && <th className="w-7 px-1" aria-hidden />}
                  {table.getVisibleLeafColumns().map((column) => (
                    <th
                      key={column.id}
                      style={{ ...pinnedStyle(column), position: "sticky", top: filterTop }}
                      className={cn("px-1.5 py-1 bg-panel-2/95", column.getIsPinned() && "z-20")}
                    >
                      {column.getCanFilter() ? (
                        <FacetFilterInput
                          column={column}
                          placeholder={t("datagrid.col_filter_placeholder")}
                          faceted={!serverMode}
                        />
                      ) : null}
                    </th>
                  ))}
                  <th
                    aria-hidden
                    style={{ position: "sticky", top: filterTop, zIndex: 12 }}
                    className="bg-panel-2/95"
                  />
                </tr>
              )}
            </thead>
            <tbody
              // Kéo tiêu đề cột thả vào vùng dữ liệu (tbody) -> ẩn cột đó.
              // thead/tbody là anh em nên drop reorder trên header không lọt xuống đây.
              onDragOver={(e) => {
                if (dragColId) e.preventDefault();
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (dragColId) {
                  // Banded header: kéo DẢI NHÓM (id "__grp__") -> phải ẩn TẤT CẢ
                  // cột lá của nhóm (columnVisibility chỉ tác động lá). Cột lá ->
                  // getLeafColumns trả về chính nó.
                  const dragged = table.getColumn(dragColId);
                  const leafIds = dragged ? dragged.getLeafColumns().map((c) => c.id) : [dragColId];
                  setColumnVisibility((v) => {
                    const next = { ...v };
                    for (const id of leafIds) next[id] = false;
                    return next;
                  });
                  setDragColId(null);
                }
              }}
            >
              {inlineAddPos === "top" && addRowTr}
              {table.getRowModel().rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={columns.length + leadCols}
                    className="text-center py-8 text-muted text-sm"
                  >
                    {emptyText ?? t("datagrid.empty")}
                  </td>
                </tr>
              ) : (
                table.getRowModel().rows.map((row) => {
                  if (row.getIsGrouped()) {
                    const colId = row.groupingColumnId ?? "";
                    const colHeader = table.getColumn(colId)?.columnDef.header?.toString() ?? colId;
                    return (
                      <tr
                        key={row.id}
                        className="border-b border-border bg-panel-2/50 cursor-pointer hover:bg-hover/20"
                        onClick={row.getToggleExpandedHandler()}
                      >
                        <td colSpan={columns.length + leadCols} className="px-3 py-1.5">
                          <span className="inline-flex items-center gap-2 text-xs font-semibold text-muted">
                            {row.getIsExpanded() ? (
                              <I.ChevronDown size={12} />
                            ) : (
                              <I.ChevronRight size={12} />
                            )}
                            <span className="text-text/70">{colHeader}:</span>
                            <span className="text-text">{String(row.groupingValue ?? "—")}</span>
                            <Chip className="ml-1 text-[10px] py-0">{row.subRows.length}</Chip>
                          </span>
                        </td>
                      </tr>
                    );
                  }
                  const selected = isRowSelected?.(row.original) ?? false;
                  const clickable = !!onRowClick;
                  const detailOpen = renderDetail ? openDetail.has(row.id) : false;
                  const isNew = (row.original as { __isNew?: boolean }).__isNew === true;
                  const isChanged = !isNew && !!changedRowIds?.has(row.id);
                  return (
                    <Fragment key={row.id}>
                      <tr
                        className={[
                          "border-b border-border transition-colors",
                          clickable ? "cursor-pointer" : "",
                          // Dòng nháp mới (chưa lưu) — tô nền xanh nhạt phân biệt.
                          isNew
                            ? "bg-success/5 hover:bg-success/10"
                            : selected
                              ? "bg-accent/10 ring-1 ring-accent"
                              : "hover:bg-hover/30",
                        ].join(" ")}
                        style={isChanged ? { backgroundColor: "var(--changed-row-bg)" } : undefined}
                        onClick={clickable ? () => onRowClick(row.original) : undefined}
                      >
                        {selecting && (
                          <td className="w-9 px-1 text-center align-middle">
                            <span onClick={(e) => e.stopPropagation()}>
                              <input
                                type="checkbox"
                                aria-label="Chọn dòng"
                                checked={row.getIsSelected()}
                                disabled={!row.getCanSelect()}
                                onChange={row.getToggleSelectedHandler()}
                                className="accent-accent cursor-pointer align-middle"
                              />
                            </span>
                          </td>
                        )}
                        {renderDetail && (
                          <td className="w-7 px-1 align-middle">
                            <button
                              type="button"
                              aria-label={detailOpen ? "Thu gọn" : "Mở chi tiết"}
                              onClick={(e) => {
                                e.stopPropagation();
                                setOpenDetail((prev) => {
                                  const next = new Set(prev);
                                  if (next.has(row.id)) next.delete(row.id);
                                  else next.add(row.id);
                                  return next;
                                });
                              }}
                              className="p-0.5 rounded text-muted hover:text-text hover:bg-hover/60"
                            >
                              {detailOpen ? (
                                <I.ChevronDown size={13} />
                              ) : (
                                <I.ChevronRight size={13} />
                              )}
                            </button>
                          </td>
                        )}
                        {row.getVisibleCells().map((cell) => {
                          if (cell.getIsPlaceholder()) return <td key={cell.id} />;
                          // Conditional formatting: meta.cellClass / formatRules,
                          // else mặc định (số âm → đỏ).
                          const cm = cell.column.columnDef.meta as GridColMeta | undefined;
                          const ccls = cellFormatClass(cell.getValue(), cm);
                          const pinned = cell.column.getIsPinned();
                          return (
                            <td
                              key={cell.id}
                              data-col={cell.column.id}
                              style={{
                                ...pinnedStyle(cell.column),
                                ...sizedWidth(cell.column),
                              }}
                              className={cn(
                                // py-1 (compact) + overflow-hidden mọi ô (table-fixed clip nội dung).
                                "py-1 overflow-hidden whitespace-nowrap border-r border-border/40 dark:border-border",
                                cm?.compact ? "px-0.5" : "px-2",
                                pinned && "bg-bg",
                                ccls,
                              )}
                            >
                              {flexRender(cell.column.columnDef.cell, cell.getContext())}
                            </td>
                          );
                        })}
                      </tr>
                      {detailOpen && renderDetail && (
                        <tr className="border-b border-border bg-panel-2/30">
                          <td colSpan={columns.length + leadCols} className="px-4 py-3 align-top">
                            {renderDetail(row.original)}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })
              )}
              {/* Dòng "＋ Thêm dòng mới" ở CUỐI (addRowPos="bottom", mặc định). */}
              {inlineAddPos === "bottom" && addRowTr}
            </tbody>
            {showSummary && (
              <tfoot className="sticky bottom-0 z-10 bg-panel-2 border-t-2 border-border">
                <tr>
                  {selecting && <td className="w-9 px-1" aria-hidden />}
                  {renderDetail && <td className="w-7 px-1" aria-hidden />}
                  {table.getVisibleLeafColumns().map((col, idx) => {
                    const s = summaryByCol.get(col.id);
                    return (
                      <td
                        key={col.id}
                        className="px-3 py-1.5 text-xs whitespace-nowrap text-right border-r border-border/40 dark:border-border"
                      >
                        {s ? (
                          <span className="font-semibold text-accent">
                            {SUMMARY_LABEL[s.type]} {fmtNum(s.value)}
                          </span>
                        ) : idx === 0 ? (
                          <span className="block text-left text-muted">{totalCount} dòng</span>
                        ) : null}
                      </td>
                    );
                  })}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}

      {pageCount > 1 && (
        <div className="flex items-center gap-1 px-2 py-0.5 border-t border-border bg-panel-2/40 shrink-0 text-[11px] text-muted overflow-x-auto">
          <span className="shrink-0">
            {t("datagrid.page_range", { from: rangeFrom, to: rangeTo, total: totalCount })}
          </span>
          <div className="ml-auto flex items-center gap-1">
            <select
              value={pagination.pageSize}
              onChange={(e) => setPagination({ pageIndex: 0, pageSize: Number(e.target.value) })}
              title={t("datagrid.per_page")}
              className="h-5 rounded border border-border bg-panel px-1 text-[11px]"
            >
              {PAGE_SIZE_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {t("datagrid.per_page_n", { n })}
                </option>
              ))}
            </select>
            <div className="inline-flex items-center">
              <button
                type="button"
                onClick={() => table.setPageIndex(0)}
                disabled={!table.getCanPreviousPage()}
                title={t("datagrid.first")}
                className={pageBtn}
              >
                <I.ChevronsLeft size={14} />
              </button>
              <button
                type="button"
                onClick={() => table.previousPage()}
                disabled={!table.getCanPreviousPage()}
                title={t("datagrid.prev")}
                className={pageBtn}
              >
                <I.ChevronLeft size={14} />
              </button>
              <span className="px-2 whitespace-nowrap">
                {t("datagrid.page_info", { page: pagination.pageIndex + 1, count: pageCount })}
              </span>
              <button
                type="button"
                onClick={() => table.nextPage()}
                disabled={!table.getCanNextPage()}
                title={t("datagrid.next")}
                className={pageBtn}
              >
                <I.ChevronRight size={14} />
              </button>
              <button
                type="button"
                onClick={() => table.setPageIndex(pageCount - 1)}
                disabled={!table.getCanNextPage()}
                title={t("datagrid.last")}
                className={pageBtn}
              >
                <I.ChevronsRight size={14} />
              </button>
            </div>
          </div>
        </div>
      )}
      {onPasteApply && (
        <PasteGridModal
          open={pasteOpen}
          onClose={() => setPasteOpen(false)}
          columns={table.getAllLeafColumns().map((c) => ({
            name: c.id,
            label: typeof c.columnDef.header === "string" ? c.columnDef.header : c.id,
          }))}
          rows={data as unknown as Record<string, unknown>[]}
          onApply={onPasteApply}
          onCreate={onPasteCreate}
          createDefaults={pasteCreateDefaults}
        />
      )}
    </div>
  );
}
