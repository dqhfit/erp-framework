/* ReviewTab — trạng thái review module + finalize + bulk-migrate live
   tables (BulkMigrateSection/DetectActiveProcsDialog/BulkMigrateDialog) +
   ProgressBar. Tách từ settings.migration.tsx (pilot refactor). */
import { createMigrationClient, type MigrationModuleSummary } from "@erp-framework/client";
import { useCallback, useEffect, useState } from "react";
import { I } from "@/components/Icons";
import { fmtTime } from "@/components/migration/format";
import type { ReviewStatus } from "@/components/migration/manifest-types";
import { Button, Card, Chip, Modal } from "@/components/ui";
import { dialog } from "@/lib/dialog";

const migration = createMigrationClient("");

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

export function ReviewTab({
  moduleName,
  onChanged,
}: {
  moduleName: string;
  onChanged: () => void;
}) {
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
