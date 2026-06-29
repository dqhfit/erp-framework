import type { FilterOp as RecordFilterOp } from "@erp-framework/core";
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
  /** Args binding. Hỗ trợ token đặc biệt như update-fields: "$currentUser"
   *  (tên người đăng nhập — vd nguoiduyet khi Duyệt) và "$now" (ISO hiện
   *  tại — vd ngayduyet), ngoài BindingValue thường. */
  args: Record<string, "$currentUser" | "$now" | BindingValue>;
  saveOutputTo?: string;
  invalidateEntities?: string[];
  /** Refetch các list bind DataSource sau khi proc chạy xong (__refresh:ds:<id>). */
  invalidateDataSources?: string[];
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
  /** Refresh các list join `dataSourceId` sau update (set __refresh:ds:<id>). */
  invalidateDataSources?: string[];
}
/** Cập nhật CÙNG bộ field cho NHIỀU bản ghi (lặp records.update). Dùng sau 1
 *  step open-popup multiSelect — gán cùng giá trị (vd phiên bản BOM sơn) cho
 *  tất cả bản ghi đã chọn. */
export interface ActionStepUpdateManyFields {
  id: string;
  kind: "update-many-fields";
  /** Nguồn MẢNG recordId — thường state key trỏ ids của popup multiSelect
   *  (vd "selProducts.ids"). */
  recordIdsBinding: BindingValue;
  /** Map field slug → giá trị (giống update-fields, hỗ trợ $currentUser/$now). */
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
  value: BindingValue | string | unknown;
}

/** Nạp lại dữ liệu lưới: đặt cờ __refresh cho từng entity → list refetch. */
export interface ActionStepRefresh {
  id: string;
  kind: "refresh";
  /** Danh sách entityId cần nạp lại. */
  entities: string[];
}

/** Xuất danh sách record của 1 entity ra file (Excel/CSV) — nút "Xuất". */
export interface ActionStepExportRecords {
  id: string;
  kind: "export-records";
  /** entityId cần xuất. */
  entity: string;
  /** Định dạng file (mặc định xlsx). */
  format?: "xlsx" | "csv";
  /** Tên file / tiêu đề (mặc định tên entity). */
  title?: string;
}

/** In danh sách record của 1 entity (mở cửa sổ in với bảng) — nút "In". */
export interface ActionStepPrintRecords {
  id: string;
  kind: "print-records";
  /** entityId cần in. */
  entity: string;
  /** Tiêu đề trang in. */
  title?: string;
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
  /** Ghi đè type/label của field trong popup (vd url→file, text→image). */
  fieldOverrides?: Record<string, FieldOverride>;
  columnLabels?: Record<string, string>;
  linkedToState?: { field: string; stateKey: string } | Array<{ field: string; stateKey: string }>;
  /** (list) Chọn NHIỀU dòng: hiện checkbox + nút xác nhận. Kết quả trả về
   *  { __many: true, ids: string[], items: object[] } để step sau lặp cập nhật. */
  multiSelect?: boolean;
  /** (list) Lọc danh sách SERVER-SIDE theo field → giá trị (op "="). Giá trị là
   *  BindingValue (resolve theo page state). Trong row-action, dùng sentinel
   *  const "$row.<field>" để lấy giá trị field của dòng (vd lọc sản phẩm cùng
   *  màu: { mausac: { source:"const", value:"$row.mausac" } }). */
  listFilters?: Record<string, BindingValue>;
  /** (list) Sắp xếp server-side theo field. */
  listSort?: { field: string; dir?: "asc" | "desc" };
  /** (list) Hiển thị NHÃN thay cho giá trị thô của field (resolve value→label qua
   *  entity khác). Vd cột bom_son_version_id (lưu id phiên bản) hiện mã phiên bản. */
  listLookups?: Array<{
    field: string;
    entity: string;
    /** Field khớp giá trị lưu ở cột (mặc định "id" = record id đích). */
    valueField?: string;
    labelField: string;
  }>;
  /** Form: render field này thành dropdown — hoặc lấy options từ entity khác
   *  (hiện `labelField`, lưu `valueField`), hoặc dùng `options` tĩnh (value≠label,
   *  vd Phân loại: TRONG→"Màu trong"). */
  lookups?: Array<{
    field: string;
    entity?: string;
    valueField?: string;
    labelField?: string;
    labelFields?: string[];
    columnHeaders?: string[];
    searchFields?: string[];
    autofill?: Record<string, string>;
    multiple?: boolean;
    separator?: string;
    preloadLimit?: number;
    filters?: Record<
      string,
      {
        op?: RecordFilterOp;
        value?: unknown;
        fromLinked?: string;
        split?: string;
      }
    >;
    /** Options tĩnh — dùng thay cho fetch entity. */
    options?: Array<{ value: string; label: string }>;
  }>;
  imageAttachments?: Array<{
    field: string;
    entity: string;
    itemField: string;
    pathField: string;
    nameField: string;
    itemValueField?: string;
    subfolder?: string;
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
  /** Số cột mà field này chiếm dụng (1 | 2 | 3 | 4). */
  colSpan?: number;
}

/** Liên kết 1 field tới entity nguồn (picker) — lưu giá trị valueField. */
export interface WizardLookupRef {
  entity: string;
  valueField: string;
  labelFields?: string[];
  /** Tự điền field khác từ record nguồn khi chọn: { fieldĐích: fieldNguồn }.
   *  Vd makhachhang lookup tr_khachhang → { tenkhachhang: "customer_name" }. */
  autofill?: Record<string, string>;
  /** true → TÌM SERVER-SIDE: gõ vào combobox sẽ query entity nguồn (ILIKE contains
   *  trên `searchFields`), thay vì lọc client trên danh sách preload. Bắt buộc cho
   *  entity LỚN (vd tr_material 36k dòng) — preload chỉ lấy ~2000 dòng đầu. */
  serverSearch?: boolean;
  /** (serverSearch) Field để tìm contains, mặc định = labelFields. Mỗi field 1 query
   *  rồi gộp (cho phép tìm theo cả mã lẫn tên). */
  searchFields?: string[];
  /** Lọc server-side khi PRELOAD danh sách (vd { xoa: { op: "=", value: "N" } } —
   *  chỉ lấy bản ghi chưa xoá). Shape = QueryParams.filters. */
  filters?: Record<string, { op: RecordFilterOp; value: unknown }>;
  /** Số dòng tối đa preload (mặc định 2000). Tăng khi muốn hiện HẾT danh sách lớn
   *  (vd tr_material xoa='N' ~30k) mà không dùng serverSearch. */
  preloadLimit?: number;
  /** Kích thước mỗi trang khi preload LŨY TIẾN: nạp từng trang rồi APPEND vào
   *  danh sách (combobox dùng được ngay sau trang đầu, các trang sau chạy nền).
   *  Mặc định 500. */
  preloadPageSize?: number;
  /** true → hiện nút "+" cạnh combobox để tạo nhanh bản ghi mới trong entity nguồn
   *  (vd thêm bước sơn chưa có), sau đó tự chọn + autofill. */
  allowCreate?: boolean;
  /** Field hiển thị trong form tạo nhanh (mặc định valueField + labelFields). */
  createFields?: string[];
  /** Field TỰ TĂNG khi tạo nhanh (không nhập tay) = max(giá trị nguồn)+1.
   *  Vd id_buocson. Giá trị mới cũng dùng cho autofill. */
  createAutoInc?: string[];
  /** (Field lookup ở BƯỚC HEADER) Khi chọn giá trị → nạp các dòng entity con vào
   *  LƯỚI CHI TIẾT của wizard. Vd chọn Đơn mua hàng → fill chi tiết phiếu nhập từ
   *  tr_dondathang_chitiet. `entity` = entity nguồn (chi tiết đơn); `matchField` =
   *  field trên entity nguồn khớp giá trị vừa chọn; `map` = { fieldLướiĐích:
   *  fieldNguồn }. Ghi ĐÈ các dòng đang có trong lưới. */
  fillDetail?: {
    entity: string;
    matchField: string;
    map: Record<string, string>;
  };
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
  /** Kế thừa giá trị từ bản ghi MASTER sang mỗi dòng chi tiết: { fieldChiTiết: fieldMaster }.
   *  Vd quy trình kế thừa màu của phiên bản: { mausac: "mausac", id_mausac: "id_mausac" }.
   *  Áp khi lưu (master-detail 1-entity). parentKeyField="id" → linkField nhận id master mới tạo. */
  inherit?: Record<string, string>;
  /** Giá trị mặc định cho DÒNG MỚI trong lưới (vd { is_active: "true" }). */
  rowDefaults?: Record<string, string>;
  /** Field VẪN LƯU nhưng KHÔNG render thành cột (vd soluong mặc định 1 qua
   *  rowDefaults, hoặc field tự fill từ lookup mà không cần hiện). Phải nằm trong
   *  `fields` để được lưu; chỉ bị ẩn khỏi lưới. */
  hiddenFields?: string[];
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
  cols?: 1 | 2 | 4;
  /** Entity để tạo bản ghi trong bước này (không bắt buộc). */
  entity?: string;
  /** Tập con field hiển thị. undefined = toàn bộ field của entity. */
  fields?: string[];
  /** Field VẪN nằm trong `fields` (để lưu, vd qua defaults $now/$currentUser) nhưng
   *  KHÔNG render ra form — ẩn khỏi người dùng. Vd ngaytao/nguoitao tự điền. */
  hiddenFields?: string[];
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
  /** Nút hành động gắn sát từng field trong form, ví dụ nút + để thêm nhanh danh mục lookup. */
  fieldActions?: Record<string, Array<{ id: string } & ActionConfig>>;
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

/** Mở form TẠO MỚI master-detail của list chứa nút (createForm của list widget).
 *  Cho phép đặt nút "Tạo đơn hàng" như một embeddedAction TRONG danh sách thay vì
 *  nút mặc định của createForm (đặt createForm.embedded = true để ẩn nút mặc định). */
export interface ActionStepOpenCreateForm {
  id: string;
  kind: "open-create-form";
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
  /** (1-entity, TẠO MỚI) Tự sinh SỐ chứng từ khi `field` để TRỐNG lúc lưu.
   *  `format` hỗ trợ token theo ngày hiện tại: `MM` (tháng 2 số), `yyyy` (năm 4 số),
   *  `dd` (ngày 2 số); và `{seq}` = số thứ tự tăng dần trong nhóm cùng prefix
   *  (phần trước {seq}). Vd "MMyyyy-{seq}" → "062026-49". `pad` = số chữ số tối
   *  thiểu của seq (mặc định 2). Số sinh ra cũng được dùng làm khoá liên kết
   *  master-detail nếu parentKeyField trỏ tới `field` này. */
  autoNumber?: { field: string; format: string; pad?: number };
}

export interface ActionStepUploadFile {
  id: string;
  kind: "upload-file";
  subfolder?: string;
  accept?: string;
  saveUrlTo?: string;
  saveNameTo?: string;
}

export type ActionStep =
  | ActionStepConfirm
  | ActionStepProcedure
  | ActionStepInvokeModule
  | ActionStepDeleteRecord
  | ActionStepCreateRecord
  | ActionStepUpdateRecord
  | ActionStepUpdateFields
  | ActionStepUpdateManyFields
  | ActionStepNavigate
  | ActionStepSetState
  | ActionStepRefresh
  | ActionStepExportRecords
  | ActionStepPrintRecords
  | ActionStepOpenPopup
  | ActionStepOpenCreateForm
  | ActionStepOpenWizard
  | ActionStepUploadFile;

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
  /** Giới hạn nút chỉ hiển thị với nhóm người xem cụ thể (viewer-group ids).
   *  Rỗng/vắng = mọi người thấy. Admin/editor luôn thấy tất cả. */
  visibleToGroups?: string[];
  /** Giới hạn nút chỉ hiển thị với tài khoản cụ thể (user ids).
   *  Ưu tiên nhóm: user có trong danh sách này thấy nút kể cả không thuộc nhóm. */
  visibleToUsers?: string[];
  /** Ẩn-riêng nút với các nhóm cụ thể (denylist, model phân quyền nút mặc-định-thấy).
   *  Mặc định mọi người thấy; group có trong danh sách này KHÔNG thấy nút, các nhóm
   *  khác vẫn thấy. Deny thắng allow (xem filterActions). Admin/editor luôn thấy. */
  hiddenForGroups?: string[];
  /** Ẩn-riêng nút với các tài khoản cụ thể (denylist).
   *  User có trong danh sách này KHÔNG thấy nút, người khác vẫn thấy. */
  hiddenForUsers?: string[];
}
