/* ==========================================================
   DataSource — hợp đồng truy cập dữ liệu của ERP Framework.
   packages/core CHỈ khai báo interface + DTO; ứng dụng cung
   cấp cài đặt cụ thể (LocalStorageDataSource / ApiDataSource).
   Đây là "cổng contract-first" của P1 — xem UPGRADE-PLAN 5.1.
   ========================================================== */

/* ─── DTO ────────────────────────────────────────────────── */

/** Kiểu field hỗ trợ trong định nghĩa entity. */
export type FieldType =
  | "text" | "number" | "boolean" | "date" | "datetime"
  | "select" | "multiselect" | "enum" | "multienum"
  | "relation" | "lookup" | "multilookup"
  | "sequence" | "formula" | "json";

/** Rule điều kiện cho requiredIf/visibleIf — DSL nhỏ, sync, pure.
 *  Hỗ trợ AND/OR cấp 1 + so sánh primitive. Phức tạp hơn → dùng formula. */
export type FieldRuleOp = "=" | "!=" | ">" | ">=" | "<" | "<=" | "in" | "notin" | "empty" | "nonempty";
export interface FieldRuleCondition {
  field: string;
  op: FieldRuleOp;
  value?: unknown;
}
export interface FieldRule {
  /** any: ít nhất 1 cond đúng (OR) · all: tất cả đúng (AND). Default: all. */
  combinator?: "all" | "any";
  conditions: FieldRuleCondition[];
}

/** Hành vi khi record được trỏ tới bị xoá (lookup/multilookup).
 *  - restrict: chặn xoá nếu còn ref (mặc định an toàn).
 *  - setnull : xoá ref khỏi field (null hoá lookup, xoá value khỏi multilookup).
 *  - cascade : soft-delete chuỗi (record nguồn cũng soft-delete). */
export type OnDeleteBehavior = "restrict" | "setnull" | "cascade";

/** Định nghĩa một field trong entity (lưu ở entities.fields). */
export interface EntityFieldDef {
  name: string;                 // định danh máy — làm key trong record.data
  label: string;
  type: FieldType | (string & {});  // built-in hoặc kiểu do plugin thêm
  required?: boolean;
  options?: string[];           // cho select / multiselect (inline)
  /** Cho enum/multienum — id của bản ghi `enums` */
  enumId?: string;
  relationEntityId?: string;    // cho relation / lookup / multilookup
  /** Cho lookup/multilookup — hành vi khi record đích bị xoá. */
  onDelete?: OnDeleteBehavior;
  formula?: string;             // cho formula
  /** Cờ điều khiển sinh index — xem data governance UPGRADE-PLAN 3.5 */
  filterable?: boolean;
  sortable?: boolean;
  /** Đưa giá trị field vào search_tsv (FTS) — chỉ field text/textarea. */
  searchable?: boolean;
  /** Unique constraint — server enforce qua validation lookup. */
  unique?: boolean;
  /** Field-level RBAC. Mặc định = mọi role có quyền entity được đọc/ghi. */
  readableBy?: Array<"admin" | "editor" | "viewer">;
  writableBy?: Array<"admin" | "editor" | "viewer">;
  /** Cho field type "sequence" — prefix + padding (vd "INV-", 4 → INV-0001). */
  sequencePrefix?: string;
  sequencePadding?: number;
  /** Nhãn tiếng Anh (i18n). Fallback xuống `label` nếu thiếu. */
  labelEn?: string;
  /** Required theo điều kiện — đè cờ `required` tĩnh khi rule khớp. */
  requiredIf?: FieldRule;
  /** Ẩn field theo điều kiện — UI bỏ render khi rule khớp false. */
  visibleIf?: FieldRule;
}

/** Định nghĩa một entity (metadata low-code). */
export interface EntityConfig {
  id: string;
  name: string;
  label: string;
  icon?: string;
  fields: EntityFieldDef[];
}

/** Một bản ghi dữ liệu thực tế của entity động. */
export interface EntityRecord {
  id: string;
  entityId: string;
  schemaVersion: string;
  data: Record<string, unknown>;
  createdBy?: string;
  createdAt: string;            // ISO string
  updatedAt: string;
}

export type FilterOp = "=" | "!=" | ">" | ">=" | "<" | "<=" | "contains" | "in";

/** Tham số truy vấn record động. */
export interface QueryParams {
  /** Lọc theo field động, vd { tong_tien: { op: ">", value: 5_000_000 } } */
  filters?: Record<string, { op: FilterOp; value: unknown }>;
  sort?: { field: string; dir: "asc" | "desc" };
  limit?: number;
  offset?: number;
  /** Full-text search — match @@ trên search_tsv (xem migration 0016). */
  q?: string;
  /** Bao gồm cả record đã soft-delete; default false. */
  includeDeleted?: boolean;
}

export interface Paginated<T> {
  rows: T[];
  total: number;
}

/* ─── Interface ──────────────────────────────────────────── */

/**
 * Mọi store/đọc-ghi dữ liệu đi qua interface này — không gọi
 * thẳng localStorage hay tRPC. Nhờ đó P1 chuyển đổi cuốn chiếu:
 * frontend chạy trên LocalStorageDataSource trong khi backend
 * còn đang dựng, rồi đổi sang ApiDataSource bằng một dòng inject.
 */
export interface DataSource {
  /* Metadata low-code */
  listEntities(): Promise<EntityConfig[]>;
  getEntity(id: string): Promise<EntityConfig | null>;
  saveEntity(entity: EntityConfig): Promise<EntityConfig>;
  deleteEntity(id: string): Promise<void>;

  /* Dữ liệu thực tế — record động */
  getRecords(entityId: string, query?: QueryParams): Promise<Paginated<EntityRecord>>;
  getRecord(recordId: string): Promise<EntityRecord | null>;
  createRecord(entityId: string, data: Record<string, unknown>): Promise<EntityRecord>;
  updateRecord(recordId: string, data: Record<string, unknown>): Promise<EntityRecord>;
  deleteRecord(recordId: string): Promise<void>;

  /* Workflow & scheduler */
  triggerWorkflow(workflowId: string, context?: unknown): Promise<{ runId: string }>;
}
