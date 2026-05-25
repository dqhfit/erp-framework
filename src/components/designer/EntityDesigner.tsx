import { useEffect, useState, Fragment } from "react";
import { Button, Chip, FormField, EmptyState, InlineEdit, Switch, Tabs, Input, Select, Textarea } from "@/components/ui";
import { I } from "@/components/Icons";
import { type MockEntity, type EntityField } from "@/lib/object-types";
import { getFieldTypes } from "@/lib/field-types";
import { McpImportModal, type McpImportResult } from "@/components/designer/McpImportModal";
import { McpBindingsEditor, type McpBindings } from "@/components/designer/McpBindingsEditor";
import { FormulaEditor } from "@/components/designer/FormulaEditor";
import { EnumPicker } from "@/components/designer/EnumPicker";
import { AiAssistDrawer } from "@/components/designer/AiAssistDrawer";
import { EntitySyncPanel } from "@/components/EntitySyncPanel";
import { inferMcpBindings, countBoundOps } from "@/lib/mcp-binding-infer";
import { useMcpClient } from "@/hooks/useMcpClient";
import { useUserObjects } from "@/stores/userObjects";
import { createApiDataSource } from "@erp-framework/client";
import { syncEntityFromMcp, inferPkField } from "@/lib/mcp-sync";
import type { EntityDesign } from "@/lib/ai-design-prompts";
import { useUI } from "@/stores/ui";
import { cn } from "@/lib/utils";
import { useT } from "@/hooks/useT";

interface Props { entityId: string }

export function EntityDesigner({ entityId }: Props) {
  const t = useT();
  const userEntities = useUserObjects((s) => s.entities);
  const fallbackEntity: MockEntity = {
    id: entityId, name: "Entity", icon: "Database", mcp: "", fields: [],
  };
  const initial = userEntities.find((e) => e.id === entityId) ?? fallbackEntity;
  const mode = useUI((s) => s.mode);
  const inspectorVisible = useUI((s) => s.inspectorVisible);

  const [entity, setEntity] = useState<MockEntity>(initial);
  const [selected, setSelected] = useState<string | null>(null);
  const [insTab, setInsTab] = useState<"data" | "style" | "events">("data");
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);
  const [dragFromPalette, setDragFromPalette] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const { tools: mcpTools } = useMcpClient();

  useEffect(() => {
    setEntity(userEntities.find((e) => e.id === entityId) ?? fallbackEntity);
    setSelected(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityId, userEntities]);

  const addField = (type: string, atIdx?: number) => {
    const ft = getFieldTypes().find((f) => f.id === type);
    if (!ft) return;
    const id = "nf_" + Math.random().toString(36).slice(2, 7);
    const newField: EntityField = {
      id, name: `${type}_${entity.fields.length + 1}`, label: ft.name, type, required: false,
    };
    setEntity((e) => {
      const idx = atIdx ?? e.fields.length;
      const fields = [...e.fields];
      fields.splice(idx, 0, newField);
      return { ...e, fields };
    });
    setSelected(id);
  };
  const updateField = (id: string, patch: Partial<EntityField>) =>
    setEntity((e) => ({ ...e, fields: e.fields.map((f) => f.id === id ? { ...f, ...patch } : f) }));
  const deleteField = (id: string) => {
    setEntity((e) => ({ ...e, fields: e.fields.filter((f) => f.id !== id) }));
    if (selected === id) setSelected(null);
  };
  const reorder = (from: number, to: number) => {
    if (from === to) return;
    setEntity((e) => {
      const fields = [...e.fields];
      const [moved] = fields.splice(from, 1);
      if (moved) fields.splice(to > from ? to - 1 : to, 0, moved);
      return { ...e, fields };
    });
  };

  const selectedField = entity.fields.find((f) => f.id === selected);

  const handleMcpImport = (result: McpImportResult) => {
    const { fields, mode, dataMode, rows, tool, args, availableTools } = result;
    // FieldDef từ schema-infer dùng `key`. EntityField của mock dùng `name`+`label`+`id`.
    const converted: EntityField[] = fields.map((f, i) => ({
      id: "imp_" + Date.now() + "_" + i,
      name: f.key,
      label: f.label,
      type: f.type,
      required: f.required,
      ref: f.ref,
    }));

    // Suy luận primary key — ưu tiên field tên "id", "code", hoặc field required đầu tiên
    const pk =
      converted.find((f) => f.name === "id")?.name
      ?? converted.find((f) => f.name === "code")?.name
      ?? converted.find((f) => f.required)?.name
      ?? converted[0]?.name
      ?? "id";

    // Suy luận bindings từ tool đã dùng + sibling tools
    const inferredBindings = inferMcpBindings(tool, args, availableTools, pk);
    const opsBound = countBoundOps(inferredBindings);

    setEntity((e) => {
      // Replace: bindings hoàn toàn từ inference.
      // Append: merge — giữ binding cũ, chỉ thêm op nào chưa có
      const mergedBindings: McpBindings = mode === "replace"
        ? inferredBindings
        : { ...(e.mcpBindings ?? {}), ...inferredBindings };
      return {
        ...e,
        fields: mode === "replace" ? converted : [...e.fields, ...converted],
        mcpBindings: mergedBindings,
      };
    });
    if (dataMode === "snapshot" && rows.length > 0) {
      setPendingRows(rows);
      setImportToast(t("entity.import_snapshot_toast", {
        fieldsCount: converted.length, rows: rows.length,
      }));
    } else {
      setImportToast(t("entity.import_toast", { fieldsCount: converted.length, opsBound }));
    }
  };

  // Áp dụng đề xuất từ AI Assistant — replace toàn bộ schema + bindings
  const handleAiApply = (design: EntityDesign) => {
    const fields: EntityField[] = design.fields.map((f, i) => ({
      id: "ai_" + Date.now() + "_" + i,
      name: f.name,
      label: f.label,
      type: f.type,
      required: f.required,
      options: f.options,
      ref: f.ref,
      formula: f.formula,
    }));
    const pk = design.primaryKey
      ?? fields.find((f) => f.name === "id")?.name
      ?? fields.find((f) => f.name === "code")?.name
      ?? fields.find((f) => f.required)?.name
      ?? fields[0]?.name
      ?? "id";
    const mcpName = design.mcp || entity.mcp;
    const availableToolNames = mcpTools.map((t) => t.name);
    const inferred = availableToolNames.length
      ? inferMcpBindings(`${mcpName}.list`, {}, availableToolNames, pk)
      : { list: { tool: `${mcpName}.list`, args: [] } };
    setEntity((e) => ({
      ...e,
      name: design.name ?? e.name,
      mcp: mcpName,
      icon: (design.icon as MockEntity["icon"]) ?? e.icon,
      fields,
      mcpBindings: inferred,
    }));
    setImportToast(t("entity.ai_apply_toast", { count: fields.length }));
    setAiOpen(false);
  };

  // Toast hiển thị sau import — fade 4s
  const [importToast, setImportToast] = useState<string | null>(null);
  // Dòng dữ liệu mẫu MCP chờ ghi vào DB sau khi Lưu (dataMode = snapshot).
  const [pendingRows, setPendingRows] = useState<Record<string, unknown>[]>([]);
  useEffect(() => {
    if (!importToast) return;
    const t = setTimeout(() => setImportToast(null), 4000);
    return () => clearTimeout(t);
  }, [importToast]);


  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const upsertEntity = useUserObjects((s) => s.upsertEntity);
  const save = () => {
    setSaving(true);
    upsertEntity(entity);
    const rows = pendingRows;
    // Delay để store kịp lưu fields lên DB trước khi tạo record (validate-on-write).
    setTimeout(() => {
      void (async () => {
        if (rows.length > 0) {
          const ds = createApiDataSource("");
          let ok = 0;
          for (const r of rows) {
            try { await ds.createRecord(entity.id, r); ok++; }
            catch { /* dòng không hợp lệ với schema — bỏ qua */ }
          }
          setPendingRows([]);
          setImportToast(t("entity.records_imported", { count: ok }));
        } else {
          setImportToast(t("entity.save_toast", {
            name: entity.name, count: entity.fields.length,
          }));
        }
        setSaving(false);
        setLastSaved(new Date());
      })();
    }, 700);
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") { e.preventDefault(); save(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Đồng bộ thủ công: kéo dữ liệu từ MCP, upsert vào DB theo khóa.
  const doMcpSync = async () => {
    if (syncing) return;
    setSyncing(true);
    try {
      const pk = inferPkField(entity.fields.map((f) => f.name));
      const res = await syncEntityFromMcp(entity.id, entity.mcpBindings, pk);
      setImportToast(t("entity.sync_done", {
        created: res.created, updated: res.updated,
      }));
    } catch (e) {
      setImportToast("Lỗi đồng bộ: " + (e as Error).message);
    } finally {
      setSyncing(false);
    }
  };

  const IconC = I[entity.icon] ?? I.Database;
  const isConsumer = mode === "consumer";

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="h-11 shrink-0 flex items-center px-3 gap-2 border-b border-border bg-panel">
        <div className="flex items-center gap-2 mr-2">
          <div className="w-7 h-7 rounded-md bg-accent/15 text-accent flex items-center justify-center">
            <IconC size={14} />
          </div>
          <div className="flex flex-col leading-tight">
            <InlineEdit
              value={entity.name}
              onChange={(v) => setEntity({ ...entity, name: v })}
              className="font-semibold text-base"
            />
            <div className="text-[11px] text-muted font-mono">{entity.mcp} · {entity.fields.length} fields</div>
          </div>
        </div>
        <span className="text-muted text-xs">/</span>
        <span className="text-xs text-muted">Entity Designer</span>
        <div className="flex-1" />
        <Button variant="default" size="sm" icon={<I.Sparkles size={13} />} onClick={() => setAiOpen(true)}
          title={t("designer.ai_assist_tip")}>
          AI Assist
        </Button>
        <Button variant="default" size="sm" icon={<I.Database size={13} />} onClick={() => setImportOpen(true)}>
          {t("designer.import_from_mcp")}
        </Button>
        {entity.mcpBindings?.list?.tool && (
          <Button
            variant="default" size="sm"
            icon={syncing
              ? <I.Loader size={13} className="animate-spin" />
              : <I.Redo size={13} />}
            onClick={() => void doMcpSync()}
            disabled={syncing}
          >
            {syncing ? t("entity.syncing") : t("entity.sync_btn")}
          </Button>
        )}
        <div className="w-px h-5 bg-border mx-1" />
        <Button variant="ghost" size="sm" icon={<I.Undo size={13} />}>Undo</Button>
        <Button variant="ghost" size="sm" icon={<I.Redo size={13} />} title="Redo" />
        <div className="w-px h-5 bg-border mx-1" />
        <Button variant="ghost" size="sm" icon={<I.Play size={13} />}>Form</Button>
        <Button variant="default" size="sm" icon={<I.Eye size={13} />}>Preview</Button>
        <Button
          variant="primary" size="sm" onClick={save}
          icon={saving ? <I.Loader size={13} className="animate-spin" /> : <I.Save size={13} />}
        >
          {saving ? t("designer.saving") : t("designer.save_with_shortcut")}
        </Button>
        {lastSaved && !saving && (
          <span className="text-xs text-muted ml-2 flex items-center gap-1">
            <I.Check size={11} className="text-success" /> {t("designer.saved")}
          </span>
        )}
      </div>

      {/* Body */}
      <div className="flex-1 flex overflow-auto min-w-0">
        {/* Field palette */}
        {!isConsumer && (
          <div className="w-[220px] shrink-0 border-r border-border bg-panel flex flex-col">
            <div className="px-3 py-2.5 border-b border-border">
              <div className="text-[10px] uppercase tracking-wider text-muted font-semibold">Field types</div>
              <div className="text-xs text-muted mt-0.5">{t("designer.drag_to_list")}</div>
            </div>
            <div className="flex-1 overflow-y-auto p-1.5 grid grid-cols-2 gap-1.5 content-start">
              {getFieldTypes().map((ft) => {
                const IC = I[ft.icon] ?? I.Type;
                return (
                  <div
                    key={ft.id}
                    draggable
                    onDragStart={(e) => { setDragFromPalette(ft.id); e.dataTransfer.effectAllowed = "copy"; }}
                    onDragEnd={() => { setDragFromPalette(null); setDragOverIdx(null); }}
                    onDoubleClick={() => addField(ft.id)}
                    className={cn(
                      "flex flex-col items-center gap-1 p-2 rounded-md border border-border bg-bg-soft hover:border-accent/60 hover:bg-hover/40 cursor-grab active:cursor-grabbing",
                      dragFromPalette === ft.id && "dragging",
                    )}
                    title={`${ft.name} — ${ft.desc} (double-click to add)`}
                  >
                    <IC size={14} className="text-muted" />
                    <div className="text-[11px] font-medium leading-tight text-center">{ft.name}</div>
                  </div>
                );
              })}
            </div>
            <div className="p-2 border-t border-border text-[11px] text-muted">
              {t("designer.tip_dblclick")}
            </div>
          </div>
        )}

        {/* Fields list canvas */}
        <div className="flex-1 overflow-y-auto bg-bg min-w-[480px]">
          {isConsumer ? (
            <EntityFormPreview entity={entity} />
          ) : (
            <div className="max-w-[760px] mx-auto py-6 px-6">
              <div className="flex items-baseline justify-between mb-3">
                <div>
                  <div className="text-lg font-semibold">Schema fields</div>
                  <div className="text-xs text-muted">{t("designer.field_list_hint")}</div>
                </div>
                <div className="text-xs text-muted">{entity.fields.length} fields</div>
              </div>

              {entity.fields.length === 0 ? (
                <EmptyState
                  icon={<I.Database size={20} className="text-muted" />}
                  title={t("designer.no_field_title")}
                  hint={t("designer.no_field_hint")}
                />
              ) : (
                <div className="card divide-y divide-border overflow-hidden">
                  {entity.fields.map((f, idx) => (
                    <Fragment key={f.id}>
                      <div
                        onDragOver={(e) => { if (dragFromPalette) { e.preventDefault(); setDragOverIdx(idx); } }}
                        onDragLeave={() => setDragOverIdx((v) => v === idx ? null : v)}
                        onDrop={(e) => {
                          e.preventDefault();
                          if (dragFromPalette) {
                            addField(dragFromPalette, idx);
                            setDragFromPalette(null);
                            setDragOverIdx(null);
                          }
                        }}
                        className={cn(
                          "h-2 -my-1 transition-all",
                          dragOverIdx === idx && dragFromPalette && "drop-zone-active h-6 my-0",
                        )}
                      />
                      <FieldRow
                        field={f}
                        active={selected === f.id}
                        onSelect={() => setSelected(f.id)}
                        onDelete={() => deleteField(f.id)}
                        onDuplicate={() => addField(f.type, idx + 1)}
                        idx={idx}
                        onReorder={reorder}
                      />
                    </Fragment>
                  ))}
                  <div
                    onDragOver={(e) => { if (dragFromPalette) { e.preventDefault(); setDragOverIdx(entity.fields.length); } }}
                    onDragLeave={() => setDragOverIdx(null)}
                    onDrop={(e) => {
                      e.preventDefault();
                      if (dragFromPalette) {
                        addField(dragFromPalette);
                        setDragFromPalette(null);
                        setDragOverIdx(null);
                      }
                    }}
                    className={cn(
                      "h-8 flex items-center justify-center text-xs text-muted transition-colors",
                      dragOverIdx === entity.fields.length && dragFromPalette && "drop-zone-active",
                    )}
                  >
                    {dragFromPalette ? t("designer.drop_here") : t("designer.drop_between")}
                  </div>
                </div>
              )}

              {/* MCP bindings */}
              <div className="mt-8">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-lg font-semibold">MCP bindings</h3>
                  <span className="text-[11px] text-muted font-mono">prefix: {entity.mcp}</span>
                </div>
                <p className="text-xs text-muted mb-3">
                  Map 5 op sang tool MCP. Mỗi tool nhận args theo 3 nguồn: literal, field của entity, hoặc formula.
                </p>
                <McpBindingsEditor
                  value={entity.mcpBindings ?? {}}
                  onChange={(b: McpBindings) => setEntity((e) => ({ ...e, mcpBindings: b }))}
                  fieldKeys={entity.fields.map((f) => f.name)}
                  toolPrefix={entity.mcp}
                />
              </div>

              {/* Procedure bindings (advanced) — override per-op sang native
                  procedure (xem /procedures). Khi set, server records.*
                  dispatch sang procedure-runner thay vì native CRUD. */}
              <div className="mt-8">
                <h3 className="text-lg font-semibold mb-2">Procedure bindings (advanced)</h3>
                <p className="text-xs text-muted mb-3">
                  Override mỗi op bằng tên native procedure ở <code>/procedures</code>.
                  Để trống = dùng path mặc định (native record hoặc MCP).
                </p>
                <div className="grid grid-cols-1 gap-2">
                  {(["list", "get", "create", "update", "delete"] as const).map((op) => (
                    <div key={op} className="grid grid-cols-[80px_1fr] gap-2 items-center">
                      <div className="text-xs uppercase font-mono text-muted">{op}</div>
                      <Input
                        placeholder={`procedure_name (chừa trống = bỏ qua)`}
                        value={entity.procBindings?.[op] ?? ""}
                        onChange={(e) => setEntity((cur) => ({
                          ...cur,
                          procBindings: {
                            ...(cur.procBindings ?? {}),
                            [op]: e.target.value,
                          },
                        }))}
                      />
                    </div>
                  ))}
                </div>
              </div>

              {/* Đồng bộ tự động theo lịch (server-side) — chỉ hiện
                  khi op 'list' đã được bind tool MCP. */}
              {entity.mcpBindings?.list?.tool && (
                <div className="mt-8">
                  <EntitySyncPanel entityId={entity.id} />
                </div>
              )}
            </div>
          )}
        </div>

        {/* Inspector */}
        {!isConsumer && inspectorVisible && (
          <FieldInspector
            field={selectedField}
            onUpdate={(p) => selectedField && updateField(selectedField.id, p)}
            onDelete={() => selectedField && deleteField(selectedField.id)}
            tab={insTab}
            setTab={setInsTab}
            siblingFields={entity.fields.filter((f) => f.id !== selectedField?.id)}
          />
        )}
      </div>
      <McpImportModal open={importOpen} onClose={() => setImportOpen(false)} onApply={handleMcpImport} />
      <AiAssistDrawer
        open={aiOpen}
        onClose={() => setAiOpen(false)}
        objectType="entity"
        current={entity.fields.length > 0 ? {
          name: entity.name,
          mcp: entity.mcp,
          fields: entity.fields.map((f) => ({
            name: f.name, label: f.label, type: f.type,
            required: f.required, options: f.options, ref: f.ref, formula: f.formula,
          })),
        } : undefined}
        context={{
          mcpTools: mcpTools.map((t) => ({ name: t.name, description: t.description })),
          otherEntities: userEntities.filter((e) => e.id !== entity.id).map((e) => ({
            id: e.id, name: e.name, mcp: e.mcp,
            fieldKeys: e.fields.map((f) => f.name),
          })),
        }}
        onApply={handleAiApply}
      />
      {importToast && (
        <div className="fixed bottom-6 right-6 z-50 px-4 py-2.5 rounded-md bg-success/15 border border-success/40 text-success text-sm font-medium shadow-lg animate-in fade-in slide-in-from-bottom-2">
          {importToast}
        </div>
      )}
    </div>
  );
}

// ===== FieldRow =====
interface FieldRowProps {
  field: EntityField;
  active: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
  idx: number;
  onReorder: (from: number, to: number) => void;
}
function FieldRow({ field, active, onSelect, onDelete, onDuplicate, idx, onReorder }: FieldRowProps) {
  const ft = getFieldTypes().find((f) => f.id === field.type) ?? getFieldTypes()[0]!;
  const IC = I[ft.icon] ?? I.Type;
  const [dragging, setDragging] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  return (
    <div
      onClick={onSelect}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("text/field-idx", String(idx));
        e.dataTransfer.effectAllowed = "move";
        setDragging(true);
      }}
      onDragEnd={() => setDragging(false)}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("text/field-idx")) {
          e.preventDefault(); setDragOver(true);
        }
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        const from = e.dataTransfer.getData("text/field-idx");
        if (from !== "") onReorder(parseInt(from, 10), idx);
        setDragOver(false);
      }}
      className={cn(
        "flex items-center gap-3 px-3 h-12 cursor-pointer group transition-colors",
        active ? "bg-accent/10" : "hover:bg-hover/30",
        dragging && "dragging",
        dragOver && "drop-zone-active",
      )}
    >
      <I.Grip size={14} className="text-muted opacity-0 group-hover:opacity-100 cursor-grab shrink-0" />
      <div className="w-7 h-7 rounded-md bg-panel-2 border border-border flex items-center justify-center text-muted shrink-0">
        <IC size={13} />
      </div>
      <div className="flex-1 flex items-center gap-2 min-w-0">
        <div className="font-medium truncate">{field.label}</div>
        <span className="font-mono text-[11px] text-muted truncate">{field.name}</span>
      </div>
      <Chip>{ft.name}</Chip>
      {field.required && <Chip variant="warning">Required</Chip>}
      {field.type === "lookup" && field.ref && <Chip variant="accent">→ {field.ref}</Chip>}
      <div className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5">
        <button onClick={(e) => { e.stopPropagation(); onDuplicate(); }}
          className="w-6 h-6 rounded hover:bg-hover/60 flex items-center justify-center text-muted" title="Duplicate">
          <I.Copy size={12} />
        </button>
        <button onClick={(e) => { e.stopPropagation(); onDelete(); }}
          className="w-6 h-6 rounded hover:bg-danger/15 flex items-center justify-center text-muted hover:text-danger" title="Delete">
          <I.Trash size={12} />
        </button>
      </div>
    </div>
  );
}

// Sinh sample row cho live-preview formula
function sampleValueFor(type: string): unknown {
  switch (type) {
    case "number": case "integer": case "currency": return 100;
    case "boolean": case "bool": return true;
    case "date": return new Date().toISOString().slice(0, 10);
    case "datetime": return new Date().toISOString();
    case "json": return { sample: true };
    default: return "demo";
  }
}

// ===== FieldInspector =====
interface FieldInspectorProps {
  field: EntityField | undefined;
  onUpdate: (patch: Partial<EntityField>) => void;
  onDelete: () => void;
  tab: "data" | "style" | "events";
  setTab: (t: "data" | "style" | "events") => void;
  /** Field khác trong entity, dùng cho formula picker */
  siblingFields?: EntityField[];
}
function FieldInspector({ field, onUpdate, onDelete, tab, setTab, siblingFields = [] }: FieldInspectorProps) {
  const t = useT();
  const userEntities = useUserObjects((s) => s.entities);
  if (!field) {
    return (
      <aside className="w-[320px] shrink-0 border-l border-border bg-panel flex flex-col">
        <div className="h-11 shrink-0 px-3 flex items-center border-b border-border text-sm font-semibold">Inspector</div>
        <div className="flex-1 flex items-center justify-center text-center px-6 text-sm text-muted">
          {t("designer.select_field")}
        </div>
      </aside>
    );
  }
  const ft = getFieldTypes().find((f) => f.id === field.type) ?? getFieldTypes()[0]!;
  const IC = I[ft.icon] ?? I.Type;

  return (
    <aside className="w-[320px] shrink-0 border-l border-border bg-panel flex flex-col">
      <div className="h-11 shrink-0 px-3 flex items-center justify-between border-b border-border">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-6 h-6 rounded bg-panel-2 border border-border flex items-center justify-center text-muted">
            <IC size={12} />
          </div>
          <div className="text-sm font-semibold truncate">{field.label}</div>
        </div>
        <button onClick={onDelete}
          className="w-7 h-7 rounded hover:bg-danger/15 text-muted hover:text-danger flex items-center justify-center" title="Delete field">
          <I.Trash size={13} />
        </button>
      </div>
      <Tabs
        value={tab} onChange={setTab}
        options={[
          { value: "data", label: "Data" },
          { value: "style", label: "Style" },
          { value: "events", label: "Events" },
        ]}
      />
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {tab === "data" && (
          <>
            <FormField label={t("field.label")}>
              <Input value={field.label} onChange={(e) => onUpdate({ label: e.target.value })} />
            </FormField>
            <FormField label={t("field.name")} hint={t("field.name_hint")}>
              <Input className="font-mono" value={field.name} onChange={(e) => onUpdate({ name: e.target.value })} />
            </FormField>
            <FormField label={t("field.type")}>
              <Select value={field.type} onChange={(e) => onUpdate({ type: e.target.value })}>
                {getFieldTypes().map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </Select>
            </FormField>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex items-center justify-between p-2.5 rounded-md border border-border bg-bg-soft">
                <span className="text-sm">Required</span>
                <Switch checked={!!field.required} onChange={(v) => onUpdate({ required: v })} />
              </div>
              <div className="flex items-center justify-between p-2.5 rounded-md border border-border bg-bg-soft">
                <span className="text-sm">Unique</span>
                <Switch checked={false} onChange={() => {}} />
              </div>
            </div>

            {field.type === "select" && (
              <FormField label={t("field.options")} hint={t("field.options_hint")}>
                <Textarea className="font-mono" rows={4}
                  value={(field.options ?? []).join("\n")}
                  onChange={(e) => onUpdate({ options: e.target.value.split("\n").filter(Boolean) })} />
              </FormField>
            )}

            {(field.type === "enum" || field.type === "multi-enum") && (
              <FormField label="Enum" hint="Chọn enum tái sử dụng từ /enums. Nhãn vi/en lấy theo locale.">
                <EnumPicker
                  value={field.enumId}
                  onChange={(id) => onUpdate({ enumId: id })}
                />
              </FormField>
            )}

            {(field.type === "lookup" || field.type === "multi-lookup") && (
              <>
                <FormField label="Reference entity">
                  <Select value={field.ref ?? ""} onChange={(e) => onUpdate({ ref: e.target.value })}>
                    <option value="">{t("field.choose_entity")}</option>
                    {userEntities.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
                  </Select>
                </FormField>
                <FormField label="Khi record đích bị xoá"
                  hint="restrict: chặn xoá (mặc định) · setnull: xoá ref · cascade: soft-delete chuỗi">
                  <Select
                    value={(field as { onDelete?: string }).onDelete ?? "restrict"}
                    onChange={(e) => onUpdate({ onDelete: e.target.value } as Partial<EntityField>)}
                  >
                    <option value="restrict">Restrict (chặn)</option>
                    <option value="setnull">Set null</option>
                    <option value="cascade">Cascade (xoá chuỗi)</option>
                  </Select>
                </FormField>
              </>
            )}

            {field.type === "sequence" && (
              <>
                <FormField label="Prefix" hint='vd "INV-" → INV-0001'>
                  <Input
                    value={field.sequencePrefix ?? ""}
                    placeholder="INV-"
                    onChange={(e) => onUpdate({ sequencePrefix: e.target.value } as Partial<EntityField>)}
                  />
                </FormField>
                <FormField label="Padding" hint="Số chữ số tối thiểu, vd 4 → 0001">
                  <Input type="number" min={0} max={12}
                    value={field.sequencePadding ?? 0}
                    onChange={(e) => onUpdate({ sequencePadding: Number(e.target.value) } as Partial<EntityField>)}
                  />
                </FormField>
              </>
            )}

            {/* Governance controls — áp dụng cho mọi field type. */}
            <FormField label="Governance">
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={!!field.unique}
                    onChange={(e) => onUpdate({ unique: e.target.checked } as Partial<EntityField>)} />
                  Unique (chặn trùng giá trị)
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={!!field.searchable}
                    onChange={(e) => onUpdate({ searchable: e.target.checked } as Partial<EntityField>)} />
                  Searchable (full-text search)
                </label>
              </div>
            </FormField>
            <FormField label="Đọc bởi (Read RBAC)"
              hint="Bỏ chọn hết = mọi role có quyền entity đều đọc">
              <div className="flex gap-3 text-sm">
                {(["admin", "editor", "viewer"] as const).map((r) => {
                  const cur = (field.readableBy ?? []);
                  const on = cur.includes(r);
                  return (
                    <label key={r} className="flex items-center gap-1">
                      <input type="checkbox" checked={on}
                        onChange={(e) => onUpdate({
                          readableBy: e.target.checked
                            ? [...cur, r]
                            : cur.filter((x) => x !== r),
                        } as Partial<EntityField>)} />
                      {r}
                    </label>
                  );
                })}
              </div>
            </FormField>
            <FormField label="Ghi bởi (Write RBAC)" hint="Tương tự, bỏ chọn = mở">
              <div className="flex gap-3 text-sm">
                {(["admin", "editor", "viewer"] as const).map((r) => {
                  const cur = (field.writableBy ?? []);
                  const on = cur.includes(r);
                  return (
                    <label key={r} className="flex items-center gap-1">
                      <input type="checkbox" checked={on}
                        onChange={(e) => onUpdate({
                          writableBy: e.target.checked
                            ? [...cur, r]
                            : cur.filter((x) => x !== r),
                        } as Partial<EntityField>)} />
                      {r}
                    </label>
                  );
                })}
              </div>
            </FormField>

            {field.type === "formula" && (
              <FormulaEditor
                value={field.formula ?? ""}
                onChange={(next) => onUpdate({ formula: next })}
                availableFields={siblingFields.map((f) => ({ key: f.name, label: f.label, type: f.type }))}
                sampleRow={Object.fromEntries(siblingFields.map((f) => [f.name, sampleValueFor(f.type)]))}
              />
            )}

            <FormField label={t("field.desc")}>
              <Textarea rows={2} placeholder={t("field.desc_placeholder")} />
            </FormField>
          </>
        )}

        {tab === "style" && (
          <>
            <FormField label="Width">
              <div className="grid grid-cols-3 gap-1">
                {["1/3", "1/2", "Full"].map((w) => (
                  <button key={w}
                    className={cn("btn btn-sm", w === "Full" ? "btn-primary" : "btn-default")}>{w}</button>
                ))}
              </div>
            </FormField>
            <FormField label="Placeholder">
              <Input />
            </FormField>
            <FormField label={t("field.help_pos")}>
              <Select defaultValue="below">
                <option value="below">{t("field.help_below")}</option>
                <option value="tooltip">Trong tooltip</option>
              </Select>
            </FormField>
          </>
        )}

        {tab === "events" && (
          <>
            <FormField label="onChange">
              <Textarea className="font-mono" rows={4}
                defaultValue={"// vd: chạy workflow validate\nrun('validate_field', { value })"} />
            </FormField>
            <FormField label="onSubmit hook">
              <Select><option>— none —</option><option>w_approve_big_order</option></Select>
            </FormField>
          </>
        )}
      </div>
    </aside>
  );
}

// ===== EntityFormPreview =====
function EntityFormPreview({ entity }: { entity: MockEntity }) {
  const t = useT();
  const userEntities = useUserObjects((s) => s.entities);
  return (
    <div className="max-w-[640px] mx-auto py-8 px-6">
      <div className="text-xs text-muted uppercase tracking-wider mb-2">Preview · AutoForm</div>
      <h2 className="text-xl font-semibold mb-1">{t("entity.create", { name: entity.name })}</h2>
      <p className="text-sm text-muted mb-5">{t("entity.preview_subtitle")}</p>
      <div className="card p-5 space-y-4">
        {entity.fields.length === 0 && (
          <div className="text-muted text-center py-6 text-sm">{t("entity.schema_empty")}</div>
        )}
        {entity.fields.map((f) => (
          <FormField key={f.id} label={f.label + (f.required ? " *" : "")}>
            {f.type === "longtext" ? <Textarea rows={3} /> :
             f.type === "bool" ? <Switch checked={false} onChange={() => {}} label={t("field.yes_no")} /> :
             f.type === "select" ? (
               <Select>{(f.options ?? ["—"]).map((o) => <option key={o}>{o}</option>)}</Select>
             ) :
             f.type === "lookup" ? (
               <div className="flex items-center gap-2">
                 <Select><option>— chọn {userEntities.find((e) => e.id === f.ref)?.name ?? "tham chiếu"} —</option></Select>
                 <Button variant="default" size="sm" icon={<I.Search size={12} />} />
               </div>
             ) :
             f.type === "date" || f.type === "datetime" ? (
               <Input type={f.type === "datetime" ? "datetime-local" : "date"} />
             ) :
             f.type === "currency" ? (
               <div className="relative">
                 <Input type="number" placeholder="0" className="pr-12" />
                 <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted">VND</span>
               </div>
             ) :
             <Input placeholder={f.label} />}
          </FormField>
        ))}
        <div className="flex justify-end gap-2 pt-2 border-t border-border">
          <Button variant="default">{t("common.cancel")}</Button>
          <Button variant="primary" icon={<I.Save size={13} />}>{t("common.save")}</Button>
        </div>
      </div>
    </div>
  );
}
