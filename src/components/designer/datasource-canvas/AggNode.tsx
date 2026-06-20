/* AggGhostNode — node "bóng" cho quan hệ tổng hợp (1-N/N-N/far).
   Tách từ DataSourceCanvas.tsx. */
import { Handle, type NodeProps, Position } from "@xyflow/react";
import type { AggNodeType } from "@/components/designer/datasource-canvas/types";
import { I } from "@/components/Icons";
import { cn } from "@/lib/utils";

export function AggGhostNode({ data, selected }: NodeProps<AggNodeType>) {
  return (
    <div
      className={cn(
        "bg-panel/80 border-2 border-dashed rounded-xl shadow-sm min-w-[170px] max-w-[210px] text-sm select-none",
        selected ? "border-accent" : "border-accent/40",
      )}
    >
      <Handle
        type="target"
        id="agg-in"
        position={Position.Top}
        isConnectable={false}
        className="!w-2 !h-2 !bg-accent !border-0"
      />
      <Handle
        type="source"
        id="agg-out"
        position={Position.Bottom}
        isConnectable={false}
        className="!w-2 !h-2 !bg-accent !border-0"
      />
      <div className="flex items-center gap-2 px-3 py-2 border-b border-dashed border-border">
        <I.BarChart size={11} className="text-accent shrink-0" />
        <span className="font-semibold flex-1 truncate text-[12px]">{data.entityName}</span>
        <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-accent/15 text-accent shrink-0">
          {data.badge}
        </span>
      </div>
      <div className="px-3 py-1.5 text-[11px] text-muted space-y-0.5">
        {data.fn && (
          <div>
            fn: <b className="text-text uppercase">{data.fn}</b>
          </div>
        )}
        {data.byField && (
          <div>
            FK: <span className="font-mono">{data.byField}</span>
          </div>
        )}
        {data.valueField && (
          <div>
            value: <span className="font-mono">{data.valueField}</span>
          </div>
        )}
        <div className="font-mono text-accent/70 truncate">→ {data.aggKey}</div>
      </div>
    </div>
  );
}
