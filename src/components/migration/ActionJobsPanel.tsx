/* ==========================================================
   ActionJobsPanel — panel "Tác vụ nền" cho action job durable
   (discover/enrich/generate/data). Job chạy async qua pg-boss nên
   bấm xong có thể thao tác tiếp; job lỗi bấm "Chạy lại" để resume
   (re-enqueue cùng args — action idempotent bỏ qua phần đã xong).
   Tự refresh 5s. Tự tạo migration client để dùng độc lập.
   ========================================================== */
import { createMigrationClient } from "@erp-framework/client";
import { useCallback, useEffect, useState } from "react";
import { I } from "@/components/Icons";
import { Button, Card, Chip } from "@/components/ui";
import { dialog } from "@/lib/dialog";

const mig = createMigrationClient("");
type JobRow = Awaited<ReturnType<typeof mig.listJobs>>[number];

const STATUS_VARIANT: Record<string, "default" | "warning" | "success" | "danger"> = {
  queued: "default",
  running: "warning",
  completed: "success",
  failed: "danger",
  canceled: "default",
};

export function ActionJobsPanel() {
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    mig
      .listJobs({})
      .then((rows) => {
        setJobs(rows);
        setErr(null);
      })
      .catch((e) => setErr(String((e as Error)?.message ?? e)))
      .finally(() => setLoading(false));
  }, []);

  // Tải lần đầu.
  useEffect(() => {
    load();
  }, [load]);

  // Auto-refresh 5s CHỈ khi còn job đang chạy/chờ — tránh poll vô hạn khi mọi
  // job đã settle. Job mới (từ panel khác) → bấm "Làm mới"; còn resume() ở đây
  // tự set queued → jobs đổi → effect chạy lại → poll bật lại.
  useEffect(() => {
    const active = jobs.some((j) => j.status === "running" || j.status === "queued");
    if (!active) return;
    const id = setInterval(load, 5000);
    return () => clearInterval(id);
  }, [jobs, load]);

  const resume = async (jobId: string) => {
    setBusy(jobId);
    try {
      await mig.resumeJob(jobId);
      load();
    } catch (e) {
      await dialog.alert(`Chạy lại lỗi: ${String((e as Error)?.message ?? e)}`);
    } finally {
      setBusy(null);
    }
  };
  const cancel = async (jobId: string) => {
    const ok = await dialog.confirm("Huỷ tác vụ này?");
    if (!ok) return;
    setBusy(jobId);
    try {
      await mig.cancelJob(jobId);
      load();
    } catch (e) {
      await dialog.alert(`Huỷ lỗi: ${String((e as Error)?.message ?? e)}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card className="p-0">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <div className="font-medium text-sm">
          Tác vụ nền {jobs.length ? `(${jobs.length})` : ""}
        </div>
        <Button size="sm" variant="default" onClick={load} icon={<I.RefreshCw size={12} />}>
          Làm mới
        </Button>
      </div>
      {loading && jobs.length === 0 && (
        <div className="px-3 py-4 text-sm text-muted">Đang tải…</div>
      )}
      {err && <div className="px-3 py-4 text-sm text-danger">{err}</div>}
      {!loading && jobs.length === 0 && !err && (
        <div className="px-3 py-6 text-center text-sm text-muted">
          Chưa có tác vụ nền. Khi chạy Khám phá / Enrich / Codegen, job sẽ hiện ở đây — lỗi thì bấm
          "Chạy lại" để resume.
        </div>
      )}
      {jobs.length > 0 && (
        <div className="divide-y divide-border">
          {jobs.map((j) => (
            <div key={j.id} className="flex items-start gap-3 px-3 py-2.5 text-sm">
              <Chip variant={STATUS_VARIANT[j.status] ?? "default"} className="text-[10px]! mt-0.5">
                {j.status}
              </Chip>
              <div className="min-w-0 flex-1">
                <div className="font-medium">
                  {j.action} · {j.module}
                  {j.attempts > 1 && (
                    <span className="ml-1 text-[11px] text-muted">(lần {j.attempts})</span>
                  )}
                </div>
                {j.message && <div className="text-[11px] text-muted">{j.message}</div>}
                {j.error && <div className="text-[11px] text-danger break-words">{j.error}</div>}
                <div className="text-[11px] text-muted">
                  {new Date(j.createdAt).toLocaleString("vi-VN")}
                  {j.durationMs != null ? ` · ${Math.round(j.durationMs / 1000)}s` : ""}
                </div>
              </div>
              <div className="flex shrink-0 gap-1.5">
                {(j.status === "failed" || j.status === "canceled") && (
                  <Button
                    size="sm"
                    variant="primary"
                    disabled={busy === j.id}
                    onClick={() => void resume(j.id)}
                  >
                    Chạy lại
                  </Button>
                )}
                {(j.status === "queued" || j.status === "running" || j.status === "failed") && (
                  <Button
                    size="sm"
                    variant="default"
                    disabled={busy === j.id}
                    onClick={() => void cancel(j.id)}
                  >
                    {j.status === "running" ? "Dừng" : "Huỷ"}
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
