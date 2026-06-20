/* JobRunner — nút chạy 1 migration action + poll status mỗi 2s + hiện
   progress/error. Dùng chung bởi Discover/Enrich/SimpleJobTab. */
import {
  createMigrationClient,
  type MigrationAction,
  type MigrationJobState,
} from "@erp-framework/client";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { I } from "@/components/Icons";
import { Button, Card, Chip } from "@/components/ui";
import { useT } from "@/hooks/useT";

const migration = createMigrationClient("");

export function JobRunner({
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
  renderForm: () => ReactNode;
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
  // biome-ignore lint/correctness/useExhaustiveDependencies: onCompleted ổn định ngoài, chủ ý chỉ chạy lại khi jobId đổi
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
      {isRunning && state?.message && (
        <div className="flex items-center gap-1.5 text-xs text-muted font-mono bg-muted/10 px-2 py-1 rounded">
          <I.Loader size={11} className="animate-spin shrink-0" />
          <span className="truncate">{state.message}</span>
        </div>
      )}
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
