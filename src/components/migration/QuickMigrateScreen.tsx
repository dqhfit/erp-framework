/* QuickMigrateScreen (Phase S) — màn full-page 2 pane: trái list bảng
   MSSQL + filter/checkbox, phải preview entity/fields + options + nút
   migrate nhanh. Tách từ settings.migration.tsx (pilot refactor). */
import {
  createMigrationClient,
  createMssqlConnectionsClient,
  type MssqlConnectionView,
} from "@erp-framework/client";
import { useEffect, useRef, useState } from "react";
import { I } from "@/components/Icons";
import { Button, Chip, EmptyState, FormField, Input } from "@/components/ui";
import { dialog } from "@/lib/dialog";

const migration = createMigrationClient("");
const connectionsApi = createMssqlConnectionsClient("");

const QM_CONN_KEY = "erp:qm:connId";
const qmSelKey = (connId: string) => `erp:qm:sel:${connId}`;

function readQmSel(connId: string): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(qmSelKey(connId));
    return raw ? (JSON.parse(raw) as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}

export function QuickMigrateScreen({
  onClose,
  onChanged,
}: {
  onClose: () => void;
  onChanged: () => void;
}) {
  const [conns, setConns] = useState<MssqlConnectionView[]>([]);
  const [pickedConnId, setPickedConnId] = useState<string>(() => {
    try {
      return localStorage.getItem(QM_CONN_KEY) ?? "";
    } catch {
      return "";
    }
  });
  const [tables, setTables] = useState<Awaited<ReturnType<typeof migration.listConnectionTables>>>(
    [],
  );
  const [filter, setFilter] = useState("");
  // Khởi tạo selection từ localStorage nếu có connId đã lưu.
  const [selected, setSelected] = useState<Record<string, boolean>>(() =>
    pickedConnId ? readQmSel(pickedConnId) : {},
  );
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  type SyncFilter = "all" | "not-migrated" | "synced" | "incomplete";
  const [syncFilter, setSyncFilter] = useState<SyncFilter>("all");
  // Map mssqlTable (lowercase) → entityName của entity đã migrate cho conn này.
  const [migratedMap, setMigratedMap] = useState<
    Map<string, { name: string; recordCount: number; rowsLastImported: number }>
  >(new Map());
  const [migratedReloadKey, setMigratedReloadKey] = useState(0);
  const reloadMigrated = () => setMigratedReloadKey((k) => k + 1);
  // Snapshot tableNames khi migrate xong để giữ right pane + result hiển thị
  // trong khi left pane đã sẵn sàng chọn bảng mới.
  const [lockedTableNames, setLockedTableNames] = useState<string[] | null>(null);
  // Bảng đang được migrate (gạch + spinner) — user có thể chọn batch mới trong lúc chờ.
  const [pendingTables, setPendingTables] = useState<Set<string>>(new Set());

  // Load connections + validate connId đã lưu; fallback về default nếu không còn.
  // biome-ignore lint/correctness/useExhaustiveDependencies: chỉ load 1 lần lúc mount, pickedConnId đọc giá trị đầu là đủ
  useEffect(() => {
    connectionsApi
      .list()
      .then((cs) => {
        setConns(cs);
        const storedValid = pickedConnId && cs.some((c) => c.id === pickedConnId);
        if (!storedValid) {
          const def = cs.find((c) => c.isDefault) ?? cs[0];
          if (def) setPickedConnId(def.id);
        }
      })
      .catch(() => setConns([]));
  }, []);

  // Persist connId mỗi khi thay đổi.
  useEffect(() => {
    if (!pickedConnId) return;
    try {
      localStorage.setItem(QM_CONN_KEY, pickedConnId);
    } catch {
      /* quota */
    }
  }, [pickedConnId]);

  // Khi connId thay đổi: restore selection đã lưu cho conn đó.
  const prevConnIdRef = useRef("");
  useEffect(() => {
    if (!pickedConnId || pickedConnId === prevConnIdRef.current) return;
    prevConnIdRef.current = pickedConnId;
    setSelected(readQmSel(pickedConnId));
    setLockedTableNames(null);
    setPendingTables(new Set());
    setSyncFilter("all");
  }, [pickedConnId]);

  // Persist selection mỗi khi thay đổi (debounce không cần vì ghi nhanh).
  useEffect(() => {
    if (!pickedConnId) return;
    try {
      localStorage.setItem(qmSelKey(pickedConnId), JSON.stringify(selected));
    } catch {
      /* quota */
    }
  }, [pickedConnId, selected]);

  // Sau khi migratedMap load/update: bỏ chọn bảng đã migrate khỏi selection.
  useEffect(() => {
    if (migratedMap.size === 0) return;
    setSelected((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const k of Object.keys(next)) {
        if (next[k] && migratedMap.has(k.toLowerCase())) {
          delete next[k];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [migratedMap]);

  // Load tables khi pickedConnId đổi.
  useEffect(() => {
    if (!pickedConnId) {
      setTables([]);
      return;
    }
    setBusy(true);
    setErr("");
    migration
      .listConnectionTables(pickedConnId)
      .then((ts) => setTables(ts))
      .catch((e) => setErr((e as Error).message))
      .finally(() => setBusy(false));
  }, [pickedConnId]);

  // Load migrated entities theo connection để biết bảng nào đã migrate.
  // Reload sau mỗi lần migrate thành công (migratedReloadKey++).
  // biome-ignore lint/correctness/useExhaustiveDependencies: chủ ý reload khi migratedReloadKey đổi
  useEffect(() => {
    if (!pickedConnId) {
      setMigratedMap(new Map());
      return;
    }
    migration
      .listMigratedEntities({ connectionId: pickedConnId })
      .then((rows) => {
        const m = new Map<
          string,
          { name: string; recordCount: number; rowsLastImported: number }
        >();
        for (const r of rows) {
          if (r.mssqlTable)
            m.set(r.mssqlTable.toLowerCase(), {
              name: r.name,
              recordCount: r.recordCount,
              rowsLastImported: r.rowsLastImported,
            });
        }
        setMigratedMap(m);
      })
      .catch(() => setMigratedMap(new Map()));
  }, [pickedConnId, migratedReloadKey]);

  // Helper: 1 bảng đã migrate khi mssqlTable (case-insensitive) có trong migratedMap.
  const isMigrated = (fullName: string) => migratedMap.has(fullName.toLowerCase());
  // Hiện tất cả bảng — bảng đã migrate hiển thị disabled + strikethrough bên dưới.
  // Sắp xếp: row count giảm dần (bảng lớn lên trên), chưa migrate trước.
  const sorted = [...tables].sort((a, b) => {
    const aMig = isMigrated(a.fullName) ? 1 : 0;
    const bMig = isMigrated(b.fullName) ? 1 : 0;
    if (aMig !== bMig) return aMig - bMig;
    return (b.rowCount ?? -1) - (a.rowCount ?? -1);
  });
  const filtered = sorted.filter((t) => {
    if (filter && !t.fullName.toLowerCase().includes(filter.toLowerCase())) return false;
    if (syncFilter === "all") return true;
    const info = migratedMap.get(t.fullName.toLowerCase());
    const mssql = t.rowCount ?? null;
    const pg = info?.recordCount ?? null;
    if (syncFilter === "not-migrated") return !info;
    if (syncFilter === "synced") return info != null && mssql != null && pg != null && pg >= mssql;
    if (syncFilter === "incomplete")
      return info != null && (mssql == null || pg == null || pg < mssql);
    return true;
  });
  // Chỉ tính bảng chưa migrate + chưa pending cho "Chọn tất cả".
  const selectableFiltered = filtered.filter(
    (t) => !isMigrated(t.fullName) && !pendingTables.has(t.fullName),
  );
  const migratedFiltered = filtered.filter(
    (t) => isMigrated(t.fullName) && !pendingTables.has(t.fullName),
  );
  const migratedCount = migratedFiltered.length;
  const pendingCount = filtered.filter((t) => pendingTables.has(t.fullName)).length;
  const selectedNames = Object.keys(selected).filter((k) => selected[k]);
  const selectedCount = selectedNames.length;
  // Khi user chọn bảng mới VÀ không còn batch pending, xoá lock để pane reset.
  useEffect(() => {
    if (lockedTableNames !== null && selectedCount > 0 && pendingTables.size === 0) {
      setLockedTableNames(null);
    }
  }, [selectedCount, lockedTableNames, pendingTables.size]);
  // tableNames thực sự truyền xuống pane: locked snapshot hoặc selection hiện tại.
  const activePaneTableNames = lockedTableNames ?? selectedNames;
  const allSelected =
    selectableFiltered.length > 0 && selectableFiltered.every((t) => selected[t.fullName]);
  const toggleAll = () => {
    const next = { ...selected };
    for (const t of selectableFiltered) next[t.fullName] = !allSelected;
    setSelected(next);
  };
  const selectAllMigrated = () => {
    const next = { ...selected };
    for (const t of migratedFiltered) next[t.fullName] = true;
    setSelected(next);
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="border-b border-border bg-surface/40 px-4 py-2.5 flex items-center gap-3">
        <Button
          size="sm"
          variant="ghost"
          onClick={onClose}
          icon={<I.X size={14} />}
          title="Đóng (về module view)"
        />
        <h2 className="text-base font-semibold flex items-center gap-1.5">
          <I.Wand size={16} className="text-accent" />
          Migrate nhanh
        </h2>
        <span className="text-xs text-muted">
          Chọn bảng MSSQL → ETL vào hệ thống (không cần module)
        </span>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-muted">Connection:</span>
          <select
            value={pickedConnId}
            onChange={(e) => {
              setPickedConnId(e.target.value);
            }}
            className="text-xs h-8 px-2 border border-border rounded bg-bg min-w-[200px]"
          >
            {conns.length === 0 && <option value="">(chưa có)</option>}
            {conns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.database}) {c.isDefault ? "★" : ""}
              </option>
            ))}
          </select>
        </div>
      </div>

      {conns.length === 0 ? (
        <div className="flex-1 flex items-center justify-center p-8">
          <EmptyState
            icon={<I.Server size={32} />}
            title="Chưa có connection MSSQL"
            hint="Thêm 1 connection ở panel 'Kết nối MSSQL' (sidebar trái) trước khi migrate."
          />
        </div>
      ) : (
        <div className="flex-1 grid grid-cols-[2fr_3fr] min-h-0">
          {/* Left pane: tables list */}
          <div className="border-r border-border flex flex-col min-h-0">
            <div className="p-3 border-b border-border bg-surface/30 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <div className="font-medium">
                  Bảng MSSQL ({tables.length})
                  {pendingCount > 0 && (
                    <span className="ml-1.5 text-[10px] text-warning animate-pulse">
                      · {pendingCount} đang migrate
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={toggleAll}
                  disabled={selectableFiltered.length === 0}
                  className="text-accent hover:underline disabled:text-muted disabled:no-underline"
                  title="Chọn bảng chưa migrate"
                >
                  {allSelected ? "Bỏ chọn" : "Chọn mới"} ({selectableFiltered.length})
                </button>
              </div>
              {migratedCount > 0 && (
                <div className="flex items-center justify-between text-[11px] bg-success/8 border border-success/20 rounded px-2 py-1">
                  <span className="text-success font-medium">{migratedCount} bảng đã migrate</span>
                  <button
                    type="button"
                    onClick={selectAllMigrated}
                    className="text-accent hover:underline font-medium"
                    title="Chọn tất cả bảng đã migrate để sync lại"
                  >
                    Sync lại tất cả →
                  </button>
                </div>
              )}
              <Input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Lọc tên bảng..."
                className="h-8 text-xs"
              />
              <div className="flex gap-1 flex-wrap">
                {(
                  [
                    { key: "all", label: "Tất cả" },
                    { key: "not-migrated", label: "Chưa migrate" },
                    { key: "incomplete", label: "Thiếu dòng" },
                    { key: "synced", label: "Đủ dòng" },
                  ] as const
                ).map(({ key, label }) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setSyncFilter(key)}
                    className={[
                      "px-2 h-5 rounded text-[10px] font-medium border transition-colors",
                      syncFilter === key
                        ? key === "incomplete"
                          ? "bg-warning/20 border-warning/40 text-warning"
                          : key === "synced"
                            ? "bg-success/20 border-success/40 text-success"
                            : "bg-accent/20 border-accent/40 text-accent"
                        : "bg-transparent border-border text-muted hover:border-accent/40 hover:text-text",
                    ].join(" ")}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {err && <div className="text-danger text-xs">{err}</div>}
            </div>
            <div className="flex-1 overflow-y-auto">
              {busy && tables.length === 0 ? (
                <div className="text-xs text-muted p-4 text-center">Đang tải...</div>
              ) : filtered.length === 0 ? (
                <div className="text-xs text-muted p-4 text-center">
                  {tables.length === 0 ? "Không có bảng" : "Không match filter"}
                </div>
              ) : (
                <ul>
                  {filtered.map((t) => {
                    const migrated = isMigrated(t.fullName);
                    const pending = pendingTables.has(t.fullName);
                    const checked = pending ? true : (selected[t.fullName] ?? false);
                    const migratedInfo = migrated
                      ? migratedMap.get(t.fullName.toLowerCase())
                      : undefined;
                    const mssqlCount = t.rowCount ?? null;
                    const pgCount = migratedInfo?.recordCount ?? null;
                    // Tỉ lệ PG/MSSQL: null nếu thiếu dữ liệu
                    const ratio =
                      mssqlCount != null && mssqlCount > 0 && pgCount != null
                        ? pgCount / mssqlCount
                        : null;
                    const ratioColor =
                      ratio === null
                        ? "text-muted"
                        : ratio >= 1
                          ? "text-success"
                          : ratio >= 0.9
                            ? "text-warning"
                            : "text-danger";
                    return (
                      <li
                        key={t.fullName}
                        className={[
                          "text-xs border-b border-border last:border-0 transition-colors group/row",
                          migrated
                            ? "bg-success/3"
                            : pending
                              ? "opacity-70 bg-warning/5"
                              : checked
                                ? "bg-accent/10"
                                : "hover:bg-hover/20",
                        ].join(" ")}
                      >
                        <label
                          className={[
                            "flex items-center gap-2 px-3 py-1.5",
                            pending ? "cursor-not-allowed" : "cursor-pointer",
                          ].join(" ")}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={pending}
                            onChange={(e) =>
                              setSelected((s) => ({
                                ...s,
                                [t.fullName]: e.target.checked,
                              }))
                            }
                          />
                          <span
                            className={[
                              "font-mono flex-1 truncate min-w-0",
                              pending ? "text-muted" : migrated ? "text-muted" : "",
                            ].join(" ")}
                            title={t.fullName}
                          >
                            {t.fullName}
                          </span>
                          {pending && (
                            <Chip variant="warning" className="text-[9px]! animate-pulse shrink-0">
                              đang migrate
                            </Chip>
                          )}
                          {migrated && !pending && (
                            <>
                              <span className="text-success text-[10px] shrink-0 font-mono">
                                {migratedInfo?.name}
                              </span>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.preventDefault();
                                  setSelected((s) => ({ ...s, [t.fullName]: true }));
                                }}
                                className="opacity-0 group-hover/row:opacity-100 text-[9px] text-accent hover:underline transition-opacity px-0.5 shrink-0"
                                title="Chọn để re-sync"
                              >
                                re-sync
                              </button>
                            </>
                          )}
                          {/* So sánh số dòng MSSQL vs PG */}
                          {migrated && pgCount !== null ? (
                            <span
                              className={`text-[10px] tabular-nums shrink-0 ${ratioColor}`}
                              title={`MSSQL: ${mssqlCount?.toLocaleString("vi-VN") ?? "?"} / PG: ${pgCount.toLocaleString("vi-VN")}${ratio !== null ? ` (${Math.round(ratio * 100)}%)` : ""}`}
                            >
                              {pgCount.toLocaleString("vi-VN")}
                              <span className="text-muted">
                                /{mssqlCount?.toLocaleString("vi-VN") ?? "?"}
                              </span>
                            </span>
                          ) : (
                            <span className="text-muted text-[10px] tabular-nums shrink-0">
                              {mssqlCount !== null ? mssqlCount.toLocaleString("vi-VN") : "?"}
                            </span>
                          )}
                        </label>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
            <div className="px-3 py-2 border-t border-border bg-surface/40 text-xs flex items-center justify-between">
              <span>
                Đã chọn: <span className="font-semibold text-accent">{selectedCount}</span> bảng
              </span>
              {selectedCount > 0 && (
                <button
                  type="button"
                  onClick={() => setSelected({})}
                  className="text-muted hover:text-danger"
                >
                  Bỏ chọn tất cả
                </button>
              )}
            </div>
          </div>

          {/* Right pane: preview + options + start */}
          <div className="flex flex-col min-h-0 overflow-hidden">
            {selectedCount === 0 && lockedTableNames === null ? (
              <div className="flex-1 flex items-center justify-center p-8">
                <EmptyState
                  icon={<I.Table size={32} />}
                  title="Chọn bảng từ list bên trái"
                  hint="Tích vào checkbox bảng cần migrate. Có thể chọn nhiều bảng cùng lúc — hệ thống sẽ preview entity/fields tự sinh."
                />
              </div>
            ) : (
              <QuickMigratePreviewPane
                connectionId={pickedConnId}
                tableNames={activePaneTableNames}
                migratedTableNames={
                  new Set(activePaneTableNames.filter((n) => migratedMap.has(n.toLowerCase())))
                }
                onDone={() => {
                  setLockedTableNames(null);
                  setSelected({});
                  onChanged();
                }}
                onTablesChanged={() => {
                  reloadMigrated();
                  onChanged();
                }}
                onMigrateStarted={(tNames) => {
                  setPendingTables(new Set(tNames));
                  setLockedTableNames(tNames);
                  setSelected({});
                }}
                onMigrateFailed={(tNames) => {
                  setPendingTables(new Set());
                  // Khôi phục selection để user có thể retry.
                  setSelected(Object.fromEntries(tNames.map((n) => [n, true])));
                  setLockedTableNames(null);
                }}
                onMigrateCompleted={(tNames) => {
                  setPendingTables(new Set());
                  setLockedTableNames(tNames);
                  setSelected({});
                  reloadMigrated();
                  onChanged();
                }}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* Pane preview + options + start — được mount lại khi tableNames đổi
 * (key trên parent) để clear state preview cũ. */
function QuickMigratePreviewPane({
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
