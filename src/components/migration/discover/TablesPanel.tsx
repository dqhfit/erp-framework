/* TablesPanel — danh sách bảng đã phát hiện + chi tiết (schema/sample) +
   materialize enum (split rule). Tách từ DiscoverTab.tsx. */
import { createMigrationClient } from "@erp-framework/client";
import { Fragment, useMemo, useState } from "react";
import { I } from "@/components/Icons";
import { MaterializeEnumButton } from "@/components/migration/discover/MaterializeEnum";
import { fmtCell } from "@/components/migration/format";
import type { ManifestTableRow } from "@/components/migration/manifest-types";
import { Button, Card, Chip } from "@/components/ui";
import { dialog } from "@/lib/dialog";

const migration = createMigrationClient("");

export function TablesPanel({
  tables,
  moduleName,
}: {
  tables: ManifestTableRow[];
  moduleName: string;
}) {
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
