import type { IconName } from "@/lib/object-types";

/* ── Filter system (V2) ───────────────────────────────────────
 * Cho phép widget consumer (List/Chart/Kanban/Calendar/...) lọc
 * dữ liệu theo bất kỳ source state nào trên page, với operator
 * + AND/OR group. Schema cây tree để hỗ trợ filter phức tạp.
 *
 * Backward compat: legacy `filterFromState: {field, stateKey}`
 * vẫn hoạt động (runtime tự wrap thành 1-leaf eq). Khi cfg.filters
 * có giá trị, runtime ưu tiên cfg.filters và bỏ qua legacy. */

export type FilterOp =
  | "eq"
  | "neq"
  | "contains"
  | "in"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "between"
  | "isEmpty"
  | "isNotEmpty";

export interface FilterLeaf {
  kind: "leaf";
  /** Field của entity widget hiện tại để so sánh. */
  field: string;
  /** Key trong pageState để lấy giá trị bên phải. */
  stateKey: string;
  /** Toán tử so sánh. Mặc định "eq". */
  op: FilterOp;
}

export interface FilterGroup {
  kind: "group";
  logic: "and" | "or";
  children: FilterNode[];
}

export type FilterNode = FilterLeaf | FilterGroup;

export type ComponentType =
  | "list"
  | "form"
  | "kanban"
  | "gantt"
  | "tree"
  | "chart"
  | "kpi"
  | "card"
  | "html"
  | "iframe"
  | "action";

export interface PageComponent {
  id: string;
  type: ComponentType;
  x: number;
  y: number;
  w: number;
  h: number;
  config: Record<string, unknown>;
}
export interface PageDef {
  id: string;
  name: string;
  path: string;
  icon?: string;
  components: PageComponent[];
}

/* ── Action component ──────────────────────────────────────────
 * Nút bấm trong page gọi procedure (RBAC + isolated-vm) + chuỗi
 * hậu xử lý: confirm trước, navigate sau, set page state, refetch.
 * Args binding: const | state | template ({{state.key}}). */

export type BindingValue =
  | { source: "const"; value: unknown }
  | { source: "state"; key: string }
  | { source: "template"; template: string };

export interface ActionStepConfirm {
  id: string;
  kind: "confirm";
  title?: string;
  message: string;
  danger?: boolean;
}
export interface ActionStepProcedure {
  id: string;
  kind: "procedure";
  procedureName: string;
  args: Record<string, BindingValue>;
  /** Lưu output procedure vào pageState[saveOutputTo]. */
  saveOutputTo?: string;
  /** Sau khi gọi xong → invalidate query records của entity (id). */
  invalidateEntities?: string[];
}
/** Gọi proc Tier D đã port (module-procs) — nút nghiệp vụ DQHF (vd Duyệt →
 *  trDanhsachDexuatDuyetBgd). args binding từ state/record. */
export interface ActionStepInvokeModule {
  id: string;
  kind: "invoke-module-proc";
  /** Tên export proc (vd trDanhsachDexuatDuyetBgd). */
  procName: string;
  args: Record<string, BindingValue>;
  saveOutputTo?: string;
  invalidateEntities?: string[];
}
/** Xoá bản ghi đang chọn (records.deleteRecord theo recordId). Thường ghép
 *  sau 1 step confirm. Nút "Xoá" của form DQHF map tới đây. */
export interface ActionStepDeleteRecord {
  id: string;
  kind: "delete-record";
  /** Nguồn recordId (thường state "sel" — dòng đang chọn trên list). */
  recordIdBinding: BindingValue;
  /** Invalidate records của entity sau khi xoá → list re-fetch. */
  invalidateEntities?: string[];
}
/** Tạo bản ghi mới (records.create). Thường ghép sau 1 step open-popup form
 *  (saveOutputTo) — popup nhập liệu rồi create-record ghi vào entity. Nút
 *  "Thêm" của list map tới đây (cùng kiểu form với "Sửa"). */
export interface ActionStepCreateRecord {
  id: string;
  kind: "create-record";
  /** Entity để tạo bản ghi. */
  entity: string;
  /** Nguồn dữ liệu — thường state key lưu output của open-popup form. */
  dataBinding: BindingValue;
  /** Lưu id bản ghi vừa tạo vào page state. */
  saveOutputTo?: string;
  /** Invalidate records của entity sau khi tạo → list re-fetch. */
  invalidateEntities?: string[];
}
/** Cập nhật bản ghi đang chọn (records.update theo recordId). Thường ghép
 *  sau 1 step open-popup form (saveOutputTo) — popup nạp sẵn record để sửa,
 *  rồi update-record ghi lại. Nút "Sửa" của list map tới đây. */
export interface ActionStepUpdateRecord {
  id: string;
  kind: "update-record";
  /** Nguồn recordId (thường state "sel" — dòng đang chọn). */
  recordIdBinding: BindingValue;
  /** Nguồn dữ liệu update — thường state key lưu output của open-popup form. */
  dataBinding: BindingValue;
  /** Invalidate records của entity sau khi sửa → list re-fetch. */
  invalidateEntities?: string[];
}
export interface ActionStepUpdateFields {
  id: string;
  kind: "update-fields";
  /** Nguồn recordId — thường state "sel" gán từ selectionStateKey. */
  recordIdBinding: BindingValue;
  /** Map field slug → giá trị. Hỗ trợ token đặc biệt: "$currentUser" (tên
   *  người dùng đang đăng nhập), "$now" (ISO timestamp hiện tại), hoặc
   *  BindingValue bình thường. */
  fields: Record<string, "$currentUser" | "$now" | BindingValue>;
  /** Invalidate list sau update. */
  invalidateEntities?: string[];
}
export interface ActionStepNavigate {
  id: string;
  kind: "navigate";
  /** Hỗ trợ interpolate {{state.key}}. */
  href: string;
  external?: boolean;
}
export interface ActionStepSetState {
  id: string;
  kind: "set-state";
  key: string;
  value: BindingValue;
}

/** Nạp lại dữ liệu lưới: đặt cờ __refresh cho từng entity → list refetch. */
export interface ActionStepRefresh {
  id: string;
  kind: "refresh";
  /** Danh sách entityId cần nạp lại. */
  entities: string[];
}

export interface ActionStepOpenPopup {
  id: string;
  kind: "open-popup";
  /** list: chọn từ danh sách; detail: xem chi tiết; form: nhập mới */
  popupMode: "list" | "detail" | "form";
  /** ID entity hiển thị trong popup */
  entity: string;
  /** Tiêu đề popup (tuỳ chọn) */
  title?: string;
  /** Binding cho ID record — chỉ dùng với popupMode="detail" */
  recordIdBinding?: BindingValue;
  /** Tập con field hiển thị (theo thứ tự). undefined = mặc định 7 field đầu.
   *  Dùng để ẩn field tự sinh (vd id auto-increment) khỏi form nhập. */
  fields?: string[];
  /** form mode: true → LƯU thật vào DB (recordId có → updateRecord, không →
   *  createRecord) thay vì chỉ trả giá trị về state. */
  persist?: boolean;
  /** Sau khi lưu thành công → đặt cờ __refresh cho các entity này (list reload). */
  invalidateEntities?: string[];
  /** Key page state để lưu kết quả (object đã chọn / nhập) */
  saveOutputTo: string;
  /** Form: render field này thành dropdown — hoặc lấy options từ entity khác
   *  (hiện `labelField`, lưu `valueField`), hoặc dùng `options` tĩnh (value≠label,
   *  vd Phân loại: TRONG→"Màu trong"). */
  lookups?: Array<{
    field: string;
    entity?: string;
    valueField?: string;
    labelField?: string;
    /** Options tĩnh — dùng thay cho fetch entity. */
    options?: Array<{ value: string; label: string }>;
  }>;
}

/** Ghi đè cấu hình hiển thị 1 field ngay trong page (không sửa entity).
 *  Chỉ override metadata hiển thị; field VẪN map về cùng cột data của entity. */
export interface FieldOverride {
  /** Kiểu render: text | select | multiselect | image | longtext | currency | url | boolean … */
  type?: string;
  /** Nhãn hiển thị trên form. */
  label?: string;
  /** Lựa chọn cho select/multiselect. */
  options?: string[];
  /** Bắt buộc nhập. */
  required?: boolean;
}

/** Liên kết 1 field tới entity nguồn (picker) — lưu giá trị valueField. */
export interface WizardLookupRef {
  entity: string;
  valueField: string;
  labelFields?: string[];
  /** Tự điền field khác từ record nguồn khi chọn: { fieldĐích: fieldNguồn }.
   *  Vd makhachhang lookup tr_khachhang → { tenkhachhang: "customer_name" }. */
  autofill?: Record<string, string>;
}

/** Cấu hình bước nhập LƯỚI chi tiết (master-detail) trong wizard 1-entity. */
export interface WizardStepDetail {
  /** Entity con (vd order_detail). */
  entity: string;
  /** Field trên dòng con để gán khoá cha (vd order_number). */
  linkField: string;
  /** Field trên bản ghi chính cung cấp giá trị khoá (vd order_number). */
  parentKeyField: string;
  /** Tập con field hiển thị trong lưới. */
  fields?: string[];
  /** Map fieldName → picker entity (vd item_number → sản phẩm). */
  fieldLookups?: Record<string, WizardLookupRef>;
  /** Field tự tính = tích các field nguồn (vd amount = order_qty × price). */
  computed?: Record<string, string[]>;
  /** Field hiển thị TỔNG ở footer lưới. */
  footerSums?: string[];
}

/** Ảnh chỉ đọc lấy từ entity liên quan, không tham gia payload lưu entity chính. */
export interface WizardRelatedImage {
  entity?: string;
  entityName?: string;
  linkField: string;
  parentField: string;
  imageField: string;
  label?: string;
}

/** Một bước trong wizard — có thể tạo bản ghi entity hoặc chỉ hiển thị form. */
export interface WizardStepDef {
  id: string;
  title: string;
  description?: string;
  /** Số cột hiển thị của form trong bước này. */
  cols?: 1 | 2;
  /** Entity để tạo bản ghi trong bước này (không bắt buộc). */
  entity?: string;
  /** Tập con field hiển thị. undefined = toàn bộ field của entity. */
  fields?: string[];
  /** (1-entity) Map fieldName → picker entity: field hiện COMBOBOX chọn record
   *  từ entity nguồn (lưu valueField). Vd makhachhang → tr_khachhang. */
  fieldLookups?: Record<string, WizardLookupRef>;
  /** Ghi đè cấu hình field NGAY TRONG TRANG (không cần sửa entity): đổi kiểu
   *  hiển thị / nhãn / options của field. Ưu tiên hơn định nghĩa entity. Dùng để
   *  cấu hình form đi theo page sync mà không phải chạm entities trên DB.
   *  Vd { area: { type: "select", options: ["Trong nước","Ngoài nước"] } }. */
  fieldOverrides?: Record<string, FieldOverride>;
  /** Sau khi tạo xong, lưu ID bản ghi vào page state key này. */
  saveOutputTo?: string;
  /** Nút hành động tuỳ chỉnh hiển thị trong bước này. */
  actions?: Array<{ id: string } & ActionConfig>;
  /** Nhóm field có tiêu đề — thay thế `fields` khi cần chia form thành các
   *  block có header (vd "Thông tin ngân hàng", "Thông tin tài khoản").
   *  Khi có `sections`, bỏ qua `fields` (lấy danh sách từ sections). */
  sections?: Array<{ title: string; fields: string[] }>;
  /** Bước nhập LƯỚI chi tiết: nhiều dòng entity con, mỗi dòng tự gán linkField
   *  = giá trị parentKeyField của bản ghi chính. Có → render bảng nhập thay vì
   *  form field (chỉ dùng ở wizard 1-entity). */
  detail?: WizardStepDetail;
  /** Ảnh tham chiếu chỉ đọc từ entity liên quan. */
  relatedImage?: WizardRelatedImage;
}

export interface ActionStepOpenWizard {
  id: string;
  kind: "open-wizard";
  /** Tiêu đề modal wizard. */
  title?: string;
  /** Nhãn nút hoàn tất bước cuối. */
  submitLabel?: string;
  steps: WizardStepDef[];
  /** Lưu dữ liệu tổng hợp từ tất cả bước vào page state key này. */
  saveOutputTo?: string;
  /** Chế độ 1-ENTITY: mọi bước thao tác CÙNG entity này (gom field theo bước
   *  → form cập nhật nhiều trang). Có → wizard tạo/sửa MỘT bản ghi (create cuối
   *  nếu không có recordId, update nếu có). Không có → giữ hành vi đa-entity:
   *  mỗi bước tự tạo bản ghi theo step.entity. */
  entity?: string;
  /** (1-entity) Binding ID bản ghi để SỬA. Rỗng/undefined → tạo mới. */
  recordIdBinding?: BindingValue;
  /** Sau khi lưu xong → đặt cờ __refresh cho các entity này (list reload). */
  invalidateEntities?: string[];
  /** Sau khi lưu xong → refresh các datasource (list join `dataSourceId`) theo id. */
  invalidateDataSources?: string[];
  /** Chế độ XEM (chỉ đọc): nạp dữ liệu như sửa nhưng khoá mọi input, KHÔNG lưu. */
  readOnly?: boolean;
  /** (1-entity, TẠO MỚI) Giá trị mặc định điền sẵn cho form (fieldName → giá trị
   *  dạng chuỗi; boolean dùng "true"/"false"). Chỉ áp khi tạo mới (không có recordId). */
  defaults?: Record<string, string>;
}

export type ActionStep =
  | ActionStepConfirm
  | ActionStepProcedure
  | ActionStepInvokeModule
  | ActionStepDeleteRecord
  | ActionStepCreateRecord
  | ActionStepUpdateRecord
  | ActionStepUpdateFields
  | ActionStepNavigate
  | ActionStepSetState
  | ActionStepRefresh
  | ActionStepOpenPopup
  | ActionStepOpenWizard;

export type ActionVariant = "primary" | "default" | "danger" | "ghost";

export interface ActionConfig {
  label: string;
  icon?: IconName;
  variant?: ActionVariant;
  steps: ActionStep[];
  /** Chỉ hiện icon (ẩn label) — dùng cho nút row-action gọn. Label vẫn
   *  làm tooltip + aria-label cho a11y. */
  iconOnly?: boolean;
  /** Tooltip / hint hiển thị khi hover button. */
  hint?: string;
  /** Hỏi xác nhận trước khi chạy chuỗi step. */
  requireConfirm?: boolean;
  /** Nội dung hỏi xác nhận — chỉ dùng khi requireConfirm = true. */
  confirmMessage?: string;
  /** Tiêu đề dialog xác nhận — fallback "Xác nhận". */
  confirmTitle?: string;
  /** (Row-action) Bind recordId theo 1 FIELD nghiệp vụ của dòng (vd "id_quytrinh")
   *  thay vì id uuid — cho master-detail liên kết qua khoá nghiệp vụ (số/chuỗi).
   *  Không đặt → dùng row.id (uuid) như mặc định. */
  recordIdField?: string;
}
