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
  type MigrationJobState,
  type MigrationModuleSummary,
  type MssqlConnectionView,
  type MssqlTestResult,
} from "@erp-framework/client";
import { type Role, roleCan } from "@erp-framework/core";
import { createFileRoute } from "@tanstack/react-router";
import {
  Background,
  Controls,
  type Edge,
  MarkerType,
  MiniMap,
  type Node,
  ReactFlow,
  ReactFlowProvider,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { I } from "@/components/Icons";
import { ProceduresTab } from "@/components/migration/ProceduresTab";
import { RelationsTab } from "@/components/migration/RelationsTab";
import { RunAllProcsScreen } from "@/components/migration/RunAllProcsScreen";
import { SqlBlock } from "@/components/SqlHighlight";
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
import { dialog } from "@/lib/dialog";
import { useT } from "@/hooks/useT";
import { useAuth } from "@/stores/auth";

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
  | "audit";

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
];

function fmtTime(d: string | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleString("vi-VN");
}

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
  type ScreenId = "quick-migrate" | "full-jobs" | "migrated-entities" | "run-all-procs";
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

/* ── Tab: Discover (re-run hoặc xem kết quả) ──────────────── */

interface SplitEnumRule {
  discriminatorColumn: string;
  discriminatorValue: string;
  name: string;
  label: string;
  description?: string;
  valueColumn?: string;
  labelColumn?: string;
  extraColumns?: string[];
}
interface ManifestTableRow {
  name: string;
  suggestedEntityName?: string;
  suggestedKind?: "entity" | "enum";
  enumOptions?: string[];
  label?: string;
  description?: string;
  primaryKey?: string[];
  columns?: Array<{
    name: string;
    type: string;
    isNullable?: boolean;
    mapTo?: { field?: string; entityType?: string; label?: string };
  }>;
  inferredRelations?: Array<{
    column: string;
    refTable: string;
    refColumn: string;
    sourceProc?: string;
  }>;
  splitEnums?: SplitEnumRule[];
}
interface ManifestProcRow {
  name: string;
  suggestedTier?: string;
  targetProcName?: string;
  targetFile?: string;
  label?: string;
  description?: string;
  reads?: string[];
  writes?: string[];
  flags?: string[];
  callsProcs?: string[];
}
interface ManifestEdge {
  proc: string;
  externalTable: string;
  kind: "read" | "write";
  suggestedContract?: string;
}

function DiscoverTab({
  moduleName,
  summary,
  envOk,
  connTables,
  onChanged,
}: {
  moduleName: string;
  summary: { manifest: unknown; enrichedManifest: unknown } | null;
  envOk: boolean;
  connTables: string[];
  onChanged: () => void;
}) {
  const t = useT();
  const [seed, setSeed] = useState<string[]>([]);
  const [exclude, setExclude] = useState<string[]>([]);

  const manifest = summary?.manifest as
    | {
        tables?: ManifestTableRow[];
        procs?: ManifestProcRow[];
        crossModuleEdges?: ManifestEdge[];
      }
    | undefined;

  return (
    <div className="space-y-4">
      <JobRunner
        moduleName={moduleName}
        action="discover"
        envOk={envOk}
        buildArgs={() => ({ seedTables: seed, excludeTables: exclude })}
        renderForm={() => (
          <>
            <FormField label={t("mig.discover_seed_label", { count: connTables.length })}>
              <TagBox
                value={seed}
                onChange={setSeed}
                suggestions={connTables}
                placeholder={t("mig.ph_seed_bfs")}
              />
            </FormField>
            <FormField label={t("mig.discover_exclude")}>
              <TagBox
                value={exclude}
                onChange={setExclude}
                suggestions={connTables}
                placeholder={t("mig.ph_exclude_table")}
              />
            </FormField>
          </>
        )}
        canRun={() => seed.length > 0}
        onCompleted={onChanged}
      />

      {/* Full manifest preview — không truncate */}
      {manifest && (
        <>
          <TablesPanel tables={manifest.tables ?? []} moduleName={moduleName} />
          <ProcsPanel procs={manifest.procs ?? []} moduleName={moduleName} />
          <EdgesPanel edges={manifest.crossModuleEdges ?? []} />
        </>
      )}
    </div>
  );
}

/* ── Panel: liệt kê bảng đầy đủ, expand row → load preview ─── */

function TablesPanel({ tables, moduleName }: { tables: ManifestTableRow[]; moduleName: string }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState("");
  const [open, setOpen] = useState(true);
  const [kindFilter, setKindFilter] = useState<"all" | "entity" | "enum">("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [excluding, setExcluding] = useState(false);
  const [excludeResult, setExcludeResult] = useState<string | null>(null);

  const kindCounts = useMemo(() => {
    const c = { entity: 0, enum: 0 };
    for (const t of tables) {
      if (t.suggestedKind === "enum") c.enum++;
      else c.entity++; // mặc định = entity
    }
    return c;
  }, [tables]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return tables.filter((t) => {
      if (kindFilter !== "all") {
        const k = t.suggestedKind ?? "entity";
        if (k !== kindFilter) return false;
      }
      if (!q) return true;
      return (
        t.name.toLowerCase().includes(q) ||
        (t.suggestedEntityName?.toLowerCase().includes(q) ?? false) ||
        (t.label?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [tables, filter, kindFilter]);

  const toggle = (name: string) => {
    const next = new Set(expanded);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    setExpanded(next);
  };

  const toggleSelect = (name: string) => {
    const next = new Set(selected);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    setSelected(next);
  };
  const toggleSelectAll = () => {
    const allFiltered = filtered.map((t) => t.name);
    if (allFiltered.every((n) => selected.has(n))) {
      // Bỏ chọn tất cả filtered.
      const next = new Set(selected);
      for (const n of allFiltered) next.delete(n);
      setSelected(next);
    } else {
      setSelected(new Set([...selected, ...allFiltered]));
    }
  };
  const allFilteredSelected = filtered.length > 0 && filtered.every((t) => selected.has(t.name));

  const excludeSelected = async () => {
    if (selected.size === 0) return;
    const names = [...selected];
    const ok = await dialog.confirm(
      `Loại trừ ${names.length} bảng khỏi module?\n\n` +
        `${names.slice(0, 10).join("\n")}${names.length > 10 ? `\n... +${names.length - 10}` : ""}\n\n` +
        `Hành động:\n` +
        `• Thêm vào discoverParams.excludeTables\n` +
        `• Xoá khỏi tables[] hiện tại\n` +
        `• Dọn inferredRelations FK trỏ tới\n` +
        `• Dọn proc nếu chỉ đụng bảng exclude\n\n` +
        `Tiếp tục?`,
      { title: "Loại trừ bảng", confirmText: "Loại trừ" },
    );
    if (!ok) return;
    setExcluding(true);
    setExcludeResult(null);
    try {
      const r = await migration.addToExclude({ module: moduleName, tableNames: names });
      setExcludeResult(
        `✓ Loại trừ ${r.removedTables.length} bảng, dọn ${r.removedRels} FK, xoá ${r.removedProcs.length} proc orphan.`,
      );
      setSelected(new Set());
      // Reload trang để manifest tươi (parent handle).
      window.location.reload();
    } catch (e) {
      setExcludeResult(`✗ ${(e as Error).message}`);
    } finally {
      setExcluding(false);
    }
  };

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-1 font-medium hover:text-accent"
        >
          {open ? <I.ChevronDown size={14} /> : <I.ChevronRight size={14} />}
          Bảng ({tables.length})
          <span className="text-xs text-muted ml-2">
            Entity={kindCounts.entity} · Enum={kindCounts.enum}
          </span>
        </button>
        {open && (
          <div className="flex items-center gap-1 flex-wrap">
            {selected.size > 0 && (
              <>
                <span className="text-[11px] text-accent mr-1">{selected.size} đã chọn</span>
                <Button
                  size="sm"
                  variant="default"
                  onClick={excludeSelected}
                  disabled={excluding}
                  icon={<I.Trash size={11} />}
                >
                  {excluding ? "Đang xử lý..." : "Loại trừ"}
                </Button>
                <Button size="sm" variant="default" onClick={() => setSelected(new Set())}>
                  Bỏ chọn
                </Button>
                <span className="mx-1 text-muted">|</span>
              </>
            )}
            {(["all", "entity", "enum"] as const).map((kf) => (
              <button
                key={kf}
                type="button"
                onClick={() => setKindFilter(kf)}
                className={[
                  "px-2 h-6 text-xs border rounded",
                  kindFilter === kf
                    ? "border-accent text-accent bg-accent/10"
                    : "border-border hover:bg-surface",
                ].join(" ")}
              >
                {kf === "all" ? "Tất cả" : kf === "entity" ? "Entity" : "Enum"}
              </button>
            ))}
            <input
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Lọc theo tên..."
              className="px-2 h-7 border border-border rounded bg-bg text-sm outline-none focus:border-accent w-32"
            />
          </div>
        )}
      </div>
      {excludeResult && (
        <div
          className={[
            "text-[11px] mb-2",
            excludeResult.startsWith("✓") ? "text-success" : "text-danger",
          ].join(" ")}
        >
          {excludeResult}
        </div>
      )}
      {open && (
        <div className="border border-border rounded overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-surface text-muted">
              <tr>
                <th className="text-left px-2 py-1.5 w-6">
                  <input
                    type="checkbox"
                    checked={allFilteredSelected}
                    onChange={toggleSelectAll}
                    title={
                      allFilteredSelected
                        ? "Bỏ chọn tất cả (lọc hiện tại)"
                        : "Chọn tất cả (lọc hiện tại)"
                    }
                  />
                </th>
                <th className="text-left px-2 py-1.5 w-6"></th>
                <th className="text-left px-2 py-1.5">MSSQL</th>
                <th className="text-left px-2 py-1.5">Kind</th>
                <th className="text-left px-2 py-1.5">Entity / Enum</th>
                <th className="text-left px-2 py-1.5">Label</th>
                <th className="text-right px-2 py-1.5">Cột</th>
                <th className="text-right px-2 py-1.5">PK</th>
                <th className="text-right px-2 py-1.5">FK suy</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((tbl) => {
                const isOpen = expanded.has(tbl.name);
                const kind = tbl.suggestedKind ?? "entity";
                const isSelected = selected.has(tbl.name);
                return (
                  <Fragment key={tbl.name}>
                    <tr
                      className={[
                        "border-t border-border hover:bg-surface",
                        isSelected && "bg-accent/5",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                    >
                      <td className="px-2 py-1" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelect(tbl.name)}
                        />
                      </td>
                      <td className="px-2 py-1 cursor-pointer" onClick={() => toggle(tbl.name)}>
                        {isOpen ? <I.ChevronDown size={12} /> : <I.ChevronRight size={12} />}
                      </td>
                      <td
                        className="px-2 py-1 font-mono cursor-pointer"
                        onClick={() => toggle(tbl.name)}
                      >
                        {tbl.name}
                      </td>
                      <td className="px-2 py-1">
                        <Chip
                          variant={kind === "enum" ? "accent" : "default"}
                          className="text-[10px]!"
                        >
                          {kind}
                        </Chip>
                      </td>
                      <td className="px-2 py-1 text-accent">{tbl.suggestedEntityName ?? "—"}</td>
                      <td className="px-2 py-1">
                        {tbl.label ?? <span className="text-muted">—</span>}
                      </td>
                      <td className="px-2 py-1 text-right">{tbl.columns?.length ?? 0}</td>
                      <td className="px-2 py-1 text-right">{tbl.primaryKey?.length ?? 0}</td>
                      <td className="px-2 py-1 text-right">{tbl.inferredRelations?.length ?? 0}</td>
                    </tr>
                    {isOpen && (
                      <tr className="border-t border-border bg-surface/30">
                        <td colSpan={9} className="px-2 py-2">
                          <TableDetail tbl={tbl} moduleName={moduleName} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-2 py-4 text-muted text-center">
                    Không có kết quả
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function TableDetail({ tbl, moduleName }: { tbl: ManifestTableRow; moduleName: string }) {
  const [samples, setSamples] = useState<unknown[] | null>(null);
  const [visible, setVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const showSamples = async () => {
    if (samples != null) {
      setVisible(true);
      return;
    } // đã có cache → chỉ bật visible
    setLoading(true);
    setErr("");
    try {
      const r = await migration.previewTable(tbl.name, 5);
      setSamples((r as { samples?: unknown[] })?.samples ?? []);
      setVisible(true);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const isEnum = tbl.suggestedKind === "enum";
  return (
    <div className="space-y-2">
      {tbl.description && <div className="text-muted">{tbl.description}</div>}
      {tbl.primaryKey && tbl.primaryKey.length > 0 && (
        <div>
          <span className="text-muted">PK:</span> <code>{tbl.primaryKey.join(", ")}</code>
        </div>
      )}

      {/* Enum options preview + materialize */}
      {isEnum && (
        <div className="p-2 rounded border border-accent/40 bg-accent/5 space-y-2">
          <div className="text-accent font-medium">Enum — KHÔNG sinh entity riêng</div>
          <div className="text-[11px] text-muted">
            Cột FK ở bảng khác trỏ tới bảng này sẽ thành <code>entityType: enum</code> với reference
            qua enumId.
          </div>
          {tbl.enumOptions && tbl.enumOptions.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {tbl.enumOptions.map((opt) => (
                <Chip key={opt} className="text-[10px]!">
                  {opt}
                </Chip>
              ))}
            </div>
          ) : (
            <div className="text-[11px] text-warning">
              Chưa có options — AI cần sample data đủ để extract. Xem 5 sample bên dưới và bổ sung
              tay.
            </div>
          )}
          <MaterializeEnumButton tbl={tbl} moduleName={moduleName} />
        </div>
      )}

      {/* Columns */}
      <div>
        <div className="text-muted mb-1">Cột ({tbl.columns?.length ?? 0})</div>
        <div className="border border-border rounded overflow-hidden">
          <table className="w-full text-[11px]">
            <thead className="bg-bg text-muted">
              <tr>
                <th className="text-left px-2 py-1">MSSQL name</th>
                <th className="text-left px-2 py-1">Type</th>
                <th className="text-left px-2 py-1">Null</th>
                <th className="text-left px-2 py-1">→ Field</th>
                <th className="text-left px-2 py-1">→ Type</th>
                <th className="text-left px-2 py-1">→ Label</th>
              </tr>
            </thead>
            <tbody>
              {(tbl.columns ?? []).map((c) => (
                <tr key={c.name} className="border-t border-border">
                  <td className="px-2 py-0.5 font-mono">{c.name}</td>
                  <td className="px-2 py-0.5">{c.type}</td>
                  <td className="px-2 py-0.5">{c.isNullable ? "Y" : "N"}</td>
                  <td className="px-2 py-0.5 text-accent">{c.mapTo?.field ?? "—"}</td>
                  <td className="px-2 py-0.5">{c.mapTo?.entityType ?? "—"}</td>
                  <td className="px-2 py-0.5">{c.mapTo?.label ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Inferred relations */}
      {tbl.inferredRelations && tbl.inferredRelations.length > 0 && (
        <div>
          <div className="text-muted mb-1">FK suy ra từ JOIN ({tbl.inferredRelations.length})</div>
          <ul className="text-[11px] space-y-0.5">
            {tbl.inferredRelations.map((r, i) => (
              <li key={i}>
                <code>{r.column}</code> →{" "}
                <code>
                  {r.refTable}.{r.refColumn}
                </code>
                {r.sourceProc && <span className="text-muted"> (qua {r.sourceProc})</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Sample data — lazy + toggle hiện/ẩn */}
      <div>
        {visible && samples != null ? (
          <div className="space-y-1">
            <Button
              size="sm"
              variant="default"
              onClick={() => setVisible(false)}
              icon={<I.ChevronUp size={12} />}
            >
              Ẩn sample rows
            </Button>
            <SampleRowsTable rows={samples} />
          </div>
        ) : (
          <Button
            size="sm"
            variant="default"
            onClick={showSamples}
            disabled={loading}
            icon={<I.Eye size={12} />}
          >
            {loading
              ? "Đang tải..."
              : samples != null
                ? `Hiện ${samples.length} sample rows`
                : "Xem 5 sample rows"}
          </Button>
        )}
        {err && <div className="text-danger text-[11px] mt-1">{err}</div>}
      </div>
    </div>
  );
}

function SampleRowsTable({ rows }: { rows: unknown[] }) {
  if (rows.length === 0)
    return <div className="text-muted text-[11px]">Không có dữ liệu sample.</div>;
  const cols = Array.from(new Set(rows.flatMap((r) => Object.keys(r as object))));
  return (
    <div className="border border-border rounded overflow-auto max-h-64">
      <table className="text-[11px]">
        <thead className="bg-bg text-muted sticky top-0">
          <tr>
            {cols.map((c) => (
              <th key={c} className="text-left px-2 py-1 whitespace-nowrap">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-t border-border">
              {cols.map((c) => (
                <td key={c} className="px-2 py-0.5 whitespace-nowrap max-w-[200px] truncate">
                  {fmtCell((row as Record<string, unknown>)[c])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function fmtCell(v: unknown): string {
  if (v == null) return "—";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (v instanceof Date) return v.toISOString();
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

/* ── Nút materialize enum vào hệ thống (bảng `enums`) ─── */

interface MaterializeSingleResult {
  enumId: string;
  enumName: string;
  enumLabel: string;
  valueCount: number;
  valueColumn: string;
  labelColumn: string;
  extraColumns: string[];
  upserted: "created" | "updated";
}
type MaterializeResult =
  | ({ mode: "single" } & MaterializeSingleResult)
  | { mode: "split"; results: MaterializeSingleResult[] };

function MaterializeEnumButton({ tbl, moduleName }: { tbl: ManifestTableRow; moduleName: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="pt-1 border-t border-accent/20">
      <Button
        size="sm"
        variant="primary"
        onClick={() => setOpen(true)}
        icon={<I.Database size={12} />}
      >
        Cấu hình + sinh enum...
      </Button>
      {tbl.splitEnums && tbl.splitEnums.length > 0 && (
        <span className="ml-2 text-[10px] text-accent">
          ⚡ Đang ở chế độ split ({tbl.splitEnums.length} rules)
        </span>
      )}
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={`Sinh enum: ${tbl.name}`}
        width={780}
      >
        <MaterializeEnumDialog tbl={tbl} moduleName={moduleName} onDone={() => setOpen(false)} />
      </Modal>
    </div>
  );
}

function MaterializeEnumDialog({
  tbl,
  moduleName,
  onDone,
}: {
  tbl: ManifestTableRow;
  moduleName: string;
  onDone: () => void;
}) {
  const cols = (tbl.columns ?? []).map((c) => c.name);
  const initialSplits = tbl.splitEnums ?? [];

  const [mode, setMode] = useState<"single" | "split">(
    initialSplits.length > 0 ? "split" : "single",
  );
  // Single mode state.
  const [singleValueCol, setSingleValueCol] = useState<string>(
    tbl.primaryKey?.[0] ?? cols[0] ?? "",
  );
  const [singleLabelCol, setSingleLabelCol] = useState<string>(
    cols.find((c) => /name|ten|label|mo_ta/i.test(c)) ?? singleValueCol,
  );
  const [singleExtra, setSingleExtra] = useState<string[]>([]);
  // Split mode state.
  const [splitRules, setSplitRules] = useState<SplitEnumRule[]>(initialSplits);

  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<MaterializeResult | null>(null);
  const [err, setErr] = useState("");

  // Decision history cho bảng này.
  const [decisions, setDecisions] = useState<
    Array<{ at: string; module: string; action: unknown }>
  >([]);
  useEffect(() => {
    migration
      .decisionsForTable(tbl.name)
      .then((d) => setDecisions(d.slice(-5).reverse()))
      .catch(() => undefined);
  }, [tbl.name]);

  const saveSplitConfig = async (): Promise<void> => {
    await migration.setSplitEnums({
      module: moduleName,
      tableName: tbl.name,
      splitEnums: splitRules,
    });
  };

  const runMaterialize = async () => {
    setBusy(true);
    setErr("");
    setResult(null);
    try {
      if (mode === "split") {
        await saveSplitConfig();
      } else {
        // Đảm bảo manifest không còn splitEnums cũ nếu user chuyển về single.
        if (initialSplits.length > 0) {
          await migration.setSplitEnums({
            module: moduleName,
            tableName: tbl.name,
            splitEnums: [],
          });
        }
      }
      const r = await migration.materializeEnum({
        module: moduleName,
        tableName: tbl.name,
        ...(mode === "single"
          ? {
              valueColumn: singleValueCol || undefined,
              labelColumn: singleLabelCol || undefined,
              extraColumns: singleExtra.length > 0 ? singleExtra : undefined,
            }
          : {}),
      });
      setResult(r);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const addRule = () => {
    setSplitRules([
      ...splitRules,
      {
        discriminatorColumn: cols.find((c) => /loai|type|kind|category/i.test(c)) ?? cols[0] ?? "",
        discriminatorValue: "",
        name: "",
        label: "",
      },
    ]);
  };
  const updateRule = (i: number, patch: Partial<SplitEnumRule>) => {
    setSplitRules(splitRules.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  };
  const removeRule = (i: number) => {
    setSplitRules(splitRules.filter((_, idx) => idx !== i));
  };

  return (
    <div className="space-y-3 text-xs">
      {/* Decision history */}
      {decisions.length > 0 && (
        <Card className="p-2 bg-accent/5 border-accent/30">
          <div className="text-accent font-medium mb-1">
            Quyết định trước đó ({decisions.length})
          </div>
          <ul className="text-[10px] text-muted space-y-0.5">
            {decisions.map((d, i) => (
              <li key={i}>
                <span>{new Date(d.at).toLocaleString("vi-VN")}</span>
                <span className="ml-2">module={d.module}</span>
                <span className="ml-2">action={(d.action as { type?: string })?.type ?? "?"}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* Mode toggle */}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setMode("single")}
          className={[
            "flex-1 px-3 py-2 border rounded text-left",
            mode === "single" ? "border-accent bg-accent/10" : "border-border hover:bg-surface",
          ].join(" ")}
        >
          <div className="font-medium">Single enum</div>
          <div className="text-[10px] text-muted">
            Cả bảng = 1 enum. Phù hợp khi bảng chứa 1 loại lookup.
          </div>
        </button>
        <button
          type="button"
          onClick={() => setMode("split")}
          className={[
            "flex-1 px-3 py-2 border rounded text-left",
            mode === "split" ? "border-accent bg-accent/10" : "border-border hover:bg-surface",
          ].join(" ")}
        >
          <div className="font-medium">Split (N enum)</div>
          <div className="text-[10px] text-muted">
            1 bảng → nhiều enum theo discriminator column. Vd DM_HE_THONG.
          </div>
        </button>
      </div>

      {mode === "single" ? (
        <Card className="p-3 space-y-2">
          <FormField label="Cột làm `value` (snake_case sau khi sanitize)">
            <ColumnSelect cols={cols} value={singleValueCol} onChange={setSingleValueCol} />
          </FormField>
          <FormField label="Cột làm `label` (hiển thị UI)">
            <ColumnSelect cols={cols} value={singleLabelCol} onChange={setSingleLabelCol} />
          </FormField>
          <FormField label="Extra columns → metadata mỗi value">
            <TagBox
              value={singleExtra}
              onChange={setSingleExtra}
              suggestions={cols}
              placeholder="vd HE_SO_GIA, MA_NHOM..."
            />
            <div className="text-[10px] text-muted mt-1">
              Cột thêm sẽ lưu vào values[].(colName). Vd:{" "}
              <code>{`{value:"vip", label:"VIP", HE_SO_GIA:0.8}`}</code>
            </div>
          </FormField>
        </Card>
      ) : (
        <Card className="p-3 space-y-2">
          <div className="flex items-center justify-between">
            <div className="font-medium">Split rules ({splitRules.length})</div>
            <Button size="sm" variant="default" icon={<I.Plus size={12} />} onClick={addRule}>
              Thêm rule
            </Button>
          </div>
          {splitRules.length === 0 && (
            <div className="text-[11px] text-muted">
              Chưa có rule. Bấm "Thêm rule" để tạo 1 enum theo discriminator.
            </div>
          )}
          {splitRules.map((r, i) => (
            <SplitRuleEditor
              key={i}
              rule={r}
              cols={cols}
              onChange={(patch) => updateRule(i, patch)}
              onRemove={() => removeRule(i)}
            />
          ))}
        </Card>
      )}

      {err && <div className="text-danger whitespace-pre-wrap">{err}</div>}

      {/* Result */}
      {result && (
        <Card className="p-3 bg-success/5 border-success/30">
          <div className="font-medium text-success mb-1">
            ✓ Materialize xong — mode {result.mode}
          </div>
          {result.mode === "single" ? (
            <MaterializeResultRow r={result} />
          ) : (
            <ul className="space-y-1">
              {result.results.map((r) => (
                <li key={r.enumId}>
                  <MaterializeResultRow r={r} />
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      <div className="flex justify-end gap-2 pt-2 border-t border-border">
        <Button variant="default" size="sm" onClick={onDone}>
          Đóng
        </Button>
        <Button
          variant="primary"
          size="sm"
          disabled={busy}
          onClick={runMaterialize}
          icon={busy ? <I.Loader size={12} /> : <I.Database size={12} />}
        >
          {busy
            ? "Đang sinh..."
            : `Sinh enum ${mode === "split" ? `(${splitRules.length} rules)` : ""}`}
        </Button>
      </div>
    </div>
  );
}

function MaterializeResultRow({ r }: { r: MaterializeSingleResult }) {
  return (
    <div className="text-[11px] flex items-center gap-2 flex-wrap">
      <Chip variant="success" className="text-[10px]!">
        {r.upserted === "created" ? "✓ Tạo mới" : "↻ Cập nhật"} — {r.valueCount} giá trị
      </Chip>
      <a href={`/settings/enums/${r.enumId}`} className="text-accent hover:underline">
        Mở "{r.enumName}" →
      </a>
      <span className="text-muted">
        value=<code>{r.valueColumn}</code> · label=<code>{r.labelColumn}</code>
        {r.extraColumns.length > 0 && <> · extra=[{r.extraColumns.join(", ")}]</>}
      </span>
    </div>
  );
}

function ColumnSelect({
  cols,
  value,
  onChange,
}: {
  cols: string[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full px-2 h-8 border border-border rounded bg-bg text-sm outline-none focus:border-accent"
    >
      {cols.map((c) => (
        <option key={c} value={c}>
          {c}
        </option>
      ))}
    </select>
  );
}

function SplitRuleEditor({
  rule,
  cols,
  onChange,
  onRemove,
}: {
  rule: SplitEnumRule;
  cols: string[];
  onChange: (patch: Partial<SplitEnumRule>) => void;
  onRemove: () => void;
}) {
  return (
    <div className="border border-border rounded p-2 space-y-1">
      <div className="grid grid-cols-2 gap-2">
        <FormField label="Discriminator column">
          <ColumnSelect
            cols={cols}
            value={rule.discriminatorColumn}
            onChange={(v) => onChange({ discriminatorColumn: v })}
          />
        </FormField>
        <FormField label="Discriminator value">
          <Input
            value={rule.discriminatorValue}
            onChange={(e) => onChange({ discriminatorValue: e.target.value })}
            placeholder="vd TRANG_THAI_DON"
          />
        </FormField>
        <FormField label="Tên enum (snake_case)">
          <Input
            value={rule.name}
            onChange={(e) => onChange({ name: e.target.value })}
            placeholder="vd trang_thai_don"
          />
        </FormField>
        <FormField label="Label tiếng Việt">
          <Input
            value={rule.label}
            onChange={(e) => onChange({ label: e.target.value })}
            placeholder="vd Trạng thái đơn hàng"
          />
        </FormField>
        <FormField label="Value column (optional)">
          <ColumnSelect
            cols={["", ...cols]}
            value={rule.valueColumn ?? ""}
            onChange={(v) => onChange({ valueColumn: v || undefined })}
          />
        </FormField>
        <FormField label="Label column (optional)">
          <ColumnSelect
            cols={["", ...cols]}
            value={rule.labelColumn ?? ""}
            onChange={(v) => onChange({ labelColumn: v || undefined })}
          />
        </FormField>
      </div>
      <FormField label="Extra columns (optional)">
        <TagBox
          value={rule.extraColumns ?? []}
          onChange={(v) => onChange({ extraColumns: v.length > 0 ? v : undefined })}
          suggestions={cols}
          placeholder="vd HE_SO_GIA, MA_NHOM..."
        />
      </FormField>
      <div className="flex justify-end">
        <Button size="sm" variant="default" onClick={onRemove} icon={<I.Trash size={12} />}>
          Xoá rule
        </Button>
      </div>
    </div>
  );
}

/* ── Panel: procs đầy đủ, expand → load body T-SQL ─────── */

function ProcsPanel({ procs, moduleName }: { procs: ManifestProcRow[]; moduleName: string }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState("");
  const [tierFilter, setTierFilter] = useState<"all" | "B" | "C" | "D">("all");
  const [open, setOpen] = useState(true);
  const [helpOpen, setHelpOpen] = useState(false);

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

  const tierCounts = useMemo(() => {
    const c = { B: 0, C: 0, D: 0 };
    for (const p of procs) {
      if (p.suggestedTier === "B" || p.suggestedTier === "C" || p.suggestedTier === "D")
        c[p.suggestedTier]++;
    }
    return c;
  }, [procs]);

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="flex items-center gap-1 font-medium hover:text-accent"
          >
            {open ? <I.ChevronDown size={14} /> : <I.ChevronRight size={14} />}
            Procedure ({procs.length})
            <span className="text-xs text-muted ml-2">
              B={tierCounts.B} · C={tierCounts.C} · D={tierCounts.D}
            </span>
          </button>
          <button
            type="button"
            onClick={() => setHelpOpen((v) => !v)}
            title="Mô tả các tier B/C/D"
            aria-label="Mô tả tier"
            className="ml-1 w-5 h-5 inline-flex items-center justify-center rounded-full border border-border text-muted hover:text-accent hover:border-accent"
          >
            <I.HelpCircle size={11} />
          </button>
        </div>
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
      {helpOpen && <TierHelpPanel onClose={() => setHelpOpen(false)} />}
      {open && (
        <div className="border border-border rounded overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-surface text-muted">
              <tr>
                <th className="text-left px-2 py-1.5 w-6"></th>
                <th className="text-left px-2 py-1.5">MSSQL proc</th>
                <th className="text-left px-2 py-1.5">Tier</th>
                <th className="text-left px-2 py-1.5">Target</th>
                <th className="text-right px-2 py-1.5">Read</th>
                <th className="text-right px-2 py-1.5">Write</th>
                <th className="text-left px-2 py-1.5">Flags</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => {
                const isOpen = expanded.has(p.name);
                return (
                  <Fragment key={p.name}>
                    <tr
                      className="border-t border-border hover:bg-surface cursor-pointer"
                      onClick={() => toggle(p.name)}
                    >
                      <td className="px-2 py-1">
                        {isOpen ? <I.ChevronDown size={12} /> : <I.ChevronRight size={12} />}
                      </td>
                      <td className="px-2 py-1 font-mono">{p.name}</td>
                      <td className="px-2 py-1">
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
                      </td>
                      <td className="px-2 py-1 text-accent text-[11px]">
                        {p.targetProcName ?? (p.targetFile ? "→ plugin" : "—")}
                      </td>
                      <td className="px-2 py-1 text-right">{p.reads?.length ?? 0}</td>
                      <td className="px-2 py-1 text-right">{p.writes?.length ?? 0}</td>
                      <td className="px-2 py-1 text-[10px]">
                        {(p.flags ?? []).slice(0, 3).join(", ")}
                        {(p.flags?.length ?? 0) > 3 && ` +${p.flags!.length - 3}`}
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="border-t border-border bg-surface/30">
                        <td colSpan={7} className="px-2 py-2">
                          <ProcDetail proc={p} moduleName={moduleName} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-2 py-4 text-muted text-center">
                    Không có kết quả
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function TierHelpPanel({ onClose }: { onClose: () => void }) {
  return (
    <div className="mb-2 p-3 rounded border border-accent/30 bg-accent/5 text-xs">
      <div className="flex items-center justify-between mb-2">
        <span className="font-medium text-accent">Phân loại tier — đích dịch chuyển proc</span>
        <button
          type="button"
          onClick={onClose}
          className="text-muted hover:text-text leading-none"
          aria-label="Đóng"
        >
          ×
        </button>
      </div>
      <div className="grid md:grid-cols-3 gap-2">
        <div className="p-2 rounded border border-border bg-bg">
          <div className="flex items-center gap-1 mb-1">
            <Chip className="text-[10px]!">B</Chip>
            <span className="font-medium">Procedure JS (sandbox)</span>
          </div>
          <p className="text-muted leading-snug mb-1">
            Chạy trong isolated-vm (128MB, 5s). Phù hợp CRUD đơn giản, validate, transaction ngắn
            (db.tx).
          </p>
          <ul className="text-[10px] text-muted list-disc ml-4 space-y-0.5">
            <li>API: db.queryRecords / findById</li>
            <li>entity.insert / update / delete</li>
            <li>callTool / callProc / fetch</li>
            <li>
              <b>KHÔNG</b> raw SQL, GROUP BY, JOIN xuyên bảng
            </li>
          </ul>
        </div>
        <div className="p-2 rounded border border-border bg-bg">
          <div className="flex items-center gap-1 mb-1">
            <Chip variant="accent" className="text-[10px]!">
              C
            </Chip>
            <span className="font-medium">Workflow scheduled</span>
          </div>
          <p className="text-muted leading-snug mb-1">
            Proc chạy theo lịch (SQL Agent → cron của framework). Body workflow gọi xuống tier B/D.
          </p>
          <ul className="text-[10px] text-muted list-disc ml-4 space-y-0.5">
            <li>Trigger: scheduled cron</li>
            <li>Vd: kết sổ đêm, tính tồn kho daily</li>
            <li>Pg-boss queue, retry config</li>
          </ul>
        </div>
        <div className="p-2 rounded border border-border bg-bg">
          <div className="flex items-center gap-1 mb-1">
            <Chip variant="warning" className="text-[10px]!">
              D
            </Chip>
            <span className="font-medium">Plugin TS in-process</span>
          </div>
          <p className="text-muted leading-snug mb-1">
            TS thuần, full Drizzle, raw SQL, transaction. Phù hợp proc phức tạp.
          </p>
          <ul className="text-[10px] text-muted list-disc ml-4 space-y-0.5">
            <li>JOIN nhiều bảng, GROUP BY, WINDOW</li>
            <li>CTE, MERGE, CURSOR</li>
            <li>Multi-table transaction có rollback</li>
            <li>Dynamic SQL (sp_executesql)</li>
          </ul>
        </div>
      </div>
      <div className="text-[10px] text-muted mt-2">
        Heuristic ban đầu do parser đoán; AI tier 1 (enrich) sẽ điều chỉnh khi đọc body T-SQL. User
        vẫn có thể override trong manifest YAML.
      </div>
    </div>
  );
}

function ProcDetail({ proc, moduleName }: { proc: ManifestProcRow; moduleName: string }) {
  const [body, setBody] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const showBody = async () => {
    if (body != null) {
      setVisible(true);
      return;
    } // đã có cache
    setLoading(true);
    setErr("");
    try {
      const r = await migration.previewProc(proc.name);
      const text = (r as { proc?: { body?: string } } | null)?.proc?.body ?? "";
      setBody(text || "(không có body)");
      setVisible(true);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-2 text-xs">
      {proc.description && <div className="text-muted">{proc.description}</div>}
      {proc.targetFile && (
        <div>
          <span className="text-muted">Target file:</span> <code>{proc.targetFile}</code>
        </div>
      )}
      {proc.reads && proc.reads.length > 0 && (
        <div>
          <span className="text-muted">Đọc:</span>{" "}
          {proc.reads.map((r) => (
            <code key={r} className="mr-1">
              {r}
            </code>
          ))}
        </div>
      )}
      {proc.writes && proc.writes.length > 0 && (
        <div>
          <span className="text-muted">Ghi:</span>{" "}
          {proc.writes.map((w) => (
            <code key={w} className="mr-1">
              {w}
            </code>
          ))}
        </div>
      )}
      {proc.flags && proc.flags.length > 0 && (
        <div>
          <span className="text-muted">Flags:</span>{" "}
          {proc.flags.map((f) => (
            <Chip key={f} className="ml-1 text-[10px]!">
              {f}
            </Chip>
          ))}
        </div>
      )}
      {proc.callsProcs && proc.callsProcs.length > 0 && (
        <div>
          <span className="text-muted">Gọi:</span>{" "}
          {proc.callsProcs.map((c) => (
            <code key={c} className="mr-1">
              {c}
            </code>
          ))}
        </div>
      )}

      {/* Body T-SQL — lazy + toggle hiện/ẩn */}
      <div>
        {visible && body != null ? (
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="default"
                onClick={() => setVisible(false)}
                icon={<I.ChevronUp size={12} />}
              >
                Ẩn T-SQL
              </Button>
              <span className="text-[10px] text-muted">{body.split("\n").length} dòng</span>
            </div>
            <SqlBlock text={body} className="max-h-96" />
          </div>
        ) : (
          <Button
            size="sm"
            variant="default"
            onClick={showBody}
            disabled={loading}
            icon={<I.Eye size={12} />}
          >
            {loading ? "Đang tải..." : body != null ? "Hiện lại T-SQL" : "Xem body T-SQL"}
          </Button>
        )}
        {err && <div className="text-danger text-[11px] mt-1">{err}</div>}
      </div>

      {/* Dry-run enrich riêng cho proc này */}
      <DryRunEnrich moduleName={moduleName} procName={proc.name} />
      <CodegenProcButton
        moduleName={moduleName}
        procName={proc.name}
        suggestedTier={proc.suggestedTier}
      />
      <SamplesGoldenButton moduleName={moduleName} procName={proc.name} />
    </div>
  );
}

interface DryRunResult {
  procName: string;
  output: unknown | null;
  error?: string;
  raw?: string;
  tokensIn: number;
  tokensOut: number;
  durationMs: number;
}

/** Dry-run enrich cho 1 proc — gọi sync, trả output ngay (không qua queue). */
function DryRunEnrich({ moduleName, procName }: { moduleName: string; procName: string }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<DryRunResult | null>(null);
  const [err, setErr] = useState("");

  const run = async () => {
    setBusy(true);
    setErr("");
    setResult(null);
    try {
      const r = await migration.enrichProcDryRun(moduleName, procName);
      setResult(r);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="border-t border-border pt-2 mt-2">
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="default"
          onClick={run}
          disabled={busy}
          icon={busy ? <I.Loader size={12} /> : <I.Sparkles size={12} />}
        >
          {busy ? "Đang gọi AI..." : result ? "Chạy lại" : "Dry-run AI enrich proc này"}
        </Button>
        {result && (
          <Chip variant={result.output ? "success" : result.error ? "danger" : "warning"}>
            {result.output ? "ok" : result.error ? "fail" : "empty"}
          </Chip>
        )}
        {result?.durationMs != null && (
          <span className="text-[10px] text-muted">{(result.durationMs / 1000).toFixed(1)}s</span>
        )}
      </div>
      {err && <div className="text-danger text-[11px] mt-1">{err}</div>}
      {result && (
        <div className="mt-2 space-y-1 text-[11px]">
          <div className="flex gap-3 text-muted">
            <span>tokens in: {result.tokensIn}</span>
            <span>out: {result.tokensOut}</span>
            <span>{result.durationMs}ms</span>
          </div>
          {result.error && (
            <div className="p-2 rounded border border-danger/40 bg-danger/5">
              <div className="text-danger font-medium">LLM fail: {result.error}</div>
              <ErrorHint code={result.error} />
            </div>
          )}
          <div className="text-muted">AI suggest:</div>
          <pre className="bg-bg p-2 rounded border border-border overflow-auto max-h-64">
            {result.output
              ? JSON.stringify(result.output, null, 2)
              : `(null — ${result.error ?? "LLM fail"})`}
          </pre>
          {result.raw && (
            <details>
              <summary className="cursor-pointer text-muted">
                Raw response ({result.raw.length} chars)
              </summary>
              <pre className="bg-bg p-2 rounded border border-border overflow-auto max-h-48 mt-1">
                {result.raw}
              </pre>
            </details>
          )}
          <div className="text-[10px] text-muted">
            Dry-run KHÔNG ghi enriched.yaml. Để áp dụng cho cả module, chạy tab Enrich với "Apply".
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Panel: cross-module edges ─────────────────────────── */

function EdgesPanel({ edges }: { edges: ManifestEdge[] }) {
  const [open, setOpen] = useState(true);
  if (edges.length === 0) return null;
  return (
    <Card className="p-4">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 font-medium text-warning hover:text-accent mb-2"
      >
        {open ? <I.ChevronDown size={14} /> : <I.ChevronRight size={14} />}
        Cross-module edges ({edges.length})
      </button>
      {open && (
        <>
          <div className="text-xs text-muted mb-2">
            Proc đụng bảng của module khác — cần thiết kế contract (tRPC/event) thay vì JOIN DB.
          </div>
          <div className="border border-border rounded overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-surface text-muted">
                <tr>
                  <th className="text-left px-2 py-1.5">Proc</th>
                  <th className="text-left px-2 py-1.5">Bảng ngoài</th>
                  <th className="text-left px-2 py-1.5">Loại</th>
                  <th className="text-left px-2 py-1.5">Đề xuất contract</th>
                </tr>
              </thead>
              <tbody>
                {edges.map((e, i) => (
                  <tr key={i} className="border-t border-border">
                    <td className="px-2 py-1 font-mono">{e.proc}</td>
                    <td className="px-2 py-1 font-mono">{e.externalTable}</td>
                    <td className="px-2 py-1">
                      <Chip
                        variant={e.kind === "write" ? "warning" : "default"}
                        className="text-[10px]!"
                      >
                        {e.kind}
                      </Chip>
                    </td>
                    <td className="px-2 py-1 text-[11px] text-muted">
                      {e.suggestedContract ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Card>
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

function ErrorHint({ code }: { code: string }) {
  let hint = "";
  if (code.startsWith("no_profile")) {
    hint =
      "→ Vào Settings → LLM, tạo profile kind=chat (vd Anthropic Claude Sonnet) + dán API key.";
  } else if (code.startsWith("no_api_key")) {
    hint =
      "→ Mở profile, dán API key (Anthropic / OpenAI). Hoặc set env ANTHROPIC_API_KEY / OPENAI_API_KEY.";
  } else if (code.startsWith("http_401") || code.startsWith("http_403")) {
    hint =
      "→ API key sai hoặc hết quota / billing chưa setup. Check Anthropic Console / OpenAI Platform.";
  } else if (code.startsWith("http_429")) {
    hint = "→ Rate limit. Chờ vài giây, hoặc giảm tốc độ enrich.";
  } else if (code.startsWith("http_4")) {
    hint =
      "→ Request invalid — check model name trong profile có đúng (vd 'claude-sonnet-4-6' không phải 'claude-4-sonnet').";
  } else if (code.startsWith("http_5")) {
    hint = "→ API server lỗi tạm thời. Thử lại sau.";
  } else if (code.startsWith("timeout")) {
    hint = "→ Prompt quá dài hoặc API chậm. Tăng maxTokens hoặc retry.";
  } else if (code.startsWith("no_json")) {
    hint =
      "→ AI trả text không phải JSON. Có thể model thiếu hiểu prompt — check Raw response bên dưới + sửa prompt/STYLE.md.";
  } else if (code.startsWith("parse_fail")) {
    hint = "→ AI trả JSON malformed. Check Raw để xem AI nói gì.";
  } else if (code.startsWith("fetch_")) {
    hint = "→ Lỗi mạng. Check endpoint trong profile, network connection.";
  }
  if (!hint) return null;
  return <div className="text-[10px] text-muted">{hint}</div>;
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

/* ── JobRunner: nút chạy + poll status + show progress ───── */

function JobRunner({
  moduleName,
  action,
  envOk,
  buildArgs,
  renderForm,
  canRun,
  onCompleted,
}: {
  moduleName: string;
  action: MigrationAction;
  envOk: boolean;
  buildArgs: () => Record<string, unknown>;
  renderForm: () => React.ReactNode;
  canRun: () => boolean;
  onCompleted: () => void;
}) {
  const t = useT();
  const [jobId, setJobId] = useState<string | null>(null);
  const [state, setState] = useState<MigrationJobState | null>(null);
  const [err, setErr] = useState("");

  const isRunning = state?.status === "queued" || state?.status === "running";

  const run = async () => {
    setErr("");
    setState(null);
    try {
      const r = await migration.startJob(action, moduleName, buildArgs());
      setJobId(r.jobId);
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  // Poll status 2s khi có job đang chạy.
  useEffect(() => {
    if (!jobId) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;
    const tick = async () => {
      try {
        const s = await migration.jobStatus(jobId);
        if (cancelled) return;
        setState(s);
        if (s && (s.status === "queued" || s.status === "running")) {
          timer = setTimeout(tick, 2000);
        } else if (s) {
          onCompleted();
        }
      } catch {
        /* ignore */
      }
    };
    tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
    // biome-ignore lint/correctness/useExhaustiveDependencies: onCompleted ổn định ngoài
  }, [jobId]);

  const statusChip = useMemo(() => {
    if (!state) return null;
    const variant: Record<typeof state.status, "default" | "warning" | "success" | "danger"> = {
      queued: "default",
      running: "warning",
      completed: "success",
      failed: "danger",
    };
    return <Chip variant={variant[state.status]}>{state.status}</Chip>;
  }, [state]);

  return (
    <div className="space-y-3">
      {renderForm()}
      <div className="flex items-center gap-2">
        <Button
          variant="primary"
          disabled={!envOk || !canRun() || isRunning}
          onClick={run}
          icon={<I.Play size={14} />}
        >
          {isRunning ? t("mig.job_running") : t("mig.job_run", { action })}
        </Button>
        {statusChip}
        {state?.durationMs != null && (
          <span className="text-xs text-muted">{(state.durationMs / 1000).toFixed(1)}s</span>
        )}
      </div>
      {state?.error && (
        <Card className="p-3 border-danger/30 bg-danger/5">
          <div className="text-xs font-medium text-danger mb-1">{t("common.error")}</div>
          <pre className="text-xs whitespace-pre-wrap">{state.error}</pre>
        </Card>
      )}
      {err && <div className="text-xs text-danger">{err}</div>}
      {!envOk && <div className="text-xs text-warning">{t("mig.no_default_conn_hint")}</div>}
    </div>
  );
}

/* ── Connections panel: CRUD kết nối MSSQL per-company ───── */

/** Collapsible sidebar section — header click ẩn/hiện body, persist localStorage. */
function SidebarSection({
  storageKey,
  title,
  actions,
  children,
  defaultOpen = true,
}: {
  storageKey: string;
  title: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(() => {
    try {
      const v = window.localStorage.getItem(storageKey);
      return v == null ? defaultOpen : v === "1";
    } catch {
      return defaultOpen;
    }
  });
  const toggle = () =>
    setOpen((v) => {
      const next = !v;
      window.localStorage.setItem(storageKey, next ? "1" : "0");
      return next;
    });
  return (
    <div className="border-b border-border">
      <div
        className="flex items-center gap-1 px-3 py-2 bg-surface/50 cursor-pointer select-none"
        onClick={toggle}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === "Enter" && toggle()}
      >
        {open ? (
          <I.ChevronDown size={12} className="shrink-0 text-muted" />
        ) : (
          <I.ChevronRight size={12} className="shrink-0 text-muted" />
        )}
        <span className="flex-1 text-sm font-semibold">{title}</span>
        {actions && (
          <div
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
            className="flex gap-1"
          >
            {actions}
          </div>
        )}
      </div>
      {open && <div className="px-3 pb-3">{children}</div>}
    </div>
  );
}

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

/* ── Phase S — QuickMigrateScreen: full-page 2-pane UI ────────
 *
 * Layout:
 *  - Header: title + connection dropdown + close.
 *  - Left pane (2/5): list bảng MSSQL + filter + checkbox.
 *  - Right pane (3/5): khi có bảng chọn → preview entity/fields + options
 *    + nút "Bắt đầu migrate". Khi chưa chọn → empty state hướng dẫn. */
const QM_CONN_KEY = "erp:qm:connId";
const qmSelKey = (connId: string) => `erp:qm:sel:${connId}`;

function readQmSel(connId: string): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(qmSelKey(connId));
    return raw ? (JSON.parse(raw) as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}

function QuickMigrateScreen({
  onClose,
  onChanged,
}: {
  onClose: () => void;
  onChanged: () => void;
}) {
  const [conns, setConns] = useState<MssqlConnectionView[]>([]);
  const [pickedConnId, setPickedConnId] = useState<string>(() => {
    try {
      return localStorage.getItem(QM_CONN_KEY) ?? "";
    } catch {
      return "";
    }
  });
  const [tables, setTables] = useState<Awaited<ReturnType<typeof migration.listConnectionTables>>>(
    [],
  );
  const [filter, setFilter] = useState("");
  // Khởi tạo selection từ localStorage nếu có connId đã lưu.
  const [selected, setSelected] = useState<Record<string, boolean>>(() =>
    pickedConnId ? readQmSel(pickedConnId) : {},
  );
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  type SyncFilter = "all" | "not-migrated" | "synced" | "incomplete";
  const [syncFilter, setSyncFilter] = useState<SyncFilter>("all");
  // Map mssqlTable (lowercase) → entityName của entity đã migrate cho conn này.
  const [migratedMap, setMigratedMap] = useState<
    Map<string, { name: string; recordCount: number; rowsLastImported: number }>
  >(new Map());
  const [migratedReloadKey, setMigratedReloadKey] = useState(0);
  const reloadMigrated = () => setMigratedReloadKey((k) => k + 1);
  // Snapshot tableNames khi migrate xong để giữ right pane + result hiển thị
  // trong khi left pane đã sẵn sàng chọn bảng mới.
  const [lockedTableNames, setLockedTableNames] = useState<string[] | null>(null);
  // Bảng đang được migrate (gạch + spinner) — user có thể chọn batch mới trong lúc chờ.
  const [pendingTables, setPendingTables] = useState<Set<string>>(new Set());

  // Load connections + validate connId đã lưu; fallback về default nếu không còn.
  useEffect(() => {
    connectionsApi
      .list()
      .then((cs) => {
        setConns(cs);
        const storedValid = pickedConnId && cs.some((c) => c.id === pickedConnId);
        if (!storedValid) {
          const def = cs.find((c) => c.isDefault) ?? cs[0];
          if (def) setPickedConnId(def.id);
        }
      })
      .catch(() => setConns([]));
    // biome-ignore lint/correctness/useExhaustiveDependencies: chỉ load 1 lần
  }, []);

  // Persist connId mỗi khi thay đổi.
  useEffect(() => {
    if (!pickedConnId) return;
    try {
      localStorage.setItem(QM_CONN_KEY, pickedConnId);
    } catch {
      /* quota */
    }
  }, [pickedConnId]);

  // Khi connId thay đổi: restore selection đã lưu cho conn đó.
  const prevConnIdRef = useRef("");
  useEffect(() => {
    if (!pickedConnId || pickedConnId === prevConnIdRef.current) return;
    prevConnIdRef.current = pickedConnId;
    setSelected(readQmSel(pickedConnId));
    setLockedTableNames(null);
    setPendingTables(new Set());
    setSyncFilter("all");
  }, [pickedConnId]);

  // Persist selection mỗi khi thay đổi (debounce không cần vì ghi nhanh).
  useEffect(() => {
    if (!pickedConnId) return;
    try {
      localStorage.setItem(qmSelKey(pickedConnId), JSON.stringify(selected));
    } catch {
      /* quota */
    }
  }, [pickedConnId, selected]);

  // Sau khi migratedMap load/update: bỏ chọn bảng đã migrate khỏi selection.
  useEffect(() => {
    if (migratedMap.size === 0) return;
    setSelected((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const k of Object.keys(next)) {
        if (next[k] && migratedMap.has(k.toLowerCase())) {
          delete next[k];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [migratedMap]);

  // Load tables khi pickedConnId đổi.
  useEffect(() => {
    if (!pickedConnId) {
      setTables([]);
      return;
    }
    setBusy(true);
    setErr("");
    migration
      .listConnectionTables(pickedConnId)
      .then((ts) => setTables(ts))
      .catch((e) => setErr((e as Error).message))
      .finally(() => setBusy(false));
  }, [pickedConnId]);

  // Load migrated entities theo connection để biết bảng nào đã migrate.
  // Reload sau mỗi lần migrate thành công (migratedReloadKey++).
  useEffect(() => {
    if (!pickedConnId) {
      setMigratedMap(new Map());
      return;
    }
    migration
      .listMigratedEntities({ connectionId: pickedConnId })
      .then((rows) => {
        const m = new Map<
          string,
          { name: string; recordCount: number; rowsLastImported: number }
        >();
        for (const r of rows) {
          if (r.mssqlTable)
            m.set(r.mssqlTable.toLowerCase(), {
              name: r.name,
              recordCount: r.recordCount,
              rowsLastImported: r.rowsLastImported,
            });
        }
        setMigratedMap(m);
      })
      .catch(() => setMigratedMap(new Map()));
  }, [pickedConnId, migratedReloadKey]);

  // Helper: 1 bảng đã migrate khi mssqlTable (case-insensitive) có trong migratedMap.
  const isMigrated = (fullName: string) => migratedMap.has(fullName.toLowerCase());
  // Hiện tất cả bảng — bảng đã migrate hiển thị disabled + strikethrough bên dưới.
  // Sắp xếp: row count giảm dần (bảng lớn lên trên), chưa migrate trước.
  const sorted = [...tables].sort((a, b) => {
    const aMig = isMigrated(a.fullName) ? 1 : 0;
    const bMig = isMigrated(b.fullName) ? 1 : 0;
    if (aMig !== bMig) return aMig - bMig;
    return (b.rowCount ?? -1) - (a.rowCount ?? -1);
  });
  const filtered = sorted.filter((t) => {
    if (filter && !t.fullName.toLowerCase().includes(filter.toLowerCase())) return false;
    if (syncFilter === "all") return true;
    const info = migratedMap.get(t.fullName.toLowerCase());
    const mssql = t.rowCount ?? null;
    const pg = info?.recordCount ?? null;
    if (syncFilter === "not-migrated") return !info;
    if (syncFilter === "synced") return info != null && mssql != null && pg != null && pg >= mssql;
    if (syncFilter === "incomplete")
      return info != null && (mssql == null || pg == null || pg < mssql);
    return true;
  });
  // Chỉ tính bảng chưa migrate + chưa pending cho "Chọn tất cả".
  const selectableFiltered = filtered.filter(
    (t) => !isMigrated(t.fullName) && !pendingTables.has(t.fullName),
  );
  const migratedFiltered = filtered.filter(
    (t) => isMigrated(t.fullName) && !pendingTables.has(t.fullName),
  );
  const migratedCount = migratedFiltered.length;
  const pendingCount = filtered.filter((t) => pendingTables.has(t.fullName)).length;
  const selectedNames = Object.keys(selected).filter((k) => selected[k]);
  const selectedCount = selectedNames.length;
  // Khi user chọn bảng mới VÀ không còn batch pending, xoá lock để pane reset.
  useEffect(() => {
    if (lockedTableNames !== null && selectedCount > 0 && pendingTables.size === 0) {
      setLockedTableNames(null);
    }
  }, [selectedCount, lockedTableNames, pendingTables.size]);
  // tableNames thực sự truyền xuống pane: locked snapshot hoặc selection hiện tại.
  const activePaneTableNames = lockedTableNames ?? selectedNames;
  const allSelected =
    selectableFiltered.length > 0 && selectableFiltered.every((t) => selected[t.fullName]);
  const toggleAll = () => {
    const next = { ...selected };
    for (const t of selectableFiltered) next[t.fullName] = !allSelected;
    setSelected(next);
  };
  const selectAllMigrated = () => {
    const next = { ...selected };
    for (const t of migratedFiltered) next[t.fullName] = true;
    setSelected(next);
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="border-b border-border bg-surface/40 px-4 py-2.5 flex items-center gap-3">
        <Button
          size="sm"
          variant="ghost"
          onClick={onClose}
          icon={<I.X size={14} />}
          title="Đóng (về module view)"
        />
        <h2 className="text-base font-semibold flex items-center gap-1.5">
          <I.Wand size={16} className="text-accent" />
          Migrate nhanh
        </h2>
        <span className="text-xs text-muted">
          Chọn bảng MSSQL → ETL vào hệ thống (không cần module)
        </span>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-muted">Connection:</span>
          <select
            value={pickedConnId}
            onChange={(e) => {
              setPickedConnId(e.target.value);
            }}
            className="text-xs h-8 px-2 border border-border rounded bg-bg min-w-[200px]"
          >
            {conns.length === 0 && <option value="">(chưa có)</option>}
            {conns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.database}) {c.isDefault ? "★" : ""}
              </option>
            ))}
          </select>
        </div>
      </div>

      {conns.length === 0 ? (
        <div className="flex-1 flex items-center justify-center p-8">
          <EmptyState
            icon={<I.Server size={32} />}
            title="Chưa có connection MSSQL"
            hint="Thêm 1 connection ở panel 'Kết nối MSSQL' (sidebar trái) trước khi migrate."
          />
        </div>
      ) : (
        <div className="flex-1 grid grid-cols-[2fr_3fr] min-h-0">
          {/* Left pane: tables list */}
          <div className="border-r border-border flex flex-col min-h-0">
            <div className="p-3 border-b border-border bg-surface/30 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <div className="font-medium">
                  Bảng MSSQL ({tables.length})
                  {pendingCount > 0 && (
                    <span className="ml-1.5 text-[10px] text-warning animate-pulse">
                      · {pendingCount} đang migrate
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={toggleAll}
                  disabled={selectableFiltered.length === 0}
                  className="text-accent hover:underline disabled:text-muted disabled:no-underline"
                  title="Chọn bảng chưa migrate"
                >
                  {allSelected ? "Bỏ chọn" : "Chọn mới"} ({selectableFiltered.length})
                </button>
              </div>
              {migratedCount > 0 && (
                <div className="flex items-center justify-between text-[11px] bg-success/8 border border-success/20 rounded px-2 py-1">
                  <span className="text-success font-medium">{migratedCount} bảng đã migrate</span>
                  <button
                    type="button"
                    onClick={selectAllMigrated}
                    className="text-accent hover:underline font-medium"
                    title="Chọn tất cả bảng đã migrate để sync lại"
                  >
                    Sync lại tất cả →
                  </button>
                </div>
              )}
              <Input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Lọc tên bảng..."
                className="h-8 text-xs"
              />
              <div className="flex gap-1 flex-wrap">
                {(
                  [
                    { key: "all", label: "Tất cả" },
                    { key: "not-migrated", label: "Chưa migrate" },
                    { key: "incomplete", label: "Thiếu dòng" },
                    { key: "synced", label: "Đủ dòng" },
                  ] as const
                ).map(({ key, label }) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setSyncFilter(key)}
                    className={[
                      "px-2 h-5 rounded text-[10px] font-medium border transition-colors",
                      syncFilter === key
                        ? key === "incomplete"
                          ? "bg-warning/20 border-warning/40 text-warning"
                          : key === "synced"
                            ? "bg-success/20 border-success/40 text-success"
                            : "bg-accent/20 border-accent/40 text-accent"
                        : "bg-transparent border-border text-muted hover:border-accent/40 hover:text-text",
                    ].join(" ")}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {err && <div className="text-danger text-xs">{err}</div>}
            </div>
            <div className="flex-1 overflow-y-auto">
              {busy && tables.length === 0 ? (
                <div className="text-xs text-muted p-4 text-center">Đang tải...</div>
              ) : filtered.length === 0 ? (
                <div className="text-xs text-muted p-4 text-center">
                  {tables.length === 0 ? "Không có bảng" : "Không match filter"}
                </div>
              ) : (
                <ul>
                  {filtered.map((t) => {
                    const migrated = isMigrated(t.fullName);
                    const pending = pendingTables.has(t.fullName);
                    const checked = pending ? true : (selected[t.fullName] ?? false);
                    const migratedInfo = migrated
                      ? migratedMap.get(t.fullName.toLowerCase())
                      : undefined;
                    const mssqlCount = t.rowCount ?? null;
                    const pgCount = migratedInfo?.recordCount ?? null;
                    // Tỉ lệ PG/MSSQL: null nếu thiếu dữ liệu
                    const ratio =
                      mssqlCount != null && mssqlCount > 0 && pgCount != null
                        ? pgCount / mssqlCount
                        : null;
                    const ratioColor =
                      ratio === null
                        ? "text-muted"
                        : ratio >= 1
                          ? "text-success"
                          : ratio >= 0.9
                            ? "text-warning"
                            : "text-danger";
                    return (
                      <li
                        key={t.fullName}
                        className={[
                          "text-xs border-b border-border last:border-0 transition-colors group/row",
                          migrated
                            ? "bg-success/3"
                            : pending
                              ? "opacity-70 bg-warning/5"
                              : checked
                                ? "bg-accent/10"
                                : "hover:bg-hover/20",
                        ].join(" ")}
                      >
                        <label
                          className={[
                            "flex items-center gap-2 px-3 py-1.5",
                            pending ? "cursor-not-allowed" : "cursor-pointer",
                          ].join(" ")}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={pending}
                            onChange={(e) =>
                              setSelected((s) => ({
                                ...s,
                                [t.fullName]: e.target.checked,
                              }))
                            }
                          />
                          <span
                            className={[
                              "font-mono flex-1 truncate min-w-0",
                              pending ? "text-muted" : migrated ? "text-muted" : "",
                            ].join(" ")}
                            title={t.fullName}
                          >
                            {t.fullName}
                          </span>
                          {pending && (
                            <Chip variant="warning" className="text-[9px]! animate-pulse shrink-0">
                              đang migrate
                            </Chip>
                          )}
                          {migrated && !pending && (
                            <>
                              <span className="text-success text-[10px] shrink-0 font-mono">
                                {migratedInfo?.name}
                              </span>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.preventDefault();
                                  setSelected((s) => ({ ...s, [t.fullName]: true }));
                                }}
                                className="opacity-0 group-hover/row:opacity-100 text-[9px] text-accent hover:underline transition-opacity px-0.5 shrink-0"
                                title="Chọn để re-sync"
                              >
                                re-sync
                              </button>
                            </>
                          )}
                          {/* So sánh số dòng MSSQL vs PG */}
                          {migrated && pgCount !== null ? (
                            <span
                              className={`text-[10px] tabular-nums shrink-0 ${ratioColor}`}
                              title={`MSSQL: ${mssqlCount?.toLocaleString("vi-VN") ?? "?"} / PG: ${pgCount.toLocaleString("vi-VN")}${ratio !== null ? ` (${Math.round(ratio * 100)}%)` : ""}`}
                            >
                              {pgCount.toLocaleString("vi-VN")}
                              <span className="text-muted">
                                /{mssqlCount?.toLocaleString("vi-VN") ?? "?"}
                              </span>
                            </span>
                          ) : (
                            <span className="text-muted text-[10px] tabular-nums shrink-0">
                              {mssqlCount !== null ? mssqlCount.toLocaleString("vi-VN") : "?"}
                            </span>
                          )}
                        </label>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
            <div className="px-3 py-2 border-t border-border bg-surface/40 text-xs flex items-center justify-between">
              <span>
                Đã chọn: <span className="font-semibold text-accent">{selectedCount}</span> bảng
              </span>
              {selectedCount > 0 && (
                <button
                  type="button"
                  onClick={() => setSelected({})}
                  className="text-muted hover:text-danger"
                >
                  Bỏ chọn tất cả
                </button>
              )}
            </div>
          </div>

          {/* Right pane: preview + options + start */}
          <div className="flex flex-col min-h-0 overflow-hidden">
            {selectedCount === 0 && lockedTableNames === null ? (
              <div className="flex-1 flex items-center justify-center p-8">
                <EmptyState
                  icon={<I.Table size={32} />}
                  title="Chọn bảng từ list bên trái"
                  hint="Tích vào checkbox bảng cần migrate. Có thể chọn nhiều bảng cùng lúc — hệ thống sẽ preview entity/fields tự sinh."
                />
              </div>
            ) : (
              <QuickMigratePreviewPane
                connectionId={pickedConnId}
                tableNames={activePaneTableNames}
                migratedTableNames={
                  new Set(activePaneTableNames.filter((n) => migratedMap.has(n.toLowerCase())))
                }
                onDone={() => {
                  setLockedTableNames(null);
                  setSelected({});
                  onChanged();
                }}
                onTablesChanged={() => {
                  reloadMigrated();
                  onChanged();
                }}
                onMigrateStarted={(tNames) => {
                  setPendingTables(new Set(tNames));
                  setLockedTableNames(tNames);
                  setSelected({});
                }}
                onMigrateFailed={(tNames) => {
                  setPendingTables(new Set());
                  // Khôi phục selection để user có thể retry.
                  setSelected(Object.fromEntries(tNames.map((n) => [n, true])));
                  setLockedTableNames(null);
                }}
                onMigrateCompleted={(tNames) => {
                  setPendingTables(new Set());
                  setLockedTableNames(tNames);
                  setSelected({});
                  reloadMigrated();
                  onChanged();
                }}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* Pane preview + options + start — được mount lại khi tableNames đổi
 * (key trên parent) để clear state preview cũ. */
function QuickMigratePreviewPane({
  connectionId,
  tableNames,
  migratedTableNames,
  onDone,
  onTablesChanged,
  onMigrateStarted,
  onMigrateFailed,
  onMigrateCompleted,
}: {
  connectionId: string;
  tableNames: string[];
  /** Tập bảng đã migrate trong selection hiện tại — hiện banner nhắc force/upsert. */
  migratedTableNames: Set<string>;
  onDone: () => void;
  /** Gọi khi entity được tạo/cập nhật trong DB (full-mode job create). */
  onTablesChanged: () => void;
  /** Gọi ngay khi bắt đầu migrate thực (non-dryRun) — parent mark pending. */
  onMigrateStarted: (tableNames: string[]) => void;
  /** Gọi khi migrate thực thất bại — parent restore selection để user retry. */
  onMigrateFailed: (tableNames: string[]) => void;
  /** Gọi sau quick migrate thực (non-dryRun) thành công. */
  onMigrateCompleted: (tableNames: string[]) => void;
}) {
  const [previews, setPreviews] = useState<QuickPreview[]>([]);
  const [limit, setLimit] = useState(10_000);
  const [dryRun, setDryRun] = useState(true);
  const [force, setForce] = useState(false);
  const [writeManifest, setWriteManifest] = useState(true);
  const [fullMode, setFullMode] = useState(true);
  const [batchSize, setBatchSize] = useState(5000);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Awaited<
    ReturnType<typeof migration.quickMigrateTables>
  > | null>(null);
  const [fullJobResult, setFullJobResult] = useState<{ jobId: string } | null>(null);
  const [err, setErr] = useState("");

  // Cache preview theo tableName — persist khi user thêm/bớt bảng, kể cả
  // sau khi user chỉnh sửa entityName/label/fields. Xóa khi connection đổi.
  const previewCacheRef = useRef<Map<string, QuickPreview>>(new Map());
  const prevConnectionIdRef = useRef(connectionId);

  // Stable key — không fire khi parent re-render với cùng selection.
  const tableNamesKey = tableNames.join("\0");

  // Debounce 300ms: chờ user chọn xong mới fetch, tránh bắn batch mỗi lần tick checkbox.
  const [debouncedKey, setDebouncedKey] = useState(tableNamesKey);
  // biome-ignore lint/correctness/useExhaustiveDependencies: debounce intentional
  useEffect(() => {
    const id = setTimeout(() => setDebouncedKey(tableNamesKey), 300);
    return () => clearTimeout(id);
  }, [tableNamesKey]);

  // Load preview: cache → hiện ngay; bảng mới → fetch với concurrency 3.
  // biome-ignore lint/correctness/useExhaustiveDependencies: dùng debouncedKey thay array ref
  useEffect(() => {
    const cache = previewCacheRef.current;
    // Connection đổi → xóa cache tránh hiện data sai server.
    if (connectionId !== prevConnectionIdRef.current) {
      cache.clear();
      prevConnectionIdRef.current = connectionId;
    }

    // tableNames luôn tính từ prop gốc (không phải debouncedKey).
    const names = debouncedKey ? debouncedKey.split("\0") : [];
    const toFetch = names.filter((t) => !cache.has(t));

    setPreviews(
      names.map(
        (t) =>
          cache.get(t) ?? {
            tableName: t,
            entityName: "",
            label: "",
            fields: [],
            loading: true,
          },
      ),
    );
    setResult(null);
    setFullJobResult(null);

    if (toFetch.length === 0) return;

    let cancelled = false;
    let idx = 0;

    const fetchOne = async (t: string) => {
      try {
        const p = await migration.previewQuickTable(connectionId, t, 0);
        if (cancelled) return;
        const pkRawCol = p.info.primaryKey?.[0];
        let pkField: string | undefined;
        if (pkRawCol) {
          const slug = pkRawCol
            .toLowerCase()
            .replace(/[^a-z0-9_]+/g, "_")
            .replace(/^_+|_+$/g, "");
          pkField = p.suggested.fields.find((f) => f.name === slug)?.name ?? slug;
        }
        const preview: QuickPreview = {
          tableName: t,
          entityName: p.suggested.entityName,
          label: p.suggested.label,
          fields: p.suggested.fields,
          pkField,
          loading: false,
        };
        cache.set(t, preview);
        setPreviews((prev) => prev.map((r) => (r.tableName === t ? preview : r)));
      } catch (e) {
        if (cancelled) return;
        const preview: QuickPreview = {
          tableName: t,
          entityName: "",
          label: "",
          fields: [],
          loading: false,
          error: (e as Error).message,
        };
        setPreviews((prev) => prev.map((r) => (r.tableName === t ? preview : r)));
      }
    };

    // Chạy tối đa 3 request song song — tránh spam server khi chọn nhiều bảng.
    const worker = async () => {
      while (true) {
        const i = idx++;
        if (i >= toFetch.length) break;
        await fetchOne(toFetch[i]!);
      }
    };
    const CONCURRENCY = 3;
    Promise.all(Array.from({ length: Math.min(CONCURRENCY, toFetch.length) }, worker));

    return () => {
      cancelled = true;
    };
  }, [connectionId, debouncedKey]);

  const updatePreview = (tableName: string, patch: Partial<QuickPreview>) => {
    setPreviews((ps) =>
      ps.map((p) => {
        if (p.tableName !== tableName) return p;
        const updated = { ...p, ...patch };
        previewCacheRef.current.set(tableName, updated);
        return updated;
      }),
    );
  };
  const updateField = (
    tableName: string,
    fieldIdx: number,
    patch: Partial<{ name: string; label: string; type: string }>,
  ) => {
    setPreviews((ps) =>
      ps.map((p) => {
        if (p.tableName !== tableName) return p;
        const next = [...p.fields];
        const cur = next[fieldIdx];
        if (!cur) return p;
        next[fieldIdx] = { ...cur, ...patch };
        const updated = { ...p, fields: next };
        previewCacheRef.current.set(tableName, updated);
        return updated;
      }),
    );
  };

  const retryPreview = async (tableName: string) => {
    previewCacheRef.current.delete(tableName);
    updatePreview(tableName, { loading: true, error: undefined });
    try {
      const p = await migration.previewQuickTable(connectionId, tableName, 0);
      const pkRawCol = p.info.primaryKey?.[0];
      let pkField: string | undefined;
      if (pkRawCol) {
        const slug = pkRawCol
          .toLowerCase()
          .replace(/[^a-z0-9_]+/g, "_")
          .replace(/^_+|_+$/g, "");
        pkField = p.suggested.fields.find((f) => f.name === slug)?.name ?? slug;
      }
      const preview: QuickPreview = {
        tableName,
        entityName: p.suggested.entityName,
        label: p.suggested.label,
        fields: p.suggested.fields,
        pkField,
        loading: false,
      };
      previewCacheRef.current.set(tableName, preview);
      updatePreview(tableName, preview);
    } catch (e) {
      updatePreview(tableName, { loading: false, error: (e as Error).message });
    }
  };

  const run = async () => {
    setBusy(true);
    setErr("");
    setResult(null);
    setFullJobResult(null);
    const willMigrate = fullMode || !dryRun;
    try {
      const items = previews
        .filter((p) => !p.loading && !p.error && p.entityName && p.fields.length > 0)
        .map((p) => ({
          tableName: p.tableName,
          entityName: p.entityName,
          label: p.label || p.entityName,
          fields: p.fields,
          pkField: p.pkField,
        }));
      if (items.length === 0) {
        setErr("Không có bảng nào hợp lệ để migrate.");
        return;
      }
      // Thông báo parent ngay trước khi gọi API — left pane gạch + user chọn tiếp.
      if (willMigrate) onMigrateStarted(tableNames);
      if (fullMode) {
        const r = await migration.startFullImport({
          connectionId,
          items,
          batchSize,
          writeManifest,
        });
        setFullJobResult(r);
        // Full mode: entity được prep ngay khi job tạo → reload migratedMap.
        onTablesChanged();
      } else {
        const r = await migration.quickMigrateTables({
          connectionId,
          items: items.map((i) => ({ ...i, force })),
          limitPerTable: limit,
          dryRun,
          writeManifest,
        });
        setResult(r);
        if (!dryRun) {
          onMigrateCompleted(tableNames);
        }
      }
    } catch (e) {
      setErr((e as Error).message);
      if (willMigrate) onMigrateFailed(tableNames);
    } finally {
      setBusy(false);
    }
  };

  const allReady = previews.every((p) => !p.loading);

  return (
    <>
      {/* Preview cards */}
      <div className="flex-1 overflow-y-auto p-4 space-y-2 min-h-0">
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs font-medium text-muted">{tableNames.length} bảng được chọn</span>
          {!allReady && (
            <span className="text-[10px] text-muted animate-pulse">Đang tải preview...</span>
          )}
        </div>

        {previews.map((p, cardIdx) => (
          <details
            key={p.tableName}
            className="border border-border rounded bg-bg"
            open={tableNames.length <= 3 || cardIdx === 0}
          >
            <summary className="px-3 py-2 cursor-pointer flex items-center gap-2 hover:bg-hover/20 list-none">
              <I.ChevronRight
                size={12}
                className="text-muted shrink-0 transition-transform [[open]_&]:rotate-90"
              />
              <span className="font-mono text-xs flex-1 truncate">{p.tableName}</span>
              {p.loading ? (
                <span className="text-muted text-[10px] animate-pulse">Đang tải...</span>
              ) : p.error ? (
                <>
                  <Chip variant="danger" className="text-[9px]!">
                    {p.error.slice(0, 40)}
                  </Chip>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      retryPreview(p.tableName);
                    }}
                    className="text-[10px] text-accent hover:underline px-1"
                  >
                    ↺ Thử lại
                  </button>
                </>
              ) : (
                <>
                  <span className="text-accent text-xs font-mono">{p.entityName}</span>
                  {p.pkField && (
                    <Chip variant="warning" className="text-[9px]!" title={`PK: ${p.pkField}`}>
                      PK: {p.pkField}
                    </Chip>
                  )}
                  <Chip variant="default" className="text-[9px]!">
                    {p.fields.length} fields
                  </Chip>
                </>
              )}
            </summary>
            {!p.loading && !p.error && (
              <div className="p-3 space-y-2 border-t border-border bg-surface/20">
                <div className="grid grid-cols-2 gap-2">
                  <FormField label="Tên entity (snake_case)">
                    <Input
                      value={p.entityName}
                      onChange={(e) => updatePreview(p.tableName, { entityName: e.target.value })}
                    />
                  </FormField>
                  <FormField label="Label hiển thị">
                    <Input
                      value={p.label}
                      onChange={(e) => updatePreview(p.tableName, { label: e.target.value })}
                    />
                  </FormField>
                </div>
                <div className="border border-border rounded overflow-hidden">
                  <table className="w-full text-[10px]">
                    <thead className="bg-surface text-muted">
                      <tr>
                        <th className="text-left px-2 py-1 w-6" title="Khoá chính">
                          PK
                        </th>
                        <th className="text-left px-2 py-1">Field name</th>
                        <th className="text-left px-2 py-1">Label</th>
                        <th className="text-left px-2 py-1 w-24">Type</th>
                      </tr>
                    </thead>
                    <tbody>
                      {p.fields.map((f, idx) => {
                        const isPk = p.pkField === f.name;
                        return (
                          <tr
                            key={`${p.tableName}:${f.name}:${idx}`}
                            className={["border-t border-border", isPk ? "bg-warning/5" : ""].join(
                              " ",
                            )}
                          >
                            <td className="px-2 py-0.5 text-center">
                              {isPk ? (
                                <span className="text-warning" title="Khoá chính (PK)">
                                  <I.Key size={10} />
                                </span>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => updatePreview(p.tableName, { pkField: f.name })}
                                  className="opacity-20 hover:opacity-70 text-muted transition-opacity"
                                  title="Đặt làm khoá chính"
                                >
                                  <I.Key size={10} />
                                </button>
                              )}
                            </td>
                            <td className="px-1 py-0.5">
                              <Input
                                value={f.name}
                                onChange={(e) =>
                                  updateField(p.tableName, idx, { name: e.target.value })
                                }
                                className="h-6 text-[10px] font-mono"
                              />
                            </td>
                            <td className="px-1 py-0.5">
                              <Input
                                value={f.label}
                                onChange={(e) =>
                                  updateField(p.tableName, idx, { label: e.target.value })
                                }
                                className="h-6 text-[10px]"
                              />
                            </td>
                            <td className="px-1 py-0.5">
                              <select
                                value={f.type}
                                onChange={(e) =>
                                  updateField(p.tableName, idx, { type: e.target.value })
                                }
                                className="h-6 text-[10px] w-full px-1 border border-border rounded bg-bg"
                              >
                                {[
                                  "text",
                                  "number",
                                  "boolean",
                                  "date",
                                  "datetime",
                                  "json",
                                  "select",
                                ].map((t) => (
                                  <option key={t} value={t}>
                                    {t}
                                  </option>
                                ))}
                              </select>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </details>
        ))}

        {err && (
          <div className="p-2 rounded border border-danger/40 bg-danger/5 text-danger text-xs whitespace-pre-wrap">
            {err}
          </div>
        )}

        {fullJobResult && (
          <div className="p-3 rounded border border-accent/40 bg-accent/5">
            <div className="font-medium text-accent text-sm">✓ Đã tạo full-import job</div>
            <div className="text-xs text-muted mt-1">
              Worker đang chạy nền. Theo dõi tiến độ ở "Jobs import" (sidebar).
            </div>
            <div className="font-mono text-[10px] mt-1 break-all">{fullJobResult.jobId}</div>
            <div className="mt-2 flex justify-end">
              <button
                type="button"
                onClick={onDone}
                className="text-xs text-accent hover:underline"
              >
                Chọn bảng khác →
              </button>
            </div>
          </div>
        )}

        {result && (
          <div
            className={[
              "p-3 rounded border space-y-1.5",
              result.failed === 0
                ? "border-success/40 bg-success/5"
                : "border-warning/40 bg-warning/5",
            ].join(" ")}
          >
            <div className="font-medium text-sm">
              {result.dryRun ? "Dry-run — không ghi DB" : "Đã migrate"}:{" "}
              <span className="text-success">{result.succeeded}</span>
              {result.failed > 0 && (
                <span className="text-warning ml-1">/ {result.failed} lỗi</span>
              )}
              {" / "}
              {result.total} bảng — {result.totalRowsRead.toLocaleString("vi-VN")} row đọc,{" "}
              <span className="text-success">
                +{result.totalRowsUpserted.toLocaleString("vi-VN")} mới
              </span>
              {result.totalRowsUpdated > 0 && (
                <span className="text-accent ml-1">
                  ↻{result.totalRowsUpdated.toLocaleString("vi-VN")} cập nhật
                </span>
              )}
            </div>
            {result.dryRun && result.failed === 0 && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted">Preview OK —</span>
                <button
                  type="button"
                  onClick={() => {
                    setDryRun(false);
                    setResult(null);
                  }}
                  className="text-xs text-accent font-medium hover:underline"
                >
                  Apply migrate ngay →
                </button>
              </div>
            )}
            <div className="max-h-[120px] overflow-y-auto text-[10px] font-mono space-y-0.5">
              {result.results.map((r) => (
                <div
                  key={r.tableName}
                  className={r.ok ? "text-muted" : "text-warning"}
                  title={r.error}
                >
                  {r.ok ? "✓" : "✗"} {r.tableName} → {r.entityName ?? "?"}: {r.rowsRead}r
                  {r.ok && (
                    <>
                      {" "}
                      +{r.rowsUpserted}
                      {r.rowsUpdated > 0 && ` ↻${r.rowsUpdated}`}
                    </>
                  )}
                  {r.truncated && <span className="text-warning ml-1">[giới hạn!]</span>}
                  {r.error && <span className="ml-1">— {r.error.slice(0, 80)}</span>}
                </div>
              ))}
            </div>
            {!result.dryRun && (
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={onDone}
                  className="text-xs text-accent hover:underline"
                >
                  Chọn bảng khác →
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Options + Run */}
      <div className="border-t border-border bg-surface/40 p-3 space-y-2.5">
        {/* Banner khi có bảng đã migrate trong selection */}
        {migratedTableNames.size > 0 && !result && (
          <div className="flex items-center gap-2 text-[11px] bg-warning/8 border border-warning/25 rounded px-2.5 py-1.5">
            <I.RefreshCw size={11} className="text-warning shrink-0" />
            <span className="text-warning font-medium">
              {migratedTableNames.size} bảng đã migrate.
            </span>
            <span className="text-muted">
              Dữ liệu cũ sẽ được upsert theo PK (nếu có) hoặc bật "Xoá cũ + import lại" để reset
              hoàn toàn.
            </span>
          </div>
        )}
        {/* Mode tabs */}
        <div className="flex gap-1 p-0.5 bg-bg-soft rounded-lg border border-border w-fit">
          <button
            type="button"
            onClick={() => setFullMode(false)}
            className={[
              "px-3 h-7 rounded-md text-xs font-medium transition-colors",
              !fullMode ? "bg-panel shadow text-text" : "text-muted hover:text-text",
            ].join(" ")}
          >
            Sync ngay
          </button>
          <button
            type="button"
            onClick={() => setFullMode(true)}
            className={[
              "px-3 h-7 rounded-md text-xs font-medium transition-colors",
              fullMode ? "bg-panel shadow text-text" : "text-muted hover:text-text",
            ].join(" ")}
          >
            Full job (nền)
          </button>
        </div>

        {/* Per-mode options */}
        {fullMode ? (
          <div className="flex items-center gap-3 text-xs flex-wrap">
            <span className="text-muted">Tự resume nếu lỗi, không giới hạn rows.</span>
            <label className="flex items-center gap-1.5">
              <span className="text-muted">Batch size:</span>
              <input
                type="number"
                min={100}
                max={50_000}
                value={batchSize}
                onChange={(e) =>
                  setBatchSize(
                    Math.max(100, Math.min(50_000, Number.parseInt(e.target.value, 10) || 100)),
                  )
                }
                className="w-20 px-1 py-0.5 border border-border rounded bg-bg text-xs"
              />
            </label>
            <label className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={writeManifest}
                onChange={(e) => setWriteManifest(e.target.checked)}
              />
              <span>Lưu manifest</span>
            </label>
          </div>
        ) : (
          <div className="flex items-center gap-3 text-xs flex-wrap">
            <label className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={dryRun}
                onChange={(e) => {
                  setDryRun(e.target.checked);
                  if (e.target.checked) setForce(false);
                }}
              />
              <span>Dry-run (không ghi DB)</span>
            </label>
            <label className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={force}
                disabled={dryRun}
                onChange={(e) => setForce(e.target.checked)}
              />
              <span className={dryRun ? "text-muted" : ""}>Xoá cũ + import lại</span>
            </label>
            <label className="flex items-center gap-1.5">
              <span className="text-muted">Limit/bảng:</span>
              <input
                type="number"
                min={1}
                max={100_000}
                value={limit}
                disabled={dryRun}
                onChange={(e) =>
                  setLimit(Math.max(1, Math.min(100_000, Number.parseInt(e.target.value, 10) || 1)))
                }
                className="w-20 px-1 py-0.5 border border-border rounded bg-bg text-xs disabled:opacity-50"
              />
            </label>
            <label className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={writeManifest}
                disabled={dryRun}
                onChange={(e) => setWriteManifest(e.target.checked)}
              />
              <span className={dryRun ? "text-muted" : ""}>Lưu manifest</span>
            </label>
          </div>
        )}

        <div className="flex justify-end">
          <Button
            variant={dryRun && !fullMode ? "default" : "primary"}
            size="md"
            disabled={busy || !allReady}
            onClick={run}
            icon={
              busy ? (
                <I.Loader size={14} />
              ) : fullMode ? (
                <I.Server size={14} />
              ) : (
                <I.Database size={14} />
              )
            }
          >
            {busy
              ? "Đang xử lý..."
              : fullMode
                ? `Tạo job (${tableNames.length} bảng)`
                : dryRun
                  ? `Preview dry-run (${tableNames.length} bảng)`
                  : `Migrate ngay (${tableNames.length} bảng)`}
          </Button>
        </div>
      </div>
    </>
  );
}

interface QuickPreview {
  tableName: string;
  entityName: string;
  label: string;
  fields: Array<{ name: string; label: string; type: string }>;
  /** PK field (lower-case theo fields.name) suy từ MSSQL info.primaryKey[0].
   *  Dùng để upsert chống duplicate khi migrate lại. */
  pkField?: string;
  loading: boolean;
  error?: string;
}

/* ── Phase U — FullImportJobsPanel: list jobs + Resume/Sync/Cancel ─ */
function FullImportJobsPanel() {
  const [jobs, setJobs] = useState<Awaited<ReturnType<typeof migration.listFullJobs>>>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const [expandedJobId, setExpandedJobId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Awaited<
    ReturnType<typeof migration.getFullJobDetail>
  > | null>(null);

  const load = useCallback(() => {
    migration
      .listFullJobs()
      .then(setJobs)
      .catch(() => {}); // Giữ data cũ khi lỗi — tránh flash empty + tắt auto-refresh
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Auto-refresh mỗi 3s nếu có job running/queued/paused.
  useEffect(() => {
    const active = jobs.some(
      (j) => j.status === "running" || j.status === "queued" || j.status === "paused",
    );
    if (!active) return;
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [jobs, load]);

  // Load chi tiết khi user expand hoặc khi jobs thay đổi (để table status
  // cập nhật real-time theo auto-refresh 3s).
  useEffect(() => {
    if (!expandedJobId) {
      setDetail(null);
      return;
    }
    migration
      .getFullJobDetail(expandedJobId)
      .then(setDetail)
      .catch(() => setDetail(null));
  }, [expandedJobId, jobs]);

  const doResume = async (jobId: string, mode: "resume" | "sync") => {
    const labels = {
      resume: {
        title: "Resume",
        body: "Re-enqueue job để worker pickup lại các bảng failed/pending.",
      },
      sync: {
        title: "Sync update",
        body: "Reset các bảng đã 'done' về 'pending' để stream lấy data MỚI từ MSSQL (theo lastPk). Records cũ giữ nguyên.",
      },
    } as const;
    const ok = await dialog.confirm(labels[mode].body, {
      title: labels[mode].title,
      confirmText: labels[mode].title,
    });
    if (!ok) return;
    setBusyId(jobId);
    setErr("");
    try {
      await migration.resumeFullJob(jobId, mode);
      load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  const doCancel = async (jobId: string) => {
    const ok = await dialog.confirm(
      "Cancel job này? Records đã import giữ nguyên — chỉ dừng worker không pickup tiếp.",
      { title: "Cancel job", confirmText: "Cancel" },
    );
    if (!ok) return;
    setBusyId(jobId);
    setErr("");
    try {
      await migration.cancelFullJob(jobId);
      load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  const statusVariant = (st: string): "success" | "warning" | "default" | "accent" => {
    if (st === "completed") return "success";
    if (st === "running" || st === "queued") return "accent";
    if (st === "paused" || st === "failed") return "warning";
    return "default";
  };

  return (
    <div className="border-b border-border">
      <div className="p-3 bg-surface/50">
        <h2 className="text-sm font-semibold flex items-center gap-1 mb-2">
          <I.Activity size={13} /> Jobs import
          <Chip variant="accent" className="text-[9px]!">
            {jobs.length}
          </Chip>
        </h2>
        {err && <div className="text-danger text-xs mb-2">{err}</div>}
        {jobs.length === 0 ? (
          <div className="text-xs text-muted">Chưa có job full-import nào.</div>
        ) : (
          <ul className="space-y-1">
            {jobs.map((j) => (
              <li key={j.id} className="text-xs border border-border rounded bg-bg">
                <div className="p-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <Chip variant={statusVariant(j.status)} className="text-[9px]!">
                          {j.status}
                        </Chip>
                        {j.kind === "sync" && (
                          <Chip variant="accent" className="text-[9px]!">
                            sync
                          </Chip>
                        )}
                        <span className="text-muted text-[10px] truncate">{j.connectionName}</span>
                      </div>
                      <div className="text-[10px] text-muted mt-0.5">
                        {j.completedTables}/{j.totalTables} bảng ·{" "}
                        {j.totalRowsImported.toLocaleString("vi-VN")} rows ·{" "}
                        {j.startedAt ? new Date(j.startedAt).toLocaleString("vi-VN") : "—"}
                      </div>
                      {j.error && (
                        <div className="text-warning text-[10px] mt-0.5 truncate" title={j.error}>
                          {j.error}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-1 mt-1.5 flex-wrap">
                    <Button
                      size="sm"
                      variant="default"
                      onClick={() => setExpandedJobId(expandedJobId === j.id ? null : j.id)}
                      icon={
                        expandedJobId === j.id ? (
                          <I.ChevronUp size={11} />
                        ) : (
                          <I.ChevronDown size={11} />
                        )
                      }
                    >
                      {expandedJobId === j.id ? "Ẩn" : "Chi tiết"}
                    </Button>
                    {(j.status === "paused" || j.status === "failed") && (
                      <Button
                        size="sm"
                        variant="default"
                        disabled={busyId === j.id}
                        onClick={() => doResume(j.id, "resume")}
                        icon={<I.Redo size={11} />}
                      >
                        Resume
                      </Button>
                    )}
                    {j.status === "completed" && (
                      <Button
                        size="sm"
                        variant="default"
                        disabled={busyId === j.id}
                        onClick={() => doResume(j.id, "sync")}
                        icon={<I.Redo size={11} />}
                        title="Lấy data mới từ MSSQL theo lastPk"
                      >
                        Sync
                      </Button>
                    )}
                    {(j.status === "running" || j.status === "queued" || j.status === "paused") && (
                      <Button
                        size="sm"
                        variant="default"
                        disabled={busyId === j.id}
                        onClick={() => doCancel(j.id)}
                        icon={<I.X size={11} />}
                      >
                        Cancel
                      </Button>
                    )}
                  </div>
                </div>
                {expandedJobId === j.id && detail && detail.job.id === j.id && (
                  <div className="border-t border-border p-2 bg-surface/30 max-h-[200px] overflow-y-auto">
                    <table className="w-full text-[10px]">
                      <thead className="text-muted">
                        <tr>
                          <th className="text-left">Bảng</th>
                          <th className="text-left">Status</th>
                          <th className="text-right">Rows</th>
                          <th className="text-left">lastPk</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detail.tables.map((t) => (
                          <tr key={t.id} className="border-t border-border/40">
                            <td className="font-mono truncate max-w-[120px]" title={t.tableName}>
                              {t.tableName}
                            </td>
                            <td>
                              <Chip variant={statusVariant(t.status)} className="text-[9px]!">
                                {t.status}
                              </Chip>
                            </td>
                            <td className="text-right">{t.rowsImported.toLocaleString("vi-VN")}</td>
                            <td
                              className="font-mono text-muted truncate max-w-[80px]"
                              title={t.lastPk ?? ""}
                            >
                              {t.lastPk ?? "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {detail.tables.some((t) => t.error) && (
                      <div className="mt-1 space-y-0.5">
                        {detail.tables
                          .filter((t) => t.error)
                          .map((t) => (
                            <div key={t.id} className="text-warning text-[10px]">
                              {t.tableName}: {t.error}
                            </div>
                          ))}
                      </div>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function FullJobsScreen({ onClose }: { onClose: () => void }) {
  return (
    <div className="flex flex-col h-full">
      <header className="flex items-center gap-2 px-4 py-3 border-b border-border shrink-0">
        <I.Activity size={15} />
        <span className="font-semibold">Jobs import</span>
        <div className="flex-1" />
        <button
          type="button"
          onClick={onClose}
          className="w-7 h-7 rounded flex items-center justify-center text-muted hover:text-text hover:bg-hover/60"
          title="Đóng"
        >
          <I.X size={14} />
        </button>
      </header>
      <div className="flex-1 overflow-y-auto">
        <FullImportJobsPanel />
      </div>
    </div>
  );
}

/* ── Phase T — MigratedEntitiesPanel: tracking + cleanup an toàn ─
 *
 * Chỉ hiển thị entity có `meta.source.kind === 'migration'`. Entity hệ
 * thống / user tạo tay KHÔNG bao giờ xuất hiện hoặc bị xoá ở đây. */
function MigratedEntitiesPanel({ onChanged }: { onChanged: () => void }) {
  const [rows, setRows] = useState<Awaited<ReturnType<typeof migration.listMigratedEntities>>>([]);
  const [busy, setBusy] = useState(false);
  const [busyRowId, setBusyRowId] = useState<string | null>(null);
  const [err, setErr] = useState("");

  const load = useCallback(() => {
    migration
      .listMigratedEntities()
      .then(setRows)
      .catch(() => setRows([]));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const totalRows = rows.reduce((s, r) => s + r.recordCount, 0);

  const doCleanup = async (
    row: (typeof rows)[number],
    mode: "records-only" | "entity-and-records" | "re-migrate",
  ) => {
    const labels = {
      "records-only": {
        title: "Xoá records",
        body: `Xoá toàn bộ ${row.recordCount} records của entity "${row.name}"? Entity giữ nguyên — có thể re-import sau.`,
      },
      "entity-and-records": {
        title: "Xoá cả entity",
        body: `Xoá entity "${row.name}" + ${row.recordCount} records? Không thể hoàn tác. Manifest cũng được cập nhật (gỡ migratedAt).`,
      },
      "re-migrate": {
        title: "Migrate lại",
        body: `Xoá ${row.recordCount} records cũ và import lại từ MSSQL bảng "${row.mssqlTable ?? "?"}"?`,
      },
    } as const;
    const ok = await dialog.confirm(labels[mode].body, {
      title: labels[mode].title,
      confirmText: labels[mode].title,
    });
    if (!ok) return;
    setBusyRowId(row.id);
    setErr("");
    try {
      await migration.cleanupMigratedEntity({ entityId: row.id, mode });
      load();
      onChanged();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusyRowId(null);
    }
  };

  const doGeneratePage = async (row: (typeof rows)[number]) => {
    setBusyRowId(row.id);
    setErr("");
    try {
      const r = await migration.generateMasterDetailPage({ entityId: row.id });
      const childMsg =
        r.backwardChildren.length > 0
          ? `\n\nChild entity (${r.backwardChildren.length}):\n` +
            r.backwardChildren
              .map(
                (c) =>
                  `• ${c.label ?? c.entityLabel} (qua ${c.fkField})${
                    c.source === "collection" ? " [collection]" : ""
                  }`,
              )
              .join("\n")
          : "\n\nKhông có child entity (chỉ list + detail).";
      const open = await dialog.confirm(
        `${r.upserted === "created" ? "Đã tạo" : "Đã cập nhật"} page "${r.pageLabel}".${childMsg}\n\nMở page ngay?`,
        { title: "Tạo page master-detail", confirmText: "Mở page" },
      );
      if (open) {
        window.open(`/pages/${r.pageId}`, "_blank");
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusyRowId(null);
    }
  };

  const doBulkCleanup = async (mode: "records-only" | "entity-and-records") => {
    const labels = {
      "records-only": {
        title: "Xoá tất cả records migrate",
        body: `Xoá ${totalRows} records của ${rows.length} entity? Entity giữ nguyên.`,
      },
      "entity-and-records": {
        title: "Xoá tất cả entity migrate",
        body: `Xoá ${rows.length} entity + ${totalRows} records? KHÔNG đụng entity hệ thống / user tạo tay.`,
      },
    } as const;
    const ok = await dialog.confirm(labels[mode].body, {
      title: labels[mode].title,
      confirmText: labels[mode].title,
    });
    if (!ok) return;
    setBusy(true);
    setErr("");
    try {
      const r = await migration.cleanupAllMigrated({ mode });
      await dialog.alert(
        `Đã ${labels[mode].title.toLowerCase()}: ${r.succeeded}/${r.total} thành công.`,
        { title: "Kết quả" },
      );
      load();
      onChanged();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <SidebarSection
      storageKey="migration:section-migrated"
      title={
        <>
          <I.Database size={13} className="inline mr-1" />
          Bảng đã migrate
          {rows.length > 0 && (
            <Chip variant="accent" className="text-[9px]! ml-1">
              {rows.length}
            </Chip>
          )}
        </>
      }
      actions={
        rows.length > 0 ? (
          <>
            <Button
              size="sm"
              variant="default"
              disabled={busy}
              onClick={() => doBulkCleanup("records-only")}
              title="Xoá tất cả records migrate, giữ entity"
            >
              Xoá records hết
            </Button>
            <Button
              size="sm"
              variant="default"
              disabled={busy}
              onClick={() => doBulkCleanup("entity-and-records")}
              title="Xoá tất cả entity migrate"
            >
              Xoá entity hết
            </Button>
          </>
        ) : undefined
      }
    >
      <div className="text-[10px] text-muted mt-1 mb-2 flex items-center gap-1">
        <I.AlertCircle size={10} /> Chỉ entity do migration tạo. Entity hệ thống / user tạo tay
        KHÔNG hiển thị.
      </div>
      {err && <div className="text-danger text-xs mb-2">{err}</div>}
      {rows.length === 0 ? (
        <div className="text-xs text-muted">Chưa có entity nào do migration tạo.</div>
      ) : (
        <ul className="space-y-1">
          {rows.map((r) => (
            <li key={r.id} className="text-xs border border-border rounded p-2 bg-bg">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="font-medium truncate">{r.label || r.name}</div>
                  <div className="text-muted text-[10px] truncate font-mono">
                    {r.mssqlTable ?? "?"} → {r.name}
                  </div>
                  <div className="text-muted text-[10px] truncate">
                    {r.connectionName ?? "(no conn)"} · {r.module ?? "?"} ·{" "}
                    {r.recordCount.toLocaleString("vi-VN")} rows ·{" "}
                    {r.importedAt ? new Date(r.importedAt).toLocaleString("vi-VN") : "—"}
                  </div>
                </div>
              </div>
              <div className="flex gap-1 mt-1.5">
                <Button
                  size="sm"
                  variant="default"
                  disabled={busyRowId === r.id}
                  onClick={() => doCleanup(r, "records-only")}
                  title="Xoá records, giữ entity"
                  icon={<I.Trash size={11} />}
                >
                  Xoá records
                </Button>
                <Button
                  size="sm"
                  variant="default"
                  disabled={busyRowId === r.id}
                  onClick={() => doCleanup(r, "entity-and-records")}
                  title="Xoá entity + records"
                  icon={<I.X size={11} />}
                >
                  Xoá entity
                </Button>
                <Button
                  size="sm"
                  variant="default"
                  disabled={busyRowId === r.id || !r.connectionId || !r.mssqlTable}
                  onClick={() => doCleanup(r, "re-migrate")}
                  title="Xoá records và import lại từ MSSQL"
                  icon={<I.Redo size={11} />}
                >
                  Migrate lại
                </Button>
                <Button
                  size="sm"
                  variant="default"
                  disabled={busyRowId === r.id}
                  onClick={() => doGeneratePage(r)}
                  title="Sinh page master-detail từ relation graph"
                  icon={<I.Layout size={11} />}
                >
                  Tạo page
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </SidebarSection>
  );
}

function MigratedEntitiesScreen({
  onClose,
  onChanged,
}: {
  onClose: () => void;
  onChanged: () => void;
}) {
  return (
    <div className="flex flex-col h-full">
      <header className="flex items-center gap-2 px-4 py-3 border-b border-border shrink-0">
        <I.Database size={15} />
        <span className="font-semibold">Bảng đã migrate</span>
        <div className="flex-1" />
        <button
          type="button"
          onClick={onClose}
          className="w-7 h-7 rounded flex items-center justify-center text-muted hover:text-text hover:bg-hover/60"
          title="Đóng"
        >
          <I.X size={14} />
        </button>
      </header>
      <div className="flex-1 overflow-y-auto">
        <MigratedEntitiesPanel onChanged={onChanged} />
      </div>
    </div>
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

/* ── Tab Sơ đồ: xyflow render entity + relation ───────── */

interface DiagramNode {
  id: string;
  kind: "entity" | "enum";
  entityName: string;
  label: string;
  fieldCount: number;
  enumValueCount: number;
}
interface DiagramEdge {
  id: string;
  source: string;
  target: string;
  column: string;
  refColumn: string;
}

function DiagramTab({ moduleName, onChanged }: { moduleName: string; onChanged: () => void }) {
  const t = useT();
  const [data, setData] = useState<{ nodes: DiagramNode[]; edges: DiagramEdge[] } | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const load = useCallback(() => {
    migration
      .getDiagram(moduleName)
      .then(setData)
      .catch(() => setData(null));
  }, [moduleName]);

  useEffect(() => {
    load();
  }, [load]);

  if (!data) {
    return <div className="text-sm text-muted p-4">{t("mig.diagram_loading")}</div>;
  }
  if (data.nodes.length === 0) {
    return (
      <EmptyState
        icon={<I.GitBranch size={28} />}
        title={t("mig.diagram_empty_title")}
        hint={t("mig.diagram_empty_hint")}
      />
    );
  }

  return (
    <div className="flex flex-col gap-2 h-[calc(100vh-12rem)]">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs text-muted">
          {t("mig.diagram_stats", {
            tables: data.nodes.length,
            entities: data.nodes.filter((n) => n.kind === "entity").length,
            enums: data.nodes.filter((n) => n.kind === "enum").length,
            edges: data.edges.length,
          })}
        </div>
        <NormalizeNamesButton
          moduleName={moduleName}
          onApplied={() => {
            load();
            onChanged();
          }}
        />
      </div>
      <div className="grid grid-cols-[1fr_300px] gap-3 flex-1 min-h-0">
        <DiagramCanvas data={data} selectedId={selectedId} onSelect={setSelectedId} />
        <DiagramSidebar
          moduleName={moduleName}
          node={data.nodes.find((n) => n.id === selectedId) ?? null}
          allNodes={data.nodes}
          onApplied={() => {
            load();
            onChanged();
          }}
        />
      </div>
    </div>
  );
}

function DiagramCanvas({
  data,
  selectedId,
  onSelect,
}: {
  data: { nodes: DiagramNode[]; edges: DiagramEdge[] };
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  // Layout grid đơn giản: ~5 col, mỗi cell 240x110.
  const layoutMemo = useMemo(() => {
    const cols = Math.max(1, Math.ceil(Math.sqrt(data.nodes.length)));
    return data.nodes.map((n, i) => ({
      ...n,
      x: (i % cols) * 240,
      y: Math.floor(i / cols) * 110,
    }));
  }, [data.nodes]);

  const flowNodes: Node[] = layoutMemo.map((n) => ({
    id: n.id,
    type: "default",
    position: { x: n.x, y: n.y },
    data: { label: <NodeLabel node={n} /> },
    style: {
      border:
        selectedId === n.id ? "2px solid var(--color-accent)" : "1px solid var(--color-border)",
      background: n.kind === "enum" ? "rgba(34,197,94,0.05)" : "var(--color-bg)",
      borderRadius: 6,
      padding: 4,
      width: 200,
    },
  }));

  const flowEdges: Edge[] = data.edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    label: e.column,
    labelStyle: { fontSize: 10, fill: "var(--color-muted)" },
    style: { stroke: "var(--color-border)" },
    markerEnd: { type: MarkerType.ArrowClosed },
  }));

  return (
    <div className="border border-border rounded overflow-hidden bg-surface/30">
      <ReactFlowProvider>
        <ReactFlow
          nodes={flowNodes}
          edges={flowEdges}
          onNodeClick={(_, n) => onSelect(n.id)}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          minZoom={0.2}
          maxZoom={1.5}
        >
          <Background gap={16} />
          <Controls showInteractive={false} />
          <MiniMap pannable zoomable />
        </ReactFlow>
      </ReactFlowProvider>
    </div>
  );
}

function NodeLabel({ node }: { node: DiagramNode }) {
  const t = useT();
  return (
    <div className="text-left">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] text-muted truncate">{node.id}</span>
        <Chip variant={node.kind === "enum" ? "accent" : "default"} className="text-[9px]!">
          {node.kind}
        </Chip>
      </div>
      <div className="text-sm font-medium truncate">{node.entityName}</div>
      <div className="text-[10px] text-muted truncate">{node.label}</div>
      <div className="text-[10px] text-muted">
        {node.kind === "enum"
          ? t("mig.diagram_node_values", { count: node.enumValueCount })
          : t("mig.diagram_node_columns", { count: node.fieldCount })}
      </div>
    </div>
  );
}

function DiagramSidebar({
  moduleName,
  node,
  allNodes,
  onApplied,
}: {
  moduleName: string;
  node: DiagramNode | null;
  allNodes: DiagramNode[];
  onApplied: () => void;
}) {
  const t = useT();
  if (!node) {
    return (
      <Card className="p-3 text-xs text-muted">
        {t("mig.diagram_click_hint")}
        <div className="mt-2">
          {t("mig.diagram_total", {
            total: allNodes.length,
            entities: allNodes.filter((n) => n.kind === "entity").length,
            enums: allNodes.filter((n) => n.kind === "enum").length,
          })}
        </div>
      </Card>
    );
  }
  return <DiagramNodeActions moduleName={moduleName} node={node} onApplied={onApplied} />;
}

function DiagramNodeActions({
  moduleName,
  node,
  onApplied,
}: {
  moduleName: string;
  node: DiagramNode;
  onApplied: () => void;
}) {
  const t = useT();
  const [newName, setNewName] = useState(node.entityName);
  const [newKind, setNewKind] = useState<"entity" | "enum">(node.kind);
  const [changes, setChanges] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  // Reset khi đổi node selected.
  useEffect(() => {
    setNewName(node.entityName);
    setNewKind(node.kind);
    setChanges([]);
    setErr("");
  }, [node.id, node.entityName, node.kind]);

  const apply = async (action: Parameters<typeof migration.applyChange>[0]["action"]) => {
    setBusy(true);
    setErr("");
    setChanges([]);
    try {
      const r = await migration.applyChange({ module: moduleName, action });
      setChanges(r.changes);
      onApplied();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="p-3 space-y-3 text-xs overflow-y-auto">
      <div>
        <div className="font-mono text-[10px] text-muted">{node.id}</div>
        <div className="font-medium">{node.entityName}</div>
        <div className="text-muted">{node.label}</div>
      </div>

      <div className="border-t border-border pt-2">
        <FormField label={t("mig.diagram_rename_entity")}>
          <div className="flex gap-1">
            <Input value={newName} onChange={(e) => setNewName(e.target.value)} />
            <Button
              size="sm"
              variant="primary"
              disabled={busy || newName === node.entityName}
              onClick={() => apply({ type: "renameEntity", tableName: node.id, newName })}
            >
              {t("common.apply")}
            </Button>
          </div>
        </FormField>
        <div className="text-[10px] text-muted mt-1">
          {t("mig.diagram_rename_cascade", { name: node.entityName })}
        </div>
      </div>

      <div className="border-t border-border pt-2">
        <FormField label={t("mig.diagram_change_kind")}>
          <div className="flex gap-1">
            <select
              value={newKind}
              onChange={(e) => setNewKind(e.target.value as "entity" | "enum")}
              className="flex-1 px-2 h-7 border border-border rounded bg-bg text-sm outline-none focus:border-accent"
            >
              <option value="entity">entity</option>
              <option value="enum">enum</option>
            </select>
            <Button
              size="sm"
              variant="primary"
              disabled={busy || newKind === node.kind}
              onClick={() => apply({ type: "changeKind", tableName: node.id, newKind })}
            >
              {t("common.apply")}
            </Button>
          </div>
        </FormField>
        <div className="text-[10px] text-muted mt-1">
          {t(
            newKind === "enum"
              ? "mig.diagram_kind_cascade_enum"
              : "mig.diagram_kind_cascade_entity",
          )}
        </div>
      </div>

      {err && <div className="text-danger">{err}</div>}
      {changes.length > 0 && (
        <div className="border-t border-border pt-2">
          <div className="text-success font-medium mb-1">{t("mig.diagram_applied")}</div>
          <ul className="text-[11px] text-muted space-y-0.5 list-disc pl-4">
            {changes.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}

/* ── Nút AI normalize names — gợi ý rename hàng loạt ─── */

interface NormalizeRename {
  kind: "entity" | "enum" | "field" | "proc";
  table?: string;
  column?: string;
  currentName: string;
  suggestedName: string;
  reason: string;
  severity: "high" | "medium" | "low";
}

interface NormalizeResult {
  renames: NormalizeRename[];
  summary?: string;
  tokensIn: number;
  tokensOut: number;
  durationMs: number;
  error?: string;
}

function NormalizeNamesButton({
  moduleName,
  onApplied,
}: {
  moduleName: string;
  onApplied: () => void;
}) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<NormalizeResult | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [err, setErr] = useState("");

  const run = async () => {
    setBusy(true);
    setErr("");
    setResult(null);
    try {
      const r = await migration.normalizeNamesAi(moduleName);
      setResult(r);
      setShowModal(true);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button
        size="sm"
        variant="default"
        disabled={busy}
        onClick={run}
        icon={busy ? <I.Loader size={12} /> : <I.Wand size={12} />}
      >
        {busy ? t("mig.normalize_busy") : t("mig.normalize_btn")}
      </Button>
      {err && <span className="text-[11px] text-danger">{err}</span>}
      <Modal
        open={showModal}
        onClose={() => setShowModal(false)}
        title={t("mig.normalize_modal_title")}
        width={900}
      >
        {result && (
          <NormalizeRenameView
            result={result}
            moduleName={moduleName}
            onApplied={() => {
              onApplied();
              setShowModal(false);
            }}
          />
        )}
      </Modal>
    </>
  );
}

function NormalizeRenameView({
  result,
  moduleName,
  onApplied,
}: {
  result: NormalizeResult;
  moduleName: string;
  onApplied: () => void;
}) {
  const t = useT();
  const [picked, setPicked] = useState<Set<number>>(() => {
    // Mặc định: tick all severity=high.
    return new Set(
      result.renames.map((_, i) => i).filter((i) => result.renames[i]!.severity === "high"),
    );
  });
  const [busy, setBusy] = useState(false);
  const [applied, setApplied] = useState<string[]>([]);
  const [err, setErr] = useState("");

  const toggle = (i: number) => {
    const next = new Set(picked);
    if (next.has(i)) next.delete(i);
    else next.add(i);
    setPicked(next);
  };

  const applyPicked = async () => {
    setBusy(true);
    setErr("");
    setApplied([]);
    const logs: string[] = [];
    try {
      for (const i of [...picked].sort((a, b) => a - b)) {
        const r = result.renames[i];
        if (!r) continue;
        try {
          if (r.kind === "entity" || r.kind === "enum") {
            if (!r.table) continue;
            const out = await migration.applyChange({
              module: moduleName,
              action: { type: "renameEntity", tableName: r.table, newName: r.suggestedName },
            });
            logs.push(
              `✓ ${r.kind} ${r.currentName} → ${r.suggestedName} (${out.changes.length} change)`,
            );
          } else if (r.kind === "field") {
            if (!r.table || !r.column) continue;
            const out = await migration.applyChange({
              module: moduleName,
              action: {
                type: "renameField",
                tableName: r.table,
                columnName: r.column,
                newField: r.suggestedName,
              },
            });
            logs.push(
              `✓ field ${r.table}.${r.column} → ${r.suggestedName} (${out.changes.length} change)`,
            );
          } else {
            // proc: chưa có applyChange action cho proc rename (targetProcName).
            // Skip với warning.
            logs.push(
              `! Skip proc ${r.currentName} → ${r.suggestedName} (chưa support — sửa tay trong YAML).`,
            );
          }
        } catch (e) {
          logs.push(`✗ ${r.currentName}: ${(e as Error).message}`);
        }
      }
      setApplied(logs);
      onApplied();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (result.error) {
    return (
      <div className="p-2 rounded border border-danger/40 bg-danger/5 text-xs">
        <div className="text-danger font-medium">
          {t("mig.normalize_llm_fail")} {result.error}
        </div>
        <ErrorHint code={result.error} />
      </div>
    );
  }

  if (result.renames.length === 0) {
    return (
      <div className="text-sm text-success">
        {t("mig.normalize_ok")}
        {result.summary && <div className="text-muted text-xs mt-2">{result.summary}</div>}
      </div>
    );
  }

  const severityCount = {
    high: result.renames.filter((r) => r.severity === "high").length,
    medium: result.renames.filter((r) => r.severity === "medium").length,
    low: result.renames.filter((r) => r.severity === "low").length,
  };

  return (
    <div className="space-y-3 text-xs">
      <div className="text-muted flex gap-3 flex-wrap">
        <span>{t("mig.normalize_count", { count: result.renames.length })}</span>
        <span className="text-danger">H={severityCount.high}</span>
        <span className="text-warning">M={severityCount.medium}</span>
        <span>L={severityCount.low}</span>
        <span className="ml-auto">
          {result.tokensIn}+{result.tokensOut} tokens · {(result.durationMs / 1000).toFixed(1)}s
        </span>
      </div>
      {result.summary && (
        <div className="p-2 rounded border border-accent/30 bg-accent/5 text-[11px]">
          {result.summary}
        </div>
      )}
      <div className="flex items-center gap-2 text-[11px]">
        <button
          type="button"
          onClick={() => setPicked(new Set(result.renames.map((_, i) => i)))}
          className="px-2 h-6 border border-border rounded hover:bg-surface"
        >
          {t("mig.normalize_select_all")}
        </button>
        <button
          type="button"
          onClick={() => setPicked(new Set())}
          className="px-2 h-6 border border-border rounded hover:bg-surface"
        >
          {t("mig.normalize_deselect")}
        </button>
        <div className="ml-auto text-muted">
          {t("mig.normalize_selected", { count: picked.size })}
        </div>
      </div>
      <div className="border border-border rounded overflow-hidden max-h-96 overflow-y-auto">
        <table className="w-full text-[11px]">
          <thead className="bg-surface text-muted sticky top-0">
            <tr>
              <th className="text-left px-2 py-1 w-6"></th>
              <th className="text-left px-2 py-1">{t("mig.normalize_col_kind")}</th>
              <th className="text-left px-2 py-1">{t("mig.normalize_col_current")}</th>
              <th className="text-left px-2 py-1">{t("mig.normalize_col_suggested")}</th>
              <th className="text-left px-2 py-1">{t("mig.normalize_col_reason")}</th>
              <th className="text-left px-2 py-1 w-12">{t("mig.normalize_col_sev")}</th>
            </tr>
          </thead>
          <tbody>
            {result.renames.map((r, i) => (
              <tr key={i} className="border-t border-border hover:bg-surface">
                <td className="px-2 py-1">
                  <input type="checkbox" checked={picked.has(i)} onChange={() => toggle(i)} />
                </td>
                <td className="px-2 py-1">
                  <Chip className="text-[9px]!">{r.kind}</Chip>
                </td>
                <td className="px-2 py-1">
                  <code>{r.currentName}</code>
                  {r.table && (
                    <div className="text-[9px] text-muted">
                      {r.table}
                      {r.column ? `.${r.column}` : ""}
                    </div>
                  )}
                </td>
                <td className="px-2 py-1">
                  <code className="text-accent">{r.suggestedName}</code>
                </td>
                <td className="px-2 py-1 text-muted">{r.reason}</td>
                <td className="px-2 py-1">
                  <Chip
                    variant={
                      r.severity === "high"
                        ? "danger"
                        : r.severity === "medium"
                          ? "warning"
                          : "default"
                    }
                    className="text-[9px]!"
                  >
                    {r.severity[0]!.toUpperCase()}
                  </Chip>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {err && <div className="text-danger">{err}</div>}
      {applied.length > 0 && (
        <div className="border-t border-border pt-2 max-h-48 overflow-y-auto">
          <div className="text-success font-medium mb-1">{t("mig.normalize_results")}</div>
          <ul className="text-[11px] text-muted space-y-0.5">
            {applied.map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ul>
        </div>
      )}
      <div className="flex gap-2 justify-end pt-2 border-t border-border">
        <Button
          size="sm"
          variant="primary"
          disabled={busy || picked.size === 0}
          onClick={applyPicked}
        >
          {busy
            ? t("mig.normalize_applying")
            : t("mig.normalize_apply_btn", { count: picked.size })}
        </Button>
      </div>
    </div>
  );
}

/* ── Tier 3: Sample input + capture golden ─────────────── */

interface ProcSampleUI {
  name: string;
  kind: "happy" | "boundary" | "edge";
  description: string;
  args: Record<string, unknown>;
  expectedError?: string;
}

function SamplesGoldenButton({ moduleName, procName }: { moduleName: string; procName: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="pt-2 border-t border-border mt-2">
      <Button
        size="sm"
        variant="default"
        onClick={() => setOpen(true)}
        icon={<I.CheckSq size={12} />}
      >
        Sinh sample + capture golden
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={`Test sample + capture golden: ${procName}`}
        width={1000}
      >
        <SamplesGoldenDialog
          moduleName={moduleName}
          procName={procName}
          onDone={() => setOpen(false)}
        />
      </Modal>
    </div>
  );
}

function SamplesGoldenDialog({
  moduleName,
  procName,
  onDone,
}: {
  moduleName: string;
  procName: string;
  onDone: () => void;
}) {
  const draftKey = `migration:draft:samples:${moduleName}:${procName}`;
  // Restore draft từ localStorage nếu có (đóng/mở browser không mất).
  const restored = useMemo(() => {
    if (typeof window === "undefined") return null;
    try {
      const raw = window.localStorage.getItem(draftKey);
      if (!raw) return null;
      return JSON.parse(raw) as {
        step?: "generate" | "review" | "captured";
        samples?: ProcSampleUI[];
        editedJson?: string;
        genMeta?: { tokensIn: number; tokensOut: number; durationMs: number };
      };
    } catch {
      return null;
    }
  }, [draftKey]);

  const [step, setStep] = useState<"generate" | "review" | "captured">(
    restored?.step ?? "generate",
  );
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [genMeta, setGenMeta] = useState<{
    tokensIn: number;
    tokensOut: number;
    durationMs: number;
  } | null>(restored?.genMeta ?? null);
  const [samples, setSamples] = useState<ProcSampleUI[]>(restored?.samples ?? []);
  const [editedJson, setEditedJson] = useState(restored?.editedJson ?? "");

  // Auto-save draft khi step "review" (chưa capture). Sau capture xong
  // → clear (đã lưu vào file e2e/golden, không cần draft nữa).
  useEffect(() => {
    if (step === "captured") {
      window.localStorage.removeItem(draftKey);
      return;
    }
    if (step === "generate" && !editedJson && samples.length === 0) {
      window.localStorage.removeItem(draftKey);
      return;
    }
    window.localStorage.setItem(
      draftKey,
      JSON.stringify({
        step,
        samples,
        editedJson,
        genMeta,
      }),
    );
  }, [draftKey, step, samples, editedJson, genMeta]);
  const [capture, setCapture] = useState<{
    filePath: string;
    total: number;
    ok: number;
    failed: number;
    results: Array<{
      name: string;
      kind: ProcSampleUI["kind"];
      ok: boolean;
      output?: unknown;
      error?: string;
      durationMs: number;
    }>;
  } | null>(null);

  const generate = async () => {
    setBusy(true);
    setErr("");
    setCapture(null);
    try {
      const r = await migration.generateSamplesDryRun(moduleName, procName);
      if (r.error) {
        setErr(r.error);
        return;
      }
      setSamples(r.samples);
      setEditedJson(JSON.stringify(r.samples, null, 2));
      setGenMeta({ tokensIn: r.tokensIn, tokensOut: r.tokensOut, durationMs: r.durationMs });
      setStep("review");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const capture$ = async () => {
    setBusy(true);
    setErr("");
    try {
      // Parse editedJson để cho phép user sửa trước khi capture.
      let parsed: ProcSampleUI[];
      try {
        parsed = JSON.parse(editedJson) as ProcSampleUI[];
        if (!Array.isArray(parsed)) throw new Error("Phải là array");
      } catch (e) {
        setErr(`JSON không hợp lệ: ${(e as Error).message}`);
        setBusy(false);
        return;
      }
      const r = await migration.captureGolden({
        module: moduleName,
        procName,
        samples: parsed,
      });
      setCapture(r);
      setStep("captured");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const kindCount = useMemo(() => {
    const c = { happy: 0, boundary: 0, edge: 0 };
    for (const s of samples) c[s.kind]++;
    return c;
  }, [samples]);

  return (
    <div className="space-y-3 text-xs">
      {/* Steps */}
      <div className="flex items-center gap-2 text-[11px]">
        <span className={step === "generate" ? "text-accent font-medium" : "text-muted"}>
          1. AI sinh sample
        </span>
        <span className="text-muted">→</span>
        <span className={step === "review" ? "text-accent font-medium" : "text-muted"}>
          2. Review + sửa
        </span>
        <span className="text-muted">→</span>
        <span className={step === "captured" ? "text-accent font-medium" : "text-muted"}>
          3. Capture golden
        </span>
      </div>

      {step === "generate" && (
        <>
          <div className="text-muted">
            AI sẽ đọc paramsSchema MSSQL + 5 sample data của các bảng proc đọc → sinh 10 input
            variants (5 happy + 3 boundary + 2 edge case) để test proc.
          </div>
          <Button
            variant="primary"
            disabled={busy}
            onClick={generate}
            icon={busy ? <I.Loader size={12} /> : <I.Sparkles size={12} />}
          >
            {busy ? "Đang gọi AI..." : "AI sinh sample"}
          </Button>
        </>
      )}

      {err && (
        <div className="p-2 rounded border border-danger/40 bg-danger/5">
          <div className="text-danger font-medium">Lỗi: {err}</div>
          <ErrorHint code={err} />
        </div>
      )}

      {step === "review" && (
        <>
          {genMeta && (
            <div className="flex gap-3 text-muted text-[11px]">
              <Chip variant="default" className="text-[10px]!">
                {samples.length} sample
              </Chip>
              <span>Happy: {kindCount.happy}</span>
              <span>Boundary: {kindCount.boundary}</span>
              <span>Edge: {kindCount.edge}</span>
              <span className="ml-auto">
                {genMeta.tokensIn}+{genMeta.tokensOut} tokens ·{" "}
                {(genMeta.durationMs / 1000).toFixed(1)}s
              </span>
            </div>
          )}

          {samples.length > 0 && (
            <div className="border border-border rounded overflow-hidden max-h-48 overflow-y-auto">
              <table className="w-full text-[11px]">
                <thead className="bg-surface text-muted sticky top-0">
                  <tr>
                    <th className="text-left px-2 py-1">Tên</th>
                    <th className="text-left px-2 py-1">Kind</th>
                    <th className="text-left px-2 py-1">Mô tả</th>
                  </tr>
                </thead>
                <tbody>
                  {samples.map((s) => (
                    <tr key={s.name} className="border-t border-border">
                      <td className="px-2 py-1 font-mono">{s.name}</td>
                      <td className="px-2 py-1">
                        <Chip
                          variant={
                            s.kind === "happy"
                              ? "success"
                              : s.kind === "boundary"
                                ? "warning"
                                : "danger"
                          }
                          className="text-[9px]!"
                        >
                          {s.kind}
                        </Chip>
                      </td>
                      <td className="px-2 py-1 text-muted">{s.description}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div>
            <div className="text-muted mb-1">
              Sample JSON ({editedJson.split("\n").length} dòng) — có thể sửa trước capture:
            </div>
            <Textarea
              value={editedJson}
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
                setEditedJson(e.target.value)
              }
              className="w-full font-mono text-[11px] min-h-[200px] max-h-[400px]"
            />
          </div>

          <div className="text-[11px] text-warning bg-warning/5 border border-warning/30 rounded p-2">
            <I.AlertCircle size={11} className="inline mr-1" />
            Capture sẽ <b>gọi proc thật trên MSSQL</b> với mỗi sample. Connection phải bật{" "}
            <b>"Allow write"</b>. Snapshot input/output ghi vào{" "}
            <code>
              e2e/golden/{moduleName}/{procName.replace(/\W/g, "_")}.json
            </code>{" "}
            làm baseline cho golden test sau khi port.
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-border">
            <Button variant="default" size="sm" onClick={() => setStep("generate")}>
              ↩ Sinh lại
            </Button>
            <Button
              variant="primary"
              size="sm"
              disabled={busy || !editedJson}
              onClick={capture$}
              icon={busy ? <I.Loader size={12} /> : <I.Play size={12} />}
            >
              {busy ? "Đang chạy proc trên MSSQL..." : "Capture golden"}
            </Button>
          </div>
        </>
      )}

      {step === "captured" && capture && (
        <>
          <div className="p-2 rounded border border-success/40 bg-success/5">
            <div className="text-success font-medium">
              ✓ Capture xong — {capture.ok}/{capture.total} sample thành công
              {capture.failed > 0 && (
                <span className="text-warning ml-2">({capture.failed} fail)</span>
              )}
            </div>
            <div className="text-[10px] text-muted mt-1">
              Lưu vào: <code>{capture.filePath}</code>
            </div>
          </div>

          <div className="border border-border rounded overflow-hidden max-h-64 overflow-y-auto">
            <table className="w-full text-[11px]">
              <thead className="bg-surface text-muted sticky top-0">
                <tr>
                  <th className="text-left px-2 py-1">Sample</th>
                  <th className="text-left px-2 py-1">Kind</th>
                  <th className="text-left px-2 py-1">Status</th>
                  <th className="text-right px-2 py-1">ms</th>
                  <th className="text-left px-2 py-1">Output / Error</th>
                </tr>
              </thead>
              <tbody>
                {capture.results.map((r) => (
                  <tr key={r.name} className="border-t border-border">
                    <td className="px-2 py-1 font-mono">{r.name}</td>
                    <td className="px-2 py-1">
                      <Chip
                        variant={
                          r.kind === "happy"
                            ? "success"
                            : r.kind === "boundary"
                              ? "warning"
                              : "danger"
                        }
                        className="text-[9px]!"
                      >
                        {r.kind}
                      </Chip>
                    </td>
                    <td className="px-2 py-1">
                      {r.ok ? (
                        <Chip variant="success" className="text-[9px]!">
                          ok
                        </Chip>
                      ) : (
                        <Chip variant="danger" className="text-[9px]!">
                          fail
                        </Chip>
                      )}
                    </td>
                    <td className="px-2 py-1 text-right">{r.durationMs}</td>
                    <td className="px-2 py-1 text-muted truncate max-w-[300px]">
                      {r.ok ? JSON.stringify(r.output).slice(0, 100) : r.error}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-border">
            <Button variant="default" size="sm" onClick={() => setStep("review")}>
              ↩ Sửa sample + capture lại
            </Button>
            <Button variant="primary" size="sm" onClick={onDone}>
              Đóng
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

/* ── Codegen Tier 2: T-SQL → JS procedure / TS plugin ─── */

interface CodegenDryRunResult {
  procName: string;
  manifestTier: "B" | "C" | "D";
  output:
    | {
        tier: "B";
        name: string;
        label: string;
        description: string;
        paramsSchema: Array<Record<string, unknown>>;
        code: string;
      }
    | { tier: "D"; fileName: string; exportName: string; description: string; code: string }
    | null;
  error?: string;
  raw?: string;
  tokensIn: number;
  tokensOut: number;
  durationMs: number;
}

function CodegenProcButton({
  moduleName,
  procName,
  suggestedTier,
}: {
  moduleName: string;
  procName: string;
  suggestedTier?: string;
}) {
  const [open, setOpen] = useState(false);
  const tierLocked = suggestedTier === "C";
  return (
    <div className="pt-2 border-t border-border mt-2">
      <Button
        size="sm"
        variant="primary"
        onClick={() => setOpen(true)}
        disabled={tierLocked}
        icon={<I.Wand size={12} />}
        title={tierLocked ? "Tier C (workflow scheduled) — chưa hỗ trợ codegen" : ""}
      >
        Sinh code (AI codegen)
      </Button>
      {tierLocked && (
        <span className="text-[10px] text-muted ml-2">
          Tier C — workflow scheduled, dùng tay (chưa AI)
        </span>
      )}
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={`AI codegen: ${procName}`}
        width={1000}
      >
        <CodegenProcDialog
          moduleName={moduleName}
          procName={procName}
          onDone={() => setOpen(false)}
        />
      </Modal>
    </div>
  );
}

function CodegenProcDialog({
  moduleName,
  procName,
  onDone,
}: {
  moduleName: string;
  procName: string;
  onDone: () => void;
}) {
  const draftKey = `migration:draft:codegen:${moduleName}:${procName}`;
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<CodegenDryRunResult | null>(null);
  const [err, setErr] = useState("");
  // Phase Q4 — pre-flight check: bảng proc đụng đã migrate hết chưa.
  const [migStatus, setMigStatus] = useState<{
    active: boolean;
    isClean: boolean;
    canCodegen: boolean;
    missingTables: Array<{ table: string; reason: string }>;
    touchedTables: string[];
    suggestedAction: "codegen" | "wait" | "mark-inactive";
  } | null>(null);
  const [overrideDirty, setOverrideDirty] = useState(false);
  useEffect(() => {
    migration
      .getProcMigrationStatus(moduleName, procName)
      .then(setMigStatus)
      .catch(() => setMigStatus(null));
  }, [moduleName, procName]);
  // Editable code trong textarea — persist localStorage để đóng/mở browser
  // không mất draft chưa apply.
  const [editedCode, setEditedCode] = useState(() => {
    if (typeof window === "undefined") return "";
    try {
      const raw = window.localStorage.getItem(draftKey);
      if (raw) {
        const d = JSON.parse(raw) as { code?: string; result?: CodegenDryRunResult };
        if (d.result) setTimeout(() => setResult(d.result!), 0);
        return d.code ?? "";
      }
    } catch {
      /* ignore */
    }
    return "";
  });
  const [overwrite, setOverwrite] = useState(false);

  // Auto-save draft khi code/result đổi.
  useEffect(() => {
    if (!editedCode && !result) {
      window.localStorage.removeItem(draftKey);
      return;
    }
    window.localStorage.setItem(draftKey, JSON.stringify({ code: editedCode, result }));
  }, [editedCode, result, draftKey]);
  const [applyResult, setApplyResult] = useState<{
    type: "success" | "conflict";
    message: string;
    href?: string;
  } | null>(null);

  const runDryRun = async () => {
    setBusy(true);
    setErr("");
    setResult(null);
    setApplyResult(null);
    try {
      const r = await migration.codegenProcDryRun(moduleName, procName);
      setResult(r);
      if (r.output) setEditedCode(r.output.code);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const apply = async () => {
    if (!result?.output) return;
    setBusy(true);
    setErr("");
    setApplyResult(null);
    try {
      const out = result.output;
      const r = await migration.codegenProcApply({
        module: moduleName,
        tier: out.tier,
        code: editedCode,
        ...(out.tier === "B"
          ? {
              name: out.name,
              label: out.label,
              description: out.description,
              paramsSchema: out.paramsSchema,
            }
          : {
              fileName: out.fileName,
              overwrite,
            }),
      });
      if (r.tier === "B") {
        setApplyResult({
          type: "success",
          message: `${r.upserted === "created" ? "✓ Tạo mới" : "↻ Cập nhật"} procedure "${r.name}"`,
          href: `/procedures/${r.procedureId}`,
        });
        // Clear draft sau khi apply — đã commit vào DB.
        window.localStorage.removeItem(draftKey);
      } else {
        if (r.upserted === "conflict") {
          setApplyResult({ type: "conflict", message: r.message ?? "File đã tồn tại" });
        } else {
          setApplyResult({
            type: "success",
            message: `${r.upserted === "created" ? "✓ Tạo" : "↻ Ghi đè"} file ${r.filePath}`,
          });
          window.localStorage.removeItem(draftKey);
        }
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const isDirty = migStatus != null && (!migStatus.isClean || !migStatus.active) && !overrideDirty;

  return (
    <div className="space-y-3 text-xs">
      {migStatus && !migStatus.active && (
        <div className="p-2.5 rounded border border-muted/40 bg-surface text-muted">
          <div className="font-medium flex items-center gap-1.5">
            <I.AlertCircle size={12} /> Proc này đã đánh dấu "không còn dùng" (inactive)
          </div>
          <div className="mt-1 text-[11px]">
            Phase Q1 đã ghi proc này active=false sau khi phân tích hoạt động MSSQL. Cân nhắc skip
            codegen — hoặc đổi lại active=true qua tab Review nếu muốn migrate.
          </div>
        </div>
      )}
      {migStatus && migStatus.active && !migStatus.isClean && (
        <div className="p-2.5 rounded border border-warning/40 bg-warning/5">
          <div className="font-medium text-warning flex items-center gap-1.5">
            <I.AlertCircle size={12} /> Đang chờ {migStatus.missingTables.length} bảng migrate data
          </div>
          <div className="mt-1 text-[11px] text-muted">
            Codegen có thể sinh code đụng entity chưa tồn tại trong PG. Migrate trước qua tab Review
            → Bulk migrate, rồi quay lại.
          </div>
          <ul className="mt-1 text-[11px] font-mono space-y-0.5">
            {migStatus.missingTables.map((m) => (
              <li key={m.table} className="text-warning">
                · {m.table} <span className="text-muted not-italic">— {m.reason}</span>
              </li>
            ))}
          </ul>
          {!overrideDirty && (
            <button
              type="button"
              onClick={() => setOverrideDirty(true)}
              className="mt-1.5 text-[11px] text-accent hover:underline"
            >
              Tôi biết — vẫn cho phép codegen (override)
            </button>
          )}
        </div>
      )}
      {!result && (
        <>
          <div className="text-muted">
            AI sẽ đọc body T-SQL gốc + manifest entities → sinh code preview. Bạn duyệt + sửa trước
            khi áp dụng.
          </div>
          <Button
            variant="primary"
            disabled={busy || isDirty}
            onClick={runDryRun}
            icon={busy ? <I.Loader size={12} /> : <I.Wand size={12} />}
            title={isDirty ? "Block do bảng phụ thuộc chưa migrate — xem banner phía trên" : ""}
          >
            {busy ? "Đang gọi AI..." : "Dry-run AI codegen"}
          </Button>
        </>
      )}
      {err && <div className="text-danger whitespace-pre-wrap">{err}</div>}

      {result && (
        <>
          <div className="flex gap-3 text-muted flex-wrap items-center">
            <Chip
              variant={result.manifestTier === "D" ? "warning" : "default"}
              className="text-[10px]!"
            >
              Tier {result.manifestTier}
            </Chip>
            <span>tokens in: {result.tokensIn}</span>
            <span>out: {result.tokensOut}</span>
            <span>{(result.durationMs / 1000).toFixed(1)}s</span>
            <Button
              size="sm"
              variant="default"
              onClick={runDryRun}
              disabled={busy}
              icon={<I.Redo size={11} />}
            >
              Chạy lại
            </Button>
          </div>

          {result.error && (
            <div className="p-2 rounded border border-danger/40 bg-danger/5">
              <div className="text-danger font-medium">LLM fail: {result.error}</div>
              <ErrorHint code={result.error} />
            </div>
          )}

          {result.output && (
            <CodegenPreview
              output={result.output}
              editedCode={editedCode}
              onChangeCode={setEditedCode}
              overwrite={overwrite}
              onChangeOverwrite={setOverwrite}
            />
          )}

          {applyResult && (
            <div
              className={[
                "p-2 rounded border",
                applyResult.type === "success"
                  ? "border-success/40 bg-success/5 text-success"
                  : "border-warning/40 bg-warning/5 text-warning",
              ].join(" ")}
            >
              {applyResult.message}
              {applyResult.href && (
                <a href={applyResult.href} className="ml-2 text-accent hover:underline">
                  Mở →
                </a>
              )}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2 border-t border-border">
            <Button variant="default" size="sm" onClick={onDone}>
              Đóng
            </Button>
            {result.output && (
              <Button variant="primary" size="sm" disabled={busy || !editedCode} onClick={apply}>
                {busy
                  ? "Đang áp dụng..."
                  : result.output.tier === "B"
                    ? "Áp dụng (lưu procedure)"
                    : "Áp dụng (ghi file plugin)"}
              </Button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function CodegenPreview({
  output,
  editedCode,
  onChangeCode,
  overwrite,
  onChangeOverwrite,
}: {
  output: NonNullable<CodegenDryRunResult["output"]>;
  editedCode: string;
  onChangeCode: (v: string) => void;
  overwrite: boolean;
  onChangeOverwrite: (v: boolean) => void;
}) {
  return (
    <div className="space-y-2">
      <Card className="p-3 bg-surface/30">
        {output.tier === "B" ? (
          <>
            <div className="text-[11px]">
              <span className="text-muted">Name:</span>{" "}
              <code className="text-accent">{output.name}</code>
            </div>
            <div className="text-[11px]">
              <span className="text-muted">Label:</span> {output.label}
            </div>
            <div className="text-[11px] text-muted">{output.description}</div>
            <div className="text-[11px] mt-2">
              <span className="text-muted">Params:</span>{" "}
              {output.paramsSchema.length === 0 ? "(none)" : ""}
            </div>
            <ul className="text-[10px] ml-3 list-disc">
              {output.paramsSchema.map((p, i) => (
                <li key={i}>
                  <code>{String(p.name)}</code>: {String(p.type)}
                  {p.required ? " *" : ""}
                  {p.description ? ` — ${String(p.description)}` : ""}
                </li>
              ))}
            </ul>
          </>
        ) : (
          <>
            <div className="text-[11px]">
              <span className="text-muted">File:</span>{" "}
              <code className="text-accent">packages/plugins/module-???/{output.fileName}</code>
            </div>
            <div className="text-[11px]">
              <span className="text-muted">Export:</span> <code>{output.exportName}</code>
            </div>
            <div className="text-[11px] text-muted">{output.description}</div>
            <label className="text-[11px] flex items-center gap-1 mt-2">
              <input
                type="checkbox"
                checked={overwrite}
                onChange={(e) => onChangeOverwrite(e.target.checked)}
              />
              Cho phép ghi đè nếu file đã tồn tại
            </label>
          </>
        )}
      </Card>
      <div>
        <div className="text-muted mb-1">
          Code ({editedCode.split("\n").length} dòng) — có thể sửa trước khi áp dụng:
        </div>
        <Textarea
          value={editedCode}
          onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => onChangeCode(e.target.value)}
          className="w-full font-mono text-[11px] min-h-[300px] max-h-[500px]"
        />
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
    // biome-ignore lint/correctness/useExhaustiveDependencies: chỉ load 1 lần khi mount module
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

/** Markdown render đơn giản (không thêm dep): heading, bold, code, link, list. */
function MarkdownPreview({ text }: { text: string }) {
  const lines = text.split("\n");
  return <div className="space-y-1">{lines.map((line, i) => renderMdLine(line, i))}</div>;
}

function renderMdLine(line: string, key: number): React.ReactElement {
  if (line.startsWith("# ")) {
    return (
      <h1 key={key} className="text-base font-bold mt-3">
        {inline(line.slice(2))}
      </h1>
    );
  }
  if (line.startsWith("## ")) {
    return (
      <h2 key={key} className="text-sm font-semibold mt-2">
        {inline(line.slice(3))}
      </h2>
    );
  }
  if (line.startsWith("### ")) {
    return (
      <h3 key={key} className="text-[13px] font-semibold mt-2">
        {inline(line.slice(4))}
      </h3>
    );
  }
  if (line.startsWith("> ")) {
    return (
      <blockquote key={key} className="border-l-2 border-accent pl-2 text-muted">
        {inline(line.slice(2))}
      </blockquote>
    );
  }
  if (/^[-*] /.test(line)) {
    return (
      <div key={key} className="ml-3">
        • {inline(line.slice(2))}
      </div>
    );
  }
  if (line.startsWith("|")) {
    // Table row — render đơn giản dưới dạng pipe-separated.
    return (
      <div key={key} className="font-mono text-[10px] text-muted">
        {line}
      </div>
    );
  }
  if (line.trim() === "") return <div key={key} className="h-2" />;
  if (line.startsWith("```")) {
    return (
      <div key={key} className="font-mono text-[10px] text-muted">
        {line}
      </div>
    );
  }
  return <div key={key}>{inline(line)}</div>;
}

/** Inline parse: **bold**, `code`, [link](url). */
function inline(text: string): React.ReactElement {
  // Tokenize: dùng regex chia thành parts.
  const parts: React.ReactElement[] = [];
  let i = 0;
  let keyN = 0;
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > lastIndex) {
      parts.push(<span key={keyN++}>{text.slice(lastIndex, m.index)}</span>);
    }
    const tok = m[0];
    if (tok.startsWith("**")) {
      parts.push(<strong key={keyN++}>{tok.slice(2, -2)}</strong>);
    } else if (tok.startsWith("`")) {
      parts.push(
        <code key={keyN++} className="bg-bg px-1 rounded text-accent">
          {tok.slice(1, -1)}
        </code>,
      );
    } else {
      const linkM = tok.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      if (linkM) {
        parts.push(
          <a key={keyN++} href={linkM[2]} className="text-accent hover:underline">
            {linkM[1]}
          </a>,
        );
      }
    }
    lastIndex = m.index + tok.length;
  }
  if (lastIndex < text.length) {
    parts.push(<span key={keyN++}>{text.slice(lastIndex)}</span>);
  }
  void i;
  return <>{parts}</>;
}

export const Route = createFileRoute("/settings/migration")({
  component: MigrationPage,
  validateSearch: (search: Record<string, unknown>) => ({
    module: typeof search.module === "string" ? search.module : undefined,
    tab: typeof search.tab === "string" ? search.tab : undefined,
    screen:
      typeof search.screen === "string" &&
      ["quick-migrate", "full-jobs", "migrated-entities", "run-all-procs"].includes(search.screen)
        ? (search.screen as "quick-migrate" | "full-jobs" | "migrated-entities" | "run-all-procs")
        : undefined,
  }),
});
