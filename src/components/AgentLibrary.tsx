/* ==========================================================
   AgentLibrary — Trang thu vien agent (full page, khong popup).
   - Kich hoat: tao agent moi tu template
   - Cap nhat: ap dung template moi nhat len agent da ton tai
   - Xem truoc: drawer hien thi system prompt + tools + config
   ========================================================== */
import { createObjectsClient } from "@erp-framework/client";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { I } from "@/components/Icons";
import { Button, Chip, Drawer } from "@/components/ui";
import { useT } from "@/hooks/useT";
import { dialog } from "@/lib/dialog";
import { useUserObjects } from "@/stores/userObjects";

const api = createObjectsClient("");

type Template = {
  id: string;
  department: string;
  departmentKey: string;
  icon: string;
  name: string;
  description: string;
  model: string;
  systemPrompt: string;
  tools: string[];
  temperature: number;
  tags: string[];
};

const DEPT_KEY_TO_I18N: Record<string, string> = {
  ke_toan: "agent_lib.dept_ke_toan",
  kinh_doanh: "agent_lib.dept_kinh_doanh",
  nhan_su: "agent_lib.dept_nhan_su",
  mua_hang: "agent_lib.dept_mua_hang",
  kho_van: "agent_lib.dept_kho_van",
  san_xuat: "agent_lib.dept_san_xuat",
  marketing: "agent_lib.dept_marketing",
  cham_soc_kh: "agent_lib.dept_cham_soc_kh",
  phap_che: "agent_lib.dept_phap_che",
};

const DEPT_ICON: Record<string, keyof typeof I> = {
  ke_toan: "Receipt",
  kinh_doanh: "BarChart2",
  nhan_su: "Users",
  mua_hang: "ShoppingCart",
  kho_van: "Warehouse",
  san_xuat: "Factory",
  marketing: "PenTool",
  cham_soc_kh: "MessageSquare",
  phap_che: "FileCheck",
} as const;

export function AgentLibraryPage() {
  const t = useT();
  const navigate = useNavigate();
  const userAgents = useUserObjects((s) => s.agents);
  const addAgent = useUserObjects((s) => s.addAgent);
  const [templates, setTemplates] = useState<Template[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [preview, setPreview] = useState<Template | null>(null);

  useEffect(() => {
    setLoading(true);
    api.agents
      .listTemplates()
      .then((list) => setTemplates(list as Template[]))
      .catch(() => setTemplates([]))
      .finally(() => setLoading(false));
  }, []);

  /* Map templateId → agents da kich hoat */
  const installedMap = new Map<string, { id: string; name: string }[]>();
  for (const a of userAgents) {
    if (a.templateId) {
      const list = installedMap.get(a.templateId) ?? [];
      list.push({ id: a.id, name: a.name });
      installedMap.set(a.templateId, list);
    }
  }

  const departments = Object.keys(DEPT_KEY_TO_I18N);

  const filtered = (templates ?? []).filter((tpl) => {
    const matchDept = activeTab === "all" || tpl.departmentKey === activeTab;
    const q = search.trim().toLowerCase();
    const matchSearch =
      !q ||
      tpl.name.toLowerCase().includes(q) ||
      tpl.description.toLowerCase().includes(q) ||
      tpl.departmentKey.includes(q);
    return matchDept && matchSearch;
  });

  const handleActivate = async (tpl: Template) => {
    setBusy(tpl.id);
    try {
      const row = await api.agents.instantiateTemplate(tpl.id);
      const agent = {
        id: (row as { id: string }).id,
        name: tpl.name,
        model: tpl.model,
        tools: tpl.tools.length,
        templateId: tpl.id,
      };
      addAgent(agent);
      navigate({ to: "/agents/$id", params: { id: agent.id } });
    } catch {
      /* no-op */
    } finally {
      setBusy(null);
    }
  };

  const handleUpdate = async (tpl: Template, agentId: string) => {
    const ok = await dialog.confirm(t("agent_lib.update_confirm"));
    if (!ok) return;
    setBusy(`${tpl.id}:${agentId}`);
    try {
      await api.agents.applyTemplate(agentId, tpl.id);
    } catch {
      /* no-op */
    } finally {
      setBusy(null);
    }
  };

  const iconFor = (name: string) => {
    const key = name as keyof typeof I;
    const Tag = I[key] ?? I.Bot;
    return <Tag size={18} />;
  };

  const deptLabel = (dk: string) => {
    const key = DEPT_KEY_TO_I18N[dk];
    return key ? t(key as Parameters<typeof t>[0]) : dk;
  };

  const modelLabel = (model: string) =>
    model.includes("haiku") ? "Haiku" : model.includes("opus") ? "Opus" : "Sonnet";

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="shrink-0 px-6 py-4 border-b border-border flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-accent/15 text-accent flex items-center justify-center">
          <I.Library size={16} />
        </div>
        <div>
          <h1 className="text-base font-semibold leading-tight">{t("agent_lib.title")}</h1>
          <p className="text-xs text-muted">{(templates ?? []).length} template</p>
        </div>
        <div className="flex-1" />
        {/* Search */}
        <div className="relative w-64">
          <I.Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
          <input
            type="search"
            placeholder={t("agent_lib.search_placeholder")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 text-sm bg-input border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </div>
      </div>

      {/* Department tabs */}
      <div className="shrink-0 px-6 py-2 border-b border-border flex gap-1 flex-wrap">
        <TabBtn active={activeTab === "all"} onClick={() => setActiveTab("all")}>
          {t("agent_lib.all")} ({(templates ?? []).length})
        </TabBtn>
        {departments.map((dk) => {
          const count = (templates ?? []).filter((tpl) => tpl.departmentKey === dk).length;
          if (count === 0) return null;
          const DIcon = I[DEPT_ICON[dk] ?? "Bot"];
          return (
            <TabBtn key={dk} active={activeTab === dk} onClick={() => setActiveTab(dk)}>
              <DIcon size={11} />
              {deptLabel(dk)} ({count})
            </TabBtn>
          );
        })}
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {loading && (
          <div className="flex items-center justify-center h-48 text-muted text-sm">
            <I.Loader size={18} className="animate-spin mr-2" />
            {t("agent_lib.loading")}
          </div>
        )}
        {!loading && filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center h-48 text-muted text-sm gap-2">
            <I.SearchX size={28} />
            {t("agent_lib.empty")}
          </div>
        )}
        {!loading && filtered.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {filtered.map((tpl) => {
              const installed = installedMap.get(tpl.id) ?? [];
              return (
                <TemplateCard
                  key={tpl.id}
                  tpl={tpl}
                  installed={installed}
                  busy={busy}
                  modelLabel={modelLabel(tpl.model)}
                  deptLabel={deptLabel(tpl.departmentKey)}
                  iconFor={iconFor}
                  onActivate={handleActivate}
                  onUpdate={handleUpdate}
                  onPreview={setPreview}
                  t={t}
                />
              );
            })}
          </div>
        )}
      </div>

      {/* Preview Drawer */}
      <PreviewDrawer
        tpl={preview}
        onClose={() => setPreview(null)}
        deptLabel={deptLabel}
        modelLabel={modelLabel}
        t={t}
      />
    </div>
  );
}

/* ─── Sub-components ─────────────────────────────────────── */

function TabBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
        active ? "bg-accent text-white" : "bg-muted/20 text-muted hover:bg-muted/30"
      }`}
    >
      {children}
    </button>
  );
}

function TemplateCard({
  tpl,
  installed,
  busy,
  modelLabel,
  deptLabel,
  iconFor,
  onActivate,
  onUpdate,
  onPreview,
  t,
}: {
  tpl: Template;
  installed: { id: string; name: string }[];
  busy: string | null;
  modelLabel: string;
  deptLabel: string;
  iconFor: (name: string) => React.ReactNode;
  onActivate: (tpl: Template) => void;
  onUpdate: (tpl: Template, agentId: string) => void;
  onPreview: (tpl: Template) => void;
  t: ReturnType<typeof useT>;
}) {
  const isActivating = busy === tpl.id;
  const isInstalled = installed.length > 0;

  return (
    <div className="flex flex-col gap-2 p-3 border border-border rounded-lg bg-panel hover:border-accent/30 transition-colors group">
      {/* Header */}
      <div className="flex items-start gap-2">
        <div className="w-8 h-8 rounded-md bg-accent/15 text-accent flex items-center justify-center shrink-0">
          {iconFor(tpl.icon)}
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-medium text-sm leading-tight">{tpl.name}</div>
          <Chip className="mt-0.5 opacity-70 text-[10px] py-0">{deptLabel}</Chip>
        </div>
        <button
          type="button"
          title={t("agent_lib.preview")}
          onClick={() => onPreview(tpl)}
          className="opacity-0 group-hover:opacity-100 transition-opacity w-6 h-6 flex items-center justify-center rounded text-muted hover:text-foreground hover:bg-hover shrink-0"
        >
          <I.Eye size={13} />
        </button>
      </div>

      <p className="text-xs text-muted leading-relaxed flex-1">{tpl.description}</p>

      {/* Installed agents */}
      {isInstalled && (
        <div className="flex flex-wrap gap-1">
          {installed.map((a) => (
            <span
              key={a.id}
              className="text-[10px] bg-green-500/10 text-green-600 dark:text-green-400 rounded px-1.5 py-0.5 flex items-center gap-1"
            >
              <I.CheckCircle size={10} />
              {a.name}
            </span>
          ))}
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center gap-1 flex-wrap">
        <span className="text-[10px] text-muted bg-muted/10 rounded px-1.5 py-0.5">
          {modelLabel}
        </span>
        <span className="text-[10px] text-muted bg-muted/10 rounded px-1.5 py-0.5">
          {tpl.tools.length} tools
        </span>
        <div className="flex-1" />

        {installed.map((a) => (
          <Button
            key={a.id}
            size="sm"
            variant="ghost"
            disabled={busy === `${tpl.id}:${a.id}`}
            onClick={() => onUpdate(tpl, a.id)}
            title={a.name}
            icon={
              busy === `${tpl.id}:${a.id}` ? (
                <I.Loader size={12} className="animate-spin" />
              ) : (
                <I.RefreshCw size={12} />
              )
            }
          >
            {busy === `${tpl.id}:${a.id}` ? t("agent_lib.updating") : t("agent_lib.update")}
          </Button>
        ))}

        <Button
          size="sm"
          variant="default"
          disabled={isActivating}
          onClick={() => onActivate(tpl)}
          icon={
            isActivating ? <I.Loader size={12} className="animate-spin" /> : <I.Zap size={12} />
          }
        >
          {isActivating ? t("agent_lib.activating") : t("agent_lib.activate")}
        </Button>
      </div>
    </div>
  );
}

function PreviewDrawer({
  tpl,
  onClose,
  deptLabel,
  modelLabel,
  t,
}: {
  tpl: Template | null;
  onClose: () => void;
  deptLabel: (dk: string) => string;
  modelLabel: (model: string) => string;
  t: ReturnType<typeof useT>;
}) {
  if (!tpl) return null;
  return (
    <Drawer
      open={!!tpl}
      onClose={onClose}
      title={`${t("agent_lib.preview_title")}: ${tpl.name}`}
      width={480}
    >
      <div className="flex flex-col gap-4 p-4 text-sm overflow-y-auto h-full pb-8">
        <div className="flex flex-wrap gap-2">
          <InfoBadge label={t("agent_lib.model")} value={modelLabel(tpl.model)} />
          <InfoBadge label={t("agent_lib.temperature")} value={String(tpl.temperature)} />
          <InfoBadge label="Phong ban" value={deptLabel(tpl.departmentKey)} />
        </div>

        <div>
          <div className="text-xs font-semibold text-muted uppercase tracking-wide mb-1.5">
            {t("agent_lib.tools")} ({tpl.tools.length})
          </div>
          <div className="flex flex-wrap gap-1">
            {tpl.tools.length === 0 ? (
              <span className="text-xs text-muted italic">—</span>
            ) : (
              tpl.tools.map((tool) => (
                <code
                  key={tool}
                  className="text-[11px] bg-muted/10 rounded px-1.5 py-0.5 font-mono"
                >
                  {tool}
                </code>
              ))
            )}
          </div>
        </div>

        {tpl.tags.length > 0 && (
          <div>
            <div className="text-xs font-semibold text-muted uppercase tracking-wide mb-1.5">
              {t("agent_lib.tags")}
            </div>
            <div className="flex flex-wrap gap-1">
              {tpl.tags.map((tag) => (
                <Chip key={tag} className="text-[10px] py-0">
                  {tag}
                </Chip>
              ))}
            </div>
          </div>
        )}

        <div className="flex-1">
          <div className="text-xs font-semibold text-muted uppercase tracking-wide mb-1.5">
            {t("agent_lib.system_prompt")}
          </div>
          <pre className="text-xs leading-relaxed whitespace-pre-wrap bg-muted/5 border border-border rounded-md p-3 font-sans overflow-y-auto max-h-[420px]">
            {tpl.systemPrompt}
          </pre>
        </div>
      </div>
    </Drawer>
  );
}

function InfoBadge({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-1 bg-muted/10 rounded px-2 py-1">
      <span className="text-[10px] text-muted">{label}:</span>
      <span className="text-xs font-medium">{value}</span>
    </div>
  );
}
