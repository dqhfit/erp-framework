/* Kiểu node của DataSourceCanvas (entity node + aggregate ghost node).
   Tách từ DataSourceCanvas.tsx. */
import type { Node } from "@xyflow/react";

export interface DSNodeData extends Record<string, unknown> {
  nodeId: string;
  entityId: string | undefined;
  alias: string;
  isBase: boolean;
  projected: Set<string>;
  /** Hiển thị tên cột (name) hay nhãn (label) của trường trên node. */
  fieldMode: "name" | "label";
  /** Tên field tham gia cạnh liên kết trên node này (fromField khi là cha,
   *  toField khi là con) — GHIM lên đầu danh sách để handle luôn nằm trong
   *  vùng nhìn thấy của hộp cuộn 240px; field bị cuộn khuất làm cạnh neo
   *  sai chỗ ("nối quan hệ không rõ ràng" với entity nhiều cột). */
  joinFields: string[];
  onToggleField: (nodeId: string, fieldName: string) => void;
  onSelect: (nodeId: string) => void;
  onRemove: (nodeId: string) => void;
  onAddField?: (entityId: string) => void;
}
export type DSNodeType = Node<DSNodeData>;

export interface AggNodeData extends Record<string, unknown> {
  aggKey: string;
  entityName: string;
  badge: string; // "1-N" | "N-N" | "far"
  fn?: string;
  byField?: string;
  valueField?: string;
}
export type AggNodeType = Node<AggNodeData>;
