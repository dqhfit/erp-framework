/* DiscoverTab — tab Discover: seed/exclude bảng, xem manifest (tables/
   procs/edges), materialize enum, dry-run enrich proc. Tách từ
   settings.migration.tsx (pilot refactor). */
import { createMigrationClient } from "@erp-framework/client";
import { Fragment, useEffect, useMemo, useState } from "react";
import { I } from "@/components/Icons";
import { DryRunEnrich } from "@/components/migration/DryRunEnrich";
import { fmtCell } from "@/components/migration/format";
import { JobRunner } from "@/components/migration/JobRunner";
import type {
  ManifestEdge,
  ManifestProcRow,
  ManifestTableRow,
  SplitEnumRule,
} from "@/components/migration/manifest-types";
import { CodegenProcButton, SamplesGoldenButton } from "@/components/migration/ProcCodegen";
import { SqlBlock } from "@/components/SqlHighlight";
import { Button, Card, Chip, FormField, Input, Modal, TagBox } from "@/components/ui";
import { useT } from "@/hooks/useT";
import { dialog } from "@/lib/dialog";

const migration = createMigrationClient("");

export function DiscoverTab({
  moduleName,
  summary,
  envOk,
  connTables,
  onChanged,
}: {
  moduleName: string;
  summary: { manifest: unknown; enrichedManifest: unknown } | null;
  envOk: boolean;
  connTables: string[];
  onChanged: () => void;
}) {
  const t = useT();
  const [seed, setSeed] = useState<string[]>([]);
  const [exclude, setExclude] = useState<string[]>([]);

  const manifest = summary?.manifest as
    | {
        tables?: ManifestTableRow[];
        procs?: ManifestProcRow[];
        crossModuleEdges?: ManifestEdge[];
      }
    | undefined;

  return (
    <div className="space-y-4">
      <JobRunner
        moduleName={moduleName}
        action="discover"
        envOk={envOk}
        buildArgs={() => ({ seedTables: seed, excludeTables: exclude })}
        renderForm={() => (
          <>
            <FormField label={t("mig.discover_seed_label", { count: connTables.length })}>
              <TagBox
                value={seed}
                onChange={setSeed}
                suggestions={connTables}
                placeholder={t("mig.ph_seed_bfs")}
              />
            </FormField>
            <FormField label={t("mig.discover_exclude")}>
              <TagBox
                value={exclude}
                onChange={setExclude}
                suggestions={connTables}
                placeholder={t("mig.ph_exclude_table")}
              />
            </FormField>
          </>
        )}
        canRun={() => seed.length > 0}
        onCompleted={onChanged}
      />

      {/* Full manifest preview — không truncate */}
      {manifest && (
        <>
          <TablesPanel tables={manifest.tables ?? []} moduleName={moduleName} />
          <ProcsPanel procs={manifest.procs ?? []} moduleName={moduleName} />
          <EdgesPanel edges={manifest.crossModuleEdges ?? []} />
        </>
      )}
    </div>
  );
}

/* ── Panel: liệt kê bảng đầy đủ, expand row → load preview ─── */

function TablesPanel({ tables, moduleName }: { tables: ManifestTableRow[]; moduleName: string }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState("");
  const [open, setOpen] = useState(true);
  const [kindFilter, setKindFilter] = useState<"all" | "entity" | "enum">("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [excluding, setExcluding] = useState(false);
  const [excludeResult, setExcludeResult] = useState<string | null>(null);

  const kindCounts = useMemo(() => {
    const c = { entity: 0, enum: 0 };
    for (const t of tables) {
      if (t.suggestedKind === "enum") c.enum++;
      else c.entity++; // mặc định = entity
    }
    return c;
  }, [tables]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return tables.filter((t) => {
      if (kindFilter !== "all") {
        const k = t.suggestedKind ?? "entity";
        if (k !== kindFilter) return false;
      }
      if (!q) return true;
      return (
        t.name.toLowerCase().includes(q) ||
        (t.suggestedEntityName?.toLowerCase().includes(q) ?? false) ||
        (t.label?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [tables, filter, kindFilter]);

  const toggle = (name: string) => {
    const next = new Set(expanded);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    setExpanded(next);
  };

  const toggleSelect = (name: string) => {
    const next = new Set(selected);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    setSelected(next);
  };
  const toggleSelectAll = () => {
    const allFiltered = filtered.map((t) => t.name);
    if (allFiltered.every((n) => selected.has(n))) {
      // Bỏ chọn tất cả filtered.
      const next = new Set(selected);
      for (const n of allFiltered) next.delete(n);
      setSelected(next);
    } else {
      setSelected(new Set([...selected, ...allFiltered]));
    }
  };
  const allFilteredSelected = filtered.length > 0 && filtered.every((t) => selected.has(t.name));

  const excludeSelected = async () => {
    if (selected.size === 0) return;
    const names = [...selected];
    const ok = await dialog.confirm(
      `Loại trừ ${names.length} bảng khỏi module?\n\n` +
        `${names.slice(0, 10).join("\n")}${names.length > 10 ? `\n... +${names.length - 10}` : ""}\n\n` +
        `Hành động:\n` +
        `• Thêm vào discoverParams.excludeTables\n` +
        `• Xoá khỏi tables[] hiện tại\n` +
        `• Dọn inferredRelations FK trỏ tới\n` +
        `• Dọn proc nếu chỉ đụng bảng exclude\n\n` +
        `Tiếp tục?`,
      { title: "Loại trừ bảng", confirmText: "Loại trừ" },
    );
    if (!ok) return;
    setExcluding(true);
    setExcludeResult(null);
    try {
      const r = await migration.addToExclude({ module: moduleName, tableNames: names });
      setExcludeResult(
        `✓ Loại trừ ${r.removedTables.length} bảng, dọn ${r.removedRels} FK, xoá ${r.removedProcs.length} proc orphan.`,
      );
      setSelected(new Set());
      // Reload trang để manifest tươi (parent handle).
      window.location.reload();
    } catch (e) {
      setExcludeResult(`✗ ${(e as Error).message}`);
    } finally {
      setExcluding(false);
    }
  };

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-1 font-medium hover:text-accent"
        >
          {open ? <I.ChevronDown size={14} /> : <I.ChevronRight size={14} />}
          Bảng ({tables.length})
          <span className="text-xs text-muted ml-2">
            Entity={kindCounts.entity} · Enum={kindCounts.enum}
          </span>
        </button>
        {open && (
          <div className="flex items-center gap-1 flex-wrap">
            {selected.size > 0 && (
              <>
                <span className="text-[11px] text-accent mr-1">{selected.size} đã chọn</span>
                <Button
                  size="sm"
                  variant="default"
                  onClick={excludeSelected}
                  disabled={excluding}
                  icon={<I.Trash size={11} />}
                >
                  {excluding ? "Đang xử lý..." : "Loại trừ"}
                </Button>
                <Button size="sm" variant="default" onClick={() => setSelected(new Set())}>
                  Bỏ chọn
                </Button>
                <span className="mx-1 text-muted">|</span>
              </>
            )}
            {(["all", "entity", "enum"] as const).map((kf) => (
              <button
                key={kf}
                type="button"
                onClick={() => setKindFilter(kf)}
                className={[
                  "px-2 h-6 text-xs border rounded",
                  kindFilter === kf
                    ? "border-accent text-accent bg-accent/10"
                    : "border-border hover:bg-surface",
                ].join(" ")}
              >
                {kf === "all" ? "Tất cả" : kf === "entity" ? "Entity" : "Enum"}
              </button>
            ))}
            <input
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Lọc theo tên..."
              className="px-2 h-7 border border-border rounded bg-bg text-sm outline-none focus:border-accent w-32"
            />
          </div>
        )}
      </div>
      {excludeResult && (
        <div
          className={[
            "text-[11px] mb-2",
            excludeResult.startsWith("✓") ? "text-success" : "text-danger",
          ].join(" ")}
        >
          {excludeResult}
        </div>
      )}
      {open && (
        <div className="border border-border rounded overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-surface text-muted">
              <tr>
                <th className="text-left px-2 py-1.5 w-6">
                  <input
                    type="checkbox"
                    checked={allFilteredSelected}
                    onChange={toggleSelectAll}
                    title={
                      allFilteredSelected
                        ? "Bỏ chọn tất cả (lọc hiện tại)"
                        : "Chọn tất cả (lọc hiện tại)"
                    }
                  />
                </th>
                <th className="text-left px-2 py-1.5 w-6"></th>
                <th className="text-left px-2 py-1.5">MSSQL</th>
                <th className="text-left px-2 py-1.5">Kind</th>
                <th className="text-left px-2 py-1.5">Entity / Enum</th>
                <th className="text-left px-2 py-1.5">Label</th>
                <th className="text-right px-2 py-1.5">Cột</th>
                <th className="text-right px-2 py-1.5">PK</th>
                <th className="text-right px-2 py-1.5">FK suy</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((tbl) => {
                const isOpen = expanded.has(tbl.name);
                const kind = tbl.suggestedKind ?? "entity";
                const isSelected = selected.has(tbl.name);
                return (
                  <Fragment key={tbl.name}>
                    <tr
                      className={[
                        "border-t border-border hover:bg-surface",
                        isSelected && "bg-accent/5",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                    >
                      <td className="px-2 py-1" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelect(tbl.name)}
                        />
                      </td>
                      <td className="px-2 py-1 cursor-pointer" onClick={() => toggle(tbl.name)}>
                        {isOpen ? <I.ChevronDown size={12} /> : <I.ChevronRight size={12} />}
                      </td>
                      <td
                        className="px-2 py-1 font-mono cursor-pointer"
                        onClick={() => toggle(tbl.name)}
                      >
                        {tbl.name}
                      </td>
                      <td className="px-2 py-1">
                        <Chip
                          variant={kind === "enum" ? "accent" : "default"}
                          className="text-[10px]!"
                        >
                          {kind}
                        </Chip>
                      </td>
                      <td className="px-2 py-1 text-accent">{tbl.suggestedEntityName ?? "—"}</td>
                      <td className="px-2 py-1">
                        {tbl.label ?? <span className="text-muted">—</span>}
                      </td>
                      <td className="px-2 py-1 text-right">{tbl.columns?.length ?? 0}</td>
                      <td className="px-2 py-1 text-right">{tbl.primaryKey?.length ?? 0}</td>
                      <td className="px-2 py-1 text-right">{tbl.inferredRelations?.length ?? 0}</td>
                    </tr>
                    {isOpen && (
                      <tr className="border-t border-border bg-surface/30">
                        <td colSpan={9} className="px-2 py-2">
                          <TableDetail tbl={tbl} moduleName={moduleName} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-2 py-4 text-muted text-center">
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

function TableDetail({ tbl, moduleName }: { tbl: ManifestTableRow; moduleName: string }) {
  const [samples, setSamples] = useState<unknown[] | null>(null);
  const [visible, setVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const showSamples = async () => {
    if (samples != null) {
      setVisible(true);
      return;
    } // đã có cache → chỉ bật visible
    setLoading(true);
    setErr("");
    try {
      const r = await migration.previewTable(tbl.name, 5);
      setSamples((r as { samples?: unknown[] })?.samples ?? []);
      setVisible(true);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const isEnum = tbl.suggestedKind === "enum";
  return (
    <div className="space-y-2">
      {tbl.description && <div className="text-muted">{tbl.description}</div>}
      {tbl.primaryKey && tbl.primaryKey.length > 0 && (
        <div>
          <span className="text-muted">PK:</span> <code>{tbl.primaryKey.join(", ")}</code>
        </div>
      )}

      {/* Enum options preview + materialize */}
      {isEnum && (
        <div className="p-2 rounded border border-accent/40 bg-accent/5 space-y-2">
          <div className="text-accent font-medium">Enum — KHÔNG sinh entity riêng</div>
          <div className="text-[11px] text-muted">
            Cột FK ở bảng khác trỏ tới bảng này sẽ thành <code>entityType: enum</code> với reference
            qua enumId.
          </div>
          {tbl.enumOptions && tbl.enumOptions.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {tbl.enumOptions.map((opt) => (
                <Chip key={opt} className="text-[10px]!">
                  {opt}
                </Chip>
              ))}
            </div>
          ) : (
            <div className="text-[11px] text-warning">
              Chưa có options — AI cần sample data đủ để extract. Xem 5 sample bên dưới và bổ sung
              tay.
            </div>
          )}
          <MaterializeEnumButton tbl={tbl} moduleName={moduleName} />
        </div>
      )}

      {/* Columns */}
      <div>
        <div className="text-muted mb-1">Cột ({tbl.columns?.length ?? 0})</div>
        <div className="border border-border rounded overflow-hidden">
          <table className="w-full text-[11px]">
            <thead className="bg-bg text-muted">
              <tr>
                <th className="text-left px-2 py-1">MSSQL name</th>
                <th className="text-left px-2 py-1">Type</th>
                <th className="text-left px-2 py-1">Null</th>
                <th className="text-left px-2 py-1">→ Field</th>
                <th className="text-left px-2 py-1">→ Type</th>
                <th className="text-left px-2 py-1">→ Label</th>
              </tr>
            </thead>
            <tbody>
              {(tbl.columns ?? []).map((c) => (
                <tr key={c.name} className="border-t border-border">
                  <td className="px-2 py-0.5 font-mono">{c.name}</td>
                  <td className="px-2 py-0.5">{c.type}</td>
                  <td className="px-2 py-0.5">{c.isNullable ? "Y" : "N"}</td>
                  <td className="px-2 py-0.5 text-accent">{c.mapTo?.field ?? "—"}</td>
                  <td className="px-2 py-0.5">{c.mapTo?.entityType ?? "—"}</td>
                  <td className="px-2 py-0.5">{c.mapTo?.label ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Inferred relations */}
      {tbl.inferredRelations && tbl.inferredRelations.length > 0 && (
        <div>
          <div className="text-muted mb-1">FK suy ra từ JOIN ({tbl.inferredRelations.length})</div>
          <ul className="text-[11px] space-y-0.5">
            {tbl.inferredRelations.map((r) => (
              <li key={`${r.column}-${r.refTable}-${r.refColumn}`}>
                <code>{r.column}</code> →{" "}
                <code>
                  {r.refTable}.{r.refColumn}
                </code>
                {r.sourceProc && <span className="text-muted"> (qua {r.sourceProc})</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Sample data — lazy + toggle hiện/ẩn */}
      <div>
        {visible && samples != null ? (
          <div className="space-y-1">
            <Button
              size="sm"
              variant="default"
              onClick={() => setVisible(false)}
              icon={<I.ChevronUp size={12} />}
            >
              Ẩn sample rows
            </Button>
            <SampleRowsTable rows={samples} />
          </div>
        ) : (
          <Button
            size="sm"
            variant="default"
            onClick={showSamples}
            disabled={loading}
            icon={<I.Eye size={12} />}
          >
            {loading
              ? "Đang tải..."
              : samples != null
                ? `Hiện ${samples.length} sample rows`
                : "Xem 5 sample rows"}
          </Button>
        )}
        {err && <div className="text-danger text-[11px] mt-1">{err}</div>}
      </div>
    </div>
  );
}

function SampleRowsTable({ rows }: { rows: unknown[] }) {
  if (rows.length === 0)
    return <div className="text-muted text-[11px]">Không có dữ liệu sample.</div>;
  const cols = Array.from(new Set(rows.flatMap((r) => Object.keys(r as object))));
  return (
    <div className="border border-border rounded overflow-auto max-h-64">
      <table className="text-[11px]">
        <thead className="bg-bg text-muted sticky top-0">
          <tr>
            {cols.map((c) => (
              <th key={c} className="text-left px-2 py-1 whitespace-nowrap">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: rows preview thuần đọc, không có id ổn định
            <tr key={i} className="border-t border-border">
              {cols.map((c) => (
                <td key={c} className="px-2 py-0.5 whitespace-nowrap max-w-[200px] truncate">
                  {fmtCell((row as Record<string, unknown>)[c])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ── Nút materialize enum vào hệ thống (bảng `enums`) ─── */

interface MaterializeSingleResult {
  enumId: string;
  enumName: string;
  enumLabel: string;
  valueCount: number;
  valueColumn: string;
  labelColumn: string;
  extraColumns: string[];
  upserted: "created" | "updated";
}
type MaterializeResult =
  | ({ mode: "single" } & MaterializeSingleResult)
  | { mode: "split"; results: MaterializeSingleResult[] };

function MaterializeEnumButton({ tbl, moduleName }: { tbl: ManifestTableRow; moduleName: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="pt-1 border-t border-accent/20">
      <Button
        size="sm"
        variant="primary"
        onClick={() => setOpen(true)}
        icon={<I.Database size={12} />}
      >
        Cấu hình + sinh enum...
      </Button>
      {tbl.splitEnums && tbl.splitEnums.length > 0 && (
        <span className="ml-2 text-[10px] text-accent">
          ⚡ Đang ở chế độ split ({tbl.splitEnums.length} rules)
        </span>
      )}
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={`Sinh enum: ${tbl.name}`}
        width={780}
      >
        <MaterializeEnumDialog tbl={tbl} moduleName={moduleName} onDone={() => setOpen(false)} />
      </Modal>
    </div>
  );
}

function MaterializeEnumDialog({
  tbl,
  moduleName,
  onDone,
}: {
  tbl: ManifestTableRow;
  moduleName: string;
  onDone: () => void;
}) {
  const cols = (tbl.columns ?? []).map((c) => c.name);
  const initialSplits = tbl.splitEnums ?? [];

  const [mode, setMode] = useState<"single" | "split">(
    initialSplits.length > 0 ? "split" : "single",
  );
  // Single mode state.
  const [singleValueCol, setSingleValueCol] = useState<string>(
    tbl.primaryKey?.[0] ?? cols[0] ?? "",
  );
  const [singleLabelCol, setSingleLabelCol] = useState<string>(
    cols.find((c) => /name|ten|label|mo_ta/i.test(c)) ?? singleValueCol,
  );
  const [singleExtra, setSingleExtra] = useState<string[]>([]);
  // Split mode state.
  const [splitRules, setSplitRules] = useState<SplitEnumRule[]>(initialSplits);

  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<MaterializeResult | null>(null);
  const [err, setErr] = useState("");

  // Decision history cho bảng này.
  const [decisions, setDecisions] = useState<
    Array<{ at: string; module: string; action: unknown }>
  >([]);
  useEffect(() => {
    migration
      .decisionsForTable(tbl.name)
      .then((d) => setDecisions(d.slice(-5).reverse()))
      .catch(() => undefined);
  }, [tbl.name]);

  const saveSplitConfig = async (): Promise<void> => {
    await migration.setSplitEnums({
      module: moduleName,
      tableName: tbl.name,
      splitEnums: splitRules,
    });
  };

  const runMaterialize = async () => {
    setBusy(true);
    setErr("");
    setResult(null);
    try {
      if (mode === "split") {
        await saveSplitConfig();
      } else {
        // Đảm bảo manifest không còn splitEnums cũ nếu user chuyển về single.
        if (initialSplits.length > 0) {
          await migration.setSplitEnums({
            module: moduleName,
            tableName: tbl.name,
            splitEnums: [],
          });
        }
      }
      const r = await migration.materializeEnum({
        module: moduleName,
        tableName: tbl.name,
        ...(mode === "single"
          ? {
              valueColumn: singleValueCol || undefined,
              labelColumn: singleLabelCol || undefined,
              extraColumns: singleExtra.length > 0 ? singleExtra : undefined,
            }
          : {}),
      });
      setResult(r);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const addRule = () => {
    setSplitRules([
      ...splitRules,
      {
        discriminatorColumn: cols.find((c) => /loai|type|kind|category/i.test(c)) ?? cols[0] ?? "",
        discriminatorValue: "",
        name: "",
        label: "",
      },
    ]);
  };
  const updateRule = (i: number, patch: Partial<SplitEnumRule>) => {
    setSplitRules(splitRules.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  };
  const removeRule = (i: number) => {
    setSplitRules(splitRules.filter((_, idx) => idx !== i));
  };

  return (
    <div className="space-y-3 text-xs">
      {/* Decision history */}
      {decisions.length > 0 && (
        <Card className="p-2 bg-accent/5 border-accent/30">
          <div className="text-accent font-medium mb-1">
            Quyết định trước đó ({decisions.length})
          </div>
          <ul className="text-[10px] text-muted space-y-0.5">
            {decisions.map((d, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: log quyết định append-only, không có id riêng
              <li key={i}>
                <span>{new Date(d.at).toLocaleString("vi-VN")}</span>
                <span className="ml-2">module={d.module}</span>
                <span className="ml-2">action={(d.action as { type?: string })?.type ?? "?"}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* Mode toggle */}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setMode("single")}
          className={[
            "flex-1 px-3 py-2 border rounded text-left",
            mode === "single" ? "border-accent bg-accent/10" : "border-border hover:bg-surface",
          ].join(" ")}
        >
          <div className="font-medium">Single enum</div>
          <div className="text-[10px] text-muted">
            Cả bảng = 1 enum. Phù hợp khi bảng chứa 1 loại lookup.
          </div>
        </button>
        <button
          type="button"
          onClick={() => setMode("split")}
          className={[
            "flex-1 px-3 py-2 border rounded text-left",
            mode === "split" ? "border-accent bg-accent/10" : "border-border hover:bg-surface",
          ].join(" ")}
        >
          <div className="font-medium">Split (N enum)</div>
          <div className="text-[10px] text-muted">
            1 bảng → nhiều enum theo discriminator column. Vd DM_HE_THONG.
          </div>
        </button>
      </div>

      {mode === "single" ? (
        <Card className="p-3 space-y-2">
          <FormField label="Cột làm `value` (snake_case sau khi sanitize)">
            <ColumnSelect cols={cols} value={singleValueCol} onChange={setSingleValueCol} />
          </FormField>
          <FormField label="Cột làm `label` (hiển thị UI)">
            <ColumnSelect cols={cols} value={singleLabelCol} onChange={setSingleLabelCol} />
          </FormField>
          <FormField label="Extra columns → metadata mỗi value">
            <TagBox
              value={singleExtra}
              onChange={setSingleExtra}
              suggestions={cols}
              placeholder="vd HE_SO_GIA, MA_NHOM..."
            />
            <div className="text-[10px] text-muted mt-1">
              Cột thêm sẽ lưu vào values[].(colName). Vd:{" "}
              <code>{`{value:"vip", label:"VIP", HE_SO_GIA:0.8}`}</code>
            </div>
          </FormField>
        </Card>
      ) : (
        <Card className="p-3 space-y-2">
          <div className="flex items-center justify-between">
            <div className="font-medium">Split rules ({splitRules.length})</div>
            <Button size="sm" variant="default" icon={<I.Plus size={12} />} onClick={addRule}>
              Thêm rule
            </Button>
          </div>
          {splitRules.length === 0 && (
            <div className="text-[11px] text-muted">
              Chưa có rule. Bấm "Thêm rule" để tạo 1 enum theo discriminator.
            </div>
          )}
          {splitRules.map((r, i) => (
            <SplitRuleEditor
              // biome-ignore lint/suspicious/noArrayIndexKey: rule tham chiếu bằng index (update/remove theo i), không có id riêng
              key={i}
              rule={r}
              cols={cols}
              onChange={(patch) => updateRule(i, patch)}
              onRemove={() => removeRule(i)}
            />
          ))}
        </Card>
      )}

      {err && <div className="text-danger whitespace-pre-wrap">{err}</div>}

      {/* Result */}
      {result && (
        <Card className="p-3 bg-success/5 border-success/30">
          <div className="font-medium text-success mb-1">
            ✓ Materialize xong — mode {result.mode}
          </div>
          {result.mode === "single" ? (
            <MaterializeResultRow r={result} />
          ) : (
            <ul className="space-y-1">
              {result.results.map((r) => (
                <li key={r.enumId}>
                  <MaterializeResultRow r={r} />
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      <div className="flex justify-end gap-2 pt-2 border-t border-border">
        <Button variant="default" size="sm" onClick={onDone}>
          Đóng
        </Button>
        <Button
          variant="primary"
          size="sm"
          disabled={busy}
          onClick={runMaterialize}
          icon={busy ? <I.Loader size={12} /> : <I.Database size={12} />}
        >
          {busy
            ? "Đang sinh..."
            : `Sinh enum ${mode === "split" ? `(${splitRules.length} rules)` : ""}`}
        </Button>
      </div>
    </div>
  );
}

function MaterializeResultRow({ r }: { r: MaterializeSingleResult }) {
  return (
    <div className="text-[11px] flex items-center gap-2 flex-wrap">
      <Chip variant="success" className="text-[10px]!">
        {r.upserted === "created" ? "✓ Tạo mới" : "↻ Cập nhật"} — {r.valueCount} giá trị
      </Chip>
      <a href={`/settings/enums/${r.enumId}`} className="text-accent hover:underline">
        Mở "{r.enumName}" →
      </a>
      <span className="text-muted">
        value=<code>{r.valueColumn}</code> · label=<code>{r.labelColumn}</code>
        {r.extraColumns.length > 0 && <> · extra=[{r.extraColumns.join(", ")}]</>}
      </span>
    </div>
  );
}

function ColumnSelect({
  cols,
  value,
  onChange,
}: {
  cols: string[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full px-2 h-8 border border-border rounded bg-bg text-sm outline-none focus:border-accent"
    >
      {cols.map((c) => (
        <option key={c} value={c}>
          {c}
        </option>
      ))}
    </select>
  );
}

function SplitRuleEditor({
  rule,
  cols,
  onChange,
  onRemove,
}: {
  rule: SplitEnumRule;
  cols: string[];
  onChange: (patch: Partial<SplitEnumRule>) => void;
  onRemove: () => void;
}) {
  return (
    <div className="border border-border rounded p-2 space-y-1">
      <div className="grid grid-cols-2 gap-2">
        <FormField label="Discriminator column">
          <ColumnSelect
            cols={cols}
            value={rule.discriminatorColumn}
            onChange={(v) => onChange({ discriminatorColumn: v })}
          />
        </FormField>
        <FormField label="Discriminator value">
          <Input
            value={rule.discriminatorValue}
            onChange={(e) => onChange({ discriminatorValue: e.target.value })}
            placeholder="vd TRANG_THAI_DON"
          />
        </FormField>
        <FormField label="Tên enum (snake_case)">
          <Input
            value={rule.name}
            onChange={(e) => onChange({ name: e.target.value })}
            placeholder="vd trang_thai_don"
          />
        </FormField>
        <FormField label="Label tiếng Việt">
          <Input
            value={rule.label}
            onChange={(e) => onChange({ label: e.target.value })}
            placeholder="vd Trạng thái đơn hàng"
          />
        </FormField>
        <FormField label="Value column (optional)">
          <ColumnSelect
            cols={["", ...cols]}
            value={rule.valueColumn ?? ""}
            onChange={(v) => onChange({ valueColumn: v || undefined })}
          />
        </FormField>
        <FormField label="Label column (optional)">
          <ColumnSelect
            cols={["", ...cols]}
            value={rule.labelColumn ?? ""}
            onChange={(v) => onChange({ labelColumn: v || undefined })}
          />
        </FormField>
      </div>
      <FormField label="Extra columns (optional)">
        <TagBox
          value={rule.extraColumns ?? []}
          onChange={(v) => onChange({ extraColumns: v.length > 0 ? v : undefined })}
          suggestions={cols}
          placeholder="vd HE_SO_GIA, MA_NHOM..."
        />
      </FormField>
      <div className="flex justify-end">
        <Button size="sm" variant="default" onClick={onRemove} icon={<I.Trash size={12} />}>
          Xoá rule
        </Button>
      </div>
    </div>
  );
}

/* ── Panel: procs đầy đủ, expand → load body T-SQL ─────── */

function ProcsPanel({ procs, moduleName }: { procs: ManifestProcRow[]; moduleName: string }) {
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

function EdgesPanel({ edges }: { edges: ManifestEdge[] }) {
  const [open, setOpen] = useState(true);
  if (edges.length === 0) return null;
  return (
    <Card className="p-4">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 font-medium text-warning hover:text-accent mb-2"
      >
        {open ? <I.ChevronDown size={14} /> : <I.ChevronRight size={14} />}
        Cross-module edges ({edges.length})
      </button>
      {open && (
        <>
          <div className="text-xs text-muted mb-2">
            Proc đụng bảng của module khác — cần thiết kế contract (tRPC/event) thay vì JOIN DB.
          </div>
          <div className="border border-border rounded overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-surface text-muted">
                <tr>
                  <th className="text-left px-2 py-1.5">Proc</th>
                  <th className="text-left px-2 py-1.5">Bảng ngoài</th>
                  <th className="text-left px-2 py-1.5">Loại</th>
                  <th className="text-left px-2 py-1.5">Đề xuất contract</th>
                </tr>
              </thead>
              <tbody>
                {edges.map((e) => (
                  <tr
                    key={`${e.proc}-${e.externalTable}-${e.kind}`}
                    className="border-t border-border"
                  >
                    <td className="px-2 py-1 font-mono">{e.proc}</td>
                    <td className="px-2 py-1 font-mono">{e.externalTable}</td>
                    <td className="px-2 py-1">
                      <Chip
                        variant={e.kind === "write" ? "warning" : "default"}
                        className="text-[10px]!"
                      >
                        {e.kind}
                      </Chip>
                    </td>
                    <td className="px-2 py-1 text-[11px] text-muted">
                      {e.suggestedContract ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Card>
  );
}
