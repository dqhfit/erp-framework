/* ==========================================================
   object-types.ts — Kiểu dữ liệu dùng chung cho các đối tượng
   low-code (entity / page / workflow / agent) ở tầng app.

   Trước đây là `mock-data.ts` — đổi tên cho khớp nội dung thật:
   file chỉ còn ĐỊNH NGHĨA KIỂU, không còn dữ liệu mock. Hàm
   `formatVND` đã tách sang `format.ts`; bảng kiểu field builtin
   (`FIELD_TYPES`) đã chuyển vào `field-types.ts`.
   ========================================================== */
import type { I as IconSet } from "@/components/Icons";

export type IconName = keyof typeof IconSet;

export interface FieldFormat {
  /** Number / currency / formula: số chữ số thập phân (0-6). */
  decimals?: number;
  /** Dấu phân cách hàng nghìn. */
  thousandSep?: "comma" | "period" | "space" | "none";
  /** Text tiền tố hiển thị (vd: "+", "~"). */
  prefix?: string;
  /** Text hậu tố hiển thị (vd: "kg", "%"). */
  suffix?: string;
  /** Currency: ký hiệu tiền tệ (₫, $, €, …). */
  currencySymbol?: string;
  /** Currency: vị trí ký hiệu. */
  symbolPosition?: "before" | "after";
  /** Date / datetime: chuỗi định dạng. */
  dateFormat?: "dd/MM/yyyy" | "MM/dd/yyyy" | "yyyy-MM-dd" | "relative";
  /** Datetime: định dạng giờ. */
  timeFormat?: "HH:mm" | "HH:mm:ss" | "hh:mm a" | "relative";
  /** Text: biến đổi chuỗi khi hiển thị. */
  textTransform?: "none" | "uppercase" | "lowercase" | "capitalize";
  /** Boolean: nhãn tuỳ chỉnh. */
  trueLabel?: string;
  falseLabel?: string;
}

export interface EntityField {
  id: string;
  name: string;
  label: string;
  labelEn?: string;
  type: string;
  required?: boolean;
  options?: string[];
  ref?: string;
  /** Cho field type "formula" */
  formula?: string;
  /** Cho field type "enum" / "multi-enum" — id của enum object (xem /enums). */
  enumId?: string;
  /** Cho field type "lookup" / "multi-lookup" — hành vi khi record đích bị xoá. */
  onDelete?: "restrict" | "setnull" | "cascade";
  /** Full-text search index (search_tsv). */
  searchable?: boolean;
  /** Unique constraint per company+entity (server-enforce). */
  unique?: boolean;
  /** Field-level RBAC — role nào đọc/ghi được. */
  readableBy?: Array<"admin" | "editor" | "viewer">;
  writableBy?: Array<"admin" | "editor" | "viewer">;
  /** Cho field type "sequence". */
  sequencePrefix?: string;
  sequencePadding?: number;
  /** Tuỳ chọn định dạng hiển thị. */
  format?: FieldFormat;
  /** Cho field type "collection" — tên field FK trên entity con trỏ về cha.
   *  childEntityId lưu qua `ref`, FK field name lưu qua đây. */
  fkField?: string;
  /** Mặc định hiển thị trong danh sách / grid. Không đặt hoặc true = hiện; false = ẩn. */
  defaultVisible?: boolean;
}
export interface MockEntity {
  id: string;
  /** Nhãn hiển thị (label) — tên người dùng đọc, dùng khắp UI. */
  name: string;
  /** Tên kỹ thuật (snake_case) — map xuống cột DB `name`, dùng cho API
   *  scope (entity:<name>) + biểu thức. Trống = server tự sinh từ nhãn. */
  techName?: string;
  icon: IconName;
  mcp: string;
  fields: EntityField[];
  /** ID của field dùng làm khoá chính (PK). Dùng để hiển thị ERD và tạo FK mặc định. */
  primaryKey?: string;
  /** Mapping 5 op (list/get/create/update/delete) → MCP tool + args */
  mcpBindings?: import("@/components/designer/McpBindingsEditor").McpBindings;
  /** Override per-op sang native procedure: { list?: "proc_name", ... }.
   *  Khi set, server records.* dispatch sang procedure-runner thay vì native CRUD. */
  procBindings?: Partial<Record<"list" | "get" | "create" | "update" | "delete", string>>;
}

export interface MockPage {
  id: string;
  name: string;
  icon: IconName;
  updated: string;
  author: string;
  isPublished?: boolean;
  publishMode?: "private" | "public";
  viewerGroupIds?: string[];
}

export interface MockViewerGroup {
  id: string;
  name: string;
  color: string;
  memberIds: string[];
  pageIds: string[];
}

/** Nguồn kích hoạt workflow — khớp pgEnum workflow_trigger (cấp workflow,
 *  KHÔNG phải cấp node). Runner đọc workflows.triggerType để biết ai bắn. */
export type WorkflowTriggerType =
  | "manual"
  | "cron"
  | "iot_telemetry"
  | "webhook"
  | "entity_changed";

export interface MockWorkflow {
  id: string;
  name: string;
  icon: IconName;
  status: "active" | "paused";
  runs: number;
  /** Nguồn trigger (mặc định "manual"). Lưu ở DB column workflows.trigger_type. */
  triggerType?: WorkflowTriggerType;
  /** Filter trigger (vd {deviceId, channel} cho iot_telemetry, {cronExpr}…). */
  triggerConfig?: Record<string, unknown>;
}

export interface MockAgent {
  id: string;
  name: string;
  model: string;
  tools: number;
  /** ID của template đã dùng để tạo agent (nếu có). */
  templateId?: string;
}

/** Nguồn dữ liệu (DataSource ORM-like) — tóm tắt cho Sidebar. Cấu hình đầy đủ
 *  (DataSourceConfig) nằm ở userObjects.dataSourceContent[id]. */
export interface MockDataSource {
  id: string;
  name: string;
  icon: IconName;
  /** Entity gốc (để hiển thị nhanh; rỗng khi chưa cấu hình). */
  baseEntityId?: string;
}
