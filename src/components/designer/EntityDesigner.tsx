import { createApiDataSource, createMigrationClient } from "@erp-framework/client";
import { useNavigate } from "@tanstack/react-router";
import { Fragment, useEffect, useRef, useState } from "react";
import { useUndoable } from "@/hooks/useUndoable";
import { AiAssistDrawer } from "@/components/designer/AiAssistDrawer";
import { EntityFormPreview } from "@/components/designer/entity-preview";
import { FieldInspector } from "@/components/designer/field-inspector";
import { FieldRow } from "@/components/designer/field-row";
import { type McpBindings, McpBindingsEditor } from "@/components/designer/McpBindingsEditor";
import { McpImportModal, type McpImportResult } from "@/components/designer/McpImportModal";
import { EntitySyncPanel } from "@/components/EntitySyncPanel";
import { I } from "@/components/Icons";
import { EntityData } from "@/components/renderer/EntityData";
import { Button, EmptyState, InlineEdit, Input } from "@/components/ui";
import { useMcpClient } from "@/hooks/useMcpClient";
import { useT } from "@/hooks/useT";
import type { EntityDesign } from "@/lib/ai-design-prompts";
import { ftLabel, getFieldTypes } from "@/lib/field-types";
import { countBoundOps, inferMcpBindings } from "@/lib/mcp-binding-infer";
import { inferPkField, syncEntityFromMcp } from "@/lib/mcp-sync";
import type { EntityField, MockEntity } from "@/lib/object-types";
import { dialog } from "@/lib/dialog";
import { cn } from "@/lib/utils";
import { useUI } from "@/stores/ui";
import { useUserObjects } from "@/stores/userObjects";

interface Props {
  entityId: string;
}

const migrationApi = createMigrationClient("");

export function EntityDesigner({ entityId }: Props) {
  const t = useT();
  const navigate = useNavigate();
  const userEntities = useUserObjects((s) => s.entities);
  const addPage = useUserObjects((s) => s.addPage);
  const setPageContent = useUserObjects((s) => s.setPageContent);
  const hydrate = useUserObjects((s) => s.hydrate);
  const fallbackEntity: MockEntity = {
    id: entityId,
    name: "Entity",
    icon: "Database",
    mcp: "",
    fields: [],
  };
  const initial = userEntities.find((e) => e.id === entityId) ?? fallbackEntity;
  const inspectorVisible = useUI((s) => s.inspectorVisible);

  const [entity, setEntity, { canUndo, canRedo, undo, redo }] = useUndoable<MockEntity>(initial);
  const [selected, setSelected] = useState<string | null>(null);
  const [insTab, setInsTab] = useState<"data" | "style" | "events">("data");
  const [localView, setLocalView] = useState<"schema" | "form" | "data">("schema");
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);
  const [dragFromPalette, setDragFromPalette] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [pageMenuOpen, setPageMenuOpen] = useState(false);
  const pageMenuRef = useRef<HTMLDivElement>(null);
  const { tools: mcpTools } = useMcpClient();

  // biome-ignore lint/correctness/useExhaustiveDependencies: closure ổn định mount-only
  useEffect(() => {
    setEntity(userEntities.find((e) => e.id === entityId) ?? fallbackEntity);
    setSelected(null);
  }, [userEntities.find, entityId]);

  const addField = (type: string, atIdx?: number) => {
    const ft = getFieldTypes().find((f) => f.id === type);
    if (!ft) return;
    const id = `nf_${Math.random().toString(36).slice(2, 7)}`;
    const newField: EntityField = {
      id,
      name: `${type}_${entity.fields.length + 1}`,
      label: ft.name,
      type,
      required: false,
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
    setEntity((e) => ({
      ...e,
      fields: e.fields.map((f) => (f.id === id ? { ...f, ...patch } : f)),
    }));
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
      id: `imp_${Date.now()}_${i}`,
      name: f.key,
      label: f.label,
      type: f.type,
      required: f.required,
      ref: f.ref,
    }));

    // Suy luận primary key — ưu tiên field tên "id", "code", hoặc field required đầu tiên
    const pk =
      converted.find((f) => f.name === "id")?.name ??
      converted.find((f) => f.name === "code")?.name ??
      converted.find((f) => f.required)?.name ??
      converted[0]?.name ??
      "id";

    // Suy luận bindings từ tool đã dùng + sibling tools
    const inferredBindings = inferMcpBindings(tool, args, availableTools, pk);
    const opsBound = countBoundOps(inferredBindings);

    setEntity((e) => {
      // Replace: bindings hoàn toàn từ inference.
      // Append: merge — giữ binding cũ, chỉ thêm op nào chưa có
      const mergedBindings: McpBindings =
        mode === "replace" ? inferredBindings : { ...(e.mcpBindings ?? {}), ...inferredBindings };
      return {
        ...e,
        fields: mode === "replace" ? converted : [...e.fields, ...converted],
        mcpBindings: mergedBindings,
      };
    });
    if (dataMode === "snapshot" && rows.length > 0) {
      setPendingRows(rows);
      setImportToast(
        t("entity.import_snapshot_toast", {
          fieldsCount: converted.length,
          rows: rows.length,
        }),
      );
    } else {
      setImportToast(t("entity.import_toast", { fieldsCount: converted.length, opsBound }));
    }
  };

  // Áp dụng đề xuất từ AI Assistant — replace toàn bộ schema + bindings
  const handleAiApply = (design: EntityDesign) => {
    const fields: EntityField[] = design.fields.map((f, i) => ({
      id: `ai_${Date.now()}_${i}`,
      name: f.name,
      label: f.label,
      type: f.type,
      required: f.required,
      options: f.options,
      ref: f.ref,
      formula: f.formula,
    }));
    const pk =
      design.primaryKey ??
      fields.find((f) => f.name === "id")?.name ??
      fields.find((f) => f.name === "code")?.name ??
      fields.find((f) => f.required)?.name ??
      fields[0]?.name ??
      "id";
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

  useEffect(() => {
    if (!pageMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (pageMenuRef.current && !pageMenuRef.current.contains(e.target as Node))
        setPageMenuOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [pageMenuOpen]);

  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [generatingMd, setGeneratingMd] = useState(false);
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
            try {
              await ds.createRecord(entity.id, r);
              ok++;
            } catch {
              /* dòng không hợp lệ với schema — bỏ qua */
            }
          }
          setPendingRows([]);
          setImportToast(t("entity.records_imported", { count: ok }));
        } else {
          setImportToast(
            t("entity.save_toast", {
              name: entity.name,
              count: entity.fields.length,
            }),
          );
        }
        setSaving(false);
        setLastSaved(new Date());
      })();
    }, 700);
  };
  const saveRef = useRef(save);
  saveRef.current = save;
  const undoRef = useRef(undo);
  undoRef.current = undo;
  const redoRef = useRef(redo);
  redoRef.current = redo;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.key === "s") {
        e.preventDefault();
        saveRef.current();
      } else if (e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        undoRef.current();
      } else if ((e.key === "z" && e.shiftKey) || e.key === "y") {
        e.preventDefault();
        redoRef.current();
      }
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
      setImportToast(
        t("entity.sync_done", {
          created: res.created,
          updated: res.updated,
        }),
      );
    } catch (e) {
      setImportToast(`Lỗi đồng bộ: ${(e as Error).message}`);
    } finally {
      setSyncing(false);
    }
  };

  const handleAutoPage = () => {
    const pageId = crypto.randomUUID();
    addPage({
      id: pageId,
      name: entity.name,
      icon: entity.icon,
      updated: "vừa xong",
      author: "auto",
    });
    setPageContent(pageId, [
      {
        id: `${pageId}_list`,
        kind: "list",
        x: 0,
        y: 0,
        w: 12,
        h: 4,
        config: { entity: entity.id, title: entity.name },
      },
      {
        id: `${pageId}_form`,
        kind: "form",
        x: 0,
        y: 4,
        w: 6,
        h: 5,
        config: {
          entity: entity.id,
          title: t("entity.auto_page_form_title", { name: entity.name }),
        },
      },
    ]);
    void navigate({ to: "/pages/$id", params: { id: pageId } });
  };

  const handleMasterDetailPage = async () => {
    if (generatingMd) return;
    setGeneratingMd(true);
    try {
      const r = await migrationApi.generateMasterDetailPage({ entityId: entity.id });
      await hydrate();
      const childMsg =
        r.backwardChildren.length > 0
          ? `\n\nChild entity (${r.backwardChildren.length}):\n` +
            r.backwardChildren
              .map((c) => `• ${c.label ?? c.entityLabel} (qua ${c.fkField})`)
              .join("\n")
          : "\n\nKhông có child entity.";
      const open = await dialog.confirm(
        `${r.upserted === "created" ? "Đã tạo" : "Đã cập nhật"} trang "${r.pageLabel}".${childMsg}\n\nMở trang ngay?`,
        { title: t("entity.md_page_title"), confirmText: t("entity.md_page_open") },
      );
      if (open) void navigate({ to: "/pages/$id", params: { id: r.pageId } });
    } catch (e) {
      void dialog.alert((e as Error).message, { title: t("common.error") });
    } finally {
      setGeneratingMd(false);
    }
  };

  const IconC = I[entity.icon] ?? I.Database;

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
            <div className="text-[11px] text-muted font-mono">
              {entity.mcp} · {entity.fields.length} fields
            </div>
          </div>
        </div>
        <span className="text-muted text-xs">/</span>
        <span className="text-xs text-muted">{t("designer.entity_designer")}</span>
        <div className="flex-1" />
        <Button
          variant="default"
          size="sm"
          icon={<I.Sparkles size={13} />}
          onClick={() => setAiOpen(true)}
          title={t("designer.ai_assist_tip")}
        >
          AI Assist
        </Button>
        <Button
          variant="default"
          size="sm"
          icon={<I.Database size={13} />}
          onClick={() => setImportOpen(true)}
        >
          {t("designer.import_from_mcp")}
        </Button>
        {entity.mcpBindings?.list?.tool && (
          <Button
            variant="default"
            size="sm"
            icon={syncing ? <I.Loader size={13} className="animate-spin" /> : <I.Redo size={13} />}
            onClick={() => void doMcpSync()}
            disabled={syncing}
          >
            {syncing ? t("entity.syncing") : t("entity.sync_btn")}
          </Button>
        )}
        <div className="w-px h-5 bg-border mx-1" />
        <Button
          variant="ghost"
          size="sm"
          icon={<I.Undo size={13} />}
          onClick={undo}
          disabled={!canUndo}
          title="Ctrl+Z"
        >
          {t("designer.undo")}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          icon={<I.Redo size={13} />}
          onClick={redo}
          disabled={!canRedo}
          title="Ctrl+Shift+Z"
        />
        <div className="w-px h-5 bg-border mx-1" />
        <Button
          variant={localView === "form" ? "primary" : "ghost"}
          size="sm"
          icon={<I.Play size={13} />}
          onClick={() => setLocalView((v) => (v === "form" ? "schema" : "form"))}
        >
          {localView === "form" ? t("designer.exit_preview") : t("designer.form_btn")}
        </Button>
        <Button
          variant={localView === "data" ? "primary" : "default"}
          size="sm"
          icon={localView === "data" ? <I.EyeOff size={13} /> : <I.Eye size={13} />}
          onClick={() => setLocalView((v) => (v === "data" ? "schema" : "data"))}
        >
          {localView === "data" ? t("designer.exit_preview") : t("designer.preview")}
        </Button>
        <Button
          variant="primary"
          size="sm"
          onClick={save}
          icon={saving ? <I.Loader size={13} className="animate-spin" /> : <I.Save size={13} />}
        >
          {saving ? t("designer.saving") : t("designer.save_with_shortcut")}
        </Button>
        {lastSaved && !saving && (
          <span className="text-xs text-muted ml-2 flex items-center gap-1">
            <I.Check size={11} className="text-success" /> {t("designer.saved")}
          </span>
        )}
        <div className="w-px h-5 bg-border mx-1" />
        <div ref={pageMenuRef} className="relative flex">
          <Button
            variant="default"
            size="sm"
            icon={
              generatingMd ? (
                <I.Loader size={13} className="animate-spin" />
              ) : (
                <I.PanelLeft size={13} />
              )
            }
            onClick={() => void handleMasterDetailPage()}
            disabled={generatingMd}
            title={t("entity.md_page_hint")}
            className="rounded-r-none border-r-0"
          >
            {t("entity.create_page_btn")}
          </Button>
          <button
            type="button"
            onClick={() => setPageMenuOpen((v) => !v)}
            className="btn btn-default btn-sm rounded-l-none px-1.5"
            title={t("entity.create_page_menu_tip")}
            disabled={generatingMd}
          >
            <I.ChevronDown size={11} />
          </button>
          {pageMenuOpen && (
            <div className="absolute top-full right-0 mt-1 z-50 bg-panel border border-border rounded-md shadow-lg min-w-[210px] py-1">
              <button
                type="button"
                className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-hover text-left"
                onClick={() => {
                  setPageMenuOpen(false);
                  void handleMasterDetailPage();
                }}
              >
                <I.PanelLeft size={13} className="shrink-0 text-accent" />
                <div className="flex flex-col leading-tight">
                  <span>{t("entity.md_page_btn")}</span>
                  <span className="text-[11px] text-muted">{t("entity.md_page_hint_short")}</span>
                </div>
              </button>
              <button
                type="button"
                className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-hover text-left"
                onClick={() => {
                  setPageMenuOpen(false);
                  handleAutoPage();
                }}
              >
                <I.Layout size={13} className="shrink-0 text-muted" />
                <div className="flex flex-col leading-tight">
                  <span>{t("entity.auto_page_btn")}</span>
                  <span className="text-[11px] text-muted">{t("entity.auto_page_hint_short")}</span>
                </div>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 flex overflow-auto min-w-0">
        {/* Field palette */}
        {localView === "schema" && (
          <div className="w-[220px] shrink-0 border-r border-border bg-panel flex flex-col">
            <div className="px-3 py-2.5 border-b border-border">
              <div className="text-[10px] uppercase tracking-wider text-muted font-semibold">
                {t("designer.field_types")}
              </div>
              <div className="text-xs text-muted mt-0.5">{t("designer.drag_to_list")}</div>
            </div>
            <div className="flex-1 overflow-y-auto p-1.5 grid grid-cols-2 gap-1.5 content-start">
              {getFieldTypes().map((ft) => {
                const IC = I[ft.icon] ?? I.Type;
                return (
                  <div
                    key={ft.id}
                    draggable
                    onDragStart={(e) => {
                      setDragFromPalette(ft.id);
                      e.dataTransfer.effectAllowed = "copy";
                    }}
                    onDragEnd={() => {
                      setDragFromPalette(null);
                      setDragOverIdx(null);
                    }}
                    onDoubleClick={() => addField(ft.id)}
                    className={cn(
                      "flex flex-col items-center gap-1 p-2 rounded-md border border-border bg-bg-soft hover:border-accent/60 hover:bg-hover/40 cursor-grab active:cursor-grabbing",
                      dragFromPalette === ft.id && "dragging",
                    )}
                    title={`${ftLabel(ft, t)} — ${ft.desc} (double-click to add)`}
                  >
                    <IC size={14} className="text-muted" />
                    <div className="text-[11px] font-medium leading-tight text-center">
                      {ftLabel(ft, t)}
                    </div>
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
        <div className="flex-1 overflow-y-auto bg-bg min-w-[480px] relative">
          {localView === "form" && (
            <div className="absolute inset-0 z-10 bg-bg overflow-auto">
              <EntityFormPreview entity={entity} />
            </div>
          )}
          {localView === "data" && (
            <div className="absolute inset-0 z-10 bg-bg overflow-auto">
              <EntityData entityId={entity.id} />
            </div>
          )}
          {localView === "schema" && (
            <div className="max-w-[760px] mx-auto py-6 px-6">
              <div className="flex items-baseline justify-between mb-3">
                <div>
                  <div className="text-lg font-semibold">{t("designer.schema_fields")}</div>
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
                    <Fragment key={f.id ?? idx}>
                      <div
                        onDragOver={(e) => {
                          if (dragFromPalette) {
                            e.preventDefault();
                            setDragOverIdx(idx);
                          }
                        }}
                        onDragLeave={() => setDragOverIdx((v) => (v === idx ? null : v))}
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
                          !dragFromPalette && "pointer-events-none",
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
                    onDragOver={(e) => {
                      if (dragFromPalette) {
                        e.preventDefault();
                        setDragOverIdx(entity.fields.length);
                      }
                    }}
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
                      !dragFromPalette && "pointer-events-none",
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
                  <h3 className="text-lg font-semibold">{t("entity.mcp_bindings")}</h3>
                  <span className="text-[11px] text-muted font-mono">
                    {t("entity.mcp_prefix", { prefix: entity.mcp })}
                  </span>
                </div>
                <p className="text-xs text-muted mb-3">{t("entity.mcp_desc")}</p>
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
                <h3 className="text-lg font-semibold mb-2">{t("designer.proc_bindings")}</h3>
                <p className="text-xs text-muted mb-3">{t("designer.proc_bindings_desc")}</p>
                <div className="grid grid-cols-1 gap-2">
                  {(["list", "get", "create", "update", "delete"] as const).map((op) => (
                    <div key={op} className="grid grid-cols-[80px_1fr] gap-2 items-center">
                      <div className="text-xs uppercase font-mono text-muted">{op}</div>
                      <Input
                        placeholder={t("designer.proc_placeholder")}
                        value={entity.procBindings?.[op] ?? ""}
                        onChange={(e) =>
                          setEntity((cur) => ({
                            ...cur,
                            procBindings: {
                              ...(cur.procBindings ?? {}),
                              [op]: e.target.value,
                            },
                          }))
                        }
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
        {localView === "schema" && inspectorVisible && (
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
      <McpImportModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onApply={handleMcpImport}
      />
      <AiAssistDrawer
        open={aiOpen}
        onClose={() => setAiOpen(false)}
        objectType="entity"
        current={
          entity.fields.length > 0
            ? {
                name: entity.name,
                mcp: entity.mcp,
                fields: entity.fields.map((f) => ({
                  name: f.name,
                  label: f.label,
                  type: f.type,
                  required: f.required,
                  options: f.options,
                  ref: f.ref,
                  formula: f.formula,
                })),
              }
            : undefined
        }
        context={{
          mcpTools: mcpTools.map((t) => ({ name: t.name, description: t.description })),
          otherEntities: userEntities
            .filter((e) => e.id !== entity.id)
            .map((e) => ({
              id: e.id,
              name: e.name,
              mcp: e.mcp,
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
