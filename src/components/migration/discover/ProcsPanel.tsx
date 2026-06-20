/* ProcsPanel — danh sách proc + chi tiết (SQL/sample) + dry-run enrich +
   per-proc codegen/golden. Tách từ DiscoverTab.tsx. */
import { createMigrationClient } from "@erp-framework/client";
import { Fragment, useMemo, useState } from "react";
import { I } from "@/components/Icons";
import { DryRunEnrich } from "@/components/migration/DryRunEnrich";
import type { ManifestProcRow } from "@/components/migration/manifest-types";
import { CodegenProcButton, SamplesGoldenButton } from "@/components/migration/ProcCodegen";
import { SqlBlock } from "@/components/SqlHighlight";
import { Button, Card, Chip } from "@/components/ui";

const migration = createMigrationClient("");

export function ProcsPanel({
  procs,
  moduleName,
}: {
  procs: ManifestProcRow[];
  moduleName: string;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState("");
  const [tierFilter, setTierFilter] = useState<"all" | "B" | "C" | "D">("all");
  const [open, setOpen] = useState(true);
  const [helpOpen, setHelpOpen] = useState(false);

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

  const tierCounts = useMemo(() => {
    const c = { B: 0, C: 0, D: 0 };
    for (const p of procs) {
      if (p.suggestedTier === "B" || p.suggestedTier === "C" || p.suggestedTier === "D")
        c[p.suggestedTier]++;
    }
    return c;
  }, [procs]);

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="flex items-center gap-1 font-medium hover:text-accent"
          >
            {open ? <I.ChevronDown size={14} /> : <I.ChevronRight size={14} />}
            Procedure ({procs.length})
            <span className="text-xs text-muted ml-2">
              B={tierCounts.B} · C={tierCounts.C} · D={tierCounts.D}
            </span>
          </button>
          <button
            type="button"
            onClick={() => setHelpOpen((v) => !v)}
            title="Mô tả các tier B/C/D"
            aria-label="Mô tả tier"
            className="ml-1 w-5 h-5 inline-flex items-center justify-center rounded-full border border-border text-muted hover:text-accent hover:border-accent"
          >
            <I.HelpCircle size={11} />
          </button>
        </div>
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
      {helpOpen && <TierHelpPanel onClose={() => setHelpOpen(false)} />}
      {open && (
        <div className="border border-border rounded overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-surface text-muted">
              <tr>
                <th className="text-left px-2 py-1.5 w-6"></th>
                <th className="text-left px-2 py-1.5">MSSQL proc</th>
                <th className="text-left px-2 py-1.5">Tier</th>
                <th className="text-left px-2 py-1.5">Target</th>
                <th className="text-right px-2 py-1.5">Read</th>
                <th className="text-right px-2 py-1.5">Write</th>
                <th className="text-left px-2 py-1.5">Flags</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => {
                const isOpen = expanded.has(p.name);
                return (
                  <Fragment key={p.name}>
                    <tr
                      className="border-t border-border hover:bg-surface cursor-pointer"
                      onClick={() => toggle(p.name)}
                    >
                      <td className="px-2 py-1">
                        {isOpen ? <I.ChevronDown size={12} /> : <I.ChevronRight size={12} />}
                      </td>
                      <td className="px-2 py-1 font-mono">{p.name}</td>
                      <td className="px-2 py-1">
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
                      </td>
                      <td className="px-2 py-1 text-accent text-[11px]">
                        {p.targetProcName ?? (p.targetFile ? "→ plugin" : "—")}
                      </td>
                      <td className="px-2 py-1 text-right">{p.reads?.length ?? 0}</td>
                      <td className="px-2 py-1 text-right">{p.writes?.length ?? 0}</td>
                      <td className="px-2 py-1 text-[10px]">
                        {(p.flags ?? []).slice(0, 3).join(", ")}
                        {(p.flags?.length ?? 0) > 3 && ` +${(p.flags?.length ?? 0) - 3}`}
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="border-t border-border bg-surface/30">
                        <td colSpan={7} className="px-2 py-2">
                          <ProcDetail proc={p} moduleName={moduleName} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-2 py-4 text-muted text-center">
                    Không có kết quả
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function TierHelpPanel({ onClose }: { onClose: () => void }) {
  return (
    <div className="mb-2 p-3 rounded border border-accent/30 bg-accent/5 text-xs">
      <div className="flex items-center justify-between mb-2">
        <span className="font-medium text-accent">Phân loại tier — đích dịch chuyển proc</span>
        <button
          type="button"
          onClick={onClose}
          className="text-muted hover:text-text leading-none"
          aria-label="Đóng"
        >
          ×
        </button>
      </div>
      <div className="grid md:grid-cols-3 gap-2">
        <div className="p-2 rounded border border-border bg-bg">
          <div className="flex items-center gap-1 mb-1">
            <Chip className="text-[10px]!">B</Chip>
            <span className="font-medium">Procedure JS (sandbox)</span>
          </div>
          <p className="text-muted leading-snug mb-1">
            Chạy trong isolated-vm (128MB, 5s). Phù hợp CRUD đơn giản, validate, transaction ngắn
            (db.tx).
          </p>
          <ul className="text-[10px] text-muted list-disc ml-4 space-y-0.5">
            <li>API: db.queryRecords / findById</li>
            <li>entity.insert / update / delete</li>
            <li>callTool / callProc / fetch</li>
            <li>
              <b>KHÔNG</b> raw SQL, GROUP BY, JOIN xuyên bảng
            </li>
          </ul>
        </div>
        <div className="p-2 rounded border border-border bg-bg">
          <div className="flex items-center gap-1 mb-1">
            <Chip variant="accent" className="text-[10px]!">
              C
            </Chip>
            <span className="font-medium">Workflow scheduled</span>
          </div>
          <p className="text-muted leading-snug mb-1">
            Proc chạy theo lịch (SQL Agent → cron của framework). Body workflow gọi xuống tier B/D.
          </p>
          <ul className="text-[10px] text-muted list-disc ml-4 space-y-0.5">
            <li>Trigger: scheduled cron</li>
            <li>Vd: kết sổ đêm, tính tồn kho daily</li>
            <li>Pg-boss queue, retry config</li>
          </ul>
        </div>
        <div className="p-2 rounded border border-border bg-bg">
          <div className="flex items-center gap-1 mb-1">
            <Chip variant="warning" className="text-[10px]!">
              D
            </Chip>
            <span className="font-medium">Plugin TS in-process</span>
          </div>
          <p className="text-muted leading-snug mb-1">
            TS thuần, full Drizzle, raw SQL, transaction. Phù hợp proc phức tạp.
          </p>
          <ul className="text-[10px] text-muted list-disc ml-4 space-y-0.5">
            <li>JOIN nhiều bảng, GROUP BY, WINDOW</li>
            <li>CTE, MERGE, CURSOR</li>
            <li>Multi-table transaction có rollback</li>
            <li>Dynamic SQL (sp_executesql)</li>
          </ul>
        </div>
      </div>
      <div className="text-[10px] text-muted mt-2">
        Heuristic ban đầu do parser đoán; AI tier 1 (enrich) sẽ điều chỉnh khi đọc body T-SQL. User
        vẫn có thể override trong manifest YAML.
      </div>
    </div>
  );
}

function ProcDetail({ proc, moduleName }: { proc: ManifestProcRow; moduleName: string }) {
  const [body, setBody] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const showBody = async () => {
    if (body != null) {
      setVisible(true);
      return;
    } // đã có cache
    setLoading(true);
    setErr("");
    try {
      const r = await migration.previewProc(proc.name);
      const text = (r as { proc?: { body?: string } } | null)?.proc?.body ?? "";
      setBody(text || "(không có body)");
      setVisible(true);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-2 text-xs">
      {proc.description && <div className="text-muted">{proc.description}</div>}
      {proc.targetFile && (
        <div>
          <span className="text-muted">Target file:</span> <code>{proc.targetFile}</code>
        </div>
      )}
      {proc.reads && proc.reads.length > 0 && (
        <div>
          <span className="text-muted">Đọc:</span>{" "}
          {proc.reads.map((r) => (
            <code key={r} className="mr-1">
              {r}
            </code>
          ))}
        </div>
      )}
      {proc.writes && proc.writes.length > 0 && (
        <div>
          <span className="text-muted">Ghi:</span>{" "}
          {proc.writes.map((w) => (
            <code key={w} className="mr-1">
              {w}
            </code>
          ))}
        </div>
      )}
      {proc.flags && proc.flags.length > 0 && (
        <div>
          <span className="text-muted">Flags:</span>{" "}
          {proc.flags.map((f) => (
            <Chip key={f} className="ml-1 text-[10px]!">
              {f}
            </Chip>
          ))}
        </div>
      )}
      {proc.callsProcs && proc.callsProcs.length > 0 && (
        <div>
          <span className="text-muted">Gọi:</span>{" "}
          {proc.callsProcs.map((c) => (
            <code key={c} className="mr-1">
              {c}
            </code>
          ))}
        </div>
      )}

      {/* Body T-SQL — lazy + toggle hiện/ẩn */}
      <div>
        {visible && body != null ? (
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="default"
                onClick={() => setVisible(false)}
                icon={<I.ChevronUp size={12} />}
              >
                Ẩn T-SQL
              </Button>
              <span className="text-[10px] text-muted">{body.split("\n").length} dòng</span>
            </div>
            <SqlBlock text={body} className="max-h-96" />
          </div>
        ) : (
          <Button
            size="sm"
            variant="default"
            onClick={showBody}
            disabled={loading}
            icon={<I.Eye size={12} />}
          >
            {loading ? "Đang tải..." : body != null ? "Hiện lại T-SQL" : "Xem body T-SQL"}
          </Button>
        )}
        {err && <div className="text-danger text-[11px] mt-1">{err}</div>}
      </div>

      {/* Dry-run enrich riêng cho proc này */}
      <DryRunEnrich moduleName={moduleName} procName={proc.name} />
      <CodegenProcButton
        moduleName={moduleName}
        procName={proc.name}
        suggestedTier={proc.suggestedTier}
      />
      <SamplesGoldenButton moduleName={moduleName} procName={proc.name} />
    </div>
  );
}

/* ── Panel: cross-module edges ─────────────────────────── */
