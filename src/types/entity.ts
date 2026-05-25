export type FieldType =
  | "text" | "textarea" | "number" | "integer"
  | "boolean" | "date" | "datetime" | "time"
  | "select" | "multi-select" | "enum" | "multi-enum"
  | "lookup" | "multi-lookup"
  | "file" | "image" | "url" | "email" | "phone"
  | "sequence" | "json" | "formula";

/** Hành vi khi record đích của lookup bị xoá. */
export type OnDeleteBehavior = "restrict" | "setnull" | "cascade";

export interface FieldOption {
  value: string;
  label: string;
  /** Nhãn tiếng Anh (i18n). Optional — fallback xuống `label` nếu thiếu. */
  labelEn?: string;
}

export interface FieldDef {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  default?: unknown;
  placeholder?: string;
  description?: string;
  /** Cho select / multi-select — options inline. */
  options?: FieldOption[];
  /** Cho enum / multi-enum — id của object enum (xem /enums). */
  enumId?: string;
  /** Cho lookup / multi-lookup — ref entity id */
  ref?: string;
  /** Cho lookup / multi-lookup — hành vi khi record đích bị xoá. */
  onDelete?: OnDeleteBehavior;
  /** Cho formula — JS expression dùng row + fn helpers */
  formula?: string;
  /** Validation */
  min?: number;
  max?: number;
  pattern?: string;
  /** Display in list */
  showInList?: boolean;
  width?: number;
  /** Đưa giá trị field vào full-text search index (search_tsv) — chỉ text. */
  searchable?: boolean;
  /** Unique constraint server-side (chỉ áp dụng cho record active). */
  unique?: boolean;
  /** Field-level RBAC — role nào đọc/ghi được. Vắng = mọi role có quyền entity. */
  readableBy?: Array<"admin" | "editor" | "viewer">;
  writableBy?: Array<"admin" | "editor" | "viewer">;
  /** Cho field type "sequence" — vd prefix "INV-", padding 4 → "INV-0001". */
  sequencePrefix?: string;
  sequencePadding?: number;
}

/** Binding entity → backend op.
 *
 * Syntax giá trị:
 *   "tool_name"        — MCP tool (legacy, mặc định)
 *   "mcp:tool_name"    — explicit MCP
 *   "proc:proc_name"   — native procedure (xem packages/server/src/procedure-runner.ts)
 *
 * Dùng `parseBinding()` trong `src/lib/binding.ts` để phân giải.
 */
export interface EntityBinding {
  list?: string;
  get?: string;
  create?: string;
  update?: string;
  delete?: string;
}

export interface EntityDef {
  id: string;
  name: string;          // technical name e.g. "customer"
  label: string;         // display "Khách hàng"
  description?: string;
  icon?: string;
  primaryKey: string;    // field key dùng làm PK
  fields: FieldDef[];
  bindings?: EntityBinding;
  createdAt?: number;
  updatedAt?: number;
}
