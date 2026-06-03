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
  DataSourceConfig,
  DataSourceField,
  DataSourceRelation,
  DataSourceRow,
} from "@erp-framework/core";
import {
  Background,
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
import { I } from "@/components/Icons";
import { Button, Card, FormField, Input, SearchableSelect, Tabs } from "@/components/ui";
import { dialog } from "@/lib/dialog";
import type { EntityField } from "@/lib/object-types";
import { cn } from "@/lib/utils";
import { slugify, useUserObjects } from "@/stores/userObjects";
import { AddAggregate } from "./DataSourceDesigner";

const dsApi = createObjectsClient("");
const EMPTY: DataSourceConfig = { baseEntityId: "", relations: [], fields: [] };

/* ── Custom node ──────────────────────────────────────────── */
interface DSNodeData extends Record<string, unknown> {
  nodeId: string;
  entityId: string | undefined;
  alias: string;
  isBase: boolean;
  projected: Set<string>;
  onToggleField: (nodeId: string, fieldName: string) => void;
  onSelect: (nodeId: string) => void;
  onRemove: (nodeId: string) => void;
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
      {/* Handle "id" (record id) cho join cổ điển lookup → id */}
      <Handle
        type="target"
        id="tgt-id"
        position={Position.Left}
        isConnectable={false}
        className="!w-2 !h-2 !bg-warning !border-0 !top-[18px]"
      />
      {/* Handle phát aggregate (1-N / N-N) — đáy node */}
      <Handle
        type="source"
        id="agg-out"
        position={Position.Bottom}
        isConnectable={false}
        className="!w-2 !h-2 !bg-accent !border-0"
      />

      {/* Header */}
      <button
        type="button"
        onClick={() => data.onSelect(data.nodeId)}
        className="w-full flex items-center gap-2 px-3 py-2 border-b border-border rounded-t-xl hover:bg-hover/30 transition-colors text-left"
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
        {!data.isBase && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              data.onRemove(data.nodeId);
            }}
            className="w-5 h-5 rounded hover:bg-danger/15 flex items-center justify-center text-muted hover:text-danger"
            title="Xoá quan hệ"
          >
            <I.X size={11} />
          </button>
        )}
      </button>

      {/* Fields */}
      <div className="py-1 max-h-[240px] overflow-y-auto">
        {fields.length === 0 && (
          <div className="px-3 py-2 text-xs text-muted italic">Chưa có field</div>
        )}
        {fields.map((f) => {
          const on = data.projected.has(f.name);
          return (
            <div
              key={f.id}
              className="relative flex items-center gap-1.5 px-3 py-[3px] hover:bg-hover/20"
            >
              {/* target handle (trái) — node này là con, nối trên cột này */}
              <Handle
                type="target"
                id={`tgt-${f.name}`}
                position={Position.Left}
                isConnectable={false}
                className="!w-1.5 !h-1.5 !bg-warning/60 !border-0 !left-[-3px]"
              />
              {/* source handle (phải) — node này là cha, phát từ cột này */}
              <Handle
                type="source"
                id={`src-${f.name}`}
                position={Position.Right}
                isConnectable={false}
                className="!w-1.5 !h-1.5 !bg-accent/60 !border-0 !right-[-3px]"
              />
              <input
                type="checkbox"
                className="accent-accent shrink-0"
                checked={on}
                onChange={() => data.onToggleField(data.nodeId, f.name)}
                title="Đưa cột vào bảng phẳng"
              />
              <span
                className={cn("flex-1 truncate text-xs font-mono", on ? "text-text" : "text-muted")}
              >
                {f.name}
              </span>
              <span className="text-[10px] text-muted shrink-0">{f.type}</span>
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

/* ── Add-object dialog state ──────────────────────────────── */
interface AddState {
  open: boolean;
  parentNodeId: string;
  targetEntityId: string;
  fromField: string;
  toField: string; // "id" hoặc tên cột đích
  joinKind: "left" | "inner";
  alias: string;
}
const ADD_CLOSED: AddState = {
  open: false,
  parentNodeId: "base",
  targetEntityId: "",
  fromField: "",
  toField: "id",
  joinKind: "left",
  alias: "",
};

/* ── Inner canvas ─────────────────────────────────────────── */
function Canvas({ id }: { id: string }) {
  const { fitView } = useReactFlow();
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

  /* ── Selection + UI state ─────────────────────────────────── */
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [panelTab, setPanelTab] = useState<"config" | "agg">("config");
  const [add, setAdd] = useState<AddState>(ADD_CLOSED);
  const [preview, setPreview] = useState<DataSourceRow[] | null>(null);
  const [previewing, setPreviewing] = useState(false);

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
        onToggleField: toggleField,
        onSelect: setSelectedNodeId,
        onRemove: removeRelation,
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
          byField: a.targetField,
          valueField: a.via ? undefined : a.valueField,
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
            valueField: a.valueField,
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
    toggleField,
    removeRelation,
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
      const posOf = new Map(prev.map((n) => [n.id, n.position]));
      return buildNodes().map((n) => ({ ...n, position: posOf.get(n.id) ?? n.position }));
    });
  }, [buildNodes, setNodes]);

  const edges = useMemo((): Edge[] => {
    const labelStyle = {
      fontSize: 9,
      fill: "hsl(var(--text))",
      fontFamily: "ui-monospace, monospace",
    };
    const labelBgStyle = { fill: "hsl(var(--panel))", fillOpacity: 0.95 };

    const relEdges: Edge[] = cfg.relations.map((rel) => {
      const to = rel.toField && rel.toField !== "id" ? rel.toField : "id";
      return {
        id: rel.id,
        source: rel.fromRelationId ?? "base",
        sourceHandle: `src-${rel.fromField}`,
        target: rel.id,
        targetHandle: `tgt-${to}`,
        label: `${rel.fromField} = ${to}`,
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
        label: `${a.agg.toUpperCase()}${a.agg !== "count" && !a.via && a.valueField ? `(${a.valueField})` : ""} · ${a.targetField}`,
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
          label: `${a.via.farField}${a.valueField ? ` · ${a.valueField}` : ""}`,
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
  }, [cfg.relations, cfg.aggregates]);

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

  /* ── Thêm đối tượng (popup) ───────────────────────────────── */
  const openAdd = () => {
    setAdd({ ...ADD_CLOSED, open: true, parentNodeId: "base" });
  };
  const onPickTarget = (targetEntityId: string) => {
    const tgt = entById(targetEntityId);
    setAdd((prev) => {
      // Gợi ý: nếu node cha có lookup trỏ tới target → prefill lookup→id.
      const parentFields = nodeFields(prev.parentNodeId);
      const lookup = parentFields.find(
        (f) => (f.type === "lookup" || f.type === "multi-lookup") && f.ref === targetEntityId,
      );
      const pkName = tgt?.primaryKey
        ? (tgt.fields.find((f) => f.id === tgt.primaryKey)?.name ?? "id")
        : "id";
      return {
        ...prev,
        targetEntityId,
        alias: slugify(tgt?.name || ""),
        fromField: lookup ? lookup.name : prev.fromField,
        toField: lookup ? "id" : pkName,
      };
    });
  };
  const confirmAdd = () => {
    if (!add.targetEntityId || !add.fromField) {
      dialog.alert("Chọn đối tượng đích và cột nối (từ node cha).");
      return;
    }
    const rid = crypto.randomUUID();
    const rel: DataSourceRelation = {
      id: rid,
      alias: add.alias.trim() || slugify(entById(add.targetEntityId)?.name || rid),
      fromRelationId: add.parentNodeId === "base" ? null : add.parentNodeId,
      fromField: add.fromField,
      toField: add.toField === "id" ? undefined : add.toField,
      targetEntityId: add.targetEntityId,
      joinKind: add.joinKind,
    };
    // Đặt node mới cạnh node cha cho dễ nhìn.
    const parentPos = layoutRef.current[add.parentNodeId] ?? { x: 0, y: 0 };
    layoutRef.current[rid] = { x: parentPos.x + 320, y: parentPos.y + 40 };
    update({ relations: [...cfg.relations, rel] });
    setAdd(ADD_CLOSED);
    setSelectedNodeId(rid);
  };

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
  const addParentFields = nodeFields(add.parentNodeId);
  const addTargetEnt = entById(add.targetEntityId);
  const aggregates = cfg.aggregates ?? [];
  const previewKeys =
    cfg.fields.length > 0 || aggregates.length > 0
      ? [...cfg.fields.map((f) => f.key), ...aggregates.map((a) => a.key)]
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
    <div className="flex h-full w-full">
      {/* Canvas */}
      <div className="flex-1 h-full relative">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={handleNodesChange}
          onNodeClick={(_, n) => {
            // Ghost node aggregate → mở panel node NGUỒN của nó, tab Aggregate.
            const aggKey = n.id.startsWith("agg:")
              ? n.id.slice(4)
              : n.id.startsWith("aggfar:")
                ? n.id.slice(7)
                : null;
            if (aggKey) {
              const a = (cfg.aggregates ?? []).find((x) => x.key === aggKey);
              setSelectedNodeId(a?.sourceRelationId ?? "base");
              setPanelTab("agg");
            } else {
              setSelectedNodeId(n.id);
              setPanelTab("config");
            }
          }}
          nodesConnectable={false}
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
                      <th key={k} className="px-2 py-1 text-left whitespace-nowrap">
                        {k}
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
        <div className="w-[360px] border-l border-border bg-panel flex flex-col overflow-hidden shrink-0">
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
            onChange={(v) => setPanelTab(v as "config" | "agg")}
            options={[
              { value: "config", label: "Cấu hình" },
              {
                value: "agg",
                label: nodeAggregates.length ? `Aggregate (${nodeAggregates.length})` : "Aggregate",
              },
            ]}
            className="px-3 shrink-0"
          />

          <div className="flex-1 overflow-y-auto p-3 space-y-3">
            {panelTab === "config" ? (
              <>
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
                          label: `${f.label || f.name} (${f.name})`,
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
                            label: `${f.label || f.name} (${f.name})`,
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
                            title={f.sourceField}
                          >
                            {f.sourceField}
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
            ) : (
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
                        {a.agg !== "count" && a.valueField ? `(${a.valueField})` : "(*)"} của{" "}
                        {entById(a.targetEntityId)?.name ?? a.targetEntityId}.{a.targetField}
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
                  />
                </Card>
                <p className="text-[11px] text-muted">
                  1-N: gom record con trỏ ngược. N-N: qua bảng nối + entity far. Cột aggregate chỉ
                  đọc, hiện trong bảng Xem trước.
                </p>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Add-object dialog ──────────────────────────────── */}
      {add.open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setAdd(ADD_CLOSED);
          }}
        >
          <div className="w-[460px] bg-panel border border-border rounded-xl shadow-2xl p-5 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-sm">Thêm đối tượng vào canvas</span>
              <button
                type="button"
                onClick={() => setAdd(ADD_CLOSED)}
                className="w-6 h-6 rounded hover:bg-hover/60 flex items-center justify-center text-muted"
              >
                <I.X size={13} />
              </button>
            </div>

            <FormField label="Nối từ node (cha)">
              <SearchableSelect
                className="w-full"
                value={add.parentNodeId}
                onChange={(v) => setAdd((p) => ({ ...p, parentNodeId: v, fromField: "" }))}
                options={nodeIds.map((n) => ({ value: n, label: nodeAlias(n) }))}
              />
            </FormField>

            <FormField label="Đối tượng đích (thêm vào canvas)">
              <SearchableSelect
                className="w-full"
                value={add.targetEntityId}
                onChange={onPickTarget}
                options={entities.map((e) => ({ value: e.id, label: e.name }))}
                placeholder="Chọn đối tượng…"
                searchPlaceholder="Tìm đối tượng…"
              />
            </FormField>

            <div className="grid grid-cols-2 gap-2">
              <FormField label="Cột nguồn (node cha)">
                <SearchableSelect
                  className="w-full"
                  value={add.fromField}
                  onChange={(v) => setAdd((p) => ({ ...p, fromField: v }))}
                  options={addParentFields.map((f) => ({
                    value: f.name,
                    label: `${f.label || f.name} (${f.name})`,
                  }))}
                  placeholder="Chọn cột…"
                />
              </FormField>
              <FormField label="Cột đích (khớp)">
                <SearchableSelect
                  className="w-full"
                  value={add.toField}
                  onChange={(v) => setAdd((p) => ({ ...p, toField: v }))}
                  options={[
                    { value: "id", label: "id (record id)" },
                    ...(addTargetEnt?.fields.map((f) => ({
                      value: f.name,
                      label: `${f.label || f.name} (${f.name})`,
                    })) ?? []),
                  ]}
                />
              </FormField>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <FormField label="Alias">
                <Input
                  className="h-8"
                  value={add.alias}
                  onChange={(e) => setAdd((p) => ({ ...p, alias: e.target.value }))}
                  placeholder="vd: khach_hang"
                />
              </FormField>
              <FormField label="Kiểu join">
                <SearchableSelect
                  className="w-full"
                  value={add.joinKind}
                  onChange={(v) => setAdd((p) => ({ ...p, joinKind: v as "left" | "inner" }))}
                  options={[
                    { value: "left", label: "left (giữ)" },
                    { value: "inner", label: "inner (lọc)" },
                  ]}
                />
              </FormField>
            </div>

            <p className="text-[11px] text-muted">
              Join cột↔cột giả định many-to-one (lấy record đích đầu tiên khớp). Cột nối phải là
              plaintext (không mã hoá) ở cả 2 phía.
            </p>

            <div className="flex gap-2 justify-end pt-1">
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
                disabled={!add.targetEntityId || !add.fromField}
                className="h-8 px-4 text-sm rounded-lg bg-accent text-white hover:bg-accent/90 disabled:opacity-40"
              >
                Thêm
              </button>
            </div>
          </div>
        </div>
      )}
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
