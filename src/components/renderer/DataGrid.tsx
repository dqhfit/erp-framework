import {
  type ColumnDef,
  type ColumnFiltersState,
  type ExpandedState,
  flexRender,
  type GroupingState,
  getCoreRowModel,
  getExpandedRowModel,
  getFilteredRowModel,
  getGroupedRowModel,
  getSortedRowModel,
  type SortingState,
  useReactTable,
} from "@tanstack/react-table";
import { useEffect, useRef, useState } from "react";
import { I } from "@/components/Icons";
import { Chip, Input } from "@/components/ui";
import { useT } from "@/hooks/useT";
import { idbGet, idbSet } from "@/lib/page-state-idb";
import { cn } from "@/lib/utils";

interface SavedGridState {
  sorting: SortingState;
  globalFilter: string;
  grouping: GroupingState;
  columnFilters: ColumnFiltersState;
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
}: DataGridProps<T>) {
  const t = useT();
  const [sorting, setSorting] = useState<SortingState>([]);
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

  // Restore state from IDB once on mount
  const restoredRef = useRef(false);
  useEffect(() => {
    if (!stateKey || restoredRef.current) return;
    restoredRef.current = true;
    idbGet<SavedGridState>(stateKey).then((saved) => {
      if (!saved) return;
      if (saved.sorting?.length) setSorting(saved.sorting);
      if (saved.globalFilter) setGlobalFilter(saved.globalFilter);
      if (saved.grouping?.length) setGrouping(saved.grouping);
      if (saved.columnFilters?.length) setColumnFilters(saved.columnFilters);
    });
  }, [stateKey]);

  // Debounce save to IDB on state change
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!stateKey) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void idbSet(stateKey, { sorting, globalFilter, grouping, columnFilters });
    }, 400);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [stateKey, sorting, globalFilter, grouping, columnFilters]);

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

  const table = useReactTable({
    data,
    columns,
    state: { sorting, globalFilter, columnFilters, grouping, expanded },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    onColumnFiltersChange: setColumnFilters,
    onGroupingChange: setGrouping,
    onExpandedChange: setExpanded,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getGroupedRowModel: getGroupedRowModel(),
    getExpandedRowModel: getExpandedRowModel(),
    globalFilterFn: "includesString",
    enableMultiSort: true,
    isMultiSortEvent: (e) => (e as MouseEvent).ctrlKey || (e as MouseEvent).metaKey,
    groupedColumnMode: false,
  });

  const sortableColumns = table
    .getAllColumns()
    .filter((c) => c.getCanGroup() && c.id !== "__expand__");
  const availableGroupCols = sortableColumns.filter((c) => !grouping.includes(c.id));
  const activeFilterCount = columnFilters.length;
  const filteredCount = table.getFilteredRowModel().rows.length;

  return (
    <div className={cn("flex flex-col h-full", className)}>
      {toolbar && (
        <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-border bg-panel-2/40 shrink-0 flex-wrap">
          {label && <span className="text-xs font-semibold text-muted mr-1 shrink-0">{label}</span>}

          {/* Global search */}
          <div className="relative flex-1 min-w-[140px] max-w-[260px]">
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

          <Chip className="ml-auto shrink-0 text-xs">
            {t("datagrid.row_count", { filtered: filteredCount, total: data.length })}
          </Chip>
        </div>
      )}

      <div className="flex-1 overflow-auto">
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 bg-panel-2 z-10">
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id} className="border-b border-border">
                {hg.headers.map((header) => {
                  const sorted = header.column.getIsSorted();
                  const sortIndex = header.column.getSortIndex();
                  return (
                    <th
                      key={header.id}
                      onClick={
                        header.column.getCanSort()
                          ? header.column.getToggleSortingHandler()
                          : undefined
                      }
                      className={cn(
                        "text-left px-3 py-2 font-semibold text-xs uppercase tracking-wide text-muted whitespace-nowrap",
                        header.column.getCanSort() && "cursor-pointer hover:text-text select-none",
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
                        onChange={(e) => header.column.setFilterValue(e.target.value || undefined)}
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
                      return (
                        <td key={cell.id} className="px-3 py-2 whitespace-nowrap">
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </td>
                      );
                    })}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
