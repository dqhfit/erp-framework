/* ==========================================================
   settings.backup — Cấu hình sao lưu Google Drive + chạy thủ công.
   Khác CLI ở chỗ: chạy server-side, mỗi công ty cấu hình riêng,
   uploads SYNC incremental (không nén toàn bộ vào tarball).
   ========================================================== */
import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { Button, Card, Chip, Input, Textarea, FormField } from "@/components/ui";
import { I } from "@/components/Icons";
import {
  createBackupClient,
  type BackupConfigView, type BackupRun,
} from "@erp-framework/client";

const bk = createBackupClient("");

const CRON_PRESETS = [
  { label: "Mỗi ngày 3h sáng", expr: "0 3 * * *" },
  { label: "Mỗi 6 giờ", expr: "0 */6 * * *" },
  { label: "Thứ Hai 2h sáng", expr: "0 2 * * 1" },
];

function fmtBytes(n: number | null): string {
  if (n === null || n === undefined) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function fmtTime(d: string | Date | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleString("vi-VN");
}

function BackupPage() {
  const [cfg, setCfg] = useState<BackupConfigView | null>(null);
  const [keyJson, setKeyJson] = useState("");
  const [folderId, setFolderId] = useState("");
  const [cron, setCron] = useState<string>("");
  const [runs, setRuns] = useState<BackupRun[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");

  const loadConfig = useCallback(async () => {
    try {
      const c = await bk.config.get() as BackupConfigView | null;
      setCfg(c);
      if (c) {
        setFolderId(c.gdriveFolderId);
        setCron(c.scheduleCron ?? "");
      }
    } catch { /* chưa đăng nhập */ }
  }, []);

  const loadRuns = useCallback(async () => {
    try {
      const r = await bk.runs.list(10) as unknown as BackupRun[];
      setRuns(r);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { loadConfig(); loadRuns(); }, [loadConfig, loadRuns]);

  // Có job đang chạy → poll 3s.
  const hasRunning = runs.some((r) => r.status === "running");
  useEffect(() => {
    if (!hasRunning) return;
    const t = setInterval(loadRuns, 3000);
    return () => clearInterval(t);
  }, [hasRunning, loadRuns]);

  const wrap = async (fn: () => Promise<void>, ok: string) => {
    setBusy(true); setErr(""); setMsg("");
    try { await fn(); if (ok) setMsg(ok); }
    catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };

  const test = () => wrap(async () => {
    if (!keyJson.trim()) throw new Error("Dán JSON service account key trước.");
    if (!folderId.trim()) throw new Error("Nhập Folder ID Google Drive.");
    const r = await bk.config.test(keyJson.trim(), folderId.trim());
    setMsg(`✓ Kết nối được — thư mục "${r.folderName}"`);
  }, "");

  const save = () => wrap(async () => {
    await bk.config.save({
      gdriveFolderId: folderId.trim(),
      keyJson: keyJson.trim() || undefined,
      scheduleCron: cron.trim() || null,
    });
    setKeyJson("");  // không giữ key trong UI sau khi lưu.
    loadConfig();
  }, "Đã lưu cấu hình.");

  const runNow = () => wrap(async () => {
    await bk.runNow();
    loadRuns();
  }, "Đã đưa job backup vào hàng đợi.");

  return (
    <div className="overflow-y-auto h-full">
      <div className="max-w-[900px] mx-auto p-8">
        <h1 className="text-xl font-semibold mb-1">Sao lưu Google Drive</h1>
        <div className="text-sm text-muted mb-6">
          Dump PostgreSQL + đồng bộ thư mục <code>/data/uploads</code> lên một
          thư mục Google Drive bạn chọn. Files sync <b>incremental</b> (không
          re-upload file chưa đổi). Xem hướng dẫn setup service account ở{" "}
          <a href="/docs/BACKUP" className="text-accent hover:underline">docs/BACKUP.md</a>.
        </div>

        {/* === Cấu hình === */}
        <Card className="mb-4 space-y-3">
          <div className="font-semibold">Cấu hình</div>

          <FormField
            label="Service account JSON key"
            hint={cfg?.hasKey
              ? "Đã có key — chỉ điền nếu muốn thay key mới."
              : "Dán toàn bộ nội dung file JSON (từ GCP → Service Accounts → Keys)."}
          >
            <Textarea
              rows={4} placeholder='{"type":"service_account",...}'
              value={keyJson} disabled={busy}
              onChange={(e) => setKeyJson(e.target.value)}
              className="font-mono text-xs"
            />
          </FormField>

          <FormField label="Folder ID Google Drive"
            hint="Lấy từ URL: drive.google.com/drive/folders/<ID>. Phải share quyền Editor cho email service account.">
            <Input placeholder="1AbCdEfGh..."
              value={folderId} disabled={busy}
              onChange={(e) => setFolderId(e.target.value)} />
          </FormField>

          <FormField label="Lịch tự động (cron)"
            hint="Để trống = chỉ chạy thủ công khi bấm Backup ngay.">
            <div className="space-y-2">
              <div className="flex flex-wrap gap-1.5">
                {CRON_PRESETS.map((p) => (
                  <button key={p.expr} type="button"
                    onClick={() => setCron(p.expr)}
                    className={"chip cursor-pointer " + (cron === p.expr ? "chip-accent" : "")}>
                    {p.label}
                  </button>
                ))}
                <button type="button" onClick={() => setCron("")}
                  className={"chip cursor-pointer " + (!cron ? "chip-accent" : "")}>
                  Tắt
                </button>
              </div>
              <Input className="font-mono text-xs"
                placeholder="Biểu thức cron (để trống = tắt)"
                value={cron} disabled={busy}
                onChange={(e) => setCron(e.target.value)} />
            </div>
          </FormField>

          <div className="flex gap-2 pt-1">
            <Button variant="default" icon={<I.Power size={13} />}
              disabled={busy} onClick={test}>Test kết nối</Button>
            <Button variant="primary" icon={<I.Save size={13} />}
              disabled={busy || !folderId.trim()} onClick={save}>Lưu cấu hình</Button>
            <div className="flex-1" />
            <Button variant="primary" icon={<I.Save size={13} />}
              disabled={busy || !cfg?.hasKey} onClick={runNow}>
              Backup ngay
            </Button>
          </div>
        </Card>

        {/* === Lịch sử === */}
        <Card className="space-y-2">
          <div className="font-semibold">Lịch sử sao lưu</div>
          {runs.length === 0 && (
            <div className="text-sm text-muted py-3 text-center">
              Chưa có lần backup nào.
            </div>
          )}
          {runs.map((r) => (
            <div key={r.id} className="rounded-md border border-border p-3 text-sm">
              <div className="flex items-center gap-2 mb-1">
                <Chip variant={
                  r.status === "done" ? "success"
                  : r.status === "error" ? "danger" : "accent"
                }>{r.status}</Chip>
                <span className="text-muted text-xs">{r.trigger}</span>
                <span className="text-muted text-xs">{fmtTime(r.startedAt)}</span>
                <div className="flex-1" />
                {r.finishedAt && (
                  <span className="text-muted text-xs">
                    {Math.round((new Date(r.finishedAt).getTime() - new Date(r.startedAt).getTime()) / 1000)}s
                  </span>
                )}
              </div>
              {r.status === "error" && r.error && (
                <div className="text-xs text-danger">{r.error}</div>
              )}
              {r.status === "done" && (
                <div className="text-xs text-muted flex gap-4">
                  <span>DB: <b>{fmtBytes(r.dbBytes)}</b></span>
                  <span>Files mới/đổi: <b>{r.uploadsSynced}</b> ({fmtBytes(r.uploadsBytes)})</span>
                  <span>Bỏ qua: <b>{r.uploadsSkipped}</b></span>
                </div>
              )}
            </div>
          ))}
        </Card>

        {msg && <div className="mt-4"><Chip variant="success">{msg}</Chip></div>}
        {err && <div className="mt-4"><Chip variant="danger">{err}</Chip></div>}
      </div>
    </div>
  );
}

export const Route = createFileRoute("/settings/backup")({ component: BackupPage });
