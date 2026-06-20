/* BulkMigrate (Phase Q) — bulk migrate live tables + detect active procs:
   BulkMigrateSection + DetectActiveProcsDialog + BulkMigrateDialog.
   Tách từ ReviewTab.tsx. */
import { createMigrationClient, type MigrationModuleSummary } from "@erp-framework/client";
import { useCallback, useEffect, useState } from "react";
import { I } from "@/components/Icons";
import { fmtTime } from "@/components/migration/format";
import { Button, Card, Chip, Modal } from "@/components/ui";

const migration = createMigrationClient("");

export function BulkMigrateSection({ onChanged }: { onChanged: () => void }) {
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
