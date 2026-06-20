/* Ô lọc 1 cột (filter row) của DataGrid: input contains + datalist gợi ý giá
   trị phân biệt (faceted) như dropdown lọc DevExpress. Tách từ DataGrid.tsx
   (Phase D1) — chỉ di chuyển code, KHÔNG đổi hành vi. */
import type { Column } from "@tanstack/react-table";

/** Ngưỡng cardinality để dựng datalist gợi ý. Cột có > ngưỡng giá trị phân
 *  biệt (mã/tên...) thì datalist vô dụng + sort mỗi render rất tốn → bỏ qua,
 *  chỉ giữ ô lọc contains. */
const FACET_MAX_DISTINCT = 200;

/** Ô lọc 1 cột (filter row) — input contains + datalist gợi ý giá trị phân
 *  biệt (faceted) như dropdown lọc của DevExpress. Chỉ gợi ý khi cardinality
 *  thấp (≤ FACET_MAX_DISTINCT) để khỏi sort hàng nghìn chuỗi mỗi render. */
export function FacetFilterInput<T>({
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
