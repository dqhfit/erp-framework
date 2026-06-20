/* Hook persist trạng thái lưới DataGrid xuống IDB theo stateKey: restore 1 lần
   khi mount + debounce save khi sort/filter/group/size/order/pinning đổi. Tách từ
   DataGrid.tsx (Phase D2) — chỉ di chuyển code, KHÔNG đổi hành vi. Cụm liền mạch
   (restoredRef + effect restore + saveTimer + effect save) nên thứ tự hook giữ
   nguyên khi gọi đúng vị trí cũ. */
import type {
  ColumnFiltersState,
  ColumnOrderState,
  ColumnPinningState,
  ColumnSizingState,
  GroupingState,
  SortingState,
  VisibilityState,
} from "@tanstack/react-table";
import { type Dispatch, type SetStateAction, useEffect, useRef } from "react";
import type { SavedGridState } from "@/components/renderer/datagrid/grid-utils";
import { idbGet, idbSet } from "@/lib/page-state-idb";

export function useGridPersistence({
  stateKey,
  state,
  apply,
}: {
  stateKey: string | undefined;
  state: {
    sorting: SortingState;
    globalFilter: string;
    grouping: GroupingState;
    columnFilters: ColumnFiltersState;
    columnVisibility: VisibilityState;
    columnSizing: ColumnSizingState;
    columnOrder: ColumnOrderState;
    columnPinning: ColumnPinningState;
  };
  apply: {
    setSorting: Dispatch<SetStateAction<SortingState>>;
    setGlobalFilter: (v: string) => void;
    setGrouping: Dispatch<SetStateAction<GroupingState>>;
    setColumnFilters: Dispatch<SetStateAction<ColumnFiltersState>>;
    setColumnVisibility: Dispatch<SetStateAction<VisibilityState>>;
    setColumnSizing: Dispatch<SetStateAction<ColumnSizingState>>;
    setColumnOrder: Dispatch<SetStateAction<ColumnOrderState>>;
    setColumnPinning: Dispatch<SetStateAction<ColumnPinningState>>;
    setRestoreSettled: Dispatch<SetStateAction<boolean>>;
  };
}): void {
  const {
    sorting,
    globalFilter,
    grouping,
    columnFilters,
    columnVisibility,
    columnSizing,
    columnOrder,
    columnPinning,
  } = state;
  const {
    setSorting,
    setGlobalFilter,
    setGrouping,
    setColumnFilters,
    setColumnVisibility,
    setColumnSizing,
    setColumnOrder,
    setColumnPinning,
    setRestoreSettled,
  } = apply;

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
}
