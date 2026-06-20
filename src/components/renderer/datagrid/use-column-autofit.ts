/* Hook autofit cột cho DataGrid: đo bề rộng nội dung từng cột (Range API) →
   ghi columnSizing (persist), + autofit-on-load 1 lần khi chưa có size lưu.
   Tách từ DataGrid.tsx (Phase D2) — chỉ di chuyển code, KHÔNG đổi hành vi.
   Cụm liền mạch (3 useCallback + 1 useEffect) nên thứ tự hook giữ nguyên khi gọi
   đúng vị trí cũ. */
import type { ColumnSizingState, Table } from "@tanstack/react-table";
import {
  type Dispatch,
  type RefObject,
  type SetStateAction,
  useCallback,
  useEffect,
  useRef,
} from "react";
import {
  COMPACT_CLAMP,
  clampColW,
  type GridColMeta,
} from "@/components/renderer/datagrid/grid-utils";

export function useColumnAutofit<T>({
  table,
  scrollRef,
  setColumnSizing,
  restoreSettled,
  data,
  columnSizing,
}: {
  table: Table<T>;
  scrollRef: RefObject<HTMLDivElement | null>;
  setColumnSizing: Dispatch<SetStateAction<ColumnSizingState>>;
  restoreSettled: boolean;
  data: T[];
  columnSizing: ColumnSizingState;
}): { autofitColumn: (colId: string) => void; autofitAll: () => void } {
  const autofitDoneRef = useRef(false);
  const measureCol = useCallback(
    (colId: string): number | null => {
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
    },
    [scrollRef],
  );
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
    [measureCol, table, setColumnSizing],
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
  }, [measureCol, table, scrollRef, setColumnSizing]);

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

  return { autofitColumn, autofitAll };
}
