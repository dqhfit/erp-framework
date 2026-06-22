/* Type công khai của DataGrid: props + giao thức server-side paging. Tách từ
   DataGrid.tsx (Phase D1) — chỉ di chuyển type, không runtime. DataGrid.tsx
   re-export lại để consumer (ConsumerPage/list-widgets/page-data…) giữ nguyên
   đường import. */
import type { ColumnDef } from "@tanstack/react-table";
import type { ReactNode } from "react";
import type { ColumnGroupNode, SummaryType } from "@/components/renderer/datagrid/grid-utils";

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
  /** Class CSS phụ theo dòng (vd tô nổi bật dòng thiếu dữ liệu). Trả undefined
   *  = không thêm class. Áp ở cả lưới bảng lẫn thẻ card. */
  rowClassName?: (row: T) => string | undefined;
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
