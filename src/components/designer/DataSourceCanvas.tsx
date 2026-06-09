/* ==========================================================
   DataSourceCanvas — builder "Nguồn dữ liệu" kiểu ERD (canvas).
   Mỗi node = 1 đối tượng (base hoặc 1 relation). Cạnh = quan hệ
   join (cột↔cột: from.fromField = target.toField). Popup "Thêm
   đối tượng" để đưa entity vào canvas + thiết lập cột join. Tick
   cột ngay trên node để đưa vào projection. Panel phải sửa join +
   cột chi tiết. Lưu qua userObjects.setDataSourceContent (optimistic).

   Mô hình vẫn là CÂY gốc base (resolver batch-stitch), canvas chỉ
   là cách trình bày + thao tác trực quan. Join cột↔cột giả định
   many-to-one (record đích đầu tiên khớp).
   ========================================================== */

import { createObjectsClient } from "@erp-framework/client";
import type {
  DataSourceAggregate,
  DataSourceComputed,
  DataSourceConfig,
  DataSourceField,
  DataSourceRelation,
  DataSourceRow,
} from "@erp-framework/core";
import {
  Background,
  type Connection,
  Controls,
  type Edge,
  Handle,
  MarkerType,
  MiniMap,
  type Node,
  type NodeProps,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useNodesState,
  useReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MobileDesignerNotice } from "@/components/designer/MobileDesignerNotice";
import { FieldDisplayToggle, useFieldDisplay } from "@/components/FieldDisplayToggle";
import { I } from "@/components/Icons";
import { Button, Card, FormField, Input, SearchableSelect, Tabs } from "@/components/ui";
import { useIsMobile } from "@/hooks/useMediaQuery";
import { type LinkSuggestion, suggestLinks } from "@/lib/datasource-autolink";
import { dialog } from "@/lib/dialog";
import type { EntityField } from "@/lib/object-types";
import { cn } from "@/lib/utils";
import { slugify, useUserObjects } from "@/stores/userObjects";
import {
  AddAggregate,
  AddEntityFieldForm,
  AddEntityFieldModal,
  ComputedColumns,
  type FlatCol,
} from "./DataSourceDesigner";

const dsApi = createObjectsClient("");
const EMPTY: DataSourceConfig = { baseEntityId: "", relations: [], fields: [] };

/** Field lookup/multi-lookup của `ent` trỏ tới entity `toEntityId` (= khoá ngoại). */
function lookupTo(
  ent: { fields: EntityField[] } | undefined,
  toEntityId: string,
): EntityField | undefined {
  return ent?.fields.find(
    (f) => (f.type === "lookup" || f.type === "multi-lookup") && f.ref === toEntityId,
  );
}

/* ── Custom node ──────────────────────────────────────────── */
interface DSNodeData extends Record<string, unknown> {
  nodeId: string;
  entityId: string | undefined;
  alias: string;
  isBase: boolean;
  projected: Set<string>;
  /** Hiển thị tên cột (name) hay nhãn (label) của trường trên node. */
  fieldMode: "name" | "label";
  onToggleField: (nodeId: string, fieldName: string) => void;
  onSelect: (nodeId: string) => void;
  onRemove: (nodeId: string) => void;
  onAddField?: (entityId: string) => void;
}
type DSNodeType = Node<DSNodeData>;

function DSNode({ data, selected }: NodeProps<DSNodeType>) {
  const entities = useUserObjects((s) => s.entities);
  const ent = entities.find((e) => e.id === data.entityId);
  const fields = ent?.fields ?? [];

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
          // Hiển thị theo chế độ: nhãn (label) hoặc tên cột (name); tooltip hiện cái còn lại.
          const disp = data.fieldMode === "label" ? f.label || f.name : f.name;
          const alt = data.fieldMode === "label" ? f.name : f.label || f.name;
          return (
            <div
              key={f.id}
              className="relative flex items-center gap-1.5 px-3 py-[3px] hover:bg-hover/20"
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
                <span
                  className={cn(
                    "flex-1 truncate text-xs",
                    data.fieldMode === "label" ? "" : "font-mono",
                    on ? "text-text" : "text-muted",
                  )}
                  title={alt}
                >
                  {disp}
                </span>
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
interface AggNodeData extends Record<string, unknown> {
  aggKey: string;
  entityName: string;
  badge: string; // "1-N" | "N-N" | "far"
  fn?: string;
  byField?: string;
  valueField?: string;
}
type AggNodeType = Node<AggNodeData>;

function AggGhostNode({ data, selected }: NodeProps<AggNodeType>) {
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

const nodeTypes = { dsNode: DSNode, aggNode: AggGhostNode } as const;

/** Chữ ký phần dữ liệu HIỂN THỊ của 1 node (bỏ qua callback ổn định). Dùng để
 *  tái dùng node cũ khi tick cột: chỉ node có chữ ký đổi mới dựng lại → ReactFlow
 *  không re-render mọi node mỗi lần chọn cột (tránh lag khi chọn nhiều cột). */
function nodeDataSig(n: Node): string {
  const d = n.data as Partial<DSNodeData & AggNodeData>;
  if (n.type === "aggNode") {
    return `agg|${d.entityName ?? ""}|${d.badge ?? ""}|${d.fn ?? ""}|${d.byField ?? ""}|${d.valueField ?? ""}`;
  }
  const proj = d.projected ? [...d.projected].sort().join(",") : "";
  return `ds|${d.entityId ?? ""}|${d.alias ?? ""}|${d.isBase ? 1 : 0}|${d.fieldMode ?? ""}|${proj}`;
}

/* ── Add-object dialog state ──────────────────────────────── */
/** 1 đối tượng đích trong danh sách "thêm cùng lúc" — mỗi dòng 1 liên kết.
 *  KHÔNG có "node cha" chung: mỗi dòng tự chọn `fromRid` (nối từ đâu) —
 *  có thể là node đã có trên canvas HOẶC một bảng khác đang được chọn (rid tạm). */
interface AddRow {
  /** id tạm (key React + remove + tham chiếu chéo giữa các dòng); KHÔNG phải relation id. */
  rid: string;
  targetEntityId: string;
  /** Nối từ: node canvas ("base" | relationId) HOẶC rid tạm của 1 dòng khác. */
  fromRid: string;
  fromField: string;
  toField: string; // "id" hoặc tên cột đích
  joinKind: "left" | "inner";
  alias: string;
  /** Liên kết được suy ra tự động từ FK (lookup) — chỉ để hiển thị badge. */
  autoLinked: boolean;
}
interface AddState {
  open: boolean;
  rows: AddRow[];
}
const ADD_CLOSED: AddState = { open: false, rows: [] };

/* ── Inner canvas ─────────────────────────────────────────── */
function Canvas({ id }: { id: string }) {
  const { fitView } = useReactFlow();
  const isMobile = useIsMobile();
  const entities = useUserObjects((s) => s.entities);
  const cfg = useUserObjects((s) => s.dataSourceContent[id]) ?? EMPTY;
  const setContent = useUserObjects((s) => s.setDataSourceContent);

  const update = useCallback(
    (patch: Partial<DataSourceConfig>) => setContent(id, { ...cfg, ...patch }),
    [cfg, id, setContent],
  );

  /* ── Node helpers ─────────────────────────────────────────── */
  const entById = useCallback((eid?: string) => entities.find((e) => e.id === eid), [entities]);
  const nodeEntityId = useCallback(
    (rid: string): string | undefined =>
      rid === "base" ? cfg.baseEntityId : cfg.relations.find((r) => r.id === rid)?.targetEntityId,
    [cfg.baseEntityId, cfg.relations],
  );
  const nodeAlias = useCallback(
    (rid: string): string =>
      rid === "base"
        ? entById(cfg.baseEntityId)?.name || "Gốc"
        : cfg.relations.find((r) => r.id === rid)?.alias || rid,
    [cfg.baseEntityId, cfg.relations, entById],
  );
  const nodeFields = useCallback(
    (rid: string): EntityField[] => entById(nodeEntityId(rid))?.fields ?? [],
    [entById, nodeEntityId],
  );

  /* ── Projection ───────────────────────────────────────────── */
  const mkKey = useCallback(
    (rid: string, fname: string) => (rid === "base" ? fname : `${nodeAlias(rid)}_${fname}`),
    [nodeAlias],
  );
  const toggleField = useCallback(
    (rid: string, fname: string) => {
      const ent = entById(nodeEntityId(rid));
      const field = ent?.fields.find((f) => f.name === fname);
      const has = cfg.fields.some((f) => f.sourceRelationId === rid && f.sourceField === fname);
      if (has) {
        update({
          fields: cfg.fields.filter(
            (f) => !(f.sourceRelationId === rid && f.sourceField === fname),
          ),
        });
      } else if (field) {
        const nf: DataSourceField = {
          key: mkKey(rid, fname),
          sourceRelationId: rid,
          sourceField: fname,
          label: field.label || fname,
          type: field.type,
          writable: rid === "base",
        };
        update({ fields: [...cfg.fields, nf] });
      }
    },
    [cfg.fields, entById, nodeEntityId, mkKey, update],
  );
  const patchField = useCallback(
    (key: string, patch: Partial<DataSourceField>) =>
      update({ fields: cfg.fields.map((f) => (f.key === key ? { ...f, ...patch } : f)) }),
    [cfg.fields, update],
  );

  /* ── Relations ────────────────────────────────────────────── */
  const removeRelation = useCallback(
    (rid: string) => {
      const dead = new Set([rid]);
      let changed = true;
      while (changed) {
        changed = false;
        for (const r of cfg.relations) {
          if (r.fromRelationId && dead.has(r.fromRelationId) && !dead.has(r.id)) {
            dead.add(r.id);
            changed = true;
          }
        }
      }
      update({
        relations: cfg.relations.filter((r) => !dead.has(r.id)),
        fields: cfg.fields.filter(
          (f) => f.sourceRelationId === "base" || !dead.has(f.sourceRelationId),
        ),
      });
    },
    [cfg.relations, cfg.fields, update],
  );
  const patchRelation = useCallback(
    (rid: string, patch: Partial<DataSourceRelation>) =>
      update({ relations: cfg.relations.map((r) => (r.id === rid ? { ...r, ...patch } : r)) }),
    [cfg.relations, update],
  );

  /* ── Kéo cột → cột để tạo/đổi liên kết (ERD-style) ──────────── */
  // Đặt parent của `target` = `source` có tạo vòng lặp không? (source là con-cháu của target)
  const wouldCycle = useCallback(
    (sourceId: string, targetId: string): boolean => {
      if (sourceId === targetId) return true;
      let cur: string | null = sourceId;
      const seen = new Set<string>();
      while (cur && cur !== "base" && !seen.has(cur)) {
        if (cur === targetId) return true;
        seen.add(cur);
        cur = cfg.relations.find((r) => r.id === cur)?.fromRelationId ?? "base";
      }
      return false;
    },
    [cfg.relations],
  );
  // Thả 1 connection: source.<cột nguồn> → target.<cột đích>. Gán join cho relation đích.
  const onConnect = useCallback(
    (conn: Connection) => {
      const { source, sourceHandle, target, targetHandle } = conn;
      if (!source || !target || source === target) return;
      if (target === "base") {
        dialog.alert("Không thể nối VÀO đối tượng gốc — kéo theo chiều cha → con.");
        return;
      }
      const rel = cfg.relations.find((r) => r.id === target);
      if (!rel) {
        dialog.alert("Đích phải là một đối tượng đã thêm trên canvas.");
        return;
      }
      // Nguồn phải là node thật (base | relation), không phải ghost aggregate.
      if (source !== "base" && !cfg.relations.some((r) => r.id === source)) return;
      const fromField = sourceHandle?.startsWith("src-") ? sourceHandle.slice(4) : "";
      const toRaw =
        targetHandle === "tgt-id"
          ? "id"
          : targetHandle?.startsWith("tgt-")
            ? targetHandle.slice(4)
            : "";
      if (!fromField || !toRaw) return;
      if (wouldCycle(source, target)) {
        dialog.alert("Liên kết này tạo vòng lặp — chọn hướng cha → con khác.");
        return;
      }
      patchRelation(target, {
        fromRelationId: source === "base" ? null : source,
        fromField,
        toField: toRaw === "id" ? undefined : toRaw,
      });
      setSelectedNodeId(target);
    },
    [cfg.relations, patchRelation, wouldCycle],
  );

  /* ── Selection + UI state ─────────────────────────────────── */
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [panelTab, setPanelTab] = useState<"config" | "agg" | "computed" | "addfield">("config");
  const [computedPanelOpen, setComputedPanelOpen] = useState(false);
  const [addFieldEntityId, setAddFieldEntityId] = useState<string | null>(null);
  const [add, setAdd] = useState<AddState>(ADD_CLOSED);
  // Lọc danh sách đối tượng trong popup "Thêm đối tượng".
  const [addSearch, setAddSearch] = useState("");
  const [preview, setPreview] = useState<DataSourceRow[] | null>(null);
  const [previewing, setPreviewing] = useState(false);
  // Auto-link: panel đề xuất liên kết + tập id đã bỏ qua (ẩn trong phiên).
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [dismissedLinks, setDismissedLinks] = useState<Set<string>>(new Set());
  // Chế độ hiển thị trường (TOÀN CỤC) — đồng bộ Nguồn dữ liệu / Trang / Workflow.
  const { mode: fieldMode, fieldDisp } = useFieldDisplay();
  // Hiển thị tên cột (string) trong ngữ cảnh 1 entity — tra field để lấy nhãn nếu cần.
  // useCallback để dùng được trong buildNodes/edges memo mà không vỡ deps.
  const colDisp = useCallback(
    (entityId: string | undefined, fname?: string) => {
      if (!fname || fname === "id") return fname || "id";
      const f = entById(entityId)?.fields.find((x) => x.name === fname);
      if (!f) return fname;
      return fieldMode === "label" ? f.label || f.name : f.name;
    },
    [entById, fieldMode],
  );

  /* ── Layout (vị trí node) ─────────────────────────────────── */
  const STORAGE_KEY = `ds-erd-${id}`;
  const loadLayout = (): Record<string, { x: number; y: number }> => {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    } catch {
      return {};
    }
  };
  const layoutRef = useRef<Record<string, { x: number; y: number }>>(loadLayout());

  const nodeIds = useMemo(() => ["base", ...cfg.relations.map((r) => r.id)], [cfg.relations]);

  const projectedByNode = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const f of cfg.fields) {
      let s = m.get(f.sourceRelationId);
      if (!s) {
        s = new Set();
        m.set(f.sourceRelationId, s);
      }
      s.add(f.sourceField);
    }
    return m;
  }, [cfg.fields]);

  // Callback ổn định (qua ref) — node tái dùng KHÔNG bị stale-closure mà identity
  // vẫn cố định, nhờ đó node không-đổi giữ nguyên data reference → bỏ qua re-render.
  const toggleFieldRef = useRef(toggleField);
  toggleFieldRef.current = toggleField;
  const removeRelationRef = useRef(removeRelation);
  removeRelationRef.current = removeRelation;
  const onToggleFieldStable = useCallback(
    (rid: string, fname: string) => toggleFieldRef.current(rid, fname),
    [],
  );
  const onRemoveStable = useCallback((rid: string) => removeRelationRef.current(rid), []);

  const buildNodes = useCallback((): Node[] => {
    const joinNodes: Node[] = nodeIds.map((rid, i) => ({
      id: rid,
      type: "dsNode" as const,
      position: layoutRef.current[rid] ?? { x: (i % 3) * 300, y: Math.floor(i / 3) * 280 },
      data: {
        nodeId: rid,
        entityId: nodeEntityId(rid),
        alias: nodeAlias(rid),
        isBase: rid === "base",
        projected: projectedByNode.get(rid) ?? new Set<string>(),
        fieldMode,
        onToggleField: onToggleFieldStable,
        onSelect: setSelectedNodeId,
        onRemove: onRemoveStable,
        onAddField: setAddFieldEntityId,
      } as DSNodeData,
    }));

    // Ghost node cho đối tượng "nhiều" của mỗi aggregate (1-N child / N-N junction + far).
    const ghost: Node[] = [];
    (cfg.aggregates ?? []).forEach((a, i) => {
      const childId = `agg:${a.key}`;
      ghost.push({
        id: childId,
        type: "aggNode" as const,
        position: layoutRef.current[childId] ?? { x: i * 240, y: 360 },
        data: {
          aggKey: a.key,
          entityName: entById(a.targetEntityId)?.name ?? a.targetEntityId,
          badge: a.via ? "N-N" : "1-N",
          fn: a.agg,
          byField: colDisp(a.targetEntityId, a.targetField),
          valueField: a.via ? undefined : colDisp(a.targetEntityId, a.valueField),
        } as AggNodeData,
      });
      if (a.via) {
        const farId = `aggfar:${a.key}`;
        ghost.push({
          id: farId,
          type: "aggNode" as const,
          position: layoutRef.current[farId] ?? { x: i * 240 + 40, y: 600 },
          data: {
            aggKey: a.key,
            entityName: entById(a.via.farEntityId)?.name ?? a.via.farEntityId,
            badge: "far",
            valueField: colDisp(a.via.farEntityId, a.valueField),
          } as AggNodeData,
        });
      }
    });
    return [...joinNodes, ...ghost];
  }, [
    nodeIds,
    nodeEntityId,
    nodeAlias,
    projectedByNode,
    fieldMode,
    colDisp,
    onToggleFieldStable,
    onRemoveStable,
    cfg.aggregates,
    entById,
  ]);

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>(buildNodes());

  /* Resync nodes khi cfg/entities đổi (giữ vị trí hiện tại). */
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    setNodes((prev) => {
      const prevById = new Map(prev.map((n) => [n.id, n]));
      return buildNodes().map((n) => {
        const old = prevById.get(n.id);
        if (!old) return n; // node mới
        // Chữ ký dữ liệu KHÔNG đổi → tái dùng node CŨ (cùng reference) để ReactFlow
        // bỏ qua re-render node đó.
        if (old.type === n.type && nodeDataSig(old) === nodeDataSig(n)) return old;
        // Data đổi → GIỮ nguyên node cũ (measured/width/height/position/selected) và chỉ
        // thay `data`. Nếu dựng node mới thiếu `measured` → ReactFlow ẩn (visibility:hidden)
        // rồi đo lại = nháy. Giữ internals cũ để chỉ re-render nội dung.
        return { ...old, type: n.type, data: n.data };
      });
    });
  }, [buildNodes, setNodes]);

  const edges = useMemo((): Edge[] => {
    const labelStyle = {
      fontSize: 9,
      fill: "hsl(var(--text))",
      fontFamily: "ui-monospace, monospace",
    };
    const labelBgStyle = { fill: "hsl(var(--panel))", fillOpacity: 0.95 };

    // Relation chưa nối (fromField rỗng) → node hiện nhưng KHÔNG vẽ cạnh; kéo cột để nối.
    const relEdges: Edge[] = cfg.relations
      .filter((rel) => rel.fromField)
      .map((rel) => {
        const to = rel.toField && rel.toField !== "id" ? rel.toField : "id";
        return {
          id: rel.id,
          source: rel.fromRelationId ?? "base",
          sourceHandle: `src-${rel.fromField}`,
          target: rel.id,
          targetHandle: `tgt-${to}`,
          label: `${colDisp(nodeEntityId(rel.fromRelationId ?? "base"), rel.fromField)} = ${colDisp(nodeEntityId(rel.id), to)}`,
          labelStyle,
          labelBgStyle,
          labelBgPadding: [3, 2] as [number, number],
          labelBgBorderRadius: 3,
          markerEnd: {
            type: MarkerType.ArrowClosed,
            width: 10,
            height: 10,
            color: "hsl(var(--accent))",
          },
          style: {
            stroke: "hsl(var(--accent))",
            strokeWidth: 1,
            strokeDasharray: rel.joinKind === "inner" ? undefined : "5,3",
          },
          type: "smoothstep",
        };
      });

    // Cạnh aggregate (nét đứt, màu accent-2): node nguồn → đối tượng "nhiều"; N-N thêm junction → far.
    const aggEdges: Edge[] = [];
    for (const a of cfg.aggregates ?? []) {
      const src = a.sourceRelationId ?? "base";
      aggEdges.push({
        id: `agge:${a.key}`,
        source: src,
        sourceHandle: "agg-out",
        target: `agg:${a.key}`,
        targetHandle: "agg-in",
        label: `${a.agg.toUpperCase()}${a.agg !== "count" && !a.via && a.valueField ? `(${colDisp(a.targetEntityId, a.valueField)})` : ""} · ${colDisp(a.targetEntityId, a.targetField)}`,
        labelStyle,
        labelBgStyle,
        labelBgPadding: [3, 2] as [number, number],
        labelBgBorderRadius: 3,
        markerEnd: {
          type: MarkerType.ArrowClosed,
          width: 10,
          height: 10,
          color: "hsl(var(--accent-2))",
        },
        style: { stroke: "hsl(var(--accent-2))", strokeWidth: 1, strokeDasharray: "4,3" },
        type: "smoothstep",
      });
      if (a.via) {
        aggEdges.push({
          id: `aggef:${a.key}`,
          source: `agg:${a.key}`,
          sourceHandle: "agg-out",
          target: `aggfar:${a.key}`,
          targetHandle: "agg-in",
          label: `${colDisp(a.targetEntityId, a.via.farField)}${a.valueField ? ` · ${colDisp(a.via.farEntityId, a.valueField)}` : ""}`,
          labelStyle,
          labelBgStyle,
          labelBgPadding: [3, 2] as [number, number],
          labelBgBorderRadius: 3,
          markerEnd: {
            type: MarkerType.ArrowClosed,
            width: 10,
            height: 10,
            color: "hsl(var(--accent-2))",
          },
          style: { stroke: "hsl(var(--accent-2))", strokeWidth: 1, strokeDasharray: "4,3" },
          type: "smoothstep",
        });
      }
    }
    return [...relEdges, ...aggEdges];
  }, [cfg.relations, cfg.aggregates, colDisp, nodeEntityId]);

  /* ── Persist vị trí (debounced) ───────────────────────────── */
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleNodesChange = useCallback(
    (changes: Parameters<typeof onNodesChange>[0]) => {
      onNodesChange(changes);
      if (!changes.some((c) => c.type === "position" && !c.dragging)) return;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        setNodes((curr) => {
          const layout: Record<string, { x: number; y: number }> = {};
          for (const n of curr) layout[n.id] = n.position;
          layoutRef.current = layout;
          try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
          } catch {
            /* noop */
          }
          return curr;
        });
      }, 500);
    },
    [onNodesChange, setNodes, STORAGE_KEY],
  );

  /* ── Thêm đối tượng (popup, chọn NHIỀU đối tượng cùng lúc) ──── */
  const openAdd = () => {
    setAddSearch("");
    setAdd({ open: true, rows: [] });
  };
  const pkOf = useCallback(
    (entityId: string): string => {
      const e = entById(entityId);
      return e?.primaryKey ? (e.fields.find((f) => f.id === e.primaryKey)?.name ?? "id") : "id";
    },
    [entById],
  );
  // entityId của 1 fromRid: node canvas (nodeEntityId) HOẶC bảng đang chọn (rid tạm trong rows).
  const fromEntityIdOf = useCallback(
    (fromRid: string, rows: AddRow[]): string | undefined =>
      rows.find((r) => r.rid === fromRid)?.targetEntityId ?? nodeEntityId(fromRid),
    [nodeEntityId],
  );

  /** Suy liên kết của 1 dòng theo nguồn `fromRid`:
   *  - nguồn có lookup trỏ tới target → nguồn.lookup = target.id (many-to-one);
   *  - nếu không → để user chọn cột nguồn, khớp PK đích. */
  const linkFor = useCallback(
    (fromRid: string, targetEntityId: string, rows: AddRow[]) => {
      const fromEnt = entById(fromEntityIdOf(fromRid, rows));
      const lk = lookupTo(fromEnt, targetEntityId);
      return lk
        ? { fromField: lk.name, toField: "id", autoLinked: true }
        : { fromField: "", toField: pkOf(targetEntityId), autoLinked: false };
    },
    [entById, fromEntityIdOf, pkOf],
  );

  /** Dựng dòng mới + TỰ tìm nguồn cha trong mọi ứng viên (node có sẵn + bảng
   *  khác đang chọn): ưu tiên nguồn nào có lookup trỏ tới target. Không có →
   *  mặc định nối từ "base", để user tự chọn cột. */
  const buildAddRow = useCallback(
    (targetEntityId: string, siblings: AddRow[]): AddRow => {
      const rid = crypto.randomUUID();
      const alias = slugify(entById(targetEntityId)?.name || "");
      // Ứng viên nguồn: node canvas trước (cụ thể), rồi tới bảng đang chọn khác.
      const candidates: string[] = [
        ...nodeIds,
        ...siblings.filter((s) => s.targetEntityId !== targetEntityId).map((s) => s.rid),
      ];
      for (const c of candidates) {
        const lk = lookupTo(entById(fromEntityIdOf(c, siblings)), targetEntityId);
        if (lk) {
          return {
            rid,
            targetEntityId,
            fromRid: c,
            alias,
            fromField: lk.name,
            toField: "id",
            joinKind: "left",
            autoLinked: true,
          };
        }
      }
      return {
        rid,
        targetEntityId,
        fromRid: "base",
        alias,
        fromField: "",
        toField: pkOf(targetEntityId),
        joinKind: "left",
        autoLinked: false,
      };
    },
    [entById, nodeIds, fromEntityIdOf, pkOf],
  );
  // Bỏ 1 dòng + trỏ lại nguồn cho dòng nào đang "Nối từ" bảng vừa bỏ (tránh kẹt rid mồ côi).
  const dropRow = (rows: AddRow[], gone: AddRow): AddRow[] => {
    const left = rows.filter((r) => r.rid !== gone.rid);
    return left.map((r) => {
      if (r.fromRid !== gone.rid) return r;
      const d = buildAddRow(r.targetEntityId, left); // suy lại nguồn (node/bảng khác) hoặc về base
      return {
        ...r,
        fromRid: d.fromRid,
        fromField: d.fromField,
        toField: d.toField,
        autoLinked: d.autoLinked,
      };
    });
  };
  // Tick/bỏ tick 1 bảng trong danh sách checkbox: chưa có → thêm, đã có → gỡ.
  const toggleRow = (targetEntityId: string) =>
    setAdd((p) => {
      const existing = p.rows.find((r) => r.targetEntityId === targetEntityId);
      if (existing) return { ...p, rows: dropRow(p.rows, existing) };
      const next = [...p.rows, buildAddRow(targetEntityId, p.rows)];
      // Bảng mới có thể là nguồn của dòng còn bỏ ngỏ (chưa khớp + chưa sửa tay) → suy lại.
      const relinked = next.map((r) => {
        if (r.autoLinked || r.fromField) return r;
        const d = buildAddRow(r.targetEntityId, next);
        return d.autoLinked
          ? {
              ...r,
              fromRid: d.fromRid,
              fromField: d.fromField,
              toField: d.toField,
              autoLinked: true,
            }
          : r;
      });
      return { ...p, rows: relinked };
    });
  // Đổi nguồn "Nối từ" của 1 dòng → suy lại cột nối theo nguồn mới.
  const relinkRow = (rid: string, fromRid: string) =>
    setAdd((p) => ({
      ...p,
      rows: p.rows.map((r) => {
        if (r.rid !== rid) return r;
        const lk = linkFor(fromRid, r.targetEntityId, p.rows);
        return { ...r, fromRid, ...lk };
      }),
    }));
  const patchRow = (rid: string, patch: Partial<AddRow>) =>
    setAdd((p) => ({
      ...p,
      rows: p.rows.map((r) => (r.rid === rid ? { ...r, ...patch } : r)),
    }));
  const removeRow = (rid: string) =>
    setAdd((p) => {
      const gone = p.rows.find((r) => r.rid === rid);
      return gone ? { ...p, rows: dropRow(p.rows, gone) } : p;
    });

  // Không bắt buộc chọn cột liên kết: chỉ cần tick ≥1 bảng (nối sau bằng kéo cột trên canvas).
  const addRowsComplete = add.rows.length > 0;
  const confirmAdd = () => {
    const ready = add.rows.filter((r) => r.targetEntityId);
    if (ready.length === 0) {
      dialog.alert("Chọn ít nhất một đối tượng (tick ở danh sách).");
      return;
    }
    const readyRids = new Set(ready.map((r) => r.rid));
    const existingNodeIds = new Set(nodeIds); // node đã có trên canvas
    // Alias phải UNIQUE (mkKey projection dùng alias) — tránh đụng alias đã có.
    const usedAlias = new Set(cfg.relations.map((r) => r.alias));
    const newRels: DataSourceRelation[] = [];
    const newIdByRid = new Map<string, string>(); // rid tạm → relation id thật vừa tạo
    let created = 0;
    let lastRid = "";

    // Tạo 1 dòng → relation (nguồn đã giải được). Trả relation id.
    const emit = (row: AddRow, fromRelationId: string | null): string => {
      const rid = crypto.randomUUID();
      let alias = row.alias.trim() || slugify(entById(row.targetEntityId)?.name || rid);
      const baseAlias = alias;
      let n = 2;
      while (usedAlias.has(alias)) alias = `${baseAlias}_${n++}`;
      usedAlias.add(alias);
      newRels.push({
        id: rid,
        alias,
        fromRelationId,
        fromField: row.fromField,
        toField: row.toField === "id" ? undefined : row.toField,
        targetEntityId: row.targetEntityId,
        joinKind: row.joinKind,
      });
      newIdByRid.set(row.rid, rid);
      // Toả node mới quanh node nguồn cho dễ nhìn.
      const fromPos = layoutRef.current[fromRelationId ?? "base"] ?? { x: 0, y: 0 };
      layoutRef.current[rid] = { x: fromPos.x + 320, y: fromPos.y + (created % 4) * 120 + 40 };
      created++;
      lastRid = rid;
      return rid;
    };

    // Sắp xếp tô-pô: dòng nối từ bảng-anh-em phải đợi bảng đó tạo xong trước.
    const remaining = [...ready];
    let progressed = true;
    while (remaining.length > 0 && progressed) {
      progressed = false;
      for (let idx = 0; idx < remaining.length; ) {
        const row = remaining[idx];
        if (!row) {
          idx++;
          continue;
        }
        if (existingNodeIds.has(row.fromRid)) {
          // Nối từ node đã có trên canvas.
          emit(row, row.fromRid === "base" ? null : row.fromRid);
        } else if (readyRids.has(row.fromRid) && newIdByRid.has(row.fromRid)) {
          // Nối từ 1 bảng-anh-em đã được tạo ở vòng trước.
          emit(row, newIdByRid.get(row.fromRid) as string);
        } else {
          idx++; // nguồn chưa sẵn sàng → để vòng sau
          continue;
        }
        remaining.splice(idx, 1);
        progressed = true;
      }
    }
    // Còn dòng kẹt (vòng phụ thuộc, hoặc nối từ bảng-anh-em bị bỏ/chưa hợp lệ)
    // → nối tạm về base để không mất đối tượng; user chỉnh lại nguồn sau.
    for (const row of remaining) emit(row, null);
    if (remaining.length > 0) {
      dialog.alert(
        `${remaining.length} đối tượng có nguồn nối chưa hợp lệ (vòng lặp hoặc nguồn bị bỏ) — tạm nối về gốc, hãy chỉnh lại 'Nối từ'.`,
      );
    }

    update({ relations: [...cfg.relations, ...newRels] });
    setAdd(ADD_CLOSED);
    if (lastRid) setSelectedNodeId(lastRid);
  };

  /* ── Auto-link: đề xuất liên kết (Tier 1-3, deterministic, không LLM) ── */
  const suggestions = useMemo(
    () => suggestLinks(entities, cfg).filter((s) => !dismissedLinks.has(s.id)),
    [entities, cfg, dismissedLinks],
  );
  const dismissLink = (sid: string) => setDismissedLinks((prev) => new Set(prev).add(sid));

  // Chấp nhận join: dựng chuỗi relation theo steps (tự thêm bảng trung gian).
  const acceptJoin = (s: LinkSuggestion) => {
    const newRels: DataSourceRelation[] = [];
    let prevNodeId = s.fromNodeId;
    let pos = layoutRef.current[s.fromNodeId] ?? { x: 0, y: 0 };
    for (const step of s.steps) {
      const rid = crypto.randomUUID();
      const tgtName = entById(step.toEntityId)?.name || step.toEntityId;
      newRels.push({
        id: rid,
        alias: slugify(tgtName),
        fromRelationId: prevNodeId === "base" ? null : prevNodeId,
        fromField: step.fromField,
        toField: step.toField === "id" ? undefined : step.toField,
        targetEntityId: step.toEntityId,
        joinKind: "left",
      });
      pos = { x: pos.x + 320, y: pos.y + 40 };
      layoutRef.current[rid] = pos;
      prevNodeId = rid;
    }
    update({ relations: [...cfg.relations, ...newRels] });
    setSelectedNodeId(prevNodeId);
  };

  // Chấp nhận aggregate (1-N): đếm số dòng con trỏ về node nguồn.
  const acceptAgg = (s: LinkSuggestion) => {
    if (!s.aggTargetField) return;
    const child = entById(s.targetEntityId);
    const existing = new Set((cfg.aggregates ?? []).map((a) => a.key));
    let key = slugify(`so_${child?.name || s.targetEntityId}`);
    let n = 2;
    while (existing.has(key)) key = `${slugify(`so_${child?.name || s.targetEntityId}`)}_${n++}`;
    update({
      aggregates: [
        ...(cfg.aggregates ?? []),
        {
          key,
          label: `Số ${child?.name ?? s.targetEntityId}`,
          agg: "count",
          sourceRelationId: s.fromNodeId,
          matchField: "id",
          targetEntityId: s.targetEntityId,
          targetField: s.aggTargetField,
        },
      ],
    });
  };

  const acceptSuggestion = (s: LinkSuggestion) =>
    s.kind === "aggregate" ? acceptAgg(s) : acceptJoin(s);

  /* ── Preview ──────────────────────────────────────────────── */
  const loadPreview = async () => {
    if (!cfg.baseEntityId) {
      dialog.alert("Hãy chọn đối tượng gốc trước.");
      return;
    }
    setPreviewing(true);
    try {
      const res = await dsApi.dataSources.listRecords(id, { limit: 20 });
      setPreview(res.rows as DataSourceRow[]);
    } catch (e) {
      dialog.alert(`Lỗi xem trước: ${(e as Error).message}`);
    } finally {
      setPreviewing(false);
    }
  };

  /* ── Derived cho panel ────────────────────────────────────── */
  const selRel = selectedNodeId ? cfg.relations.find((r) => r.id === selectedNodeId) : undefined;
  const selFields = selectedNodeId
    ? cfg.fields.filter((f) => f.sourceRelationId === selectedNodeId)
    : [];
  // Cột nguồn của 1 dòng = field của entity mà fromRid trỏ tới (node canvas hoặc bảng-anh-em).
  const rowFromFields = (fromRid: string): EntityField[] =>
    entById(fromEntityIdOf(fromRid, add.rows))?.fields ?? [];
  // Options "Nối từ" cho 1 dòng: node canvas + các bảng khác đang chọn (trừ chính nó).
  const fromOptions = (selfRid: string) => [
    ...nodeIds.map((rid) => ({ value: rid, label: nodeAlias(rid) })),
    ...add.rows
      .filter((r) => r.rid !== selfRid)
      .map((r) => ({
        value: r.rid,
        label: `${entById(r.targetEntityId)?.name ?? r.targetEntityId} (mới)`,
      })),
  ];
  const aggregates = cfg.aggregates ?? [];
  const computed = cfg.computed ?? [];
  const previewKeys =
    cfg.fields.length > 0 || aggregates.length > 0 || computed.length > 0
      ? [
          ...cfg.fields.map((f) => f.key),
          ...aggregates.map((a) => a.key),
          ...computed.map((c) => c.key),
        ]
      : ["id"];

  /* ── Aggregate handlers ── */
  const addAggregate = (agg: DataSourceAggregate) => update({ aggregates: [...aggregates, agg] });
  const patchAggregate = (key: string, patch: Partial<DataSourceAggregate>) =>
    update({ aggregates: aggregates.map((a) => (a.key === key ? { ...a, ...patch } : a)) });
  const removeAggregate = (key: string) =>
    update({ aggregates: aggregates.filter((a) => a.key !== key) });
  // Aggregate có node nguồn = node đang chọn (default "base").
  const nodeAggregates = selectedNodeId
    ? aggregates.filter((a) => (a.sourceRelationId ?? "base") === selectedNodeId)
    : [];

  /* ── Computed (global, không theo node) ── */
  const addComputed = (c: DataSourceComputed) => update({ computed: [...computed, c] });
  const patchComputed = (key: string, patch: Partial<DataSourceComputed>) =>
    update({ computed: computed.map((c) => (c.key === key ? { ...c, ...patch } : c)) });
  const removeComputed = (key: string) =>
    update({ computed: computed.filter((c) => c.key !== key) });
  const flatCols: FlatCol[] = [
    ...cfg.fields.map((f) => ({ key: f.key, label: f.label, type: f.type })),
    ...aggregates.map((a) => ({ key: a.key, label: a.label, type: "number" })),
    ...computed.map((c) => ({ key: c.key, label: c.label, type: c.type })),
  ];

  /* ── Empty (chưa chọn gốc) ────────────────────────────────── */
  if (!cfg.baseEntityId) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-muted">
        <I.Database size={36} className="opacity-30" />
        <p className="text-sm">Chọn đối tượng gốc để bắt đầu xây nguồn dữ liệu trên canvas.</p>
        <SearchableSelect
          value=""
          onChange={(eid) => {
            update({ baseEntityId: eid, relations: [], fields: [] });
            layoutRef.current = {};
          }}
          options={entities.map((e) => ({ value: e.id, label: e.name }))}
          placeholder="Chọn đối tượng gốc"
          searchPlaceholder="Tìm đối tượng…"
          className="w-72"
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full w-full">
      {isMobile && <MobileDesignerNotice />}
      <div className="relative flex flex-1 min-h-0 w-full">
        {/* Canvas */}
        <div className="flex-1 h-full relative">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            nodesDraggable={!isMobile}
            onNodesChange={handleNodesChange}
            onNodeClick={(_, n) => {
              // Ghost node aggregate → mở panel node NGUỒN của nó, tab Aggregate.
              const aggKey = n.id.startsWith("agg:")
                ? n.id.slice(4)
                : n.id.startsWith("aggfar:")
                  ? n.id.slice(7)
                  : null;
              setComputedPanelOpen(false);
              if (aggKey) {
                const a = (cfg.aggregates ?? []).find((x) => x.key === aggKey);
                setSelectedNodeId(a?.sourceRelationId ?? "base");
                setPanelTab("agg");
              } else {
                setSelectedNodeId(n.id);
                setPanelTab("config");
              }
            }}
            nodesConnectable={!isMobile}
            onConnect={onConnect}
            // Tắt auto-pan khi focus/click node — nếu node chạm mép viewport, ReactFlow
            // sẽ setCenter → pan cả canvas một nhịp, trông như "nháy" mỗi lần bấm.
            autoPanOnNodeFocus={false}
            fitView
            fitViewOptions={{ padding: 0.2 }}
            minZoom={0.2}
            maxZoom={2}
            className="bg-bg"
          >
            <Background color="hsl(var(--border))" />
            <Controls />
            <MiniMap
              nodeColor="hsl(var(--panel-2))"
              maskColor="rgba(0,0,0,0.1)"
              className="!bg-panel !border-border"
            />
          </ReactFlow>

          {/* Toolbar */}
          <div className="absolute top-3 left-3 flex items-center gap-2 z-10 flex-wrap">
            <button
              type="button"
              onClick={openAdd}
              className="h-8 px-3 rounded-lg bg-accent text-white text-xs hover:bg-accent/90 flex items-center gap-1.5 shadow-sm"
            >
              <I.Plus size={12} />
              Thêm đối tượng
            </button>
            <button
              type="button"
              onClick={() => {
                setSuggestOpen((v) => !v);
                setSelectedNodeId(null);
                setComputedPanelOpen(false);
              }}
              className={cn(
                "h-8 px-3 rounded-lg border text-xs flex items-center gap-1.5 shadow-sm",
                suggestOpen
                  ? "bg-accent/15 border-accent/40 text-accent"
                  : "bg-panel border-border hover:bg-hover/50",
              )}
              title="Tự động phát hiện liên kết giữa các đối tượng"
            >
              <I.Sparkles size={12} />
              Phát hiện liên kết
              {suggestions.length > 0 && (
                <span className="ml-0.5 bg-accent text-white text-[10px] leading-none px-1.5 py-0.5 rounded-full">
                  {suggestions.length}
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => {
                setComputedPanelOpen((v) => !v);
                setSelectedNodeId(null);
                setSuggestOpen(false);
              }}
              className={cn(
                "h-8 px-3 rounded-lg border text-xs flex items-center gap-1.5 shadow-sm",
                computedPanelOpen
                  ? "bg-accent/15 border-accent/40 text-accent"
                  : "bg-panel border-border hover:bg-hover/50",
              )}
            >
              <I.Edit size={12} />
              Cột tính toán
              {computed.length > 0 && (
                <span className="ml-0.5 bg-accent text-white text-[10px] leading-none px-1.5 py-0.5 rounded-full">
                  {computed.length}
                </span>
              )}
            </button>
            <div className="h-8 flex items-center px-2.5 rounded-lg bg-panel border border-border shadow-sm">
              <FieldDisplayToggle />
            </div>
            <button
              type="button"
              onClick={() => fitView({ padding: 0.2, duration: 400 })}
              className="h-8 px-3 rounded-lg bg-panel border border-border text-xs hover:bg-hover/50 flex items-center gap-1.5 shadow-sm"
            >
              <I.Eye size={12} />
              Fit view
            </button>
            <button
              type="button"
              onClick={() => void loadPreview()}
              disabled={previewing}
              className="h-8 px-3 rounded-lg bg-panel border border-border text-xs hover:bg-hover/50 flex items-center gap-1.5 shadow-sm disabled:opacity-60"
            >
              {previewing ? <I.Loader size={12} className="animate-spin" /> : <I.Table size={12} />}
              Xem trước
            </button>
            <div className="h-8 px-3 rounded-lg bg-panel border border-border text-xs flex items-center gap-1.5 shadow-sm text-muted">
              <I.Database size={12} />
              {nodeIds.length} đối tượng · {cfg.relations.length} join · {cfg.fields.length} cột
            </div>
            {!isMobile && (
              <div className="h-8 px-3 rounded-lg bg-accent/10 border border-accent/30 text-xs flex items-center gap-1.5 shadow-sm text-accent">
                <I.Link size={12} />
                Mẹo: kéo chấm cột → cột (bảng khác) để nối
              </div>
            )}
          </div>

          {/* Preview overlay */}
          {preview && (
            <div className="absolute bottom-3 left-3 right-3 max-h-[34%] z-10 bg-panel border border-border rounded-lg shadow-xl flex flex-col overflow-hidden">
              <div className="flex items-center justify-between px-3 py-1.5 border-b border-border shrink-0">
                <span className="text-xs font-semibold">Xem trước ({preview.length} dòng)</span>
                <button
                  type="button"
                  onClick={() => setPreview(null)}
                  className="w-6 h-6 rounded hover:bg-hover/60 flex items-center justify-center text-muted"
                >
                  <I.X size={13} />
                </button>
              </div>
              <div className="overflow-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-bg-soft border-b border-border text-muted">
                      {previewKeys.map((k) => (
                        <th key={k} className="px-2 py-1 text-left whitespace-nowrap" title={k}>
                          {fieldMode === "label"
                            ? (flatCols.find((c) => c.key === k)?.label ?? k)
                            : k}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.map((row) => (
                      <tr key={row.id} className="border-b border-border/50 last:border-0">
                        {previewKeys.map((k) => (
                          <td key={k} className="px-2 py-1 whitespace-nowrap">
                            {String(row[k] ?? "")}
                          </td>
                        ))}
                      </tr>
                    ))}
                    {preview.length === 0 && (
                      <tr>
                        <td
                          className="px-2 py-2 text-muted italic"
                          colSpan={Math.max(1, previewKeys.length)}
                        >
                          Không có dữ liệu.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Right panel — node được chọn */}
        {selectedNodeId && (
          <div
            className={cn(
              "border-l border-border bg-panel flex flex-col overflow-hidden",
              isMobile ? "absolute inset-0 z-20 w-full" : "w-[360px] shrink-0",
            )}
          >
            <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border">
              <span className="font-semibold text-sm flex-1 truncate">
                {nodeAlias(selectedNodeId)}
              </span>
              <button
                type="button"
                onClick={() => setSelectedNodeId(null)}
                className="w-6 h-6 rounded hover:bg-hover/60 flex items-center justify-center text-muted"
              >
                <I.X size={13} />
              </button>
            </div>

            <Tabs
              value={panelTab}
              onChange={(v) => setPanelTab(v as "config" | "agg" | "computed" | "addfield")}
              options={[
                { value: "config", label: "Cấu hình" },
                {
                  value: "agg",
                  label: nodeAggregates.length
                    ? `Aggregate (${nodeAggregates.length})`
                    : "Aggregate",
                },
                {
                  value: "computed",
                  label: computed.length ? `Cột tính toán (${computed.length})` : "Cột tính toán",
                },
                { value: "addfield", label: "Thêm trường" },
              ]}
              className="px-3 shrink-0"
            />

            <div className="flex-1 overflow-y-auto p-3 space-y-3">
              {panelTab === "config" ? (
                <>
                  {/* Toggle hiển thị tên trường: Tên cột ↔ Nhãn (đồng bộ toàn cục) */}
                  <FieldDisplayToggle />

                  {/* Cấu hình join (chỉ với relation) */}
                  {selRel && (
                    <Card className="p-3 space-y-2">
                      <div className="text-xs font-semibold text-text">Quan hệ (join)</div>
                      <FormField label="Alias">
                        <Input
                          className="h-7"
                          value={selRel.alias}
                          onChange={(e) => patchRelation(selRel.id, { alias: e.target.value })}
                        />
                      </FormField>
                      <div className="text-[11px] text-muted">
                        Từ: <b>{nodeAlias(selRel.fromRelationId ?? "base")}</b>
                      </div>
                      <FormField label="Cột nguồn (node cha)">
                        <SearchableSelect
                          className="w-full"
                          value={selRel.fromField}
                          onChange={(v) => patchRelation(selRel.id, { fromField: v })}
                          options={nodeFields(selRel.fromRelationId ?? "base").map((f) => ({
                            value: f.name,
                            label: fieldDisp(f),
                          }))}
                          placeholder="Chọn cột nguồn…"
                        />
                      </FormField>
                      <FormField label="Cột đích (khớp)">
                        <SearchableSelect
                          className="w-full"
                          value={selRel.toField || "id"}
                          onChange={(v) =>
                            patchRelation(selRel.id, { toField: v === "id" ? undefined : v })
                          }
                          options={[
                            { value: "id", label: "id (record id)" },
                            ...nodeFields(selRel.id).map((f) => ({
                              value: f.name,
                              label: fieldDisp(f),
                            })),
                          ]}
                        />
                      </FormField>
                      <FormField label="Kiểu join">
                        <SearchableSelect
                          className="w-full"
                          value={selRel.joinKind}
                          onChange={(v) =>
                            patchRelation(selRel.id, { joinKind: v as "left" | "inner" })
                          }
                          options={[
                            { value: "left", label: "left (giữ row gốc)" },
                            { value: "inner", label: "inner (lọc thiếu)" },
                          ]}
                        />
                      </FormField>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-danger"
                        icon={<I.X size={13} />}
                        onClick={() => removeRelation(selRel.id)}
                      >
                        Xoá quan hệ
                      </Button>
                    </Card>
                  )}

                  {/* Cột đã chọn (projection) của node này */}
                  <Card className="p-3 space-y-2">
                    <div className="text-xs font-semibold text-text">Cột đã chọn</div>
                    {selFields.length === 0 ? (
                      <p className="text-[11px] text-muted italic">
                        Chưa chọn cột — tick checkbox trên node để thêm.
                      </p>
                    ) : (
                      <div className="space-y-1.5">
                        {selFields.map((f) => (
                          <div key={f.key} className="flex items-center gap-1.5">
                            <span
                              className="text-[10px] text-muted w-20 shrink-0 truncate"
                              title={
                                fieldMode === "label" ? f.sourceField : f.label || f.sourceField
                              }
                            >
                              {fieldMode === "label" ? f.label || f.sourceField : f.sourceField}
                            </span>
                            <Input
                              className="h-6 flex-1"
                              value={f.key}
                              onChange={(e) => patchField(f.key, { key: slugify(e.target.value) })}
                              title="Khoá (key) phẳng"
                            />
                            <label className="flex items-center gap-1 text-[10px] text-muted shrink-0">
                              <input
                                type="checkbox"
                                className="accent-accent"
                                checked={f.writable === true}
                                onChange={(e) => patchField(f.key, { writable: e.target.checked })}
                              />
                              ghi
                            </label>
                          </div>
                        ))}
                      </div>
                    )}
                  </Card>
                </>
              ) : panelTab === "agg" ? (
                <>
                  {/* Tab Aggregate — scope theo node nguồn đang chọn */}
                  {nodeAggregates.length === 0 ? (
                    <p className="text-xs text-muted italic">
                      Node này chưa có cột gom. Thêm bên dưới (vd đếm số dòng con, tổng tiền…).
                    </p>
                  ) : (
                    nodeAggregates.map((a) => (
                      <Card key={a.key} className="p-2.5 space-y-1.5">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-accent text-xs flex-1 truncate">
                            {a.key}
                          </span>
                          <button
                            type="button"
                            onClick={() => removeAggregate(a.key)}
                            className="text-muted hover:text-danger"
                            title="Xoá aggregate"
                          >
                            <I.X size={13} />
                          </button>
                        </div>
                        <div className="text-[11px] text-muted">
                          {a.agg.toUpperCase()}
                          {a.agg !== "count" && a.valueField
                            ? `(${colDisp(a.via?.farEntityId ?? a.targetEntityId, a.valueField)})`
                            : "(*)"}{" "}
                          của {entById(a.targetEntityId)?.name ?? a.targetEntityId}.
                          {colDisp(a.targetEntityId, a.targetField)}
                          {a.via
                            ? ` → ${entById(a.via.farEntityId)?.name ?? a.via.farEntityId} (N-N)`
                            : " (1-N)"}
                        </div>
                        <Input
                          className="h-7 w-full"
                          value={a.label}
                          onChange={(e) => patchAggregate(a.key, { label: e.target.value })}
                          title="Nhãn hiển thị"
                        />
                      </Card>
                    ))
                  )}

                  <Card className="p-2.5">
                    <div className="text-xs font-semibold text-text mb-1">
                      Thêm aggregate cho {nodeAlias(selectedNodeId)}
                    </div>
                    <AddAggregate
                      key={selectedNodeId}
                      fixedFromRid={selectedNodeId}
                      nodes={nodeIds}
                      nodeAlias={nodeAlias}
                      nodeFields={nodeFields}
                      entities={entities}
                      entById={entById}
                      existingKeys={aggregates.map((a) => a.key)}
                      onAdd={addAggregate}
                      fieldDisp={fieldDisp}
                    />
                  </Card>
                  <p className="text-[11px] text-muted">
                    1-N: gom record con trỏ ngược. N-N: qua bảng nối + entity far. Cột aggregate chỉ
                    đọc, hiện trong bảng Xem trước.
                  </p>
                </>
              ) : panelTab === "computed" ? (
                <>
                  {/* Tab Cột tính toán (formula) — global cho cả nguồn dữ liệu */}
                  <ComputedColumns
                    computed={computed}
                    availableCols={flatCols}
                    onAdd={addComputed}
                    onPatch={patchComputed}
                    onRemove={removeComputed}
                  />
                  <p className="text-[11px] text-muted">
                    Biểu thức trên CỘT PHẲNG khác (<code>{"{key}"}</code>) + hàm IF/CONCAT/ROUND…
                    Cột chỉ đọc, eval sau projection + aggregate. Áp dụng chung cho cả nguồn dữ
                    liệu.
                  </p>
                </>
              ) : (
                <>
                  {/* Tab Thêm trường — thêm field vào entity của node đang chọn */}
                  <div className="text-xs font-semibold text-text">
                    Thêm trường vào{" "}
                    <span className="text-accent font-mono">
                      {entById(nodeEntityId(selectedNodeId))?.name ?? nodeAlias(selectedNodeId)}
                    </span>
                  </div>
                  <AddEntityFieldForm entityId={nodeEntityId(selectedNodeId) ?? null} />
                </>
              )}
            </div>
          </div>
        )}

        {/* Right panel — Cột tính toán (global) */}
        {computedPanelOpen && (
          <div className="w-[400px] border-l border-border bg-panel flex flex-col overflow-hidden shrink-0">
            <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border">
              <I.Edit size={14} className="text-accent shrink-0" />
              <span className="font-semibold text-sm flex-1">Cột tính toán (formula)</span>
              <button
                type="button"
                onClick={() => setComputedPanelOpen(false)}
                className="w-6 h-6 rounded hover:bg-hover/60 flex items-center justify-center text-muted"
              >
                <I.X size={13} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              <ComputedColumns
                computed={computed}
                availableCols={flatCols}
                onAdd={addComputed}
                onPatch={patchComputed}
                onRemove={removeComputed}
              />
              <p className="text-[11px] text-muted">
                Biểu thức trên CỘT PHẲNG khác (<code>{"{key}"}</code>) + hàm IF/CONCAT/ROUND… Cột
                chỉ đọc, eval sau projection + aggregate.
              </p>
            </div>
          </div>
        )}

        {/* Right panel — Đề xuất liên kết (auto-link) */}
        {suggestOpen && (
          <div
            className={cn(
              "border-l border-border bg-panel flex flex-col overflow-hidden",
              isMobile ? "absolute inset-0 z-20 w-full" : "w-[380px] shrink-0",
            )}
          >
            <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border">
              <I.Sparkles size={14} className="text-accent shrink-0" />
              <span className="font-semibold text-sm flex-1">Đề xuất liên kết</span>
              <button
                type="button"
                onClick={() => setSuggestOpen(false)}
                className="w-6 h-6 rounded hover:bg-hover/60 flex items-center justify-center text-muted"
              >
                <I.X size={13} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {suggestions.length === 0 ? (
                <div className="text-center py-8 text-muted">
                  <I.Sparkles size={28} className="mx-auto opacity-30 mb-2" />
                  <p className="text-xs">
                    Không phát hiện liên kết tự động nào (qua khoá ngoại) cho các đối tượng hiện có.
                  </p>
                  <p className="text-[11px] mt-1">Dùng "Thêm đối tượng" để nối thủ công.</p>
                </div>
              ) : (
                suggestions.map((s) => {
                  const tierLabel = s.tier === 1 ? "FK" : s.tier === 2 ? "1-N" : "Gián tiếp";
                  const pct = Math.round(s.confidence * 100);
                  const confCls =
                    s.confidence >= 0.85
                      ? "bg-emerald-500/15 text-emerald-500"
                      : s.confidence >= 0.6
                        ? "bg-amber-500/15 text-amber-600"
                        : "bg-muted/15 text-muted";
                  return (
                    <Card key={s.id} className="p-2.5 space-y-1.5">
                      <div className="flex items-center gap-1.5">
                        <span
                          className={cn(
                            "text-[10px] px-1.5 py-0.5 rounded-full shrink-0 font-semibold",
                            confCls,
                          )}
                          title={`Độ tin cậy ${pct}%`}
                        >
                          {pct}%
                        </span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-accent/15 text-accent shrink-0">
                          {tierLabel}
                        </span>
                        <span className="text-xs flex-1 truncate font-medium" title={s.reason}>
                          {nodeAlias(s.fromNodeId)} →{" "}
                          {entById(s.targetEntityId)?.name ?? s.targetEntityId}
                        </span>
                      </div>
                      <div className="text-[11px] text-muted">{s.reason}</div>
                      {s.steps.length > 1 && (
                        <div className="text-[10px] text-muted font-mono truncate">
                          {s.steps.map((st) => `${st.fromField}→${st.toField}`).join("  ·  ")}
                        </div>
                      )}
                      <div className="flex gap-2 pt-0.5">
                        <Button
                          size="sm"
                          variant="primary"
                          icon={<I.Plus size={12} />}
                          onClick={() => acceptSuggestion(s)}
                        >
                          {s.kind === "aggregate" ? "Thêm cột đếm" : "Tạo liên kết"}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          icon={<I.X size={12} />}
                          onClick={() => dismissLink(s.id)}
                        >
                          Bỏ qua
                        </Button>
                      </div>
                    </Card>
                  );
                })
              )}
              <p className="text-[11px] text-muted pt-1">
                Phát hiện dựa trên khoá ngoại (field lookup) trong metadata. Tier 3 tự thêm bảng
                trung gian khi tạo liên kết.
              </p>
            </div>
          </div>
        )}

        {/* ── Add-object dialog (chọn NHIỀU đối tượng cùng lúc) ── */}
        {add.open && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
            onMouseDown={(e) => {
              if (e.target === e.currentTarget) setAdd(ADD_CLOSED);
            }}
          >
            <div className="w-[680px] max-w-full max-h-[88vh] bg-panel border border-border rounded-xl shadow-2xl flex flex-col">
              {/* Header */}
              <div className="flex items-center justify-between px-5 py-3.5 border-b border-border shrink-0">
                <span className="font-semibold text-sm">Thêm đối tượng vào canvas</span>
                <button
                  type="button"
                  onClick={() => setAdd(ADD_CLOSED)}
                  className="w-6 h-6 rounded hover:bg-hover/60 flex items-center justify-center text-muted"
                >
                  <I.X size={13} />
                </button>
              </div>

              {/* Body (cuộn) */}
              <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-3">
                {/* Danh sách bảng — tick checkbox để chọn NHIỀU bảng cùng lúc */}
                <FormField label="Chọn đối tượng (tick nhiều bảng để thêm cùng lúc)">
                  <Input
                    className="h-8 mb-2"
                    value={addSearch}
                    onChange={(e) => setAddSearch(e.target.value)}
                    placeholder="Tìm đối tượng…"
                  />
                  {(() => {
                    const q = addSearch.trim().toLowerCase();
                    const list = entities.filter((e) => !q || e.name.toLowerCase().includes(q));
                    if (list.length === 0) {
                      return (
                        <div className="rounded-lg border border-border px-3 py-4 text-center text-[12px] text-muted italic">
                          Không tìm thấy đối tượng nào.
                        </div>
                      );
                    }
                    return (
                      <div className="max-h-56 overflow-y-auto rounded-lg border border-border divide-y divide-border/60">
                        {list.map((e) => {
                          const checked = add.rows.some((r) => r.targetEntityId === e.id);
                          const IC = I[e.icon] ?? I.Database;
                          return (
                            <label
                              key={e.id}
                              className="flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-hover/30 cursor-pointer"
                            >
                              <input
                                type="checkbox"
                                className="accent-accent shrink-0"
                                checked={checked}
                                onChange={() => toggleRow(e.id)}
                              />
                              <div className="w-5 h-5 rounded-md bg-accent/15 flex items-center justify-center text-accent shrink-0">
                                <IC size={11} />
                              </div>
                              <span
                                className={cn(
                                  "flex-1 truncate",
                                  checked && "text-accent font-medium",
                                )}
                              >
                                {e.name}
                              </span>
                              {checked && <I.Check size={13} className="text-accent shrink-0" />}
                            </label>
                          );
                        })}
                      </div>
                    );
                  })()}
                </FormField>

                {/* Thiết lập liên kết cho mỗi bảng đã tick — mỗi dòng 1 liên kết, sửa được */}
                {add.rows.length === 0 ? (
                  <div className="text-[12px] text-muted italic text-center py-6 border border-dashed border-border rounded-lg">
                    Chưa chọn đối tượng nào. Tick các bảng ở danh sách trên — liên kết mặc định tự
                    suy theo khoá ngoại, có thể sửa bên dưới.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {add.rows.map((row) => {
                      const tgt = entById(row.targetEntityId);
                      const IC = tgt ? (I[tgt.icon] ?? I.Database) : I.Database;
                      return (
                        <Card key={row.rid} className="p-3 space-y-2">
                          <div className="flex items-center gap-2">
                            <div className="w-5 h-5 rounded-md bg-accent/15 flex items-center justify-center text-accent shrink-0">
                              <IC size={11} />
                            </div>
                            <span className="font-semibold text-sm flex-1 truncate">
                              {tgt?.name ?? row.targetEntityId}
                            </span>
                            {row.autoLinked ? (
                              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-success/15 text-success shrink-0">
                                Liên kết mặc định
                              </span>
                            ) : (
                              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-bg-soft text-muted shrink-0">
                                Tự đặt liên kết
                              </span>
                            )}
                            <button
                              type="button"
                              onClick={() => removeRow(row.rid)}
                              className="w-5 h-5 rounded hover:bg-danger/15 flex items-center justify-center text-muted hover:text-danger shrink-0"
                              title="Bỏ khỏi danh sách"
                            >
                              <I.X size={12} />
                            </button>
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            <FormField label="Nối từ (node nguồn)">
                              <SearchableSelect
                                className="w-full"
                                value={row.fromRid}
                                onChange={(v) => relinkRow(row.rid, v)}
                                options={fromOptions(row.rid)}
                                placeholder="Chọn node nguồn…"
                                searchPlaceholder="Tìm node…"
                              />
                            </FormField>
                            <FormField label="Cột nguồn (ở node nối từ)">
                              <SearchableSelect
                                className="w-full"
                                value={row.fromField}
                                onChange={(v) => patchRow(row.rid, { fromField: v })}
                                options={rowFromFields(row.fromRid).map((f) => ({
                                  value: f.name,
                                  label: fieldDisp(f),
                                }))}
                                placeholder="Chọn cột…"
                              />
                            </FormField>
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            <FormField label="Cột đích (khớp)">
                              <SearchableSelect
                                className="w-full"
                                value={row.toField}
                                onChange={(v) => patchRow(row.rid, { toField: v })}
                                options={[
                                  { value: "id", label: "id (record id)" },
                                  ...(tgt?.fields.map((f) => ({
                                    value: f.name,
                                    label: fieldDisp(f),
                                  })) ?? []),
                                ]}
                              />
                            </FormField>
                            <FormField label="Kiểu join">
                              <SearchableSelect
                                className="w-full"
                                value={row.joinKind}
                                onChange={(v) =>
                                  patchRow(row.rid, { joinKind: v as "left" | "inner" })
                                }
                                options={[
                                  { value: "left", label: "left (giữ)" },
                                  { value: "inner", label: "inner (lọc)" },
                                ]}
                              />
                            </FormField>
                          </div>
                          <FormField label="Alias">
                            <Input
                              className="h-8"
                              value={row.alias}
                              onChange={(e) => patchRow(row.rid, { alias: e.target.value })}
                              placeholder="vd: khach_hang"
                            />
                          </FormField>
                          {!row.fromField && (
                            <p className="text-[11px] text-muted">
                              Chưa nối — có thể thêm trước rồi <b>kéo cột này sang cột bảng khác</b>{" "}
                              trên canvas để tạo liên kết, hoặc chọn "Nối từ" + "Cột nguồn" ngay
                              đây.
                            </p>
                          )}
                        </Card>
                      );
                    })}
                  </div>
                )}

                <p className="text-[11px] text-muted">
                  Không có "node cha" cố định: mỗi bảng tự chọn "Nối từ" — node nào (kể cả bảng khác
                  đang chọn) cũng có thể làm nguồn. Liên kết mặc định tự suy theo khoá ngoại (field
                  lookup); <b>không bắt buộc chọn cột</b> — có thể thêm bảng rồi kéo cột↔cột trên
                  canvas để nối sau. Join cột↔cột giả định many-to-one (lấy record đích đầu tiên
                  khớp). Cột nối phải là plaintext (không mã hoá) ở cả 2 phía.
                </p>
              </div>

              {/* Footer */}
              <div className="flex items-center gap-2 px-5 py-3 border-t border-border shrink-0">
                <span className="text-[11px] text-muted mr-auto">
                  {add.rows.length} đối tượng trong danh sách
                </span>
                <button
                  type="button"
                  onClick={() => setAdd(ADD_CLOSED)}
                  className="h-8 px-3 text-sm rounded-lg border border-border hover:bg-hover/50"
                >
                  Huỷ
                </button>
                <button
                  type="button"
                  onClick={confirmAdd}
                  disabled={!addRowsComplete}
                  className="h-8 px-4 text-sm rounded-lg bg-accent text-white hover:bg-accent/90 disabled:opacity-40"
                >
                  Thêm{add.rows.length > 0 ? ` ${add.rows.length} đối tượng` : ""}
                </button>
              </div>
            </div>
          </div>
        )}

        <AddEntityFieldModal
          entityId={addFieldEntityId}
          onClose={() => setAddFieldEntityId(null)}
        />
      </div>
    </div>
  );
}

export function DataSourceCanvas({ id }: { id: string }) {
  return (
    <ReactFlowProvider>
      <Canvas id={id} />
    </ReactFlowProvider>
  );
}
