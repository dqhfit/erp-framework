/* DSNode — node entity trên canvas DataSource: danh sách field (chiếu/ẩn),
   handle join, nút thêm field. Tách từ DataSourceCanvas.tsx. */
import { Handle, type NodeProps, Position, useUpdateNodeInternals } from "@xyflow/react";
import { useEffect, useMemo } from "react";
import type { DSNodeType } from "@/components/designer/datasource-canvas/types";
import { I } from "@/components/Icons";
import { cn } from "@/lib/utils";
import { useUserObjects } from "@/stores/userObjects";

export function DSNode({ data, selected, id }: NodeProps<DSNodeType>) {
  const entities = useUserObjects((s) => s.entities);
  const ent = entities.find((e) => e.id === data.entityId);
  const updateNodeInternals = useUpdateNodeInternals();

  // Ghim field tham gia liên kết lên ĐẦU danh sách (giữ thứ tự gốc trong
  // từng nhóm) — handle của cạnh luôn hiện trong hộp cuộn.
  const joinSet = useMemo(() => new Set(data.joinFields), [data.joinFields]);
  const fields = useMemo(() => {
    const all = ent?.fields ?? [];
    if (joinSet.size === 0) return all;
    return [...all.filter((f) => joinSet.has(f.name)), ...all.filter((f) => !joinSet.has(f.name))];
  }, [ent?.fields, joinSet]);

  // Thứ tự field đổi → vị trí handle trong node đổi → báo ReactFlow đo lại
  // để cạnh bám đúng dòng (không tự re-anchor khi kích thước node không đổi).
  const joinSig = data.joinFields.join(",");
  // biome-ignore lint/correctness/useExhaustiveDependencies: joinSig là tín hiệu đo lại có chủ ý
  useEffect(() => {
    updateNodeInternals(id);
  }, [joinSig, id, updateNodeInternals]);

  return (
    <div
      className={cn(
        "bg-panel border-2 rounded-xl shadow-md min-w-[210px] max-w-[250px] text-sm select-none",
        selected ? "border-accent" : "border-border",
      )}
    >
      {/* Handle "id" (record id) cho join cổ điển lookup → id (thả vào để khớp record id) */}
      <Handle
        type="target"
        id="tgt-id"
        position={Position.Left}
        title="Khớp theo record id (thả cột nguồn vào đây)"
        className="!w-2.5 !h-2.5 !bg-warning !border-0 !top-[18px] hover:!scale-125"
      />
      {/* Handle phát aggregate (1-N / N-N) — đáy node */}
      <Handle
        type="source"
        id="agg-out"
        position={Position.Bottom}
        isConnectable={false}
        className="!w-2 !h-2 !bg-accent !border-0"
      />

      {/* Header — KHÔNG lồng button trong button (HTML không hợp lệ → DOM lệch → nháy).
          Nút tiêu đề + nút hành động là anh em ngang hàng trong 1 div. */}
      <div className="w-full flex items-center gap-2 px-3 py-2 border-b border-border rounded-t-xl hover:bg-hover/30 transition-colors">
        <button
          type="button"
          onClick={() => data.onSelect(data.nodeId)}
          className="flex flex-1 min-w-0 items-center gap-2 text-left"
        >
          <div className="w-5 h-5 rounded-md bg-accent/15 flex items-center justify-center text-accent shrink-0">
            {(() => {
              const IC = ent ? (I[ent.icon] ?? I.Database) : I.Database;
              return <IC size={11} />;
            })()}
          </div>
          <span className="font-semibold flex-1 truncate text-[13px]">
            {data.alias}
            {data.isBase && <span className="ml-1 text-[10px] text-accent">(gốc)</span>}
          </span>
        </button>
        {data.entityId && data.onAddField && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              data.onAddField?.(data.entityId as string);
            }}
            className="w-5 h-5 rounded hover:bg-accent/15 flex items-center justify-center text-muted hover:text-accent shrink-0"
            title="Thêm trường vào entity"
          >
            <I.Plus size={11} />
          </button>
        )}
        {!data.isBase && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              data.onRemove(data.nodeId);
            }}
            className="w-5 h-5 rounded hover:bg-danger/15 flex items-center justify-center text-muted hover:text-danger shrink-0"
            title="Xoá quan hệ"
          >
            <I.X size={11} />
          </button>
        )}
      </div>

      {/* Fields — cuộn dọc nhưng KHÔNG cắt handle ở mép:
          • -mx-3 px-3: nới vùng cắt (clip box) ra 12px mỗi bên cho handle lọt vào,
            nội dung (rows) vẫn đúng bề rộng node nhờ padding bù.
          • nowheel + ẩn thanh cuộn (.ds-fields-scroll): cuộn bằng lăn chuột, thanh
            cuộn không chiếm chỗ nên không đè lên handle bên phải. */}
      <div className="py-1 -mx-3 px-3 max-h-[240px] overflow-y-auto nowheel ds-fields-scroll">
        {fields.length === 0 && (
          <div className="px-3 py-2 text-xs text-muted italic">Chưa có field</div>
        )}
        {fields.map((f) => {
          const on = data.projected.has(f.name);
          const isJoin = joinSet.has(f.name);
          const hasLabel = !!f.label?.trim() && f.label !== f.name;
          return (
            <div
              key={f.id}
              className={cn(
                "relative flex items-center gap-1.5 px-3 py-[3px] hover:bg-hover/20",
                isJoin && "bg-accent/10",
              )}
            >
              {/* target handle (trái) — node này là con, khớp trên cột này */}
              <Handle
                type="target"
                id={`tgt-${f.name}`}
                position={Position.Left}
                title="Khớp vào cột này (thả cột nguồn vào đây)"
                className="!w-2.5 !h-2.5 !bg-warning/70 !border-0 !left-[-4px] hover:!scale-125 hover:!bg-warning"
              />
              {/* source handle (phải) — node này là cha, kéo từ cột này sang cột bảng khác để nối */}
              <Handle
                type="source"
                id={`src-${f.name}`}
                position={Position.Right}
                title="Kéo từ cột này sang cột bảng khác để tạo liên kết"
                className="!w-2.5 !h-2.5 !bg-accent/70 !border-0 !right-[-4px] hover:!scale-125 hover:!bg-accent"
              />
              {/* Bấm vào cả label (checkbox + tên + kiểu) đều toggle chọn cột vào bảng phẳng. */}
              <label
                className="flex flex-1 min-w-0 items-center gap-1.5 cursor-pointer"
                title="Bấm để chọn/bỏ chọn cột vào bảng phẳng"
              >
                <input
                  type="checkbox"
                  className="accent-accent shrink-0"
                  checked={on}
                  onChange={() => data.onToggleField(data.nodeId, f.name)}
                />
                <span className={cn("flex-1 min-w-0 text-xs", on ? "text-text" : "text-muted")}>
                  <span className="block truncate">{hasLabel ? f.label : f.name}</span>
                  {hasLabel && (
                    <span className="block truncate font-mono text-[9px] text-muted/60">
                      {f.name}
                    </span>
                  )}
                </span>
                {isJoin && (
                  <span className="text-accent shrink-0" title="Cột tham gia liên kết">
                    <I.Link size={9} />
                  </span>
                )}
                <span className="text-[10px] text-muted shrink-0">{f.type}</span>
              </label>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ── Ghost node: đối tượng "nhiều" của aggregate (1-N child / N-N junction / far) ── */
