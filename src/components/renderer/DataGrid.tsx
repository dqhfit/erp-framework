import {
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
  type RowSelectionState,
  type SortingState,
  useReactTable,
  type VisibilityState,
} from "@tanstack/react-table";
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { I } from "@/components/Icons";
import { DataGridToolbar } from "@/components/renderer/datagrid/DataGridToolbar";
import { FacetFilterInput } from "@/components/renderer/datagrid/FacetFilterInput";
import {
  cellFormatClass,
  computeSummary,
  DEFAULT_PAGE_SIZE,
  exportRowsCsv,
  fmtNum,
  type GridColMeta,
  groupColumns,
  headerStickyStyle,
  isNumericColumn,
  PAGE_SIZE_OPTIONS,
  pinnedStyle,
  SUMMARY_LABEL,
  type SummaryType,
  sizedWidth,
} from "@/components/renderer/datagrid/grid-utils";
import type {
  DataGridProps,
  ServerGridQuery,
  ServerPagingController,
} from "@/components/renderer/datagrid/types";
import { useColumnAutofit } from "@/components/renderer/datagrid/use-column-autofit";
import { useGridPersistence } from "@/components/renderer/datagrid/use-grid-persistence";
import { PasteGridModal } from "@/components/renderer/PasteGridModal";
import { Chip } from "@/components/ui";
import { useDragScroll } from "@/hooks/useDragScroll";
import { useIsMobile } from "@/hooks/useMediaQuery";
import { useT } from "@/hooks/useT";
import { cn } from "@/lib/utils";

// Re-export type công khai để BandEditor/PageDesigner/ConsumerPage giữ nguyên import.
export type {
  ColumnGroupNode,
  FormatRule,
  SummaryType,
} from "@/components/renderer/datagrid/grid-utils";
// Re-export type props/server-side để consumer giữ nguyên đường import qua DataGrid.
export type { DataGridProps, ServerGridQuery, ServerPagingController };

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
  rowClassName,
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
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({
    created_at: false,
    updated_at: false,
  });
  const [columnSizing, setColumnSizing] = useState<ColumnSizingState>({});
  const [columnOrder, setColumnOrder] = useState<ColumnOrderState>([]);
  const [dragColId, setDragColId] = useState<string | null>(null);
  const [columnPinning, setColumnPinning] = useState<ColumnPinningState>({ left: [], right: [] });
  // Master-detail: id dòng đang mở panel chi tiết.
  const [openDetail, setOpenDetail] = useState<Set<string>>(new Set());
  // Chọn dòng: state TanStack + cờ hiện cột tích + cờ "đã chọn tất cả dòng khớp"
  // (server mode — vượt trang đang tải, biểu diễn bằng cờ thay vì từng id).
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [showSelectCol, setShowSelectCol] = useState(false);
  const [allMatching, setAllMatching] = useState(false);
  // Hiện dòng thống kê theo nhóm (subtotal) trên dòng tiêu đề nhóm khi đang gom.
  const [showGroupSummary, setShowGroupSummary] = useState(true);
  // Container cuộn (để đo nội dung ô khi autofit) + cờ "đã nạp xong state lưu"
  // (chặn autofit-on-load đè kích thước cột người dùng đã lưu).
  const scrollRef = useRef<HTMLDivElement>(null);
  const [restoreSettled, setRestoreSettled] = useState(false);
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

  // Restore (mount) + debounce-save trạng thái lưới xuống IDB theo stateKey.
  useGridPersistence({
    stateKey,
    defaultSort,
    state: {
      sorting,
      globalFilter,
      grouping,
      columnFilters,
      columnVisibility,
      columnSizing,
      columnOrder,
      columnPinning,
    },
    apply: {
      setSorting,
      setGlobalFilter,
      setGrouping,
      setColumnFilters,
      setColumnVisibility,
      setColumnSizing,
      setColumnOrder,
      setColumnPinning,
      setRestoreSettled,
    },
  });

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
  // Đồng thời chèn cột MỚI (chưa có trong saved order) vào đúng vị trí tự nhiên
  // — không để TanStack tự append vào cuối.
  const orderPrunedRef = useRef(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: tableRef stable — không cần trong deps
  useEffect(() => {
    if (!restoreSettled || orderPrunedRef.current) return;
    orderPrunedRef.current = true;
    const allCols = tableRef.current.getAllLeafColumns().map((c) => c.id);
    const validIds = new Set(allCols);
    setColumnOrder((prev) => {
      if (prev.length === 0) return prev;
      const pruned = prev.filter((id) => validIds.has(id));
      const prunedSet = new Set(pruned);
      const missing = allCols.filter((id) => !prunedSet.has(id));
      if (missing.length === 0) return pruned.length === prev.length ? prev : pruned;
      // Chèn từng cột mới vào đúng vị trí: tìm neighbor gần nhất phía trước trong
      // natural order rồi insert ngay sau nó trong merged array.
      const merged = [...pruned];
      for (const id of missing) {
        const nat = allCols.indexOf(id);
        let insertAt = 0;
        for (let i = nat - 1; i >= 0; i--) {
          const p = merged.indexOf(allCols[i]!);
          if (p !== -1) {
            insertAt = p + 1;
            break;
          }
        }
        merged.splice(insertAt, 0, id);
      }
      return merged;
    });
  }, [restoreSettled]);

  // Khi columns thay đổi runtime (vd bật/tắt cột hành động), đảm bảo các cột
  // hệ thống (__xx__) luôn ở đúng vị trí tự nhiên — kể cả khi IDB đã lưu sai vị trí
  // (vd __rowacts__ bị append cuối do bug cũ). Data cols giữ thứ tự user đã kéo.
  const colIds = columns.map((c) => (c as { id?: string }).id ?? "").filter(Boolean);
  const colIdsStr = colIds.join(",");
  // biome-ignore lint/correctness/useExhaustiveDependencies: colIdsStr capture đủ thay đổi colIds
  useEffect(() => {
    if (!restoreSettled) return;
    setColumnOrder((prev) => {
      if (prev.length === 0) return prev;
      // Data cols: giữ thứ tự user + lọc stale, bỏ sys cols
      const dataCols = prev.filter((id) => !id.startsWith("__") && colIds.includes(id));
      // New data cols chưa có trong prev → thêm ở cuối data cols
      const dataSet = new Set(dataCols);
      for (const id of colIds) {
        if (!id.startsWith("__") && !dataSet.has(id)) dataCols.push(id);
      }
      // Chèn sys cols (__xx__) vào đúng vị trí tự nhiên (theo colIds)
      const merged = [...dataCols];
      for (const id of colIds.filter((x) => x.startsWith("__"))) {
        const nat = colIds.indexOf(id);
        let insertAt = 0;
        for (let i = nat - 1; i >= 0; i--) {
          const p = merged.indexOf(colIds[i]!);
          if (p !== -1) {
            insertAt = p + 1;
            break;
          }
        }
        merged.splice(insertAt, 0, id);
      }
      return merged.join(",") === prev.join(",") ? prev : merged;
    });
  }, [colIdsStr, restoreSettled]);

  // ── Autofit cột theo nội dung. table-fixed clip ô nên scrollWidth chỉ đo được
  // khi nội dung TRÀN; dùng Range đo bề rộng NỘI DUNG THẬT (co được cả 2 chiều,
  // kể cả cột hẹp hơn mặc định). +đệm padding ngang ô. ──
  const { autofitColumn, autofitAll } = useColumnAutofit({
    table,
    scrollRef,
    setColumnSizing,
    restoreSettled,
    data,
    columnSizing,
  });

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

  const filteredRows = table.getFilteredRowModel().rows;
  const filteredCount = filteredRows.length;

  // Cột lá đang hiện (bỏ cột điều khiển) — cho summary footer + export dòng đã chọn.
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
  // Cột có thống kê (để render subtotal trên dòng nhóm) — cùng tập với footer,
  // kèm tên cột để hiện inline cạnh nhãn nhóm ("<Cột> Σ <giá trị>").
  const groupSummaryCols = [...summaryByCol].map(([colId, s]) => {
    const cm = table.getColumn(colId)?.columnDef.meta as GridColMeta | undefined;
    const hdr = table.getColumn(colId)?.columnDef.header;
    return { colId, type: s.type, name: cm?.label ?? (typeof hdr === "string" ? hdr : colId) };
  });

  // Phân trang. Server mode: total + range tính theo server.total (data = 1 trang).
  const totalCount = serverMode && server ? server.total : filteredCount;
  const pageCount = table.getPageCount();
  const rangeFrom = totalCount === 0 ? 0 : pagination.pageIndex * pagination.pageSize + 1;
  const rangeTo = Math.min(totalCount, (pagination.pageIndex + 1) * pagination.pageSize);
  const pageBtn =
    "p-0.5 rounded text-muted hover:bg-hover/40 disabled:opacity-30 disabled:hover:bg-transparent";

  return (
    <div
      className={cn(
        "flex flex-col",
        // Phóng to: phủ toàn màn hình, nền đặc, chỉ vùng dòng cuộn bên trong.
        maximized ? "fixed inset-0 z-[800] bg-bg p-2" : "h-full",
        className,
      )}
    >
      {/* Nút thoát phóng to — portal ra body + fixed nên không bị toolbar cắt /
          ancestor transform che; luôn thấy ở góc trên-phải khi đang phóng to. */}
      {maximized &&
        createPortal(
          <button
            type="button"
            onClick={() => setMaximized(false)}
            title="Thoát phóng to (Esc)"
            className="fixed right-3 top-3 z-[810] inline-flex h-8 items-center gap-1 rounded-md border border-border bg-panel px-2.5 text-xs font-medium text-text shadow-lg hover:bg-hover"
          >
            <I.X size={14} /> Thoát phóng to
          </button>,
          document.body,
        )}
      <DataGridToolbar
        toolbar={toolbar}
        table={table}
        label={label}
        data={data}
        enableSelection={enableSelection}
        onPasteApply={onPasteApply}
        onAddRow={onAddRow}
        onExportAll={onExportAll}
        serverMode={serverMode}
        totalCount={totalCount}
        filteredCount={filteredCount}
        globalFilter={globalFilter}
        setGlobalFilter={setGlobalFilter}
        filterRowOpen={filterRowOpen}
        setFilterRowOpen={setFilterRowOpen}
        showSelectCol={showSelectCol}
        setShowSelectCol={setShowSelectCol}
        maximized={maximized}
        setMaximized={setMaximized}
        viewMode={viewMode}
        setViewMode={setViewMode}
        setPasteOpen={setPasteOpen}
        autofitAll={autofitAll}
        selectedCount={selectedCount}
        someSelected={someSelected}
        clearSelection={clearSelection}
        grouping={grouping}
        setGrouping={setGrouping}
        sorting={sorting}
        setSorting={setSorting}
        setColumnOrder={setColumnOrder}
        dragColId={dragColId}
        setDragColId={setDragColId}
        setExpanded={setExpanded}
        server={server}
        showGroupSummary={showGroupSummary}
        setShowGroupSummary={setShowGroupSummary}
        hasSummaryCols={groupSummaryCols.length > 0}
      />
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
                    rowClassName?.(row.original),
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
                          {/* sticky-left: nhãn + thống kê nhóm luôn hiện khi cuộn ngang */}
                          <span
                            style={{ position: "sticky", left: 8 }}
                            className="inline-flex items-center gap-2 text-xs font-semibold text-muted"
                          >
                            {row.getIsExpanded() ? (
                              <I.ChevronDown size={12} />
                            ) : (
                              <I.ChevronRight size={12} />
                            )}
                            <span className="text-text/70">{colHeader}:</span>
                            <span className="text-text">{String(row.groupingValue ?? "—")}</span>
                            <Chip className="ml-1 text-[10px] py-0">{row.subRows.length}</Chip>
                            {showGroupSummary &&
                              groupSummaryCols.map((sc) => (
                                <span
                                  key={sc.colId}
                                  className="ml-1 inline-flex items-center gap-1 font-normal"
                                >
                                  <span className="text-muted/70">{sc.name}</span>
                                  <span className="font-semibold text-accent">
                                    {SUMMARY_LABEL[sc.type]}{" "}
                                    {fmtNum(computeSummary(row.getLeafRows(), sc.colId, sc.type))}
                                  </span>
                                </span>
                              ))}
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
                          rowClassName?.(row.original) ?? "",
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
