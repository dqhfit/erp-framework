/* ==========================================================
   ERDDesigner.tsx — Canvas ERD dùng @xyflow/react.
   ========================================================== */

import {
  Background,
  type Connection,
  Controls,
  type Edge,
  MarkerType,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EntityERDNode, type EntityERDNodeData } from "@/components/designer/erd-entity-node";
import { FieldTable } from "@/components/designer/FieldTable";
import { I } from "@/components/Icons";
import { Button } from "@/components/ui";
import { dialog } from "@/lib/dialog";
import type { EntityField, MockEntity } from "@/lib/object-types";
import { cn } from "@/lib/utils";
import { useUserObjects } from "@/stores/userObjects";

const REF_TYPES = new Set(["lookup", "multi-lookup", "collection"]);
const nodeTypes = { entityNode: EntityERDNode } as const;

function getCompanyId(): string {
  try {
    return localStorage.getItem("active_company_id") ?? "default";
  } catch {
    return "default";
  }
}

/* ── Build edges ────────────────────────────────────────── */
function buildEdges(entities: MockEntity[]): Edge[] {
  const result: Edge[] = [];
  for (const e of entities) {
    for (const f of e.fields) {
      if (!REF_TYPES.has(f.type) || !f.ref) continue;
      const target = entities.find((x) => x.name === f.ref || x.id === f.ref);
      if (!target) continue;
      const isCollection = f.type === "collection";
      /* Use pk-{fieldId} when target has a valid PK field, else fallback */
      const pkField = target.primaryKey
        ? target.fields.find((tf) => tf.id === target.primaryKey)
        : null;
      const targetHandle = pkField ? `pk-${pkField.id}` : "incoming";
      result.push({
        id: `${e.id}--${f.id}`,
        source: e.id,
        sourceHandle: `field-${f.id}`,
        target: target.id,
        targetHandle,
        label: f.label,
        labelStyle: {
          fontSize: 9,
          fill: "hsl(var(--text))",
          fontFamily: "ui-monospace, monospace",
        },
        labelBgStyle: { fill: "hsl(var(--panel))", fillOpacity: 0.95 },
        labelBgPadding: [3, 2] as [number, number],
        labelBgBorderRadius: 3,
        markerEnd: {
          type: MarkerType.ArrowClosed,
          width: 10,
          height: 10,
          color: isCollection ? "hsl(var(--accent-2))" : "hsl(var(--accent))",
        },
        style: isCollection
          ? { strokeDasharray: "5,3", stroke: "hsl(var(--accent-2))", strokeWidth: 1 }
          : { stroke: "hsl(var(--accent))", strokeWidth: 1 },
        type: "smoothstep",
      });
    }
  }
  return result;
}

/* ── Relationship dialog state type ─────────────────────── */
interface RelDialogState {
  open: boolean;
  mode: "add" | "edit";
  sourceEntityId: string;
  targetEntityId: string;
  fieldId: string | null;
  originalFieldId: string | null;
  label: string;
  name: string;
  type: "lookup" | "multi-lookup" | "collection";
  onDelete: "restrict" | "setnull" | "cascade";
}

const REL_CLOSED: RelDialogState = {
  open: false,
  mode: "add",
  sourceEntityId: "",
  targetEntityId: "",
  fieldId: null,
  originalFieldId: null,
  label: "",
  name: "",
  type: "lookup",
  onDelete: "restrict",
};

const ENTITY_ICONS: Array<keyof typeof I> = [
  "Database",
  "Package",
  "Users",
  "Tag",
  "Layers",
  "Table",
  "Star",
  "BarChart",
  "Calendar",
  "Briefcase",
  "Globe",
  "Folder",
  "Hash",
  "List",
  "MapPin",
  "Workflow",
];

/* ── Inner canvas ───────────────────────────────────────── */
function ERDCanvas() {
  const navigate = useNavigate();
  const { fitView, screenToFlowPosition } = useReactFlow();
  const entities = useUserObjects((s) => s.entities);
  const updateEntityStore = useUserObjects((s) => s.updateEntity);
  const addEntityStore = useUserObjects((s) => s.addEntity);
  const flushEntities = useUserObjects((s) => s.flushEntities);

  const companyId = getCompanyId();
  const STORAGE_KEY = `erd-layout-${companyId}`;

  const savedLayout = useMemo((): Record<string, { x: number; y: number }> => {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    } catch {
      return {};
    }
  }, [STORAGE_KEY]);

  const pendingPositions = useRef<Record<string, { x: number; y: number }>>({});

  /* ── State ──────────────────────────────────────────────── */
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null);
  const [selectedFieldId, setSelectedFieldId] = useState<string | null>(null);
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());
  const [filterOpen, setFilterOpen] = useState(false);
  const [filterSearch, setFilterSearch] = useState("");
  const filterRef = useRef<HTMLDivElement>(null);

  const [newEntOpen, setNewEntOpen] = useState(false);
  const [newEntName, setNewEntName] = useState("");
  const newEntInputRef = useRef<HTMLInputElement>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "done" | "error">("idle");

  const [relDialog, setRelDialog] = useState<RelDialogState>(REL_CLOSED);

  // Entity property editing
  const [entityNameDraft, setEntityNameDraft] = useState<string | null>(null);
  const [iconPickerOpen, setIconPickerOpen] = useState(false);
  const iconPickerRef = useRef<HTMLDivElement>(null);

  /* Click outside filter panel */
  useEffect(() => {
    if (!filterOpen) return;
    const handler = (e: MouseEvent) => {
      if (filterRef.current && !filterRef.current.contains(e.target as Node)) setFilterOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [filterOpen]);

  /* Click outside icon picker */
  useEffect(() => {
    if (!iconPickerOpen) return;
    const handler = (e: MouseEvent) => {
      if (iconPickerRef.current && !iconPickerRef.current.contains(e.target as Node))
        setIconPickerOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [iconPickerOpen]);

  /* Reset entity editing when selection changes */
  // biome-ignore lint/correctness/useExhaustiveDependencies: chủ ý chỉ reset khi selectedEntityId đổi; setters của useState đã stable
  useEffect(() => {
    setEntityNameDraft(null);
    setIconPickerOpen(false);
  }, [selectedEntityId]);

  /* Auto-focus add-entity input */
  useEffect(() => {
    if (newEntOpen) {
      const t = setTimeout(() => newEntInputRef.current?.focus(), 30);
      return () => clearTimeout(t);
    }
  }, [newEntOpen]);

  /* ── Hide/show ──────────────────────────────────────────── */
  const toggleHidden = useCallback((id: string) => {
    setHiddenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setSelectedEntityId((prev) => (prev === id ? null : prev));
  }, []);

  const handleEntityClick = useCallback((id: string) => {
    setSelectedEntityId((prev) => (prev === id ? null : id));
    setSelectedFieldId(null);
  }, []);

  /* ── Build nodes ────────────────────────────────────────── */
  /* Dùng ref để callback có thể đọc entities mới nhất mà không cần deps,
   * tránh makeNode bị recreate mỗi lần entities thay đổi. */
  const entitiesRef = useRef(entities);
  entitiesRef.current = entities;

  const handleSetPrimaryKey = useCallback(
    (entityId: string, fieldId: string) => {
      const ent = entitiesRef.current.find((e) => e.id === entityId);
      if (!ent) return;
      updateEntityStore(entityId, {
        primaryKey: ent.primaryKey === fieldId ? undefined : fieldId,
      });
    },
    [updateEntityStore],
  );

  const makeNode = useCallback(
    (e: (typeof entities)[number], i: number, prevPos?: { x: number; y: number }) => ({
      id: e.id,
      type: "entityNode" as const,
      position: prevPos ??
        pendingPositions.current[e.id] ??
        savedLayout[e.id] ?? { x: (i % 3) * 320, y: Math.floor(i / 3) * 300 },
      data: {
        entity: e,
        /* entities KHÔNG đưa vào data — EntityERDNode đọc thẳng từ Zustand.
         * Tránh tất cả nodes bị rebuild khi bất kỳ entity nào thay đổi. */
        onEntityClick: handleEntityClick,
        onHide: toggleHidden,
        onSetPrimaryKey: handleSetPrimaryKey,
      } as EntityERDNodeData,
    }),
    [savedLayout, handleEntityClick, toggleHidden, handleSetPrimaryKey],
  );

  const [nodes, setNodes, onNodesChange] = useNodesState(entities.map((e, i) => makeNode(e, i)));
  const [edges, setEdges, onEdgesChange] = useEdgesState(buildEdges(entities));

  /* Sync nodes/edges khi entities thay đổi — bỏ qua lần mount đầu vì
   * useNodesState đã khởi tạo đúng rồi; chạy lại gây flicker do ReactFlow
   * nhận node objects mới trước khi có kích thước node thực. */
  const isMountedRef = useRef(false);
  useEffect(() => {
    if (!isMountedRef.current) {
      isMountedRef.current = true;
      return;
    }
    setNodes((prev) =>
      entities.map((e, i) => {
        const existing = prev.find((n) => n.id === e.id);
        return makeNode(e, i, existing?.position);
      }),
    );
    setEdges(buildEdges(entities));
  }, [entities, setNodes, setEdges, makeNode]);

  /* ── Apply hidden state ─────────────────────────────────── */
  const visibleNodes = useMemo(
    () => nodes.map((n) => (hiddenIds.has(n.id) ? { ...n, hidden: true } : n)),
    [nodes, hiddenIds],
  );
  const visibleEdges = useMemo(
    () =>
      edges.map((e) =>
        hiddenIds.has(e.source) || hiddenIds.has(e.target) ? { ...e, hidden: true } : e,
      ),
    [edges, hiddenIds],
  );

  /* ── Persist node positions ─────────────────────────────── */
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleNodesChange = useCallback(
    (changes: Parameters<typeof onNodesChange>[0]) => {
      /* Bỏ "select" changes — ReactFlow tự quản lý nội bộ.
       * Sync ra ngoài gây setNodes → re-render toàn canvas → nhấp nháy. */
      const structural = changes.filter((c) => c.type !== "select");
      if (structural.length) onNodesChange(structural);
      const hasPosition = changes.some((c) => c.type === "position" && !c.dragging);
      if (!hasPosition) return;
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        setNodes((curr) => {
          const layout: Record<string, { x: number; y: number }> = {};
          for (const n of curr) layout[n.id] = n.position;
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

  /* ── Save all entities ──────────────────────────────────── */
  const handleSave = useCallback(async () => {
    setSaveState("saving");
    try {
      await flushEntities();
      setSaveState("done");
    } catch {
      setSaveState("error");
    } finally {
      setTimeout(() => setSaveState("idle"), 2000);
    }
  }, [flushEntities]);

  /* ── Add entity ─────────────────────────────────────────── */
  const handleAddEntity = useCallback(() => {
    const name = newEntName.trim();
    if (!name) return;
    const id = `ent_${Math.random().toString(36).slice(2, 9)}`;
    const pos = screenToFlowPosition({
      x: window.innerWidth / 2,
      y: window.innerHeight / 2,
    });
    pendingPositions.current[id] = pos;
    try {
      const layout = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
      layout[id] = pos;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
    } catch {
      /* noop */
    }
    addEntityStore({ id, name, icon: "Database" as MockEntity["icon"], mcp: "", fields: [] });
    setNewEntOpen(false);
    setNewEntName("");
  }, [newEntName, screenToFlowPosition, addEntityStore, STORAGE_KEY]);

  /* ── Relationship: open add dialog on connect ────────────── */
  const onConnect = useCallback(
    (connection: Connection) => {
      const src = entities.find((e) => e.id === connection.source);
      const tgt = entities.find((e) => e.id === connection.target);
      if (!src || !tgt || src.id === tgt.id) return;
      const baseName = tgt.name
        .toLowerCase()
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_|_$/g, "");
      setRelDialog({
        open: true,
        mode: "add",
        sourceEntityId: src.id,
        targetEntityId: tgt.id,
        fieldId: null,
        originalFieldId: null,
        label: tgt.name,
        name: `${baseName}_id`,
        type: "lookup",
        onDelete: "restrict",
      });
    },
    [entities],
  );

  /* ── Relationship: open edit dialog on edge click ────────── */
  const handleEdgeClick = useCallback(
    (_: React.MouseEvent, edge: Edge) => {
      const [srcId, fieldId] = edge.id.split("--");
      if (!srcId || !fieldId) return;
      const src = entities.find((e) => e.id === srcId);
      const field = src?.fields.find((f) => f.id === fieldId);
      if (!src || !field) return;
      setRelDialog({
        open: true,
        mode: "edit",
        sourceEntityId: src.id,
        targetEntityId: edge.target,
        fieldId,
        originalFieldId: fieldId,
        label: field.label,
        name: field.name,
        type: field.type as RelDialogState["type"],
        onDelete: field.onDelete ?? "restrict",
      });
    },
    [entities],
  );

  /* ── Relationship: confirm ──────────────────────────────── */
  const handleRelConfirm = useCallback(() => {
    const {
      mode,
      sourceEntityId,
      targetEntityId,
      fieldId,
      originalFieldId,
      label,
      name,
      type,
      onDelete,
    } = relDialog;
    if (!targetEntityId) return;
    if (fieldId === null && (!label.trim() || !name.trim())) return;
    const src = entities.find((e) => e.id === sourceEntityId);
    if (!src) return;

    if (mode === "add") {
      if (fieldId === null) {
        /* Tạo field mới */
        const newField: EntityField = {
          id: `nf_${Math.random().toString(36).slice(2, 7)}`,
          name: name.trim(),
          label: label.trim(),
          type,
          ref: targetEntityId,
          onDelete: type !== "collection" ? onDelete : undefined,
        };
        updateEntityStore(sourceEntityId, { fields: [...src.fields, newField] });
      } else {
        /* Dùng field có sẵn làm FK */
        updateEntityStore(sourceEntityId, {
          fields: src.fields.map((f) =>
            f.id === fieldId
              ? {
                  ...f,
                  type,
                  ref: targetEntityId,
                  onDelete: type !== "collection" ? onDelete : undefined,
                }
              : f,
          ),
        });
      }
    } else if (fieldId) {
      if (fieldId !== originalFieldId && originalFieldId) {
        /* Field thay đổi: xoá ref cũ, cập nhật field mới */
        updateEntityStore(sourceEntityId, {
          fields: src.fields.map((f) => {
            if (f.id === originalFieldId) return { ...f, ref: undefined, onDelete: undefined };
            if (f.id === fieldId)
              return {
                ...f,
                label: label.trim(),
                name: name.trim(),
                type,
                ref: targetEntityId,
                onDelete: type !== "collection" ? onDelete : undefined,
              };
            return f;
          }),
        });
      } else {
        /* Field giữ nguyên */
        updateEntityStore(sourceEntityId, {
          fields: src.fields.map((f) =>
            f.id === fieldId
              ? {
                  ...f,
                  label: label.trim(),
                  name: name.trim(),
                  type,
                  ref: targetEntityId,
                  onDelete: type !== "collection" ? onDelete : undefined,
                }
              : f,
          ),
        });
      }
    }
    setRelDialog(REL_CLOSED);
  }, [relDialog, entities, updateEntityStore]);

  /* ── Relationship: delete ───────────────────────────────── */
  const handleRelDelete = useCallback(async () => {
    const { sourceEntityId, fieldId } = relDialog;
    const src = entities.find((e) => e.id === sourceEntityId);
    if (!src || !fieldId) return;
    const ok = await dialog.confirm("Xoá relationship này?");
    if (!ok) return;
    updateEntityStore(sourceEntityId, {
      fields: src.fields.filter((f) => f.id !== fieldId),
    });
    setRelDialog(REL_CLOSED);
  }, [relDialog, entities, updateEntityStore]);

  /* ── Right panel ────────────────────────────────────────── */
  const selectedEntity = entities.find((e) => e.id === selectedEntityId);

  const handleFieldUpdate = useCallback(
    (fieldId: string, patch: Partial<EntityField>) => {
      if (!selectedEntity) return;
      updateEntityStore(selectedEntity.id, {
        fields: selectedEntity.fields.map((f) => (f.id === fieldId ? { ...f, ...patch } : f)),
      });
    },
    [selectedEntity, updateEntityStore],
  );

  const saveEntityName = useCallback(() => {
    if (!selectedEntity || entityNameDraft === null) return;
    const trimmed = entityNameDraft.trim();
    if (trimmed && trimmed !== selectedEntity.name)
      updateEntityStore(selectedEntity.id, { name: trimmed });
    setEntityNameDraft(null);
  }, [selectedEntity, entityNameDraft, updateEntityStore]);

  const saveEntityIcon = useCallback(
    (icon: MockEntity["icon"]) => {
      if (!selectedEntity) return;
      updateEntityStore(selectedEntity.id, { icon });
      setIconPickerOpen(false);
    },
    [selectedEntity, updateEntityStore],
  );

  const visibleCount = entities.length - hiddenIds.size;
  const filteredForPanel = filterSearch
    ? entities.filter((e) => e.name.toLowerCase().includes(filterSearch.toLowerCase()))
    : entities;

  const relSrcEntity = entities.find((e) => e.id === relDialog.sourceEntityId);
  const relTgtEntity = entities.find((e) => e.id === relDialog.targetEntityId);
  const relTgtPKField = relTgtEntity?.primaryKey
    ? relTgtEntity.fields.find((f) => f.id === relTgtEntity.primaryKey)
    : null;

  return (
    <div className="flex h-full w-full">
      {/* Canvas */}
      <div className="flex-1 h-full relative">
        <ReactFlow
          nodes={visibleNodes}
          edges={visibleEdges}
          nodeTypes={nodeTypes}
          onNodesChange={handleNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onEdgeClick={handleEdgeClick}
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

        {/* Toolbar overlay */}
        <div className="absolute top-3 left-3 flex items-center gap-2 z-10 flex-wrap">
          {/* Add entity */}
          <button
            type="button"
            onClick={() => setNewEntOpen(true)}
            className="h-8 px-3 rounded-lg bg-accent text-white text-xs hover:bg-accent/90 flex items-center gap-1.5 shadow-sm"
          >
            <I.Plus size={12} />
            Thêm bảng
          </button>

          {/* Save */}
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saveState === "saving"}
            className={cn(
              "h-8 px-3 rounded-lg border text-xs flex items-center gap-1.5 shadow-sm transition-colors",
              saveState === "idle" && "bg-panel border-border hover:bg-hover/50",
              saveState === "saving" && "bg-panel border-border opacity-60 cursor-not-allowed",
              saveState === "done" && "bg-success/10 border-success/30 text-success",
              saveState === "error" && "bg-danger/10 border-danger/30 text-danger",
            )}
          >
            {saveState === "saving" && <I.Loader size={12} className="animate-spin" />}
            {saveState === "done" && <I.Check size={12} />}
            {saveState === "error" && <I.X size={12} />}
            {saveState === "idle" && <I.Save size={12} />}
            {saveState === "saving"
              ? "Đang lưu..."
              : saveState === "done"
                ? "Đã lưu"
                : saveState === "error"
                  ? "Lỗi lưu"
                  : "Lưu"}
          </button>

          <button
            type="button"
            onClick={() => fitView({ padding: 0.2, duration: 400 })}
            className="h-8 px-3 rounded-lg bg-panel border border-border text-xs hover:bg-hover/50 flex items-center gap-1.5 shadow-sm"
          >
            <I.Eye size={12} />
            Fit view
          </button>

          {/* Filter panel */}
          <div ref={filterRef} className="relative">
            <button
              type="button"
              onClick={() => setFilterOpen((v) => !v)}
              className={cn(
                "h-8 px-3 rounded-lg border text-xs flex items-center gap-1.5 shadow-sm",
                filterOpen || hiddenIds.size > 0
                  ? "bg-accent/15 border-accent/40 text-accent"
                  : "bg-panel border-border hover:bg-hover/50",
              )}
            >
              <I.List size={12} />
              Bảng
              {hiddenIds.size > 0 && (
                <span className="ml-0.5 bg-accent text-white text-[10px] leading-none px-1.5 py-0.5 rounded-full">
                  {hiddenIds.size} ẩn
                </span>
              )}
            </button>

            {filterOpen && (
              <div className="absolute left-0 top-9 w-56 bg-panel border border-border rounded-lg shadow-xl flex flex-col max-h-80">
                {/* Search input */}
                <div className="px-2 pt-1.5 pb-1 shrink-0">
                  <div className="flex items-center gap-1.5 h-7 px-2 rounded-md border border-border bg-bg">
                    <I.Search size={11} className="text-muted shrink-0" />
                    <input
                      value={filterSearch}
                      onChange={(e) => setFilterSearch(e.target.value)}
                      placeholder="Tìm bảng..."
                      className="flex-1 bg-transparent outline-none text-xs"
                      onClick={(e) => e.stopPropagation()}
                    />
                    {filterSearch && (
                      <button type="button" onClick={() => setFilterSearch("")}>
                        <I.X size={10} className="text-muted hover:text-text" />
                      </button>
                    )}
                  </div>
                </div>

                <div className="flex items-center justify-between px-3 py-1 border-b border-border shrink-0">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-muted">
                    {visibleCount}/{entities.length} hiển thị
                  </span>
                  {hiddenIds.size > 0 && (
                    <button
                      type="button"
                      onClick={() => setHiddenIds(new Set())}
                      className="text-[10px] text-accent hover:underline"
                    >
                      Hiện tất cả
                    </button>
                  )}
                </div>

                <div className="overflow-y-auto flex-1 py-0.5">
                  {filteredForPanel.length === 0 && (
                    <div className="text-xs text-muted italic text-center py-4">Không tìm thấy</div>
                  )}
                  {filteredForPanel.map((e) => {
                    const hidden = hiddenIds.has(e.id);
                    return (
                      <button
                        key={e.id}
                        type="button"
                        onClick={() => toggleHidden(e.id)}
                        className={cn(
                          "w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-hover/50 text-left transition-opacity",
                          hidden && "opacity-40",
                        )}
                      >
                        {hidden ? (
                          <I.EyeOff size={12} className="shrink-0 text-muted" />
                        ) : (
                          <I.Eye size={12} className="shrink-0 text-accent" />
                        )}
                        <span className="font-mono flex-1 truncate">{e.name}</span>
                        <span className="text-muted shrink-0">{e.fields.length}f</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          <div className="h-8 px-3 rounded-lg bg-panel border border-border text-xs flex items-center gap-1.5 shadow-sm text-muted">
            <I.Database size={12} />
            {visibleCount} bảng · {visibleEdges.filter((e) => !e.hidden).length} quan hệ
          </div>
        </div>
      </div>

      {/* Right panel */}
      {selectedEntity && (
        <div className="w-[380px] border-l border-border bg-panel flex flex-col overflow-hidden shrink-0">
          {/* Header: icon picker + inline name + actions */}
          <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border">
            {/* Icon picker */}
            <div ref={iconPickerRef} className="relative shrink-0">
              {(() => {
                const IC = I[selectedEntity.icon] ?? I.Database;
                return (
                  <button
                    type="button"
                    onClick={() => setIconPickerOpen((v) => !v)}
                    className={cn(
                      "w-7 h-7 rounded-md flex items-center justify-center transition-colors",
                      iconPickerOpen
                        ? "bg-accent/20 text-accent"
                        : "bg-accent/10 text-accent hover:bg-accent/20",
                    )}
                    title="Đổi icon"
                  >
                    <IC size={14} />
                  </button>
                );
              })()}
              {iconPickerOpen && (
                <div className="absolute left-0 top-8 z-50 bg-panel border border-border rounded-xl shadow-xl p-2 grid grid-cols-4 gap-1 w-[148px]">
                  {ENTITY_ICONS.map((iconName) => {
                    const IC = I[iconName] ?? I.Database;
                    return (
                      <button
                        key={iconName}
                        type="button"
                        onClick={() => saveEntityIcon(iconName as MockEntity["icon"])}
                        className={cn(
                          "w-8 h-8 rounded-md flex items-center justify-center transition-colors",
                          selectedEntity.icon === iconName
                            ? "bg-accent/15 text-accent"
                            : "text-muted hover:bg-hover/60 hover:text-text",
                        )}
                        title={iconName}
                      >
                        <IC size={14} />
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Inline name edit */}
            <div className="flex-1 min-w-0">
              {entityNameDraft !== null ? (
                <input
                  value={entityNameDraft}
                  onChange={(e) => setEntityNameDraft(e.target.value)}
                  onBlur={saveEntityName}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") saveEntityName();
                    if (e.key === "Escape") setEntityNameDraft(null);
                    e.stopPropagation();
                  }}
                  className="w-full h-7 px-2 rounded-md border border-accent bg-input text-sm font-semibold font-mono focus:outline-none"
                  // biome-ignore lint/a11y/noAutofocus: intentional focus for inline editing
                  autoFocus
                />
              ) : (
                <span
                  className="font-semibold text-sm truncate block cursor-text hover:text-accent transition-colors select-none"
                  title="Double-click để đổi tên"
                  onDoubleClick={() => setEntityNameDraft(selectedEntity.name)}
                >
                  {selectedEntity.name}
                </span>
              )}
            </div>

            <Button
              variant="ghost"
              size="sm"
              icon={<I.ExternalLink size={13} />}
              onClick={() => navigate({ to: "/entities/$id", params: { id: selectedEntity.id } })}
            >
              Editor
            </Button>
            <button
              type="button"
              onClick={() => setSelectedEntityId(null)}
              className="w-6 h-6 rounded hover:bg-hover/60 flex items-center justify-center text-muted"
            >
              <I.X size={13} />
            </button>
          </div>

          {/* Primary key selector */}
          <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-panel-2">
            <I.Key
              size={12}
              className={cn(selectedEntity.primaryKey ? "text-warning" : "text-muted")}
            />
            <span className="text-xs text-muted shrink-0">Khoá chính</span>
            <select
              value={selectedEntity.primaryKey ?? ""}
              onChange={(e) => {
                const val = e.target.value;
                updateEntityStore(selectedEntity.id, {
                  primaryKey: val || undefined,
                });
              }}
              className="flex-1 h-6 px-1.5 rounded border border-border bg-input text-xs font-mono focus:outline-none focus:border-accent"
            >
              <option value="">— chưa đặt —</option>
              {selectedEntity.fields
                .filter((f) => !REF_TYPES.has(f.type))
                .map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
            </select>
          </div>

          <div className="flex-1 overflow-y-auto p-3">
            <div className="text-xs text-muted mb-2">
              {selectedEntity.fields.length} fields — double-click tên để đổi tên bảng
            </div>
            {selectedEntity.fields.length === 0 ? (
              <div className="text-xs text-muted italic text-center py-6">Chưa có field</div>
            ) : (
              <FieldTable
                fields={selectedEntity.fields}
                selectedId={selectedFieldId}
                entities={entities}
                onSelect={setSelectedFieldId}
                onUpdate={handleFieldUpdate}
                onReorder={(from, to) => {
                  if (from === to) return;
                  const fields = [...selectedEntity.fields];
                  const [moved] = fields.splice(from, 1);
                  if (moved) fields.splice(to > from ? to - 1 : to, 0, moved);
                  updateEntityStore(selectedEntity.id, { fields });
                }}
                onDelete={(id) => {
                  updateEntityStore(selectedEntity.id, {
                    fields: selectedEntity.fields.filter((f) => f.id !== id),
                  });
                }}
                onDuplicate={(id) => {
                  const idx = selectedEntity.fields.findIndex((f) => f.id === id);
                  const f = selectedEntity.fields[idx];
                  if (!f) return;
                  const newF: EntityField = {
                    ...f,
                    id: `nf_${Math.random().toString(36).slice(2, 7)}`,
                    name: `${f.name}_copy`,
                    label: `${f.label} (copy)`,
                  };
                  const fields = [...selectedEntity.fields];
                  fields.splice(idx + 1, 0, newF);
                  updateEntityStore(selectedEntity.id, { fields });
                }}
              />
            )}
          </div>
        </div>
      )}

      {/* ── Add entity dialog ──────────────────────────────── */}
      {newEntOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) {
              setNewEntOpen(false);
              setNewEntName("");
            }
          }}
        >
          <div className="w-80 bg-panel border border-border rounded-xl shadow-2xl p-5 flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-sm">Thêm đối tượng mới</span>
              <button
                type="button"
                onClick={() => {
                  setNewEntOpen(false);
                  setNewEntName("");
                }}
                className="w-6 h-6 rounded hover:bg-hover/60 flex items-center justify-center text-muted"
              >
                <I.X size={13} />
              </button>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs text-muted">Tên đối tượng</label>
              <input
                ref={newEntInputRef}
                value={newEntName}
                onChange={(e) => setNewEntName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleAddEntity();
                  if (e.key === "Escape") {
                    setNewEntOpen(false);
                    setNewEntName("");
                  }
                }}
                className="h-9 px-3 rounded-lg border border-border bg-input text-sm font-mono focus:outline-none focus:border-accent"
                placeholder="vd: SanPham, DonHang"
              />
              <p className="text-[11px] text-muted">PascalCase hoặc snake_case, không dấu</p>
            </div>

            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => {
                  setNewEntOpen(false);
                  setNewEntName("");
                }}
                className="h-8 px-3 text-sm rounded-lg border border-border hover:bg-hover/50"
              >
                Huỷ
              </button>
              <button
                type="button"
                onClick={handleAddEntity}
                disabled={!newEntName.trim()}
                className="h-8 px-4 text-sm rounded-lg bg-accent text-white hover:bg-accent/90 disabled:opacity-40"
              >
                Tạo
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Relationship dialog ──────────────────────────────── */}
      {relDialog.open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setRelDialog(REL_CLOSED);
          }}
        >
          <div className="w-[520px] bg-panel border border-border rounded-xl shadow-2xl p-5 flex flex-col gap-4">
            {/* Header */}
            <div className="flex items-center justify-between">
              <span className="font-semibold text-sm">
                {relDialog.mode === "add" ? "Thêm relationship" : "Sửa relationship"}
              </span>
              <button
                type="button"
                onClick={() => setRelDialog(REL_CLOSED)}
                className="w-6 h-6 rounded hover:bg-hover/60 flex items-center justify-center text-muted"
              >
                <I.X size={13} />
              </button>
            </div>

            {/* Two-column: source | target */}
            <div className="grid grid-cols-2 gap-3">
              {/* Left — nguồn (FK) */}
              <div className="flex flex-col gap-2.5 p-3 rounded-lg border border-border bg-panel-2">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-muted">
                  Khoá ngoại (nguồn)
                </div>
                <div className="flex items-center gap-1.5 px-2 py-1.5 rounded-md bg-panel border border-border">
                  {(() => {
                    const IC = I[relSrcEntity?.icon ?? "Database"] ?? I.Database;
                    return <IC size={11} className="text-accent shrink-0" />;
                  })()}
                  <span className="text-xs font-mono font-medium text-accent truncate">
                    {relSrcEntity?.name ?? "—"}
                  </span>
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] text-muted">Label</label>
                  <input
                    value={relDialog.label}
                    // biome-ignore lint/a11y/noAutofocus: intentional focus
                    autoFocus
                    onChange={(e) => {
                      const label = e.target.value;
                      setRelDialog((prev) => ({
                        ...prev,
                        label,
                        name:
                          prev.mode === "add"
                            ? `${label
                                .toLowerCase()
                                .normalize("NFD")
                                .replace(/[̀-ͯ]/g, "")
                                .replace(/[^a-z0-9]+/g, "_")
                                .replace(/^_|_$/g, "")}_id`
                            : prev.name,
                      }));
                    }}
                    className="h-7 px-2 rounded-md border border-border bg-input text-sm focus:outline-none focus:border-accent"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] text-muted">Field</label>
                  <select
                    value={relDialog.fieldId ?? ""}
                    onChange={(e) => {
                      const selId = e.target.value;
                      if (!selId) {
                        setRelDialog((prev) => ({ ...prev, fieldId: null, name: "", label: "" }));
                      } else {
                        const f = relSrcEntity?.fields.find((ff) => ff.id === selId);
                        if (f) {
                          setRelDialog((prev) => ({
                            ...prev,
                            fieldId: selId,
                            name: f.name,
                            label: f.label,
                            ...(REF_TYPES.has(f.type)
                              ? { type: f.type as RelDialogState["type"] }
                              : {}),
                            ...(f.ref ? { targetEntityId: f.ref } : {}),
                          }));
                        }
                      }
                    }}
                    className="h-7 px-2 rounded-md border border-border bg-input text-xs font-mono focus:outline-none focus:border-accent"
                  >
                    <option value="">— Tạo field mới —</option>
                    {relSrcEntity?.fields.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name} ({f.type})
                      </option>
                    ))}
                  </select>
                </div>
                {relDialog.fieldId === null && (
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] text-muted">Field name</label>
                    <input
                      value={relDialog.name}
                      onChange={(e) => setRelDialog((prev) => ({ ...prev, name: e.target.value }))}
                      className="h-7 px-2 rounded-md border border-border bg-input text-xs font-mono focus:outline-none focus:border-accent"
                    />
                  </div>
                )}
              </div>

              {/* Right — đích (PK) */}
              <div className="flex flex-col gap-2.5 p-3 rounded-lg border border-border bg-panel-2">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-muted">
                  Khoá chính (đích)
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] text-muted">Bảng đích</label>
                  <select
                    value={relDialog.targetEntityId}
                    onChange={(e) => {
                      const newId = e.target.value;
                      const newTgt = entities.find((ent) => ent.id === newId);
                      setRelDialog((prev) => ({
                        ...prev,
                        targetEntityId: newId,
                        ...(prev.mode === "add" && newTgt
                          ? {
                              label: newTgt.name,
                              name: `${newTgt.name
                                .toLowerCase()
                                .normalize("NFD")
                                .replace(/[̀-ͯ]/g, "")
                                .replace(/[^a-z0-9]+/g, "_")
                                .replace(/^_|_$/g, "")}_id`,
                            }
                          : {}),
                      }));
                    }}
                    className="h-7 px-2 rounded-md border border-border bg-input text-xs font-mono focus:outline-none focus:border-accent"
                  >
                    {entities
                      .filter((e) => e.id !== relDialog.sourceEntityId)
                      .map((e) => (
                        <option key={e.id} value={e.id}>
                          {e.name}
                        </option>
                      ))}
                  </select>
                </div>
                {/* PK field info */}
                <div className="flex-1 flex flex-col justify-end gap-1">
                  <label className="text-[10px] text-muted">Khoá chính</label>
                  {relTgtPKField ? (
                    <div className="flex items-center gap-1.5 h-7 px-2 rounded-md border border-warning/30 bg-warning/5">
                      <I.Key size={11} className="text-warning shrink-0" />
                      <span className="text-xs font-mono text-warning font-medium truncate">
                        {relTgtPKField.name}
                      </span>
                      <span className="text-[10px] text-muted ml-auto shrink-0">
                        {relTgtPKField.type}
                      </span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5 h-7 px-2 rounded-md border border-dashed border-border">
                      <span className="text-[10px] text-muted italic">Chưa đặt khoá chính</span>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Relationship type */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs text-muted">Loại quan hệ</label>
              <div className="flex gap-2">
                {(["lookup", "multi-lookup", "collection"] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setRelDialog((prev) => ({ ...prev, type: t }))}
                    className={cn(
                      "flex-1 h-8 text-xs rounded-lg border transition-colors",
                      relDialog.type === t
                        ? "border-accent bg-accent/10 text-accent"
                        : "border-border text-muted hover:border-accent/40",
                    )}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>

            {/* On delete */}
            {relDialog.type !== "collection" && (
              <div className="flex flex-col gap-1.5">
                <label className="text-xs text-muted">Khi xoá record đích</label>
                <select
                  value={relDialog.onDelete}
                  onChange={(e) =>
                    setRelDialog((prev) => ({
                      ...prev,
                      onDelete: e.target.value as RelDialogState["onDelete"],
                    }))
                  }
                  className="h-8 px-2 rounded-lg border border-border bg-input text-sm focus:outline-none focus:border-accent"
                >
                  <option value="restrict">Chặn xoá (restrict)</option>
                  <option value="setnull">Xoá ref (set null)</option>
                  <option value="cascade">Xoá theo (cascade)</option>
                </select>
              </div>
            )}

            {/* Actions */}
            <div className="flex items-center gap-2 pt-1 border-t border-border">
              {relDialog.mode === "edit" && (
                <button
                  type="button"
                  onClick={() => void handleRelDelete()}
                  className="h-8 px-3 text-sm rounded-lg border border-danger/30 text-danger hover:bg-danger/10 transition-colors"
                >
                  Xoá
                </button>
              )}
              <div className="flex-1" />
              <button
                type="button"
                onClick={() => setRelDialog(REL_CLOSED)}
                className="h-8 px-3 text-sm rounded-lg border border-border hover:bg-hover/50"
              >
                Huỷ
              </button>
              <button
                type="button"
                onClick={handleRelConfirm}
                disabled={
                  !relDialog.targetEntityId ||
                  (relDialog.fieldId === null &&
                    (!relDialog.label.trim() || !relDialog.name.trim()))
                }
                className="h-8 px-4 text-sm rounded-lg bg-accent text-white hover:bg-accent/90 disabled:opacity-40"
              >
                {relDialog.mode === "add" ? "Thêm" : "Lưu"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function ERDDesigner() {
  return (
    <ReactFlowProvider>
      <ERDCanvas />
    </ReactFlowProvider>
  );
}
