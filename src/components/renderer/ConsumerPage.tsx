/* ==========================================================
   ConsumerPage — render trang ĐÃ THIẾT KẾ ở chế độ người dùng.
   Đọc danh sách widget từ pageContent (do PageDesigner lưu) và
   render trên lưới 12 cột. Widget list/chart/kanban truy vấn
   RECORD THẬT của entity bound (qua ApiDataSource); widget form
   ghi record thật vào backend. KHÔNG còn dữ liệu giả.
   ========================================================== */
import type { ReactElement } from "react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { MapContainer, Marker, Popup, TileLayer } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { createApiDataSource } from "@erp-framework/client";
import { I } from "@/components/Icons";
import { ActionWidget } from "@/components/renderer/ActionWidget";
import { Chart } from "@/components/renderer/Chart";
import { DataGrid } from "@/components/renderer/DataGrid";
import { ExcelGrid } from "@/components/renderer/ExcelGrid";
import { LookupPicker } from "@/components/renderer/LookupPicker";
import { isScalableKind, ScaleToFit } from "@/components/ScaleToFit";
import { Chip, SearchableSelect } from "@/components/ui";
import { TagBox } from "@/components/ui/tagbox";
import { useIsMobile } from "@/hooks/useMediaQuery";
import { useT } from "@/hooks/useT";
import { applyFieldFormat } from "@/lib/format";
import type { EntityField, MockEntity } from "@/lib/object-types";
import { applyFilters } from "@/lib/page-filters";
import { applyInsertAndResolve } from "@/lib/page-layout";
import { fieldCan } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { useAuth } from "@/stores/auth";
import { useRbac } from "@/stores/rbac";
import { useUserObjects } from "@/stores/userObjects";
import type { ActionConfig, FilterNode } from "@/types/page";

const api = createApiDataSource("");

type ChartKind = "bar" | "line" | "area" | "pie" | "doughnut";

interface PageComponent {
  id: string;
  kind: string;
  x: number;
  y: number;
  w: number;
  h: number;
  config: Record<string, unknown>;
}

/* ── Phase V — Page state cho master-detail cross-widget cross-talk ─
 *
 * Mỗi page có 1 kv store; widget read/write qua usePageState. List set
 * recordId khi click row → detail/child widget khác đọc state để load
 * record cụ thể hoặc filter theo state. */
type PageStateValue = unknown;
interface PageStateCtx {
  get: (key: string) => PageStateValue;
  set: (key: string, value: PageStateValue) => void;
  values: Record<string, PageStateValue>;
}
const PageStateContext = createContext<PageStateCtx | null>(null);

function PageStateProvider({ children }: { children: React.ReactNode }) {
  const [values, setValues] = useState<Record<string, PageStateValue>>({});
  const ctx = useMemo<PageStateCtx>(
    () => ({
      values,
      get: (key) => values[key],
      set: (key, value) =>
        setValues((prev) => (prev[key] === value ? prev : { ...prev, [key]: value })),
    }),
    [values],
  );
  return <PageStateContext.Provider value={ctx}>{children}</PageStateContext.Provider>;
}

function usePageState(): PageStateCtx {
  const ctx = useContext(PageStateContext);
  if (!ctx) {
    // Fallback no-op khi component render ngoài provider (vd editor preview).
    return {
      values: {},
      get: () => undefined,
      set: () => undefined,
    };
  }
  return ctx;
}

/* ── Tùy chọn tải dữ liệu (số dòng + điều kiện + cổng) ────────────────────── */

type LoadFilterOp = "=" | "!=" | ">" | ">=" | "<" | "<=" | "contains" | "in";
/** Điều kiện lọc server-side: map field → {op, value} (khớp QueryParams.filters). */
type LoadFilters = Record<string, { op: LoadFilterOp; value: unknown }>;

/** Số dòng mặc định khi widget không cấu hình rowLimit. */
const DEFAULT_ROW_LIMIT = 500;
/** Trần cứng — khớp queryParams.limit.max(10_000) ở server (tránh lỗi validate). */
const MAX_ROW_LIMIT = 10_000;

interface UseRecordsOpts {
  /** Số dòng tối đa tải (server-side LIMIT). Mặc định 500. */
  limit?: number;
  /** Điều kiện lọc áp ở DB TRƯỚC khi cắt limit. */
  filters?: LoadFilters;
  /** Cổng: false → không tải gì (vd chờ chọn bộ lọc). Mặc định true. */
  enabled?: boolean;
}

/** Suy ra UseRecordsOpts từ config widget + page-state.
 *  - rowLimit  : số dòng (number > 0).
 *  - loadFilters: điều kiện server-side {field: {op, value}}.
 *  - loadGate  : stateKey — chỉ tải khi state này có giá trị. */
function useDataOpts(cfg: Record<string, unknown>): UseRecordsOpts {
  const pageState = usePageState();
  const rawLimit = cfg.rowLimit;
  const limit =
    typeof rawLimit === "number" && rawLimit > 0
      ? Math.min(Math.floor(rawLimit), MAX_ROW_LIMIT)
      : DEFAULT_ROW_LIMIT;
  const lf = cfg.loadFilters as LoadFilters | undefined;
  let filters: LoadFilters | undefined;
  if (lf && Object.keys(lf).length > 0) {
    // Chuẩn hóa: op "in" cần value là MẢNG (server dùng = ANY(arr)); designer
    // lưu chuỗi "a,b,c" → tách thành mảng. Op khác giữ nguyên.
    filters = {};
    for (const [field, cond] of Object.entries(lf)) {
      if (cond.op === "in" && typeof cond.value === "string") {
        filters[field] = {
          op: "in",
          value: cond.value
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
        };
      } else {
        filters[field] = cond;
      }
    }
  }
  const gateKey = (cfg.loadGate as string | undefined)?.trim();
  let enabled = true;
  if (gateKey) {
    const v = pageState.get(gateKey);
    enabled = !(v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0));
  }
  return { limit, filters, enabled };
}

/** Hook nhỏ — nạp record thật của một entity (số dòng + điều kiện cấu hình được).
 *  Khi ActionWidget gọi procedure xong, nó set pageState["__refresh:<entityId>"]
 *  = timestamp; ta đọc tag đó vào deps để useEffect re-run → refetch. */
function useRecords(entityId?: string, opts?: UseRecordsOpts) {
  const limit = opts?.limit ?? DEFAULT_ROW_LIMIT;
  const enabled = opts?.enabled !== false;
  const filters = opts?.filters;
  // Khóa ổn định cho deps — tránh re-fetch vô hạn do object literal mới mỗi render.
  const filtersKey = filters ? JSON.stringify(filters) : "";

  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState<boolean>(!!entityId && enabled);
  const [err, setErr] = useState("");
  const pageState = usePageState();
  const refreshTag = entityId
    ? (pageState.get(`__refresh:${entityId}`) as number | undefined)
    : undefined;
  // biome-ignore lint/correctness/useExhaustiveDependencies: deps cố ý dùng filtersKey (chuỗi ổn định) thay cho object filters; refreshTag là tín hiệu reload thủ công
  useEffect(() => {
    if (!entityId || !enabled) {
      setRows([]);
      setLoading(false);
      return;
    }
    let alive = true;
    setLoading(true);
    setErr("");
    api
      .getRecords(entityId, { limit, filters })
      .then((res) => {
        if (alive) {
          setRows(res.rows.map((r) => r.data));
          setLoading(false);
        }
      })
      .catch((e) => {
        if (alive) {
          setErr((e as Error).message);
          setLoading(false);
        }
      });
    return () => {
      alive = false;
    };
    // filtersKey thay cho filters object để deps ổn định.
  }, [entityId, refreshTag, limit, enabled, filtersKey]);
  return { rows, loading, err };
}

function useEntity(entityId?: string): MockEntity | undefined {
  const entities = useUserObjects((s) => s.entities);
  return entities.find((e) => e.id === entityId);
}

/* ── DataSource (ORM-like) read hook — row PHẲNG đã join + field meta. ──
   refresh tag riêng (`__refresh:ds:<id>`) để ActionWidget có thể trigger refetch.
   field meta map sang EntityField (key→name/id) để widget dùng đồng nhất. */
function useDataSourceRecords(dataSourceId: string | undefined, opts: UseRecordsOpts) {
  const limit = opts.limit ?? DEFAULT_ROW_LIMIT;
  const enabled = opts.enabled !== false;
  const filters = opts.filters;
  const filtersKey = filters ? JSON.stringify(filters) : "";
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [fields, setFields] = useState<EntityField[]>([]);
  const [loading, setLoading] = useState<boolean>(!!dataSourceId && enabled);
  const [err, setErr] = useState("");
  const pageState = usePageState();
  const refreshTag = dataSourceId
    ? (pageState.get(`__refresh:ds:${dataSourceId}`) as number | undefined)
    : undefined;
  // biome-ignore lint/correctness/useExhaustiveDependencies: deps cố ý dùng filtersKey (chuỗi ổn định) thay cho object filters; refreshTag là tín hiệu reload thủ công
  useEffect(() => {
    if (!dataSourceId || !enabled) {
      setRows([]);
      setLoading(false);
      return;
    }
    let alive = true;
    setLoading(true);
    setErr("");
    Promise.all([
      api.getDataSourceRecords(dataSourceId, { limit, filters }),
      api.getDataSourceMeta(dataSourceId),
    ])
      .then(([res, meta]) => {
        if (!alive) return;
        setRows(res.rows as Record<string, unknown>[]);
        setFields(
          meta.fields.map((f) => ({ id: f.key, name: f.key, label: f.label, type: f.type })),
        );
        setLoading(false);
      })
      .catch((e) => {
        if (alive) {
          setErr((e as Error).message);
          setLoading(false);
        }
      });
    return () => {
      alive = false;
    };
  }, [dataSourceId, refreshTag, limit, enabled, filtersKey]);
  return { rows, fields, loading, err };
}

export interface WidgetData {
  rows: Record<string, unknown>[];
  /** Field meta để render cột/label (entity fields HOẶC datasource flat fields). */
  fields: EntityField[];
  loading: boolean;
  err: string;
  /** true nếu widget bind tới nguồn dữ liệu (datasource) thay entity. */
  isDataSource: boolean;
  create: (data: Record<string, unknown>) => Promise<void>;
  update: (id: string, data: Record<string, unknown>) => Promise<void>;
  remove: (id: string) => Promise<void>;
}

/* ── Hook hợp nhất — widget bind ENTITY (cfg.entity) hoặc DATASOURCE
   (cfg.dataSourceId). Nhánh entity giữ NGUYÊN hành vi cũ (tương thích
   ngược); nhánh datasource đọc/ghi row phẳng đã join. */
function useWidgetData(cfg: Record<string, unknown>): WidgetData {
  const dataSourceId = (cfg.dataSourceId as string | undefined) || undefined;
  const entityId = dataSourceId ? undefined : (cfg.entity as string | undefined);
  const opts = useDataOpts(cfg);
  const ent = useEntity(entityId);
  const entRecs = useRecords(entityId, opts);
  const ds = useDataSourceRecords(dataSourceId, opts);

  if (dataSourceId) {
    return {
      rows: ds.rows,
      fields: ds.fields,
      loading: ds.loading,
      err: ds.err,
      isDataSource: true,
      create: (data) => api.createDataSourceRecord(dataSourceId, data).then(() => undefined),
      update: (id, data) =>
        api.updateDataSourceRecord(dataSourceId, id, data).then(() => undefined),
      remove: (id) => api.deleteDataSourceRecord(dataSourceId, id),
    };
  }
  return {
    rows: entRecs.rows,
    fields: ent?.fields ?? [],
    loading: entRecs.loading,
    err: entRecs.err,
    isDataSource: false,
    create: (data) =>
      entityId ? api.createRecord(entityId, data).then(() => undefined) : Promise.resolve(),
    update: (id, data) => api.updateRecord(id, data).then(() => undefined),
    remove: (id) => api.deleteRecord(id),
  };
}

/* ── Hook nhẹ — chỉ field meta + create (KHÔNG fetch rows). Cho FormWidget:
   form tạo mới không cần kéo toàn bộ row (join datasource có thể nặng). */
function useWidgetMeta(cfg: Record<string, unknown>): {
  isDataSource: boolean;
  fields: EntityField[];
  create: (data: Record<string, unknown>) => Promise<void>;
} {
  const dataSourceId = (cfg.dataSourceId as string | undefined) || undefined;
  const entityId = dataSourceId ? undefined : (cfg.entity as string | undefined);
  const ent = useEntity(entityId);
  const [dsFields, setDsFields] = useState<EntityField[]>([]);
  useEffect(() => {
    if (!dataSourceId) {
      setDsFields([]);
      return;
    }
    let alive = true;
    api
      .getDataSourceMeta(dataSourceId)
      .then((m) => {
        if (alive)
          setDsFields(
            m.fields.map((f) => ({ id: f.key, name: f.key, label: f.label, type: f.type })),
          );
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [dataSourceId]);
  return {
    isDataSource: !!dataSourceId,
    fields: dataSourceId ? dsFields : (ent?.fields ?? []),
    create: dataSourceId
      ? (data) => api.createDataSourceRecord(dataSourceId, data).then(() => undefined)
      : (data) =>
          entityId ? api.createRecord(entityId, data).then(() => undefined) : Promise.resolve(),
  };
}

// ─── EditableListWidget — bảng chỉnh sửa inline (không có công thức) ──────────

interface EditableListWidgetProps {
  ent: ReturnType<typeof useEntity>;
  title?: string;
  loading: boolean;
  err: string;
  filteredRows: Record<string, unknown>[];
  visibleFields: EntityField[];
  batchEdit: boolean;
  onSave: (rowId: unknown, changes: Record<string, unknown>) => Promise<void>;
  /** Chọn dòng (selectionStateKey) — click row set page-state, nút header
   *  (Xem chi tiết...) đọc theo. Double-click cell vẫn là sửa inline. */
  onRowClick?: (row: Record<string, unknown>) => void;
  isRowSelected?: (row: Record<string, unknown>) => boolean;
}

function EditableListWidget({
  ent,
  title,
  loading,
  err,
  filteredRows,
  visibleFields,
  batchEdit,
  onSave,
  onRowClick,
  isRowSelected,
}: EditableListWidgetProps) {
  const t = useT();
  // Field-level RBAC cho inline edit — role + nhóm của user hiện tại.
  const rbacRole = useRbac((s) => s.role);
  const myGroupIds = useUserObjects((s) => s.myGroupIds);
  type CellKey = `${number}:${string}`;
  const [editingCell, setEditingCell] = useState<CellKey | null>(null);
  const [cellVals, setCellVals] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<Map<string, Record<string, string>>>(new Map());
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState("");

  const getVal = (r: number, field: string): string => {
    const k: CellKey = `${r}:${field}`;
    if (cellVals[k] !== undefined) return cellVals[k];
    const v = filteredRows[r]?.[field];
    return v == null ? "" : String(v);
  };

  const commitCell = async (r: number, field: string, val: string) => {
    const k: CellKey = `${r}:${field}`;
    setCellVals((prev) => ({ ...prev, [k]: val }));
    const rowId = filteredRows[r]?.id;
    if (rowId == null) return;
    const rowIdStr = String(rowId);
    if (batchEdit) {
      setPending((prev) => {
        const next = new Map(prev);
        next.set(rowIdStr, { ...(next.get(rowIdStr) ?? {}), [field]: val });
        return next;
      });
    } else {
      await onSave(rowId, { [field]: val });
    }
    setEditingCell(null);
  };

  const saveAll = async () => {
    setSaving(true);
    setSaveErr("");
    try {
      for (const [rowId, changes] of pending) await onSave(rowId, changes);
      setPending(new Map());
    } catch (e) {
      setSaveErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="h-full flex flex-col">
      {loading && (
        <div className="text-xs px-2 py-1 border-b border-border text-muted flex items-center gap-1">
          <I.Table size={11} />
          {title ?? ent?.name ?? "List"}
          <span className="ml-auto">{t("widget.loading")}</span>
        </div>
      )}
      {batchEdit && pending.size > 0 && (
        <div className="flex items-center gap-2 px-3 py-1.5 bg-warning/10 border-b border-warning/30 shrink-0">
          <I.AlertCircle size={12} className="text-warning shrink-0" />
          <span className="text-xs text-warning flex-1">
            {t("widget.pending_records", { count: pending.size })}
          </span>
          {saveErr && <span className="text-xs text-danger">{saveErr}</span>}
          <button
            type="button"
            disabled={saving}
            onClick={saveAll}
            className="px-2.5 py-0.5 rounded text-xs bg-warning text-white hover:bg-warning/90 disabled:opacity-50"
          >
            {saving ? t("common.saving") : t("common.save_all")}
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => {
              setPending(new Map());
              setCellVals({});
            }}
            className="px-2.5 py-0.5 rounded text-xs border border-border hover:bg-hover"
          >
            {t("common.cancel")}
          </button>
        </div>
      )}
      {err ? (
        <div className="p-3 text-xs text-danger">{t("widget.error_load", { err })}</div>
      ) : (
        <div className="flex-1 min-h-0 overflow-auto">
          <table className="w-full text-xs border-collapse">
            <thead className="sticky top-0 z-10">
              <tr>
                {visibleFields.map((f) => (
                  <th
                    key={f.name}
                    className="border border-border bg-panel-2 px-2 py-1 text-left font-semibold text-[10px] whitespace-nowrap"
                  >
                    <span className="flex flex-col leading-tight">
                      <span>{f.label}</span>
                      <span className="font-mono text-[9px] font-normal text-muted/60">
                        {f.name}
                      </span>
                    </span>
                  </th>
                ))}
                <th className="border border-border bg-panel-2 w-8" />
              </tr>
            </thead>
            <tbody>
              {filteredRows.length === 0 && (
                <tr>
                  <td colSpan={visibleFields.length + 1} className="p-4 text-center text-muted">
                    {t("widget.empty_records")}
                  </td>
                </tr>
              )}
              {filteredRows.map((row, r) => {
                const rowId = row.id;
                const rowIdStr = rowId != null ? String(rowId) : "";
                const isDirty = pending.has(rowIdStr);
                const isSel = isRowSelected?.(row) === true;
                return (
                  <tr
                    key={rowIdStr || r}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                    className={cn(
                      onRowClick && "cursor-pointer",
                      isSel
                        ? "bg-accent/10 outline outline-1 -outline-offset-1 outline-accent/40"
                        : isDirty
                          ? "bg-warning/5"
                          : r % 2 === 0
                            ? ""
                            : "bg-bg-soft/40",
                    )}
                  >
                    {visibleFields.map((f) => {
                      const k: CellKey = `${r}:${f.name}`;
                      // Field-level RBAC: role + nhóm không có quyền ghi → ô
                      // read-only (server vẫn strip — đây là tầng UX báo sớm).
                      const canWrite = fieldCan(rbacRole, "write", f, myGroupIds);
                      const isEditing = canWrite && editingCell === k;
                      const val = getVal(r, f.name);
                      const changed =
                        cellVals[k] !== undefined && cellVals[k] !== String(row[f.name] ?? "");
                      return (
                        <td
                          key={f.name}
                          className={cn(
                            "border border-border/60 px-0 h-7",
                            canWrite ? "cursor-text" : "cursor-not-allowed opacity-60",
                            changed && "bg-warning/10",
                          )}
                          title={canWrite ? undefined : "Không có quyền sửa cột này"}
                          onDoubleClick={canWrite ? () => setEditingCell(k) : undefined}
                        >
                          {isEditing ? (
                            <input
                              type="text"
                              defaultValue={val}
                              className="w-full h-full px-1.5 bg-white dark:bg-bg outline outline-1 outline-accent text-xs"
                              // biome-ignore lint/a11y/noAutofocus: autofocus chủ ý để con trỏ vào ô vừa double-click chỉnh sửa
                              autoFocus
                              onBlur={(e) => commitCell(r, f.name, e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                                if (e.key === "Escape") setEditingCell(null);
                              }}
                            />
                          ) : (
                            <span className="block px-1.5 truncate leading-7">{val}</span>
                          )}
                        </td>
                      );
                    })}
                    <td className="border border-border/40 text-center w-8">
                      {isDirty && !batchEdit && (
                        <span title={t("widget.saved_title")} className="text-success text-[10px]">
                          <I.Check size={10} />
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** Widget "list" — bảng record thật, cột suy từ field của entity. */
function ListWidget({
  entityId,
  dataSourceId,
  stateKey,
  fields,
  selectionStateKey,
  filterFromState,
  filters,
  searchFromState,
  searchStateKey,
  title,
  multiSelect,
  editable,
  batchEdit,
  excelMode,
  rowLimit,
  pageSize,
  loadFilters,
  loadGate,
  emptyStateShowsAll,
}: {
  entityId?: string;
  stateKey?: string;
  fields?: string[];
  /** Phase V: khi click row, set page-state[selectionStateKey] = row.id. */
  selectionStateKey?: string;
  /** Legacy single-equality filter. Khi state rỗng → hide all rows
   *  (master-detail), TRỪ KHI emptyStateShowsAll=true (combobox lọc:
   *  "tất cả" = rỗng → hiện hết). */
  filterFromState?: { field: string; stateKey: string };
  /** V2: cây filter nâng cao. Ưu tiên hơn filterFromState. Pass-through khi
   *  state rỗng (page mới mở vẫn show full list). */
  filters?: FilterNode | null;
  /** Phase V: text search từ Search widget theo state key. */
  searchFromState?: string;
  /** V2 P5: stateKey để expose ô search nội bộ DataGrid ra pageState.
   *  Widget khác có thể đọc state key này (vd: filters.contains). */
  searchStateKey?: string;
  /** Phase V: tiêu đề widget hiển thị thay vì tên entity. */
  title?: string;
  /** Chọn nhiều dòng — lưu mảng id vào selectionStateKey thay vì id đơn. */
  multiSelect?: boolean;
  /** Cho phép sửa ô inline, lưu về datasource. */
  editable?: boolean;
  /** Tích lũy thay đổi, hiện nút "Lưu tất cả" thay vì auto-save. */
  batchEdit?: boolean;
  /** Chế độ bảng tính kiểu Excel với hỗ trợ công thức. */
  excelMode?: boolean;
  /** Số dòng tối đa tải (mặc định 500). */
  rowLimit?: number;
  /** Số dòng hiển thị mỗi trang (phân trang client-side; mặc định 50). */
  pageSize?: number;
  /** Điều kiện lọc server-side áp trước khi cắt limit. */
  loadFilters?: LoadFilters;
  /** stateKey cổng: chỉ tải khi state có giá trị. */
  loadGate?: string;
  /** Bind tới nguồn dữ liệu (datasource) thay entity. */
  dataSourceId?: string;
  /** Khi filterFromState rỗng → hiện TẤT CẢ thay vì ẩn hết. Dùng cho list
   *  bị lái bởi combobox/listbox lọc (mục "tất cả"). Mặc định false để giữ
   *  hành vi master-detail. */
  emptyStateShowsAll?: boolean;
}) {
  const t = useT();
  const ent = useEntity(entityId);
  const {
    rows,
    loading,
    err,
    fields: dataFields,
    isDataSource,
    update: dataUpdate,
  } = useWidgetData({ entity: entityId, dataSourceId, rowLimit, loadFilters, loadGate });
  const pageState = usePageState();

  if (!entityId && !dataSourceId) {
    return <div className="p-3 text-xs text-muted">{t("widget.no_entity_list")}</div>;
  }
  const allFields = isDataSource ? dataFields : (ent?.fields ?? []);

  // fields=[...] → dùng đúng list đó; không có config → lọc theo defaultVisible của field
  const visibleFields =
    fields && fields.length > 0
      ? allFields.filter((f) => fields.includes(f.name))
      : allFields.filter((f) => f.defaultVisible !== false);

  // V2: filters (cây) ưu tiên — pass-through default khi state rỗng.
  let filteredRows = rows;
  if (filters) {
    filteredRows = applyFilters(rows, filters, pageState);
  } else if (filterFromState) {
    // Legacy: hide all khi state rỗng (master-detail UX truyền thống).
    const stateVal = pageState.get(filterFromState.stateKey);
    if (
      stateVal !== undefined &&
      stateVal !== null &&
      stateVal !== "" &&
      !(Array.isArray(stateVal) && stateVal.length === 0)
    ) {
      filteredRows = rows.filter((r) => {
        const v = r[filterFromState.field];
        if (Array.isArray(stateVal)) {
          return (stateVal as string[]).includes(String(v));
        }
        return v === stateVal || String(v) === String(stateVal);
      });
    } else if (!emptyStateShowsAll && !Array.isArray(stateVal)) {
      // Rỗng + không bật emptyStateShowsAll → ẩn hết (master-detail).
      filteredRows = [];
    }
  }

  // Phase V: text search từ Search widget.
  if (searchFromState) {
    const q = ((pageState.get(searchFromState) as string) ?? "").toLowerCase().trim();
    if (q) {
      filteredRows = filteredRows.filter((row) =>
        visibleFields.some((f) =>
          String(row[f.name] ?? "")
            .toLowerCase()
            .includes(q),
        ),
      );
    }
  }

  // Phase V: row click → set state. Khi multiSelect=true, toggle id trong mảng.
  const selectedRaw = selectionStateKey ? pageState.get(selectionStateKey) : undefined;
  const selectedIds: unknown[] = Array.isArray(selectedRaw) ? selectedRaw : [];
  const selectedId = selectionStateKey && !multiSelect ? selectedRaw : undefined;

  const onRowClick = selectionStateKey
    ? (row: Record<string, unknown>) => {
        const id = row.id ?? row.ID ?? row._id;
        if (id == null) return;
        if (multiSelect) {
          const strId = String(id);
          const cur = Array.isArray(selectedRaw) ? (selectedRaw as unknown[]) : [];
          const already = cur.some((x) => String(x) === strId);
          pageState.set(
            selectionStateKey,
            already ? cur.filter((x) => String(x) !== strId) : [...cur, id],
          );
        } else {
          pageState.set(selectionStateKey, id);
        }
      }
    : undefined;

  const isRowSelected = selectionStateKey
    ? (row: Record<string, unknown>) => {
        const id = row.id ?? row.ID ?? row._id;
        if (id == null) return false;
        if (multiSelect) return selectedIds.some((x) => String(x) === String(id));
        return id === selectedId || String(id) === String(selectedId);
      }
    : undefined;

  const fieldColumns = visibleFields.map((f) => ({
    accessorKey: f.name,
    header: f.label,
    // Tên cột kỹ thuật hiện mono dưới nhãn ở header (DataGrid đọc meta.techName).
    meta: { techName: f.name },
    cell: (c: { getValue: () => unknown }) => applyFieldFormat(f, c.getValue()),
  }));

  const checkboxCol =
    multiSelect && selectionStateKey
      ? [
          {
            id: "__select__",
            header: () => null,
            size: 36,
            cell: ({ row }: { row: { original: Record<string, unknown> } }) => {
              const id = row.original.id ?? row.original.ID ?? row.original._id;
              const checked = id != null && selectedIds.some((x) => String(x) === String(id));
              return (
                <span
                  className={`w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 mx-auto ${checked ? "bg-accent border-accent" : "border-border"}`}
                >
                  {checked && <I.Check size={9} className="text-white" />}
                </span>
              );
            },
          },
        ]
      : [];

  const columns = [...checkboxCol, ...fieldColumns];

  // Hàm lưu 1 record (dùng cho editable và excelMode). Datasource → ghi qua
  // resolver (base field về record gốc), entity → records.update trực tiếp.
  const saveRecord = async (rowId: unknown, changes: Record<string, unknown>) => {
    if (isDataSource) await dataUpdate(String(rowId), changes);
    else await api.updateRecord(String(rowId), changes);
  };

  // ── Chế độ bảng tính Excel ──────────────────────────────────────────
  if (excelMode) {
    return (
      <div className="h-full flex flex-col">
        {loading && (
          <div className="text-xs px-2 py-1 border-b border-border text-muted flex items-center gap-1">
            <I.Table size={11} />
            {title ?? ent?.name ?? "List"}
            <span className="ml-auto">{t("widget.loading")}</span>
          </div>
        )}
        {err && <div className="p-3 text-xs text-danger">{t("widget.error_load", { err })}</div>}
        {!err && !loading && (
          <div className="flex-1 min-h-0">
            <ExcelGrid
              fields={visibleFields}
              rows={filteredRows}
              batchEdit={batchEdit}
              onSave={saveRecord}
              onRowClick={onRowClick}
              isRowSelected={isRowSelected}
            />
          </div>
        )}
      </div>
    );
  }

  // ── Chế độ chỉnh sửa inline ─────────────────────────────────────────
  if (editable) {
    return (
      <EditableListWidget
        ent={ent}
        title={title}
        loading={loading}
        err={err}
        filteredRows={filteredRows}
        visibleFields={visibleFields}
        batchEdit={!!batchEdit}
        onSave={saveRecord}
        onRowClick={onRowClick}
        isRowSelected={isRowSelected}
      />
    );
  }

  // ── Chế độ mặc định (read-only) ─────────────────────────────────────
  return (
    <div className="h-full flex flex-col">
      {loading && (
        <div className="text-xs px-2 py-1 border-b border-border text-muted flex items-center gap-1">
          <I.Table size={11} />
          {title ?? ent?.name ?? "List"}
          <span className="ml-auto">{t("widget.loading")}</span>
        </div>
      )}
      <div className="flex-1 min-h-0 overflow-auto">
        {err ? (
          <div className="p-3 text-xs text-danger">{t("widget.error_load", { err })}</div>
        ) : (
          <DataGrid
            toolbar={!loading}
            label={title ?? ent?.name ?? "List"}
            data={filteredRows}
            columns={columns}
            emptyText={filterFromState ? t("widget.select_master") : t("widget.empty_records")}
            stateKey={stateKey}
            onRowClick={onRowClick}
            isRowSelected={isRowSelected}
            globalFilter={
              searchStateKey ? ((pageState.get(searchStateKey) as string) ?? "") : undefined
            }
            onGlobalFilterChange={
              searchStateKey ? (v: string) => pageState.set(searchStateKey, v) : undefined
            }
            pageSize={pageSize}
          />
        )}
      </div>
    </div>
  );
}

/** Phase V — DetailWidget: render 1 record theo state.
 *  Khi cfg.editable=true → render dạng form chỉnh sửa, lưu bằng updateRecord.
 *  Khi false (mặc định) → read-only. */
function DetailWidget({ cfg, compId }: { cfg: Record<string, unknown>; compId?: string }) {
  const t = useT();
  const entityId = cfg.entity as string | undefined;
  const recordIdFromState = cfg.recordIdFromState as string | undefined;
  const title = cfg.title as string | undefined;
  const editable = cfg.editable === true;
  const forwardRefs =
    (cfg.forwardRefs as Array<{ field: string; refEntityId: string }> | undefined) ?? [];
  const ent = useEntity(entityId);
  const { rows, fields: wdFields, isDataSource, update: dataUpdate } = useWidgetData(cfg);
  const pageState = usePageState();

  // Form state cho chế độ chỉnh sửa
  const [form, setForm] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");
  const [saveErr, setSaveErr] = useState("");

  const recordId = recordIdFromState ? pageState.get(recordIdFromState) : undefined;
  const record = rows.find((r) => r.id === recordId || String(r.id) === String(recordId));

  const allFields = isDataSource ? wdFields : (ent?.fields ?? []);
  const selectedFieldNames = (cfg.fields as string[] | undefined) ?? [];
  const allScalar = allFields.filter((f) => f.type !== "collection");
  const scalarFields =
    selectedFieldNames.length > 0
      ? allScalar.filter((f) => selectedFieldNames.includes(f.name))
      : allScalar;
  const collectionFields =
    selectedFieldNames.length > 0
      ? allFields.filter((f) => f.type === "collection" && selectedFieldNames.includes(f.name))
      : allFields.filter((f) => f.type === "collection");

  // V2 P5: mirror từng field ra pageState để widget khác filter theo.
  // biome-ignore lint/correctness/useExhaustiveDependencies: compId + record identity đủ
  useEffect(() => {
    if (!compId || !ent || !record) return;
    for (const f of allFields) {
      pageState.set(`detail:${compId}:${f.name}`, record[f.name]);
    }
  }, [compId, record?.id, ent?.id]);

  // Pre-fill form khi record thay đổi (editable mode)
  // biome-ignore lint/correctness/useExhaustiveDependencies: record.id + editable đủ để reset
  useEffect(() => {
    if (!editable) return;
    if (!record) {
      setForm({});
      return;
    }
    const filled: Record<string, string> = {};
    for (const f of scalarFields) {
      const v = record[f.name];
      filled[f.name] = v == null ? "" : String(v);
    }
    setForm(filled);
    setSaveMsg("");
    setSaveErr("");
  }, [record?.id, editable]);

  if (!entityId || !ent) {
    return <div className="p-3 text-xs text-muted">{t("widget.no_entity_detail")}</div>;
  }
  if (recordId == null || recordId === "") {
    return (
      <div className="p-4 text-xs text-muted h-full flex items-center justify-center text-center">
        <div>
          <I.Layout size={20} className="mx-auto mb-2 opacity-50" />
          Chọn 1 dòng ở danh sách để xem chi tiết.
        </div>
      </div>
    );
  }
  if (!record) {
    return (
      <div className="p-3 text-xs text-muted">Không tìm thấy bản ghi (id={String(recordId)}).</div>
    );
  }

  const fwdSet = new Set(forwardRefs.map((r) => r.field));

  const save = async () => {
    setBusy(true);
    setSaveErr("");
    setSaveMsg("");
    try {
      const data: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(form)) if (v !== "") data[k] = v;
      if (isDataSource) await dataUpdate(String(record.id), data);
      else await api.updateRecord(String(record.id), data);
      setSaveMsg(t("widget.saved_ok"));
    } catch (e) {
      setSaveErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const CollectionPart = () => (
    <>
      {collectionFields.map((f) => {
        const childEntityId = f.ref;
        const fkField = f.fkField;
        const parentId = record.id as string | undefined;
        if (!childEntityId || !fkField || !parentId) {
          return (
            <div
              key={f.name}
              className="p-2 rounded border border-warning/40 bg-warning/5 text-xs text-warning"
            >
              Collection "{f.label}" thiếu cấu hình (ref / fkField / parent id).
            </div>
          );
        }
        return (
          <CollectionSection
            key={f.name}
            label={f.label}
            parentId={parentId}
            childEntityId={childEntityId}
            fkField={fkField}
          />
        );
      })}
    </>
  );

  // ── Chế độ chỉnh sửa ────────────────────────────────────────────────────
  if (editable) {
    return (
      <div className="p-3 h-full overflow-auto space-y-2">
        {title && (
          <div className="text-sm font-semibold pb-1.5 border-b border-border">{title}</div>
        )}
        <div className="space-y-2">
          {scalarFields.length === 0 && (
            <div className="text-xs text-muted">{t("widget.no_fields")}</div>
          )}
          {scalarFields.map((f) => (
            <div key={f.name}>
              <label className="text-xs text-muted">
                {f.label}
                {f.required ? " *" : ""}
              </label>
              {f.type === "select" && f.options?.length ? (
                <SearchableSelect
                  className="w-full"
                  value={form[f.name] ?? ""}
                  onChange={(v) => setForm({ ...form, [f.name]: v })}
                  options={f.options.map((o) => ({ value: o, label: o }))}
                  emptyOption="— chọn —"
                />
              ) : (
                <input
                  className="input w-full"
                  type={
                    f.type === "number" || f.type === "currency"
                      ? "number"
                      : f.type === "date"
                        ? "date"
                        : f.type === "email"
                          ? "email"
                          : "text"
                  }
                  value={form[f.name] ?? ""}
                  onChange={(e) => setForm({ ...form, [f.name]: e.target.value })}
                />
              )}
            </div>
          ))}
        </div>
        <div className="flex items-center gap-2 pt-1">
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={busy}
            onClick={() => void save()}
          >
            {busy ? t("common.saving") : t("widget.save_changes")}
          </button>
          {saveMsg && <span className="text-xs text-success">{saveMsg}</span>}
          {saveErr && <span className="text-xs text-danger">{saveErr}</span>}
        </div>
        <CollectionPart />
      </div>
    );
  }

  // ── Chế độ chỉ đọc (mặc định) ───────────────────────────────────────────
  return (
    <div className="p-3 h-full overflow-auto space-y-4">
      {title && (
        <div className="text-sm font-semibold mb-2 pb-1.5 border-b border-border">{title}</div>
      )}
      <dl className="grid grid-cols-[140px_1fr] gap-x-3 gap-y-1.5 text-xs">
        {scalarFields.map((f) => {
          const v = record[f.name];
          const isForward = fwdSet.has(f.name);
          return (
            <div key={f.name} className="contents">
              <dt className="text-muted truncate" title={f.label}>
                {f.label}
                {isForward && (
                  <Chip variant="accent" className="ml-1 text-[8px]!">
                    →
                  </Chip>
                )}
              </dt>
              <dd className="font-mono break-all">{applyFieldFormat(f, v)}</dd>
            </div>
          );
        })}
      </dl>
      <CollectionPart />
    </div>
  );
}

/** Phase V — CollectionSection: render danh sách record entity con (1-N)
 *  + CRUD inline (add / delete). Auto-filter theo fkField === parent.id. */
function CollectionSection({
  label,
  parentId,
  childEntityId,
  fkField,
}: {
  label: string;
  parentId: string;
  childEntityId: string;
  fkField: string;
}) {
  const childEnt = useEntity(childEntityId);
  const [rows, setRows] = useState<Array<{ id: string; data: Record<string, unknown> }>>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [adding, setAdding] = useState(false);
  const [newRow, setNewRow] = useState<Record<string, unknown>>({});
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reloadKey cố ý nằm trong deps để buộc reload thủ công sau khi thêm/sửa/xóa dòng con
  useEffect(() => {
    if (!childEntityId) return;
    let alive = true;
    setLoading(true);
    setErr("");
    api
      // Lọc khóa ngoại NGAY tại DB (trước limit) thay vì kéo 500 dòng rồi lọc
      // client — đúng khi entity con có >500 dòng tổng.
      .getRecords(childEntityId, {
        limit: DEFAULT_ROW_LIMIT,
        filters: { [fkField]: { op: "=", value: parentId } },
      })
      .then((res) => {
        if (!alive) return;
        // Lọc lại client-side phòng hờ (server đã lọc đúng fkField).
        const filtered = res.rows.filter((r) => {
          const v = (r.data as Record<string, unknown>)[fkField];
          return v === parentId || String(v) === String(parentId);
        });
        setRows(filtered.map((r) => ({ id: r.id, data: r.data as Record<string, unknown> })));
        setLoading(false);
      })
      .catch((e) => {
        if (!alive) return;
        setErr((e as Error).message);
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [childEntityId, fkField, parentId, reloadKey]);

  if (!childEnt) {
    return (
      <div className="p-2 rounded border border-warning/40 bg-warning/5 text-xs text-warning">
        Collection "{label}" — không tìm thấy entity con (id={childEntityId}).
      </div>
    );
  }
  const childFields = (childEnt.fields ?? []).filter((f) => f.name !== fkField);
  const displayFields = childFields.slice(0, 5);

  const startAdd = () => {
    setAdding(true);
    setNewRow({});
  };
  const cancelAdd = () => {
    setAdding(false);
    setNewRow({});
  };
  const saveAdd = async () => {
    setSaving(true);
    setErr("");
    try {
      const data: Record<string, unknown> = { ...newRow, [fkField]: parentId };
      await api.createRecord(childEntityId, data);
      cancelAdd();
      setReloadKey((k) => k + 1);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  };
  const removeRow = async (id: string) => {
    setDeletingId(id);
    setErr("");
    try {
      await api.deleteRecord(id);
      setReloadKey((k) => k + 1);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="border border-border rounded">
      <div className="px-3 py-1.5 border-b border-border bg-surface/40 flex items-center justify-between">
        <div className="text-xs font-semibold flex items-center gap-1.5">
          <I.Database size={11} className="text-accent" />
          {label}
          <Chip variant="default" className="text-[9px]!">
            {rows.length}
          </Chip>
        </div>
        {!adding && (
          <button
            type="button"
            onClick={startAdd}
            className="text-[11px] text-accent hover:underline flex items-center gap-1"
          >
            <I.Plus size={11} /> Thêm
          </button>
        )}
      </div>
      {err && <div className="px-3 py-1 text-[10px] text-danger">{err}</div>}
      <div className="overflow-x-auto">
        <table className="w-full text-[11px]">
          <thead className="bg-surface text-muted">
            <tr>
              {displayFields.map((f) => (
                <th key={f.name} className="text-left px-2 py-1 font-medium">
                  <span className="flex flex-col leading-tight">
                    <span>{f.label}</span>
                    <span className="font-mono text-[9px] font-normal text-muted/60">{f.name}</span>
                  </span>
                </th>
              ))}
              <th className="w-12 px-2" />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td
                  colSpan={displayFields.length + 1}
                  className="px-2 py-3 text-center text-muted text-[10px]"
                >
                  Đang tải...
                </td>
              </tr>
            ) : rows.length === 0 && !adding ? (
              <tr>
                <td
                  colSpan={displayFields.length + 1}
                  className="px-2 py-3 text-center text-muted text-[10px]"
                >
                  Chưa có record con.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id} className="border-t border-border">
                  {displayFields.map((f) => (
                    <td key={f.name} className="px-2 py-1 truncate max-w-[200px]">
                      {applyFieldFormat(f, r.data[f.name])}
                    </td>
                  ))}
                  <td className="px-2 py-1 text-right">
                    <button
                      type="button"
                      onClick={() => removeRow(r.id)}
                      disabled={deletingId === r.id}
                      className="text-muted hover:text-danger"
                      title="Xoá record con"
                    >
                      <I.X size={11} />
                    </button>
                  </td>
                </tr>
              ))
            )}
            {adding && (
              <tr className="border-t border-accent/40 bg-accent/5">
                {displayFields.map((f) => (
                  <td key={f.name} className="px-1 py-0.5">
                    <input
                      type="text"
                      value={(newRow[f.name] as string) ?? ""}
                      onChange={(e) => setNewRow((r) => ({ ...r, [f.name]: e.target.value }))}
                      placeholder={f.label}
                      className="w-full h-6 px-1 border border-border rounded bg-bg text-[10px]"
                    />
                  </td>
                ))}
                <td className="px-1 py-0.5">
                  <div className="flex gap-0.5">
                    <button
                      type="button"
                      onClick={saveAdd}
                      disabled={saving}
                      className="text-success hover:bg-success/20 rounded px-1"
                      title="Lưu"
                    >
                      <I.Check size={11} />
                    </button>
                    <button
                      type="button"
                      onClick={cancelAdd}
                      disabled={saving}
                      className="text-muted hover:bg-hover/40 rounded px-1"
                      title="Huỷ"
                    >
                      <I.X size={11} />
                    </button>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Widget "chart" — gom nhóm record thật theo `groupBy`, tổng hợp
   `valueField` (nếu trống → đếm số bản ghi).
   filterFromState: lọc rows trước khi gom nhóm theo master selection. */
function ChartWidget({ cfg }: { cfg: Record<string, unknown> }) {
  const t = useT();
  const entityId = cfg.entity as string | undefined;
  const groupBy = (cfg.groupBy as string) || "";
  const valueField =
    (cfg.valueField as string) || (cfg.field as string) || (cfg.metric as string) || "";
  const kind = ((cfg.kind as string) || "bar") as ChartKind;
  const filterFromState = cfg.filterFromState as { field: string; stateKey: string } | undefined;
  const filters = cfg.filters as FilterNode | null | undefined;
  const pageState = usePageState();
  // Chỉ truy vấn khi đã cấu hình field nhóm (entity/datasource từ cfg).
  const { rows: allRows, loading, err } = useWidgetData(groupBy ? cfg : {});

  if (!entityId || !groupBy) {
    return (
      <div className="p-3 text-xs text-muted">
        Chart chưa cấu hình — chọn entity + field nhóm ở trình thiết kế.
      </div>
    );
  }
  if (loading) return <div className="p-3 text-xs text-muted">{t("widget.loading")}</div>;
  if (err) return <div className="p-3 text-xs text-danger">{t("widget.error", { err })}</div>;

  let rows = allRows;
  if (filters) {
    rows = applyFilters(allRows, filters, pageState);
  } else if (filterFromState) {
    const sv = pageState.get(filterFromState.stateKey);
    if (sv !== undefined && sv !== null && sv !== "") {
      rows = allRows.filter((r) => {
        const v = r[filterFromState.field];
        return v === sv || String(v) === String(sv);
      });
    } else {
      rows = [];
    }
  }

  const agg = new Map<string, number>();
  for (const r of rows) {
    const key = String(r[groupBy] ?? "(trống)");
    const inc = valueField ? Number(r[valueField]) || 0 : 1;
    agg.set(key, (agg.get(key) ?? 0) + inc);
  }
  const data = [...agg.entries()].map(([k, v]) => ({ k, v }));

  return (
    <div className="p-2 h-full flex flex-col">
      {cfg.title ? (
        <div className="text-xs font-medium mb-1 truncate">{String(cfg.title)}</div>
      ) : null}
      <div className="flex-1 min-h-0">
        {data.length === 0 ? (
          <div className="text-xs text-muted p-2">{t("widget.empty_chart")}</div>
        ) : (
          <Chart kind={kind} data={data} labelKey="k" valueKeys={["v"]} />
        )}
      </div>
    </div>
  );
}

/** Widget "form" — sinh form từ field của entity, lưu record thật. */
function FormWidget({ cfg, compId }: { cfg: Record<string, unknown>; compId?: string }) {
  const t = useT();
  const entityId = cfg.entity as string | undefined;
  const ent = useEntity(entityId);
  const { fields: wdFields, isDataSource, create: wdCreate } = useWidgetMeta(cfg);
  const [form, setForm] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const linkedToState = cfg.linkedToState as { field: string; stateKey: string } | undefined;
  const emitLive = cfg.emitLiveFields === true;
  const pageState = usePageState();

  // V2 P5: debounced emit Form fields → pageState[`form:<id>:<f>`]
  // để widget khác có thể filter realtime theo input. Debounce 200ms tránh
  // spam setState mỗi keystroke.
  // biome-ignore lint/correctness/useExhaustiveDependencies: emit deps là form+compId+emitLive
  useEffect(() => {
    if (!emitLive || !compId) return;
    const t = setTimeout(() => {
      for (const [k, v] of Object.entries(form)) {
        pageState.set(`form:${compId}:${k}`, v);
      }
    }, 200);
    return () => clearTimeout(t);
  }, [form, compId, emitLive]);

  if (!isDataSource && (!entityId || !ent)) {
    return <div className="p-3 text-xs text-muted">{t("widget.no_entity_form")}</div>;
  }
  const masterVal = linkedToState ? pageState.get(linkedToState.stateKey) : undefined;
  const hasMaster =
    !linkedToState || (masterVal !== undefined && masterVal !== null && masterVal !== "");
  const selectedFieldNames = (cfg.fields as string[] | undefined) ?? [];
  const sourceFields = isDataSource ? wdFields : (ent?.fields ?? []);
  const allFields =
    selectedFieldNames.length > 0
      ? sourceFields.filter((f) => selectedFieldNames.includes(f.name))
      : sourceFields;
  const fields = linkedToState?.field
    ? allFields.filter((f) => f.name !== linkedToState.field)
    : allFields;

  const submit = async () => {
    setBusy(true);
    setErr("");
    setMsg("");
    try {
      // Bỏ field rỗng — server validate-on-write tự ép kiểu phần còn lại.
      const data: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(form)) if (v !== "") data[k] = v;
      if (linkedToState && masterVal != null && masterVal !== "") {
        data[linkedToState.field] = masterVal;
      }
      await wdCreate(data);
      setForm({});
      setMsg(t("widget.saved_record"));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="p-3 h-full overflow-auto">
      {cfg.title ? <div className="text-sm font-medium mb-2">{String(cfg.title)}</div> : null}
      {!hasMaster ? (
        <div className="p-4 text-xs text-muted flex flex-col items-center justify-center h-[calc(100%-2rem)] text-center gap-2">
          <I.Link size={18} className="opacity-40" />
          Chọn 1 dòng ở danh sách để thêm bản ghi liên quan.
        </div>
      ) : (
        <div className="space-y-2">
          {fields.length === 0 && <div className="text-xs text-muted">{t("widget.no_fields")}</div>}
          {fields.map((f) => (
            <div key={f.id}>
              <label className="text-xs text-muted">
                {f.label}
                {f.required ? " *" : ""}
              </label>
              {(f.type === "lookup" || f.type === "multi-lookup") && f.ref ? (
                <LookupPicker
                  refEntityId={f.ref}
                  value={form[f.name] ?? ""}
                  onChange={(v) => setForm({ ...form, [f.name]: v })}
                  multi={f.type === "multi-lookup"}
                />
              ) : f.type === "select" && f.options?.length ? (
                <SearchableSelect
                  className="w-full"
                  value={form[f.name] ?? ""}
                  onChange={(v) => setForm({ ...form, [f.name]: v })}
                  options={f.options.map((o) => ({ value: o, label: o }))}
                  emptyOption="— chọn —"
                />
              ) : f.type === "boolean" ? (
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    className="accent-accent"
                    checked={form[f.name] === "true"}
                    onChange={(e) =>
                      setForm({ ...form, [f.name]: e.target.checked ? "true" : "false" })
                    }
                  />
                  {f.label}
                </label>
              ) : (
                <input
                  className="input w-full"
                  type={
                    f.type === "number" || f.type === "currency" || f.type === "integer"
                      ? "number"
                      : f.type === "date"
                        ? "date"
                        : f.type === "datetime"
                          ? "datetime-local"
                          : f.type === "email"
                            ? "email"
                            : "text"
                  }
                  value={form[f.name] ?? ""}
                  onChange={(e) => setForm({ ...form, [f.name]: e.target.value })}
                />
              )}
            </div>
          ))}
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={busy || fields.length === 0}
            onClick={() => void submit()}
          >
            {busy ? t("common.saving") : t("widget.save_record")}
          </button>
          {msg && <div className="text-xs text-success">{msg}</div>}
          {err && <div className="text-xs text-danger">{err}</div>}
        </div>
      )}
    </div>
  );
}

/** Widget "kanban" — gom record thật thành cột theo field `groupBy`.
 *  filterFromState: lọc records theo master selection trước khi gom cột. */
function KanbanWidget({ cfg }: { cfg: Record<string, unknown> }) {
  const t = useT();
  const entityId = cfg.entity as string | undefined;
  const groupBy = (cfg.groupBy as string) || "status";
  const filterFromState = cfg.filterFromState as { field: string; stateKey: string } | undefined;
  const filters = cfg.filters as FilterNode | null | undefined;
  const ent = useEntity(entityId);
  const { rows: allRows, loading, err } = useWidgetData(cfg);
  const pageState = usePageState();

  if (!entityId || !ent) {
    return <div className="p-3 text-xs text-muted">{t("widget.no_entity_kanban")}</div>;
  }
  if (loading) return <div className="p-3 text-xs text-muted">{t("widget.loading")}</div>;
  if (err) return <div className="p-3 text-xs text-danger">{t("widget.error", { err })}</div>;

  let rows = allRows;
  if (filters) {
    rows = applyFilters(allRows, filters, pageState);
  } else if (filterFromState) {
    const sv = pageState.get(filterFromState.stateKey);
    if (sv !== undefined && sv !== null && sv !== "") {
      rows = allRows.filter((r) => {
        const v = r[filterFromState.field];
        return v === sv || String(v) === String(sv);
      });
    } else {
      rows = [];
    }
  }

  // Tiêu đề thẻ = field đầu tiên khác field nhóm.
  const titleField = ent.fields.find((f) => f.name !== groupBy)?.name ?? groupBy;
  const groups = new Map<string, Record<string, unknown>[]>();
  for (const r of rows) {
    const key = String(r[groupBy] ?? "(trống)");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)?.push(r);
  }

  return (
    <div className="h-full flex flex-col">
      <div className="text-xs px-2 py-1 border-b border-border text-muted flex items-center gap-1">
        <I.Kanban size={11} /> {ent.name} · nhóm theo "{groupBy}"
      </div>
      <div className="flex-1 min-h-0 overflow-auto flex gap-2 p-2">
        {groups.size === 0 && (
          <div className="text-xs text-muted p-2">{t("widget.empty_records")}</div>
        )}
        {[...groups.entries()].map(([col, items]) => (
          <div key={col} className="w-[180px] shrink-0 bg-bg-soft rounded-md border border-border">
            <div className="text-xs font-medium px-2 py-1 border-b border-border flex justify-between">
              <span className="truncate">{col}</span>
              <span className="text-muted">{items.length}</span>
            </div>
            <div className="p-1.5 space-y-1.5">
              {items.slice(0, 30).map((it, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: list ổn định, không reorder
                <div key={i} className="card p-2 text-xs">
                  {String(it[titleField] ?? "(không tên)")}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Widget "step" — wizard nhập dữ liệu theo nhiều bước tuần tự.
 *  Mỗi bước gắn 1 entity, submit tạo bản ghi và chuyển bước tiếp. */
function StepWidget({ cfg }: { cfg: Record<string, unknown> }) {
  interface StepDef {
    id: string;
    title: string;
    description?: string;
    entity?: string;
    fields?: string[];
    saveOutputTo?: string;
    actions?: Array<{ id: string } & ActionConfig>;
  }

  const entities = useUserObjects((s) => s.entities);
  const pageState = usePageState();
  const steps = (cfg.steps as StepDef[] | undefined) ?? [];
  const [activeIdx, setActiveIdx] = useState(0);
  const [forms, setForms] = useState<Record<string, Record<string, string>>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState(false);

  if (steps.length === 0) {
    return (
      <div className="p-3 text-xs text-muted h-full flex items-center justify-center">
        Wizard chưa cấu hình bước nào. Mở inspector &rarr; tab "Bước" để thêm.
      </div>
    );
  }

  const step = steps[Math.min(activeIdx, steps.length - 1)];
  if (!step) return null;
  const ent = step.entity ? entities.find((e) => e.id === step.entity) : undefined;
  const visibleFields = step.fields?.length
    ? (ent?.fields ?? []).filter((f) => step.fields!.includes(f.name))
    : (ent?.fields ?? []);
  const form = forms[step.id] ?? {};
  const setField = (k: string, v: string) =>
    setForms((prev) => ({ ...prev, [step.id]: { ...form, [k]: v } }));
  const isLast = activeIdx === steps.length - 1;

  const goNext = async () => {
    setBusy(true);
    setErr("");
    try {
      if (step.entity) {
        const data: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(form)) if (v !== "") data[k] = v;
        const result = await api.createRecord(step.entity, data);
        if (step.saveOutputTo) pageState.set(step.saveOutputTo, result.id);
      }
      if (isLast) {
        setDone(true);
      } else {
        setActiveIdx((i) => i + 1);
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <div className="p-6 flex flex-col items-center justify-center h-full gap-3 text-center">
        <div className="w-12 h-12 rounded-full bg-success/15 flex items-center justify-center">
          <I.Check size={22} className="text-success" />
        </div>
        <div className="text-sm font-semibold">Hoàn tất!</div>
        <button
          type="button"
          className="btn btn-sm btn-default"
          onClick={() => {
            setDone(false);
            setActiveIdx(0);
            setForms({});
            setErr("");
          }}
        >
          Làm lại từ đầu
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Step indicator */}
      <div className="shrink-0 flex items-center gap-0 px-4 py-3 border-b border-border bg-panel overflow-x-auto">
        {steps.map((s, i) => (
          <div key={s.id} className="flex items-center shrink-0">
            <div
              className={cn(
                "w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-semibold shrink-0",
                i < activeIdx
                  ? "bg-success text-white"
                  : i === activeIdx
                    ? "bg-accent text-white"
                    : "bg-border text-muted",
              )}
            >
              {i < activeIdx ? <I.Check size={10} /> : i + 1}
            </div>
            <span
              className={cn(
                "ml-1.5 mr-1 text-xs whitespace-nowrap",
                i === activeIdx ? "font-semibold text-fg" : "text-muted",
              )}
            >
              {s.title || `Bước ${i + 1}`}
            </span>
            {i < steps.length - 1 && <div className="mx-2 h-px w-5 bg-border shrink-0" />}
          </div>
        ))}
      </div>

      {/* Step content */}
      <div className="flex-1 overflow-auto p-4 space-y-3">
        {cfg.title ? <div className="text-sm font-semibold">{String(cfg.title)}</div> : null}
        {step.description ? <div className="text-xs text-muted">{step.description}</div> : null}
        {ent ? (
          visibleFields.length > 0 ? (
            <div className="space-y-2">
              {visibleFields.map((f) => (
                <div key={f.id}>
                  <label className="text-xs text-muted">
                    {f.label}
                    {f.required ? " *" : ""}
                  </label>
                  {(f.type === "lookup" || f.type === "multi-lookup") && f.ref ? (
                    <LookupPicker
                      refEntityId={f.ref}
                      value={form[f.name] ?? ""}
                      onChange={(v) => setField(f.name, v)}
                      multi={f.type === "multi-lookup"}
                    />
                  ) : f.type === "select" && f.options?.length ? (
                    <SearchableSelect
                      className="w-full"
                      value={form[f.name] ?? ""}
                      onChange={(v) => setField(f.name, v)}
                      options={f.options.map((o) => ({ value: o, label: o }))}
                      emptyOption="— chọn —"
                    />
                  ) : f.type === "boolean" ? (
                    <label className="flex items-center gap-2 text-sm cursor-pointer">
                      <input
                        type="checkbox"
                        className="accent-accent"
                        checked={form[f.name] === "true"}
                        onChange={(e) => setField(f.name, e.target.checked ? "true" : "false")}
                      />
                      {f.label}
                    </label>
                  ) : (
                    <input
                      className="input w-full"
                      type={
                        f.type === "number" || f.type === "currency" || f.type === "integer"
                          ? "number"
                          : f.type === "date"
                            ? "date"
                            : f.type === "datetime"
                              ? "datetime-local"
                              : f.type === "email"
                                ? "email"
                                : "text"
                      }
                      value={form[f.name] ?? ""}
                      onChange={(e) => setField(f.name, e.target.value)}
                    />
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="text-xs text-muted italic">Entity chưa có trường nào.</div>
          )
        ) : (
          <div className="text-xs text-muted italic">
            Bước này không gắn entity — chỉ giới thiệu thông tin.
          </div>
        )}
        {err && <div className="text-xs text-danger">{err}</div>}
      </div>

      {/* Hành động của bước */}
      {(step.actions?.length ?? 0) > 0 && (
        <div className="shrink-0 px-4 py-2 border-t border-border/50 flex flex-wrap gap-2 bg-panel">
          {step.actions!.map((a) => (
            <ActionWidget key={a.id} config={a} pageState={pageState} inline />
          ))}
        </div>
      )}

      {/* Navigation */}
      <div className="shrink-0 px-4 py-3 border-t border-border flex items-center justify-between bg-panel">
        <button
          type="button"
          className="btn btn-sm btn-default"
          disabled={activeIdx === 0}
          onClick={() => {
            setErr("");
            setActiveIdx((i) => i - 1);
          }}
        >
          Quay lại
        </button>
        <span className="text-xs text-muted">
          {activeIdx + 1} / {steps.length}
        </span>
        <button
          type="button"
          className="btn btn-sm btn-primary"
          disabled={busy}
          onClick={() => void goNext()}
        >
          {busy
            ? "Đang lưu..."
            : isLast
              ? (cfg.submitLabel as string | undefined) || "Hoàn tất"
              : "Tiếp theo"}
        </button>
      </div>
    </div>
  );
}

/** Widget "calendar" — render record theo dateField, group by ngày. */
function CalendarWidget({ cfg }: { cfg: Record<string, unknown> }) {
  const t = useT();
  const entityId = cfg.entity as string | undefined;
  const dateField = (cfg.dateField as string) || "date";
  const titleField = (cfg.titleField as string) || "name";
  const filters = cfg.filters as FilterNode | null | undefined;
  const ent = useEntity(entityId);
  const { rows: allRows, loading, err } = useWidgetData(cfg);
  const pageState = usePageState();

  if (!entityId || !ent)
    return <div className="p-3 text-xs text-muted">{t("widget.no_entity_calendar")}</div>;
  if (loading) return <div className="p-3 text-xs text-muted">{t("widget.loading")}</div>;
  if (err) return <div className="p-3 text-xs text-danger">{t("widget.error", { err })}</div>;

  const rows = filters ? applyFilters(allRows, filters, pageState) : allRows;
  const byDate = new Map<string, Record<string, unknown>[]>();
  for (const r of rows) {
    const raw = r[dateField];
    if (!raw) continue;
    const d = new Date(String(raw));
    if (Number.isNaN(d.getTime())) continue;
    const key = d.toISOString().slice(0, 10);
    if (!byDate.has(key)) byDate.set(key, []);
    byDate.get(key)?.push(r);
  }
  const sorted = [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b)).slice(0, 30);

  return (
    <div className="h-full flex flex-col">
      <div className="text-xs px-2 py-1 border-b border-border text-muted flex items-center gap-1">
        <I.Calendar size={11} /> {ent.name} · theo "{dateField}"
      </div>
      <div className="flex-1 min-h-0 overflow-auto p-2 space-y-1.5">
        {sorted.length === 0 && (
          <div className="text-xs text-muted">{t("widget.empty_calendar")}</div>
        )}
        {sorted.map(([date, items]) => (
          <div key={date} className="border border-border rounded-md">
            <div className="text-xs font-medium px-2 py-1 bg-bg-soft border-b border-border flex justify-between">
              <span>
                {new Date(date).toLocaleDateString("vi-VN", {
                  weekday: "short",
                  day: "2-digit",
                  month: "2-digit",
                })}
              </span>
              <span className="text-muted">{items.length}</span>
            </div>
            <div className="p-1.5 space-y-1">
              {items.slice(0, 5).map((it, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: list ổn định, không reorder
                <div key={i} className="text-xs truncate">
                  {String(it[titleField] ?? "(không tên)")}
                </div>
              ))}
              {items.length > 5 && (
                <div className="text-[10px] text-muted">+{items.length - 5} nữa</div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Widget "map" — hiển thị record có field geo {lat, lng}. Dùng Leaflet
 *  + OpenStreetMap tiles (free, không cần API key). Field shape:
 *  geo: { lat: number, lng: number }. */
function MapWidget({ cfg }: { cfg: Record<string, unknown> }) {
  const t = useT();
  const entityId = cfg.entity as string | undefined;
  const geoField = (cfg.geoField as string) || "location";
  const titleField = (cfg.titleField as string) || "name";
  const filters = cfg.filters as FilterNode | null | undefined;
  const ent = useEntity(entityId);
  const { rows: allRows, loading, err } = useWidgetData(cfg);
  const pageState = usePageState();

  if (!entityId || !ent)
    return <div className="p-3 text-xs text-muted">{t("widget.no_entity_map")}</div>;
  if (loading) return <div className="p-3 text-xs text-muted">{t("widget.loading")}</div>;
  if (err) return <div className="p-3 text-xs text-danger">{t("widget.error", { err })}</div>;

  const rows = filters ? applyFilters(allRows, filters, pageState) : allRows;
  const points = rows.flatMap((r) => {
    const g = r[geoField];
    if (g && typeof g === "object" && "lat" in g && "lng" in g) {
      return [
        {
          lat: (g as { lat: number }).lat,
          lng: (g as { lng: number }).lng,
          title: String(r[titleField] ?? ""),
        },
      ];
    }
    return [];
  });

  return (
    <div className="h-full flex flex-col">
      <div className="text-xs px-2 py-1 border-b border-border text-muted flex items-center gap-1">
        <I.MapPin size={11} /> {ent.name} · {points.length} điểm
      </div>
      <div className="flex-1 min-h-0">
        {points.length === 0 ? (
          <div className="p-3 text-xs text-muted">
            Chưa có record có geo. Field "{geoField}" cần shape {"{lat, lng}"}.
          </div>
        ) : (
          <LeafletMap points={points} />
        )}
      </div>
    </div>
  );
}

/** Map render qua Leaflet — lazy load để tránh SSR-style issue + giảm
 *  bundle initial. Tile mặc định OpenStreetMap (public, attribution required). */
function LeafletMap({ points }: { points: Array<{ lat: number; lng: number; title: string }> }) {
  // Default center = trung tâm trung bình các điểm; fallback HCMC.
  const center: [number, number] =
    points.length > 0
      ? [
          points.reduce((s, p) => s + p.lat, 0) / points.length,
          points.reduce((s, p) => s + p.lng, 0) / points.length,
        ]
      : [10.776, 106.7];
  // react-leaflet 5 expects "MapContainer" wrapping.
  return (
    <MapContainer
      center={center}
      zoom={12}
      style={{ height: "100%", width: "100%" }}
      attributionControl={false}
    >
      <TileLayer
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution="&copy; OpenStreetMap"
      />
      {points.map((p, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: list ổn định, không reorder
        <Marker key={i} position={[p.lat, p.lng]}>
          <Popup>{p.title || "(không tên)"}</Popup>
        </Marker>
      ))}
    </MapContainer>
  );
}

/** Widget "pivot" — cross-tab aggregation: rows × cols → value (sum/count). */
/** Widget "kpi" — hỗ trợ 2 chế độ:
 *  - Static: cfg.value/label/trend là string cứng (legacy).
 *  - Dynamic: cfg.entity + cfg.metricField + cfg.metricAgg (count/sum/avg/min/max).
 *    Filter qua cfg.filters cây nâng cao. */
function KpiWidget({ cfg }: { cfg: Record<string, unknown> }) {
  const entityId = cfg.entity as string | undefined;
  const metricField = cfg.metricField as string | undefined;
  const metricAgg = ((cfg.metricAgg as string) || "count") as
    | "count"
    | "sum"
    | "avg"
    | "min"
    | "max";
  const filters = cfg.filters as FilterNode | null | undefined;
  const { rows: allRows, loading } = useWidgetData(cfg);
  const pageState = usePageState();

  let valueStr = (cfg.value as string) ?? "—";

  if (entityId && !loading) {
    const rows = filters ? applyFilters(allRows, filters, pageState) : allRows;
    let num = 0;
    if (metricAgg === "count" || !metricField) {
      num = rows.length;
    } else {
      const nums = rows.map((r) => Number(r[metricField])).filter((n) => Number.isFinite(n));
      if (nums.length === 0) num = 0;
      else if (metricAgg === "sum") num = nums.reduce((a, b) => a + b, 0);
      else if (metricAgg === "avg") num = nums.reduce((a, b) => a + b, 0) / nums.length;
      else if (metricAgg === "min") num = Math.min(...nums);
      else if (metricAgg === "max") num = Math.max(...nums);
    }
    valueStr = num.toLocaleString("vi-VN");
  }

  return (
    <div className="p-3 h-full flex flex-col justify-center">
      <div className="text-xs text-muted uppercase tracking-wider">
        {(cfg.label as string) ?? "KPI"}
      </div>
      <div className="text-2xl font-bold mt-1">{valueStr}</div>
      {cfg.trend ? <div className="text-xs text-success mt-0.5">{String(cfg.trend)}</div> : null}
    </div>
  );
}

function PivotWidget({ cfg }: { cfg: Record<string, unknown> }) {
  const t = useT();
  const entityId = cfg.entity as string | undefined;
  const rowField = (cfg.rowField as string) || "category";
  const colField = (cfg.colField as string) || "status";
  const valueField = cfg.valueField as string | undefined;
  const agg = (cfg.agg as string) || "count";
  const filters = cfg.filters as FilterNode | null | undefined;
  const ent = useEntity(entityId);
  const { rows: allRows, loading, err } = useWidgetData(cfg);
  const pageState = usePageState();

  if (!entityId || !ent)
    return <div className="p-3 text-xs text-muted">{t("widget.no_entity_pivot")}</div>;
  if (loading) return <div className="p-3 text-xs text-muted">{t("widget.loading")}</div>;
  if (err) return <div className="p-3 text-xs text-danger">{t("widget.error", { err })}</div>;

  const rows = filters ? applyFilters(allRows, filters, pageState) : allRows;
  const rowKeys = new Set<string>();
  const colKeys = new Set<string>();
  const matrix = new Map<string, Map<string, number[]>>(); // row → col → values
  for (const r of rows) {
    const rk = String(r[rowField] ?? "(trống)");
    const ck = String(r[colField] ?? "(trống)");
    rowKeys.add(rk);
    colKeys.add(ck);
    let m = matrix.get(rk);
    if (!m) {
      m = new Map();
      matrix.set(rk, m);
    }
    if (!m.has(ck)) m.set(ck, []);
    const v = valueField ? Number(r[valueField] ?? 0) : 1;
    m.get(ck)?.push(v);
  }
  const reduce = (vs: number[]): number => {
    if (vs.length === 0) return 0;
    if (agg === "count") return vs.length;
    if (agg === "sum") return vs.reduce((a, b) => a + b, 0);
    if (agg === "avg") return vs.reduce((a, b) => a + b, 0) / vs.length;
    if (agg === "min") return Math.min(...vs);
    if (agg === "max") return Math.max(...vs);
    return 0;
  };
  const rowList = [...rowKeys].sort();
  const colList = [...colKeys].sort();

  return (
    <div className="h-full flex flex-col">
      <div className="text-xs px-2 py-1 border-b border-border text-muted flex items-center gap-1">
        <I.Table size={11} /> {ent.name} · {agg}({valueField ?? "rows"}) by {rowField} × {colField}
      </div>
      <div className="flex-1 min-h-0 overflow-auto p-2">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr>
              <th className="border border-border px-2 py-1 bg-bg-soft sticky top-0">
                {rowField}\\{colField}
              </th>
              {colList.map((c) => (
                <th
                  key={c}
                  className="border border-border px-2 py-1 bg-bg-soft text-right sticky top-0"
                >
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rowList.map((r) => (
              <tr key={r}>
                <td className="border border-border px-2 py-1 font-medium">{r}</td>
                {colList.map((c) => {
                  const vs = matrix.get(r)?.get(c) ?? [];
                  const v = reduce(vs);
                  return (
                    <td key={c} className="border border-border px-2 py-1 text-right font-mono">
                      {vs.length === 0 ? "·" : v.toLocaleString("vi-VN")}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Split Panel — hai sub-widget chia sẻ selection state nội bộ qua PageStateContext. */
type SplitPanelCfg = { kind?: string; entity?: string; title?: string; linkField?: string };

function useDragRatio(
  initValue: number,
  containerRef: React.RefObject<HTMLDivElement | null>,
  axis: "h" | "v",
) {
  const [ratio, setRatio] = useState(initValue);
  const dragging = useRef(false);

  const onMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    const onMove = (ev: MouseEvent) => {
      if (!dragging.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const pct =
        axis === "h"
          ? ((ev.clientX - rect.left) / rect.width) * 100
          : ((ev.clientY - rect.top) / rect.height) * 100;
      setRatio(Math.min(80, Math.max(20, pct)));
    };
    const onUp = () => {
      dragging.current = false;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  return [ratio, onMouseDown] as const;
}

function buildSubCfg(panel: SplitPanelCfg, splitKey: string): Record<string, unknown> {
  const kind = panel.kind ?? "list";
  return {
    entity: panel.entity,
    title: panel.title,
    ...(kind === "list" ? { selectionStateKey: splitKey } : {}),
    ...(kind === "detail" ? { recordIdFromState: splitKey } : {}),
    ...((kind === "list" || kind === "chart" || kind === "kanban") && panel.linkField
      ? { filterFromState: { field: panel.linkField, stateKey: splitKey } }
      : {}),
    ...(kind === "form" && panel.linkField
      ? { linkedToState: { field: panel.linkField, stateKey: splitKey } }
      : {}),
  };
}

function RenderSubWidget({
  kind,
  cfg,
  stateKey,
}: {
  kind: string;
  cfg: Record<string, unknown>;
  stateKey: string;
}) {
  if (kind === "list")
    return (
      <ListWidget
        entityId={cfg.entity as string | undefined}
        dataSourceId={cfg.dataSourceId as string | undefined}
        stateKey={stateKey}
        fields={cfg.fields as string[] | undefined}
        selectionStateKey={cfg.selectionStateKey as string | undefined}
        filterFromState={cfg.filterFromState as { field: string; stateKey: string } | undefined}
        searchFromState={cfg.searchFromState as string | undefined}
        title={cfg.title as string | undefined}
        multiSelect={cfg.multiSelect === true}
        editable={cfg.editable === true}
        batchEdit={cfg.batchEdit === true}
        excelMode={cfg.excelMode === true}
        rowLimit={cfg.rowLimit as number | undefined}
        pageSize={cfg.pageSize as number | undefined}
        loadFilters={cfg.loadFilters as LoadFilters | undefined}
        loadGate={cfg.loadGate as string | undefined}
      />
    );
  if (kind === "detail") return <DetailWidget cfg={cfg} />;
  if (kind === "form") return <FormWidget cfg={cfg} />;
  if (kind === "chart") return <ChartWidget cfg={cfg} />;
  if (kind === "kanban") return <KanbanWidget cfg={cfg} />;
  return null;
}

function SplitWidget({ comp }: { comp: PageComponent }) {
  const cfg = comp.config ?? {};
  const orientation = (cfg.orientation as string) ?? "h";
  const initRatio = (cfg.ratio as number) ?? 40;
  const initRatioV = (cfg.ratioV as number) ?? 50;
  const panelA = (cfg.panelA as SplitPanelCfg | undefined) ?? {};
  const panelB = (cfg.panelB as SplitPanelCfg | undefined) ?? {};
  const panelC = (cfg.panelC as SplitPanelCfg | undefined) ?? {};

  const splitKey = `split_${comp.id}_sel`;
  const kindA = panelA.kind ?? "list";
  const kindB = panelB.kind ?? "detail";
  const kindC = panelC.kind ?? "list";

  const containerRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  const [ratioH, onDragH] = useDragRatio(initRatio, containerRef, "h");
  const [ratioV, onDragV] = useDragRatio(initRatioV, rightRef, "v");

  const cfgA = buildSubCfg({ ...panelA, kind: kindA, linkField: undefined }, splitKey);
  const cfgB = buildSubCfg({ ...panelB, kind: kindB }, splitKey);
  const cfgC = buildSubCfg({ ...panelC, kind: kindC }, splitKey);

  const handleCls = (axis: "h" | "v") =>
    `shrink-0 ${axis === "h" ? "w-1.5 cursor-col-resize" : "h-1.5 cursor-row-resize"} bg-border hover:bg-accent/50 transition-colors active:bg-accent`;

  if (orientation === "both") {
    return (
      <div ref={containerRef} className="flex flex-row h-full overflow-hidden">
        <div className="overflow-hidden" style={{ width: `${ratioH}%` }}>
          <RenderSubWidget kind={kindA} cfg={cfgA} stateKey={`${comp.id}:a`} />
        </div>
        <div onMouseDown={onDragH} className={handleCls("h")} />
        <div ref={rightRef} className="flex flex-col flex-1 overflow-hidden">
          <div className="overflow-hidden" style={{ height: `${ratioV}%` }}>
            <RenderSubWidget kind={kindB} cfg={cfgB} stateKey={`${comp.id}:b`} />
          </div>
          <div onMouseDown={onDragV} className={handleCls("v")} />
          <div className="flex-1 overflow-hidden">
            <RenderSubWidget kind={kindC} cfg={cfgC} stateKey={`${comp.id}:c`} />
          </div>
        </div>
      </div>
    );
  }

  const isH = orientation !== "v";
  return (
    <div
      ref={containerRef}
      className={`flex ${isH ? "flex-row" : "flex-col"} h-full overflow-hidden`}
    >
      <div className="overflow-hidden" style={{ [isH ? "width" : "height"]: `${ratioH}%` }}>
        <RenderSubWidget kind={kindA} cfg={cfgA} stateKey={`${comp.id}:a`} />
      </div>
      <div onMouseDown={onDragH} className={handleCls(isH ? "h" : "v")} />
      <div className="overflow-hidden flex-1">
        <RenderSubWidget kind={kindB} cfg={cfgB} stateKey={`${comp.id}:b`} />
      </div>
    </div>
  );
}

function SearchWidget({ cfg }: { cfg: Record<string, unknown> }) {
  const pageState = usePageState();
  const stateKey = (cfg.stateKey as string) || "";
  const label = cfg.label as string | undefined;
  const placeholder = (cfg.placeholder as string) || "Tìm kiếm…";
  const val = (pageState.get(stateKey) as string) ?? "";

  if (!stateKey) return <div className="p-3 text-xs text-muted">Chưa cấu hình state key.</div>;

  return (
    <div className="p-2 h-full flex flex-col gap-1">
      {label && <div className="text-xs font-medium text-muted">{label}</div>}
      <div className="relative">
        <I.Search
          size={13}
          className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none"
        />
        <input
          type="text"
          value={val}
          onChange={(e) => pageState.set(stateKey, e.target.value)}
          placeholder={placeholder}
          className="w-full h-8 pl-8 pr-7 border border-border rounded bg-bg text-sm outline-none focus:border-accent"
        />
        {val && (
          <button
            type="button"
            onClick={() => pageState.set(stateKey, "")}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-text"
          >
            <I.X size={12} />
          </button>
        )}
      </div>
    </div>
  );
}

function ComboboxWidget({ cfg }: { cfg: Record<string, unknown> }) {
  const pageState = usePageState();
  const field = cfg.field as string | undefined;
  const { rows } = useWidgetData(cfg);
  const stateKey = (cfg.stateKey as string) || "";
  const label = cfg.label as string | undefined;
  const staticOpts = (cfg.options as string) || "";
  const val = (pageState.get(stateKey) as string) ?? "";

  const dynamicOpts = useMemo(() => {
    if (!field || !rows.length) return [];
    return [...new Set(rows.map((r) => String(r[field] ?? "")).filter(Boolean))].sort();
  }, [rows, field]);

  const options = staticOpts
    ? staticOpts
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : dynamicOpts;

  if (!stateKey) return <div className="p-3 text-xs text-muted">Chưa cấu hình state key.</div>;

  return (
    <div className="p-2 h-full flex flex-col gap-1">
      {label && <div className="text-xs font-medium text-muted">{label}</div>}
      <SearchableSelect
        className="w-full"
        value={val}
        onChange={(v) => pageState.set(stateKey, v)}
        options={options.map((o) => ({ value: o, label: o }))}
        emptyOption="— tất cả —"
      />
    </div>
  );
}

function ListboxWidget({ cfg }: { cfg: Record<string, unknown> }) {
  const t = useT();
  const pageState = usePageState();
  const field = cfg.field as string | undefined;
  const { rows } = useWidgetData(cfg);
  const stateKey = (cfg.stateKey as string) || "";
  const label = cfg.label as string | undefined;
  const staticOpts = (cfg.options as string) || "";
  const multiSelect = cfg.multiSelect !== false;
  const raw = pageState.get(stateKey);
  const selected: string[] = Array.isArray(raw) ? (raw as string[]) : raw ? [String(raw)] : [];

  const dynamicOpts = useMemo(() => {
    if (!field || !rows.length) return [];
    return [...new Set(rows.map((r) => String(r[field] ?? "")).filter(Boolean))].sort();
  }, [rows, field]);

  const options = staticOpts
    ? staticOpts
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : dynamicOpts;

  if (!stateKey) return <div className="p-3 text-xs text-muted">Chưa cấu hình state key.</div>;

  const toggle = (opt: string) => {
    if (!multiSelect) {
      pageState.set(stateKey, selected[0] === opt ? "" : opt);
      return;
    }
    const next = selected.includes(opt) ? selected.filter((s) => s !== opt) : [...selected, opt];
    pageState.set(stateKey, next);
  };

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {label && (
        <div className="px-3 py-1.5 border-b border-border text-xs font-medium text-muted shrink-0">
          {label}
        </div>
      )}
      <div className="flex-1 overflow-y-auto">
        <button
          type="button"
          onClick={() => pageState.set(stateKey, multiSelect ? [] : "")}
          className={`w-full text-left px-3 py-1.5 text-sm hover:bg-surface flex items-center gap-2 border-b border-border/40 ${selected.length === 0 ? "text-accent font-medium" : "text-muted"}`}
        >
          <I.Filter size={12} className="shrink-0" />
          Tất cả
        </button>
        {options.map((opt) => {
          const isSel = selected.includes(opt);
          return (
            <button
              key={opt}
              type="button"
              onClick={() => toggle(opt)}
              className={`w-full text-left px-3 py-1.5 text-sm hover:bg-surface flex items-center gap-2 border-b border-border/30 ${isSel ? "text-accent" : ""}`}
            >
              {multiSelect ? (
                <span
                  className={`w-3.5 h-3.5 rounded border shrink-0 flex items-center justify-center ${isSel ? "bg-accent border-accent" : "border-border"}`}
                >
                  {isSel && <I.Check size={9} className="text-white" />}
                </span>
              ) : (
                <span
                  className={`w-3 h-3 rounded-full border shrink-0 ${isSel ? "bg-accent border-accent" : "border-border"}`}
                />
              )}
              <span className="truncate">{opt}</span>
            </button>
          );
        })}
        {options.length === 0 && (
          <div className="p-3 text-xs text-muted/60 text-center">{t("widget.empty_data")}</div>
        )}
      </div>
    </div>
  );
}

function TagboxWidget({ cfg }: { cfg: Record<string, unknown> }) {
  const pageState = usePageState();
  const field = cfg.field as string | undefined;
  const { rows } = useWidgetData(cfg);
  const stateKey = (cfg.stateKey as string) || "";
  const label = cfg.label as string | undefined;
  const staticOpts = (cfg.options as string) || "";
  const placeholder = (cfg.placeholder as string) || undefined;
  const raw = pageState.get(stateKey);
  const selected: string[] = Array.isArray(raw) ? (raw as string[]) : [];

  const dynamicOpts = useMemo(() => {
    if (!field || !rows.length) return [];
    return [...new Set(rows.map((r) => String(r[field] ?? "")).filter(Boolean))].sort();
  }, [rows, field]);

  const suggestions = staticOpts
    ? staticOpts
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : dynamicOpts;

  if (!stateKey) return <div className="p-3 text-xs text-muted">Chưa cấu hình state key.</div>;

  return (
    <div className="p-2 flex flex-col gap-1">
      {label && <div className="text-xs font-medium text-muted">{label}</div>}
      <TagBox
        value={selected}
        onChange={(next) => pageState.set(stateKey, next)}
        suggestions={suggestions}
        placeholder={placeholder}
        strict={suggestions.length > 0}
      />
    </div>
  );
}

type ActionBarItem = ActionConfig & { id: string };

/** Strip hành động nhúng bên trong widget (list/form/detail). */
function EmbeddedActionStrip({
  items,
  pageState,
}: {
  items: ActionBarItem[];
  pageState: ReturnType<typeof usePageState>;
}) {
  return (
    <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-border/40 bg-panel-2/30 shrink-0 flex-wrap">
      {items.map((item) => (
        <ActionWidget key={item.id} config={item} pageState={pageState} inline />
      ))}
    </div>
  );
}

/** Bọc widget có embeddedActions trong flex-col với strip hành động ở trên. */
function withEmbeddedActions(
  content: ReactElement,
  items: ActionBarItem[],
  pageState: ReturnType<typeof usePageState>,
): ReactElement {
  if (items.length === 0) return content;
  return (
    <div className="flex flex-col h-full overflow-hidden">
      <EmbeddedActionStrip items={items} pageState={pageState} />
      <div className="flex-1 min-h-0 overflow-hidden">{content}</div>
    </div>
  );
}

/** Thanh nhiều nút hành động nằm ngang. */
function ActionBarWidget({
  cfg,
  pageState,
}: {
  cfg: Record<string, unknown>;
  pageState: ReturnType<typeof usePageState>;
}) {
  const t = useT();
  const items = (cfg.items ?? []) as (ActionConfig & { id: string })[];
  const align = cfg.align as string | undefined;
  const justify =
    align === "right" ? "justify-end" : align === "between" ? "justify-between" : "justify-start";
  return (
    <div className={cn("h-full flex items-center gap-2 px-2.5 overflow-x-auto", justify)}>
      {items.length === 0 ? (
        <span className="text-xs text-muted/50 italic">{t("widget.no_actions")}</span>
      ) : (
        items.map((item) => (
          <ActionWidget key={item.id} config={item} pageState={pageState} inline />
        ))
      )}
    </div>
  );
}

/** Render một widget theo kind. */
function Widget({ comp, pageId }: { comp: PageComponent; pageId: string }) {
  const cfg = comp.config ?? {};
  const stateKey = `${pageId}:${comp.id}`;
  const pageState = usePageState();
  if (comp.kind === "action") {
    return <ActionWidget config={cfg as unknown as ActionConfig} pageState={pageState} />;
  }
  if (comp.kind === "actionbar") {
    return <ActionBarWidget cfg={cfg} pageState={pageState} />;
  }
  if (comp.kind === "kpi") return <KpiWidget cfg={cfg} />;
  if (comp.kind === "chart") return <ChartWidget cfg={cfg} />;
  if (comp.kind === "list") {
    const embActs = (cfg.embeddedActions ?? []) as ActionBarItem[];
    return withEmbeddedActions(
      <ListWidget
        entityId={cfg.entity as string | undefined}
        dataSourceId={cfg.dataSourceId as string | undefined}
        stateKey={stateKey}
        fields={cfg.fields as string[] | undefined}
        selectionStateKey={cfg.selectionStateKey as string | undefined}
        filterFromState={cfg.filterFromState as { field: string; stateKey: string } | undefined}
        filters={cfg.filters as FilterNode | null | undefined}
        searchFromState={cfg.searchFromState as string | undefined}
        searchStateKey={cfg.searchStateKey as string | undefined}
        title={cfg.title as string | undefined}
        multiSelect={cfg.multiSelect === true}
        editable={cfg.editable === true}
        batchEdit={cfg.batchEdit === true}
        excelMode={cfg.excelMode === true}
        rowLimit={cfg.rowLimit as number | undefined}
        pageSize={cfg.pageSize as number | undefined}
        loadFilters={cfg.loadFilters as LoadFilters | undefined}
        loadGate={cfg.loadGate as string | undefined}
        emptyStateShowsAll={
          // Mặc định true khi filterFromState có cấu hình: combobox "tất cả" → hiện hết.
          // Explicit false = master-detail (ẩn khi chưa chọn).
          cfg.emptyStateShowsAll !== false && !!cfg.filterFromState
        }
      />,
      embActs,
      pageState,
    );
  }
  if (comp.kind === "form") {
    const embActs = (cfg.embeddedActions ?? []) as ActionBarItem[];
    return withEmbeddedActions(<FormWidget cfg={cfg} compId={comp.id} />, embActs, pageState);
  }
  if (comp.kind === "detail") {
    const embActs = (cfg.embeddedActions ?? []) as ActionBarItem[];
    return withEmbeddedActions(<DetailWidget cfg={cfg} compId={comp.id} />, embActs, pageState);
  }
  if (comp.kind === "kanban") return <KanbanWidget cfg={cfg} />;
  if (comp.kind === "step") return <StepWidget cfg={cfg} />;
  if (comp.kind === "split") return <SplitWidget comp={comp} />;
  if (comp.kind === "search") return <SearchWidget cfg={cfg} />;
  if (comp.kind === "combobox") return <ComboboxWidget cfg={cfg} />;
  if (comp.kind === "listbox") return <ListboxWidget cfg={cfg} />;
  if (comp.kind === "tagbox") return <TagboxWidget cfg={cfg} />;
  if (comp.kind === "calendar") return <CalendarWidget cfg={cfg} />;
  if (comp.kind === "map") return <MapWidget cfg={cfg} />;
  if (comp.kind === "pivot") return <PivotWidget cfg={cfg} />;
  if (comp.kind === "html") {
    // sandbox="allow-scripts" không có allow-same-origin: frame bị coi
    // là cross-origin nên script bên trong không thể truy cập cookie/
    // localStorage/DOM của app cha — ngăn XSS exfil token.
    return (
      <iframe
        sandbox="allow-scripts"
        srcDoc={(cfg.html as string) ?? ""}
        className="w-full border-0 block"
        title="HTML widget"
        style={{ minHeight: "120px", height: "100%" }}
      />
    );
  }
  return (
    <div className="p-3 text-xs text-muted h-full flex items-center justify-center text-center">
      Widget "{comp.kind}" — chưa hỗ trợ ở chế độ người dùng.
    </div>
  );
}

const ROW_H = 76;
const GAP = 12; // gap-3

/* ── Helpers lưu/đọc bố cục cá nhân ──────────────────────────
   Logged-in  : key = erp_layout_{userId}_{pageId}
   Anonymous  : key = erp_layout_{pageId}
   ─────────────────────────────────────────────────────────── */
function layoutStorageKey(pageId: string, userId: string | null): string {
  return userId ? `erp_layout_${userId}_${pageId}` : `erp_layout_${pageId}`;
}
function loadPersonalLayout(key: string): PageComponent[] | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as PageComponent[]) : null;
  } catch {
    return null;
  }
}
function savePersonalLayoutLS(key: string, comps: PageComponent[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(comps));
  } catch {
    /* quota */
  }
}
function clearPersonalLayoutLS(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

export function ConsumerPage({ pageId }: { pageId: string }) {
  const t = useT();
  const isMobile = useIsMobile();
  const page = useUserObjects((s) => s.pages).find((p) => p.id === pageId);
  const content = useUserObjects((s) => s.pageContent[pageId]);
  const userId = useAuth((s) => s.user?.id ?? null);

  const baseComponents: PageComponent[] = Array.isArray(content)
    ? (content as PageComponent[])
    : [];

  /* ── Bố cục cá nhân (per-user, localStorage) ──────────── */
  const storageKey = layoutStorageKey(pageId, userId);
  const [personalLayout, setPersonalLayout] = useState<PageComponent[] | null>(null);

  // Nạp khi userId / pageId thay đổi (auth xong mới biết userId)
  useEffect(() => {
    setPersonalLayout(loadPersonalLayout(storageKey));
  }, [storageKey]);

  const saveLayout = useCallback(
    (comps: PageComponent[]) => {
      savePersonalLayoutLS(storageKey, comps);
      setPersonalLayout(comps);
    },
    [storageKey],
  );
  const resetLayout = useCallback(() => {
    clearPersonalLayoutLS(storageKey);
    setPersonalLayout(null);
  }, [storageKey]);

  /* ── Layout editing state ─────────────────────────────── */
  const [layoutEditing, setLayoutEditing] = useState(false);
  const [localComps, setLocalComps] = useState<PageComponent[]>([]);

  // Nguồn hiển thị: bố cục cá nhân → bố cục gốc
  const displayComps = layoutEditing ? localComps : (personalLayout ?? baseComponents);
  const hasPersonal = personalLayout !== null;
  // Mobile: stack 1 cột theo thứ tự đọc (trên→dưới, trái→phải).
  const renderComps = isMobile
    ? [...displayComps].sort((a, b) => (a.y ?? 0) - (b.y ?? 0) || (a.x ?? 0) - (b.x ?? 0))
    : displayComps;

  /* ── Drag state ───────────────────────────────────────── */
  const [dragCompId, setDragCompId] = useState<string | null>(null);
  const [dropPos, setDropPos] = useState<{ x: number; y: number } | null>(null);

  /* ── Resize state ─────────────────────────────────────── */
  const gridRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const scrollRafRef = useRef<number | null>(null);
  const resizeRef = useRef<{
    compId: string;
    dir: "e" | "s" | "se";
    startMouseX: number;
    startMouseY: number;
    startW: number;
    startH: number;
    compX: number;
  } | null>(null);
  const [resizingId, setResizingId] = useState<string | null>(null);

  /* ── Auto-scroll ──────────────────────────────────────── */
  const stopAutoScroll = useCallback(() => {
    if (scrollRafRef.current !== null) {
      cancelAnimationFrame(scrollRafRef.current);
      scrollRafRef.current = null;
    }
  }, []);
  const startAutoScroll = useCallback(
    (speed: number) => {
      stopAutoScroll();
      const tick = () => {
        canvasRef.current?.scrollBy({ top: speed });
        scrollRafRef.current = requestAnimationFrame(tick);
      };
      scrollRafRef.current = requestAnimationFrame(tick);
    },
    [stopAutoScroll],
  );
  useEffect(() => stopAutoScroll, [stopAutoScroll]);

  /* ── Window mouse events (resize) ─────────────────────── */
  useEffect(() => {
    if (!layoutEditing) return;
    const ROW_STRIDE = ROW_H + GAP;
    const onMove = (e: MouseEvent) => {
      const r = resizeRef.current;
      if (!r) return;
      const grid = gridRef.current;
      if (!grid) return;
      const colW = (grid.offsetWidth - 11 * GAP) / 12;
      const dx = e.clientX - r.startMouseX;
      const dy = e.clientY - r.startMouseY;
      let newW = r.startW;
      let newH = r.startH;
      if (r.dir === "e" || r.dir === "se")
        newW = Math.max(1, Math.min(12 - r.compX, Math.round(r.startW + dx / colW)));
      if (r.dir === "s" || r.dir === "se")
        newH = Math.max(1, Math.round(r.startH + dy / ROW_STRIDE));
      setLocalComps((cs) => cs.map((c) => (c.id === r.compId ? { ...c, w: newW, h: newH } : c)));
    };
    const onUp = () => {
      if (!resizeRef.current) return;
      const id = resizeRef.current.compId;
      resizeRef.current = null;
      setResizingId(null);
      setLocalComps((cs) => {
        const resolved = applyInsertAndResolve(id, cs);
        saveLayout(resolved); // lưu bố cục cá nhân
        return resolved;
      });
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [layoutEditing, saveLayout]);

  /* ── Grid coordinate helper ───────────────────────────── */
  const computeDropPos = (mouseX: number, mouseY: number) => {
    const el = gridRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    const x = Math.max(0, Math.min(11, Math.floor(((mouseX - rect.left) / rect.width) * 12)));
    const y = Math.max(0, Math.floor((mouseY - rect.top) / (ROW_H + GAP)));
    return { x, y };
  };

  /* ── Canvas drag handlers ─────────────────────────────── */
  const onCanvasDragOver = (e: React.DragEvent) => {
    if (!dragCompId) return;
    e.preventDefault();
    setDropPos(computeDropPos(e.clientX, e.clientY));
    const el = canvasRef.current;
    if (el) {
      const rect = el.getBoundingClientRect();
      const ZONE = 64;
      const dy = e.clientY - rect.top;
      const db = rect.bottom - e.clientY;
      if (dy < ZONE) startAutoScroll(-Math.ceil((1 - dy / ZONE) * 14));
      else if (db < ZONE) startAutoScroll(Math.ceil((1 - db / ZONE) * 14));
      else stopAutoScroll();
    }
  };
  const onCanvasDragLeave = (e: React.DragEvent) => {
    if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) {
      setDropPos(null);
      stopAutoScroll();
    }
  };
  const onCanvasDrop = (e: React.DragEvent) => {
    e.preventDefault();
    stopAutoScroll();
    const raw = dropPos ?? computeDropPos(e.clientX, e.clientY);
    if (dragCompId && raw) {
      const comp = localComps.find((c) => c.id === dragCompId);
      if (comp) {
        const nx = Math.max(0, Math.min(12 - comp.w, raw.x));
        const ny = Math.max(0, raw.y);
        const updated = applyInsertAndResolve(
          dragCompId,
          localComps.map((c) => (c.id === dragCompId ? { ...c, x: nx, y: ny } : c)),
        );
        setLocalComps(updated);
        saveLayout(updated); // lưu bố cục cá nhân
      }
    }
    setDragCompId(null);
    setDropPos(null);
  };

  /* ── Enter / exit / reset ─────────────────────────────── */
  const enterEdit = () => {
    // bắt đầu từ bố cục cá nhân đang hiện (hoặc bố cục gốc)
    setLocalComps(personalLayout ?? baseComponents);
    setLayoutEditing(true);
  };
  const exitEdit = () => {
    setLayoutEditing(false);
    setDragCompId(null);
    setDropPos(null);
    stopAutoScroll();
  };
  const handleReset = () => {
    resetLayout();
    setLayoutEditing(false);
    setDragCompId(null);
    setDropPos(null);
    stopAutoScroll();
  };

  return (
    <PageStateProvider>
      <div ref={canvasRef} className="overflow-y-auto h-full">
        <div className="max-w-[1180px] mx-auto p-3 sm:p-6">
          {/* Header */}
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold">{page?.name ?? "Trang"}</h1>
              {layoutEditing ? (
                <div className="text-sm text-accent font-medium mt-0.5">
                  Kéo để di chuyển — kéo cạnh/góc để thay đổi kích thước
                </div>
              ) : hasPersonal ? (
                <div className="text-sm text-muted mt-0.5">Đang dùng bố cục cá nhân</div>
              ) : (
                <div className="text-sm text-muted mt-0.5">
                  Chế độ người dùng — dữ liệu thật từ backend
                </div>
              )}
            </div>

            <div className="shrink-0 mt-1 flex items-center gap-2">
              {/* Nút trở về mặc định — hiện khi có bố cục cá nhân */}
              {hasPersonal && !layoutEditing && !isMobile && (
                <button
                  type="button"
                  onClick={handleReset}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md border border-border hover:bg-danger/10 hover:border-danger/40 hover:text-danger text-muted transition-colors"
                  title="Xoá bố cục cá nhân, trở về bố cục mặc định của trang"
                >
                  <I.Undo size={13} />
                  Mặc định
                </button>
              )}

              {/* Nút Sắp xếp / Xong — ẩn trên mobile (kéo-thả không khả dụng) */}
              {isMobile ? null : layoutEditing ? (
                <button
                  type="button"
                  onClick={exitEdit}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md bg-accent text-white hover:bg-accent/90 font-medium"
                >
                  <I.Check size={13} />
                  Xong
                </button>
              ) : (
                <button
                  type="button"
                  onClick={enterEdit}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md border border-border hover:bg-hover text-muted"
                >
                  <I.Grip size={13} />
                  Sắp xếp
                </button>
              )}
            </div>
          </div>

          {displayComps.length === 0 ? (
            <div className="card p-12 text-center text-muted text-sm">{t("widget.empty_page")}</div>
          ) : (
            <div
              onDragOver={layoutEditing ? onCanvasDragOver : undefined}
              onDragLeave={layoutEditing ? onCanvasDragLeave : undefined}
              onDrop={layoutEditing ? onCanvasDrop : undefined}
            >
              <div
                ref={gridRef}
                className="grid gap-3"
                style={{
                  gridTemplateColumns: isMobile ? "1fr" : "repeat(12, 1fr)",
                  gridAutoRows: isMobile ? "auto" : `${ROW_H}px`,
                }}
              >
                {/* Ghost placeholder during drag */}
                {layoutEditing &&
                  dragCompId &&
                  dropPos &&
                  (() => {
                    const dc = localComps.find((c) => c.id === dragCompId);
                    if (!dc) return null;
                    const gx = Math.max(0, Math.min(12 - dc.w, dropPos.x));
                    const gy = Math.max(0, dropPos.y);
                    return (
                      <div
                        className="pointer-events-none rounded-md border-2 border-dashed border-accent bg-accent/10 z-10"
                        style={{
                          gridColumn: `${gx + 1} / span ${dc.w}`,
                          gridRow: `${gy + 1} / span ${dc.h}`,
                        }}
                      />
                    );
                  })()}

                {renderComps.map((c) => {
                  const colStart = (c.x ?? 0) + 1;
                  const rowStart = (c.y ?? 0) + 1;
                  const w = Math.min(c.w || 3, 12);
                  const h = c.h || 2;
                  const isBeingDragged = dragCompId === c.id;
                  const isBeingResized = resizingId === c.id;
                  return (
                    <div
                      key={c.id}
                      draggable={layoutEditing && !isBeingResized && !isMobile}
                      className={cn(
                        "card overflow-hidden",
                        layoutEditing && !isMobile && "relative group/card",
                        layoutEditing &&
                          !isBeingResized &&
                          !isMobile &&
                          "cursor-grab active:cursor-grabbing",
                        isBeingDragged && "opacity-40",
                        isBeingResized && "select-none",
                      )}
                      style={
                        isMobile
                          ? { minHeight: h * ROW_H }
                          : {
                              gridColumn: `${colStart} / span ${w}`,
                              gridRow: `${rowStart} / span ${h}`,
                            }
                      }
                      onDragStart={
                        layoutEditing
                          ? (e) => {
                              if (isBeingResized) {
                                e.preventDefault();
                                return;
                              }
                              e.dataTransfer.effectAllowed = "move";
                              e.dataTransfer.setData("text/plain", c.id);
                              setDragCompId(c.id);
                              setDropPos(null);
                            }
                          : undefined
                      }
                      onDragEnd={
                        layoutEditing
                          ? () => {
                              setDragCompId(null);
                              setDropPos(null);
                              stopAutoScroll();
                            }
                          : undefined
                      }
                    >
                      {isMobile || !isScalableKind(c.kind) ? (
                        // Danh sách/tương tác: giữ nguyên + tự cuộn; mobile: layout dọc.
                        <Widget comp={c} pageId={pageId} />
                      ) : (
                        <ScaleToFit>
                          <Widget comp={c} pageId={pageId} />
                        </ScaleToFit>
                      )}

                      {/* Resize handles — chỉ hiện khi layoutEditing */}
                      {layoutEditing && (
                        <>
                          <div
                            className="absolute right-0 top-0 bottom-2.5 w-1.5 cursor-ew-resize z-20 opacity-0 group-hover/card:opacity-100 hover:bg-accent/40 transition-colors"
                            onMouseDown={(e) => {
                              e.stopPropagation();
                              e.preventDefault();
                              resizeRef.current = {
                                compId: c.id,
                                dir: "e",
                                startMouseX: e.clientX,
                                startMouseY: e.clientY,
                                startW: c.w,
                                startH: c.h,
                                compX: c.x,
                              };
                              setResizingId(c.id);
                            }}
                          />
                          <div
                            className="absolute left-0 right-2.5 bottom-0 h-1.5 cursor-ns-resize z-20 opacity-0 group-hover/card:opacity-100 hover:bg-accent/40 transition-colors"
                            onMouseDown={(e) => {
                              e.stopPropagation();
                              e.preventDefault();
                              resizeRef.current = {
                                compId: c.id,
                                dir: "s",
                                startMouseX: e.clientX,
                                startMouseY: e.clientY,
                                startW: c.w,
                                startH: c.h,
                                compX: c.x,
                              };
                              setResizingId(c.id);
                            }}
                          />
                          <div
                            className="absolute right-0 bottom-0 w-2.5 h-2.5 cursor-nwse-resize z-30 opacity-0 group-hover/card:opacity-100 hover:bg-accent/40 transition-colors flex items-center justify-center"
                            onMouseDown={(e) => {
                              e.stopPropagation();
                              e.preventDefault();
                              resizeRef.current = {
                                compId: c.id,
                                dir: "se",
                                startMouseX: e.clientX,
                                startMouseY: e.clientY,
                                startW: c.w,
                                startH: c.h,
                                compX: c.x,
                              };
                              setResizingId(c.id);
                            }}
                          >
                            <svg
                              width="7"
                              height="7"
                              viewBox="0 0 7 7"
                              className="text-accent/70"
                              aria-hidden="true"
                            >
                              <path
                                d="M1 6 L6 1 M3.5 6 L6 3.5"
                                stroke="currentColor"
                                strokeWidth="1.5"
                                strokeLinecap="round"
                              />
                            </svg>
                          </div>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </PageStateProvider>
  );
}
