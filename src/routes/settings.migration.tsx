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
  type MigrationAiLogEntry,
  type MigrationEnvCheck,
  type MigrationModuleSummary,
  type MssqlConnectionView,
  type MssqlTestResult,
} from "@erp-framework/client";
import { type Role, roleCan } from "@erp-framework/core";
import { createFileRoute } from "@tanstack/react-router";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { I } from "@/components/Icons";
import { DiagramTab } from "@/components/migration/DiagramTab";
import { DiscoverTab } from "@/components/migration/DiscoverTab";
import { DryRunEnrich } from "@/components/migration/DryRunEnrich";
import { ErrorHint } from "@/components/migration/ErrorHint";
import { FullJobsScreen } from "@/components/migration/FullJobsScreen";
import { fmtTime } from "@/components/migration/format";
import { JobRunner } from "@/components/migration/JobRunner";
import { MarkdownPreview } from "@/components/migration/Markdown";
import { MigratedEntitiesScreen } from "@/components/migration/MigratedEntitiesScreen";
import type { ManifestProcRow } from "@/components/migration/manifest-types";
import { CodegenProcButton } from "@/components/migration/ProcCodegen";
import { ProceduresTab } from "@/components/migration/ProceduresTab";
import { QuickMigrateScreen } from "@/components/migration/QuickMigrateScreen";
import { RelationsTab } from "@/components/migration/RelationsTab";
import { RunAllProcsScreen } from "@/components/migration/RunAllProcsScreen";
import { SidebarSection } from "@/components/migration/SidebarSection";
import { SyncPanel } from "@/components/migration/SyncPanel";
import {
  Button,
  Card,
  Chip,
  EmptyState,
  FormField,
  Input,
  Modal,
  TagBox,
  Textarea,
} from "@/components/ui";
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

/* ── Phase R — GenerateTab: list proc + batch codegen ──────── */
function GenerateTab({ moduleName, onChanged }: { moduleName: string; onChanged: () => void }) {
  const [data, setData] = useState<ReviewStatus | null>(null);
  const [readiness, setReadiness] = useState<
    Record<
      string,
      { canCodegen: boolean; active: boolean; missingCount: number; missing: string[] }
    >
  >({});
  const [batchOpen, setBatchOpen] = useState(false);
  const [skipExisting, setSkipExisting] = useState(true);
  const [overwriteFiles, setOverwriteFiles] = useState(false);
  const [includeDirty, setIncludeDirty] = useState(false);
  const [onlyTier, setOnlyTier] = useState<"" | "B" | "D">("");
  const [busy, setBusy] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [progress, setProgress] = useState<{
    current: number;
    total: number;
    last: string;
  } | null>(null);
  const [batchResult, setBatchResult] = useState<{
    succeeded: number;
    skipped: number;
    failed: number;
    total: number;
  } | null>(null);
  const [err, setErr] = useState("");

  const load = useCallback(() => {
    migration
      .getReviewStatus(moduleName)
      .then(setData)
      .catch(() => setData(null));
  }, [moduleName]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!data) return;
    let cancelled = false;
    Promise.all(
      data.procs.map(async (p) => {
        try {
          const r = await migration.getProcMigrationStatus(moduleName, p.name);
          return [
            p.name,
            {
              canCodegen: r.canCodegen,
              active: r.active,
              missingCount: r.missingTables.length,
              missing: r.missingTables.map((m) => m.table),
            },
          ] as const;
        } catch {
          return null;
        }
      }),
    ).then((rows) => {
      if (cancelled) return;
      const map: Record<
        string,
        { canCodegen: boolean; active: boolean; missingCount: number; missing: string[] }
      > = {};
      for (const row of rows) if (row) map[row[0]] = row[1];
      setReadiness(map);
    });
    return () => {
      cancelled = true;
    };
  }, [data, moduleName]);

  // Poll job status (WS subscribe có thể ko sẵn — fallback poll mỗi 1s).
  useEffect(() => {
    if (!jobId) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const st = await migration.jobStatus(jobId);
        if (cancelled) return;
        if (st?.status === "completed") {
          setBusy(false);
          // Parse message: "Codegen: N apply / M skip / K fail (tổng T)"
          const m = st.message?.match(
            /(\d+) apply.*?(\d+) skip.*?(\d+) fail.*?\((?:tổng )?(\d+)\)/,
          );
          if (m) {
            setBatchResult({
              succeeded: Number(m[1]),
              skipped: Number(m[2]),
              failed: Number(m[3]),
              total: Number(m[4]),
            });
          }
          setProgress(null);
          load();
          onChanged();
        } else if (st?.status === "failed") {
          setBusy(false);
          setErr(st.error ?? "Job failed");
          setProgress(null);
        } else {
          setTimeout(tick, 1500);
        }
      } catch {
        setBusy(false);
      }
    };
    tick();
    return () => {
      cancelled = true;
    };
  }, [jobId, load, onChanged]);

  const runBatch = async () => {
    setBusy(true);
    setErr("");
    setBatchResult(null);
    setProgress({ current: 0, total: 0, last: "đang khởi tạo..." });
    try {
      const { jobId: id } = await migration.startJob("generate", moduleName, {
        skipExisting,
        overwriteFiles,
        includeDirty,
        onlyTier: onlyTier || undefined,
      });
      setJobId(id);
      setBatchOpen(false);
    } catch (e) {
      setBusy(false);
      setErr((e as Error).message);
    }
  };

  if (!data) return <div className="text-sm text-muted p-4">Đang tải...</div>;

  const stats = (() => {
    let cleanB = 0;
    let cleanD = 0;
    let dirty = 0;
    let inactive = 0;
    let appliedB = 0;
    let appliedD = 0;
    let tierC = 0;
    for (const p of data.procs) {
      if (p.tier === "C") {
        tierC++;
        continue;
      }
      const r = readiness[p.name];
      if (r) {
        if (!r.active) inactive++;
        else if (!r.canCodegen) dirty++;
        else if (p.tier === "B") cleanB++;
        else if (p.tier === "D") cleanD++;
      }
      if (p.codegenApplied) {
        if (p.tier === "B") appliedB++;
        else if (p.tier === "D") appliedD++;
      }
    }
    return { cleanB, cleanD, dirty, inactive, appliedB, appliedD, tierC };
  })();

  return (
    <div className="space-y-3">
      <Card className="p-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h3 className="font-medium">Sinh code (Tier 2 AI codegen)</h3>
            <div className="text-xs text-muted mt-1">
              Mỗi proc có nút "AI codegen" riêng. Bấm "Codegen tất cả clean" để batch sinh code +
              auto-apply qua background job.
            </div>
          </div>
          <Button
            size="sm"
            variant="primary"
            disabled={busy || stats.cleanB + stats.cleanD === 0}
            onClick={() => setBatchOpen(true)}
            icon={<I.Wand size={12} />}
          >
            Codegen tất cả clean ({stats.cleanB + stats.cleanD})
          </Button>
        </div>
        <div className="grid md:grid-cols-4 gap-2 mt-3 text-[11px]">
          <div className="p-2 rounded border border-success/40 bg-success/5">
            <div className="text-success">Clean (sẵn sàng)</div>
            <div className="text-base font-semibold text-success">
              {stats.cleanB + stats.cleanD}
            </div>
            <div className="text-[10px] text-muted">
              B: {stats.cleanB} · D: {stats.cleanD}
            </div>
          </div>
          <div className="p-2 rounded border border-warning/40 bg-warning/5">
            <div className="text-warning">Dirty (chờ migrate)</div>
            <div className="text-base font-semibold text-warning">{stats.dirty}</div>
          </div>
          <div className="p-2 rounded border border-border bg-surface">
            <div className="text-muted">Inactive (skip)</div>
            <div className="text-base font-semibold">{stats.inactive}</div>
            {stats.tierC > 0 && (
              <div className="text-[10px] text-muted">+{stats.tierC} tier C (workflow)</div>
            )}
          </div>
          <div className="p-2 rounded border border-accent/40 bg-accent/5">
            <div className="text-accent">Đã apply</div>
            <div className="text-base font-semibold text-accent">
              {stats.appliedB + stats.appliedD}
            </div>
            <div className="text-[10px] text-muted">
              B: {stats.appliedB} · D: {stats.appliedD}
            </div>
          </div>
        </div>
        {err && <div className="text-danger text-xs mt-2">{err}</div>}
        {progress && (
          <div className="mt-3 p-2 rounded border border-accent/40 bg-accent/5 text-[11px]">
            <div className="font-medium text-accent">
              Đang chạy... {progress.current}/{progress.total}
            </div>
            <div className="text-muted truncate">{progress.last}</div>
          </div>
        )}
        {batchResult && (
          <div className="mt-3 p-2 rounded border border-success/40 bg-success/5 text-[11px]">
            <div className="font-medium text-success">
              ✓ Xong: {batchResult.succeeded} apply, {batchResult.skipped} skip,{" "}
              {batchResult.failed} fail (tổng {batchResult.total})
            </div>
          </div>
        )}
      </Card>

      <Card className="p-4">
        <div className="font-medium mb-2">Procedure ({data.procs.length})</div>
        <div className="border border-border rounded overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-surface text-muted">
              <tr>
                <th className="text-left px-2 py-1.5">MSSQL proc</th>
                <th className="text-left px-2 py-1.5">Target</th>
                <th className="text-left px-2 py-1.5">Tier</th>
                <th className="text-center px-2 py-1.5">Sẵn sàng</th>
                <th className="text-center px-2 py-1.5">Applied</th>
                <th className="text-center px-2 py-1.5 w-32">Hành động</th>
              </tr>
            </thead>
            <tbody>
              {data.procs.map((p) => {
                const r = readiness[p.name];
                return (
                  <tr key={p.name} className="border-t border-border">
                    <td className="px-2 py-1 font-mono">{p.name}</td>
                    <td className="px-2 py-1 text-accent text-[11px]">
                      {p.targetProcName ?? p.targetFile ?? "—"}
                    </td>
                    <td className="px-2 py-1">
                      <Chip
                        variant={p.tier === "D" ? "warning" : p.tier === "C" ? "accent" : "default"}
                        className="text-[9px]!"
                      >
                        {p.tier}
                      </Chip>
                    </td>
                    <td className="px-2 py-1 text-center">
                      {p.tier === "C" ? (
                        <span className="text-muted text-[10px]">N/A</span>
                      ) : !r ? (
                        <span className="text-muted text-[10px]">…</span>
                      ) : !r.active ? (
                        <Chip variant="default" className="text-[9px]!">
                          💤
                        </Chip>
                      ) : r.canCodegen ? (
                        <Chip variant="success" className="text-[9px]!">
                          ✓
                        </Chip>
                      ) : (
                        <Chip
                          variant="warning"
                          className="text-[9px]!"
                          title={`Chờ ${r.missingCount} bảng: ${r.missing.join(", ")}`}
                        >
                          ⏳ {r.missingCount}
                        </Chip>
                      )}
                    </td>
                    <td className="px-2 py-1 text-center">
                      {p.tier === "C" ? (
                        <span className="text-muted text-[10px]">N/A</span>
                      ) : p.codegenApplied ? (
                        <I.Check size={12} className="inline text-success" />
                      ) : (
                        <I.X size={12} className="inline text-muted" />
                      )}
                    </td>
                    <td className="px-2 py-1 text-center">
                      {p.tier !== "C" && (
                        <CodegenProcButton
                          moduleName={moduleName}
                          procName={p.name}
                          suggestedTier={p.tier}
                        />
                      )}
                    </td>
                  </tr>
                );
              })}
              {data.procs.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-2 py-4 text-muted text-center">
                    Không có proc nào trong module này.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <Modal
        open={batchOpen}
        onClose={() => setBatchOpen(false)}
        title="Codegen batch — config"
        width={600}
      >
        <div className="space-y-3 text-xs">
          <label className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={skipExisting}
              onChange={(e) => setSkipExisting(e.target.checked)}
            />
            <span>Skip procedure đã apply (tier B đã có name trong DB)</span>
          </label>
          <label className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={overwriteFiles}
              onChange={(e) => setOverwriteFiles(e.target.checked)}
            />
            <span>Ghi đè file plugin nếu đã tồn tại (tier D)</span>
          </label>
          <label className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={includeDirty}
              onChange={(e) => setIncludeDirty(e.target.checked)}
            />
            <span>Bao gồm cả proc dirty (chờ migrate) — KHÔNG khuyến khích</span>
          </label>
          <div className="flex items-center gap-2">
            <span>Chỉ tier:</span>
            {(["", "B", "D"] as const).map((tt) => (
              <button
                key={tt || "all"}
                type="button"
                onClick={() => setOnlyTier(tt)}
                className={[
                  "px-2 h-6 border rounded text-[11px]",
                  onlyTier === tt
                    ? "border-accent text-accent bg-accent/10"
                    : "border-border hover:bg-surface",
                ].join(" ")}
              >
                {tt || "B+D"}
              </button>
            ))}
          </div>
          <div className="flex justify-end gap-2 pt-2 border-t border-border">
            <Button size="sm" variant="default" onClick={() => setBatchOpen(false)}>
              Huỷ
            </Button>
            <Button size="sm" variant="primary" disabled={busy} onClick={runBatch}>
              {busy ? "Đang chạy..." : "Chạy batch codegen"}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

/* ── Tab: Enrich (AI Tier 1) ──────────────────────────────── */

function EnrichTab({
  moduleName,
  summary,
  onChanged,
}: {
  moduleName: string;
  summary: { manifest: unknown; enrichedManifest: unknown } | null;
  onChanged: () => void;
}) {
  const t = useT();
  const [apply, setApply] = useState(false);
  const [maxCost, setMaxCost] = useState("5");
  const [aiLog, setAiLog] = useState<MigrationAiLogEntry[]>([]);
  const [enrichedYaml, setEnrichedYaml] = useState<string | null>(null);
  const [mainYaml, setMainYaml] = useState<string | null>(null);

  const loadDiff = useCallback(async () => {
    const [main, enr] = await Promise.all([
      migration.getModuleYaml(moduleName, "main"),
      migration.getModuleYaml(moduleName, "enriched"),
    ]);
    setMainYaml(main ?? null);
    setEnrichedYaml(enr ?? null);
  }, [moduleName]);

  const loadLog = useCallback(async () => {
    try {
      const r = await migration.aiLog(moduleName);
      setAiLog(r);
    } catch {
      setAiLog([]);
    }
  }, [moduleName]);

  useEffect(() => {
    loadDiff();
    loadLog();
  }, [loadDiff, loadLog]);

  return (
    <div className="space-y-4">
      <JobRunner
        moduleName={moduleName}
        action="enrich"
        envOk={true}
        buildArgs={() => ({ apply, maxCostUsd: parseFloat(maxCost) || 5 })}
        renderForm={() => (
          <>
            <FormField label={t("mig.enrich_apply_label")}>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={apply}
                  onChange={(e) => setApply(e.target.checked)}
                />
                <span>{apply ? t("mig.enrich_overwrite") : t("mig.enrich_dry_run")}</span>
              </label>
            </FormField>
            <FormField label={t("mig.enrich_max_cost")}>
              <Input
                value={maxCost}
                onChange={(e) => setMaxCost(e.target.value)}
                type="number"
                step="0.5"
              />
            </FormField>
          </>
        )}
        canRun={() => true}
        onCompleted={() => {
          loadDiff();
          loadLog();
          onChanged();
        }}
      />

      {/* Dry-run từng proc — list từ manifest */}
      <DryRunProcsPanel
        moduleName={moduleName}
        procs={(summary?.manifest as { procs?: ManifestProcRow[] })?.procs ?? []}
      />

      {/* Diff viewer */}
      {enrichedYaml && mainYaml && <DiffPanel mainYaml={mainYaml} enrichedYaml={enrichedYaml} />}

      {/* AI log — đầy đủ, click row → mở viewer */}
      {aiLog.length > 0 && <AiLogPanel moduleName={moduleName} entries={aiLog} />}
    </div>
  );
}

/* ── Panel dry-run từng proc (Tab Enrich) ─────────────── */

function DryRunProcsPanel({ moduleName, procs }: { moduleName: string; procs: ManifestProcRow[] }) {
  const [filter, setFilter] = useState("");
  const [tierFilter, setTierFilter] = useState<"all" | "B" | "C" | "D">("all");
  const [open, setOpen] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return procs.filter((p) => {
      if (tierFilter !== "all" && p.suggestedTier !== tierFilter) return false;
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        (p.targetProcName?.toLowerCase().includes(q) ?? false) ||
        (p.label?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [procs, filter, tierFilter]);

  const toggle = (name: string) => {
    const next = new Set(expanded);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    setExpanded(next);
  };

  if (procs.length === 0) return null;

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-1 font-medium hover:text-accent"
        >
          {open ? <I.ChevronDown size={14} /> : <I.ChevronRight size={14} />}
          Dry-run AI từng proc ({procs.length})
        </button>
        {open && (
          <div className="flex gap-1">
            {(["all", "B", "C", "D"] as const).map((tf) => (
              <button
                key={tf}
                type="button"
                onClick={() => setTierFilter(tf)}
                className={[
                  "px-2 h-6 text-xs border rounded",
                  tierFilter === tf
                    ? "border-accent text-accent bg-accent/10"
                    : "border-border hover:bg-surface",
                ].join(" ")}
              >
                {tf === "all" ? "Tất cả" : `Tier ${tf}`}
              </button>
            ))}
            <input
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Lọc..."
              className="px-2 h-6 border border-border rounded bg-bg text-xs outline-none focus:border-accent w-32"
            />
          </div>
        )}
      </div>
      {open && (
        <div className="text-[11px] text-muted mb-2">
          Chạy enrich AI riêng cho 1 proc để debug prompt/output trước khi enrich cả module. KHÔNG
          ghi `.enriched.yaml`; chỉ log vào `ai-log/`.
        </div>
      )}
      {open && (
        <div className="border border-border rounded overflow-hidden">
          <ul className="divide-y divide-border max-h-[32rem] overflow-y-auto">
            {filtered.map((p) => {
              const isOpen = expanded.has(p.name);
              return (
                <li key={p.name}>
                  <button
                    type="button"
                    onClick={() => toggle(p.name)}
                    className="w-full text-left px-2 py-1.5 hover:bg-surface flex items-center gap-2 text-xs"
                  >
                    {isOpen ? <I.ChevronDown size={12} /> : <I.ChevronRight size={12} />}
                    <span className="font-mono flex-1 truncate">{p.name}</span>
                    <Chip
                      className="text-[10px]!"
                      variant={
                        p.suggestedTier === "D"
                          ? "warning"
                          : p.suggestedTier === "C"
                            ? "accent"
                            : "default"
                      }
                    >
                      {p.suggestedTier ?? "?"}
                    </Chip>
                    {p.label && (
                      <span className="text-muted truncate max-w-[200px]">{p.label}</span>
                    )}
                  </button>
                  {isOpen && (
                    <div className="px-3 py-2 bg-surface/30 border-t border-border">
                      <DryRunEnrich moduleName={moduleName} procName={p.name} />
                    </div>
                  )}
                </li>
              );
            })}
            {filtered.length === 0 && (
              <li className="px-2 py-4 text-muted text-center text-xs">Không có kết quả</li>
            )}
          </ul>
        </div>
      )}
    </Card>
  );
}

/* ── Diff panel: side-by-side YAML + nút phóng to ─────── */

function DiffPanel({ mainYaml, enrichedYaml }: { mainYaml: string; enrichedYaml: string }) {
  const t = useT();
  const [zoom, setZoom] = useState(false);
  const Content = (
    <div className="grid grid-cols-2 gap-3 text-xs">
      <div className="flex flex-col min-h-0">
        <div className="text-muted mb-1">
          {t("mig.enrich_main_label")} ({mainYaml.split("\n").length} dòng)
        </div>
        <pre
          className={[
            "bg-surface p-2 rounded border border-border overflow-auto",
            zoom ? "flex-1 min-h-0" : "max-h-[28rem]",
          ].join(" ")}
        >
          {mainYaml}
        </pre>
      </div>
      <div className="flex flex-col min-h-0">
        <div className="text-muted mb-1">
          {t("mig.enrich_enriched_label")} ({enrichedYaml.split("\n").length} dòng)
        </div>
        <pre
          className={[
            "bg-surface p-2 rounded border border-border overflow-auto",
            zoom ? "flex-1 min-h-0" : "max-h-[28rem]",
          ].join(" ")}
        >
          {enrichedYaml}
        </pre>
      </div>
    </div>
  );

  return (
    <>
      <Card className="p-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-medium">{t("mig.enrich_diff_title")}</h3>
          <Button
            size="sm"
            variant="default"
            onClick={() => setZoom(true)}
            icon={<I.Eye size={12} />}
          >
            Phóng to
          </Button>
        </div>
        {Content}
      </Card>
      <Modal
        open={zoom}
        onClose={() => setZoom(false)}
        title={t("mig.enrich_diff_title")}
        width={1400}
      >
        <div className="flex flex-col h-[calc(100vh-12rem)]">{Content}</div>
      </Modal>
    </>
  );
}

/* ── AI log panel + entry viewer modal ─────────────────── */

interface AiLogEntryDetail {
  timestamp?: string;
  module?: string;
  phase?: string;
  companyId?: string;
  durationMs?: number;
  tokensIn?: number;
  tokensOut?: number;
  usageReal?: boolean;
  system?: string;
  user?: string;
  output?: unknown;
  /** Khi output=null, error giải thích lý do (no_profile/http_xxx/timeout/...). */
  error?: string;
  /** Raw response từ API (khi parse fail). */
  raw?: string;
}

function AiLogPanel({
  moduleName,
  entries,
}: {
  moduleName: string;
  entries: MigrationAiLogEntry[];
}) {
  const t = useT();
  const [openFile, setOpenFile] = useState<string | null>(null);
  const [detail, setDetail] = useState<AiLogEntryDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState("");

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter(
      (e) => e.phase.toLowerCase().includes(q) || e.file.toLowerCase().includes(q),
    );
  }, [entries, filter]);

  const open = async (file: string) => {
    setOpenFile(file);
    setDetail(null);
    setLoading(true);
    try {
      const r = (await migration.getAiLogEntry(moduleName, file)) as AiLogEntryDetail | null;
      setDetail(r);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between mb-2 gap-2">
        <h3 className="font-medium">{t("mig.ai_log_title", { count: entries.length })}</h3>
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Lọc theo phase..."
          className="px-2 h-7 border border-border rounded bg-bg text-sm outline-none focus:border-accent w-48"
        />
      </div>
      <div className="border border-border rounded overflow-hidden">
        <ul className="max-h-80 overflow-y-auto divide-y divide-border">
          {filtered.length === 0 && (
            <li className="px-2 py-3 text-muted text-center text-xs">Không có entry nào</li>
          )}
          {filtered.map((e) => (
            <li key={e.file}>
              <button
                type="button"
                onClick={() => open(e.file)}
                className="w-full text-left px-2 py-1.5 hover:bg-surface flex items-center gap-2 text-xs"
              >
                <I.File size={12} className="text-muted shrink-0" />
                <span className="font-mono flex-1 truncate">{e.phase}</span>
                <span className="text-muted whitespace-nowrap">{e.timestamp}</span>
                <span className="text-muted whitespace-nowrap">
                  {(e.sizeBytes / 1024).toFixed(1)} KB
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>

      <Modal
        open={openFile != null}
        onClose={() => setOpenFile(null)}
        title={openFile ?? ""}
        width={900}
      >
        {loading && <div className="text-sm text-muted">Đang tải...</div>}
        {!loading && detail && <AiLogEntryView detail={detail} />}
        {!loading && !detail && <div className="text-sm text-danger">Không đọc được entry.</div>}
      </Modal>
    </Card>
  );
}

function AiLogEntryView({ detail }: { detail: AiLogEntryDetail }) {
  return (
    <div className="space-y-3 text-xs">
      <div className="grid grid-cols-2 gap-2 text-[11px]">
        <div>
          <span className="text-muted">Phase:</span> <code>{detail.phase}</code>
        </div>
        <div>
          <span className="text-muted">Time:</span> {detail.timestamp}
        </div>
        <div>
          <span className="text-muted">Duration:</span> {detail.durationMs}ms
        </div>
        <div>
          <span className="text-muted">Tokens:</span> in {detail.tokensIn ?? 0} / out{" "}
          {detail.tokensOut ?? 0}
          {detail.usageReal === false && <span className="text-warning ml-1">(approx)</span>}
        </div>
      </div>

      <details open>
        <summary className="cursor-pointer text-muted">
          System prompt ({(detail.system ?? "").length} chars)
        </summary>
        <pre className="bg-surface p-2 rounded border border-border overflow-auto max-h-64 mt-1 text-[11px]">
          {detail.system ?? ""}
        </pre>
      </details>

      <details open>
        <summary className="cursor-pointer text-muted">
          User prompt ({(detail.user ?? "").length} chars)
        </summary>
        <pre className="bg-surface p-2 rounded border border-border overflow-auto max-h-64 mt-1 text-[11px]">
          {detail.user ?? ""}
        </pre>
      </details>

      {detail.error && (
        <div className="p-2 rounded border border-danger/40 bg-danger/5 space-y-1">
          <div className="text-[11px] font-medium text-danger">LLM call fail</div>
          <div className="text-[11px] text-danger whitespace-pre-wrap break-all">
            {detail.error}
          </div>
          <ErrorHint code={detail.error} />
        </div>
      )}

      <details open>
        <summary className="cursor-pointer text-muted">Output (parsed JSON)</summary>
        <pre className="bg-surface p-2 rounded border border-border overflow-auto max-h-64 mt-1 text-[11px]">
          {detail.output
            ? JSON.stringify(detail.output, null, 2)
            : `(null — ${detail.error ?? "LLM call fail"})`}
        </pre>
      </details>

      {detail.raw && (
        <details>
          <summary className="cursor-pointer text-muted">
            Raw response từ API ({detail.raw.length} chars)
          </summary>
          <pre className="bg-surface p-2 rounded border border-border overflow-auto max-h-64 mt-1 text-[11px]">
            {detail.raw}
          </pre>
        </details>
      )}
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

/* ── Tab Review: trạng thái migration + finalize module ─ */

interface ReviewStatus {
  module: string;
  phase: string;
  tables: Array<{
    name: string;
    entityName?: string;
    kind: "entity" | "enum";
    label?: string;
    enriched: boolean;
    enumMaterialized: boolean;
    enumId: string | null;
  }>;
  procs: Array<{
    name: string;
    targetProcName?: string;
    targetFile?: string;
    tier: string;
    label?: string;
    enriched: boolean;
    codegenApplied: boolean;
    codegenTarget: string | null;
    goldenCaptured: boolean;
  }>;
  stats: {
    tables: { total: number; enriched: number; enumTotal: number; enumMaterialized: number };
    procs: {
      total: number;
      enriched: number;
      codegenApplied: number;
      goldenCaptured: number;
      tierC: number;
    };
  };
}

/* ── Phase Q — Bulk migrate live tables + detect active procs ───
 *
 * Cross-module: gom union reads∪writes của mọi proc active từ TẤT CẢ
 * manifest → liveTables. Bulk ETL trước → codegen sau (mọi bảng trong
 * PG → không sinh code đụng entity chưa tồn tại). */
function BulkMigrateSection({ onChanged }: { onChanged: () => void }) {
  const [liveData, setLiveData] = useState<Awaited<
    ReturnType<typeof migration.getLiveTablesAcrossModules>
  > | null>(null);
  const [detectOpen, setDetectOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);

  const reload = useCallback(() => {
    migration
      .getLiveTablesAcrossModules()
      .then(setLiveData)
      .catch(() => setLiveData(null));
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  if (!liveData) {
    return <Card className="p-3 text-xs text-muted">Đang tải tổng hợp cross-module...</Card>;
  }

  const s = liveData.stats;
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="font-medium">Phase Q — Pre-import live tables</h3>
            <Chip variant="accent" className="text-[10px]!">
              {s.modulesScanned} module
            </Chip>
          </div>
          <div className="text-xs text-muted mt-1">
            Migrate dữ liệu cross-module TRƯỚC khi codegen — đảm bảo mọi entity tồn tại trong PG.
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button
            size="sm"
            variant="default"
            onClick={() => setDetectOpen(true)}
            icon={<I.Activity size={12} />}
          >
            Phân tích proc còn dùng
          </Button>
          <Button
            size="sm"
            variant="primary"
            onClick={() => setBulkOpen(true)}
            icon={<I.Database size={12} />}
            disabled={s.liveTables === 0}
          >
            Migrate live tables ({s.liveTables})
          </Button>
        </div>
      </div>

      <div className="grid md:grid-cols-4 gap-3 mt-3 text-[11px]">
        <div className="p-2 rounded border border-border bg-surface">
          <div className="text-muted">Proc tổng</div>
          <div className="text-lg font-semibold">{s.totalProcs}</div>
          <div className="text-[10px] text-muted">
            <span className="text-success">{s.activeProcs} active</span>
            {s.deadProcs > 0 && <span className="ml-2 text-warning">{s.deadProcs} dead</span>}
            {s.unknownProcs > 0 && (
              <span className="ml-2 text-muted">{s.unknownProcs} chưa detect</span>
            )}
          </div>
        </div>
        <div className="p-2 rounded border border-border bg-surface">
          <div className="text-muted">Bảng tổng</div>
          <div className="text-lg font-semibold">{s.totalTables}</div>
        </div>
        <div className="p-2 rounded border border-success/40 bg-success/5">
          <div className="text-success">Live (active proc đụng)</div>
          <div className="text-lg font-semibold text-success">{s.liveTables}</div>
          <div className="text-[10px] text-muted">{s.migratedTables} đã migrate</div>
        </div>
        <div className="p-2 rounded border border-muted/40 bg-surface">
          <div className="text-muted">Dead (skip ETL)</div>
          <div className="text-lg font-semibold text-muted">{s.deadTables}</div>
        </div>
      </div>

      <Modal
        open={detectOpen}
        onClose={() => setDetectOpen(false)}
        title="Phân tích hoạt động proc MSSQL"
        width={920}
      >
        <DetectActiveProcsDialog
          onClose={() => setDetectOpen(false)}
          onApplied={() => {
            reload();
            onChanged();
          }}
        />
      </Modal>

      <Modal
        open={bulkOpen}
        onClose={() => setBulkOpen(false)}
        title="Bulk migrate live tables"
        width={920}
      >
        <BulkMigrateDialog
          live={liveData.liveTables}
          dead={liveData.deadTables}
          onClose={() => setBulkOpen(false)}
          onApplied={() => {
            reload();
            onChanged();
          }}
        />
      </Modal>
    </Card>
  );
}

function DetectActiveProcsDialog({
  onClose,
  onApplied,
}: {
  onClose: () => void;
  onApplied: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Awaited<
    ReturnType<typeof migration.detectActiveProcs>
  > | null>(null);
  const [err, setErr] = useState("");
  const [activeMap, setActiveMap] = useState<Record<string, boolean>>({});
  const [modules, setModules] = useState<MigrationModuleSummary[]>([]);
  const [applyMsg, setApplyMsg] = useState("");

  useEffect(() => {
    migration
      .listModules()
      .then(setModules)
      .catch(() => setModules([]));
  }, []);

  const run = async () => {
    setBusy(true);
    setErr("");
    setResult(null);
    try {
      const r = await migration.detectActiveProcs();
      setResult(r);
      // Default: proc xuất hiện trong stats = active=true.
      // (User có thể uncheck để mark dead.)
      const map: Record<string, boolean> = {};
      for (const p of r.procs) map[p.fullName.toLowerCase()] = true;
      setActiveMap(map);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // Phải nhóm proc theo module: 1 proc có thể xuất hiện ở nhiều manifest.
  // Lấy union — apply ghi vào TẤT CẢ manifest có proc đó.
  const applyAll = async () => {
    if (!result) return;
    setBusy(true);
    setErr("");
    setApplyMsg("");
    try {
      let totalUpdated = 0;
      // Lặp qua module, fetch manifest, match proc, gọi markProcActivity.
      for (const m of modules) {
        // Đọc manifest module để biết proc nào trong nó cần mark.
        const mod = await migration.getModule(m.name);
        const procs = (mod?.manifest as { procs?: Array<{ name: string }> } | null)?.procs ?? [];
        if (procs.length === 0) continue;
        // Build marks: nếu proc trong manifest → match với detect result, mark active theo activeMap.
        const marks = procs
          .map((p) => {
            const detected = result.procs.find(
              (d) => d.fullName.toLowerCase() === p.name.toLowerCase(),
            );
            if (detected) {
              return {
                procName: p.name,
                active: activeMap[detected.fullName.toLowerCase()] ?? true,
                lastExecAt: detected.lastExecAt,
                execCount: detected.execCount,
              };
            }
            // Proc trong manifest nhưng KHÔNG có trong stats → mark active=false
            // (chưa gọi kể từ MSSQL restart). User có thể override sau.
            return {
              procName: p.name,
              active: false,
              lastExecAt: null,
              execCount: 0,
            };
          })
          .filter((mk) => mk.procName);
        if (marks.length === 0) continue;
        const r = await migration.markProcActivity({
          module: m.name,
          readAt: result.readAt,
          marks,
        });
        totalUpdated += r.updated;
      }
      setApplyMsg(`Đã ghi cờ active cho ${totalUpdated} proc thuộc ${modules.length} module.`);
      onApplied();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3 text-xs">
      {!result && (
        <>
          <div className="text-muted">
            Đọc <code className="font-mono">sys.dm_exec_procedure_stats</code> từ MSSQL → liệt kê
            proc đã được gọi kể từ lần MSSQL restart gần nhất. Caveat: proc CHƯA gọi (hoặc plan
            cache bị evict) sẽ không xuất hiện — coi như <em>có thể dead</em>, mark active=false.
            User có thể override sau qua YAML.
          </div>
          <Button
            variant="primary"
            disabled={busy}
            onClick={run}
            icon={busy ? <I.Loader size={12} /> : <I.Activity size={12} />}
          >
            {busy ? "Đang query MSSQL..." : "Chạy phân tích"}
          </Button>
        </>
      )}
      {err && <div className="text-danger whitespace-pre-wrap">{err}</div>}

      {result && (
        <>
          <div className="flex items-center justify-between gap-2 flex-wrap text-muted">
            <span>
              Tổng {result.total} proc đã ghi trong plan cache. Đọc lúc {fmtTime(result.readAt)}
            </span>
            <Button
              size="sm"
              variant="default"
              onClick={run}
              disabled={busy}
              icon={<I.Redo size={11} />}
            >
              Chạy lại
            </Button>
          </div>
          <div className="border border-border rounded overflow-hidden max-h-[400px] overflow-y-auto">
            <table className="w-full text-[11px]">
              <thead className="bg-surface text-muted sticky top-0">
                <tr>
                  <th className="text-center px-2 py-1.5 w-10">Active</th>
                  <th className="text-left px-2 py-1.5">Proc</th>
                  <th className="text-right px-2 py-1.5 w-20">Calls</th>
                  <th className="text-left px-2 py-1.5 w-44">Last call</th>
                  <th className="text-center px-2 py-1.5 w-24">Manifest</th>
                </tr>
              </thead>
              <tbody>
                {result.procs.map((p) => {
                  const key = p.fullName.toLowerCase();
                  return (
                    <tr key={key} className="border-t border-border">
                      <td className="px-2 py-1 text-center">
                        <input
                          type="checkbox"
                          checked={activeMap[key] ?? true}
                          onChange={(e) => setActiveMap((m) => ({ ...m, [key]: e.target.checked }))}
                        />
                      </td>
                      <td className="px-2 py-1 font-mono">{p.fullName}</td>
                      <td className="px-2 py-1 text-right">
                        {p.execCount.toLocaleString("vi-VN")}
                      </td>
                      <td className="px-2 py-1 text-muted">{fmtTime(p.lastExecAt)}</td>
                      <td className="px-2 py-1 text-center">
                        {p.inManifest ? (
                          <Chip variant="accent" className="text-[9px]!">
                            ✓
                          </Chip>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {result.procs.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-2 py-4 text-muted text-center">
                      Không có proc trong plan cache — có thể MSSQL vừa restart.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {applyMsg && <div className="text-success">{applyMsg}</div>}
          <div className="flex justify-end gap-2 pt-2 border-t border-border">
            <Button variant="default" size="sm" onClick={onClose}>
              Đóng
            </Button>
            <Button variant="primary" size="sm" disabled={busy} onClick={applyAll}>
              {busy ? "Đang ghi manifest..." : "Áp dụng cho tất cả module"}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

function BulkMigrateDialog({
  live,
  dead,
  onClose,
  onApplied,
}: {
  live: Awaited<ReturnType<typeof migration.getLiveTablesAcrossModules>>["liveTables"];
  dead: Awaited<ReturnType<typeof migration.getLiveTablesAcrossModules>>["deadTables"];
  onClose: () => void;
  onApplied: () => void;
}) {
  // Default chọn tất cả live tables ngoại trừ enum (enum dùng materializeEnum).
  const [selected, setSelected] = useState<Record<string, boolean>>(() => {
    const m: Record<string, boolean> = {};
    for (const t of live) if (t.kind === "entity") m[t.name] = true;
    return m;
  });
  const [showDead, setShowDead] = useState(false);
  const [limit, setLimit] = useState(10_000);
  const [dryRun, setDryRun] = useState(true);
  const [force, setForce] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Awaited<
    ReturnType<typeof migration.bulkMigrateLiveTables>
  > | null>(null);
  const [err, setErr] = useState("");

  const selectedCount = Object.values(selected).filter(Boolean).length;
  const allLive = live.filter((t) => t.kind === "entity");
  const allSelected = selectedCount === allLive.length && allLive.length > 0;
  const toggleAll = () => {
    if (allSelected) {
      setSelected({});
    } else {
      const m: Record<string, boolean> = {};
      for (const t of allLive) m[t.name] = true;
      setSelected(m);
    }
  };

  const run = async () => {
    setBusy(true);
    setErr("");
    setResult(null);
    try {
      const tableNames = Object.entries(selected)
        .filter(([, v]) => v)
        .map(([k]) => k);
      if (tableNames.length === 0) {
        setErr("Chưa chọn bảng nào.");
        return;
      }
      const r = await migration.bulkMigrateLiveTables({
        tableNames,
        limitPerTable: limit,
        dryRun,
        force,
      });
      setResult(r);
      if (!dryRun) onApplied();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3 text-xs">
      <div className="text-muted">
        Chọn bảng → ETL từ MSSQL → upsert vào <code>entity_records</code> PG. Mặc định
        <strong> dry-run</strong> để xem trước số row sẽ ghi.
      </div>

      <div className="flex items-center gap-3 flex-wrap p-2 rounded bg-surface border border-border">
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={dryRun} onChange={(e) => setDryRun(e.target.checked)} />
          <span>Dry-run (không ghi DB)</span>
        </label>
        <label className="flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={force}
            disabled={dryRun}
            onChange={(e) => setForce(e.target.checked)}
          />
          <span>Force xoá rec cũ + import lại</span>
        </label>
        <label className="flex items-center gap-1.5">
          <span>Limit/bảng:</span>
          <input
            type="number"
            min={1}
            max={100_000}
            value={limit}
            onChange={(e) =>
              setLimit(Math.max(1, Math.min(100_000, Number.parseInt(e.target.value, 10) || 1)))
            }
            className="w-24 px-1 py-0.5 border border-border rounded bg-bg"
          />
        </label>
        <label className="flex items-center gap-1.5 ml-auto">
          <input
            type="checkbox"
            checked={showDead}
            onChange={(e) => setShowDead(e.target.checked)}
          />
          <span>Hiện cả bảng dead ({dead.length})</span>
        </label>
      </div>

      <div className="flex items-center gap-2 text-[11px]">
        <button
          type="button"
          onClick={toggleAll}
          className="px-2 h-6 border border-border rounded hover:bg-surface"
        >
          {allSelected ? "Bỏ chọn tất cả" : `Chọn tất cả live entity (${allLive.length})`}
        </button>
        <span className="text-muted">Đã chọn: {selectedCount}</span>
      </div>

      <div className="border border-border rounded overflow-hidden max-h-[300px] overflow-y-auto">
        <table className="w-full text-[11px]">
          <thead className="bg-surface text-muted sticky top-0">
            <tr>
              <th className="w-8" />
              <th className="text-left px-2 py-1.5">Bảng MSSQL</th>
              <th className="text-left px-2 py-1.5">Entity</th>
              <th className="text-left px-2 py-1.5">Module</th>
              <th className="text-left px-2 py-1.5">Kind</th>
              <th className="text-left px-2 py-1.5">Migrated</th>
              <th className="text-left px-2 py-1.5">Touched by</th>
            </tr>
          </thead>
          <tbody>
            {[
              ...live.map((t) => ({ ...t, _alive: true })),
              ...(showDead ? dead.map((t) => ({ ...t, _alive: false })) : []),
            ].map((t) => {
              const disabled = t.kind === "enum" || !t._alive;
              return (
                <tr
                  key={t.name + (t._alive ? ":live" : ":dead")}
                  className={[
                    "border-t border-border",
                    !t._alive ? "opacity-50" : "",
                    t.kind === "enum" ? "opacity-60" : "",
                  ].join(" ")}
                >
                  <td className="px-2 py-1 text-center">
                    <input
                      type="checkbox"
                      checked={selected[t.name] ?? false}
                      disabled={disabled}
                      onChange={(e) => setSelected((s) => ({ ...s, [t.name]: e.target.checked }))}
                    />
                  </td>
                  <td className="px-2 py-1 font-mono">{t.name}</td>
                  <td className="px-2 py-1 text-accent">{t.entityName ?? "—"}</td>
                  <td className="px-2 py-1 text-muted">{t.module}</td>
                  <td className="px-2 py-1">
                    <Chip
                      variant={t.kind === "enum" ? "accent" : "default"}
                      className="text-[9px]!"
                    >
                      {t.kind}
                    </Chip>
                  </td>
                  <td className="px-2 py-1 text-muted">{fmtTime(t.migratedAt)}</td>
                  <td className="px-2 py-1 text-[10px] text-muted">
                    {t.touchedBy.slice(0, 3).join(", ")}
                    {t.touchedBy.length > 3 && ` +${t.touchedBy.length - 3}`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {err && <div className="text-danger whitespace-pre-wrap">{err}</div>}

      {result && (
        <div
          className={[
            "p-2 rounded border",
            result.failed === 0
              ? "border-success/40 bg-success/5"
              : "border-warning/40 bg-warning/5",
          ].join(" ")}
        >
          <div className="font-medium">
            {result.dryRun ? "Dry-run kết quả" : "Đã migrate"}:{" "}
            <span className="text-success">{result.succeeded} thành công</span>
            {result.failed > 0 && <span className="text-warning ml-2">/ {result.failed} fail</span>}
            {" — "}
            đọc {result.totalRowsRead.toLocaleString("vi-VN")} row, upsert{" "}
            {(result.totalRowsUpserted + (result.totalRowsUpdated ?? 0)).toLocaleString("vi-VN")}{" "}
            row.
          </div>
          {result.truncatedTables && result.truncatedTables.length > 0 && (
            <div className="mt-1 text-warning text-[10px]">
              Cảnh báo: {result.truncatedTables.length} bảng đạt giới hạn limit, có thể thiếu dữ
              liệu: {result.truncatedTables.join(", ")}
            </div>
          )}
          <div className="mt-1 max-h-[150px] overflow-y-auto text-[10px] font-mono">
            {result.results.map((r) => (
              <div
                key={r.tableName}
                className={r.ok ? "text-muted" : "text-warning"}
                title={r.error}
              >
                {r.ok ? "✓" : "✗"} {r.tableName} → {r.entityName ?? "?"} : {r.rowsRead}r /{" "}
                {r.rowsUpserted}↑{r.rowsUpdated ? ` ${r.rowsUpdated}~` : ""}
                {r.truncated ? " [TRUNCATED]" : ""}
                {r.unmappedColumns?.length ? ` [unmapped: ${r.unmappedColumns.join(",")}]` : ""}
                {r.error && ` — ${r.error.slice(0, 80)}`}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex justify-end gap-2 pt-2 border-t border-border">
        <Button variant="default" size="sm" onClick={onClose}>
          Đóng
        </Button>
        <Button variant="primary" size="sm" disabled={busy || selectedCount === 0} onClick={run}>
          {busy
            ? "Đang migrate..."
            : dryRun
              ? `Dry-run (${selectedCount} bảng)`
              : `Apply (${selectedCount} bảng)`}
        </Button>
      </div>
    </div>
  );
}

function ReviewTab({ moduleName, onChanged }: { moduleName: string; onChanged: () => void }) {
  const [data, setData] = useState<ReviewStatus | null>(null);
  const [filter, setFilter] = useState<"all" | "incomplete" | "complete">("all");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  // Phase Q4 — cache codegen readiness per proc.
  const [procReadiness, setProcReadiness] = useState<
    Record<
      string,
      { canCodegen: boolean; active: boolean; missingCount: number; missing: string[] }
    >
  >({});

  const load = useCallback(() => {
    migration
      .getReviewStatus(moduleName)
      .then(setData)
      .catch(() => setData(null));
  }, [moduleName]);

  useEffect(() => {
    load();
  }, [load]);

  // Sau khi data load, fetch readiness cho từng proc — song song.
  useEffect(() => {
    if (!data) return;
    let cancelled = false;
    Promise.all(
      data.procs.map(async (p) => {
        try {
          const r = await migration.getProcMigrationStatus(moduleName, p.name);
          return [
            p.name,
            {
              canCodegen: r.canCodegen,
              active: r.active,
              missingCount: r.missingTables.length,
              missing: r.missingTables.map((m) => m.table),
            },
          ] as const;
        } catch {
          return null;
        }
      }),
    ).then((rows) => {
      if (cancelled) return;
      const map: Record<
        string,
        { canCodegen: boolean; active: boolean; missingCount: number; missing: string[] }
      > = {};
      for (const row of rows) if (row) map[row[0]] = row[1];
      setProcReadiness(map);
    });
    return () => {
      cancelled = true;
    };
  }, [data, moduleName]);

  const finalize = async () => {
    const ok = await dialog.confirm(
      "Kết thúc module — chuyển phase sang 'live'?\n\n" +
        "Hành động:\n" +
        "• Ghi cutoverAt timestamp vào manifest\n" +
        "• Phase = live (proc/file đã port sẵn sàng phục vụ)\n" +
        "• Decision log để rollback nếu cần\n\n" +
        "Bạn vẫn có thể tiếp tục sửa sau (qua các tab khác).",
      { title: "Kết thúc module", confirmText: "Kết thúc" },
    );
    if (!ok) return;
    setBusy(true);
    setErr("");
    try {
      await migration.finalizeModule(moduleName);
      load();
      onChanged();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const unfinalize = async () => {
    const ok = await dialog.confirm("Rollback module về phase 'filled'? Tháo cutoverAt.", {
      title: "Rollback",
      confirmText: "Rollback",
    });
    if (!ok) return;
    setBusy(true);
    try {
      await migration.unfinalizeModule(moduleName);
      load();
      onChanged();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!data) return <div className="text-sm text-muted">Đang tải...</div>;

  const isLive = data.phase === "live";
  const procIncomplete = (p: ReviewStatus["procs"][number]) =>
    p.tier !== "C" && (!p.enriched || !p.codegenApplied || !p.goldenCaptured);
  const tableIncomplete = (t: ReviewStatus["tables"][number]) =>
    !t.enriched || (t.kind === "enum" && !t.enumMaterialized);

  const filteredProcs = data.procs.filter((p) => {
    if (filter === "all") return true;
    const incomplete = procIncomplete(p);
    return filter === "incomplete" ? incomplete : !incomplete;
  });
  const filteredTables = data.tables.filter((t) => {
    if (filter === "all") return true;
    const incomplete = tableIncomplete(t);
    return filter === "incomplete" ? incomplete : !incomplete;
  });

  const procReady =
    data.stats.procs.total === 0
      ? 0
      : ((data.stats.procs.enriched +
          data.stats.procs.codegenApplied +
          data.stats.procs.goldenCaptured) /
          (data.stats.procs.total * 3)) *
        100;

  return (
    <div className="space-y-4">
      <BulkMigrateSection onChanged={load} />

      <Card className="p-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-medium">Trạng thái module</h3>
              <Chip variant={isLive ? "success" : data.phase === "filled" ? "warning" : "default"}>
                {data.phase}
              </Chip>
            </div>
            <div className="text-xs text-muted mt-1">
              Tổng quan tiến độ migration. Sửa qua các tab khác (Discover/Enrich/...) rồi quay lại
              đây review.
            </div>
          </div>
          {isLive ? (
            <Button
              variant="default"
              size="sm"
              disabled={busy}
              onClick={unfinalize}
              icon={<I.Undo size={12} />}
            >
              Rollback live
            </Button>
          ) : (
            <Button
              variant="primary"
              size="sm"
              disabled={busy}
              onClick={finalize}
              icon={<I.Check size={12} />}
            >
              Kết thúc module
            </Button>
          )}
        </div>
        {err && <div className="text-danger text-xs mt-2">{err}</div>}
      </Card>

      <div className="grid md:grid-cols-2 gap-3">
        <Card className="p-3">
          <div className="font-medium text-sm mb-2">Bảng ({data.stats.tables.total})</div>
          <ProgressBar
            value={data.stats.tables.enriched}
            max={data.stats.tables.total}
            label="Enriched"
          />
          {data.stats.tables.enumTotal > 0 && (
            <ProgressBar
              value={data.stats.tables.enumMaterialized}
              max={data.stats.tables.enumTotal}
              label={`Enum sinh hệ thống (${data.stats.tables.enumTotal} enum)`}
            />
          )}
        </Card>
        <Card className="p-3">
          <div className="font-medium text-sm mb-2">
            Procedure ({data.stats.procs.total})
            {data.stats.procs.tierC > 0 && (
              <span className="text-xs text-muted ml-2">
                {data.stats.procs.tierC} tier C (workflow — skip codegen)
              </span>
            )}
          </div>
          <ProgressBar
            value={data.stats.procs.enriched}
            max={data.stats.procs.total}
            label="Enriched"
          />
          <ProgressBar
            value={data.stats.procs.codegenApplied}
            max={data.stats.procs.total - data.stats.procs.tierC}
            label="Codegen applied"
          />
          <ProgressBar
            value={data.stats.procs.goldenCaptured}
            max={data.stats.procs.total - data.stats.procs.tierC}
            label="Golden captured"
          />
          <div className="text-[11px] text-muted mt-2">
            Tổng độ sẵn sàng (B+D): {procReady.toFixed(0)}%
          </div>
        </Card>
      </div>

      <div className="flex items-center gap-2 text-xs">
        <span className="text-muted">Lọc:</span>
        {(["all", "incomplete", "complete"] as const).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={[
              "px-2 h-6 border rounded",
              filter === f
                ? "border-accent text-accent bg-accent/10"
                : "border-border hover:bg-surface",
            ].join(" ")}
          >
            {f === "all" ? "Tất cả" : f === "incomplete" ? "Chưa xong" : "Đã xong"}
          </button>
        ))}
      </div>

      <Card className="p-4">
        <div className="font-medium mb-2">Bảng ({filteredTables.length})</div>
        <div className="border border-border rounded overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-surface text-muted">
              <tr>
                <th className="text-left px-2 py-1.5">MSSQL</th>
                <th className="text-left px-2 py-1.5">Entity / Enum</th>
                <th className="text-left px-2 py-1.5">Kind</th>
                <th className="text-center px-2 py-1.5">Enriched</th>
                <th className="text-center px-2 py-1.5">Enum sinh</th>
              </tr>
            </thead>
            <tbody>
              {filteredTables.map((t) => (
                <tr key={t.name} className="border-t border-border">
                  <td className="px-2 py-1 font-mono">{t.name}</td>
                  <td className="px-2 py-1 text-accent">{t.entityName ?? "—"}</td>
                  <td className="px-2 py-1">
                    <Chip
                      variant={t.kind === "enum" ? "accent" : "default"}
                      className="text-[9px]!"
                    >
                      {t.kind}
                    </Chip>
                  </td>
                  <td className="px-2 py-1 text-center">
                    {t.enriched ? (
                      <I.Check size={12} className="inline text-success" />
                    ) : (
                      <I.X size={12} className="inline text-muted" />
                    )}
                  </td>
                  <td className="px-2 py-1 text-center">
                    {t.kind === "enum" ? (
                      t.enumMaterialized ? (
                        <a href={`/settings/enums/${t.enumId}`} title="Đã sinh enum — bấm để xem">
                          <I.Check size={12} className="inline text-success" />
                        </a>
                      ) : (
                        <I.X size={12} className="inline text-muted" />
                      )
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                </tr>
              ))}
              {filteredTables.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-2 py-4 text-muted text-center">
                    Không có bảng
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="p-4">
        <div className="font-medium mb-2">Procedure ({filteredProcs.length})</div>
        <div className="border border-border rounded overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-surface text-muted">
              <tr>
                <th className="text-left px-2 py-1.5">MSSQL proc</th>
                <th className="text-left px-2 py-1.5">Target</th>
                <th className="text-left px-2 py-1.5">Tier</th>
                <th
                  className="text-center px-2 py-1.5"
                  title="Phase Q4 — bảng phụ thuộc đã migrate chưa"
                >
                  Sẵn sàng
                </th>
                <th className="text-center px-2 py-1.5">Enriched</th>
                <th className="text-center px-2 py-1.5">Codegen</th>
                <th className="text-center px-2 py-1.5">Golden</th>
              </tr>
            </thead>
            <tbody>
              {filteredProcs.map((p) => (
                <tr key={p.name} className="border-t border-border">
                  <td className="px-2 py-1 font-mono">{p.name}</td>
                  <td className="px-2 py-1 text-accent text-[11px]">
                    {p.targetProcName ?? p.targetFile ?? "—"}
                  </td>
                  <td className="px-2 py-1">
                    <Chip
                      variant={p.tier === "D" ? "warning" : p.tier === "C" ? "accent" : "default"}
                      className="text-[9px]!"
                    >
                      {p.tier}
                    </Chip>
                  </td>
                  <td className="px-2 py-1 text-center">
                    {(() => {
                      const r = procReadiness[p.name];
                      if (!r) return <span className="text-muted text-[10px]">…</span>;
                      if (!r.active)
                        return (
                          <Chip variant="default" className="text-[9px]!" title="Mark inactive">
                            💤
                          </Chip>
                        );
                      if (r.canCodegen)
                        return (
                          <Chip variant="success" className="text-[9px]!" title="Sẵn sàng codegen">
                            ✓
                          </Chip>
                        );
                      return (
                        <Chip
                          variant="warning"
                          className="text-[9px]!"
                          title={`Chờ ${r.missingCount} bảng: ${r.missing.join(", ")}`}
                        >
                          ⏳ {r.missingCount}
                        </Chip>
                      );
                    })()}
                  </td>
                  <td className="px-2 py-1 text-center">
                    {p.enriched ? (
                      <I.Check size={12} className="inline text-success" />
                    ) : (
                      <I.X size={12} className="inline text-muted" />
                    )}
                  </td>
                  <td className="px-2 py-1 text-center">
                    {p.tier === "C" ? (
                      <span className="text-muted text-[10px]">N/A</span>
                    ) : p.codegenApplied ? (
                      p.tier === "B" && p.codegenTarget ? (
                        <a href={`/procedures/${p.codegenTarget}`}>
                          <I.Check size={12} className="inline text-success" />
                        </a>
                      ) : (
                        <span title={p.codegenTarget ?? ""}>
                          <I.Check size={12} className="inline text-success" />
                        </span>
                      )
                    ) : (
                      <I.X size={12} className="inline text-muted" />
                    )}
                  </td>
                  <td className="px-2 py-1 text-center">
                    {p.tier === "C" ? (
                      <span className="text-muted text-[10px]">N/A</span>
                    ) : p.goldenCaptured ? (
                      <I.Check size={12} className="inline text-success" />
                    ) : (
                      <I.X size={12} className="inline text-muted" />
                    )}
                  </td>
                </tr>
              ))}
              {filteredProcs.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-2 py-4 text-muted text-center">
                    Không có proc
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function ProgressBar({ value, max, label }: { value: number; max: number; label: string }) {
  const pct = max === 0 ? 0 : Math.round((value / max) * 100);
  return (
    <div className="mb-2">
      <div className="flex justify-between text-[11px] text-muted">
        <span>{label}</span>
        <span>
          {value}/{max} ({pct}%)
        </span>
      </div>
      <div className="h-2 bg-border rounded overflow-hidden">
        <div
          className="h-full bg-accent transition-all"
          style={{ width: `${Math.min(100, pct)}%` }}
        />
      </div>
    </div>
  );
}

/* URL search params persist module + activeTab — đóng browser/share link OK.
 * Validate kiểu tránh nhiễm garbage từ URL. */
/* ── Tab Audit Tier 4: AI sinh checklist hoàn thiện module ─ */

interface AuditDryRunResult {
  markdown: string;
  error?: string;
  tokensIn: number;
  tokensOut: number;
  durationMs: number;
}

function AuditTab({ moduleName }: { moduleName: string }) {
  const draftKey = `migration:draft:audit:${moduleName}`;
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<AuditDryRunResult | null>(null);
  const [editedMd, setEditedMd] = useState(() => {
    if (typeof window === "undefined") return "";
    try {
      const raw = window.localStorage.getItem(draftKey);
      return raw ? ((JSON.parse(raw) as { md?: string }).md ?? "") : "";
    } catch {
      return "";
    }
  });
  const [savedFile, setSavedFile] = useState<{
    filePath: string;
    markdown: string;
    updatedAt: string;
  } | null>(null);
  const [saveMsg, setSaveMsg] = useState("");
  const [err, setErr] = useState("");

  // Load file đã save trước (nếu có).
  // biome-ignore lint/correctness/useExhaustiveDependencies: chỉ load 1 lần khi mount module, editedMd đọc giá trị hiện tại là đủ
  useEffect(() => {
    migration
      .getAuditReport(moduleName)
      .then((r) => {
        if (r) {
          setSavedFile(r);
          if (!editedMd) setEditedMd(r.markdown);
        }
      })
      .catch(() => undefined);
  }, [moduleName]);

  // Auto-save draft.
  useEffect(() => {
    if (!editedMd) {
      window.localStorage.removeItem(draftKey);
      return;
    }
    window.localStorage.setItem(draftKey, JSON.stringify({ md: editedMd }));
  }, [editedMd, draftKey]);

  const runAudit = async () => {
    setBusy(true);
    setErr("");
    setSaveMsg("");
    try {
      const r = await migration.auditModuleDryRun(moduleName);
      setResult(r);
      if (r.markdown) setEditedMd(r.markdown);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!editedMd.trim()) return;
    setBusy(true);
    setSaveMsg("");
    setErr("");
    try {
      const r = await migration.saveAuditReport(moduleName, editedMd);
      setSaveMsg(`✓ Đã lưu ${r.length} ký tự vào ${r.filePath}`);
      // Reload savedFile.
      const reloaded = await migration.getAuditReport(moduleName);
      if (reloaded) setSavedFile(reloaded);
      // Clear draft sau save (đã commit).
      window.localStorage.removeItem(draftKey);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <Card className="p-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h3 className="font-medium">AI audit module — Tier 4</h3>
            <div className="text-xs text-muted mt-1">
              AI đọc manifest + procedures + plugin code + golden stats → sinh checklist các điểm
              cần hoàn thiện trước cutover (validate, RBAC, performance, workflow).
            </div>
          </div>
          <Button
            variant="primary"
            disabled={busy}
            onClick={runAudit}
            icon={busy ? <I.Loader size={12} /> : <I.Wand size={12} />}
          >
            {busy ? "AI đang phân tích..." : result ? "Chạy lại audit" : "Chạy AI audit"}
          </Button>
        </div>
        {err && (
          <div className="p-2 rounded border border-danger/40 bg-danger/5 text-xs mt-2">
            <div className="text-danger font-medium">Lỗi: {err}</div>
            <ErrorHint code={err} />
          </div>
        )}
        {result && (
          <div className="flex gap-3 text-[11px] text-muted mt-2 flex-wrap">
            <Chip className="text-[10px]!">{result.markdown.length} chars</Chip>
            <span>tokens in: {result.tokensIn}</span>
            <span>out: {result.tokensOut}</span>
            <span>{(result.durationMs / 1000).toFixed(1)}s</span>
            {result.error && <span className="text-warning">{result.error}</span>}
          </div>
        )}
        {savedFile && !result && (
          <div className="text-[11px] text-muted mt-2">
            File hiện có: <code>{savedFile.filePath}</code> · cập nhật{" "}
            {new Date(savedFile.updatedAt).toLocaleString("vi-VN")}
          </div>
        )}
      </Card>

      {editedMd && (
        <Card className="p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="font-medium">Audit report (Markdown — có thể sửa)</div>
            <div className="flex gap-2">
              <span className="text-[11px] text-muted self-center">
                {editedMd.length} chars · {editedMd.split("\n").length} dòng
              </span>
              <Button
                size="sm"
                variant="primary"
                disabled={busy || !editedMd.trim()}
                onClick={save}
                icon={<I.Save size={12} />}
              >
                Lưu vào file
              </Button>
            </div>
          </div>
          {saveMsg && <div className="text-[11px] text-success mb-2">{saveMsg}</div>}
          <div className="grid md:grid-cols-2 gap-3">
            <div>
              <div className="text-[11px] text-muted mb-1">Source Markdown</div>
              <Textarea
                value={editedMd}
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
                  setEditedMd(e.target.value)
                }
                className="w-full font-mono text-[11px] min-h-[500px] max-h-[700px]"
              />
            </div>
            <div>
              <div className="text-[11px] text-muted mb-1">Preview</div>
              <div className="border border-border rounded p-3 bg-surface/30 overflow-auto min-h-[500px] max-h-[700px] text-xs">
                <MarkdownPreview text={editedMd} />
              </div>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}

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
