/* FullJobsScreen (Phase U) — list full-import jobs + Resume/Sync/Cancel
   + action jobs. Tách từ settings.migration.tsx (pilot refactor). */
import { createMigrationClient } from "@erp-framework/client";
import { useCallback, useEffect, useState } from "react";
import { I } from "@/components/Icons";
import { ActionJobsPanel } from "@/components/migration/ActionJobsPanel";
import { Button, Chip } from "@/components/ui";
import { dialog } from "@/lib/dialog";

const migration = createMigrationClient("");

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
  // biome-ignore lint/correctness/useExhaustiveDependencies: chủ ý refetch khi jobs đổi để cập nhật status real-time
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
    if (st === "completed" || st === "done") return "success";
    if (st === "running" || st === "queued") return "accent";
    if (st === "paused" || st === "failed") return "warning";
    // "skipped" (no-PK, lỗi vĩnh viễn) + "pending" → trung tính, không báo động.
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
                              {t.reconcile === "drift" && (
                                <Chip
                                  variant="warning"
                                  className="text-[9px]! ml-1"
                                  title={`Lệch: nguồn ${t.srcCount ?? "?"} ≠ đích ${t.tgtCount ?? "?"}`}
                                >
                                  drift {t.srcCount ?? "?"}≠{t.tgtCount ?? "?"}
                                </Chip>
                              )}
                              {t.reconcile === "ok" && (
                                <Chip
                                  variant="success"
                                  className="text-[9px]! ml-1"
                                  title="Khớp nguồn"
                                >
                                  ✓ reconcile
                                </Chip>
                              )}
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

export function FullJobsScreen({ onClose }: { onClose: () => void }) {
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
        <ActionJobsPanel />
      </div>
    </div>
  );
}
