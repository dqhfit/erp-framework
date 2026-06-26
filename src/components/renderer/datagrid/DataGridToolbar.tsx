/* Thanh công cụ DataGrid: search + nhóm cột (group picker) + chọn cột (column
   chooser) + xuất (export menu) + overflow responsive + toggle lọc-cột/chọn-dòng/
   maximize/viewMode. Tách từ DataGrid.tsx (Phase D3) — di chuyển verbatim khối JSX
   toolbar; ĐÓNG GÓI state/ref/effect/derived CHỈ-của-toolbar vào đây, nhận state
   dùng-chung qua prop. KHÔNG đổi hành vi. Luôn được mount (return null khi !toolbar)
   để hook chạy y như khi còn nằm trong DataGrid. */
import type {
  ColumnOrderState,
  ExpandedState,
  GroupingState,
  SortingState,
  Table,
} from "@tanstack/react-table";
import { type Dispatch, type SetStateAction, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { I } from "@/components/Icons";
import {
  exportRowsCsv,
  exportRowsXlsx,
  type GridColMeta,
} from "@/components/renderer/datagrid/grid-utils";
import type { DataGridProps, ServerPagingController } from "@/components/renderer/datagrid/types";
import { Input } from "@/components/ui";
import { useDropdownPosition } from "@/hooks/useDropdownPosition";
import { useT } from "@/hooks/useT";
import { cn } from "@/lib/utils";

type ToolbarProps<T> = Pick<
  DataGridProps<T>,
  "label" | "data" | "enableSelection" | "onPasteApply" | "onAddRow" | "onExportAll"
> & {
  toolbar: boolean;
  table: Table<T>;
  serverMode: boolean;
  totalCount: number;
  filteredCount: number;
  globalFilter: string;
  setGlobalFilter: (v: string | ((cur: string) => string)) => void;
  filterRowOpen: boolean;
  setFilterRowOpen: Dispatch<SetStateAction<boolean>>;
  showSelectCol: boolean;
  setShowSelectCol: Dispatch<SetStateAction<boolean>>;
  maximized: boolean;
  setMaximized: Dispatch<SetStateAction<boolean>>;
  viewMode: "grid" | "card";
  setViewMode: Dispatch<SetStateAction<"grid" | "card">>;
  setPasteOpen: Dispatch<SetStateAction<boolean>>;
  autofitAll: () => void;
  selectedCount: number;
  someSelected: boolean;
  clearSelection: () => void;
  grouping: GroupingState;
  setGrouping: Dispatch<SetStateAction<GroupingState>>;
  sorting: SortingState;
  setSorting: Dispatch<SetStateAction<SortingState>>;
  setColumnOrder: Dispatch<SetStateAction<ColumnOrderState>>;
  dragColId: string | null;
  setDragColId: Dispatch<SetStateAction<string | null>>;
  setExpanded: Dispatch<SetStateAction<ExpandedState>>;
  server?: ServerPagingController;
  showGroupSummary: boolean;
  setShowGroupSummary: Dispatch<SetStateAction<boolean>>;
  hasSummaryCols: boolean;
};

export function DataGridToolbar<T>({
  toolbar,
  table,
  label,
  data,
  enableSelection,
  onPasteApply,
  onAddRow,
  onExportAll,
  serverMode,
  totalCount,
  filteredCount,
  globalFilter,
  setGlobalFilter,
  filterRowOpen,
  setFilterRowOpen,
  showSelectCol,
  setShowSelectCol,
  maximized,
  setMaximized,
  viewMode,
  setViewMode,
  setPasteOpen,
  autofitAll,
  selectedCount,
  someSelected,
  clearSelection,
  grouping,
  setGrouping,
  sorting,
  setSorting,
  setColumnOrder,
  dragColId,
  setDragColId,
  setExpanded,
  server,
  showGroupSummary,
  setShowGroupSummary,
  hasSummaryCols,
}: ToolbarProps<T>) {
  const t = useT();
  const selecting = !!enableSelection && showSelectCol;
  // ── State + ref CHỈ-của-toolbar (đóng gói trong component) ──
  const [dragSortId, setDragSortId] = useState<string | null>(null);
  const [dragGroupId, setDragGroupId] = useState<string | null>(null);
  const [groupPickerOpen, setGroupPickerOpen] = useState(false);
  const groupPickerRef = useRef<HTMLDivElement>(null);
  const [colChooserOpen, setColChooserOpen] = useState(false);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const exportBtnRef = useRef<HTMLDivElement>(null);
  const colChooserRef = useRef<HTMLDivElement>(null);
  const groupDropdownRef = useRef<HTMLDivElement>(null);
  const colDropdownRef = useRef<HTMLDivElement>(null);
  const exportDropdownRef = useRef<HTMLDivElement>(null);
  const toolbarBorderRef = useRef<HTMLDivElement>(null);
  const [overflowOpen, setOverflowOpen] = useState(false);
  const overflowBtnRef = useRef<HTMLDivElement>(null);
  const [toolbarNarrow, setToolbarNarrow] = useState(false);
  // Toạ độ (fixed) bám đáy nút nhóm/sắp xếp để menu xổ ra ĐÚNG vị trí nút.
  const groupPos = useDropdownPosition(groupPickerRef, groupPickerOpen);

  // Desktop (chuột): hover vào nút có menu → xổ menu luôn (touch giữ click).
  // Đóng có grace 180ms để rê chuột từ nút sang menu (có khoảng hở) không bị đóng.
  const canHover =
    typeof window !== "undefined" &&
    !!window.matchMedia?.("(hover: hover) and (pointer: fine)").matches;
  const hoverCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelHoverClose = () => {
    if (hoverCloseTimer.current) clearTimeout(hoverCloseTimer.current);
  };
  const hoverOpen = (which: "group" | "col" | "export") => {
    if (!canHover) return;
    cancelHoverClose();
    setGroupPickerOpen(which === "group");
    setColChooserOpen(which === "col");
    setExportMenuOpen(which === "export");
  };
  const hoverScheduleClose = () => {
    if (!canHover) return;
    cancelHoverClose();
    hoverCloseTimer.current = setTimeout(() => {
      setGroupPickerOpen(false);
      setColChooserOpen(false);
      setExportMenuOpen(false);
    }, 180);
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: chỉ dọn timer khi unmount
  useEffect(() => () => cancelHoverClose(), []);

  // Tab cho menu Nhóm/Sắp xếp — mặc định "Nhóm theo".
  const [groupTab, setGroupTab] = useState<"nhom" | "sapxep" | "chon">("nhom");
  const groupTabs = (
    [
      serverMode ? null : { key: "nhom" as const, label: "Nhóm theo" },
      { key: "sapxep" as const, label: "Sắp xếp" },
      enableSelection ? { key: "chon" as const, label: "Chọn dòng" } : null,
    ] as ({ key: "nhom" | "sapxep" | "chon"; label: string } | null)[]
  ).filter((x): x is { key: "nhom" | "sapxep" | "chon"; label: string } => x !== null);
  const activeGroupTab = groupTabs.some((tb) => tb.key === groupTab)
    ? groupTab
    : (groupTabs[0]?.key ?? "sapxep");

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

  // biome-ignore lint/correctness/useExhaustiveDependencies: toolbar ref stable
  useEffect(() => {
    const el = toolbarBorderRef.current;
    if (!el || !toolbar) return;
    const obs = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w !== undefined) setToolbarNarrow(w < 380);
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, [toolbar]);

  useEffect(() => {
    if (!overflowOpen) return;
    const handler = (e: MouseEvent) => {
      if (!overflowBtnRef.current?.contains(e.target as Node)) setOverflowOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [overflowOpen]);

  // ── Derived CHỈ-của-toolbar (tính lại từ table) ──
  const sortableColumns = table
    .getAllColumns()
    .filter((c) => c.getCanGroup() && c.id !== "__expand__");
  const allSortableCols = table
    .getAllLeafColumns()
    .filter((c) => c.getCanSort() && !["__expand__", "__select__", "__rowacts__"].includes(c.id));
  const activeFilterCount = table.getState().columnFilters.length;
  const leafCols = table
    .getVisibleLeafColumns()
    .filter((c) => c.id !== "__expand__" && c.id !== "__select__");
  const exportCols = leafCols.map((c) => ({
    id: c.id,
    header: c.columnDef.header?.toString() ?? c.id,
  }));

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

  if (!toolbar) return null;
  return (
    <div ref={toolbarBorderRef} className="border-b border-border bg-panel-2/40 shrink-0">
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

        {toolbarNarrow ? (
          /* NARROW: nút ⋯ mở popover tất cả hành động */
          <div ref={overflowBtnRef} className="relative shrink-0">
            <button
              type="button"
              onClick={() => setOverflowOpen((v) => !v)}
              className={cn(
                "inline-flex items-center px-1.5 h-6 rounded border text-xs transition-colors",
                overflowOpen
                  ? "border-accent/60 text-accent bg-accent/10"
                  : "border-border text-muted hover:text-text hover:border-border",
              )}
              title="Công cụ"
            >
              <I.MoreHorizontal size={14} />
            </button>
            {overflowOpen && (
              <div className="absolute top-full right-0 mt-1 z-50 min-w-[190px] bg-panel border border-border rounded-md shadow-lg py-1">
                <button
                  type="button"
                  onClick={() => {
                    setFilterRowOpen((v) => !v);
                    setOverflowOpen(false);
                  }}
                  className={cn(
                    "w-full flex items-center gap-2 px-3 py-1.5 text-xs transition-colors",
                    filterRowOpen || activeFilterCount > 0
                      ? "text-accent bg-accent/10"
                      : "text-text hover:bg-hover",
                  )}
                >
                  <I.Filter size={12} />
                  {activeFilterCount > 0 ? `Lọc cột (${activeFilterCount})` : "Lọc cột"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setGroupPickerOpen((v) => !v);
                    setOverflowOpen(false);
                  }}
                  className={cn(
                    "w-full flex items-center gap-2 px-3 py-1.5 text-xs transition-colors",
                    grouping.length > 0 || sorting.length > 0 || showSelectCol
                      ? "text-accent bg-accent/10"
                      : "text-text hover:bg-hover",
                  )}
                >
                  <I.Layers size={12} />
                  Nhóm · Sắp xếp · Chọn dòng
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setViewMode((v) => (v === "grid" ? "card" : "grid"));
                    setOverflowOpen(false);
                  }}
                  className={cn(
                    "w-full flex items-center gap-2 px-3 py-1.5 text-xs transition-colors",
                    viewMode === "card" ? "text-accent bg-accent/10" : "text-text hover:bg-hover",
                  )}
                >
                  {viewMode === "grid" ? <I.Layout size={12} /> : <I.Table size={12} />}
                  {viewMode === "grid" ? "Dạng card" : "Dạng lưới"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMaximized((m) => !m);
                    setOverflowOpen(false);
                  }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-text hover:bg-hover transition-colors"
                >
                  {maximized ? <I.X size={12} /> : <I.Maximize size={11} />}
                  {maximized ? "Thu nhỏ" : "Phóng to toàn màn hình"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    autofitAll();
                    setOverflowOpen(false);
                  }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-text hover:bg-hover transition-colors"
                >
                  <I.Wand size={11} />
                  Tự co cột vừa nội dung
                </button>
                {onPasteApply && (
                  <button
                    type="button"
                    onClick={() => {
                      setPasteOpen(true);
                      setOverflowOpen(false);
                    }}
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-text hover:bg-hover transition-colors"
                  >
                    <I.ClipboardList size={11} />
                    Dán dữ liệu (từ Excel)
                  </button>
                )}
                {onAddRow && (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        onAddRow("top");
                        setOverflowOpen(false);
                      }}
                      className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-text hover:bg-hover transition-colors"
                    >
                      <I.Plus size={11} />
                      <I.ChevronUp size={10} />
                      Thêm dòng lên ĐẦU
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        onAddRow("bottom");
                        setOverflowOpen(false);
                      }}
                      className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-text hover:bg-hover transition-colors"
                    >
                      <I.Plus size={11} />
                      <I.ChevronDown size={10} />
                      Thêm dòng xuống CUỐI
                    </button>
                  </>
                )}
                <div className="h-px bg-border mx-2 my-1" />
                <button
                  type="button"
                  onClick={() => {
                    setColChooserOpen((v) => !v);
                    setOverflowOpen(false);
                  }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-text hover:bg-hover transition-colors"
                >
                  <I.Table size={11} />
                  {t("datagrid.columns")}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void doExport("xlsx");
                    setOverflowOpen(false);
                  }}
                  disabled={exporting}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-text hover:bg-hover transition-colors disabled:opacity-50"
                >
                  {exporting ? (
                    <I.Loader size={12} className="animate-spin" />
                  ) : (
                    <I.FileSpreadsheet size={12} className="text-success" />
                  )}
                  Xuất Excel (.xlsx)
                  {onExportAll && <span className="ml-auto text-muted/60">toàn bộ</span>}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void doExport("csv");
                    setOverflowOpen(false);
                  }}
                  disabled={exporting}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-text hover:bg-hover transition-colors disabled:opacity-50"
                >
                  {exporting ? (
                    <I.Loader size={12} className="animate-spin" />
                  ) : (
                    <I.FileText size={12} />
                  )}
                  Xuất CSV
                </button>
              </div>
            )}
          </div>
        ) : (
          /* WIDE: dải nút cuộn ngang khi chật */
          <div className="overflow-x-auto min-w-0">
            <div className="flex items-center gap-1">
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
              <div
                ref={groupPickerRef}
                onMouseEnter={() => hoverOpen("group")}
                onMouseLeave={hoverScheduleClose}
              >
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
              <button
                type="button"
                onClick={() => setMaximized((m) => !m)}
                title={maximized ? "Thu nhỏ (Esc)" : "Phóng to toàn màn hình"}
                className="inline-flex items-center justify-center px-1.5 h-6 rounded text-xs border border-border text-muted hover:text-text hover:border-border transition-colors shrink-0"
              >
                {maximized ? <I.X size={12} /> : <I.Maximize size={11} />}
              </button>
              <button
                type="button"
                onClick={autofitAll}
                title="Tự co tất cả cột vừa nội dung (hoặc nhắp đúp viền từng cột)"
                className="inline-flex items-center justify-center w-6 h-6 rounded text-xs border border-border text-muted hover:text-text hover:border-border transition-colors"
              >
                <I.Wand size={11} />
              </button>
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
              <div
                ref={colChooserRef}
                onMouseEnter={() => hoverOpen("col")}
                onMouseLeave={hoverScheduleClose}
              >
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
              <div
                ref={exportBtnRef}
                onMouseEnter={() => hoverOpen("export")}
                onMouseLeave={hoverScheduleClose}
              >
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
          </div>
        )}

        {/* Group/sort/select dropdown — portal + fixed bám đáy nút (tránh bị cắt
            bởi overflow-x-auto của hàng nút + nằm đúng vị trí nút bấm). */}
        {groupPickerOpen &&
          groupPos &&
          createPortal(
            <div
              ref={groupDropdownRef}
              onMouseEnter={cancelHoverClose}
              onMouseLeave={hoverScheduleClose}
              style={{
                position: "fixed",
                top: groupPos.top !== undefined ? groupPos.top : "auto",
                bottom: groupPos.bottom !== undefined ? groupPos.bottom : "auto",
                left: groupPos.left,
              }}
              className="z-50 bg-panel border border-border rounded shadow-lg min-w-[200px] py-1 max-h-[70vh] overflow-y-auto"
            >
              {/* Tab bar — mặc định "Nhóm theo" */}
              <div className="flex border-b border-border mb-1">
                {groupTabs.map((tb) => (
                  <button
                    key={tb.key}
                    type="button"
                    onClick={() => setGroupTab(tb.key)}
                    className={cn(
                      "flex-1 whitespace-nowrap border-b-2 -mb-px px-2 py-1.5 text-xs font-medium transition-colors",
                      activeGroupTab === tb.key
                        ? "border-accent text-accent"
                        : "border-transparent text-muted hover:text-text",
                    )}
                  >
                    {tb.label}
                  </button>
                ))}
              </div>

              {/* ── Tab: Sắp xếp ── */}
              {activeGroupTab === "sapxep" && (
                <>
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
                </>
              )}

              {/* ── Tab: Nhóm theo ── */}
              {activeGroupTab === "nhom" && (
                <>
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

              {/* ── Tab: Chọn dòng ── */}
              {activeGroupTab === "chon" && enableSelection && (
                <>
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

              {/* ── Thống kê theo nhóm (nằm trong tab Nhóm theo) ── */}
              {activeGroupTab === "nhom" && hasSummaryCols && (
                <>
                  <div className="border-t border-border my-1" />
                  <button
                    type="button"
                    onClick={() => setShowGroupSummary((v) => !v)}
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-hover/40 transition-colors"
                  >
                    <div
                      className={cn(
                        "w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0",
                        showGroupSummary ? "bg-accent border-accent" : "border-border",
                      )}
                    >
                      {showGroupSummary && <I.Check size={9} className="text-white" />}
                    </div>
                    <span className={showGroupSummary ? "text-text" : "text-muted"}>
                      Thống kê nhóm (tổng theo cột)
                    </span>
                  </button>
                </>
              )}
            </div>,
            document.body,
          )}

        {/* Col chooser dropdown — ngoài overflow-x-auto */}
        {colChooserOpen && (
          <div
            ref={colDropdownRef}
            onMouseEnter={cancelHoverClose}
            onMouseLeave={hoverScheduleClose}
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
            onMouseEnter={cancelHoverClose}
            onMouseLeave={hoverScheduleClose}
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
  );
}
