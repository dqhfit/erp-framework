import { useState } from "react";
import {
  flexRender, getCoreRowModel, getFilteredRowModel,
  getSortedRowModel, useReactTable,
  type ColumnDef, type SortingState, type ColumnFiltersState,
} from "@tanstack/react-table";
import { I } from "@/components/Icons";
import { Input, Chip } from "@/components/ui";
import { cn } from "@/lib/utils";

export interface DataGridProps<T> {
  columns: ColumnDef<T, unknown>[];
  data: T[];
  emptyText?: string;
  className?: string;
  /** Hiển thị thanh toolbar (search + count). Default: true. */
  toolbar?: boolean;
}

export function DataGrid<T>({
  columns, data,
  emptyText = "Không có dữ liệu.",
  className,
  toolbar = true,
}: DataGridProps<T>) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = useState("");
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);

  const table = useReactTable({
    data,
    columns,
    state: { sorting, globalFilter, columnFilters },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    onColumnFiltersChange: setColumnFilters,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    globalFilterFn: "includesString",
  });

  return (
    <div className={cn("flex flex-col h-full", className)}>
      {toolbar && (
        <div className="flex items-center gap-2 p-2 border-b border-border bg-panel-2/40 shrink-0">
          <div className="relative flex-1 max-w-[300px]">
            <I.Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
            <Input
              placeholder="Tìm kiếm..."
              value={globalFilter}
              onChange={(e) => setGlobalFilter(e.target.value)}
              className="pl-7"
            />
          </div>
          <Chip className="ml-auto">
            {table.getFilteredRowModel().rows.length}/{data.length} dòng
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
                  return (
                    <th
                      key={header.id}
                      onClick={header.column.getCanSort() ? header.column.getToggleSortingHandler() : undefined}
                      className={cn(
                        "text-left px-3 py-2 font-semibold text-xs uppercase tracking-wide text-muted whitespace-nowrap",
                        header.column.getCanSort() && "cursor-pointer hover:text-text select-none",
                      )}
                    >
                      <span className="inline-flex items-center gap-1">
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        {sorted === "asc" && <I.ChevronUp size={11} />}
                        {sorted === "desc" && <I.ChevronDown size={11} />}
                      </span>
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="text-center py-8 text-muted text-sm">
                  {emptyText}
                </td>
              </tr>
            ) : (
              table.getRowModel().rows.map((row) => (
                <tr key={row.id} className="border-b border-border hover:bg-hover/30 transition-colors">
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className="px-3 py-2 whitespace-nowrap">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
