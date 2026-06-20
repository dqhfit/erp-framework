/* SamplesGolden — Tier 3 capture golden sample cho proc (button + dialog).
   Tách từ ProcCodegen.tsx. */
import { createMigrationClient } from "@erp-framework/client";
import { useEffect, useMemo, useState } from "react";
import { I } from "@/components/Icons";
import { ErrorHint } from "@/components/migration/ErrorHint";
import { Button, Chip, Modal, Textarea } from "@/components/ui";

const migration = createMigrationClient("");

interface ProcSampleUI {
  name: string;
  kind: "happy" | "boundary" | "edge";
  description: string;
  args: Record<string, unknown>;
  expectedError?: string;
}

export function SamplesGoldenButton({
  moduleName,
  procName,
}: {
  moduleName: string;
  procName: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="pt-2 border-t border-border mt-2">
      <Button
        size="sm"
        variant="default"
        onClick={() => setOpen(true)}
        icon={<I.CheckSq size={12} />}
      >
        Sinh sample + capture golden
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={`Test sample + capture golden: ${procName}`}
        width={1000}
      >
        <SamplesGoldenDialog
          moduleName={moduleName}
          procName={procName}
          onDone={() => setOpen(false)}
        />
      </Modal>
    </div>
  );
}

function SamplesGoldenDialog({
  moduleName,
  procName,
  onDone,
}: {
  moduleName: string;
  procName: string;
  onDone: () => void;
}) {
  const draftKey = `migration:draft:samples:${moduleName}:${procName}`;
  // Restore draft từ localStorage nếu có (đóng/mở browser không mất).
  const restored = useMemo(() => {
    if (typeof window === "undefined") return null;
    try {
      const raw = window.localStorage.getItem(draftKey);
      if (!raw) return null;
      return JSON.parse(raw) as {
        step?: "generate" | "review" | "captured";
        samples?: ProcSampleUI[];
        editedJson?: string;
        genMeta?: { tokensIn: number; tokensOut: number; durationMs: number };
      };
    } catch {
      return null;
    }
  }, [draftKey]);

  const [step, setStep] = useState<"generate" | "review" | "captured">(
    restored?.step ?? "generate",
  );
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [genMeta, setGenMeta] = useState<{
    tokensIn: number;
    tokensOut: number;
    durationMs: number;
  } | null>(restored?.genMeta ?? null);
  const [samples, setSamples] = useState<ProcSampleUI[]>(restored?.samples ?? []);
  const [editedJson, setEditedJson] = useState(restored?.editedJson ?? "");

  // Auto-save draft khi step "review" (chưa capture). Sau capture xong
  // → clear (đã lưu vào file e2e/golden, không cần draft nữa).
  useEffect(() => {
    if (step === "captured") {
      window.localStorage.removeItem(draftKey);
      return;
    }
    if (step === "generate" && !editedJson && samples.length === 0) {
      window.localStorage.removeItem(draftKey);
      return;
    }
    window.localStorage.setItem(
      draftKey,
      JSON.stringify({
        step,
        samples,
        editedJson,
        genMeta,
      }),
    );
  }, [draftKey, step, samples, editedJson, genMeta]);
  const [capture, setCapture] = useState<{
    filePath: string;
    total: number;
    ok: number;
    failed: number;
    results: Array<{
      name: string;
      kind: ProcSampleUI["kind"];
      ok: boolean;
      output?: unknown;
      error?: string;
      durationMs: number;
    }>;
  } | null>(null);

  const generate = async () => {
    setBusy(true);
    setErr("");
    setCapture(null);
    try {
      const r = await migration.generateSamplesDryRun(moduleName, procName);
      if (r.error) {
        setErr(r.error);
        return;
      }
      setSamples(r.samples);
      setEditedJson(JSON.stringify(r.samples, null, 2));
      setGenMeta({ tokensIn: r.tokensIn, tokensOut: r.tokensOut, durationMs: r.durationMs });
      setStep("review");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const capture$ = async () => {
    setBusy(true);
    setErr("");
    try {
      // Parse editedJson để cho phép user sửa trước khi capture.
      let parsed: ProcSampleUI[];
      try {
        parsed = JSON.parse(editedJson) as ProcSampleUI[];
        if (!Array.isArray(parsed)) throw new Error("Phải là array");
      } catch (e) {
        setErr(`JSON không hợp lệ: ${(e as Error).message}`);
        setBusy(false);
        return;
      }
      const r = await migration.captureGolden({
        module: moduleName,
        procName,
        samples: parsed,
      });
      setCapture(r);
      setStep("captured");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const kindCount = useMemo(() => {
    const c = { happy: 0, boundary: 0, edge: 0 };
    for (const s of samples) c[s.kind]++;
    return c;
  }, [samples]);

  return (
    <div className="space-y-3 text-xs">
      {/* Steps */}
      <div className="flex items-center gap-2 text-[11px]">
        <span className={step === "generate" ? "text-accent font-medium" : "text-muted"}>
          1. AI sinh sample
        </span>
        <span className="text-muted">→</span>
        <span className={step === "review" ? "text-accent font-medium" : "text-muted"}>
          2. Review + sửa
        </span>
        <span className="text-muted">→</span>
        <span className={step === "captured" ? "text-accent font-medium" : "text-muted"}>
          3. Capture golden
        </span>
      </div>

      {step === "generate" && (
        <>
          <div className="text-muted">
            AI sẽ đọc paramsSchema MSSQL + 5 sample data của các bảng proc đọc → sinh 10 input
            variants (5 happy + 3 boundary + 2 edge case) để test proc.
          </div>
          <Button
            variant="primary"
            disabled={busy}
            onClick={generate}
            icon={busy ? <I.Loader size={12} /> : <I.Sparkles size={12} />}
          >
            {busy ? "Đang gọi AI..." : "AI sinh sample"}
          </Button>
        </>
      )}

      {err && (
        <div className="p-2 rounded border border-danger/40 bg-danger/5">
          <div className="text-danger font-medium">Lỗi: {err}</div>
          <ErrorHint code={err} />
        </div>
      )}

      {step === "review" && (
        <>
          {genMeta && (
            <div className="flex gap-3 text-muted text-[11px]">
              <Chip variant="default" className="text-[10px]!">
                {samples.length} sample
              </Chip>
              <span>Happy: {kindCount.happy}</span>
              <span>Boundary: {kindCount.boundary}</span>
              <span>Edge: {kindCount.edge}</span>
              <span className="ml-auto">
                {genMeta.tokensIn}+{genMeta.tokensOut} tokens ·{" "}
                {(genMeta.durationMs / 1000).toFixed(1)}s
              </span>
            </div>
          )}

          {samples.length > 0 && (
            <div className="border border-border rounded overflow-hidden max-h-48 overflow-y-auto">
              <table className="w-full text-[11px]">
                <thead className="bg-surface text-muted sticky top-0">
                  <tr>
                    <th className="text-left px-2 py-1">Tên</th>
                    <th className="text-left px-2 py-1">Kind</th>
                    <th className="text-left px-2 py-1">Mô tả</th>
                  </tr>
                </thead>
                <tbody>
                  {samples.map((s) => (
                    <tr key={s.name} className="border-t border-border">
                      <td className="px-2 py-1 font-mono">{s.name}</td>
                      <td className="px-2 py-1">
                        <Chip
                          variant={
                            s.kind === "happy"
                              ? "success"
                              : s.kind === "boundary"
                                ? "warning"
                                : "danger"
                          }
                          className="text-[9px]!"
                        >
                          {s.kind}
                        </Chip>
                      </td>
                      <td className="px-2 py-1 text-muted">{s.description}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div>
            <div className="text-muted mb-1">
              Sample JSON ({editedJson.split("\n").length} dòng) — có thể sửa trước capture:
            </div>
            <Textarea
              value={editedJson}
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
                setEditedJson(e.target.value)
              }
              className="w-full font-mono text-[11px] min-h-[200px] max-h-[400px]"
            />
          </div>

          <div className="text-[11px] text-warning bg-warning/5 border border-warning/30 rounded p-2">
            <I.AlertCircle size={11} className="inline mr-1" />
            Capture sẽ <b>gọi proc thật trên MSSQL</b> với mỗi sample. Connection phải bật{" "}
            <b>"Allow write"</b>. Snapshot input/output ghi vào{" "}
            <code>
              e2e/golden/{moduleName}/{procName.replace(/\W/g, "_")}.json
            </code>{" "}
            làm baseline cho golden test sau khi port.
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-border">
            <Button variant="default" size="sm" onClick={() => setStep("generate")}>
              ↩ Sinh lại
            </Button>
            <Button
              variant="primary"
              size="sm"
              disabled={busy || !editedJson}
              onClick={capture$}
              icon={busy ? <I.Loader size={12} /> : <I.Play size={12} />}
            >
              {busy ? "Đang chạy proc trên MSSQL..." : "Capture golden"}
            </Button>
          </div>
        </>
      )}

      {step === "captured" && capture && (
        <>
          <div className="p-2 rounded border border-success/40 bg-success/5">
            <div className="text-success font-medium">
              ✓ Capture xong — {capture.ok}/{capture.total} sample thành công
              {capture.failed > 0 && (
                <span className="text-warning ml-2">({capture.failed} fail)</span>
              )}
            </div>
            <div className="text-[10px] text-muted mt-1">
              Lưu vào: <code>{capture.filePath}</code>
            </div>
          </div>

          <div className="border border-border rounded overflow-hidden max-h-64 overflow-y-auto">
            <table className="w-full text-[11px]">
              <thead className="bg-surface text-muted sticky top-0">
                <tr>
                  <th className="text-left px-2 py-1">Sample</th>
                  <th className="text-left px-2 py-1">Kind</th>
                  <th className="text-left px-2 py-1">Status</th>
                  <th className="text-right px-2 py-1">ms</th>
                  <th className="text-left px-2 py-1">Output / Error</th>
                </tr>
              </thead>
              <tbody>
                {capture.results.map((r) => (
                  <tr key={r.name} className="border-t border-border">
                    <td className="px-2 py-1 font-mono">{r.name}</td>
                    <td className="px-2 py-1">
                      <Chip
                        variant={
                          r.kind === "happy"
                            ? "success"
                            : r.kind === "boundary"
                              ? "warning"
                              : "danger"
                        }
                        className="text-[9px]!"
                      >
                        {r.kind}
                      </Chip>
                    </td>
                    <td className="px-2 py-1">
                      {r.ok ? (
                        <Chip variant="success" className="text-[9px]!">
                          ok
                        </Chip>
                      ) : (
                        <Chip variant="danger" className="text-[9px]!">
                          fail
                        </Chip>
                      )}
                    </td>
                    <td className="px-2 py-1 text-right">{r.durationMs}</td>
                    <td className="px-2 py-1 text-muted truncate max-w-[300px]">
                      {r.ok ? JSON.stringify(r.output).slice(0, 100) : r.error}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-border">
            <Button variant="default" size="sm" onClick={() => setStep("review")}>
              ↩ Sửa sample + capture lại
            </Button>
            <Button variant="primary" size="sm" onClick={onDone}>
              Đóng
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

/* ── Codegen Tier 2: T-SQL → JS procedure / TS plugin ─── */
