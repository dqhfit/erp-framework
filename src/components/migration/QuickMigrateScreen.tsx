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
import { QuickMigratePreviewPane } from "@/components/migration/QuickMigratePreviewPane";
import { Button, Chip, EmptyState, Input } from "@/components/ui";

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
