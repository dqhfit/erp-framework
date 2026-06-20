/* DryRunEnrich — nút "dry-run" enrich 1 proc qua LLM rồi hiện kết quả
   (không ghi). Dùng chung ProcDetail (Discover) + DryRunProcsPanel (Enrich). */
import { createMigrationClient } from "@erp-framework/client";
import { useState } from "react";
import { I } from "@/components/Icons";
import { ErrorHint } from "@/components/migration/ErrorHint";
import { Button, Chip } from "@/components/ui";

const migration = createMigrationClient("");

interface DryRunResult {
  procName: string;
  output: unknown | null;
  error?: string;
  raw?: string;
  tokensIn: number;
  tokensOut: number;
  durationMs: number;
}

/** Dry-run enrich cho 1 proc — gọi sync, trả output ngay (không qua queue). */
export function DryRunEnrich({ moduleName, procName }: { moduleName: string; procName: string }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<DryRunResult | null>(null);
  const [err, setErr] = useState("");

  const run = async () => {
    setBusy(true);
    setErr("");
    setResult(null);
    try {
      const r = await migration.enrichProcDryRun(moduleName, procName);
      setResult(r);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="border-t border-border pt-2 mt-2">
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="default"
          onClick={run}
          disabled={busy}
          icon={busy ? <I.Loader size={12} /> : <I.Sparkles size={12} />}
        >
          {busy ? "Đang gọi AI..." : result ? "Chạy lại" : "Dry-run AI enrich proc này"}
        </Button>
        {result && (
          <Chip variant={result.output ? "success" : result.error ? "danger" : "warning"}>
            {result.output ? "ok" : result.error ? "fail" : "empty"}
          </Chip>
        )}
        {result?.durationMs != null && (
          <span className="text-[10px] text-muted">{(result.durationMs / 1000).toFixed(1)}s</span>
        )}
      </div>
      {err && <div className="text-danger text-[11px] mt-1">{err}</div>}
      {result && (
        <div className="mt-2 space-y-1 text-[11px]">
          <div className="flex gap-3 text-muted">
            <span>tokens in: {result.tokensIn}</span>
            <span>out: {result.tokensOut}</span>
            <span>{result.durationMs}ms</span>
          </div>
          {result.error && (
            <div className="p-2 rounded border border-danger/40 bg-danger/5">
              <div className="text-danger font-medium">LLM fail: {result.error}</div>
              <ErrorHint code={result.error} />
            </div>
          )}
          <div className="text-muted">AI suggest:</div>
          <pre className="bg-bg p-2 rounded border border-border overflow-auto max-h-64">
            {result.output
              ? JSON.stringify(result.output, null, 2)
              : `(null — ${result.error ?? "LLM fail"})`}
          </pre>
          {result.raw && (
            <details>
              <summary className="cursor-pointer text-muted">
                Raw response ({result.raw.length} chars)
              </summary>
              <pre className="bg-bg p-2 rounded border border-border overflow-auto max-h-48 mt-1">
                {result.raw}
              </pre>
            </details>
          )}
          <div className="text-[10px] text-muted">
            Dry-run KHÔNG ghi enriched.yaml. Để áp dụng cho cả module, chạy tab Enrich với "Apply".
          </div>
        </div>
      )}
    </div>
  );
}
