import { I } from "@/components/Icons";
import { Button, Card, Chip, FormField, Input, Textarea } from "@/components/ui";
import { useT } from "@/hooks/useT";
import { type BackupConfigView, type BackupRun, createBackupClient } from "@erp-framework/client";
/* ==========================================================
   settings.backup — Cấu hình sao lưu Google Drive + chạy thủ công.
   Khác CLI ở chỗ: chạy server-side, mỗi công ty cấu hình riêng,
   uploads SYNC incremental (không nén toàn bộ vào tarball).
   ========================================================== */
import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";

const bk = createBackupClient("");

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
  const t = useT();

  const CRON_PRESETS = [
    { label: "Mỗi ngày 3h sáng", expr: "0 3 * * *" },
    { label: "Mỗi 6 giờ", expr: "0 */6 * * *" },
    { label: "Thứ Hai 2h sáng", expr: "0 2 * * 1" },
  ];

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
      const c = (await bk.config.get()) as BackupConfigView | null;
      setCfg(c);
      if (c) {
        setFolderId(c.gdriveFolderId);
        setCron(c.scheduleCron ?? "");
      }
    } catch {
      /* chưa đăng nhập */
    }
  }, []);

  const loadRuns = useCallback(async () => {
    try {
      const r = (await bk.runs.list(10)) as unknown as BackupRun[];
      setRuns(r);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    loadConfig();
    loadRuns();
  }, [loadConfig, loadRuns]);

  // Có job đang chạy → poll 3s.
  const hasRunning = runs.some((r) => r.status === "running");
  useEffect(() => {
    if (!hasRunning) return;
    const t = setInterval(loadRuns, 3000);
    return () => clearInterval(t);
  }, [hasRunning, loadRuns]);

  const wrap = async (fn: () => Promise<void>, ok: string) => {
    setBusy(true);
    setErr("");
    setMsg("");
    try {
      await fn();
      if (ok) setMsg(ok);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const test = () =>
    wrap(async () => {
      if (!keyJson.trim()) throw new Error("Dán JSON service account key trước.");
      if (!folderId.trim()) throw new Error("Nhập Folder ID Google Drive.");
      const r = await bk.config.test(keyJson.trim(), folderId.trim());
      setMsg(`✓ Kết nối được — thư mục "${r.folderName}"`);
    }, "");

  const save = () =>
    wrap(async () => {
      await bk.config.save({
        gdriveFolderId: folderId.trim(),
        keyJson: keyJson.trim() || undefined,
        scheduleCron: cron.trim() || null,
      });
      setKeyJson(""); // không giữ key trong UI sau khi lưu.
      loadConfig();
    }, t("settings.backup.save_ok"));

  const runNow = () =>
    wrap(async () => {
      await bk.runNow();
      loadRuns();
    }, t("settings.backup.run_ok"));

  return (
    <div className="overflow-y-auto h-full">
      <div className="max-w-[900px] mx-auto p-8">
        <h1 className="text-xl font-semibold mb-1">{t("settings.backup.title")}</h1>
        <div className="text-sm text-muted mb-6">
          {t("settings.backup.subtitle")}
        </div>

        {/* === Cấu hình === */}
        <Card className="mb-4 space-y-3">
          <div className="font-semibold">{t("settings.backup.config_title")}</div>

          {/* Hướng dẫn đăng nhập Drive trên web + lấy Folder ID. */}
          <details className="rounded-md border border-border bg-surface-2/40 text-sm group">
            <summary className="cursor-pointer select-none px-3 py-2 font-medium flex items-center gap-2 hover:bg-surface-2/70">
              <I.HelpCircle size={14} />
              <span>{t("settings.backup.guide_title")}</span>
              <span className="ml-auto text-xs text-muted group-open:hidden">{t("settings.backup.guide_open")}</span>
              <span className="ml-auto text-xs text-muted hidden group-open:inline">{t("settings.backup.guide_close")}</span>
            </summary>
            <div className="px-3 pb-3 pt-1 space-y-3 text-[13px] leading-relaxed">
              <ol className="list-decimal pl-5 space-y-1.5">
                <li>
                  Mở{" "}
                  <a
                    href="https://drive.google.com/"
                    target="_blank"
                    rel="noreferrer"
                    className="text-accent hover:underline"
                  >
                    drive.google.com
                  </a>{" "}
                  trên trình duyệt và <b>đăng nhập</b> bằng tài khoản Google sẽ dùng để lưu backup
                  (có thể là tài khoản cá nhân hoặc Workspace).
                </li>
                <li>
                  Tạo một thư mục đích, ví dụ <code>ERP Backups</code> (hoặc mở thư mục đã có).
                </li>
                <li>
                  Vào thư mục đó. Nhìn vào thanh địa chỉ trình duyệt — URL có dạng:
                  <div className="my-1 font-mono text-xs bg-surface-2 rounded px-2 py-1 break-all">
                    https://drive.google.com/drive/folders/
                    <b className="text-accent">1AbCdEfGhIjKlMnOpQrStUv...</b>
                  </div>
                  Phần in đậm sau <code>/folders/</code> chính là <b>Folder ID</b> — copy và dán vào
                  ô bên dưới.
                </li>
                <li>
                  Bấm chuột phải vào thư mục → <b>Share</b> (Chia sẻ) → dán email service account
                  (dạng <code>...@&lt;project&gt;.iam.gserviceaccount.com</code>) → chọn quyền{" "}
                  <b>Editor</b> → <b>Send</b>. Bước này bắt buộc, nếu không service account sẽ không
                  nhìn thấy thư mục.
                </li>
                <li>
                  Quay lại đây, bấm <b>Test kết nối</b> để xác minh, rồi <b>Lưu cấu hình</b>.
                </li>
              </ol>
              <div className="text-xs text-muted">
                Mẹo: nếu URL có thêm tham số kiểu <code>?usp=sharing</code>, chỉ lấy đoạn ID phía
                trước dấu <code>?</code>. Không lấy nhầm ID của <i>file</i> (URL có{" "}
                <code>/file/d/</code>) — phải là <code>/drive/folders/</code>.
              </div>
              <div className="text-xs text-muted">
                Chưa có service account? Xem{" "}
                <a href="/docs/BACKUP" className="text-accent hover:underline">
                  docs/BACKUP.md
                </a>{" "}
                — mục "Setup Google Drive (một-lần)" hướng dẫn tạo project GCP, bật Drive API và tạo
                JSON key.
              </div>
            </div>
          </details>

          <FormField
            label={t("settings.backup.key_label")}
            hint={
              cfg?.hasKey
                ? t("settings.backup.key_hint_has")
                : t("settings.backup.key_hint_no")
            }
          >
            <Textarea
              rows={4}
              placeholder='{"type":"service_account",...}'
              value={keyJson}
              disabled={busy}
              onChange={(e) => setKeyJson(e.target.value)}
              className="font-mono text-xs"
            />
          </FormField>

          <FormField
            label={t("settings.backup.folder_label")}
            hint={t("settings.backup.folder_hint")}
          >
            <Input
              placeholder="1AbCdEfGh..."
              value={folderId}
              disabled={busy}
              onChange={(e) => setFolderId(e.target.value)}
            />
          </FormField>

          <FormField
            label={t("settings.backup.cron_label")}
            hint={t("settings.backup.cron_hint")}
          >
            <div className="space-y-2">
              <div className="flex flex-wrap gap-1.5">
                {CRON_PRESETS.map((p) => (
                  <button
                    key={p.expr}
                    type="button"
                    onClick={() => setCron(p.expr)}
                    className={`chip cursor-pointer ${cron === p.expr ? "chip-accent" : ""}`}
                  >
                    {p.label}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setCron("")}
                  className={`chip cursor-pointer ${!cron ? "chip-accent" : ""}`}
                >
                  {t("settings.backup.cron_off")}
                </button>
              </div>
              <Input
                className="font-mono text-xs"
                placeholder="Biểu thức cron (để trống = tắt)"
                value={cron}
                disabled={busy}
                onChange={(e) => setCron(e.target.value)}
              />
            </div>
          </FormField>

          <div className="flex gap-2 pt-1">
            <Button variant="default" icon={<I.Power size={13} />} disabled={busy} onClick={test}>
              {t("settings.backup.test_btn")}
            </Button>
            <Button
              variant="primary"
              icon={<I.Save size={13} />}
              disabled={busy || !folderId.trim()}
              onClick={save}
            >
              {t("settings.backup.save_btn")}
            </Button>
            <div className="flex-1" />
            <Button
              variant="primary"
              icon={<I.Save size={13} />}
              disabled={busy || !cfg?.hasKey}
              onClick={runNow}
            >
              {t("settings.backup.run_btn")}
            </Button>
          </div>
        </Card>

        {/* === Lịch sử === */}
        <Card className="space-y-2">
          <div className="font-semibold">{t("settings.backup.history_title")}</div>
          {runs.length === 0 && (
            <div className="text-sm text-muted py-3 text-center">{t("settings.backup.history_empty")}</div>
          )}
          {runs.map((r) => (
            <div key={r.id} className="rounded-md border border-border p-3 text-sm">
              <div className="flex items-center gap-2 mb-1">
                <Chip
                  variant={
                    r.status === "done" ? "success" : r.status === "error" ? "danger" : "accent"
                  }
                >
                  {r.status}
                </Chip>
                <span className="text-muted text-xs">{r.trigger}</span>
                <span className="text-muted text-xs">{fmtTime(r.startedAt)}</span>
                <div className="flex-1" />
                {r.finishedAt && (
                  <span className="text-muted text-xs">
                    {Math.round(
                      (new Date(r.finishedAt).getTime() - new Date(r.startedAt).getTime()) / 1000,
                    )}
                    s
                  </span>
                )}
              </div>
              {r.status === "error" && r.error && (
                <div className="text-xs text-danger">{r.error}</div>
              )}
              {r.status === "done" && (
                <div className="text-xs text-muted flex gap-4">
                  <span>
                    DB: <b>{fmtBytes(r.dbBytes)}</b>
                  </span>
                  <span>
                    Files mới/đổi: <b>{r.uploadsSynced}</b> ({fmtBytes(r.uploadsBytes)})
                  </span>
                  <span>
                    Bỏ qua: <b>{r.uploadsSkipped}</b>
                  </span>
                </div>
              )}
            </div>
          ))}
        </Card>

        {msg && (
          <div className="mt-4">
            <Chip variant="success">{msg}</Chip>
          </div>
        )}
        {err && (
          <div className="mt-4">
            <Chip variant="danger">{err}</Chip>
          </div>
        )}
      </div>
    </div>
  );
}

export const Route = createFileRoute("/settings/backup")({ component: BackupPage });
