import { useState, useEffect } from "react";
import { Button, Chip, FormField, Select, Input, EmptyState } from "@/components/ui";
import { I } from "@/components/Icons";
import { ORDER_ROWS, formatVND, type IconName } from "@/lib/mock-data";
import { DataGrid } from "@/components/renderer/DataGrid";
import { Chart } from "@/components/renderer/Chart";
import { AiAssistDrawer } from "@/components/designer/AiAssistDrawer";
import { useMcpClient } from "@/hooks/useMcpClient";
import { useUserObjects } from "@/stores/userObjects";
import type { PageDesign } from "@/lib/ai-design-prompts";
import { useUI } from "@/stores/ui";
import { cn } from "@/lib/utils";
import { useT } from "@/hooks/useT";

type ComponentKind = "list" | "form" | "chart" | "kpi" | "kanban" | "html";

interface PageComponent {
  id: string;
  kind: ComponentKind;
  x: number; y: number; w: number; h: number;  // grid units
  config: Record<string, unknown>;
}

const PALETTE: Array<{ kind: ComponentKind; label: string; icon: IconName; defaultSize: { w: number; h: number } }> = [
  { kind: "list",   label: "List / Table",  icon: "Table",     defaultSize: { w: 12, h: 4 } },
  { kind: "form",   label: "Form",          icon: "Edit",      defaultSize: { w: 6,  h: 5 } },
  { kind: "chart",  label: "Chart",         icon: "BarChart",  defaultSize: { w: 6,  h: 3 } },
  { kind: "kpi",    label: "KPI",           icon: "TrendUp",   defaultSize: { w: 3,  h: 2 } },
  { kind: "kanban", label: "Kanban",        icon: "Kanban",    defaultSize: { w: 12, h: 4 } },
  { kind: "html",   label: "HTML / Note",   icon: "Type",      defaultSize: { w: 6,  h: 2 } },
];

const SAMPLE_CHART = [
  { month: "T1", doanh_thu: 1200, don_hang: 45 },
  { month: "T2", doanh_thu: 1800, don_hang: 62 },
  { month: "T3", doanh_thu: 2200, don_hang: 78 },
  { month: "T4", doanh_thu: 1900, don_hang: 70 },
  { month: "T5", doanh_thu: 2800, don_hang: 95 },
];

interface Props { pageId: string }

export function PageDesigner({ pageId }: Props) {
  const t = useT();
  const mode = useUI((s) => s.mode);
  const inspectorVisible = useUI((s) => s.inspectorVisible);
  const isConsumer = mode === "consumer";

  const [components, setComponents] = useState<PageComponent[]>([
    { id: "c1", kind: "kpi",   x: 0,  y: 0, w: 3, h: 2, config: { label: "Doanh thu hôm nay", value: "84.5M ₫", trend: "+12%" } },
    { id: "c2", kind: "kpi",   x: 3,  y: 0, w: 3, h: 2, config: { label: "Đơn hàng",            value: "142",   trend: "+8" } },
    { id: "c3", kind: "kpi",   x: 6,  y: 0, w: 3, h: 2, config: { label: "Khách mới",          value: "23",    trend: "+15%" } },
    { id: "c4", kind: "kpi",   x: 9,  y: 0, w: 3, h: 2, config: { label: "Tồn kho thấp",       value: "3",     trend: "⚠" } },
    { id: "c5", kind: "chart", x: 0,  y: 2, w: 8, h: 3, config: { kind: "bar", title: "Doanh số 5 tháng" } },
    { id: "c6", kind: "list",  x: 8,  y: 2, w: 4, h: 3, config: { entity: "order" } },
  ]);
  const [selected, setSelected] = useState<string | null>(null);
  const [dragKind, setDragKind] = useState<ComponentKind | null>(null);
  const [aiOpen, setAiOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  const { tools: mcpTools } = useMcpClient();
  const setPageContent = useUserObjects((s) => s.setPageContent);
  const entities = useUserObjects((s) => s.entities);

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
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") { e.preventDefault(); save(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [components, pageId]);

  // AI apply — replace toàn bộ components từ đề xuất
  const handleAiApply = (design: PageDesign) => {
    const comps: PageComponent[] = (design.components ?? []).map((c, i) => ({
      id: "ai_" + Date.now() + "_" + i,
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
    const id = "c_" + Math.random().toString(36).slice(2, 7);
    setComponents((cs) => [...cs, {
      id, kind, x: 0, y: atY,
      w: meta.defaultSize.w, h: meta.defaultSize.h,
      config: {},
    }]);
    setSelected(id);
  };
  const remove = (id: string) => {
    setComponents((cs) => cs.filter((c) => c.id !== id));
    if (selected === id) setSelected(null);
  };
  const update = (id: string, patch: Partial<PageComponent>) =>
    setComponents((cs) => cs.map((c) => c.id === id ? { ...c, ...patch } : c));

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
        <Button variant="default" size="sm" icon={<I.Sparkles size={13} />} onClick={() => setAiOpen(true)}>
          AI Assist
        </Button>
        <Button variant="ghost" size="sm" icon={<I.Undo size={13} />}>Undo</Button>
        <Button variant="default" size="sm" icon={<I.Eye size={13} />}>Preview</Button>
        <Button variant="primary" size="sm" icon={<I.Save size={13} />} onClick={save}>
          {t("designer.save_with_shortcut")}
        </Button>
        {saved && (
          <span className="text-xs text-success flex items-center gap-1">
            <I.Check size={11} /> {t("designer.saved")}
          </span>
        )}
      </div>
      <AiAssistDrawer
        open={aiOpen}
        onClose={() => setAiOpen(false)}
        objectType="page"
        current={components.length > 0 ? {
          name: `Page ${pageId}`,
          components: components.map((c) => ({
            type: c.kind, title: String(c.config.title ?? c.config.label ?? c.kind),
            x: c.x, y: c.y, w: c.w, h: c.h,
            entityId: c.config.entity as string | undefined,
            chartKind: c.config.kind as string | undefined,
          })),
        } : undefined}
        context={{
          mcpTools: mcpTools.map((t) => ({ name: t.name, description: t.description })),
          otherEntities: entities.map((e) => ({
            id: e.id, name: e.name, mcp: e.mcp,
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
              <div className="text-[10px] uppercase tracking-wider text-muted font-semibold">Components</div>
              <div className="text-xs text-muted mt-0.5">{t("designer.drag_to_canvas")}</div>
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
              {PALETTE.map((p) => {
                const IC = I[p.icon];
                return (
                  <div
                    key={p.kind}
                    draggable
                    onDragStart={(e) => { setDragKind(p.kind); e.dataTransfer.effectAllowed = "copy"; }}
                    onDragEnd={() => setDragKind(null)}
                    onDoubleClick={() => addAt(p.kind, 99)}
                    className={cn(
                      "flex items-center gap-2 p-2 rounded-md border border-border bg-bg-soft hover:border-accent/60 cursor-grab active:cursor-grabbing text-xs",
                      dragKind === p.kind && "dragging",
                    )}
                  >
                    <IC size={14} className="text-muted shrink-0" />
                    <span className="font-medium">{p.label}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Canvas grid */}
        <div
          className={cn("flex-1 overflow-auto", !isConsumer && "canvas-dots")}
          onDragOver={(e) => { if (dragKind) e.preventDefault(); }}
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
              Inspector
            </div>
            {sel ? (
              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                <FormField label="Type">
                  <Chip variant="accent">{sel.kind}</Chip>
                </FormField>
                <div className="grid grid-cols-2 gap-2">
                  <FormField label="Width">
                    <Input type="number" min="1" max="12" value={sel.w}
                      onChange={(e) => update(sel.id, { w: Math.max(1, Math.min(12, parseInt(e.target.value) || 1)) })} />
                  </FormField>
                  <FormField label="Height">
                    <Input type="number" min="1" value={sel.h}
                      onChange={(e) => update(sel.id, { h: Math.max(1, parseInt(e.target.value) || 1) })} />
                  </FormField>
                </div>
                {sel.kind === "list" && (
                  <FormField label="Entity">
                    <Select
                      value={(sel.config.entity as string) ?? ""}
                      onChange={(e) => update(sel.id, { config: { ...sel.config, entity: e.target.value } })}
                    >
                      <option value="">{t("field.choose")}</option>
                      {entities.map((en) => <option key={en.id} value={en.id}>{en.name}</option>)}
                    </Select>
                  </FormField>
                )}
                {sel.kind === "chart" && (
                  <FormField label={t("field.chart_type")}>
                    <Select
                      value={(sel.config.kind as string) ?? "bar"}
                      onChange={(e) => update(sel.id, { config: { ...sel.config, kind: e.target.value } })}
                    >
                      <option value="bar">Bar</option>
                      <option value="line">Line</option>
                      <option value="area">Area</option>
                      <option value="pie">Pie</option>
                      <option value="doughnut">Doughnut</option>
                    </Select>
                  </FormField>
                )}
                <Button variant="danger" size="sm" icon={<I.Trash size={13} />} onClick={() => remove(sel.id)}
                  className="w-full justify-center">
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
      style={{ gridColumn: `span ${comp.w} / span ${comp.w}`, gridRow: `span ${comp.h} / span ${comp.h}` }}
    >
      {!isConsumer && (
        <div className="h-7 shrink-0 px-2 flex items-center justify-between border-b border-border bg-panel-2/50 text-[11px] text-muted">
          <span className="font-mono uppercase">{comp.kind}</span>
          <button onClick={(e) => { e.stopPropagation(); onRemove(); }}
            className="w-5 h-5 rounded hover:bg-danger/15 hover:text-danger flex items-center justify-center">
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


function ComponentBody({ comp }: { comp: PageComponent }) {
  const entities = useUserObjects((s) => s.entities);
  if (comp.kind === "kpi") {
    const { label, value, trend } = comp.config as { label?: string; value?: string; trend?: string };
    return (
      <div className="p-3 h-full flex flex-col justify-center">
        <div className="text-xs text-muted uppercase tracking-wider">{label ?? "KPI"}</div>
        <div className="text-2xl font-bold mt-1">{value ?? "—"}</div>
        {trend && <div className="text-xs text-success mt-0.5">{trend}</div>}
      </div>
    );
  }
  if (comp.kind === "chart") {
    const { kind = "bar", title } = comp.config as { kind?: string; title?: string };
    return (
      <div className="p-2 h-full flex flex-col">
        {title && <div className="text-xs font-medium mb-1 truncate">{title}</div>}
        <div className="flex-1 min-h-0">
          <Chart kind={kind as "bar" | "line" | "area" | "pie" | "doughnut"}
            data={SAMPLE_CHART} labelKey="month" valueKeys={["doanh_thu"]} />
        </div>
      </div>
    );
  }
  if (comp.kind === "list") {
    const { entity } = comp.config as { entity?: string };
    const ent = entities.find((e) => e.id === entity);
    return (
      <div className="h-full flex flex-col">
        <div className="text-xs px-2 py-1 border-b border-border text-muted">
          {ent?.name ?? "List"}
        </div>
        <div className="flex-1 min-h-0 overflow-auto">
          <DataGrid
            toolbar={false}
            data={ORDER_ROWS.slice(0, 6)}
            columns={[
              { accessorKey: "id", header: "Mã" },
              { accessorKey: "customer", header: "Khách" },
              { accessorKey: "total", header: "Tổng",
                cell: (c) => formatVND(Number(c.getValue() ?? 0)) },
              { accessorKey: "status", header: "TT" },
            ]}
          />
        </div>
      </div>
    );
  }
  if (comp.kind === "form") {
    return (
      <div className="p-3 text-xs text-muted">Form placeholder — bind tới entity ở Inspector.</div>
    );
  }
  if (comp.kind === "kanban") {
    return (
      <div className="p-3 text-xs text-muted">Kanban placeholder — group theo field "status".</div>
    );
  }
  if (comp.kind === "html") {
    const { html } = comp.config as { html?: string };
    return (
      <div className="p-3 text-xs" dangerouslySetInnerHTML={{ __html: html ?? "<i>HTML / Markdown note</i>" }} />
    );
  }
  return null;
}
