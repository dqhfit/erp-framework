/* ReviewTab — trạng thái review module + finalize + bulk-migrate live
   tables (BulkMigrateSection/DetectActiveProcsDialog/BulkMigrateDialog) +
   ProgressBar. Tách từ settings.migration.tsx (pilot refactor). */
import { createMigrationClient } from "@erp-framework/client";
import { useCallback, useEffect, useState } from "react";
import { I } from "@/components/Icons";
import { BulkMigrateSection } from "@/components/migration/BulkMigrate";
import type { ReviewStatus } from "@/components/migration/manifest-types";
import { Button, Card, Chip } from "@/components/ui";
import { dialog } from "@/lib/dialog";

const migration = createMigrationClient("");

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
