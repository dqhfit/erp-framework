/* ==========================================================
   erd-entity-node.tsx — Custom node cho ERD canvas.
   Handles: PK field row (right) = target; FK field rows (left) = source.
   ========================================================== */

import { Handle, type Node, Position, type NodeProps } from "@xyflow/react";
import { useNavigate } from "@tanstack/react-router";
import { I } from "@/components/Icons";
import { FALLBACK_FIELD_TYPE, getFieldTypes } from "@/lib/field-types";
import type { MockEntity } from "@/lib/object-types";
import { cn } from "@/lib/utils";
import { useUserObjects } from "@/stores/userObjects";

const REF_TYPES = new Set(["lookup", "multi-lookup", "collection"]);

export interface EntityERDNodeData extends Record<string, unknown> {
  entity: MockEntity;
  onEntityClick?: (id: string) => void;
  onHide?: (id: string) => void;
  onSetPrimaryKey?: (entityId: string, fieldId: string) => void;
}

export type EntityERDNodeType = Node<EntityERDNodeData>;

export function EntityERDNode({ data, selected }: NodeProps<EntityERDNodeType>) {
  const entity = data.entity as MockEntity;
  const allEntities = useUserObjects((s) => s.entities);
  const onEntityClick = data.onEntityClick as ((id: string) => void) | undefined;
  const onHide = data.onHide as ((id: string) => void) | undefined;
  const onSetPK = data.onSetPrimaryKey as ((entityId: string, fieldId: string) => void) | undefined;
  const navigate = useNavigate();
  const fieldTypes = getFieldTypes();

  const getIcon = (type: string) => {
    const ft = fieldTypes.find((f) => f.id === type) ?? FALLBACK_FIELD_TYPE;
    return I[ft.icon] ?? I.Type;
  };

  /* Build lookup: entityId/name → primaryKey field id */
  const pkById = new Map(allEntities.map((e) => [e.id, e.primaryKey]));
  const pkByName = new Map(allEntities.map((e) => [e.name, e.primaryKey]));

  /* Does the designated primaryKey field actually exist? */
  const pkFieldExists = entity.primaryKey
    ? entity.fields.some((f) => f.id === entity.primaryKey)
    : false;

  return (
    <div
      className={cn(
        "group bg-panel border-2 rounded-xl shadow-md min-w-[220px] max-w-[260px] text-sm select-none",
        selected ? "border-accent" : "border-border",
      )}
    >
      {/* Fallback target handle — shown only when no valid PK is designated */}
      {!pkFieldExists && (
        <Handle
          type="target"
          id="incoming"
          position={Position.Right}
          className="!w-2 !h-2 !bg-panel !border !border-muted"
        />
      )}

      {/* Header */}
      <div
        className="flex items-center gap-2 px-3 py-2 border-b border-border cursor-pointer rounded-t-xl hover:bg-hover/30 transition-colors"
        onClick={() => onEntityClick?.(entity.id)}
      >
        <div className="w-6 h-6 rounded-md bg-accent/15 flex items-center justify-center text-accent shrink-0">
          {(() => {
            const IC = I[entity.icon] ?? I.Database;
            return <IC size={12} />;
          })()}
        </div>
        <span className="font-semibold flex-1 truncate text-[13px]">{entity.name}</span>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onHide?.(entity.id);
          }}
          className="opacity-0 group-hover:opacity-100 w-5 h-5 rounded hover:bg-hover/60 flex items-center justify-center text-muted transition-opacity"
          title="Ẩn bảng"
        >
          <I.EyeOff size={11} />
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            navigate({ to: "/entities/$id", params: { id: entity.id } });
          }}
          className="opacity-0 group-hover:opacity-100 w-5 h-5 rounded hover:bg-hover/60 flex items-center justify-center text-muted transition-opacity"
          title="Mở editor"
        >
          <I.ExternalLink size={11} />
        </button>
      </div>

      {/* Fields */}
      <div className="py-1 max-h-[260px] overflow-y-auto">
        {entity.fields.length === 0 && (
          <div className="px-3 py-2 text-xs text-muted italic">Chưa có field</div>
        )}
        {entity.fields.slice(0, 12).map((f) => {
          const IC = getIcon(f.type);
          const isRefField = REF_TYPES.has(f.type);
          const isPK = entity.primaryKey === f.id;

          /* FK-to-PK: ref field trỏ tới entity có PK */
          const targetPK =
            isRefField && f.ref ? (pkById.get(f.ref) ?? pkByName.get(f.ref)) : undefined;
          const isFKtoPK =
            isRefField &&
            !!targetPK &&
            !!f.ref &&
            allEntities.some(
              (e) =>
                (e.id === f.ref || e.name === f.ref) &&
                e.primaryKey &&
                e.fields.some((ff) => ff.id === e.primaryKey),
            );

          return (
            <div
              key={f.id}
              className={cn(
                "relative flex items-center gap-1.5 px-3 py-[5px] hover:bg-hover/20 group/field",
                isPK && "bg-warning/5",
              )}
            >
              {/* ── FK source handle — bên TRÁI, ngay trên hàng field ── */}
              {isRefField && (
                <Handle
                  type="source"
                  id={`field-${f.id}`}
                  position={Position.Left}
                  className="!w-2 !h-2 !bg-accent !border-0 !left-[-4px]"
                />
              )}

              {/* ── PK target handle — bên PHẢI, ngay trên hàng PK ── */}
              {isPK && (
                <Handle
                  type="target"
                  id={`pk-${f.id}`}
                  position={Position.Right}
                  className="!w-2 !h-2 !bg-warning !border-0 !right-[-4px]"
                />
              )}

              {/* Key icon column */}
              {isPK ? (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onSetPK?.(entity.id, f.id);
                  }}
                  className="shrink-0 text-warning hover:opacity-70 transition-opacity"
                  title="Khoá chính — bấm để bỏ"
                >
                  <I.Key size={11} />
                </button>
              ) : !isRefField ? (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onSetPK?.(entity.id, f.id);
                  }}
                  className="shrink-0 opacity-0 group-hover/field:opacity-30 hover:!opacity-70 text-muted transition-opacity"
                  title="Đặt làm khoá chính"
                >
                  <I.Key size={11} />
                </button>
              ) : (
                <span
                  className={cn("shrink-0", isFKtoPK ? "text-accent" : "text-transparent")}
                  title={isFKtoPK ? "Khoá ngoại → khoá chính" : undefined}
                >
                  <I.Key size={11} />
                </span>
              )}

              <IC
                size={11}
                className={cn(
                  "shrink-0",
                  isRefField ? "text-accent" : isPK ? "text-warning" : "text-muted",
                )}
              />
              <span
                className={cn(
                  "flex-1 truncate text-xs font-mono",
                  isPK && "font-semibold text-warning",
                )}
              >
                {f.name}
              </span>
              {isRefField && f.ref ? (
                <span
                  className="text-[10px] text-accent/70 shrink-0 truncate max-w-[72px]"
                  title={f.ref}
                >
                  {allEntities.find((e) => e.id === f.ref || e.name === f.ref)?.name ?? f.ref}
                </span>
              ) : (
                <span className="text-[10px] text-muted shrink-0">{f.type}</span>
              )}
            </div>
          );
        })}
        {entity.fields.length > 12 && (
          <div className="px-3 py-1 text-[10px] text-muted">
            +{entity.fields.length - 12} fields nữa...
          </div>
        )}
      </div>

      {/* Footer — source handle để kéo tạo relationship mới — bên TRÁI */}
      <div className="relative border-t border-border px-3 py-1.5 flex items-center rounded-b-xl">
        <Handle
          type="source"
          id="add-rel"
          position={Position.Left}
          className="!w-2 !h-2 !bg-muted !border !border-panel !left-2"
        />
        <span className="text-[10px] text-muted ml-4">Kéo để thêm relationship</span>
      </div>
    </div>
  );
}
