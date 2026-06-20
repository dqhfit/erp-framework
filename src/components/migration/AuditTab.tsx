/* AuditTab (Tier 4) — AI sinh checklist hoàn thiện module + lưu draft.
   Tách từ settings.migration.tsx (pilot refactor). */
import { createMigrationClient } from "@erp-framework/client";
import { useEffect, useState } from "react";
import { I } from "@/components/Icons";
import { ErrorHint } from "@/components/migration/ErrorHint";
import { MarkdownPreview } from "@/components/migration/Markdown";
import { Button, Card, Chip, Textarea } from "@/components/ui";

const migration = createMigrationClient("");

interface AuditDryRunResult {
  markdown: string;
  error?: string;
  tokensIn: number;
  tokensOut: number;
  durationMs: number;
}

export function AuditTab({ moduleName }: { moduleName: string }) {
  const draftKey = `migration:draft:audit:${moduleName}`;
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<AuditDryRunResult | null>(null);
  const [editedMd, setEditedMd] = useState(() => {
    if (typeof window === "undefined") return "";
    try {
      const raw = window.localStorage.getItem(draftKey);
      return raw ? ((JSON.parse(raw) as { md?: string }).md ?? "") : "";
    } catch {
      return "";
    }
  });
  const [savedFile, setSavedFile] = useState<{
    filePath: string;
    markdown: string;
    updatedAt: string;
  } | null>(null);
  const [saveMsg, setSaveMsg] = useState("");
  const [err, setErr] = useState("");

  // Load file đã save trước (nếu có).
  // biome-ignore lint/correctness/useExhaustiveDependencies: chỉ load 1 lần khi mount module, editedMd đọc giá trị hiện tại là đủ
  useEffect(() => {
    migration
      .getAuditReport(moduleName)
      .then((r) => {
        if (r) {
          setSavedFile(r);
          if (!editedMd) setEditedMd(r.markdown);
        }
      })
      .catch(() => undefined);
  }, [moduleName]);

  // Auto-save draft.
  useEffect(() => {
    if (!editedMd) {
      window.localStorage.removeItem(draftKey);
      return;
    }
    window.localStorage.setItem(draftKey, JSON.stringify({ md: editedMd }));
  }, [editedMd, draftKey]);

  const runAudit = async () => {
    setBusy(true);
    setErr("");
    setSaveMsg("");
    try {
      const r = await migration.auditModuleDryRun(moduleName);
      setResult(r);
      if (r.markdown) setEditedMd(r.markdown);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!editedMd.trim()) return;
    setBusy(true);
    setSaveMsg("");
    setErr("");
    try {
      const r = await migration.saveAuditReport(moduleName, editedMd);
      setSaveMsg(`✓ Đã lưu ${r.length} ký tự vào ${r.filePath}`);
      // Reload savedFile.
      const reloaded = await migration.getAuditReport(moduleName);
      if (reloaded) setSavedFile(reloaded);
      // Clear draft sau save (đã commit).
      window.localStorage.removeItem(draftKey);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <Card className="p-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h3 className="font-medium">AI audit module — Tier 4</h3>
            <div className="text-xs text-muted mt-1">
              AI đọc manifest + procedures + plugin code + golden stats → sinh checklist các điểm
              cần hoàn thiện trước cutover (validate, RBAC, performance, workflow).
            </div>
          </div>
          <Button
            variant="primary"
            disabled={busy}
            onClick={runAudit}
            icon={busy ? <I.Loader size={12} /> : <I.Wand size={12} />}
          >
            {busy ? "AI đang phân tích..." : result ? "Chạy lại audit" : "Chạy AI audit"}
          </Button>
        </div>
        {err && (
          <div className="p-2 rounded border border-danger/40 bg-danger/5 text-xs mt-2">
            <div className="text-danger font-medium">Lỗi: {err}</div>
            <ErrorHint code={err} />
          </div>
        )}
        {result && (
          <div className="flex gap-3 text-[11px] text-muted mt-2 flex-wrap">
            <Chip className="text-[10px]!">{result.markdown.length} chars</Chip>
            <span>tokens in: {result.tokensIn}</span>
            <span>out: {result.tokensOut}</span>
            <span>{(result.durationMs / 1000).toFixed(1)}s</span>
            {result.error && <span className="text-warning">{result.error}</span>}
          </div>
        )}
        {savedFile && !result && (
          <div className="text-[11px] text-muted mt-2">
            File hiện có: <code>{savedFile.filePath}</code> · cập nhật{" "}
            {new Date(savedFile.updatedAt).toLocaleString("vi-VN")}
          </div>
        )}
      </Card>

      {editedMd && (
        <Card className="p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="font-medium">Audit report (Markdown — có thể sửa)</div>
            <div className="flex gap-2">
              <span className="text-[11px] text-muted self-center">
                {editedMd.length} chars · {editedMd.split("\n").length} dòng
              </span>
              <Button
                size="sm"
                variant="primary"
                disabled={busy || !editedMd.trim()}
                onClick={save}
                icon={<I.Save size={12} />}
              >
                Lưu vào file
              </Button>
            </div>
          </div>
          {saveMsg && <div className="text-[11px] text-success mb-2">{saveMsg}</div>}
          <div className="grid md:grid-cols-2 gap-3">
            <div>
              <div className="text-[11px] text-muted mb-1">Source Markdown</div>
              <Textarea
                value={editedMd}
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
                  setEditedMd(e.target.value)
                }
                className="w-full font-mono text-[11px] min-h-[500px] max-h-[700px]"
              />
            </div>
            <div>
              <div className="text-[11px] text-muted mb-1">Preview</div>
              <div className="border border-border rounded p-3 bg-surface/30 overflow-auto min-h-[500px] max-h-[700px] text-xs">
                <MarkdownPreview text={editedMd} />
              </div>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
