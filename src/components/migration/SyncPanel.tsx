/* ==========================================================
   SyncPanel — Tab "Sync & Cutover" trong ModuleDetailPane.
   Hiển thị trạng thái delta-sync MSSQL->PG cho một module:
   - Chưa cấu hình: form bật sync (chọn conn + bảng + cron)
   - Đã cấu hình: toggle, lag badge per-bảng, sync-now, CT script, cutover
   ========================================================== */

import {
  createMigrationSyncClient,
  createMssqlConnectionsClient,
  type MssqlConnectionView,
  type SyncModuleRow,
  type SyncTableRow,
} from "@erp-framework/client";
import { useCallback, useEffect, useRef, useState } from "react";
import { I } from "@/components/Icons";
import { SqlBlock } from "@/components/SqlHighlight";
import { Button, Card, Chip, Modal, Switch } from "@/components/ui";
import { useT } from "@/hooks/useT";
import { dialog } from "@/lib/dialog";
import { CutoverDialog } from "./CutoverDialog";

const syncApi = createMigrationSyncClient("");
const connApi = createMssqlConnectionsClient("");

interface Props {
  moduleName: string;
  manifestTables: string[];
  onChanged: () => void;
}

export function SyncPanel({ moduleName, manifestTables, onChanged }: Props) {
  const t = useT();
  const [loading, setLoading] = useState(true);
  const [syncMod, setSyncMod] = useState<SyncModuleRow | null>(null);
  const [connections, setConnections] = useState<MssqlConnectionView[]>([]);
  const [busy, setBusy] = useState(false);
  const [ctScript, setCtScript] = useState<string | null>(null);
  const [showCutover, setShowCutover] = useState(false);

  // Enable-sync form
  const [formConnId, setFormConnId] = useState("");
  const [formTables, setFormTables] = useState<string[]>([]);
  const [formCron, setFormCron] = useState("*/5 * * * *");
  const initDoneRef = useRef(false);

  const reload = useCallback(() => {
    setLoading(true);
    Promise.all([syncApi.listSyncModules(), connApi.list()])
      .then(([mods, conns]) => {
        setSyncMod(mods.find((m) => m.module === moduleName) ?? null);
        setConnections(conns);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [moduleName]);

  // Khởi tạo form defaults một lần sau khi connections load.
  useEffect(() => {
    if (initDoneRef.current || connections.length === 0) return;
    initDoneRef.current = true;
    const def = connections.find((c) => c.isDefault) ?? connections[0];
    if (def) setFormConnId(def.id);
    if (manifestTables.length > 0) setFormTables(manifestTables);
  }, [connections, manifestTables]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset khi moduleName đổi
  useEffect(() => {
    initDoneRef.current = false;
    reload();
  }, [moduleName]);

  const handleEnableSync = async () => {
    if (!formConnId) {
      dialog.alert(t("sync.need_conn_tables"));
      return;
    }
    setBusy(true);
    try {
      await syncApi.enableModuleSync({
        connectionId: formConnId,
        module: moduleName,
        cronExpr: formCron,
        tables: formTables.map((name) => ({ tableName: name, mode: "ct" as const })),
      });
      onChanged();
      reload();
    } catch (e) {
      dialog.alert((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleToggleSync = async (mod: SyncModuleRow) => {
    setBusy(true);
    try {
      if (mod.enabled) {
        await syncApi.disableModuleSync(mod.connectionId, mod.module);
      } else {
        await syncApi.enableModuleSync({
          connectionId: mod.connectionId,
          module: mod.module,
          cronExpr: mod.cronExpr,
          tables: mod.tables.map((tbl) => ({
            tableName: tbl.tableName,
            pkColumn: tbl.pkColumn ?? undefined,
            mode: tbl.mode as "ct" | "rescan" | "manual",
          })),
        });
      }
      reload();
    } catch (e) {
      dialog.alert((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleSyncNow = async (mod: SyncModuleRow) => {
    setBusy(true);
    try {
      await syncApi.runModuleSyncNow(mod.connectionId, mod.module);
      reload();
    } catch (e) {
      dialog.alert((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleCtScript = async (mod: SyncModuleRow) => {
    try {
      const { script } = await syncApi.generateCtEnableScript(
        mod.connectionId,
        mod.tables.map((tbl) => tbl.tableName),
      );
      setCtScript(script);
    } catch (e) {
      dialog.alert((e as Error).message);
    }
  };

  if (loading) {
    return <div className="p-6 text-muted text-sm">{t("common.loading")}</div>;
  }

  /* ── No sync configured yet ── */
  if (!syncMod) {
    return (
      <div className="p-4 max-w-xl space-y-4">
        <p className="text-sm text-muted">{t("sync.not_configured_hint")}</p>
        <div className="space-y-3">
          <div>
            <p className="text-xs text-muted mb-1">{t("sync.form_conn")}</p>
            <select
              className="input w-full"
              value={formConnId}
              onChange={(e) => setFormConnId(e.target.value)}
            >
              {connections.length === 0 && <option value="">{t("sync.no_connections")}</option>}
              {connections.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} — {c.host}/{c.database}
                </option>
              ))}
            </select>
          </div>

          <div>
            <p className="text-xs text-muted mb-1">
              {t("sync.form_tables")} ({formTables.length}/{manifestTables.length})
            </p>
            <div className="max-h-48 overflow-y-auto border border-border rounded p-2 space-y-1 bg-bg-soft">
              {manifestTables.length === 0 ? (
                <p className="text-xs text-muted p-1">{t("sync.no_manifest_tables")}</p>
              ) : (
                manifestTables.map((tbl) => (
                  <label key={tbl} className="flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formTables.includes(tbl)}
                      onChange={(e) =>
                        setFormTables((prev) =>
                          e.target.checked ? [...prev, tbl] : prev.filter((x) => x !== tbl),
                        )
                      }
                    />
                    <span className="font-mono text-xs">{tbl}</span>
                  </label>
                ))
              )}
            </div>
          </div>

          <div>
            <p className="text-xs text-muted mb-1">{t("sync.form_cron")}</p>
            <input
              className="input w-full font-mono text-sm"
              value={formCron}
              onChange={(e) => setFormCron(e.target.value)}
            />
          </div>

          <Button
            variant="primary"
            onClick={handleEnableSync}
            disabled={busy || !formConnId || formTables.length === 0}
          >
            <I.RefreshCw size={13} className="mr-1" />
            {t("sync.btn_enable")}
          </Button>
        </div>
      </div>
    );
  }

  /* ── Sync configured ── */
  const isCutover = syncMod.tables.some((t) => t.status === "cutover");

  return (
    <div className="p-4 space-y-4">
      {/* Module header */}
      <Card className="p-3">
        <div className="flex flex-wrap items-center gap-3">
          <Switch
            checked={syncMod.enabled}
            onChange={() => handleToggleSync(syncMod)}
            label={syncMod.enabled ? t("sync.status_enabled") : t("sync.status_disabled")}
            disabled={busy}
          />
          {syncMod.heartbeatAt && (
            <Chip variant="warning">
              <I.RefreshCw size={11} className="mr-1 animate-spin" />
              {t("sync.status_running")}
            </Chip>
          )}
          <span className="text-xs text-muted">cron: {syncMod.cronExpr}</span>
          <div className="flex-1" />
          <Button
            size="sm"
            variant="default"
            onClick={() => handleSyncNow(syncMod)}
            disabled={busy || !syncMod.enabled}
          >
            <I.RefreshCw size={13} className="mr-1" />
            {t("sync.btn_sync_now")}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => handleCtScript(syncMod)} disabled={busy}>
            <I.Terminal size={13} className="mr-1" />
            {t("sync.btn_ct_script")}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setShowCutover(true)}
            disabled={busy}
            className={
              isCutover ? "text-danger border-danger/40" : "text-warning border-warning/40"
            }
          >
            {isCutover ? t("sync.btn_rollback") : t("sync.btn_cutover")}
          </Button>
        </div>
      </Card>

      {/* Tables */}
      <div className="space-y-2">
        <p className="text-xs text-muted font-medium uppercase tracking-wide">
          {t("sync.tables_heading")} ({syncMod.tables.length})
        </p>
        {syncMod.tables.length === 0 ? (
          <p className="text-sm text-muted">{t("sync.no_tables")}</p>
        ) : (
          syncMod.tables.map((tbl) => <SyncTableCard key={tbl.id} tbl={tbl} />)
        )}
      </div>

      {/* CT Script modal */}
      {ctScript && (
        <Modal
          open
          onClose={() => setCtScript(null)}
          title={t("sync.ct_script_title")}
          width={640}
          footer={
            <Button
              size="sm"
              variant="ghost"
              onClick={() => navigator.clipboard.writeText(ctScript)}
            >
              <I.Copy size={13} className="mr-1" />
              {t("common.copy")}
            </Button>
          }
        >
          <p className="text-sm text-muted mb-3">{t("sync.ct_script_hint")}</p>
          <SqlBlock text={ctScript} />
        </Modal>
      )}

      {/* Cutover dialog */}
      {showCutover && (
        <CutoverDialog
          moduleName={syncMod.module}
          connectionId={syncMod.connectionId}
          isCutover={isCutover}
          onDone={() => {
            setShowCutover(false);
            reload();
            onChanged();
          }}
          onClose={() => setShowCutover(false)}
        />
      )}
    </div>
  );
}

/* ── Per-table status card ── */
function SyncTableCard({ tbl }: { tbl: SyncTableRow }) {
  const t = useT();
  const pending = tbl.pendingChanges ?? 0;
  const lagVariant: "success" | "warning" | "danger" =
    pending > 1000 ? "danger" : pending > 100 ? "warning" : "success";

  const syncedAt = tbl.lastSyncedAt ? new Date(tbl.lastSyncedAt) : null;
  const syncedAgo = syncedAt ? Date.now() - syncedAt.getTime() : Number.POSITIVE_INFINITY;
  const syncAgeVariant: "success" | "warning" | "danger" =
    syncedAgo < 10 * 60 * 1000 ? "success" : syncedAgo < 30 * 60 * 1000 ? "warning" : "danger";

  return (
    <div className="border border-border rounded px-3 py-2 flex flex-wrap items-center gap-3 text-sm">
      <span className="font-mono text-xs flex-1 min-w-0 truncate text-text">{tbl.tableName}</span>

      <Chip variant={lagVariant}>{t("sync.pending_label", { count: pending })}</Chip>

      {syncedAt && <Chip variant={syncAgeVariant}>{syncedAt.toLocaleTimeString("vi-VN")}</Chip>}

      <span className="text-xs text-muted tabular-nums">
        ↑{tbl.insertsCount} ↺{tbl.updatesCount} ↓{tbl.deletesCount}
      </span>

      <Chip variant="default">{tbl.mode}</Chip>

      {tbl.status === "error" && (
        <Chip variant="danger" title={tbl.lastError ?? undefined}>
          {t("sync.status_error")}
        </Chip>
      )}
      {tbl.status === "reseed_required" && <Chip variant="warning">{t("sync.status_reseed")}</Chip>}
      {tbl.status === "cutover" && <Chip variant="success">{t("sync.status_cutover")}</Chip>}
    </div>
  );
}
