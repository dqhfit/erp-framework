/* EnrichTab (AI Tier 1) — chạy enrich + diff main↔enriched (DiffPanel) +
   dry-run từng proc (DryRunProcsPanel) + log AI (AiLogPanel). Tách từ
   settings.migration.tsx (pilot refactor). */
import { createMigrationClient, type MigrationAiLogEntry } from "@erp-framework/client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { I } from "@/components/Icons";
import { DryRunEnrich } from "@/components/migration/DryRunEnrich";
import { ErrorHint } from "@/components/migration/ErrorHint";
import { JobRunner } from "@/components/migration/JobRunner";
import type { ManifestProcRow } from "@/components/migration/manifest-types";
import { Button, Card, Chip, FormField, Input, Modal } from "@/components/ui";
import { useT } from "@/hooks/useT";

const migration = createMigrationClient("");

export function EnrichTab({
  moduleName,
  summary,
  onChanged,
}: {
  moduleName: string;
  summary: { manifest: unknown; enrichedManifest: unknown } | null;
  onChanged: () => void;
}) {
  const t = useT();
  const [apply, setApply] = useState(false);
  const [maxCost, setMaxCost] = useState("5");
  const [aiLog, setAiLog] = useState<MigrationAiLogEntry[]>([]);
  const [enrichedYaml, setEnrichedYaml] = useState<string | null>(null);
  const [mainYaml, setMainYaml] = useState<string | null>(null);

  const loadDiff = useCallback(async () => {
    const [main, enr] = await Promise.all([
      migration.getModuleYaml(moduleName, "main"),
      migration.getModuleYaml(moduleName, "enriched"),
    ]);
    setMainYaml(main ?? null);
    setEnrichedYaml(enr ?? null);
  }, [moduleName]);

  const loadLog = useCallback(async () => {
    try {
      const r = await migration.aiLog(moduleName);
      setAiLog(r);
    } catch {
      setAiLog([]);
    }
  }, [moduleName]);

  useEffect(() => {
    loadDiff();
    loadLog();
  }, [loadDiff, loadLog]);

  return (
    <div className="space-y-4">
      <JobRunner
        moduleName={moduleName}
        action="enrich"
        envOk={true}
        buildArgs={() => ({ apply, maxCostUsd: parseFloat(maxCost) || 5 })}
        renderForm={() => (
          <>
            <FormField label={t("mig.enrich_apply_label")}>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={apply}
                  onChange={(e) => setApply(e.target.checked)}
                />
                <span>{apply ? t("mig.enrich_overwrite") : t("mig.enrich_dry_run")}</span>
              </label>
            </FormField>
            <FormField label={t("mig.enrich_max_cost")}>
              <Input
                value={maxCost}
                onChange={(e) => setMaxCost(e.target.value)}
                type="number"
                step="0.5"
              />
            </FormField>
          </>
        )}
        canRun={() => true}
        onCompleted={() => {
          loadDiff();
          loadLog();
          onChanged();
        }}
      />

      {/* Dry-run từng proc — list từ manifest */}
      <DryRunProcsPanel
        moduleName={moduleName}
        procs={(summary?.manifest as { procs?: ManifestProcRow[] })?.procs ?? []}
      />

      {/* Diff viewer */}
      {enrichedYaml && mainYaml && <DiffPanel mainYaml={mainYaml} enrichedYaml={enrichedYaml} />}

      {/* AI log — đầy đủ, click row → mở viewer */}
      {aiLog.length > 0 && <AiLogPanel moduleName={moduleName} entries={aiLog} />}
    </div>
  );
}

/* ── Panel dry-run từng proc (Tab Enrich) ─────────────── */

function DryRunProcsPanel({ moduleName, procs }: { moduleName: string; procs: ManifestProcRow[] }) {
  const [filter, setFilter] = useState("");
  const [tierFilter, setTierFilter] = useState<"all" | "B" | "C" | "D">("all");
  const [open, setOpen] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return procs.filter((p) => {
      if (tierFilter !== "all" && p.suggestedTier !== tierFilter) return false;
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        (p.targetProcName?.toLowerCase().includes(q) ?? false) ||
        (p.label?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [procs, filter, tierFilter]);

  const toggle = (name: string) => {
    const next = new Set(expanded);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    setExpanded(next);
  };

  if (procs.length === 0) return null;

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-1 font-medium hover:text-accent"
        >
          {open ? <I.ChevronDown size={14} /> : <I.ChevronRight size={14} />}
          Dry-run AI từng proc ({procs.length})
        </button>
        {open && (
          <div className="flex gap-1">
            {(["all", "B", "C", "D"] as const).map((tf) => (
              <button
                key={tf}
                type="button"
                onClick={() => setTierFilter(tf)}
                className={[
                  "px-2 h-6 text-xs border rounded",
                  tierFilter === tf
                    ? "border-accent text-accent bg-accent/10"
                    : "border-border hover:bg-surface",
                ].join(" ")}
              >
                {tf === "all" ? "Tất cả" : `Tier ${tf}`}
              </button>
            ))}
            <input
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Lọc..."
              className="px-2 h-6 border border-border rounded bg-bg text-xs outline-none focus:border-accent w-32"
            />
          </div>
        )}
      </div>
      {open && (
        <div className="text-[11px] text-muted mb-2">
          Chạy enrich AI riêng cho 1 proc để debug prompt/output trước khi enrich cả module. KHÔNG
          ghi `.enriched.yaml`; chỉ log vào `ai-log/`.
        </div>
      )}
      {open && (
        <div className="border border-border rounded overflow-hidden">
          <ul className="divide-y divide-border max-h-[32rem] overflow-y-auto">
            {filtered.map((p) => {
              const isOpen = expanded.has(p.name);
              return (
                <li key={p.name}>
                  <button
                    type="button"
                    onClick={() => toggle(p.name)}
                    className="w-full text-left px-2 py-1.5 hover:bg-surface flex items-center gap-2 text-xs"
                  >
                    {isOpen ? <I.ChevronDown size={12} /> : <I.ChevronRight size={12} />}
                    <span className="font-mono flex-1 truncate">{p.name}</span>
                    <Chip
                      className="text-[10px]!"
                      variant={
                        p.suggestedTier === "D"
                          ? "warning"
                          : p.suggestedTier === "C"
                            ? "accent"
                            : "default"
                      }
                    >
                      {p.suggestedTier ?? "?"}
                    </Chip>
                    {p.label && (
                      <span className="text-muted truncate max-w-[200px]">{p.label}</span>
                    )}
                  </button>
                  {isOpen && (
                    <div className="px-3 py-2 bg-surface/30 border-t border-border">
                      <DryRunEnrich moduleName={moduleName} procName={p.name} />
                    </div>
                  )}
                </li>
              );
            })}
            {filtered.length === 0 && (
              <li className="px-2 py-4 text-muted text-center text-xs">Không có kết quả</li>
            )}
          </ul>
        </div>
      )}
    </Card>
  );
}

/* ── Diff panel: side-by-side YAML + nút phóng to ─────── */

function DiffPanel({ mainYaml, enrichedYaml }: { mainYaml: string; enrichedYaml: string }) {
  const t = useT();
  const [zoom, setZoom] = useState(false);
  const Content = (
    <div className="grid grid-cols-2 gap-3 text-xs">
      <div className="flex flex-col min-h-0">
        <div className="text-muted mb-1">
          {t("mig.enrich_main_label")} ({mainYaml.split("\n").length} dòng)
        </div>
        <pre
          className={[
            "bg-surface p-2 rounded border border-border overflow-auto",
            zoom ? "flex-1 min-h-0" : "max-h-[28rem]",
          ].join(" ")}
        >
          {mainYaml}
        </pre>
      </div>
      <div className="flex flex-col min-h-0">
        <div className="text-muted mb-1">
          {t("mig.enrich_enriched_label")} ({enrichedYaml.split("\n").length} dòng)
        </div>
        <pre
          className={[
            "bg-surface p-2 rounded border border-border overflow-auto",
            zoom ? "flex-1 min-h-0" : "max-h-[28rem]",
          ].join(" ")}
        >
          {enrichedYaml}
        </pre>
      </div>
    </div>
  );

  return (
    <>
      <Card className="p-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-medium">{t("mig.enrich_diff_title")}</h3>
          <Button
            size="sm"
            variant="default"
            onClick={() => setZoom(true)}
            icon={<I.Eye size={12} />}
          >
            Phóng to
          </Button>
        </div>
        {Content}
      </Card>
      <Modal
        open={zoom}
        onClose={() => setZoom(false)}
        title={t("mig.enrich_diff_title")}
        width={1400}
      >
        <div className="flex flex-col h-[calc(100vh-12rem)]">{Content}</div>
      </Modal>
    </>
  );
}

/* ── AI log panel + entry viewer modal ─────────────────── */

interface AiLogEntryDetail {
  timestamp?: string;
  module?: string;
  phase?: string;
  companyId?: string;
  durationMs?: number;
  tokensIn?: number;
  tokensOut?: number;
  usageReal?: boolean;
  system?: string;
  user?: string;
  output?: unknown;
  /** Khi output=null, error giải thích lý do (no_profile/http_xxx/timeout/...). */
  error?: string;
  /** Raw response từ API (khi parse fail). */
  raw?: string;
}

function AiLogPanel({
  moduleName,
  entries,
}: {
  moduleName: string;
  entries: MigrationAiLogEntry[];
}) {
  const t = useT();
  const [openFile, setOpenFile] = useState<string | null>(null);
  const [detail, setDetail] = useState<AiLogEntryDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState("");

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter(
      (e) => e.phase.toLowerCase().includes(q) || e.file.toLowerCase().includes(q),
    );
  }, [entries, filter]);

  const open = async (file: string) => {
    setOpenFile(file);
    setDetail(null);
    setLoading(true);
    try {
      const r = (await migration.getAiLogEntry(moduleName, file)) as AiLogEntryDetail | null;
      setDetail(r);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between mb-2 gap-2">
        <h3 className="font-medium">{t("mig.ai_log_title", { count: entries.length })}</h3>
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Lọc theo phase..."
          className="px-2 h-7 border border-border rounded bg-bg text-sm outline-none focus:border-accent w-48"
        />
      </div>
      <div className="border border-border rounded overflow-hidden">
        <ul className="max-h-80 overflow-y-auto divide-y divide-border">
          {filtered.length === 0 && (
            <li className="px-2 py-3 text-muted text-center text-xs">Không có entry nào</li>
          )}
          {filtered.map((e) => (
            <li key={e.file}>
              <button
                type="button"
                onClick={() => open(e.file)}
                className="w-full text-left px-2 py-1.5 hover:bg-surface flex items-center gap-2 text-xs"
              >
                <I.File size={12} className="text-muted shrink-0" />
                <span className="font-mono flex-1 truncate">{e.phase}</span>
                <span className="text-muted whitespace-nowrap">{e.timestamp}</span>
                <span className="text-muted whitespace-nowrap">
                  {(e.sizeBytes / 1024).toFixed(1)} KB
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>

      <Modal
        open={openFile != null}
        onClose={() => setOpenFile(null)}
        title={openFile ?? ""}
        width={900}
      >
        {loading && <div className="text-sm text-muted">Đang tải...</div>}
        {!loading && detail && <AiLogEntryView detail={detail} />}
        {!loading && !detail && <div className="text-sm text-danger">Không đọc được entry.</div>}
      </Modal>
    </Card>
  );
}

function AiLogEntryView({ detail }: { detail: AiLogEntryDetail }) {
  return (
    <div className="space-y-3 text-xs">
      <div className="grid grid-cols-2 gap-2 text-[11px]">
        <div>
          <span className="text-muted">Phase:</span> <code>{detail.phase}</code>
        </div>
        <div>
          <span className="text-muted">Time:</span> {detail.timestamp}
        </div>
        <div>
          <span className="text-muted">Duration:</span> {detail.durationMs}ms
        </div>
        <div>
          <span className="text-muted">Tokens:</span> in {detail.tokensIn ?? 0} / out{" "}
          {detail.tokensOut ?? 0}
          {detail.usageReal === false && <span className="text-warning ml-1">(approx)</span>}
        </div>
      </div>

      <details open>
        <summary className="cursor-pointer text-muted">
          System prompt ({(detail.system ?? "").length} chars)
        </summary>
        <pre className="bg-surface p-2 rounded border border-border overflow-auto max-h-64 mt-1 text-[11px]">
          {detail.system ?? ""}
        </pre>
      </details>

      <details open>
        <summary className="cursor-pointer text-muted">
          User prompt ({(detail.user ?? "").length} chars)
        </summary>
        <pre className="bg-surface p-2 rounded border border-border overflow-auto max-h-64 mt-1 text-[11px]">
          {detail.user ?? ""}
        </pre>
      </details>

      {detail.error && (
        <div className="p-2 rounded border border-danger/40 bg-danger/5 space-y-1">
          <div className="text-[11px] font-medium text-danger">LLM call fail</div>
          <div className="text-[11px] text-danger whitespace-pre-wrap break-all">
            {detail.error}
          </div>
          <ErrorHint code={detail.error} />
        </div>
      )}

      <details open>
        <summary className="cursor-pointer text-muted">Output (parsed JSON)</summary>
        <pre className="bg-surface p-2 rounded border border-border overflow-auto max-h-64 mt-1 text-[11px]">
          {detail.output
            ? JSON.stringify(detail.output, null, 2)
            : `(null — ${detail.error ?? "LLM call fail"})`}
        </pre>
      </details>

      {detail.raw && (
        <details>
          <summary className="cursor-pointer text-muted">
            Raw response từ API ({detail.raw.length} chars)
          </summary>
          <pre className="bg-surface p-2 rounded border border-border overflow-auto max-h-64 mt-1 text-[11px]">
            {detail.raw}
          </pre>
        </details>
      )}
    </div>
  );
}
