/* QuickMigratePreviewPane — pane phải màn Quick Migrate: preview entity/
   fields của bảng đã chọn + options + nút migrate. Tách từ QuickMigrateScreen.tsx. */
import { createMigrationClient } from "@erp-framework/client";
import { useEffect, useRef, useState } from "react";
import { I } from "@/components/Icons";
import { Button, Chip, FormField, Input } from "@/components/ui";
import { dialog } from "@/lib/dialog";

const migration = createMigrationClient("");

export function QuickMigratePreviewPane({
  connectionId,
  tableNames,
  migratedTableNames,
  onDone,
  onTablesChanged,
  onMigrateStarted,
  onMigrateFailed,
  onMigrateCompleted,
}: {
  connectionId: string;
  tableNames: string[];
  /** Tập bảng đã migrate trong selection hiện tại — hiện banner nhắc force/upsert. */
  migratedTableNames: Set<string>;
  onDone: () => void;
  /** Gọi khi entity được tạo/cập nhật trong DB (full-mode job create). */
  onTablesChanged: () => void;
  /** Gọi ngay khi bắt đầu migrate thực (non-dryRun) — parent mark pending. */
  onMigrateStarted: (tableNames: string[]) => void;
  /** Gọi khi migrate thực thất bại — parent restore selection để user retry. */
  onMigrateFailed: (tableNames: string[]) => void;
  /** Gọi sau quick migrate thực (non-dryRun) thành công. */
  onMigrateCompleted: (tableNames: string[]) => void;
}) {
  const [previews, setPreviews] = useState<QuickPreview[]>([]);
  const [limit, setLimit] = useState(10_000);
  const [dryRun, setDryRun] = useState(true);
  const [force, setForce] = useState(false);
  const [writeManifest, setWriteManifest] = useState(true);
  const [fullMode, setFullMode] = useState(true);
  const [batchSize, setBatchSize] = useState(5000);
  // Import THẲNG vào bảng thật (HYBRID) thay vì EAV — bảng mang tên DB cũ.
  const [importToTable, setImportToTable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Awaited<
    ReturnType<typeof migration.quickMigrateTables>
  > | null>(null);
  const [fullJobResult, setFullJobResult] = useState<{ jobId: string } | null>(null);
  const [err, setErr] = useState("");

  // Cache preview theo tableName — persist khi user thêm/bớt bảng, kể cả
  // sau khi user chỉnh sửa entityName/label/fields. Xóa khi connection đổi.
  const previewCacheRef = useRef<Map<string, QuickPreview>>(new Map());
  const prevConnectionIdRef = useRef(connectionId);

  // Stable key — không fire khi parent re-render với cùng selection.
  const tableNamesKey = tableNames.join("\0");

  // Debounce 300ms: chờ user chọn xong mới fetch, tránh bắn batch mỗi lần tick checkbox.
  const [debouncedKey, setDebouncedKey] = useState(tableNamesKey);
  // biome-ignore lint/correctness/useExhaustiveDependencies: debounce intentional
  useEffect(() => {
    const id = setTimeout(() => setDebouncedKey(tableNamesKey), 300);
    return () => clearTimeout(id);
  }, [tableNamesKey]);

  // Load preview: cache → hiện ngay; bảng mới → fetch với concurrency 3.
  // biome-ignore lint/correctness/useExhaustiveDependencies: dùng debouncedKey thay array ref
  useEffect(() => {
    const cache = previewCacheRef.current;
    // Connection đổi → xóa cache tránh hiện data sai server.
    if (connectionId !== prevConnectionIdRef.current) {
      cache.clear();
      prevConnectionIdRef.current = connectionId;
    }

    // tableNames luôn tính từ prop gốc (không phải debouncedKey).
    const names = debouncedKey ? debouncedKey.split("\0") : [];
    const toFetch = names.filter((t) => !cache.has(t));

    setPreviews(
      names.map(
        (t) =>
          cache.get(t) ?? {
            tableName: t,
            entityName: "",
            label: "",
            fields: [],
            loading: true,
          },
      ),
    );
    setResult(null);
    setFullJobResult(null);

    if (toFetch.length === 0) return;

    let cancelled = false;
    let idx = 0;

    const fetchOne = async (t: string) => {
      try {
        const p = await migration.previewQuickTable(connectionId, t, 0);
        if (cancelled) return;
        const pkRawCol = p.info.primaryKey?.[0];
        let pkField: string | undefined;
        if (pkRawCol) {
          const slug = pkRawCol
            .toLowerCase()
            .replace(/[^a-z0-9_]+/g, "_")
            .replace(/^_+|_+$/g, "");
          pkField = p.suggested.fields.find((f) => f.name === slug)?.name ?? slug;
        }
        const preview: QuickPreview = {
          tableName: t,
          entityName: p.suggested.entityName,
          label: p.suggested.label,
          fields: p.suggested.fields,
          pkField,
          loading: false,
        };
        cache.set(t, preview);
        setPreviews((prev) => prev.map((r) => (r.tableName === t ? preview : r)));
      } catch (e) {
        if (cancelled) return;
        const preview: QuickPreview = {
          tableName: t,
          entityName: "",
          label: "",
          fields: [],
          loading: false,
          error: (e as Error).message,
        };
        setPreviews((prev) => prev.map((r) => (r.tableName === t ? preview : r)));
      }
    };

    // Chạy tối đa 3 request song song — tránh spam server khi chọn nhiều bảng.
    const worker = async () => {
      while (true) {
        const i = idx++;
        if (i >= toFetch.length) break;
        await fetchOne(toFetch[i]!);
      }
    };
    const CONCURRENCY = 3;
    Promise.all(Array.from({ length: Math.min(CONCURRENCY, toFetch.length) }, worker));

    return () => {
      cancelled = true;
    };
  }, [connectionId, debouncedKey]);

  const updatePreview = (tableName: string, patch: Partial<QuickPreview>) => {
    setPreviews((ps) =>
      ps.map((p) => {
        if (p.tableName !== tableName) return p;
        const updated = { ...p, ...patch };
        previewCacheRef.current.set(tableName, updated);
        return updated;
      }),
    );
  };
  const updateField = (
    tableName: string,
    fieldIdx: number,
    patch: Partial<{ name: string; label: string; type: string }>,
  ) => {
    setPreviews((ps) =>
      ps.map((p) => {
        if (p.tableName !== tableName) return p;
        const next = [...p.fields];
        const cur = next[fieldIdx];
        if (!cur) return p;
        next[fieldIdx] = { ...cur, ...patch };
        const updated = { ...p, fields: next };
        previewCacheRef.current.set(tableName, updated);
        return updated;
      }),
    );
  };

  const retryPreview = async (tableName: string) => {
    previewCacheRef.current.delete(tableName);
    updatePreview(tableName, { loading: true, error: undefined });
    try {
      const p = await migration.previewQuickTable(connectionId, tableName, 0);
      const pkRawCol = p.info.primaryKey?.[0];
      let pkField: string | undefined;
      if (pkRawCol) {
        const slug = pkRawCol
          .toLowerCase()
          .replace(/[^a-z0-9_]+/g, "_")
          .replace(/^_+|_+$/g, "");
        pkField = p.suggested.fields.find((f) => f.name === slug)?.name ?? slug;
      }
      const preview: QuickPreview = {
        tableName,
        entityName: p.suggested.entityName,
        label: p.suggested.label,
        fields: p.suggested.fields,
        pkField,
        loading: false,
      };
      previewCacheRef.current.set(tableName, preview);
      updatePreview(tableName, preview);
    } catch (e) {
      updatePreview(tableName, { loading: false, error: (e as Error).message });
    }
  };

  const run = async () => {
    setBusy(true);
    setErr("");
    setResult(null);
    setFullJobResult(null);
    const willMigrate = fullMode || !dryRun;
    try {
      const items = previews
        .filter((p) => !p.loading && !p.error && p.entityName && p.fields.length > 0)
        .map((p) => ({
          tableName: p.tableName,
          entityName: p.entityName,
          label: p.label || p.entityName,
          fields: p.fields,
          pkField: p.pkField,
        }));
      if (items.length === 0) {
        setErr("Không có bảng nào hợp lệ để migrate.");
        return;
      }
      // Thông báo parent ngay trước khi gọi API — left pane gạch + user chọn tiếp.
      if (willMigrate) onMigrateStarted(tableNames);
      if (fullMode) {
        const r = await migration.startFullImport({
          connectionId,
          items,
          batchSize,
          writeManifest,
          targetTier: importToTable ? "table" : "eav",
        });
        setFullJobResult(r);
        // Full mode: entity được prep ngay khi job tạo → reload migratedMap.
        onTablesChanged();
      } else {
        const r = await migration.quickMigrateTables({
          connectionId,
          items: items.map((i) => ({ ...i, force })),
          limitPerTable: limit,
          dryRun,
          writeManifest,
        });
        setResult(r);
        if (!dryRun) {
          onMigrateCompleted(tableNames);
        }
      }
    } catch (e) {
      setErr((e as Error).message);
      if (willMigrate) onMigrateFailed(tableNames);
    } finally {
      setBusy(false);
    }
  };

  const allReady = previews.every((p) => !p.loading);

  return (
    <>
      {/* Preview cards */}
      <div className="flex-1 overflow-y-auto p-4 space-y-2 min-h-0">
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs font-medium text-muted">{tableNames.length} bảng được chọn</span>
          {!allReady && (
            <span className="text-[10px] text-muted animate-pulse">Đang tải preview...</span>
          )}
        </div>

        {previews.map((p, cardIdx) => (
          <details
            key={p.tableName}
            className="border border-border rounded bg-bg"
            open={tableNames.length <= 3 || cardIdx === 0}
          >
            <summary className="px-3 py-2 cursor-pointer flex items-center gap-2 hover:bg-hover/20 list-none">
              <I.ChevronRight
                size={12}
                className="text-muted shrink-0 transition-transform [[open]_&]:rotate-90"
              />
              <span className="font-mono text-xs flex-1 truncate">{p.tableName}</span>
              {p.loading ? (
                <span className="text-muted text-[10px] animate-pulse">Đang tải...</span>
              ) : p.error ? (
                <>
                  <Chip variant="danger" className="text-[9px]!">
                    {p.error.slice(0, 40)}
                  </Chip>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      retryPreview(p.tableName);
                    }}
                    className="text-[10px] text-accent hover:underline px-1"
                  >
                    ↺ Thử lại
                  </button>
                </>
              ) : (
                <>
                  <span className="text-accent text-xs font-mono">{p.entityName}</span>
                  {p.pkField && (
                    <Chip variant="warning" className="text-[9px]!" title={`PK: ${p.pkField}`}>
                      PK: {p.pkField}
                    </Chip>
                  )}
                  <Chip variant="default" className="text-[9px]!">
                    {p.fields.length} fields
                  </Chip>
                </>
              )}
            </summary>
            {!p.loading && !p.error && (
              <div className="p-3 space-y-2 border-t border-border bg-surface/20">
                <div className="grid grid-cols-2 gap-2">
                  <FormField label="Tên entity (snake_case)">
                    <Input
                      value={p.entityName}
                      onChange={(e) => updatePreview(p.tableName, { entityName: e.target.value })}
                    />
                  </FormField>
                  <FormField label="Label hiển thị">
                    <Input
                      value={p.label}
                      onChange={(e) => updatePreview(p.tableName, { label: e.target.value })}
                    />
                  </FormField>
                </div>
                <div className="border border-border rounded overflow-hidden">
                  <table className="w-full text-[10px]">
                    <thead className="bg-surface text-muted">
                      <tr>
                        <th className="text-left px-2 py-1 w-6" title="Khoá chính">
                          PK
                        </th>
                        <th className="text-left px-2 py-1">Field name</th>
                        <th className="text-left px-2 py-1">Label</th>
                        <th className="text-left px-2 py-1 w-24">Type</th>
                      </tr>
                    </thead>
                    <tbody>
                      {p.fields.map((f, idx) => {
                        const isPk = p.pkField === f.name;
                        return (
                          <tr
                            key={`${p.tableName}:${f.name}`}
                            className={["border-t border-border", isPk ? "bg-warning/5" : ""].join(
                              " ",
                            )}
                          >
                            <td className="px-2 py-0.5 text-center">
                              {isPk ? (
                                <span className="text-warning" title="Khoá chính (PK)">
                                  <I.Key size={10} />
                                </span>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => updatePreview(p.tableName, { pkField: f.name })}
                                  className="opacity-20 hover:opacity-70 text-muted transition-opacity"
                                  title="Đặt làm khoá chính"
                                >
                                  <I.Key size={10} />
                                </button>
                              )}
                            </td>
                            <td className="px-1 py-0.5">
                              <Input
                                value={f.name}
                                onChange={(e) =>
                                  updateField(p.tableName, idx, { name: e.target.value })
                                }
                                className="h-6 text-[10px] font-mono"
                              />
                            </td>
                            <td className="px-1 py-0.5">
                              <Input
                                value={f.label}
                                onChange={(e) =>
                                  updateField(p.tableName, idx, { label: e.target.value })
                                }
                                className="h-6 text-[10px]"
                              />
                            </td>
                            <td className="px-1 py-0.5">
                              <select
                                value={f.type}
                                onChange={(e) =>
                                  updateField(p.tableName, idx, { type: e.target.value })
                                }
                                className="h-6 text-[10px] w-full px-1 border border-border rounded bg-bg"
                              >
                                {[
                                  "text",
                                  "number",
                                  "boolean",
                                  "date",
                                  "datetime",
                                  "json",
                                  "select",
                                ].map((t) => (
                                  <option key={t} value={t}>
                                    {t}
                                  </option>
                                ))}
                              </select>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </details>
        ))}

        {err && (
          <div className="p-2 rounded border border-danger/40 bg-danger/5 text-danger text-xs whitespace-pre-wrap">
            {err}
          </div>
        )}

        {fullJobResult && (
          <div className="p-3 rounded border border-accent/40 bg-accent/5">
            <div className="font-medium text-accent text-sm">✓ Đã tạo full-import job</div>
            <div className="text-xs text-muted mt-1">
              Worker đang chạy nền. Theo dõi tiến độ ở "Jobs import" (sidebar).
            </div>
            <div className="font-mono text-[10px] mt-1 break-all">{fullJobResult.jobId}</div>
            <div className="mt-2 flex justify-end">
              <button
                type="button"
                onClick={onDone}
                className="text-xs text-accent hover:underline"
              >
                Chọn bảng khác →
              </button>
            </div>
          </div>
        )}

        {result && (
          <div
            className={[
              "p-3 rounded border space-y-1.5",
              result.failed === 0
                ? "border-success/40 bg-success/5"
                : "border-warning/40 bg-warning/5",
            ].join(" ")}
          >
            <div className="font-medium text-sm">
              {result.dryRun ? "Dry-run — không ghi DB" : "Đã migrate"}:{" "}
              <span className="text-success">{result.succeeded}</span>
              {result.failed > 0 && (
                <span className="text-warning ml-1">/ {result.failed} lỗi</span>
              )}
              {" / "}
              {result.total} bảng — {result.totalRowsRead.toLocaleString("vi-VN")} row đọc,{" "}
              <span className="text-success">
                +{result.totalRowsUpserted.toLocaleString("vi-VN")} mới
              </span>
              {result.totalRowsUpdated > 0 && (
                <span className="text-accent ml-1">
                  ↻{result.totalRowsUpdated.toLocaleString("vi-VN")} cập nhật
                </span>
              )}
            </div>
            {result.dryRun && result.failed === 0 && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted">Preview OK —</span>
                <button
                  type="button"
                  onClick={() => {
                    setDryRun(false);
                    setResult(null);
                  }}
                  className="text-xs text-accent font-medium hover:underline"
                >
                  Apply migrate ngay →
                </button>
              </div>
            )}
            <div className="max-h-[120px] overflow-y-auto text-[10px] font-mono space-y-0.5">
              {result.results.map((r) => (
                <div
                  key={r.tableName}
                  className={r.ok ? "text-muted" : "text-warning"}
                  title={r.error}
                >
                  {r.ok ? "✓" : "✗"} {r.tableName} → {r.entityName ?? "?"}: {r.rowsRead}r
                  {r.ok && (
                    <>
                      {" "}
                      +{r.rowsUpserted}
                      {r.rowsUpdated > 0 && ` ↻${r.rowsUpdated}`}
                    </>
                  )}
                  {r.truncated && <span className="text-warning ml-1">[giới hạn!]</span>}
                  {r.error && <span className="ml-1">— {r.error.slice(0, 80)}</span>}
                </div>
              ))}
            </div>
            {!result.dryRun && (
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={onDone}
                  className="text-xs text-accent hover:underline"
                >
                  Chọn bảng khác →
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Options + Run */}
      <div className="border-t border-border bg-surface/40 p-3 space-y-2.5">
        {/* Banner khi có bảng đã migrate trong selection */}
        {migratedTableNames.size > 0 && !result && (
          <div className="flex items-center gap-2 text-[11px] bg-warning/8 border border-warning/25 rounded px-2.5 py-1.5">
            <I.RefreshCw size={11} className="text-warning shrink-0" />
            <span className="text-warning font-medium">
              {migratedTableNames.size} bảng đã migrate.
            </span>
            <span className="text-muted">
              Dữ liệu cũ sẽ được upsert theo PK (nếu có) hoặc bật "Xoá cũ + import lại" để reset
              hoàn toàn.
            </span>
          </div>
        )}
        {/* Mode tabs */}
        <div className="flex gap-1 p-0.5 bg-bg-soft rounded-lg border border-border w-fit">
          <button
            type="button"
            onClick={() => setFullMode(false)}
            className={[
              "px-3 h-7 rounded-md text-xs font-medium transition-colors",
              !fullMode ? "bg-panel shadow text-text" : "text-muted hover:text-text",
            ].join(" ")}
          >
            Sync ngay
          </button>
          <button
            type="button"
            onClick={() => setFullMode(true)}
            className={[
              "px-3 h-7 rounded-md text-xs font-medium transition-colors",
              fullMode ? "bg-panel shadow text-text" : "text-muted hover:text-text",
            ].join(" ")}
          >
            Full job (nền)
          </button>
        </div>

        {/* Per-mode options */}
        {fullMode ? (
          <div className="flex items-center gap-3 text-xs flex-wrap">
            <span className="text-muted">Tự resume nếu lỗi, không giới hạn rows.</span>
            <label className="flex items-center gap-1.5">
              <span className="text-muted">Batch size:</span>
              <input
                type="number"
                min={100}
                max={50_000}
                value={batchSize}
                onChange={(e) =>
                  setBatchSize(
                    Math.max(100, Math.min(50_000, Number.parseInt(e.target.value, 10) || 100)),
                  )
                }
                className="w-20 px-1 py-0.5 border border-border rounded bg-bg text-xs"
              />
            </label>
            <label className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={writeManifest}
                onChange={(e) => setWriteManifest(e.target.checked)}
              />
              <span>Lưu manifest</span>
            </label>
            <label
              className="flex items-center gap-1.5"
              title="Cần bật ERP_HYBRID_TABLES=1 ở server"
            >
              <input
                type="checkbox"
                checked={importToTable}
                onChange={(e) => setImportToTable(e.target.checked)}
              />
              <span>Import thẳng vào bảng thật (tên DB cũ)</span>
            </label>
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                const ok = await dialog.confirm(
                  "Đổi tên TẤT CẢ bảng thật đã promote (er_…) sang đúng tên bảng DB cũ? Bỏ qua mục đã đúng tên hoặc bị trùng.",
                  { title: "Đổi tên bảng thật", confirmText: "Đổi tên" },
                );
                if (!ok) return;
                try {
                  const r = await migration.renamePromotedTablesToSource();
                  const lines = r.results
                    .map(
                      (x) =>
                        `• ${x.label}: ${x.from} → ${x.to} [${x.status}${x.reason ? `: ${x.reason}` : ""}]`,
                    )
                    .join("\n");
                  await dialog.alert(
                    `Đã đổi tên ${r.renamed} bảng.\n\n${lines || "(không có bảng thật nào)"}`,
                    {
                      title: "Kết quả đổi tên",
                    },
                  );
                } catch (e) {
                  await dialog.alert((e as Error).message, { title: "Lỗi đổi tên bảng" });
                }
              }}
              className="px-2 py-0.5 rounded border border-border hover:bg-hover/40 text-muted hover:text-text"
              title="Đổi tên các bảng thật đã promote sang đúng tên bảng DB cũ"
            >
              Đổi tên bảng thật → tên DB cũ
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-3 text-xs flex-wrap">
            <label className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={dryRun}
                onChange={(e) => {
                  setDryRun(e.target.checked);
                  if (e.target.checked) setForce(false);
                }}
              />
              <span>Dry-run (không ghi DB)</span>
            </label>
            <label className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={force}
                disabled={dryRun}
                onChange={(e) => setForce(e.target.checked)}
              />
              <span className={dryRun ? "text-muted" : ""}>Xoá cũ + import lại</span>
            </label>
            <label className="flex items-center gap-1.5">
              <span className="text-muted">Limit/bảng:</span>
              <input
                type="number"
                min={1}
                max={100_000}
                value={limit}
                disabled={dryRun}
                onChange={(e) =>
                  setLimit(Math.max(1, Math.min(100_000, Number.parseInt(e.target.value, 10) || 1)))
                }
                className="w-20 px-1 py-0.5 border border-border rounded bg-bg text-xs disabled:opacity-50"
              />
            </label>
            <label className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={writeManifest}
                disabled={dryRun}
                onChange={(e) => setWriteManifest(e.target.checked)}
              />
              <span className={dryRun ? "text-muted" : ""}>Lưu manifest</span>
            </label>
          </div>
        )}

        <div className="flex justify-end">
          <Button
            variant={dryRun && !fullMode ? "default" : "primary"}
            size="md"
            disabled={busy || !allReady}
            onClick={run}
            icon={
              busy ? (
                <I.Loader size={14} />
              ) : fullMode ? (
                <I.Server size={14} />
              ) : (
                <I.Database size={14} />
              )
            }
          >
            {busy
              ? "Đang xử lý..."
              : fullMode
                ? `Tạo job (${tableNames.length} bảng)`
                : dryRun
                  ? `Preview dry-run (${tableNames.length} bảng)`
                  : `Migrate ngay (${tableNames.length} bảng)`}
          </Button>
        </div>
      </div>
    </>
  );
}

interface QuickPreview {
  tableName: string;
  entityName: string;
  label: string;
  fields: Array<{ name: string; label: string; type: string }>;
  /** PK field (lower-case theo fields.name) suy từ MSSQL info.primaryKey[0].
   *  Dùng để upsert chống duplicate khi migrate lại. */
  pkField?: string;
  loading: boolean;
  error?: string;
}
