/* WfNode — node tuỳ biến ReactFlow: header + cổng dữ liệu (in/out) +
   nhãn theo tên kỹ thuật/nhãn. Tách từ WorkflowDesigner.tsx. */

import type { WfPort } from "@erp-framework/core";
import { Handle, type Node, type NodeProps, Position } from "@xyflow/react";
import { getNodePalette } from "@/components/designer/workflow/node-palette";
import type { WfNodeData } from "@/components/designer/workflow/types";
import { useFieldDisplay } from "@/components/FieldDisplayToggle";
import { I } from "@/components/Icons";
import { useT } from "@/hooks/useT";
import type { IconName } from "@/lib/object-types";
import { cn } from "@/lib/utils";

/* Kích thước layout node: header cố định + mỗi cổng dữ liệu một hàng.
   Handle data được đặt top tuyệt đối theo HEADER_H + index*ROW. */
export const NODE_HEADER_H = 42;
export const NODE_PORT_ROW = 20;

export function nodePorts(data: WfNodeData, key: "inputs" | "outputs"): WfPort[] {
  const v = data.config?.[key];
  return Array.isArray(v) ? (v as WfPort[]) : [];
}

export function WfNode({ data }: NodeProps<Node<WfNodeData>>) {
  const t = useT();
  // Hiển thị cổng dữ liệu theo tên kỹ thuật (id) hay nhãn — tuỳ chọn toàn cục.
  const { mode: fieldMode } = useFieldDisplay();
  const meta = getNodePalette().find((p) => p.kind === data.kind);
  const IC = I[(meta?.icon ?? "Bot") as IconName];
  const isCondition = data.kind === "condition";
  const isSwitch = data.kind === "switch";
  const isApproval = data.kind === "approval";
  // Switch: 1 nhánh / case + nhánh "default" cuối. Handle id "case:<idx>"/"default".
  const switchCases = isSwitch
    ? Array.isArray(data.config?.cases)
      ? (data.config.cases as Array<{ value?: unknown; label?: string }>)
      : []
    : [];
  const switchBranches = isSwitch
    ? [
        ...switchCases.map((c, i) => ({ id: `case:${i}`, label: c.label || `case ${i + 1}` })),
        { id: "default", label: "default" },
      ]
    : [];
  const inPorts = nodePorts(data, "inputs");
  const outPorts = nodePorts(data, "outputs");
  const portRows = Math.max(inPorts.length, outPorts.length);
  const dataMin = portRows > 0 ? portRows * NODE_PORT_ROW + 6 : 0;
  // Switch cần đủ chỗ cho các nhánh control xếp dọc bên phải.
  const switchMin = isSwitch ? switchBranches.length * NODE_PORT_ROW + 6 : 0;
  const minHeight = NODE_HEADER_H + Math.max(dataMin, switchMin);
  const ctrlTop = NODE_HEADER_H / 2;
  return (
    <div
      className="card relative min-w-[180px] shadow-md"
      style={{ borderColor: meta?.color, minHeight }}
    >
      {/* Header: icon + nhãn */}
      <div className="flex items-center gap-2 px-3 py-2" style={{ height: NODE_HEADER_H }}>
        <span
          className="w-7 h-7 rounded-md flex items-center justify-center text-white shrink-0"
          style={{ background: meta?.color }}
        >
          <IC size={14} />
        </span>
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-wider text-muted font-semibold">
            {t(`wf.node.${data.kind}`)}
          </div>
          <div className="text-sm font-medium truncate">{data.label}</div>
        </div>
      </div>

      {/* Control-flow target (trái) — trigger không nhận control vào */}
      {data.kind !== "trigger" && (
        <Handle
          type="target"
          position={Position.Left}
          style={{ top: ctrlTop, background: meta?.color }}
        />
      )}
      {/* Control-flow source (phải) — condition rẽ Y/N, switch rẽ N nhánh,
          còn lại 1 cổng mặc định */}
      {isCondition ? (
        <>
          <Handle
            type="source"
            id="yes"
            position={Position.Right}
            style={{ top: ctrlTop - 7, background: "var(--success)" }}
          />
          <span
            className="absolute right-1.5 text-[8px] font-semibold text-success"
            style={{ top: ctrlTop - 13 }}
          >
            Y
          </span>
          <Handle
            type="source"
            id="no"
            position={Position.Right}
            style={{ top: ctrlTop + 7, background: "var(--danger)" }}
          />
          <span
            className="absolute right-1.5 text-[8px] font-semibold text-danger"
            style={{ top: ctrlTop + 3 }}
          >
            N
          </span>
        </>
      ) : isSwitch ? (
        switchBranches.map((b, i) => {
          const top = NODE_HEADER_H / 2 + i * NODE_PORT_ROW;
          const isDefault = b.id === "default";
          return (
            <div key={b.id}>
              <Handle
                type="source"
                id={b.id}
                position={Position.Right}
                style={{ top, background: isDefault ? "var(--muted)" : "var(--warning)" }}
              />
              <span
                className={cn(
                  "absolute right-3 text-[8px] font-semibold truncate max-w-[72px] text-right",
                  isDefault ? "text-muted" : "text-warning",
                )}
                style={{ top: top - 6 }}
              >
                {b.label}
              </span>
            </div>
          );
        })
      ) : isApproval ? (
        <>
          <Handle
            type="source"
            id="approved"
            position={Position.Right}
            style={{ top: ctrlTop - 7, background: "var(--success)" }}
          />
          <span
            className="absolute right-1.5 text-[8px] font-semibold text-success"
            style={{ top: ctrlTop - 13 }}
          >
            ✓
          </span>
          <Handle
            type="source"
            id="rejected"
            position={Position.Right}
            style={{ top: ctrlTop + 7, background: "var(--danger)" }}
          />
          <span
            className="absolute right-1.5 text-[8px] font-semibold text-danger"
            style={{ top: ctrlTop + 3 }}
          >
            ✕
          </span>
        </>
      ) : (
        <Handle
          type="source"
          position={Position.Right}
          style={{ top: ctrlTop, background: meta?.color }}
        />
      )}

      {/* Cổng INPUT dữ liệu (trái) — id handle "in:<portId>" */}
      {inPorts.map((p, i) => {
        const top = NODE_HEADER_H + 4 + i * NODE_PORT_ROW + NODE_PORT_ROW / 2;
        return (
          <div key={`in-${p.id}`}>
            <Handle
              type="target"
              id={`in:${p.id}`}
              position={Position.Left}
              style={{ top, background: "var(--accent-2)" }}
            />
            <span
              className="absolute left-3 text-[9px] text-accent-2 truncate max-w-[72px]"
              style={{ top: top - 7 }}
              title={fieldMode === "label" ? p.id : p.label || p.id}
            >
              {fieldMode === "label" ? p.label || p.id : p.id}
            </span>
          </div>
        );
      })}
      {/* Cổng OUTPUT dữ liệu (phải) — id handle "out:<portId>" */}
      {outPorts.map((p, i) => {
        const top = NODE_HEADER_H + 4 + i * NODE_PORT_ROW + NODE_PORT_ROW / 2;
        return (
          <div key={`out-${p.id}`}>
            <Handle
              type="source"
              id={`out:${p.id}`}
              position={Position.Right}
              style={{ top, background: "var(--accent)" }}
            />
            <span
              className="absolute right-3 text-[9px] text-accent truncate max-w-[72px] text-right"
              style={{ top: top - 7 }}
              title={fieldMode === "label" ? p.id : p.label || p.id}
            >
              {fieldMode === "label" ? p.label || p.id : p.id}
            </span>
          </div>
        );
      })}

      {/* Cổng nhánh LỖI (dưới) — id "error". Edge từ đây có label "error";
          runner đi nhánh này khi node lỗi thay vì dừng workflow. */}
      {data.kind !== "trigger" && (
        <>
          <Handle
            type="source"
            id="error"
            position={Position.Bottom}
            style={{ background: "var(--danger)" }}
          />
          <span
            className="absolute bottom-0.5 left-1/2 -translate-x-1/2 text-[8px] font-semibold text-danger"
            style={{ pointerEvents: "none" }}
          >
            err
          </span>
        </>
      )}
    </div>
  );
}

export const NODE_TYPES = { wf: WfNode };
