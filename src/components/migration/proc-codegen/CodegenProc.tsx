/* CodegenProc — codegen 1 proc (Tier B/C): button + dialog dry-run/apply +
   preview code. Tách từ ProcCodegen.tsx. */
import { createMigrationClient } from "@erp-framework/client";
import { useEffect, useState } from "react";
import { I } from "@/components/Icons";
import { ErrorHint } from "@/components/migration/ErrorHint";
import { Button, Card, Chip, Modal, Textarea } from "@/components/ui";

const migration = createMigrationClient("");

interface CodegenDryRunResult {
  procName: string;
  manifestTier: "B" | "C" | "D";
  output:
    | {
        tier: "B";
        name: string;
        label: string;
        description: string;
        paramsSchema: Array<Record<string, unknown>>;
        code: string;
      }
    | { tier: "D"; fileName: string; exportName: string; description: string; code: string }
    | null;
  error?: string;
  raw?: string;
  tokensIn: number;
  tokensOut: number;
  durationMs: number;
}

export function CodegenProcButton({
  moduleName,
  procName,
  suggestedTier,
}: {
  moduleName: string;
  procName: string;
  suggestedTier?: string;
}) {
  const [open, setOpen] = useState(false);
  const tierLocked = suggestedTier === "C";
  return (
    <div className="pt-2 border-t border-border mt-2">
      <Button
        size="sm"
        variant="primary"
        onClick={() => setOpen(true)}
        disabled={tierLocked}
        icon={<I.Wand size={12} />}
        title={tierLocked ? "Tier C (workflow scheduled) — chưa hỗ trợ codegen" : ""}
      >
        Sinh code (AI codegen)
      </Button>
      {tierLocked && (
        <span className="text-[10px] text-muted ml-2">
          Tier C — workflow scheduled, dùng tay (chưa AI)
        </span>
      )}
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={`AI codegen: ${procName}`}
        width={1000}
      >
        <CodegenProcDialog
          moduleName={moduleName}
          procName={procName}
          onDone={() => setOpen(false)}
        />
      </Modal>
    </div>
  );
}

function CodegenProcDialog({
  moduleName,
  procName,
  onDone,
}: {
  moduleName: string;
  procName: string;
  onDone: () => void;
}) {
  const draftKey = `migration:draft:codegen:${moduleName}:${procName}`;
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<CodegenDryRunResult | null>(null);
  const [err, setErr] = useState("");
  // Phase Q4 — pre-flight check: bảng proc đụng đã migrate hết chưa.
  const [migStatus, setMigStatus] = useState<{
    active: boolean;
    isClean: boolean;
    canCodegen: boolean;
    missingTables: Array<{ table: string; reason: string }>;
    touchedTables: string[];
    suggestedAction: "codegen" | "wait" | "mark-inactive";
  } | null>(null);
  const [overrideDirty, setOverrideDirty] = useState(false);
  useEffect(() => {
    migration
      .getProcMigrationStatus(moduleName, procName)
      .then(setMigStatus)
      .catch(() => setMigStatus(null));
  }, [moduleName, procName]);
  // Editable code trong textarea — persist localStorage để đóng/mở browser
  // không mất draft chưa apply.
  const [editedCode, setEditedCode] = useState(() => {
    if (typeof window === "undefined") return "";
    try {
      const raw = window.localStorage.getItem(draftKey);
      if (raw) {
        const d = JSON.parse(raw) as { code?: string; result?: CodegenDryRunResult };
        if (d.result) setTimeout(() => setResult(d.result!), 0);
        return d.code ?? "";
      }
    } catch {
      /* ignore */
    }
    return "";
  });
  const [overwrite, setOverwrite] = useState(false);

  // Auto-save draft khi code/result đổi.
  useEffect(() => {
    if (!editedCode && !result) {
      window.localStorage.removeItem(draftKey);
      return;
    }
    window.localStorage.setItem(draftKey, JSON.stringify({ code: editedCode, result }));
  }, [editedCode, result, draftKey]);
  const [applyResult, setApplyResult] = useState<{
    type: "success" | "conflict";
    message: string;
    href?: string;
  } | null>(null);

  const runDryRun = async () => {
    setBusy(true);
    setErr("");
    setResult(null);
    setApplyResult(null);
    try {
      const r = await migration.codegenProcDryRun(moduleName, procName);
      setResult(r);
      if (r.output) setEditedCode(r.output.code);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const apply = async () => {
    if (!result?.output) return;
    setBusy(true);
    setErr("");
    setApplyResult(null);
    try {
      const out = result.output;
      const r = await migration.codegenProcApply({
        module: moduleName,
        tier: out.tier,
        code: editedCode,
        ...(out.tier === "B"
          ? {
              name: out.name,
              label: out.label,
              description: out.description,
              paramsSchema: out.paramsSchema,
            }
          : {
              fileName: out.fileName,
              overwrite,
            }),
      });
      if (r.tier === "B") {
        setApplyResult({
          type: "success",
          message: `${r.upserted === "created" ? "✓ Tạo mới" : "↻ Cập nhật"} procedure "${r.name}"`,
          href: `/procedures/${r.procedureId}`,
        });
        // Clear draft sau khi apply — đã commit vào DB.
        window.localStorage.removeItem(draftKey);
      } else {
        if (r.upserted === "conflict") {
          setApplyResult({ type: "conflict", message: r.message ?? "File đã tồn tại" });
        } else {
          setApplyResult({
            type: "success",
            message: `${r.upserted === "created" ? "✓ Tạo" : "↻ Ghi đè"} file ${r.filePath}`,
          });
          window.localStorage.removeItem(draftKey);
        }
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const isDirty = migStatus != null && (!migStatus.isClean || !migStatus.active) && !overrideDirty;

  return (
    <div className="space-y-3 text-xs">
      {migStatus && !migStatus.active && (
        <div className="p-2.5 rounded border border-muted/40 bg-surface text-muted">
          <div className="font-medium flex items-center gap-1.5">
            <I.AlertCircle size={12} /> Proc này đã đánh dấu "không còn dùng" (inactive)
          </div>
          <div className="mt-1 text-[11px]">
            Phase Q1 đã ghi proc này active=false sau khi phân tích hoạt động MSSQL. Cân nhắc skip
            codegen — hoặc đổi lại active=true qua tab Review nếu muốn migrate.
          </div>
        </div>
      )}
      {migStatus?.active && !migStatus.isClean && (
        <div className="p-2.5 rounded border border-warning/40 bg-warning/5">
          <div className="font-medium text-warning flex items-center gap-1.5">
            <I.AlertCircle size={12} /> Đang chờ {migStatus.missingTables.length} bảng migrate data
          </div>
          <div className="mt-1 text-[11px] text-muted">
            Codegen có thể sinh code đụng entity chưa tồn tại trong PG. Migrate trước qua tab Review
            → Bulk migrate, rồi quay lại.
          </div>
          <ul className="mt-1 text-[11px] font-mono space-y-0.5">
            {migStatus.missingTables.map((m) => (
              <li key={m.table} className="text-warning">
                · {m.table} <span className="text-muted not-italic">— {m.reason}</span>
              </li>
            ))}
          </ul>
          {!overrideDirty && (
            <button
              type="button"
              onClick={() => setOverrideDirty(true)}
              className="mt-1.5 text-[11px] text-accent hover:underline"
            >
              Tôi biết — vẫn cho phép codegen (override)
            </button>
          )}
        </div>
      )}
      {!result && (
        <>
          <div className="text-muted">
            AI sẽ đọc body T-SQL gốc + manifest entities → sinh code preview. Bạn duyệt + sửa trước
            khi áp dụng.
          </div>
          <Button
            variant="primary"
            disabled={busy || isDirty}
            onClick={runDryRun}
            icon={busy ? <I.Loader size={12} /> : <I.Wand size={12} />}
            title={isDirty ? "Block do bảng phụ thuộc chưa migrate — xem banner phía trên" : ""}
          >
            {busy ? "Đang gọi AI..." : "Dry-run AI codegen"}
          </Button>
        </>
      )}
      {err && <div className="text-danger whitespace-pre-wrap">{err}</div>}

      {result && (
        <>
          <div className="flex gap-3 text-muted flex-wrap items-center">
            <Chip
              variant={result.manifestTier === "D" ? "warning" : "default"}
              className="text-[10px]!"
            >
              Tier {result.manifestTier}
            </Chip>
            <span>tokens in: {result.tokensIn}</span>
            <span>out: {result.tokensOut}</span>
            <span>{(result.durationMs / 1000).toFixed(1)}s</span>
            <Button
              size="sm"
              variant="default"
              onClick={runDryRun}
              disabled={busy}
              icon={<I.Redo size={11} />}
            >
              Chạy lại
            </Button>
          </div>

          {result.error && (
            <div className="p-2 rounded border border-danger/40 bg-danger/5">
              <div className="text-danger font-medium">LLM fail: {result.error}</div>
              <ErrorHint code={result.error} />
            </div>
          )}

          {result.output && (
            <CodegenPreview
              output={result.output}
              editedCode={editedCode}
              onChangeCode={setEditedCode}
              overwrite={overwrite}
              onChangeOverwrite={setOverwrite}
            />
          )}

          {applyResult && (
            <div
              className={[
                "p-2 rounded border",
                applyResult.type === "success"
                  ? "border-success/40 bg-success/5 text-success"
                  : "border-warning/40 bg-warning/5 text-warning",
              ].join(" ")}
            >
              {applyResult.message}
              {applyResult.href && (
                <a href={applyResult.href} className="ml-2 text-accent hover:underline">
                  Mở →
                </a>
              )}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2 border-t border-border">
            <Button variant="default" size="sm" onClick={onDone}>
              Đóng
            </Button>
            {result.output && (
              <Button variant="primary" size="sm" disabled={busy || !editedCode} onClick={apply}>
                {busy
                  ? "Đang áp dụng..."
                  : result.output.tier === "B"
                    ? "Áp dụng (lưu procedure)"
                    : "Áp dụng (ghi file plugin)"}
              </Button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function CodegenPreview({
  output,
  editedCode,
  onChangeCode,
  overwrite,
  onChangeOverwrite,
}: {
  output: NonNullable<CodegenDryRunResult["output"]>;
  editedCode: string;
  onChangeCode: (v: string) => void;
  overwrite: boolean;
  onChangeOverwrite: (v: boolean) => void;
}) {
  return (
    <div className="space-y-2">
      <Card className="p-3 bg-surface/30">
        {output.tier === "B" ? (
          <>
            <div className="text-[11px]">
              <span className="text-muted">Name:</span>{" "}
              <code className="text-accent">{output.name}</code>
            </div>
            <div className="text-[11px]">
              <span className="text-muted">Label:</span> {output.label}
            </div>
            <div className="text-[11px] text-muted">{output.description}</div>
            <div className="text-[11px] mt-2">
              <span className="text-muted">Params:</span>{" "}
              {output.paramsSchema.length === 0 ? "(none)" : ""}
            </div>
            <ul className="text-[10px] ml-3 list-disc">
              {output.paramsSchema.map((p) => (
                <li key={String(p.name)}>
                  <code>{String(p.name)}</code>: {String(p.type)}
                  {p.required ? " *" : ""}
                  {p.description ? ` — ${String(p.description)}` : ""}
                </li>
              ))}
            </ul>
          </>
        ) : (
          <>
            <div className="text-[11px]">
              <span className="text-muted">File:</span>{" "}
              <code className="text-accent">packages/plugins/module-???/{output.fileName}</code>
            </div>
            <div className="text-[11px]">
              <span className="text-muted">Export:</span> <code>{output.exportName}</code>
            </div>
            <div className="text-[11px] text-muted">{output.description}</div>
            <label className="text-[11px] flex items-center gap-1 mt-2">
              <input
                type="checkbox"
                checked={overwrite}
                onChange={(e) => onChangeOverwrite(e.target.checked)}
              />
              Cho phép ghi đè nếu file đã tồn tại
            </label>
          </>
        )}
      </Card>
      <div>
        <div className="text-muted mb-1">
          Code ({editedCode.split("\n").length} dòng) — có thể sửa trước khi áp dụng:
        </div>
        <Textarea
          value={editedCode}
          onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => onChangeCode(e.target.value)}
          className="w-full font-mono text-[11px] min-h-[300px] max-h-[500px]"
        />
      </div>
    </div>
  );
}
