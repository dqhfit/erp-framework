import {
  type ColumnDef,
  type ColumnFiltersState,
  type ColumnOrderState,
  type ColumnSizingState,
  type ExpandedState,
  flexRender,
  type GroupingState,
  getCoreRowModel,
  getExpandedRowModel,
  getFilteredRowModel,
  getGroupedRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  type PaginationState,
  type Row,
  type SortingState,
  useReactTable,
  type VisibilityState,
} from "@tanstack/react-table";
import { useEffect, useRef, useState } from "react";
import { I } from "@/components/Icons";
import { Chip, Input } from "@/components/ui";
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
}

/** Số dòng/trang mặc định + tuỳ chọn — phân trang client-side để chỉ render
 *  một trang DOM mỗi lần (hiệu năng), không cắt dữ liệu đã tải. */
const DEFAULT_PAGE_SIZE = 50;
const PAGE_SIZE_OPTIONS = [25, 50, 100, 200];

/* ── Summary (footer tổng hợp kiểu DevExpress) ─────────────────── */
export type SummaryType = "sum" | "avg" | "count" | "min" | "max";
/** Meta cột — techName (tên kỹ thuật) + summary (footer) + cellClass
 *  (conditional formatting: trả className theo giá trị ô, vd âm→đỏ). */
interface GridColMeta {
  techName?: string;
  summary?: SummaryType;
  cellClass?: (value: unknown) => string | undefined;
}

/** Conditional format mặc định (DevExpress hay có): số ÂM → chữ đỏ. Cột set
 *  meta.cellClass riêng thì ưu tiên cái đó. */
function defaultCellClass(value: unknown): string | undefined {
  if (value == null || value === "") return undefined;
  const n = typeof value === "number" ? value : Number(String(value).replace(/[,\s]/g, ""));
  if (!Number.isNaN(n) && n < 0) return "text-danger";
  return undefined;
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

export interface DataGridProps<T> {
  columns: ColumnDef<T, unknown>[];
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
}

export function DataGrid<T>({
  columns,
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
}: DataGridProps<T>) {
  const t = useT();
  const isMobile = useIsMobile();
  const [sorting, setSorting] = useState<SortingState>([]);
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
  const [grouping, setGrouping] = useState<GroupingState>([]);
  const [expanded, setExpanded] = useState<ExpandedState>(true);
  const [filterRowOpen, setFilterRowOpen] = useState(false);
  const [groupPickerOpen, setGroupPickerOpen] = useState(false);
  const groupPickerRef = useRef<HTMLDivElement>(null);
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const [colChooserOpen, setColChooserOpen] = useState(false);
  const colChooserRef = useRef<HTMLDivElement>(null);
  const [columnSizing, setColumnSizing] = useState<ColumnSizingState>({});
  const [columnOrder, setColumnOrder] = useState<ColumnOrderState>([]);
  const [dragColId, setDragColId] = useState<string | null>(null);

  // Restore state from IDB once on mount
  const restoredRef = useRef(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: chỉ restore 1 lần khi mount theo stateKey, các setter ổn định không cần liệt kê
  useEffect(() => {
    if (!stateKey || restoredRef.current) return;
    restoredRef.current = true;
    idbGet<SavedGridState>(stateKey).then((saved) => {
      if (!saved) return;
      if (saved.sorting?.length) setSorting(saved.sorting);
      if (saved.globalFilter) setGlobalFilter(saved.globalFilter);
      if (saved.grouping?.length) setGrouping(saved.grouping);
      if (saved.columnFilters?.length) setColumnFilters(saved.columnFilters);
      if (saved.columnVisibility) setColumnVisibility(saved.columnVisibility);
      if (saved.columnSizing) setColumnSizing(saved.columnSizing);
      if (saved.columnOrder?.length) setColumnOrder(saved.columnOrder);
    });
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
  ]);

  // Close group picker on outside click
  useEffect(() => {
    if (!groupPickerOpen) return;
    const handler = (e: MouseEvent) => {
      if (groupPickerRef.current && !groupPickerRef.current.contains(e.target as Node)) {
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
      if (colChooserRef.current && !colChooserRef.current.contains(e.target as Node)) {
        setColChooserOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [colChooserOpen]);

  const table = useReactTable({
    data,
    columns,
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
    },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    onColumnFiltersChange: setColumnFilters,
    onGroupingChange: setGrouping,
    onExpandedChange: setExpanded,
    onPaginationChange: setPagination,
    onColumnVisibilityChange: setColumnVisibility,
    onColumnSizingChange: setColumnSizing,
    onColumnOrderChange: setColumnOrder,
    enableColumnResizing: true,
    columnResizeMode: "onChange",
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getGroupedRowModel: getGroupedRowModel(),
    getExpandedRowModel: getExpandedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    globalFilterFn: "includesString",
    enableMultiSort: true,
    isMultiSortEvent: (e) => (e as MouseEvent).ctrlKey || (e as MouseEvent).metaKey,
    groupedColumnMode: false,
    // ListWidget tạo mảng `data` mới mỗi render khi filter/search client-side →
    // auto-reset theo identity sẽ nhảy trang liên tục. Tự reset theo NỘI DUNG
    // (filter/độ dài/grouping) ở effect bên dưới thay vì theo tham chiếu mảng.
    autoResetPageIndex: false,
  });

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
  // biome-ignore lint/correctness/useExhaustiveDependencies: chủ đích bám khoá nội dung, không bám object filter.
  useEffect(() => {
    setPagination((p) => (p.pageIndex === 0 ? p : { ...p, pageIndex: 0 }));
  }, [globalFilter, colFiltersKey, groupingKey, data.length]);

  const sortableColumns = table
    .getAllColumns()
    .filter((c) => c.getCanGroup() && c.id !== "__expand__");
  const availableGroupCols = sortableColumns.filter((c) => !grouping.includes(c.id));
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
  // Summary footer (DevExpress-style): cột set meta.summary → kiểu đó; cột số
  // không set → auto "sum". Có ≥1 cột summary mới hiện footer.
  const summaryByCol = new Map<string, { type: SummaryType; value: number }>();
  for (const col of leafCols) {
    const metaSummary = (col.columnDef.meta as GridColMeta | undefined)?.summary;
    const type: SummaryType | null =
      metaSummary ?? (isNumericColumn(filteredRows, col.id) ? "sum" : null);
    if (type) summaryByCol.set(col.id, { type, value: computeSummary(filteredRows, col.id, type) });
  }
  const showSummary = filteredCount > 0 && summaryByCol.size > 0;

  // Phân trang (client-side) — chỉ render 1 trang DOM mỗi lần.
  const pageCount = table.getPageCount();
  const rangeFrom = filteredCount === 0 ? 0 : pagination.pageIndex * pagination.pageSize + 1;
  const rangeTo = Math.min(filteredCount, (pagination.pageIndex + 1) * pagination.pageSize);
  const pageBtn =
    "p-1 rounded text-muted hover:bg-hover/40 disabled:opacity-30 disabled:hover:bg-transparent";

  return (
    <div className={cn("flex flex-col h-full", className)}>
      {toolbar && (
        <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-border bg-panel-2/40 shrink-0 flex-wrap">
          {label && <span className="text-xs font-semibold text-muted mr-1 shrink-0">{label}</span>}

          {/* Global search */}
          <div className="relative flex-1 min-w-[140px] max-w-full sm:max-w-[260px]">
            <I.Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted" />
            <Input
              placeholder={t("datagrid.search_placeholder")}
              value={globalFilter}
              onChange={(e) => setGlobalFilter(e.target.value)}
              className="pl-6 pr-6 h-7 text-xs"
            />
            {globalFilter && (
              <button
                type="button"
                onClick={() => setGlobalFilter("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-text"
              >
                <I.X size={11} />
              </button>
            )}
          </div>

          {/* Column filter toggle */}
          <button
            type="button"
            onClick={() => setFilterRowOpen((v) => !v)}
            className={cn(
              "inline-flex items-center gap-1 px-2 h-7 rounded text-xs border transition-colors",
              filterRowOpen || activeFilterCount > 0
                ? "border-primary/60 text-primary bg-primary/10"
                : "border-border text-muted hover:text-text hover:border-border",
            )}
          >
            <I.Filter size={11} />
            {activeFilterCount > 0 && <span>{activeFilterCount}</span>}
          </button>

          {/* Grouping chips + picker */}
          {grouping.length > 0 && (
            <div className="inline-flex items-center gap-1 flex-wrap">
              {grouping.map((colId) => (
                <span
                  key={colId}
                  className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-primary/15 text-primary text-xs"
                >
                  <I.Layers size={10} />
                  {table.getColumn(colId)?.columnDef.header?.toString() ?? colId}
                  <button
                    type="button"
                    onClick={() => setGrouping((prev) => prev.filter((g) => g !== colId))}
                    className="ml-0.5 hover:text-danger"
                  >
                    <I.X size={10} />
                  </button>
                </span>
              ))}
            </div>
          )}

          <div className="relative" ref={groupPickerRef}>
            <button
              type="button"
              onClick={() => setGroupPickerOpen((v) => !v)}
              className="inline-flex items-center gap-1 px-2 h-7 rounded text-xs border border-border text-muted hover:text-text hover:border-border transition-colors"
            >
              <I.Layers size={11} />
              {t("datagrid.group_btn")}
              <I.ChevronDown size={10} />
            </button>
            {groupPickerOpen && (
              <div className="absolute top-full left-0 mt-1 z-50 bg-panel border border-border rounded shadow-lg min-w-[160px] py-1">
                {availableGroupCols.length === 0 ? (
                  <div className="px-3 py-1.5 text-xs text-muted">
                    {t("datagrid.group_all_grouped")}
                  </div>
                ) : (
                  availableGroupCols.map((col) => (
                    <button
                      key={col.id}
                      type="button"
                      onClick={() => {
                        setGrouping((prev) => [...prev, col.id]);
                        setExpanded(true);
                        setGroupPickerOpen(false);
                      }}
                      className="w-full text-left px-3 py-1.5 text-xs hover:bg-hover/40 transition-colors"
                    >
                      {col.columnDef.header?.toString() ?? col.id}
                    </button>
                  ))
                )}
                {grouping.length > 0 && (
                  <>
                    <div className="border-t border-border my-1" />
                    <button
                      type="button"
                      onClick={() => {
                        setGrouping([]);
                        setGroupPickerOpen(false);
                      }}
                      className="w-full text-left px-3 py-1.5 text-xs text-danger hover:bg-hover/40 transition-colors"
                    >
                      {t("datagrid.group_clear")}
                    </button>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Column chooser (ẩn/hiện cột) */}
          <div className="relative ml-auto" ref={colChooserRef}>
            <button
              type="button"
              onClick={() => setColChooserOpen((v) => !v)}
              title={t("datagrid.columns")}
              className="inline-flex items-center gap-1 px-2 h-7 rounded text-xs border border-border text-muted hover:text-text hover:border-border transition-colors"
            >
              <I.Table size={11} />
              <I.ChevronDown size={10} />
            </button>
            {colChooserOpen && (
              <div className="absolute top-full right-0 mt-1 z-50 bg-panel border border-border rounded shadow-lg min-w-[180px] max-h-[320px] overflow-auto py-1">
                {table
                  .getAllLeafColumns()
                  .filter((c) => c.id !== "__expand__" && c.id !== "__select__")
                  .map((col) => (
                    <label
                      key={col.id}
                      className="flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-hover/40 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={col.getIsVisible()}
                        onChange={col.getToggleVisibilityHandler()}
                        disabled={!col.getCanHide()}
                      />
                      <span className="truncate">{col.columnDef.header?.toString() ?? col.id}</span>
                    </label>
                  ))}
              </div>
            )}
          </div>

          {/* Export CSV (Excel) — cột đang hiện + dòng đã lọc/sắp */}
          <button
            type="button"
            onClick={() =>
              exportRowsCsv(
                exportCols,
                table.getSortedRowModel().rows.filter((r) => !r.getIsGrouped()),
                label || "export",
              )
            }
            title={t("datagrid.export")}
            className="inline-flex items-center gap-1 px-2 h-7 rounded text-xs border border-border text-muted hover:text-text hover:border-border transition-colors"
          >
            <I.Download size={11} />
          </button>

          <Chip className="shrink-0 text-xs">
            {t("datagrid.row_count", { filtered: filteredCount, total: data.length })}
          </Chip>
        </div>
      )}

      {isMobile ? (
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
                    "rounded-md border p-2.5 space-y-1 transition-colors",
                    clickable && "cursor-pointer",
                    selected
                      ? "bg-accent/10 border-accent ring-1 ring-accent"
                      : "border-border bg-panel hover:bg-hover/20",
                  )}
                >
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
        <div className="flex-1 overflow-auto">
          <table className="w-full border-collapse text-sm">
            <thead className="sticky top-0 bg-panel-2 z-10">
              {table.getHeaderGroups().map((hg) => (
                <tr key={hg.id} className="border-b border-border">
                  {hg.headers.map((header) => {
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
                        draggable={!header.column.getIsGrouped()}
                        onDragStart={() => setDragColId(header.column.id)}
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
                        style={{ width: header.getSize() }}
                        className={cn(
                          "relative text-left px-3 py-2 font-semibold text-xs uppercase tracking-wide text-muted whitespace-nowrap",
                          dragColId === header.column.id && "opacity-40",
                        )}
                      >
                        <span
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
                        {/* Resize handle (kéo viền phải đổi rộng cột) */}
                        {header.column.getCanResize() && (
                          <button
                            type="button"
                            aria-label="Kéo đổi rộng cột"
                            onMouseDown={header.getResizeHandler()}
                            onTouchStart={header.getResizeHandler()}
                            onClick={(e) => e.stopPropagation()}
                            className={cn(
                              "absolute right-0 top-0 h-full w-1.5 cursor-col-resize select-none touch-none hover:bg-accent/50",
                              header.column.getIsResizing() && "bg-accent",
                            )}
                          />
                        )}
                      </th>
                    );
                  })}
                </tr>
              ))}
              {/* Column filter row */}
              {filterRowOpen && (
                <tr className="border-b border-border bg-panel-2/60">
                  {table.getHeaderGroups()[0]?.headers.map((header) => (
                    <th key={header.id} className="px-1.5 py-1">
                      {header.column.getCanFilter() ? (
                        <Input
                          placeholder={t("datagrid.col_filter_placeholder")}
                          value={(header.column.getFilterValue() as string) ?? ""}
                          onChange={(e) =>
                            header.column.setFilterValue(e.target.value || undefined)
                          }
                          className="h-6 text-xs px-2 font-normal"
                        />
                      ) : null}
                    </th>
                  ))}
                </tr>
              )}
            </thead>
            <tbody>
              {table.getRowModel().rows.length === 0 ? (
                <tr>
                  <td colSpan={columns.length} className="text-center py-8 text-muted text-sm">
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
                        <td colSpan={columns.length} className="px-3 py-1.5">
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
                  return (
                    <tr
                      key={row.id}
                      className={[
                        "border-b border-border transition-colors",
                        clickable ? "cursor-pointer" : "",
                        selected ? "bg-accent/10 ring-1 ring-accent" : "hover:bg-hover/30",
                      ].join(" ")}
                      onClick={clickable ? () => onRowClick(row.original) : undefined}
                    >
                      {row.getVisibleCells().map((cell) => {
                        if (cell.getIsPlaceholder()) return <td key={cell.id} />;
                        // Conditional formatting: meta.cellClass riêng, else mặc
                        // định (số âm → đỏ).
                        const cm = cell.column.columnDef.meta as GridColMeta | undefined;
                        const ccls = cm?.cellClass
                          ? cm.cellClass(cell.getValue())
                          : defaultCellClass(cell.getValue());
                        return (
                          <td
                            key={cell.id}
                            style={{ width: cell.column.getSize() }}
                            className={cn("px-3 py-2 whitespace-nowrap", ccls)}
                          >
                            {flexRender(cell.column.columnDef.cell, cell.getContext())}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })
              )}
            </tbody>
            {showSummary && (
              <tfoot className="sticky bottom-0 z-10 bg-panel-2 border-t-2 border-border">
                <tr>
                  {table.getVisibleLeafColumns().map((col, idx) => {
                    const s = summaryByCol.get(col.id);
                    return (
                      <td key={col.id} className="px-3 py-1.5 text-xs whitespace-nowrap text-right">
                        {s ? (
                          <span className="font-semibold text-accent">
                            {SUMMARY_LABEL[s.type]} {fmtNum(s.value)}
                          </span>
                        ) : idx === 0 ? (
                          <span className="block text-left text-muted">{filteredCount} dòng</span>
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
        <div className="flex items-center gap-2 px-2 py-1.5 border-t border-border bg-panel-2/40 shrink-0 text-xs text-muted">
          <span>
            {t("datagrid.page_range", { from: rangeFrom, to: rangeTo, total: filteredCount })}
          </span>
          <div className="ml-auto flex items-center gap-1.5">
            <select
              value={pagination.pageSize}
              onChange={(e) => setPagination({ pageIndex: 0, pageSize: Number(e.target.value) })}
              title={t("datagrid.per_page")}
              className="h-7 rounded border border-border bg-panel px-1.5 text-xs"
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
    </div>
  );
}
