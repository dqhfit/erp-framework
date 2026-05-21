/* ==========================================================
   WorkflowRunPanel — Modal cho 2 việc với 1 workflow:
   1. Chạy THẬT phía SERVER (executeWorkflow) — gọi MCP/LLM thật,
      ghi bảng workflow_runs.
   2. Quản lý LỊCH chạy cron — lưu bảng schedules trên server;
      pg-boss quét mỗi phút và chạy nền (không cần app mở).
   ========================================================== */
import { useState, useEffect, useCallback } from "react";
import { Modal, Button, Chip, Input, Select } from "@/components/ui";
import { I } from "@/components/Icons";
import type { RunStep } from "@erp-framework/core";
import { createObjectsClient } from "@erp-framework/client";
import { describeCron, parseCron, nextCronRun, CRON_PRESETS } from "@/lib/cron";
import { dialog } from "@/lib/dialog";

const objects = createObjectsClient("");

interface Props {
  open: boolean;
  onClose: () => void;
  workflowId: string;
  workflowName: string;
}

interface ServerSchedule {
  id: string;
  workflowId: string;
  cronExpr: string;
  enabled: boolean;
  runCount: number;
  lastStatus?: string | null;
}

const STEP_COLOR: Record<RunStep["status"], string> = {
  ok: "text-success",
  error: "text-danger",
  skipped: "text-muted",
  paused: "text-warning",
};

export function WorkflowRunPanel({ open, onClose, workflowId, workflowName }: Props) {
  const [tab, setTab] = useState<"run" | "schedule">("run");
  const [running, setRunning] = useState(false);
  const [steps, setSteps] = useState<RunStep[]>([]);
  const [result, setResult] = useState<string>("");

  const [schedules, setSchedules] = useState<ServerSchedule[]>([]);
  const [cronExpr, setCronExpr] = useState("0 9 * * *");
  const [schErr, setSchErr] = useState("");

  const mySchedules = schedules.filter((s) => s.workflowId === workflowId);

  const loadSchedules = useCallback(() => {
    objects.schedules.list()
      .then((rows) => setSchedules(rows as ServerSchedule[]))
      .catch((e) => setSchErr((e as Error).message));
  }, []);

  useEffect(() => { if (open) loadSchedules(); }, [open, loadSchedules]);

  const doRun = async () => {
    setRunning(true);
    setSteps([]);
    setResult("");
    try {
      // Chạy phía server — server nạp graph từ DB, dùng runner thật.
      const r = await objects.workflows.trigger(workflowId);
      const runs = await objects.workflows.runs(workflowId);
      const run = (runs as Array<{ id: string; steps?: unknown }>)
        .find((x) => x.id === r.runId);
      if (run) setSteps((run.steps ?? []) as RunStep[]);
      setResult(
        r.status === "completed" ? "✓ Workflow chạy xong."
        : r.status === "paused" ? "⏸ Workflow tạm dừng (chờ duyệt)."
        : "✗ Workflow lỗi.",
      );
    } catch (e) {
      setResult("✗ Lỗi: " + (e as Error).message);
    } finally {
      setRunning(false);
    }
  };

  const handleAddSchedule = async () => {
    if (!parseCron(cronExpr)) {
      void dialog.alert("Biểu thức cron không hợp lệ. Định dạng: phút giờ ngày tháng thứ.",
        { title: "Cron sai" });
      return;
    }
    setSchErr("");
    try {
      await objects.schedules.save({ workflowId, cronExpr, enabled: true });
      loadSchedules();
    } catch (e) { setSchErr((e as Error).message); }
  };

  const handleToggle = async (s: ServerSchedule) => {
    try {
      await objects.schedules.save({
        id: s.id, workflowId: s.workflowId, cronExpr: s.cronExpr,
        enabled: !s.enabled,
      });
      loadSchedules();
    } catch (e) { setSchErr((e as Error).message); }
  };

  const handleDeleteSchedule = async (id: string) => {
    const ok = await dialog.confirm("Xoá lịch chạy này?", {
      title: "Xoá lịch", confirmText: "Xoá", danger: true,
    });
    if (!ok) return;
    try { await objects.schedules.delete(id); loadSchedules(); }
    catch (e) { setSchErr((e as Error).message); }
  };

  return (
    <Modal open={open} onClose={onClose} title={`Vận hành — ${workflowName}`} width={620}>
      {/* Tabs */}
      <div className="flex gap-1 mb-4 border-b border-border">
        <button type="button" onClick={() => setTab("run")}
          className={"px-3 py-1.5 text-sm border-b-2 -mb-px " +
            (tab === "run" ? "border-accent text-text font-medium" : "border-transparent text-muted")}>
          Chạy thật
        </button>
        <button type="button" onClick={() => setTab("schedule")}
          className={"px-3 py-1.5 text-sm border-b-2 -mb-px " +
            (tab === "schedule" ? "border-accent text-text font-medium" : "border-transparent text-muted")}>
          Lịch chạy {mySchedules.length > 0 && <Chip>{mySchedules.length}</Chip>}
        </button>
      </div>

      {tab === "run" && (
        <div>
          <div className="text-xs text-muted mb-3">
            Chạy thật trên server: gọi MCP tool và LLM thật, có thể thay đổi
            dữ liệu. Mỗi bước được ghi vào bảng workflow_runs.
          </div>
          <Button variant="primary" icon={<I.Play size={13} />} onClick={doRun} disabled={running}>
            {running ? "Đang chạy…" : "Chạy workflow"}
          </Button>

          {steps.length > 0 && (
            <div className="mt-3 border border-border rounded-md divide-y divide-border max-h-[320px] overflow-auto">
              {steps.map((s, i) => (
                <div key={i} className="px-3 py-2 text-sm flex items-start gap-2">
                  <span className={"font-mono text-xs shrink-0 " + STEP_COLOR[s.status]}>
                    {s.status === "ok" ? "✓" : s.status === "error" ? "✗"
                      : s.status === "paused" ? "⏸" : "○"}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{s.label} <span className="text-muted text-xs">({s.kind})</span></div>
                    <div className="text-xs text-muted">{s.detail}</div>
                  </div>
                  <span className="text-[10px] text-muted font-mono shrink-0">{s.durationMs}ms</span>
                </div>
              ))}
            </div>
          )}
          {result && (
            <div className={"mt-3 text-sm font-medium " +
              (result.startsWith("✓") ? "text-success"
                : result.startsWith("⏸") ? "text-warning" : "text-danger")}>
              {result}
            </div>
          )}
        </div>
      )}

      {tab === "schedule" && (
        <div>
          <div className="text-xs text-muted mb-3">
            Lịch tự động chạy workflow theo cron. Lưu trên server — pg-boss
            chạy nền mỗi phút, không cần mở app.
          </div>

          <div className="flex items-end gap-2 mb-3">
            <div className="flex-1">
              <label className="text-xs text-muted block mb-1">Biểu thức cron</label>
              <Input value={cronExpr} onChange={(e) => setCronExpr(e.target.value)}
                placeholder="0 9 * * *" />
            </div>
            <Select value="" onChange={(e) => e.target.value && setCronExpr(e.target.value)}
              className="w-44">
              <option value="">Mẫu sẵn…</option>
              {CRON_PRESETS.map((p) => (
                <option key={p.expr} value={p.expr}>{p.label}</option>
              ))}
            </Select>
            <Button variant="primary" icon={<I.Plus size={13} />} onClick={handleAddSchedule}>
              Thêm lịch
            </Button>
          </div>
          <div className="text-xs text-muted mb-3">{describeCron(cronExpr)}</div>
          {schErr && <Chip variant="danger">{schErr}</Chip>}

          {mySchedules.length === 0 ? (
            <div className="text-center text-muted py-6 text-sm border border-border rounded-md">
              Chưa có lịch nào cho workflow này.
            </div>
          ) : (
            <div className="border border-border rounded-md divide-y divide-border">
              {mySchedules.map((s) => {
                const next = s.enabled ? nextCronRun(s.cronExpr) : null;
                return (
                  <div key={s.id} className="px-3 py-2 flex items-center gap-2 text-sm">
                    <div className="min-w-0 flex-1">
                      <div className="font-mono font-medium flex items-center gap-2">
                        {s.cronExpr}
                        {s.enabled
                          ? <Chip variant="success">Đang bật</Chip>
                          : <Chip>Tắt</Chip>}
                      </div>
                      <div className="text-xs text-muted">
                        {describeCron(s.cronExpr)}
                        {" · "}đã chạy {s.runCount} lần
                        {s.lastStatus ? ` · gần nhất: ${s.lastStatus}` : ""}
                        {next ? ` · kế: ${next.toLocaleString("vi-VN")}` : ""}
                      </div>
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => handleToggle(s)}
                      icon={<I.Power size={12} />} />
                    <Button variant="ghost" size="sm" onClick={() => handleDeleteSchedule(s.id)}
                      icon={<I.Trash size={12} />} />
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
