/* ==========================================================
   settings.migration — UI migrate ứng dụng MSSQL sang framework.

   Split-pane: trái list module + form tạo mới, phải chi tiết
   với tabs theo pipeline (Discover/Enrich/Capture/Generate/
   Data/Audit). Generate + Audit disabled vì chưa triển khai
   (Tier 2+4 của plan AI).
   ========================================================== */

import {
  createMigrationClient,
  createMssqlConnectionsClient,
  type MigrationAction,
  type MigrationEnvCheck,
  type MigrationModuleSummary,
  type MssqlConnectionView,
  type MssqlTestResult,
} from "@erp-framework/client";
import { type Role, roleCan } from "@erp-framework/core";
import { createFileRoute } from "@tanstack/react-router";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { I } from "@/components/Icons";
import { AuditTab } from "@/components/migration/AuditTab";
import { DiagramTab } from "@/components/migration/DiagramTab";
import { DiscoverTab } from "@/components/migration/DiscoverTab";
import { EnrichTab } from "@/components/migration/EnrichTab";
import { FullJobsScreen } from "@/components/migration/FullJobsScreen";
import { fmtTime } from "@/components/migration/format";
import { GenerateTab } from "@/components/migration/GenerateTab";
import { JobRunner } from "@/components/migration/JobRunner";
import { MigratedEntitiesScreen } from "@/components/migration/MigratedEntitiesScreen";
import { ProceduresTab } from "@/components/migration/ProceduresTab";
import { QuickMigrateScreen } from "@/components/migration/QuickMigrateScreen";
import { RelationsTab } from "@/components/migration/RelationsTab";
import { ReviewTab } from "@/components/migration/ReviewTab";
import { RunAllProcsScreen } from "@/components/migration/RunAllProcsScreen";
import { SidebarSection } from "@/components/migration/SidebarSection";
import { SyncPanel } from "@/components/migration/SyncPanel";
import { Button, Card, Chip, EmptyState, FormField, Input, Modal, TagBox } from "@/components/ui";
import { useT } from "@/hooks/useT";
import { dialog } from "@/lib/dialog";
import { useAuth } from "@/stores/auth";
import { CockpitPage } from "./settings.cockpit";

const migration = createMigrationClient("");
const connectionsApi = createMssqlConnectionsClient("");

type TabId =
  | "discover"
  | "diagram"
  | "enrich"
  | "capture-golden"
  | "generate"
  | "procedures"
  | "data"
  | "review"
  | "relations"
  | "audit"
  | "sync-cutover";

interface TabDef {
  id: TabId;
  labelKey: string;
  action: MigrationAction | null;
  enabled: boolean;
  hintKey?: string;
}

const TAB_DEFS: TabDef[] = [
  { id: "discover", labelKey: "mig.tab_discover", action: "discover", enabled: true },
  { id: "diagram", labelKey: "mig.tab_diagram", action: null, enabled: true },
  { id: "enrich", labelKey: "mig.tab_enrich", action: "enrich", enabled: true },
  { id: "capture-golden", labelKey: "mig.tab_capture", action: "capture-golden", enabled: true },
  { id: "generate", labelKey: "mig.tab_generate", action: "generate", enabled: true },
  { id: "procedures", labelKey: "mig.tab_procedures", action: null, enabled: true },
  { id: "data", labelKey: "mig.tab_data", action: "data", enabled: true },
  { id: "review", labelKey: "mig.tab_review", action: null, enabled: true },
  { id: "relations", labelKey: "mig.tab_relations", action: null, enabled: true },
  {
    id: "audit",
    labelKey: "mig.tab_audit",
    action: null,
    enabled: true,
    hintKey: "mig.tab_audit_hint",
  },
  { id: "sync-cutover", labelKey: "mig.tab_sync_cutover", action: null, enabled: true },
];

function MigrationPage() {
  const t = useT();
  const userRole = useAuth((s) => (s.user?.role ?? "viewer") as Role);
  const canEdit = roleCan(userRole, "edit", "settings");

  // URL state — module + tab persist qua reload + share link.
  const urlSearch = Route.useSearch();
  const navigate = Route.useNavigate();
  const selected = urlSearch.module ?? null;
  const activeTabRaw = urlSearch.tab;
  const activeTab: TabId = (
    TAB_DEFS.some((d) => d.id === activeTabRaw) ? activeTabRaw : "discover"
  ) as TabId;
  const setSelected = useCallback(
    (name: string | null) => {
      navigate({
        search: (prev) => ({ ...prev, module: name ?? undefined }),
        replace: true,
      });
    },
    [navigate],
  );
  const setActiveTab = useCallback(
    (id: TabId) => {
      navigate({
        search: (prev) => ({ ...prev, tab: id }),
        replace: true,
      });
    },
    [navigate],
  );
  // Phase V refactor: active screen ưu tiên hơn module (khi set, main area
  // hiển thị screen full-page thay vì module tabs).
  type ScreenId = "quick-migrate" | "full-jobs" | "migrated-entities" | "run-all-procs" | "cockpit";
  const activeScreen = urlSearch.screen ?? null;
  const setActiveScreen = useCallback(
    (id: ScreenId | null) => {
      navigate({
        search: (prev) => ({ ...prev, screen: id ?? undefined }),
        replace: true,
      });
    },
    [navigate],
  );

  const [modules, setModules] = useState<MigrationModuleSummary[]>([]);
  const [env, setEnv] = useState<MigrationEnvCheck | null>(null);
  const [connTables, setConnTables] = useState<string[]>([]);
  const [reloadKey, setReloadKey] = useState(0);
  // Sidebar collapsed state — persist trong localStorage để giữ giữa các lần mở.
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    if (typeof window === "undefined") return true;
    const v = window.localStorage.getItem("migration:sidebar-open");
    return v == null ? true : v === "1";
  });
  useEffect(() => {
    window.localStorage.setItem("migration:sidebar-open", sidebarOpen ? "1" : "0");
  }, [sidebarOpen]);

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  // Phím tắt Ctrl+B (Cmd+B trên Mac) để toggle sidebar.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "b") {
        e.preventDefault();
        setSidebarOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // Load list module + env check.
  // biome-ignore lint/correctness/useExhaustiveDependencies: chủ ý reload lại khi reloadKey đổi
  useEffect(() => {
    if (!canEdit) return;
    migration
      .listModules()
      .then(setModules)
      .catch(() => setModules([]));
    migration
      .envCheck()
      .then(setEnv)
      .catch(() => setEnv(null));
    // Load tables từ default connection — dùng cho TagBox seed/exclude.
    connectionsApi
      .list()
      .then((cs) => {
        const def = cs.find((c) => c.isDefault) ?? cs[0];
        if (!def) {
          setConnTables([]);
          return;
        }
        connectionsApi
          .listTables(def.id)
          .then((arr) => setConnTables(arr.map((tbl) => `${tbl.schema}.${tbl.name}`)))
          .catch(() => setConnTables([]));
      })
      .catch(() => setConnTables([]));
  }, [canEdit, reloadKey]);

  if (!canEdit) {
    return (
      <div className="p-6">
        <EmptyState
          icon={<I.Lock size={28} />}
          title={t("mig.no_permission")}
          hint={t("mig.no_permission_hint")}
        />
      </div>
    );
  }

  const envOk = env?.hasDefaultConnection === true;

  return (
    <div
      className={[
        "grid h-full bg-bg transition-[grid-template-columns]",
        sidebarOpen ? "grid-cols-[320px_1fr]" : "grid-cols-[0_1fr]",
      ].join(" ")}
    >
      {/* Left pane */}
      <aside
        className={[
          "border-r border-border overflow-y-auto overflow-x-hidden",
          sidebarOpen ? "" : "invisible",
        ].join(" ")}
      >
        <ConnectionsPanel onChanged={reload} />
        <SidebarSection
          storageKey="migration:tools-open"
          title="Công cụ migrate"
          actions={
            <a
              href="/migration-guide.html"
              target="_blank"
              rel="noopener noreferrer"
              title="Mở hướng dẫn vận hành"
              className="p-1 rounded text-muted hover:text-accent hover:bg-accent/10 transition-colors"
            >
              <I.HelpCircle size={13} />
            </a>
          }
        >
          <div className="p-3 space-y-1.5">
            <button
              type="button"
              onClick={() => setActiveScreen("quick-migrate")}
              className={[
                "w-full flex items-center gap-2 px-3 py-2 rounded border text-sm transition-colors",
                activeScreen === "quick-migrate"
                  ? "border-accent bg-accent/10 text-accent"
                  : "border-border bg-surface hover:bg-hover/30",
              ].join(" ")}
            >
              <I.Wand size={14} />
              <span className="font-medium">Migrate nhanh</span>
              <span className="ml-auto text-[10px] text-muted">chọn bảng → ETL</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveScreen("full-jobs")}
              className={[
                "w-full flex items-center gap-2 px-3 py-2 rounded border text-sm transition-colors",
                activeScreen === "full-jobs"
                  ? "border-accent bg-accent/10 text-accent"
                  : "border-border bg-surface hover:bg-hover/30",
              ].join(" ")}
            >
              <I.Activity size={14} />
              <span className="font-medium">Jobs import</span>
              <span className="ml-auto text-[10px] text-muted">lịch sử · resume · cancel</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveScreen("migrated-entities")}
              className={[
                "w-full flex items-center gap-2 px-3 py-2 rounded border text-sm transition-colors",
                activeScreen === "migrated-entities"
                  ? "border-accent bg-accent/10 text-accent"
                  : "border-border bg-surface hover:bg-hover/30",
              ].join(" ")}
            >
              <I.Database size={14} />
              <span className="font-medium">Bảng đã migrate</span>
              <span className="ml-auto text-[10px] text-muted">cleanup · re-migrate</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveScreen("run-all-procs")}
              className={[
                "w-full flex items-center gap-2 px-3 py-2 rounded border text-sm transition-colors",
                activeScreen === "run-all-procs"
                  ? "border-accent bg-accent/10 text-accent"
                  : "border-border bg-surface hover:bg-hover/30",
              ].join(" ")}
            >
              <I.Workflow size={14} />
              <span className="font-medium">Migrate proc</span>
              <span className="ml-auto text-[10px] text-muted">1 lần · idempotent</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveScreen("cockpit")}
              className={[
                "w-full flex items-center gap-2 px-3 py-2 rounded border text-sm transition-colors",
                activeScreen === "cockpit"
                  ? "border-accent bg-accent/10 text-accent"
                  : "border-border bg-surface hover:bg-hover/30",
              ].join(" ")}
            >
              <I.Layers size={14} />
              <span className="font-medium">Menu cũ DQHF</span>
              <span className="ml-auto text-[10px] text-muted">port theo menu</span>
            </button>
          </div>
        </SidebarSection>
        <ModuleListPane
          modules={modules}
          selected={selected}
          onSelect={(name) => {
            setSelected(name);
            setActiveTab("discover");
          }}
          env={env}
          envOk={envOk}
          connTables={connTables}
          onCreated={(name) => {
            setSelected(name);
            setActiveTab("discover");
            reload();
          }}
        />
      </aside>
      {/* Right pane */}
      <main className="overflow-y-auto relative">
        <button
          type="button"
          onClick={() => setSidebarOpen((v) => !v)}
          title={sidebarOpen ? "Ẩn sidebar (Ctrl+B)" : "Hiện sidebar (Ctrl+B)"}
          aria-label={sidebarOpen ? "Ẩn sidebar" : "Hiện sidebar"}
          className="absolute top-2 left-2 z-10 w-7 h-7 flex items-center justify-center rounded border border-border bg-bg hover:bg-surface text-muted hover:text-text"
        >
          {sidebarOpen ? <I.PanelLeft size={14} /> : <I.PanelRight size={14} />}
        </button>
        {activeScreen === "quick-migrate" ? (
          <div className="h-full pl-9">
            <QuickMigrateScreen onClose={() => setActiveScreen(null)} onChanged={reload} />
          </div>
        ) : activeScreen === "full-jobs" ? (
          <div className="h-full pl-9 flex flex-col">
            <FullJobsScreen onClose={() => setActiveScreen(null)} />
          </div>
        ) : activeScreen === "migrated-entities" ? (
          <div className="h-full pl-9 flex flex-col">
            <MigratedEntitiesScreen onClose={() => setActiveScreen(null)} onChanged={reload} />
          </div>
        ) : activeScreen === "run-all-procs" ? (
          <div className="h-full pl-9 flex flex-col">
            <RunAllProcsScreen onClose={() => setActiveScreen(null)} />
          </div>
        ) : activeScreen === "cockpit" ? (
          <div className="h-full pl-9 flex flex-col min-h-0">
            <CockpitPage />
          </div>
        ) : !selected ? (
          <div className="p-8 pl-12">
            <EmptyState
              icon={<I.Database size={32} />}
              title={t("mig.select_module")}
              hint={t("mig.select_module_hint")}
            />
          </div>
        ) : (
          <div className="pl-9">
            <ModuleDetailPane
              moduleName={selected}
              activeTab={activeTab}
              onChangeTab={setActiveTab}
              onChanged={reload}
              envOk={envOk}
              connTables={connTables}
            />
          </div>
        )}
      </main>
    </div>
  );
}

/* ── Left pane: list module + form tạo mới ────────────────── */

const PHASE_ORDER = ["live", "filled", "discovered"];
const PHASE_LABEL: Record<string, string> = {
  live: "Live",
  filled: "Filled",
  discovered: "Discovered",
};

function ModuleListPane({
  modules,
  selected,
  onSelect,
  env,
  envOk,
  connTables,
  onCreated,
}: {
  modules: MigrationModuleSummary[];
  selected: string | null;
  onSelect: (name: string) => void;
  env: MigrationEnvCheck | null;
  envOk: boolean;
  connTables: string[];
  onCreated: (name: string) => void;
}) {
  const t = useT();
  const [showCreate, setShowCreate] = useState(false);

  // Collapsed sections — persist in localStorage.
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => {
    try {
      return JSON.parse(
        window.localStorage.getItem("migration:sidebar-collapsed") ?? "{}",
      ) as Record<string, boolean>;
    } catch {
      return {};
    }
  });

  const toggleSection = useCallback((phase: string) => {
    setCollapsed((prev) => {
      const next = { ...prev, [phase]: !prev[phase] };
      window.localStorage.setItem("migration:sidebar-collapsed", JSON.stringify(next));
      return next;
    });
  }, []);

  // Group modules by phase, ordered by PHASE_ORDER then alphabetical for unknown phases.
  const groups = useMemo(() => {
    const map = new Map<string, MigrationModuleSummary[]>();
    for (const m of modules) {
      const list = map.get(m.phase) ?? [];
      list.push(m);
      map.set(m.phase, list);
    }
    const knownOrder = PHASE_ORDER.filter((p) => map.has(p));
    const unknownOrder = [...map.keys()].filter((p) => !PHASE_ORDER.includes(p)).sort();
    return [...knownOrder, ...unknownOrder].map((phase) => ({
      phase,
      items: map.get(phase) ?? [],
    }));
  }, [modules]);

  return (
    <div className="flex flex-col h-full">
      <div className="p-3 border-b border-border">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-semibold">{t("mig.modules_heading")}</h2>
          <Button
            size="sm"
            variant="default"
            icon={<I.Plus size={14} />}
            onClick={() => setShowCreate((v) => !v)}
          >
            {t("mig.btn_new")}
          </Button>
        </div>
        {env && <EnvBanner env={env} />}
      </div>

      {showCreate && (
        <div className="border-b border-border bg-surface">
          <CreateModuleForm
            disabled={!envOk}
            connTables={connTables}
            onCreated={(name) => {
              setShowCreate(false);
              onCreated(name);
            }}
          />
        </div>
      )}

      <ul className="flex-1 overflow-y-auto">
        {modules.length === 0 && (
          <li className="px-3 py-6 text-sm text-muted text-center">{t("mig.no_modules")}</li>
        )}
        {groups.map(({ phase, items }) => {
          const isCollapsed = !!collapsed[phase];
          return (
            <Fragment key={phase}>
              {/* Section header */}
              <li>
                <button
                  type="button"
                  onClick={() => toggleSection(phase)}
                  className="w-full flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted bg-bg-soft hover:bg-surface border-b border-border"
                >
                  {isCollapsed ? (
                    <I.ChevronRight size={12} className="shrink-0" />
                  ) : (
                    <I.ChevronDown size={12} className="shrink-0" />
                  )}
                  <span className="flex-1 text-left">{PHASE_LABEL[phase] ?? phase}</span>
                  <span className="text-muted/60 font-normal normal-case tracking-normal">
                    {items.length}
                  </span>
                </button>
              </li>
              {/* Section items */}
              {!isCollapsed &&
                items.map((m) => (
                  <li key={m.name}>
                    <button
                      type="button"
                      onClick={() => onSelect(m.name)}
                      className={
                        "w-full text-left px-3 py-2 border-b border-border hover:bg-surface " +
                        (selected === m.name ? "bg-surface" : "")
                      }
                    >
                      <div className="font-medium text-sm">{m.name}</div>
                      <div className="text-xs text-muted flex gap-2 mt-0.5">
                        <span>{t("mig.module_tables", { count: m.tableCount })}</span>
                        <span>{t("mig.module_procs", { count: m.procCount })}</span>
                      </div>
                      <div className="text-[10px] text-muted mt-0.5">{fmtTime(m.updatedAt)}</div>
                    </button>
                  </li>
                ))}
            </Fragment>
          );
        })}
      </ul>
    </div>
  );
}

function EnvBanner({ env }: { env: MigrationEnvCheck }) {
  const t = useT();
  const issues: string[] = [];
  if (env.connectionCount === 0) issues.push(t("mig.env_no_conn"));
  else if (!env.hasDefaultConnection) issues.push(t("mig.env_no_default"));
  if (!env.modulesDirExists) issues.push(t("mig.env_no_modules_dir"));
  if (issues.length === 0) return null;
  return (
    <div className="text-[11px] bg-warning/10 text-warning rounded px-2 py-1.5 border border-warning/30">
      <div className="font-medium flex items-center gap-1">
        <I.AlertCircle size={12} /> {t("common.warning")}
      </div>
      <ul className="ml-3 list-disc">
        {issues.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ul>
    </div>
  );
}

function CreateModuleForm({
  disabled,
  connTables,
  onCreated,
}: {
  disabled: boolean;
  connTables: string[];
  onCreated: (name: string) => void;
}) {
  const t = useT();
  const [name, setName] = useState("");
  const [seed, setSeed] = useState<string[]>([]);
  const [exclude, setExclude] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const valid = /^[a-z][a-z0-9_]*$/.test(name) && seed.length > 0;

  const create = async () => {
    setBusy(true);
    setErr("");
    try {
      await migration.startJob("discover", name.trim(), {
        seedTables: seed,
        excludeTables: exclude,
      });
      onCreated(name.trim());
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="p-3 space-y-2">
      <FormField label={t("mig.form_module_name")}>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="sales"
          disabled={disabled || busy}
        />
      </FormField>
      <FormField label={t("mig.form_seed_tables", { count: connTables.length })}>
        <TagBox
          value={seed}
          onChange={setSeed}
          suggestions={connTables}
          disabled={disabled || busy}
          placeholder={t("mig.ph_filter_table")}
        />
      </FormField>
      <FormField label={t("mig.form_exclude")}>
        <TagBox
          value={exclude}
          onChange={setExclude}
          suggestions={connTables}
          disabled={disabled || busy}
          placeholder={t("mig.ph_exclude_table")}
        />
      </FormField>
      {err && <div className="text-xs text-danger">{err}</div>}
      <Button
        size="sm"
        variant="primary"
        disabled={!valid || disabled || busy}
        onClick={create}
        icon={<I.Play size={14} />}
      >
        {busy ? t("mig.btn_running_discover") : t("mig.btn_run_discover")}
      </Button>
      {disabled && <div className="text-[11px] text-muted">{t("mig.need_conn_hint")}</div>}
    </div>
  );
}

/* ── Right pane: detail with tabs ─────────────────────────── */

function ModuleDetailPane({
  moduleName,
  activeTab,
  onChangeTab,
  onChanged,
  envOk,
  connTables,
}: {
  moduleName: string;
  activeTab: TabId;
  onChangeTab: (id: TabId) => void;
  onChanged: () => void;
  envOk: boolean;
  connTables: string[];
}) {
  const t = useT();
  const [summary, setSummary] = useState<{
    manifest: unknown;
    enrichedManifest: unknown;
  } | null>(null);

  // Load module manifest.
  useEffect(() => {
    migration
      .getModule(moduleName)
      .then((m) => setSummary(m as typeof summary))
      .catch(() => setSummary(null));
  }, [moduleName]);

  const manifest = summary?.manifest as
    | {
        tables?: Array<{ name: string; suggestedEntityName?: string }>;
        procs?: Array<{ name: string; suggestedTier?: string }>;
      }
    | undefined;

  return (
    <div className="flex flex-col h-full">
      <header className="border-b border-border px-4 py-3 flex items-center gap-3">
        <h1 className="font-semibold">{moduleName}</h1>
        {summary && (
          <span className="text-xs text-muted">
            {t("mig.module_header", {
              tables: manifest?.tables?.length ?? 0,
              procs: manifest?.procs?.length ?? 0,
            })}
          </span>
        )}
        <div className="flex-1" />
        <RefreshManifestButton moduleName={moduleName} onRefreshed={onChanged} />
      </header>

      {/* Tab bar */}
      <div className="flex border-b border-border px-2">
        {TAB_DEFS.map((def) => (
          <button
            type="button"
            key={def.id}
            disabled={!def.enabled}
            title={def.enabled ? "" : def.hintKey ? t(def.hintKey) : ""}
            onClick={() => def.enabled && onChangeTab(def.id)}
            className={[
              "px-3 h-9 text-sm border-b-2 -mb-px transition-colors",
              !def.enabled
                ? "border-transparent text-muted/50 cursor-not-allowed"
                : activeTab === def.id
                  ? "border-accent text-text"
                  : "border-transparent text-muted hover:text-text",
            ].join(" ")}
          >
            {t(def.labelKey)}
            {!def.enabled && <I.Lock size={10} className="ml-1 inline-block" />}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto p-4">
        {activeTab === "discover" && (
          <DiscoverTab
            moduleName={moduleName}
            summary={summary}
            envOk={envOk}
            connTables={connTables}
            onChanged={onChanged}
          />
        )}
        {activeTab === "diagram" && <DiagramTab moduleName={moduleName} onChanged={onChanged} />}
        {activeTab === "review" && <ReviewTab moduleName={moduleName} onChanged={onChanged} />}
        {activeTab === "audit" && <AuditTab moduleName={moduleName} />}
        {activeTab === "procedures" && (
          <ProceduresTab moduleName={moduleName} onChanged={onChanged} />
        )}
        {activeTab === "relations" && (
          <RelationsTab moduleName={moduleName} onChanged={onChanged} />
        )}
        {activeTab === "enrich" && (
          <EnrichTab moduleName={moduleName} summary={summary} onChanged={onChanged} />
        )}
        {activeTab === "capture-golden" && (
          <SimpleJobTab
            moduleName={moduleName}
            action="capture-golden"
            title={t("mig.capture_title")}
            description={t("mig.capture_desc")}
            fields={[
              { name: "samples", label: t("mig.capture_samples"), kind: "number", default: "10" },
              {
                name: "procs",
                label: t("mig.capture_procs_filter"),
                kind: "tagbox",
                suggestions: (
                  (summary?.manifest as { procs?: Array<{ name: string }> })?.procs ?? []
                ).map((p) => p.name),
                default: [],
              },
            ]}
            envOk={envOk}
            onChanged={onChanged}
          />
        )}
        {activeTab === "data" && (
          <SimpleJobTab
            moduleName={moduleName}
            action="data"
            title={t("mig.data_title")}
            description={t("mig.data_desc")}
            fields={[
              {
                name: "tables",
                label: t("mig.data_tables_filter"),
                kind: "tagbox",
                suggestions: (
                  (summary?.manifest as { tables?: Array<{ name: string }> })?.tables ?? []
                ).map((tbl) => tbl.name),
                default: [],
              },
              { name: "limit", label: t("mig.data_limit"), kind: "number", default: "10000" },
            ]}
            envOk={envOk}
            onChanged={onChanged}
          />
        )}
        {activeTab === "generate" && <GenerateTab moduleName={moduleName} onChanged={onChanged} />}
        {activeTab === "sync-cutover" && (
          <SyncPanel
            moduleName={moduleName}
            manifestTables={(manifest?.tables ?? []).map((tbl) => tbl.name)}
            onChanged={onChanged}
          />
        )}
        {/* tab audit đã enable + render ở trên qua <AuditTab /> */}
      </div>
    </div>
  );
}

/* ── Generic simple tab cho Capture/Data ─────────────────── */

type SimpleField =
  | { name: string; label: string; kind: "text" | "number"; default: string }
  | { name: string; label: string; kind: "tagbox"; suggestions: string[]; default: string[] };

function SimpleJobTab({
  moduleName,
  action,
  title,
  description,
  fields,
  envOk,
  onChanged,
}: {
  moduleName: string;
  action: MigrationAction;
  title: string;
  description: string;
  fields: SimpleField[];
  envOk: boolean;
  onChanged: () => void;
}) {
  const [values, setValues] = useState<Record<string, string | string[]>>(
    Object.fromEntries(fields.map((f) => [f.name, f.default])),
  );

  return (
    <Card className="p-4">
      <h3 className="font-medium mb-1">{title}</h3>
      <p className="text-sm text-muted mb-3">{description}</p>
      <JobRunner
        moduleName={moduleName}
        action={action}
        envOk={envOk}
        buildArgs={() => {
          const out: Record<string, unknown> = {};
          for (const f of fields) {
            const v = values[f.name];
            if (f.kind === "tagbox") {
              if (Array.isArray(v) && v.length > 0) out[f.name] = v;
            } else if (typeof v === "string" && v) {
              out[f.name] = f.kind === "number" ? parseFloat(v) : v;
            }
          }
          return out;
        }}
        renderForm={() => (
          <div className="space-y-2">
            {fields.map((f) => (
              <FormField key={f.name} label={f.label}>
                {f.kind === "tagbox" ? (
                  <TagBox
                    value={(values[f.name] as string[]) ?? []}
                    onChange={(next) => setValues({ ...values, [f.name]: next })}
                    suggestions={f.suggestions}
                  />
                ) : (
                  <Input
                    value={(values[f.name] as string) ?? ""}
                    type={f.kind}
                    onChange={(e) => setValues({ ...values, [f.name]: e.target.value })}
                  />
                )}
              </FormField>
            ))}
          </div>
        )}
        canRun={() => true}
        onCompleted={onChanged}
      />
    </Card>
  );
}

/* ── Connections panel: CRUD kết nối MSSQL per-company ───── */

/** Collapsible sidebar section — header click ẩn/hiện body, persist localStorage. */
function ConnectionsPanel({ onChanged }: { onChanged: () => void }) {
  const t = useT();
  const [conns, setConns] = useState<MssqlConnectionView[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<MssqlConnectionView | null>(null);

  const load = useCallback(() => {
    connectionsApi
      .list()
      .then(setConns)
      .catch(() => setConns([]));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const removeConn = async (c: MssqlConnectionView) => {
    const ok = await dialog.confirm(t("mig.delete_conn_confirm", { name: c.name }), {
      title: "Xoá kết nối",
      confirmText: "Xoá",
    });
    if (!ok) return;
    await connectionsApi.delete(c.id);
    load();
    onChanged();
  };

  const setDefault = async (c: MssqlConnectionView) => {
    await connectionsApi.setDefault(c.id);
    load();
    onChanged();
  };

  return (
    <SidebarSection
      storageKey="migration:section-connections"
      title={
        <>
          <I.Server size={13} className="inline mr-1" />
          {t("mig.conn_panel_title")}
        </>
      }
      actions={
        <Button
          size="sm"
          variant="default"
          icon={<I.Plus size={12} />}
          onClick={() => {
            setEditing(null);
            setShowForm(true);
          }}
        >
          {t("common.add")}
        </Button>
      }
    >
      {conns.length === 0 && <div className="text-xs text-muted mt-1">{t("mig.no_conn")}</div>}
      <ul className="space-y-1 mt-1">
        {conns.map((c) => (
          <li key={c.id} className="text-xs border border-border rounded p-2 bg-bg">
            <div className="flex items-center justify-between">
              <span className="font-medium">{c.name}</span>
              <div className="flex gap-1">
                {c.isDefault && (
                  <Chip variant="success" className="text-[9px]!">
                    {t("mig.chip_default")}
                  </Chip>
                )}
                {c.allowWrite && (
                  <Chip variant="warning" className="text-[9px]!">
                    RW
                  </Chip>
                )}
              </div>
            </div>
            <div className="text-muted mt-0.5 truncate">
              {c.username}@{c.host}:{c.port}/{c.database}
            </div>
            <div className="flex gap-1 mt-1.5">
              <Button
                size="sm"
                variant="default"
                onClick={() => {
                  setEditing(c);
                  setShowForm(true);
                }}
              >
                {t("common.edit")}
              </Button>
              {!c.isDefault && (
                <Button size="sm" variant="default" onClick={() => setDefault(c)}>
                  {t("mig.btn_set_default")}
                </Button>
              )}
              <TestButton connectionId={c.id} />
              <Button size="sm" variant="default" onClick={() => removeConn(c)}>
                {t("mig.btn_delete")}
              </Button>
            </div>
          </li>
        ))}
      </ul>
      {showForm && (
        <div className="mt-2 border border-border rounded bg-surface">
          <ConnectionForm
            initial={editing}
            onCancel={() => setShowForm(false)}
            onSaved={() => {
              setShowForm(false);
              load();
              onChanged();
            }}
          />
        </div>
      )}
    </SidebarSection>
  );
}

function TestButton({ connectionId }: { connectionId: string }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<MssqlTestResult | null>(null);

  const run = async () => {
    setBusy(true);
    setResult(null);
    try {
      const r = await connectionsApi.testConnect(connectionId);
      setResult(r);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-1">
      <Button
        size="sm"
        variant="default"
        disabled={busy}
        onClick={run}
        icon={busy ? <I.Loader size={11} /> : <I.Power size={11} />}
      >
        {t("mig.btn_test_conn")}
      </Button>
      {result &&
        (result.ok ? (
          <span className="text-[10px] text-success">
            {t("mig.test_ok", { count: result.tableCount ?? 0 })}
          </span>
        ) : (
          <span className="text-[10px] text-danger" title={result.error}>
            {t("mig.test_err")}
          </span>
        ))}
    </div>
  );
}

function ConnectionForm({
  initial,
  onCancel,
  onSaved,
}: {
  initial: MssqlConnectionView | null;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const t = useT();
  const [name, setName] = useState(initial?.name ?? "");
  const [host, setHost] = useState(initial?.host ?? "");
  const [port, setPort] = useState(String(initial?.port ?? 1433));
  const [database, setDatabase] = useState(initial?.database ?? "");
  const [username, setUsername] = useState(initial?.username ?? "");
  const [password, setPassword] = useState("");
  const [encrypt, setEncrypt] = useState(initial?.encrypt ?? true);
  const [trustCert, setTrustCert] = useState(initial?.trustServerCert ?? false);
  const [allowWrite, setAllowWrite] = useState(initial?.allowWrite ?? false);
  const [isDefault, setIsDefault] = useState(initial?.isDefault ?? false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const valid = name && host && database && username && (initial?.hasPassword || password); // cần password khi tạo mới

  const save = async () => {
    setBusy(true);
    setErr("");
    try {
      await connectionsApi.save({
        id: initial?.id,
        name,
        host,
        port: parseInt(port, 10) || 1433,
        database,
        username,
        password: password || undefined,
        encrypt,
        trustServerCert: trustCert,
        allowWrite,
        isDefault,
      });
      onSaved();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="p-3 space-y-2">
      <div className="text-xs font-medium mb-1">
        {initial ? t("mig.conn_form_edit", { name: initial.name }) : t("mig.conn_form_add")}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <FormField label={t("mig.conn_field_name")}>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="prod-mssql" />
        </FormField>
        <FormField label={t("mig.conn_field_db")}>
          <Input
            value={database}
            onChange={(e) => setDatabase(e.target.value)}
            placeholder="MyApp"
          />
        </FormField>
        <FormField label={t("mig.conn_field_host")}>
          <Input
            value={host}
            onChange={(e) => setHost(e.target.value)}
            placeholder={t("mig.conn_field_host_ph")}
          />
        </FormField>
        <FormField label={t("mig.conn_field_port")}>
          <Input value={port} onChange={(e) => setPort(e.target.value)} type="number" />
        </FormField>
        <FormField label={t("mig.conn_field_user")}>
          <Input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="sa" />
        </FormField>
        <FormField
          label={initial?.hasPassword ? t("mig.conn_field_pwd_keep") : t("mig.conn_field_pwd")}
        >
          <Input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            type="password"
            placeholder={initial?.hasPassword ? t("mig.conn_field_pwd_keep_ph") : ""}
          />
        </FormField>
      </div>
      <div className="flex flex-wrap gap-3 text-xs pt-1">
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={encrypt} onChange={(e) => setEncrypt(e.target.checked)} />
          {t("mig.conn_encrypt")}
        </label>
        <label className="flex items-center gap-1">
          <input
            type="checkbox"
            checked={trustCert}
            onChange={(e) => setTrustCert(e.target.checked)}
          />
          {t("mig.conn_trust_cert")}
        </label>
        <label className="flex items-center gap-1">
          <input
            type="checkbox"
            checked={allowWrite}
            onChange={(e) => setAllowWrite(e.target.checked)}
          />
          {t("mig.conn_allow_write")}
        </label>
        <label className="flex items-center gap-1">
          <input
            type="checkbox"
            checked={isDefault}
            onChange={(e) => setIsDefault(e.target.checked)}
          />
          {t("mig.conn_is_default")}
        </label>
      </div>
      {err && <div className="text-xs text-danger">{err}</div>}
      <div className="flex gap-2">
        <Button size="sm" variant="primary" disabled={!valid || busy} onClick={save}>
          {busy ? t("mig.btn_saving") : t("common.save")}
        </Button>
        <Button size="sm" variant="default" onClick={onCancel}>
          {t("common.cancel")}
        </Button>
      </div>
    </div>
  );
}

/* ── Nút refresh manifest (re-discover + merge giữ enrichment) ── */

interface RefreshDiff {
  at: string;
  tablesAdded: string[];
  tablesRemoved: string[];
  procsAdded: string[];
  procsRemoved: string[];
  columnsAdded: Array<{ table: string; column: string }>;
  columnsRemoved: Array<{ table: string; column: string }>;
}

function RefreshManifestButton({
  moduleName,
  onRefreshed,
}: {
  moduleName: string;
  onRefreshed: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [diff, setDiff] = useState<RefreshDiff | null>(null);
  const [err, setErr] = useState("");
  const [showDiff, setShowDiff] = useState(false);

  const run = async () => {
    const ok = await dialog.confirm(
      "Re-scan MSSQL và merge vào manifest hiện tại.\n\n" +
        "• Giữ nguyên: label, kind, mapTo, targetProcName, suggestedTier (do AI/user đã sửa).\n" +
        "• Cập nhật: columns mới/xóa, primary key, kiểu cột.\n" +
        "• Thêm: bảng / proc mới phát hiện qua seed cũ.\n\n" +
        "Tiếp tục?",
      { title: "Cập nhật từ MSSQL", confirmText: "Cập nhật" },
    );
    if (!ok) return;
    setBusy(true);
    setErr("");
    setDiff(null);
    try {
      const r = await migration.refreshManifest(moduleName);
      setDiff(r);
      setShowDiff(true);
      onRefreshed();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const totalChanges = diff
    ? diff.tablesAdded.length +
      diff.tablesRemoved.length +
      diff.procsAdded.length +
      diff.procsRemoved.length +
      diff.columnsAdded.length +
      diff.columnsRemoved.length
    : 0;

  return (
    <>
      <Button
        size="sm"
        variant="default"
        disabled={busy}
        onClick={run}
        icon={busy ? <I.Loader size={12} /> : <I.Redo size={12} />}
      >
        {busy ? "Đang re-scan..." : "Cập nhật từ MSSQL"}
      </Button>
      {diff && (
        <button
          type="button"
          onClick={() => setShowDiff(true)}
          className="text-xs text-accent hover:underline"
        >
          {totalChanges === 0 ? "Không thay đổi" : `${totalChanges} thay đổi`}
        </button>
      )}
      {err && <span className="text-[11px] text-danger">{err}</span>}
      <Modal
        open={showDiff}
        onClose={() => setShowDiff(false)}
        title={`Diff refresh: ${moduleName}`}
        width={720}
      >
        {diff && <RefreshDiffView diff={diff} />}
      </Modal>
    </>
  );
}

function RefreshDiffView({ diff }: { diff: RefreshDiff }) {
  const sections: Array<{ title: string; items: string[]; tone: "success" | "danger" | "muted" }> =
    [
      { title: "Bảng mới", items: diff.tablesAdded, tone: "success" },
      { title: "Bảng đã xóa khỏi MSSQL", items: diff.tablesRemoved, tone: "danger" },
      { title: "Proc mới", items: diff.procsAdded, tone: "success" },
      { title: "Proc đã xóa khỏi MSSQL", items: diff.procsRemoved, tone: "danger" },
      {
        title: "Cột mới",
        items: diff.columnsAdded.map((c) => `${c.table}.${c.column}`),
        tone: "success",
      },
      {
        title: "Cột đã xóa",
        items: diff.columnsRemoved.map((c) => `${c.table}.${c.column}`),
        tone: "danger",
      },
    ];
  const anyChange = sections.some((s) => s.items.length > 0);
  return (
    <div className="space-y-3 text-xs">
      <div className="text-muted">Refresh lúc {new Date(diff.at).toLocaleString("vi-VN")}</div>
      {!anyChange && (
        <div className="text-success">
          ✓ Không phát hiện thay đổi schema MSSQL — manifest đã đồng bộ.
        </div>
      )}
      {sections.map(
        (s) =>
          s.items.length > 0 && (
            <div key={s.title}>
              <div
                className={
                  s.tone === "success"
                    ? "text-success font-medium"
                    : s.tone === "danger"
                      ? "text-danger font-medium"
                      : "text-muted font-medium"
                }
              >
                {s.tone === "success" ? "+" : s.tone === "danger" ? "−" : "•"} {s.title} (
                {s.items.length})
              </div>
              <ul className="ml-4 list-disc text-[11px] text-muted">
                {s.items.map((it) => (
                  <li key={it}>
                    <code>{it}</code>
                  </li>
                ))}
              </ul>
            </div>
          ),
      )}
      <div className="border-t border-border pt-2 text-[11px] text-muted">
        Bảng/proc bị xóa khỏi MSSQL VẪN giữ trong manifest (đề phòng false-negative do scope hẹp).
        Nếu thực sự đã xóa, sửa manifest tay hoặc dùng action delete (chưa có).
      </div>
    </div>
  );
}

/* URL search params persist module + activeTab — đóng browser/share link OK.
 * Validate kiểu tránh nhiễm garbage từ URL. */
export const Route = createFileRoute("/settings/migration")({
  component: MigrationPage,
  validateSearch: (search: Record<string, unknown>) => ({
    module: typeof search.module === "string" ? search.module : undefined,
    tab: typeof search.tab === "string" ? search.tab : undefined,
    screen:
      typeof search.screen === "string" &&
      ["quick-migrate", "full-jobs", "migrated-entities", "run-all-procs", "cockpit"].includes(
        search.screen,
      )
        ? (search.screen as
            | "quick-migrate"
            | "full-jobs"
            | "migrated-entities"
            | "run-all-procs"
            | "cockpit")
        : undefined,
  }),
});
