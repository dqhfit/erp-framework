export type FieldType =
  | "text" | "textarea" | "number" | "integer"
  | "boolean" | "date" | "datetime" | "time"
  | "select" | "multi-select" | "lookup"
  | "file" | "image" | "url" | "email" | "phone"
  | "json" | "formula";

export interface FieldDef {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  default?: unknown;
  placeholder?: string;
  description?: string;
  /** Cho select / multi-select */
  options?: Array<{ value: string; label: string }>;
  /** Cho lookup — ref entity id */
  ref?: string;
  /** Cho formula — JS expression dùng row + fn helpers */
  formula?: string;
  /** Validation */
  min?: number;
  max?: number;
  pattern?: string;
  /** Display in list */
  showInList?: boolean;
  width?: number;
}

export interface EntityBinding {
  list?: string;     // MCP tool name cho list
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
