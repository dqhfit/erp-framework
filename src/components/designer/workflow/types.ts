/* Kiểu node workflow (WfNodeData) — tách từ WorkflowDesigner.tsx. */
import type { WorkflowNodeKind } from "@/components/designer/workflow/node-palette";

export interface WfNodeData {
  kind: WorkflowNodeKind;
  label: string;
  config?: Record<string, unknown>;
  /** Index signature — bắt buộc để khớp ràng buộc Node<T> của @xyflow/react. */
  [key: string]: unknown;
}
