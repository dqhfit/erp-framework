/* WfFlowEdge — edge tuỳ biến: style giữ nguyên + nút × xoá nhanh ở
   trung điểm (hiện khi hover/selected). Tách từ WorkflowDesigner.tsx. */
import {
  BaseEdge,
  EdgeLabelRenderer,
  type EdgeProps,
  getBezierPath,
  useReactFlow,
} from "@xyflow/react";
import { cn } from "@/lib/utils";

/* Edge tuỳ biến: giữ nguyên style (nét đứt data / mũi tên control do
   ReactFlow truyền qua props) + thêm nút × ở trung điểm để xoá nhanh.
   Nút chỉ hiện khi hover lên edge hoặc edge đang được chọn. */
export function WfFlowEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  style,
  label,
  selected,
}: EdgeProps) {
  const { setEdges } = useReactFlow();
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });
  return (
    <>
      <BaseEdge id={id} path={edgePath} markerEnd={markerEnd} style={style} />
      <EdgeLabelRenderer>
        <div
          className="nodrag nopan group absolute -translate-x-1/2 -translate-y-1/2 flex items-center gap-1"
          style={{ left: labelX, top: labelY, pointerEvents: "all" }}
        >
          {typeof label === "string" && label && (
            <span className="px-1 rounded bg-panel border border-border text-[10px] text-muted">
              {label}
            </span>
          )}
          <button
            type="button"
            title="Xoá link"
            onClick={() => setEdges((es) => es.filter((e) => e.id !== id))}
            className={cn(
              "w-4 h-4 rounded-full bg-danger text-white flex items-center justify-center text-[10px] leading-none transition-opacity",
              selected ? "opacity-100" : "opacity-0 group-hover:opacity-100",
            )}
          >
            ×
          </button>
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

export const EDGE_TYPES = { wf: WfFlowEdge };
