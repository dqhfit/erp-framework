/* GenerateTab (Phase R) — list proc theo review status + batch codegen
   (per-proc CodegenProcButton). Tách từ settings.migration.tsx (pilot). */
import { createMigrationClient } from "@erp-framework/client";
import { useCallback, useEffect, useState } from "react";
import { I } from "@/components/Icons";
import type { ReviewStatus } from "@/components/migration/manifest-types";
import { CodegenProcButton } from "@/components/migration/ProcCodegen";
import { Button, Card, Chip, Modal } from "@/components/ui";

const migration = createMigrationClient("");

export function GenerateTab({
  moduleName,
  onChanged,
}: {
  moduleName: string;
  onChanged: () => void;
}) {
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
