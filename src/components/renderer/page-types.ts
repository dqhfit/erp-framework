/* Type dùng chung cho renderer ConsumerPage + các widget tách ra. Đây là
   PageComponent CỤC BỘ của renderer (KHÁC @/types/page — đừng gộp). Tách từ
   ConsumerPage.tsx (Phase A1). Chỉ type, không runtime. */
import type { ColumnGroupNode, ServerGridQuery } from "@/components/renderer/DataGrid";
import type { CreateFormCfg } from "@/components/renderer/MasterDetailCreateModal";
import type { EntityField } from "@/lib/object-types";
import type { ActionConfig } from "@/types/page";

export type ChartKind = "bar" | "line" | "area" | "pie" | "doughnut";

export interface PageComponent {
  id: string;
  kind: string;
  x: number;
  y: number;
  w: number;
  h: number;
  config: Record<string, unknown>;
}

/* ── Phase V — Page state cho master-detail cross-widget cross-talk ─
 *
 * Mỗi page có 1 kv store; widget read/write qua usePageState. List set
 * recordId khi click row → detail/child widget khác đọc state để load
 * record cụ thể hoặc filter theo state. */
export type PageStateValue = unknown;
export interface PageStateCtx {
  get: (key: string) => PageStateValue;
  set: (key: string, value: PageStateValue) => void;
  values: Record<string, PageStateValue>;
}

/* ── Tùy chọn tải dữ liệu (số dòng + điều kiện + cổng) ────────────────────── */
export type LoadFilterOp = "=" | "!=" | ">" | ">=" | "<" | "<=" | "contains" | "in" | "is-not-true";
/** Điều kiện lọc server-side: map field → {op, value} (khớp QueryParams.filters). */
export type LoadFilters = Record<string, { op: LoadFilterOp; value: unknown }>;

export interface UseRecordsOpts {
  /** Số dòng tối đa tải (server-side LIMIT). Mặc định 500. */
  limit?: number;
  /** Sắp xếp SERVER-SIDE (trước khi cắt limit) → tải đúng dòng cần (vd mới nhất
   *  trước cho bảng lớn). Suy từ cfg.defaultSort. */
  sort?: { field: string; dir: "asc" | "desc" };
  /** Điều kiện lọc áp ở DB TRƯỚC khi cắt limit. */
  filters?: LoadFilters;
  /** Cổng: false → không tải gì (vd chờ chọn bộ lọc). Mặc định true. */
  enabled?: boolean;
}

/* ── Server-side paging hook result (cho bảng LỚN). ── */
export interface ServerPagedResult {
  rows: Record<string, unknown>[];
  fields: EntityField[];
  total: number;
  loading: boolean;
  err: string;
  onQueryChange: (q: ServerGridQuery) => void;
  /** Nạp lại trang hiện tại (sau khi ghi 1 ô — phản ánh giá trị đã lưu /
   *  field server-side suy ra). */
  refresh: () => void;
  /** Tổng hợp cột (server-side, toàn bảng) — field→giá trị. Rỗng nếu không yêu
   *  cầu aggregates hoặc bind datasource (chưa hỗ trợ). */
  summary: Record<string, number>;
}
export type AggSpec = { field: string; fn: "sum" | "avg" | "count" | "min" | "max" };

/** Kết quả refFill: `overlay` = cột projection (hiển thị-only, đổi theo ref về
 *  sau); `snapshot` = cột base có snapshotFrom (GHI vào pending để đóng băng). */
export interface RefFillResult {
  overlay: Record<string, unknown>;
  snapshot: Record<string, string>;
}

export interface WidgetData {
  rows: Record<string, unknown>[];
  /** Field meta để render cột/label (entity fields HOẶC datasource flat fields). */
  fields: EntityField[];
  loading: boolean;
  err: string;
  /** true nếu widget bind tới nguồn dữ liệu (datasource) thay entity. */
  isDataSource: boolean;
  create: (data: Record<string, unknown>) => Promise<void>;
  update: (id: string, data: Record<string, unknown>) => Promise<void>;
  remove: (id: string) => Promise<void>;
  /** Datasource: đổi field ref → overlay cột projection (Tên VT…) + snapshot. */
  refFill?: (fieldName: string, value: string) => Promise<RefFillResult>;
}

export type RowDetailCfg = {
  /** entityId của bảng con (vd tr_order_detail). */
  entity: string;
  /** Field trên dòng cha lấy giá trị khoá (vd order_number). */
  parentField: string;
  /** Field trên bảng con để lọc theo khoá cha (vd order_number). */
  childField: string;
  /** Tiêu đề dialog. */
  title?: string;
  /** Cột con hiển thị (mặc định: theo entity con). */
  fields?: string[];
  /** Override nhãn cột con. */
  columnLabels?: Record<string, string>;
};

export type EmbeddedFilter = {
  label?: string;
  stateKey: string;
  options?: string;
  optionLabels?: Record<string, string>;
};

export type ActionBarItem = ActionConfig & { id: string };

export type SplitPanelCfg = {
  kind?: string;
  entity?: string;
  dataSourceId?: string;
  title?: string;
  linkField?: string;
  /** Cột phát khi chọn dòng — giá trị của cột này được lưu vào state thay vì row.id.
   *  Dùng khi panel nguồn liên kết với panel đích qua business-key (vd masp, code)
   *  thay vì UUID. Panel đích đặt linkField = cột có cùng giá trị đó. */
  sourceField?: string;
  /** Nhiều cột phát cùng lúc. Mỗi cột fieldX được lưu vào state key
   *  `${splitKey}:${panelKey}:${fieldX}`. Panel đích dùng linkConditions
   *  để khai báo điều kiện lọc theo cột phát tương ứng. */
  sourceFields?: string[];
  /** Nhiều điều kiện lọc (AND). Mỗi điều kiện chỉ định: panel nguồn phát
   *  (fromPanel), cột phát từ panel đó (fromField, bỏ trống = dùng main key),
   *  và cột trong panel này để so sánh (toField). */
  linkConditions?: Array<{ fromPanel?: string; fromField?: string; toField: string }>;
  /** Panel nguồn để lọc/hiển thị detail: "a"|"b"|"c"|"d". Mặc định "a" (Panel A). */
  filterFromPanel?: string;
  chartKind?: string; // bar|line|area|pie|doughnut — loại biểu đồ
  groupBy?: string; // chart / kanban: field nhóm
  valueField?: string; // chart: field tổng hợp giá trị
  selectable?: boolean; // list: hiện checkbox chọn dòng
  addRowAtEnd?: boolean; // list+batchEdit: dòng thêm mới
  addRowPos?: string; // top | bottom
  // Các trường được copy từ list/form/detail khi kéo thả vào panel
  fields?: string[];
  columnLabels?: Record<string, string>;
  columnGroups?: ColumnGroupNode[];
  serverPaging?: boolean;
  editable?: boolean;
  batchEdit?: boolean;
  excelMode?: boolean;
  multiSelect?: boolean;
  loadGate?: string;
  loadFilters?: LoadFilters;
  rowLimit?: number;
  pageSize?: number;
  defaultSort?: { field: string; dir: "asc" | "desc" };
  /** Thanh hành động nhúng của widget con, giống list/form/detail độc lập. */
  embeddedActions?: ActionBarItem[];
  /** Cột hành động dựng sẵn Xem/Sửa/Xóa cho list trong panel. */
  rowActionsBuiltin?: boolean;
  rowActionsHidden?: string[];
  rowActionsStyle?: "inline" | "popover";
  rowActions?: ActionConfig[];
  createForm?: CreateFormCfg;
  editForm?: CreateFormCfg;
};

export type SplitGridCell = SplitPanelCfg & {
  id: string;
  col: number;
  row: number;
  colSpan: number;
  rowSpan: number;
};

export type FItemCfg = {
  id: string;
  kind: "combobox" | "tagbox" | "search";
  label?: string;
  entity?: string;
  dataSourceId?: string;
  field?: string;
  labelField?: string;
  stateKey?: string;
  placeholder?: string;
  pageSize?: number;
  options?: string;
  /** Nhãn hiển thị cho từng giá trị trong `options` (value→label). Vd trạng thái:
   *  options="0,1,2" + optionLabels={"0":"Đã tạo",...}. Không có → label = value. */
  optionLabels?: Record<string, string>;
  /** Combobox ĐA CHỌN: ghi string[] vào state (loadFilters op "in"). Mặc định single. */
  multiSelect?: boolean;
  /** Giá trị chọn sẵn khi mở trang (seed vào pageState 1 lần nếu state chưa có).
   *  string cho single, string[] cho multiSelect. */
  defaultValue?: string | string[];
  width?: number;
  /** Lọc options theo field này khi filterFromState có giá trị (cascade 1 cha — legacy). */
  filterField?: string;
  /** State key của control cha — khi có giá trị thì filter rows theo filterField (legacy). */
  filterFromState?: string;
  /** Lọc liên kết NHIỀU cha: options của item này thu hẹp theo MỌI phụ thuộc đang
   *  có giá trị (vd Sản phẩm lọc theo Đơn hàng + Khách hàng). `fromState` = state key
   *  của filter cha; `field` = field trong nguồn của item này khớp giá trị cha. */
  dependsOn?: { fromState: string; field: string }[];
  /** Ẩn/hiện filter theo state: oneOf = chỉ hiện khi state nằm trong list; notOneOf = ẩn khi state nằm trong list. */
  visibleWhen?: { stateKey: string; oneOf?: string[]; notOneOf?: string[] };
};

export type VisibleRule = {
  stateKey: string;
  op: "eq" | "neq" | "in" | "nin" | "set" | "notset";
  value?: string | string[];
};
