/* Đọc/ghi + so sánh graph workflow trong store. Tách từ WorkflowDesigner.tsx. */
import type { Edge, Node } from "@xyflow/react";
import type { WfNodeData } from "@/components/designer/workflow/types";
import { useUserObjects } from "@/stores/userObjects";

/* Canvas khởi tạo cho workflow MỚI (chưa có graph lưu): chỉ 1 node
   trigger trống — KHÔNG dùng demo 4-node để tránh cảm giác "trang mới
   kế thừa nội dung cũ". */
export const STARTER_NODES: Node<WfNodeData>[] = [
  {
    id: "n_trigger",
    type: "wf",
    position: { x: 120, y: 120 },
    data: { kind: "trigger", label: "Bắt đầu" },
  },
];

/* Đọc graph đã lưu của workflow từ store. Workflow mới / graph rỗng →
   trả STARTER (canvas trắng), KHÔNG giữ lại nodes của workflow trước. */
export function readStoredGraph(workflowId: string): { nodes: Node<WfNodeData>[]; edges: Edge[] } {
  const stored = useUserObjects.getState().workflowContent[workflowId] as
    | { nodes?: Node<WfNodeData>[]; edges?: Edge[] }
    | undefined;
  if (stored?.nodes && stored.nodes.length > 0) {
    return {
      nodes: stored.nodes,
      // Vá edge cũ thiếu `type` → custom edge (nút ×) áp dụng cả edge cũ.
      edges: (stored.edges ?? []).map((e) => ({ ...e, type: e.type ?? "wf" })),
    };
  }
  return { nodes: STARTER_NODES, edges: [] };
}

/* Chuỗi hoá graph để so sánh "có thay đổi cần lưu chưa". Bỏ trạng thái
   UI thoáng qua (selected/dragging) để chọn node KHÔNG kích autosave. */
export function serializeGraph(nodes: Node<WfNodeData>[], edges: Edge[]): string {
  const n = nodes.map((x) => ({ id: x.id, type: x.type, position: x.position, data: x.data }));
  const e = edges.map((x) => {
    const { selected: _s, ...rest } = x;
    return rest;
  });
  return JSON.stringify({ n, e });
}
