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
  /** Key page state để lưu kết quả (object đã chọn / nhập) */
  saveOutputTo: string;
}

/** Một bước trong wizard — có thể tạo bản ghi entity hoặc chỉ hiển thị form. */
export interface WizardStepDef {
  id: string;
  title: string;
  description?: string;
  /** Entity để tạo bản ghi trong bước này (không bắt buộc). */
  entity?: string;
  /** Tập con field hiển thị. undefined = toàn bộ field của entity. */
  fields?: string[];
  /** Sau khi tạo xong, lưu ID bản ghi vào page state key này. */
  saveOutputTo?: string;
  /** Nút hành động tuỳ chỉnh hiển thị trong bước này. */
  actions?: Array<{ id: string } & ActionConfig>;
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
}

export type ActionStep =
  | ActionStepConfirm
  | ActionStepProcedure
  | ActionStepNavigate
  | ActionStepSetState
  | ActionStepOpenPopup
  | ActionStepOpenWizard;

export type ActionVariant = "primary" | "default" | "danger" | "ghost";

export interface ActionConfig {
  label: string;
  icon?: IconName;
  variant?: ActionVariant;
  steps: ActionStep[];
  /** Tooltip / hint hiển thị khi hover button. */
  hint?: string;
  /** Hỏi xác nhận trước khi chạy chuỗi step. */
  requireConfirm?: boolean;
  /** Nội dung hỏi xác nhận — chỉ dùng khi requireConfirm = true. */
  confirmMessage?: string;
  /** Tiêu đề dialog xác nhận — fallback "Xác nhận". */
  confirmTitle?: string;
}
