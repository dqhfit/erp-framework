import { useEffect, useRef, useState } from "react";
import { AiAssistDrawer } from "@/components/designer/AiAssistDrawer";
import { I } from "@/components/Icons";
import { Button, Chip, EmptyState, FormField, Input, Select } from "@/components/ui";
import { useMcpClient } from "@/hooks/useMcpClient";
import { useT } from "@/hooks/useT";
import type { PageDesign } from "@/lib/ai-design-prompts";
import type { IconName } from "@/lib/object-types";
import { cn } from "@/lib/utils";
import { useUI } from "@/stores/ui";
import { useUserObjects } from "@/stores/userObjects";

type ComponentKind = "list" | "form" | "chart" | "kpi" | "kanban" | "html";

interface PageComponent {
  id: string;
  kind: ComponentKind;
  x: number;
  y: number;
  w: number;
  h: number; // grid units
  config: Record<string, unknown>;
}

const PALETTE: Array<{
  kind: ComponentKind;
  label: string;
  icon: IconName;
  defaultSize: { w: number; h: number };
}> = [
  { kind: "list", label: "List / Table", icon: "Table", defaultSize: { w: 12, h: 4 } },
  { kind: "form", label: "Form", icon: "Edit", defaultSize: { w: 6, h: 5 } },
  { kind: "chart", label: "Chart", icon: "BarChart", defaultSize: { w: 6, h: 3 } },
  { kind: "kpi", label: "KPI", icon: "TrendUp", defaultSize: { w: 3, h: 2 } },
  { kind: "kanban", label: "Kanban", icon: "Kanban", defaultSize: { w: 12, h: 4 } },
  { kind: "html", label: "HTML / Note", icon: "Type", defaultSize: { w: 6, h: 2 } },
];

interface Props {
  pageId: string;
}

export function PageDesigner({ pageId }: Props) {
  const t = useT();
  const mode = useUI((s) => s.mode);
  const inspectorVisible = useUI((s) => s.inspectorVisible);
  const isConsumer = mode === "consumer";

  const [components, setComponents] = useState<PageComponent[]>([
    {
      id: "c1",
      kind: "kpi",
      x: 0,
      y: 0,
      w: 3,
      h: 2,
      config: { label: "Doanh thu hôm nay", value: "84.5M ₫", trend: "+12%" },
    },
    {
      id: "c2",
      kind: "kpi",
      x: 3,
      y: 0,
      w: 3,
      h: 2,
      config: { label: "Đơn hàng", value: "142", trend: "+8" },
    },
    {
      id: "c3",
      kind: "kpi",
      x: 6,
      y: 0,
      w: 3,
      h: 2,
      config: { label: "Khách mới", value: "23", trend: "+15%" },
    },
    {
      id: "c4",
      kind: "kpi",
      x: 9,
      y: 0,
      w: 3,
      h: 2,
      config: { label: "Tồn kho thấp", value: "3", trend: "⚠" },
    },
    {
      id: "c5",
      kind: "chart",
      x: 0,
      y: 2,
      w: 8,
      h: 3,
      config: { kind: "bar", title: "Doanh số 5 tháng" },
    },
    { id: "c6", kind: "list", x: 8, y: 2, w: 4, h: 3, config: { entity: "order" } },
  ]);
  const [selected, setSelected] = useState<string | null>(null);
  const [dragKind, setDragKind] = useState<ComponentKind | null>(null);
  const [aiOpen, setAiOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const publishRef = useRef<HTMLDivElement>(null);
  const { tools: mcpTools } = useMcpClient();
  const setPageContent = useUserObjects((s) => s.setPageContent);
  const publishPage = useUserObjects((s) => s.publishPage);
  const unpublishPage = useUserObjects((s) => s.unpublishPage);
  const setPageViewerGroups = useUserObjects((s) => s.setPageViewerGroups);
  const page = useUserObjects((s) => s.pages.find((p) => p.id === pageId));
  const vGroups = useUserObjects((s) => s.viewerGroupsList);
  const isPublished = page?.isPublished ?? false;
  const publishMode = page?.publishMode ?? "private";
  const entities = useUserObjects((s) => s.entities);

  // Click ngoài dropdown publish → đóng
  useEffect(() => {
    if (!publishOpen) return;
    const handler = (e: MouseEvent) => {
      if (publishRef.current && !publishRef.current.contains(e.target as Node)) {
        setPublishOpen(false);
      }
    };
    window.addEventListener("mousedown", handler);
    return () => window.removeEventListener("mousedown", handler);
  }, [publishOpen]);

  // Load nội dung đã lưu khi đổi page
  useEffect(() => {
    const stored = useUserObjects.getState().pageContent[pageId];
    if (Array.isArray(stored)) setComponents(stored as PageComponent[]);
    setSelected(null);
  }, [pageId]);

  const save = () => {
    setPageContent(pageId, components);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: closure ổn định mount-only
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        save();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // AI apply — replace toàn bộ components từ đề xuất
  const handleAiApply = (design: PageDesign) => {
    const comps: PageComponent[] = (design.components ?? []).map((c, i) => ({
      id: `ai_${Date.now()}_${i}`,
      kind: (c.type || "list").toLowerCase() as ComponentKind,
      x: Math.max(0, Math.min(11, c.x ?? 0)),
      y: Math.max(0, c.y ?? 0),
      w: Math.max(1, Math.min(12, c.w ?? 6)),
      h: Math.max(1, c.h ?? 3),
      config: {
        title: c.title,
        entity: c.entityId,
        kind: c.chartKind,
        metric: c.metric,
        field: c.field,
        groupBy: c.groupBy,
      },
    }));
    setComponents(comps);
    setAiOpen(false);
  };

  const sel = components.find((c) => c.id === selected);

  const addAt = (kind: ComponentKind, atY: number) => {
    const meta = PALETTE.find((p) => p.kind === kind);
    if (!meta) return;
    const id = `c_${Math.random().toString(36).slice(2, 7)}`;
    setComponents((cs) => [
      ...cs,
      {
        id,
        kind,
        x: 0,
        y: atY,
        w: meta.defaultSize.w,
        h: meta.defaultSize.h,
        config: {},
      },
    ]);
    setSelected(id);
  };
  const remove = (id: string) => {
    setComponents((cs) => cs.filter((c) => c.id !== id));
    if (selected === id) setSelected(null);
  };
  const update = (id: string, patch: Partial<PageComponent>) =>
    setComponents((cs) => cs.map((c) => (c.id === id ? { ...c, ...patch } : c)));

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="h-11 shrink-0 flex items-center px-3 gap-2 border-b border-border bg-panel">
        <div className="w-7 h-7 rounded-md bg-accent/15 text-accent flex items-center justify-center">
          <I.Layout size={14} />
        </div>
        <div className="flex flex-col leading-tight">
          <div className="font-semibold text-base">Page {pageId}</div>
          <div className="text-[11px] text-muted">{components.length} component(s)</div>
        </div>
        <div className="flex-1" />
        <Button
          variant="default"
          size="sm"
          icon={<I.Sparkles size={13} />}
          onClick={() => setAiOpen(true)}
        >
          AI Assist
        </Button>
        <Button variant="ghost" size="sm" icon={<I.Undo size={13} />}>
          {t("designer.undo")}
        </Button>
        <Button variant="default" size="sm" icon={<I.Eye size={13} />}>
          {t("designer.preview")}
        </Button>
        <Button variant="primary" size="sm" icon={<I.Save size={13} />} onClick={save}>
          {t("designer.save_with_shortcut")}
        </Button>
        {saved && (
          <span className="text-xs text-success flex items-center gap-1">
            <I.Check size={11} /> {t("designer.saved")}
          </span>
        )}
        {/* Publish dropdown */}
        <div ref={publishRef} className="relative">
          {isPublished ? (
            <div className="flex items-center gap-1">
              <Chip variant="success" className="text-[10px]! h-6! gap-1">
                <I.Globe size={10} />
                {publishMode === "public"
                  ? t("designer.published_public")
                  : t("designer.published_private")}
              </Chip>
              <button
                type="button"
                onClick={() => setPublishOpen((v) => !v)}
                className="h-6 px-1.5 rounded border border-border hover:bg-hover text-xs text-muted"
                title={t("designer.publish_options")}
              >
                <I.ChevronDown size={11} />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-0.5">
              <Button
                variant="default"
                size="sm"
                icon={<I.Globe size={13} />}
                onClick={() => publishPage(pageId, "private")}
              >
                {t("designer.publish")}
              </Button>
              <button
                type="button"
                onClick={() => setPublishOpen((v) => !v)}
                className="h-7 px-1 rounded border border-border hover:bg-hover text-muted"
                title={t("designer.publish_options")}
              >
                <I.ChevronDown size={11} />
              </button>
            </div>
          )}
          {publishOpen && (
            <div className="absolute right-0 top-full mt-1 z-20 bg-panel border border-border rounded shadow-lg py-1 w-52 text-sm">
              {isPublished ? (
                <>
                  <div className="px-3 py-1.5 text-[11px] text-muted uppercase tracking-wider">
                    {t("designer.change_mode")}
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      publishPage(pageId, "private");
                      setPublishOpen(false);
                    }}
                    className={cn(
                      "w-full text-left px-3 py-2 hover:bg-hover flex items-center gap-2",
                      publishMode === "private" && "text-accent",
                    )}
                  >
                    <I.Lock size={13} /> {t("designer.publish_private")}
                    {publishMode === "private" && <I.Check size={11} className="ml-auto" />}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      publishPage(pageId, "public");
                      setPublishOpen(false);
                    }}
                    className={cn(
                      "w-full text-left px-3 py-2 hover:bg-hover flex items-center gap-2",
                      publishMode === "public" && "text-accent",
                    )}
                  >
                    <I.Globe size={13} /> {t("designer.publish_public")}
                    {publishMode === "public" && <I.Check size={11} className="ml-auto" />}
                  </button>
                  {publishMode === "public" && (
                    <div className="px-3 py-2 border-t border-border mt-1 space-y-1.5">
                      <div className="text-[11px] text-muted">{t("designer.public_url")}</div>
                      <div className="flex items-center gap-1 bg-panel rounded px-2 py-1 text-[11px] font-mono text-text/70 min-w-0">
                        <span className="truncate flex-1">
                          {window.location.origin}/view/{pageId}
                        </span>
                      </div>
                      <div className="flex gap-1">
                        <button
                          type="button"
                          onClick={() => {
                            void navigator.clipboard
                              .writeText(`${window.location.origin}/view/${pageId}`)
                              .then(() => {
                                setLinkCopied(true);
                                setTimeout(() => setLinkCopied(false), 2000);
                              });
                          }}
                          className="flex-1 inline-flex items-center justify-center gap-1.5 px-2 py-1.5 rounded text-[11px] bg-panel-2 hover:bg-hover border border-border transition-colors"
                        >
                          {linkCopied ? (
                            <>
                              <I.Check size={11} className="text-success" /> {t("designer.copied")}
                            </>
                          ) : (
                            <>
                              <I.Copy size={11} /> {t("designer.copy_link")}
                            </>
                          )}
                        </button>
                        <a
                          href={`/view/${pageId}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center justify-center gap-1.5 px-2 py-1.5 rounded text-[11px] bg-panel-2 hover:bg-hover border border-border transition-colors"
                          title={t("designer.open_in_tab")}
                        >
                          <I.ExternalLink size={11} />
                        </a>
                      </div>
                    </div>
                  )}
                  <div className="px-3 py-2 border-t border-border">
                    <div className="text-[11px] text-muted mb-1">
                      {t("designer.visible_to_groups")}
                    </div>
                    {vGroups.length === 0 ? (
                      <div className="text-[10px] text-muted/60">
                        {t("designer.no_groups_hint")}
                      </div>
                    ) : (
                      <>
                        {vGroups.map((g) => {
                          const checked = (page?.viewerGroupIds ?? []).includes(g.id);
                          return (
                            <label
                              key={g.id}
                              className="flex items-center gap-2 py-0.5 cursor-pointer"
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => {
                                  const current = page?.viewerGroupIds ?? [];
                                  const next = checked
                                    ? current.filter((id) => id !== g.id)
                                    : [...current, g.id];
                                  setPageViewerGroups(pageId, next);
                                }}
                                className="w-3 h-3"
                              />
                              <span className="text-[11px]" style={{ color: g.color }}>
                                {g.name}
                              </span>
                            </label>
                          );
                        })}
                        <div className="text-[10px] text-muted/60 mt-1">
                          {t("designer.no_groups_hint")}
                        </div>
                      </>
                    )}
                  </div>
                  <div className="border-t border-border mt-1 pt-1">
                    <button
                      type="button"
                      onClick={() => {
                        unpublishPage(pageId);
                        setPublishOpen(false);
                      }}
                      className="w-full text-left px-3 py-2 hover:bg-hover text-danger flex items-center gap-2"
                    >
                      <I.X size={13} /> {t("designer.unpublish")}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className="px-3 py-1.5 text-[11px] text-muted uppercase tracking-wider">
                    {t("designer.publish_as")}
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      publishPage(pageId, "private");
                      setPublishOpen(false);
                    }}
                    className="w-full text-left px-3 py-2 hover:bg-hover flex items-center gap-2"
                  >
                    <I.Lock size={13} />
                    <div>
                      <div>{t("designer.publish_private")}</div>
                      <div className="text-[11px] text-muted">
                        {t("designer.publish_private_desc")}
                      </div>
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      publishPage(pageId, "public");
                      setPublishOpen(false);
                    }}
                    className="w-full text-left px-3 py-2 hover:bg-hover flex items-center gap-2"
                  >
                    <I.Globe size={13} />
                    <div>
                      <div>{t("designer.publish_public")}</div>
                      <div className="text-[11px] text-muted">
                        {t("designer.publish_public_desc")}
                      </div>
                    </div>
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </div>
      <AiAssistDrawer
        open={aiOpen}
        onClose={() => setAiOpen(false)}
        objectType="page"
        current={
          components.length > 0
            ? {
                name: `Page ${pageId}`,
                components: components.map((c) => ({
                  type: c.kind,
                  title: String(c.config.title ?? c.config.label ?? c.kind),
                  x: c.x,
                  y: c.y,
                  w: c.w,
                  h: c.h,
                  entityId: c.config.entity as string | undefined,
                  chartKind: c.config.kind as string | undefined,
                })),
              }
            : undefined
        }
        context={{
          mcpTools: mcpTools.map((t) => ({ name: t.name, description: t.description })),
          otherEntities: entities.map((e) => ({
            id: e.id,
            name: e.name,
            mcp: e.mcp,
            fieldKeys: e.fields.map((f) => f.name),
          })),
        }}
        onApply={handleAiApply}
      />

      <div className="flex-1 flex overflow-hidden">
        {/* Palette */}
        {!isConsumer && (
          <div className="w-[180px] shrink-0 border-r border-border bg-panel flex flex-col">
            <div className="px-3 py-2.5 border-b border-border">
              <div className="text-[10px] uppercase tracking-wider text-muted font-semibold">
                {t("designer.components")}
              </div>
              <div className="text-xs text-muted mt-0.5">{t("designer.drag_to_canvas")}</div>
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
              {PALETTE.map((p) => {
                const IC = I[p.icon];
                return (
                  <div
                    key={p.kind}
                    draggable
                    onDragStart={(e) => {
                      setDragKind(p.kind);
                      e.dataTransfer.effectAllowed = "copy";
                    }}
                    onDragEnd={() => setDragKind(null)}
                    onDoubleClick={() => addAt(p.kind, 99)}
                    className={cn(
                      "flex items-center gap-2 p-2 rounded-md border border-border bg-bg-soft hover:border-accent/60 cursor-grab active:cursor-grabbing text-xs",
                      dragKind === p.kind && "dragging",
                    )}
                  >
                    <IC size={14} className="text-muted shrink-0" />
                    <span className="font-medium">{t(`page.comp.${p.kind}`)}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Canvas grid */}
        <div
          className={cn("flex-1 overflow-auto", !isConsumer && "canvas-dots")}
          onDragOver={(e) => {
            if (dragKind) e.preventDefault();
          }}
          onDrop={(e) => {
            e.preventDefault();
            if (dragKind) {
              const maxY = Math.max(0, ...components.map((c) => c.y + c.h));
              addAt(dragKind, maxY);
              setDragKind(null);
            }
          }}
        >
          <div className="max-w-[1200px] mx-auto p-4">
            {components.length === 0 ? (
              <EmptyState
                icon={<I.Layout size={20} className="text-muted" />}
                title={t("designer.page_empty_title")}
                hint={t("designer.page_empty_hint")}
              />
            ) : (
              <div className="grid grid-cols-12 gap-3 auto-rows-[80px]">
                {components.map((c) => (
                  <ComponentCard
                    key={c.id}
                    comp={c}
                    selected={selected === c.id && !isConsumer}
                    onSelect={() => setSelected(c.id)}
                    onRemove={() => remove(c.id)}
                    isConsumer={isConsumer}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Inspector */}
        {!isConsumer && inspectorVisible && (
          <aside className="w-[280px] shrink-0 border-l border-border bg-panel flex flex-col">
            <div className="h-11 shrink-0 px-3 flex items-center border-b border-border text-sm font-semibold">
              {t("designer.inspector")}
            </div>
            {sel ? (
              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                <FormField label={t("designer.comp_type")}>
                  <Chip variant="accent">{sel.kind}</Chip>
                </FormField>
                <div className="grid grid-cols-2 gap-2">
                  <FormField label={t("field.width")}>
                    <Input
                      type="number"
                      min="1"
                      max="12"
                      value={sel.w}
                      onChange={(e) =>
                        update(sel.id, {
                          w: Math.max(1, Math.min(12, Number.parseInt(e.target.value, 10) || 1)),
                        })
                      }
                    />
                  </FormField>
                  <FormField label={t("designer.comp_height")}>
                    <Input
                      type="number"
                      min="1"
                      value={sel.h}
                      onChange={(e) =>
                        update(sel.id, { h: Math.max(1, Number.parseInt(e.target.value, 10) || 1) })
                      }
                    />
                  </FormField>
                </div>

                {/* Entity selector — reset fields khi đổi entity */}
                {(sel.kind === "list" ||
                  sel.kind === "form" ||
                  sel.kind === "chart" ||
                  sel.kind === "kanban") &&
                  (() => {
                    const selEntity = entities.find(
                      (e) => e.id === (sel.config.entity as string | undefined),
                    );
                    const entityFields = selEntity?.fields ?? [];
                    const selectedFieldNames = (sel.config.fields as string[] | undefined) ?? [];

                    return (
                      <>
                        <FormField label="Entity">
                          <Select
                            value={(sel.config.entity as string) ?? ""}
                            onChange={(e) =>
                              update(sel.id, {
                                config: {
                                  ...sel.config,
                                  entity: e.target.value,
                                  fields: [],
                                  groupBy: "",
                                  valueField: "",
                                },
                              })
                            }
                          >
                            <option value="">{t("field.choose")}</option>
                            {entities.map((en) => (
                              <option key={en.id} value={en.id}>
                                {en.name}
                              </option>
                            ))}
                          </Select>
                        </FormField>

                        {/* Field checklist — chỉ hiện cho list / form khi đã bind entity */}
                        {(sel.kind === "list" || sel.kind === "form") &&
                          entityFields.length > 0 && (
                            <FormField label={t("designer.fields_to_show")}>
                              <div className="border border-border rounded-md overflow-hidden">
                                <div className="max-h-44 overflow-y-auto bg-bg-soft">
                                  {entityFields.map((f) => {
                                    const checked =
                                      selectedFieldNames.length === 0 ||
                                      selectedFieldNames.includes(f.name);
                                    return (
                                      <label
                                        key={f.name}
                                        className="flex items-center gap-2 px-2 py-1.5 text-xs cursor-pointer hover:bg-hover/40 border-b border-border/50 last:border-0"
                                      >
                                        <input
                                          type="checkbox"
                                          className="accent-accent shrink-0"
                                          checked={checked}
                                          onChange={(e) => {
                                            const base =
                                              selectedFieldNames.length === 0
                                                ? entityFields.map((x) => x.name)
                                                : [...selectedFieldNames];
                                            const next = e.target.checked
                                              ? base.includes(f.name)
                                                ? base
                                                : [...base, f.name]
                                              : base.filter((n) => n !== f.name);
                                            const value =
                                              next.length === entityFields.length ? [] : next;
                                            update(sel.id, {
                                              config: { ...sel.config, fields: value },
                                            });
                                          }}
                                        />
                                        <span className="flex-1 truncate">{f.label}</span>
                                        <code className="text-[10px] text-muted font-mono shrink-0">
                                          {f.name}
                                        </code>
                                      </label>
                                    );
                                  })}
                                </div>
                                <div className="px-2 py-1 border-t border-border flex items-center justify-between bg-panel">
                                  <span className="text-[10px] text-muted">
                                    {selectedFieldNames.length === 0
                                      ? t("designer.fields_count", { count: entityFields.length })
                                      : t("designer.fields_count", {
                                          count: selectedFieldNames.length,
                                        })}
                                  </span>
                                  {selectedFieldNames.length > 0 && (
                                    <button
                                      type="button"
                                      className="text-[10px] text-accent hover:underline"
                                      onClick={() =>
                                        update(sel.id, { config: { ...sel.config, fields: [] } })
                                      }
                                    >
                                      {t("designer.fields_select_all")}
                                    </button>
                                  )}
                                </div>
                              </div>
                            </FormField>
                          )}

                        {/* Chart config */}
                        {sel.kind === "chart" && (
                          <>
                            <FormField label={t("field.chart_type")}>
                              <Select
                                value={(sel.config.kind as string) ?? "bar"}
                                onChange={(e) =>
                                  update(sel.id, {
                                    config: { ...sel.config, kind: e.target.value },
                                  })
                                }
                              >
                                <option value="bar">Bar</option>
                                <option value="line">Line</option>
                                <option value="area">Area</option>
                                <option value="pie">Pie</option>
                                <option value="doughnut">Doughnut</option>
                              </Select>
                            </FormField>
                            <FormField label={t("designer.chart_group_field")}>
                              {entityFields.length > 0 ? (
                                <Select
                                  value={(sel.config.groupBy as string) ?? ""}
                                  onChange={(e) =>
                                    update(sel.id, {
                                      config: { ...sel.config, groupBy: e.target.value },
                                    })
                                  }
                                >
                                  <option value="">{t("field.choose")}</option>
                                  {entityFields.map((f) => (
                                    <option key={f.name} value={f.name}>
                                      {f.label}
                                    </option>
                                  ))}
                                </Select>
                              ) : (
                                <Input
                                  value={(sel.config.groupBy as string) ?? ""}
                                  placeholder="vd: status"
                                  onChange={(e) =>
                                    update(sel.id, {
                                      config: { ...sel.config, groupBy: e.target.value },
                                    })
                                  }
                                />
                              )}
                            </FormField>
                            <FormField label={t("designer.chart_value_field")}>
                              {entityFields.length > 0 ? (
                                <Select
                                  value={(sel.config.valueField as string) ?? ""}
                                  onChange={(e) =>
                                    update(sel.id, {
                                      config: { ...sel.config, valueField: e.target.value },
                                    })
                                  }
                                >
                                  <option value="">Đếm số bản ghi</option>
                                  {entityFields
                                    .filter((f) => ["number", "currency"].includes(f.type))
                                    .map((f) => (
                                      <option key={f.name} value={f.name}>
                                        {f.label}
                                      </option>
                                    ))}
                                </Select>
                              ) : (
                                <Input
                                  value={(sel.config.valueField as string) ?? ""}
                                  placeholder="vd: tong_tien"
                                  onChange={(e) =>
                                    update(sel.id, {
                                      config: { ...sel.config, valueField: e.target.value },
                                    })
                                  }
                                />
                              )}
                            </FormField>
                          </>
                        )}

                        {/* Kanban config */}
                        {sel.kind === "kanban" && (
                          <FormField label="Nhóm theo field">
                            {entityFields.length > 0 ? (
                              <Select
                                value={(sel.config.groupBy as string) ?? ""}
                                onChange={(e) =>
                                  update(sel.id, {
                                    config: { ...sel.config, groupBy: e.target.value },
                                  })
                                }
                              >
                                <option value="">{t("field.choose")}</option>
                                {entityFields.map((f) => (
                                  <option key={f.name} value={f.name}>
                                    {f.label}
                                  </option>
                                ))}
                              </Select>
                            ) : (
                              <Input
                                value={(sel.config.groupBy as string) ?? "status"}
                                placeholder="vd: status"
                                onChange={(e) =>
                                  update(sel.id, {
                                    config: { ...sel.config, groupBy: e.target.value },
                                  })
                                }
                              />
                            )}
                          </FormField>
                        )}
                      </>
                    );
                  })()}

                <Button
                  variant="danger"
                  size="sm"
                  icon={<I.Trash size={13} />}
                  onClick={() => remove(sel.id)}
                  className="w-full justify-center"
                >
                  {t("designer.delete_component")}
                </Button>
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-center text-center px-6 text-sm text-muted">
                {t("designer.select_component")}
              </div>
            )}
          </aside>
        )}
      </div>
    </div>
  );
}

// ===== ComponentCard — render từng component trên canvas =====
interface ComponentCardProps {
  comp: PageComponent;
  selected: boolean;
  onSelect: () => void;
  onRemove: () => void;
  isConsumer: boolean;
}
function ComponentCard({ comp, selected, onSelect, onRemove, isConsumer }: ComponentCardProps) {
  return (
    <div
      onClick={onSelect}
      className={cn(
        "card overflow-hidden flex flex-col",
        selected && "ring-2 ring-accent",
        !isConsumer && "cursor-pointer hover:border-accent/50",
      )}
      style={{
        gridColumn: `span ${comp.w} / span ${comp.w}`,
        gridRow: `span ${comp.h} / span ${comp.h}`,
      }}
    >
      {!isConsumer && (
        <div className="h-7 shrink-0 px-2 flex items-center justify-between border-b border-border bg-panel-2/50 text-[11px] text-muted">
          <span className="font-mono uppercase">{comp.kind}</span>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
            className="w-5 h-5 rounded-sm hover:bg-danger/15 hover:text-danger flex items-center justify-center"
          >
            <I.X size={11} />
          </button>
        </div>
      )}
      <div className="flex-1 overflow-hidden min-h-0">
        <ComponentBody comp={comp} />
      </div>
    </div>
  );
}

/* Ô xem trước trên canvas thiết kế — chỉ mô tả cấu trúc widget;
   dữ liệu thật render ở chế độ người dùng (ConsumerPage). */
function PreviewBox({ icon, label, hint }: { icon: IconName; label: string; hint: string }) {
  const IC = I[icon];
  return (
    <div className="p-3 h-full flex flex-col items-center justify-center text-center gap-1">
      <IC size={20} className="text-muted" />
      <div className="text-xs font-medium truncate max-w-full">{label}</div>
      <div className="text-[11px] text-muted">{hint}</div>
    </div>
  );
}

function ComponentBody({ comp }: { comp: PageComponent }) {
  const entities = useUserObjects((s) => s.entities);
  if (comp.kind === "kpi") {
    const { label, value, trend } = comp.config as {
      label?: string;
      value?: string;
      trend?: string;
    };
    return (
      <div className="p-3 h-full flex flex-col justify-center">
        <div className="text-xs text-muted uppercase tracking-wider">{label ?? "KPI"}</div>
        <div className="text-2xl font-bold mt-1">{value ?? "—"}</div>
        {trend && <div className="text-xs text-success mt-0.5">{trend}</div>}
      </div>
    );
  }
  if (comp.kind === "chart") {
    const {
      kind = "bar",
      title,
      entity,
      groupBy,
    } = comp.config as { kind?: string; title?: string; entity?: string; groupBy?: string };
    const ent = entities.find((e) => e.id === entity);
    return (
      <PreviewBox
        icon="BarChart"
        label={title || "Chart"}
        hint={
          ent ? `${ent.name} · ${kind}${groupBy ? ` · nhóm ${groupBy}` : ""}` : "Chưa bind entity"
        }
      />
    );
  }
  if (comp.kind === "list") {
    const { entity, fields } = comp.config as { entity?: string; fields?: string[] };
    const ent = entities.find((e) => e.id === entity);
    const colCount = fields?.length || Math.min(ent?.fields.length ?? 0, 6);
    return (
      <PreviewBox
        icon="Table"
        label={ent?.name ?? "List"}
        hint={ent ? `${colCount} cột · xem ở chế độ người dùng` : "Chưa bind entity"}
      />
    );
  }
  if (comp.kind === "form") {
    const { entity, fields } = comp.config as { entity?: string; fields?: string[] };
    const ent = entities.find((e) => e.id === entity);
    const fieldCount = fields?.length || ent?.fields.length || 0;
    return (
      <PreviewBox
        icon="Edit"
        label={ent ? `Form ${ent.name}` : "Form"}
        hint={ent ? `${fieldCount} trường · ghi record thật` : "Chưa bind entity"}
      />
    );
  }
  if (comp.kind === "kanban") {
    const { entity, groupBy } = comp.config as { entity?: string; groupBy?: string };
    const ent = entities.find((e) => e.id === entity);
    return (
      <PreviewBox
        icon="Kanban"
        label={ent?.name ?? "Kanban"}
        hint={ent ? `Nhóm theo "${groupBy || "status"}"` : "Chưa bind entity"}
      />
    );
  }
  if (comp.kind === "html") {
    const { html } = comp.config as { html?: string };
    return (
      <div
        className="p-3 text-xs"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: widget HTML do admin-designer nhập, in-app preview
        dangerouslySetInnerHTML={{ __html: html ?? "<i>HTML / Markdown note</i>" }}
      />
    );
  }
  return null;
}
