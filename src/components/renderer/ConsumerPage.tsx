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
  Fragment,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { MapContainer, Marker, Popup, TileLayer } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { createApiDataSource } from "@erp-framework/client";
import { useBlocker } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { I } from "@/components/Icons";
import { ActionWidget } from "@/components/renderer/ActionWidget";
import { Chart } from "@/components/renderer/Chart";
import {
  type ColumnGroupNode,
  DataGrid,
  type ServerGridQuery,
  type ServerPagingController,
} from "@/components/renderer/DataGrid";
import { DocumentWidget } from "@/components/renderer/DocumentWidget";
import { DrawingPageCell } from "@/components/renderer/DrawingPageCell";
import { ExcelGrid } from "@/components/renderer/ExcelGrid";
import { LookupPicker } from "@/components/renderer/LookupPicker";
import {
  type CreateFormCfg,
  MasterDetailCreateModal,
} from "@/components/renderer/MasterDetailCreateModal";
import { MasterDetailEditModal } from "@/components/renderer/MasterDetailEditModal";
import { RowActionsCell } from "@/components/renderer/RowActionsCell";
import { isScalableKind, ScaleToFit } from "@/components/ScaleToFit";
import { Button, Chip, Modal, SearchableSelect } from "@/components/ui";
import { TagBox } from "@/components/ui/tagbox";
import { useIsMobile } from "@/hooks/useMediaQuery";
import { useT } from "@/hooks/useT";
import { dialog } from "@/lib/dialog";
import { applyFieldFormat } from "@/lib/format";
import type { EntityField, MockEntity } from "@/lib/object-types";
import { applyFilters } from "@/lib/page-filters";
import { applyInsertAndResolve } from "@/lib/page-layout";
import { idbGet, idbSet } from "@/lib/page-state-idb";
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
  const lf = cfg.loadFilters as
    | Record<string, { op: LoadFilterOp; value?: unknown; fromState?: string }>
    | undefined;
  let filters: LoadFilters | undefined;
  if (lf && Object.keys(lf).length > 0) {
    // Chuẩn hóa: op "in" cần value là MẢNG (server dùng = ANY(arr)); designer
    // lưu chuỗi "a,b,c" → tách thành mảng. Op khác giữ nguyên.
    filters = {};
    for (const [field, cond] of Object.entries(lf)) {
      // Giá trị ĐỘNG: cond.fromState → đọc từ pageState (vd filter theo SP đã
      // chọn ở bộ lọc header). Rỗng → BỎ điều kiện này (kết hợp loadGate để
      // không tải gì cho tới khi chọn). Server-side filter → chỉ tải đúng tập.
      let value = cond.value;
      if (cond.fromState) {
        value = pageState.get(cond.fromState);
        if (
          value === undefined ||
          value === null ||
          value === "" ||
          (Array.isArray(value) && value.length === 0)
        ) {
          continue;
        }
      }
      if (cond.op === "in" && typeof value === "string") {
        filters[field] = {
          op: "in",
          value: value
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
        };
      } else {
        filters[field] = { op: cond.op, value };
      }
    }
    if (Object.keys(filters).length === 0) filters = undefined;
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
          // id thật của record (uuid) PHẢI thắng — tránh field data.id (vd id
          // cũ kiểu integer ở entity mirror) đè lên → recordId sai (Invalid
          // UUID) khi select/sửa/xóa. Khớp đường datasource (useDataSourceRecords).
          setRows(res.rows.map((r) => ({ ...r.data, id: r.id })));
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
  // Giữ meta thô (fields có sourceField/sourceRelationId + relations) để map
  // field ref → cột projection khi đổi giá trị (auto điền Tên vật tư…).
  const metaRef = useRef<Awaited<ReturnType<typeof api.getDataSourceMeta>> | null>(null);
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
        metaRef.current = meta;
        setRows(res.rows as Record<string, unknown>[]);
        setFields(
          meta.fields.map((f) => ({
            id: f.key,
            name: f.key,
            label: f.label,
            type: f.type,
            ref: f.ref,
            refValueField: f.refValueField,
            writable: f.sourceRelationId === "base" && f.writable !== false,
          })),
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

  // Đổi 1 field REF (vd mã vật tư) → trả overlay các cột PROJECTION của relation
  // tương ứng (Tên VT, Quy cách…) lấy từ record master mới chọn. Cho hiển thị
  // NGAY (kể cả batch chưa lưu / prod mirror chặn ghi), không chờ server re-join.
  const refFill = useCallback(async (fieldName: string, value: string): Promise<RefFillResult> => {
    const empty: RefFillResult = { overlay: {}, snapshot: {} };
    const meta = metaRef.current;
    if (!meta) return empty;
    const f = meta.fields.find((x) => x.key === fieldName);
    if (!f?.ref || !f.refValueField) return empty;
    const rels = meta.relations ?? [];
    const rel =
      rels.find((r) => r.fromField === f.sourceField && r.targetEntityId === f.ref) ??
      rels.find((r) => r.fromField === f.sourceField);
    if (!rel) return empty;
    const proj = meta.fields.filter((x) => x.sourceRelationId === rel.id && x.sourceField);
    if (proj.length === 0) return empty;
    const overlay: Record<string, unknown> = {};
    const v = String(value ?? "").trim();
    if (!v) {
      for (const p of proj) overlay[p.key] = "";
    } else {
      try {
        const res = await api.getRecords(f.ref, {
          filters: { [f.refValueField]: { op: "=", value: v } },
          limit: 1,
        });
        const rec = res.rows[0]?.data as Record<string, unknown> | undefined;
        for (const p of proj) overlay[p.key] = (rec ? rec[p.sourceField] : "") ?? "";
      } catch {
        return empty;
      }
    }
    // NHẬT KÝ (snapshot): cột BASE có `snapshotFrom` = key 1 cột projection vừa
    // tính trong overlay → GHI (lưu) giá trị đó vào field base, đóng băng tại
    // thời điểm chọn. Khác overlay (chỉ hiển thị, đổi theo ref về sau).
    const snapshot: Record<string, string> = {};
    for (const bf of meta.fields) {
      if (
        bf.sourceRelationId === "base" &&
        bf.writable !== false &&
        bf.snapshotFrom &&
        Object.hasOwn(overlay, bf.snapshotFrom)
      ) {
        snapshot[bf.sourceField] = String(overlay[bf.snapshotFrom] ?? "");
      }
    }
    return { overlay, snapshot };
  }, []);

  return { rows, fields, loading, err, refFill };
}

/* ── Server-side paging hook (cho bảng LỚN) — grid phát query (trang/sắp/lọc),
   hook fetch đúng 1 trang từ server (records.list / dataSources.listRecords đều
   nhận sort+offset, trả {rows,total}). Khác useRecords: KHÔNG kéo cả cửa sổ về
   client; mỗi thao tác = 1 round-trip. baseFilters (loadFilters) áp server-side
   luôn, gộp với lọc-cột (op contains). ── */
interface ServerPagedResult {
  rows: Record<string, unknown>[];
  fields: EntityField[];
  total: number;
  loading: boolean;
  err: string;
  onQueryChange: (q: ServerGridQuery) => void;
  /** Nạp lại trang hiện tại (sau khi ghi 1 ô — phản ánh giá trị đã lưu /
   *  field server-side suy ra). */
  refresh: () => void;
  /** Tổng hợp cột (server-side, toàn bảng) — field→giá trị. Rỗng nếu không yêu
   *  cầu aggregates hoặc bind datasource (chưa hỗ trợ). */
  summary: Record<string, number>;
}
type AggSpec = { field: string; fn: "sum" | "avg" | "count" | "min" | "max" };
function useServerPagedRecords(opts: {
  entityId?: string;
  dataSourceId?: string;
  baseFilters?: LoadFilters;
  pageSize: number;
  enabled?: boolean;
  /** Cột cần tổng hợp (footer summary). Chỉ áp cho entity-backed. */
  aggregates?: AggSpec[];
}): ServerPagedResult {
  const { entityId, dataSourceId, baseFilters, pageSize, enabled = true, aggregates } = opts;
  const ent = useEntity(entityId);
  const [query, setQuery] = useState<ServerGridQuery>({ pageIndex: 0, pageSize });
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [dsFields, setDsFields] = useState<EntityField[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [refreshTag, setRefreshTag] = useState(0);
  const [summary, setSummary] = useState<Record<string, number>>({});

  // Field meta của DataSource (1 lần) — entity lấy thẳng từ useEntity.
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
            m.fields.map((f) => ({
              id: f.key,
              name: f.key,
              label: f.label,
              type: f.type,
              ref: f.ref,
              refValueField: f.refValueField,
              writable: f.sourceRelationId === "base" && f.writable !== false,
            })),
          );
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [dataSourceId]);

  const baseFiltersKey = baseFilters ? JSON.stringify(baseFilters) : "";
  const querySig = JSON.stringify(query);
  // biome-ignore lint/correctness/useExhaustiveDependencies: dùng querySig/baseFiltersKey (chuỗi ổn định) thay object để deps không đổi mỗi render
  useEffect(() => {
    if (!enabled || (!entityId && !dataSourceId)) {
      setRows([]);
      setTotal(0);
      setLoading(false);
      return;
    }
    let alive = true;
    setLoading(true);
    setErr("");
    // filters server-side = baseFilters (loadFilters) + lọc-cột (contains).
    const filters: LoadFilters = {};
    if (baseFilters) for (const [k, v] of Object.entries(baseFilters)) filters[k] = v;
    for (const cf of query.columnFilters ?? [])
      filters[cf.id] = { op: "contains", value: cf.value };
    const fOpt = Object.keys(filters).length ? filters : undefined;
    const limit = query.pageSize;
    const offset = query.pageIndex * query.pageSize;
    const q = query.globalFilter;
    const run = dataSourceId
      ? api
          .getDataSourceRecords(dataSourceId, {
            limit,
            offset,
            filters: fOpt,
            sort: query.sort ? { key: query.sort.field, dir: query.sort.dir } : undefined,
            q,
          })
          .then((res) => ({ rows: res.rows as Record<string, unknown>[], total: res.total }))
      : api
          .getRecords(entityId as string, {
            limit,
            offset,
            filters: fOpt,
            sort: query.sort ? { field: query.sort.field, dir: query.sort.dir } : undefined,
            q,
          })
          // Gộp id canonical (r.id) vào row phẳng — sửa ô (updateRecord) + chọn
          // dòng cần id thật, KHÔNG dựa vào data.id (EAV thuần có thể thiếu).
          .then((res) => ({
            rows: res.rows.map((r) => ({ ...r.data, id: r.id })),
            total: res.total,
          }));
    run
      .then((out) => {
        if (!alive) return;
        setRows(out.rows);
        setTotal(out.total ?? out.rows.length);
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
  }, [entityId, dataSourceId, enabled, querySig, baseFiltersKey, refreshTag]);

  // Aggregates (footer summary toàn bảng) — CHỈ entity-backed. Bám lọc/q (KHÔNG
  // theo trang/sort) để khỏi refetch mỗi lần lật trang.
  const aggKey = aggregates ? JSON.stringify(aggregates) : "";
  const aggFilterSig = JSON.stringify({
    cf: query.columnFilters ?? [],
    g: query.globalFilter ?? "",
  });
  // biome-ignore lint/correctness/useExhaustiveDependencies: bám aggKey/aggFilterSig/baseFiltersKey (chuỗi ổn định) thay object
  useEffect(() => {
    if (!entityId || dataSourceId || !enabled || !aggregates || aggregates.length === 0) {
      setSummary({});
      return;
    }
    let alive = true;
    const filters: LoadFilters = {};
    if (baseFilters) for (const [k, v] of Object.entries(baseFilters)) filters[k] = v;
    for (const cf of query.columnFilters ?? [])
      filters[cf.id] = { op: "contains", value: cf.value };
    api
      .aggregateRecords(entityId, {
        query: {
          filters: Object.keys(filters).length ? filters : undefined,
          q: query.globalFilter,
        },
        aggregates,
      })
      .then((r) => {
        if (alive) setSummary(r);
      })
      .catch(() => {
        if (alive) setSummary({});
      });
    return () => {
      alive = false;
    };
  }, [entityId, dataSourceId, enabled, aggKey, aggFilterSig, baseFiltersKey, refreshTag]);

  return {
    rows,
    fields: dataSourceId ? dsFields : (ent?.fields ?? []),
    total,
    loading,
    err,
    onQueryChange: setQuery,
    refresh: () => setRefreshTag((x) => x + 1),
    summary,
  };
}

/** Kết quả refFill: `overlay` = cột projection (hiển thị-only, đổi theo ref về
 *  sau); `snapshot` = cột base có snapshotFrom (GHI vào pending để đóng băng). */
export interface RefFillResult {
  overlay: Record<string, unknown>;
  snapshot: Record<string, string>;
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
  /** Datasource: đổi field ref → overlay cột projection (Tên VT…) + snapshot. */
  refFill?: (fieldName: string, value: string) => Promise<RefFillResult>;
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
  const pageState = usePageState();

  if (dataSourceId) {
    return {
      rows: ds.rows,
      fields: ds.fields,
      loading: ds.loading,
      err: ds.err,
      isDataSource: true,
      create: (data) => api.createDataSourceRecord(dataSourceId, data).then(() => undefined),
      update: (id, data) =>
        api.updateDataSourceRecord(dataSourceId, id, data).then(() => {
          // Sửa field KHÓA THAM CHIẾU (ref) → các cột JOIN phụ thuộc (vd thông
          // tin vật tư looked-up theo veneer_matchinh) đổi theo → refetch để
          // server RE-RESOLVE join. Field thường không đụng join → khỏi refetch.
          const touchedRef = Object.keys(data).some(
            (k) => ds.fields.find((f) => f.name === k)?.ref,
          );
          if (touchedRef) {
            const key = `__refresh:ds:${dataSourceId}`;
            const tag = (pageState.get(key) as number | undefined) ?? 0;
            pageState.set(key, tag + 1);
          }
        }),
      remove: (id) => api.deleteDataSourceRecord(dataSourceId, id),
      refFill: ds.refFill,
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
            m.fields.map((f) => ({
              id: f.key,
              name: f.key,
              label: f.label,
              type: f.type,
              ref: f.ref,
              refValueField: f.refValueField,
              writable: f.sourceRelationId === "base" && f.writable !== false,
            })),
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

/* ── Date/DateTime trong ô grid ──────────────────────────────────────────
   Giá trị lưu = chuỗi ISO (datetime, vd "2020-03-10T12:41:21Z") hoặc YYYY-MM-DD
   (date). Hiển thị gọn dd/MM/yyyy [HH:mm] theo giờ địa phương; sửa bằng input
   date / datetime-local; lưu lại ISO (datetime) / YYYY-MM-DD (date) để
   validate-on-write chuẩn hoá. Chuỗi KHÔNG parse được → giữ nguyên (không vỡ). */
const pad2 = (n: number) => String(n).padStart(2, "0");
/** Parse an toàn: chuỗi date-only "YYYY-MM-DD" dựng LOCAL (new Date(str) parse
 *  UTC → lệch ±1 ngày ở tz≠0 — bài học #9). Có giờ → parse bình thường. */
function parseDateSafe(v: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(v);
}
function fmtDateCell(v: string, withTime: boolean): string {
  if (!v) return "";
  const d = parseDateSafe(v);
  if (Number.isNaN(d.getTime())) return v;
  const s = `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`;
  return withTime ? `${s} ${pad2(d.getHours())}:${pad2(d.getMinutes())}` : s;
}
function toDateInput(v: string, withTime: boolean): string {
  if (!v) return "";
  const d = parseDateSafe(v);
  if (Number.isNaN(d.getTime())) return "";
  const ymd = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  return withTime ? `${ymd}T${pad2(d.getHours())}:${pad2(d.getMinutes())}` : ymd;
}
function fromDateInput(v: string, withTime: boolean): string {
  if (!v) return "";
  if (!withTime) return v; // date: input đã là YYYY-MM-DD (validate slice 0..10)
  const d = new Date(v); // datetime-local (giờ địa phương) → ISO UTC
  return Number.isNaN(d.getTime()) ? v : d.toISOString();
}

/** Ô sửa inline trong DataGrid: ảnh → <img>; date/datetime → format + picker;
 *  ref → lookup; còn lại text. Double-click ô có quyền ghi để sửa (Enter/blur
 *  lưu, Esc huỷ). Tự quản trạng thái edit cục bộ. */
function EditableCell({
  value,
  isImage,
  canWrite,
  onCommit,
  fieldType,
  refEntityId,
  refValueField,
  getLookupOptions,
}: {
  value: unknown;
  isImage: boolean;
  canWrite: boolean;
  onCommit: (v: string) => void;
  /** Loại field — "lookup"/"multi-lookup" thì ô sửa là dropdown chọn (ref). */
  fieldType?: string;
  /** Lookup theo GIÁ TRỊ field này (vd "nguyenlieu") thay vì record.id. */
  refValueField?: string;
  /** Entity đích của lookup (field.ref): có → chọn bản ghi entity đó. */
  refEntityId?: string;
  /** Lookup KHÔNG có entity đích → trả danh sách giá trị đang có của cột
   *  (faceted) để chọn "theo trường dữ liệu". Gọi lazy lúc vào sửa. */
  getLookupOptions?: () => string[];
}) {
  const [editing, setEditing] = useState(false);
  const str = value == null ? "" : String(value);
  const isDate = fieldType === "date" || fieldType === "datetime";
  const withTime = fieldType === "datetime";
  const isBoolean = fieldType === "boolean" || fieldType === "bool";
  const isNumber = fieldType === "number" || fieldType === "integer";
  const isLookup = fieldType === "lookup" || fieldType === "multi-lookup";
  if (isImage && str.startsWith("data:image/")) {
    return (
      <img
        src={str}
        alt=""
        className="h-6 max-w-[120px] object-contain mx-auto py-0.5"
        loading="lazy"
      />
    );
  }
  // Bool: checkbox bấm thẳng (không cần double-click). stopPropagation để khỏi
  // chọn dòng. Chỉ ghi khi có quyền.
  if (isBoolean) {
    const checked = value === true || str === "true" || str === "1";
    return (
      <span className="flex justify-center" onClick={(e) => e.stopPropagation()}>
        <input
          type="checkbox"
          checked={checked}
          disabled={!canWrite}
          onChange={(e) => onCommit(e.target.checked ? "true" : "false")}
          aria-label="Bật/tắt"
          className="accent-accent w-3.5 h-3.5 cursor-pointer disabled:cursor-default disabled:opacity-60"
        />
      </span>
    );
  }
  if (editing && canWrite) {
    if (isDate) {
      return (
        <input
          type={withTime ? "datetime-local" : "date"}
          defaultValue={toDateInput(str, withTime)}
          className="w-full px-1.5 py-0.5 outline outline-1 outline-accent text-xs bg-white dark:bg-bg"
          // biome-ignore lint/a11y/noAutofocus: con trỏ vào ô vừa double-click sửa
          autoFocus
          onBlur={(e) => {
            onCommit(fromDateInput(e.target.value, withTime));
            setEditing(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            if (e.key === "Escape") setEditing(false);
          }}
        />
      );
    }
    // Cột ref (nguyên liệu/veneer/UV/FSC…): mở thẳng ô chọn lookup. Có entity
    // đích → LookupPicker; không có (lookup "theo trường") → SearchableSelect
    // từ giá trị faceted của cột. autoOpen = nhấp đúp mở luôn; onClose = thoát.
    if (isLookup && refEntityId) {
      return (
        <LookupPicker
          refEntityId={refEntityId}
          value={str}
          valueField={refValueField}
          multi={fieldType === "multi-lookup"}
          className="w-full"
          autoOpen
          onClose={() => setEditing(false)}
          onChange={(v) => {
            onCommit(v);
            setEditing(false);
          }}
        />
      );
    }
    if (isLookup && getLookupOptions) {
      return (
        <SearchableSelect
          className="w-full"
          value={str}
          options={getLookupOptions().map((o) => ({ value: o, label: o }))}
          emptyOption="— chọn —"
          autoOpen
          onClose={() => setEditing(false)}
          onChange={(v) => {
            onCommit(v);
            setEditing(false);
          }}
        />
      );
    }
    return (
      <input
        type={isNumber ? "number" : "text"}
        inputMode={isNumber ? "decimal" : undefined}
        defaultValue={str}
        className="w-full px-1.5 py-0.5 outline outline-1 outline-accent text-xs bg-white dark:bg-bg"
        // biome-ignore lint/a11y/noAutofocus: con trỏ vào ô vừa double-click sửa
        autoFocus
        onBlur={(e) => {
          onCommit(e.target.value);
          setEditing(false);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") setEditing(false);
        }}
      />
    );
  }
  return (
    <span
      // Marker để autofit (nhắp đúp viền cột) đo bề rộng CHỮ thật trong ô. Span
      // "block truncate" rộng đầy ô → nếu đo cả span sẽ ra đúng bề rộng HIỆN TẠI
      // (không co theo nội dung); DataGrid.measureCol ưu tiên đo node con này.
      data-col-content=""
      onDoubleClick={canWrite ? () => setEditing(true) : undefined}
      title={canWrite ? "Nhấn đúp để sửa" : "Không có quyền sửa cột này"}
      className={cn(
        // min-h: ô RỖNG vẫn phải có vùng cao để nhấp đúp. Span "block" rỗng cao
        // 0 → nhấp đúp trúng padding <td> (không có onDoubleClick) chứ không trúng
        // span → tưởng "không sửa được". Cho min-h = 1 dòng để luôn bấm trúng.
        "block truncate min-h-[1.25rem]",
        isNumber && "text-right tabular-nums",
        canWrite ? "cursor-text" : "opacity-70",
      )}
    >
      {isDate ? fmtDateCell(str, withTime) : str}
    </span>
  );
}

// ─── Batch-save dùng chung (client + server-paged) ───────────────────────────
type RowErr = { id: string; label: string; msg: string };
/** Khả năng bulk + dry-run validate — CHỈ entity-backed (datasource không có).
 *  Có thì "Lưu tất cả" đi đường: validate → confirm kèm kết quả → gom dòng cùng
 *  changeset → bulkUpdate/nhóm. */
interface BatchOps {
  validate: (
    items: Array<{ id: string; changes: Record<string, unknown> }>,
  ) => Promise<Array<{ id: string; ok: boolean; error?: string }>>;
  bulkUpdate: (
    ids: string[],
    patch: Record<string, unknown>,
  ) => Promise<{ updated: number; errors: Array<{ id: string; message: string }> }>;
}
/** Lưu hàng loạt pending. batchOps (entity): dry-run validate → confirm kèm kết
 *  quả → gom dòng cùng changeset y hệt → 1 bulkUpdate/nhóm. Else (datasource):
 *  confirm phạm vi → lưu tuần tự. Luôn GIỮ dòng lỗi để thử lại. */
async function runBatchSave(
  pending: Map<string, Record<string, string>>,
  rowLabel: (id: string) => string,
  ops: {
    batchOps?: BatchOps;
    onSaveRow: (id: unknown, changes: Record<string, unknown>) => Promise<void>;
  },
  t: (k: string, p?: Record<string, string | number>) => string,
): Promise<{ failed: Map<string, Record<string, string>>; errs: RowErr[]; cancelled: boolean }> {
  const entries = [...pending];
  const failed = new Map<string, Record<string, string>>();
  const errs: RowErr[] = [];
  if (ops.batchOps) {
    let results: Array<{ id: string; ok: boolean; error?: string }>;
    try {
      results = await ops.batchOps.validate(entries.map(([id, changes]) => ({ id, changes })));
    } catch (e) {
      return {
        failed: pending,
        errs: [{ id: "_", label: "", msg: (e as Error).message }],
        cancelled: false,
      };
    }
    const okIds = new Set(results.filter((r) => r.ok).map((r) => r.id));
    const invalid = results.filter((r) => !r.ok);
    const proceed = await dialog.confirm(
      invalid.length
        ? t("widget.bulk_confirm_bad", { ok: okIds.size, bad: invalid.length })
        : t("widget.bulk_confirm_ok", { ok: okIds.size }),
      { title: t("widget.bulk_title"), danger: invalid.length > 0 },
    );
    if (!proceed) return { failed: pending, errs: [], cancelled: true };
    for (const v of invalid) {
      failed.set(v.id, pending.get(v.id) ?? {});
      errs.push({ id: v.id, label: rowLabel(v.id), msg: v.error ?? t("widget.invalid") });
    }
    // Gom dòng hợp lệ theo changeset y hệt → 1 bulk/nhóm (lợi khi mass-set cùng giá trị).
    const groups = new Map<string, { patch: Record<string, string>; ids: string[] }>();
    for (const [id, changes] of entries) {
      if (!okIds.has(id)) continue;
      const sig = JSON.stringify(changes);
      const g = groups.get(sig) ?? { patch: changes, ids: [] };
      g.ids.push(id);
      groups.set(sig, g);
    }
    for (const g of groups.values()) {
      try {
        const r = await ops.batchOps.bulkUpdate(g.ids, g.patch);
        for (const e of r.errors ?? []) {
          failed.set(e.id, pending.get(e.id) ?? {});
          errs.push({ id: e.id, label: rowLabel(e.id), msg: e.message });
        }
      } catch (e) {
        for (const id of g.ids) {
          failed.set(id, pending.get(id) ?? {});
          errs.push({ id, label: rowLabel(id), msg: (e as Error).message });
        }
      }
    }
    return { failed, errs, cancelled: false };
  }
  // Datasource: confirm phạm vi → lưu tuần tự.
  const proceed = await dialog.confirm(t("widget.bulk_confirm_seq", { n: entries.length }), {
    title: t("widget.bulk_title"),
  });
  if (!proceed) return { failed: pending, errs: [], cancelled: true };
  for (const [id, changes] of entries) {
    try {
      await ops.onSaveRow(id, changes);
    } catch (e) {
      failed.set(id, changes);
      errs.push({ id, label: rowLabel(id), msg: (e as Error).message });
    }
  }
  return { failed, errs, cancelled: false };
}

/** Nút ✕ "Bỏ dòng mới này" — gỡ 1 dòng MỚI nháp (chưa lưu). Dùng trong cột hành
 *  động (khi lưới có) hoặc cột ✕ riêng (khi không có cột hành động). */
function RemoveNewRowButton({ onRemove }: { onRemove: () => void }) {
  return (
    <button
      type="button"
      title="Bỏ dòng mới này"
      onClick={(e) => {
        e.stopPropagation();
        onRemove();
      }}
      className="flex items-center justify-center w-5 h-5 rounded text-danger hover:bg-danger/10"
    >
      <I.X size={12} />
    </button>
  );
}

// ─── EditableListWidget — bảng chỉnh sửa inline (qua DataGrid xịn) ────────────

interface EditableListWidgetProps {
  ent: ReturnType<typeof useEntity>;
  title?: string;
  loading: boolean;
  err: string;
  filteredRows: Record<string, unknown>[];
  visibleFields: EntityField[];
  /** Override nhãn header theo cột (field name → nhãn). Ưu tiên hơn label entity. */
  columnLabels?: Record<string, string>;
  batchEdit: boolean;
  onSave: (rowId: unknown, changes: Record<string, unknown>) => Promise<void>;
  /** Bulk + dry-run validate (entity-backed) — ListWidget truyền khi không phải
   *  datasource. Có thì "Lưu tất cả" dùng validate→confirm→bulk thay tuần tự. */
  batchOps?: BatchOps;
  /** Chọn dòng (selectionStateKey) — click row set page-state, nút header
   *  (Xem chi tiết...) đọc theo. Double-click cell vẫn là sửa inline. */
  onRowClick?: (row: Record<string, unknown>) => void;
  isRowSelected?: (row: Record<string, unknown>) => boolean;
  /** Nhóm tiêu đề cột (banded header nhiều cấp). */
  columnGroups?: ColumnGroupNode[];
  /** Tạo dòng mới hàng loạt (dán). Có → bật chế độ thêm mới ở PasteGridModal. */
  onBulkCreate?: (records: Array<Record<string, string>>) => Promise<void>;
  /** Field cố định cho dòng tạo mới (vd masp = sản phẩm đang lọc). */
  createDefaults?: Record<string, string>;
  /** Khoá lưu trạng thái (IndexedDB) — dùng làm key nháp pending khi batchEdit. */
  stateKey?: string;
  /** Cột hành động theo dòng (Xem/Sửa/Xoá…) — render ActionWidget cho từng dòng. */
  rowActions?: ActionConfig[];
  /** Bật chọn dòng (checkbox) — bật trong cài đặt list (mặc định ẩn). */
  selectable?: boolean;
  /** Key các nút bị ẩn trên popover hành động (cài đặt list). */
  rowActionsHidden?: string[];
  /** Kiểu cột hành động: "popover" (nút ⋯, mặc định) | "inline" (nút Xem/Sửa/Xoá). */
  rowActionsStyle?: "inline" | "popover";
  /** Datasource: đổi field ref → overlay cột projection (Tên VT…) từ master. */
  refFill?: (fieldName: string, value: string) => Promise<RefFillResult>;
  /** Bật DÒNG "＋ Thêm dòng mới" trong lưới (cfg.addRowAtEnd). Chỉ tác dụng khi
   *  batchEdit + onBulkCreate (mới có onAddRow). */
  addRowAtEnd?: boolean;
  /** Vị trí dòng thêm mới: đầu hay cuối lưới (cfg.addRowPos, mặc định "bottom"). */
  addRowPos?: "top" | "bottom";
}

/** Dòng MỚI nháp (chưa lưu): id tạm (`__new_*`) + vị trí chèn trên/dưới lưới.
 *  Giá trị ô của dòng mới nằm trong `pending` theo id tạm này. */
type NewRowDraft = { id: string; pos: "top" | "bottom" };

/** Overlay sửa-ô `pending` + dòng MỚI nháp `newRows`. Ở chế độ batchEdit TỰ LƯU
 *  NHÁP vào IndexedDB sau mỗi đổi → reload không mất trạng thái đang sửa/thêm;
 *  "Lưu tất cả" mới ghi DB (+ tạo dòng mới) rồi xoá nháp. enabled=false
 *  (tự-lưu-ngay) → KHÔNG persist. */
function usePersistedDraft(draftKey: string | undefined, enabled: boolean) {
  const [pending, setPending] = useState<Map<string, Record<string, string>>>(new Map());
  const [newRows, setNewRows] = useState<NewRowDraft[]>([]);
  const restored = useRef(false);
  // Nạp nháp MỘT lần khi mount — chỉ bật cờ persist SAU khi idbGet xong để
  // hiệu ứng ghi không đè nháp cũ bằng giá trị rỗng ban đầu.
  useEffect(() => {
    if (!enabled || !draftKey) {
      restored.current = true;
      return;
    }
    let alive = true;
    type Saved =
      | Array<[string, Record<string, string>]>
      | { pending?: Array<[string, Record<string, string>]>; newRows?: NewRowDraft[] };
    idbGet<Saved>(draftKey).then((saved) => {
      if (alive && saved) {
        // Tương thích cả format cũ (mảng entries) lẫn mới ({pending,newRows}).
        const p = Array.isArray(saved) ? saved : saved.pending;
        if (Array.isArray(p) && p.length > 0) setPending(new Map(p));
        const nr = Array.isArray(saved) ? null : saved.newRows;
        if (Array.isArray(nr) && nr.length > 0) setNewRows(nr);
      }
      restored.current = true;
    });
    return () => {
      alive = false;
    };
  }, [draftKey, enabled]);
  // Ghi nháp mỗi khi pending/newRows đổi (sau khi đã nạp + đang bật batchEdit).
  useEffect(() => {
    if (!enabled || !draftKey || !restored.current) return;
    void idbSet(draftKey, { pending: [...pending], newRows });
  }, [pending, newRows, draftKey, enabled]);
  return { pending, setPending, newRows, setNewRows };
}

function EditableListWidget({
  ent,
  title,
  loading,
  err,
  filteredRows,
  visibleFields,
  columnLabels,
  batchEdit,
  onSave,
  batchOps,
  onRowClick,
  isRowSelected,
  columnGroups,
  onBulkCreate,
  createDefaults,
  stateKey,
  rowActions,
  selectable,
  rowActionsHidden,
  rowActionsStyle,
  refFill,
  addRowAtEnd,
  addRowPos,
}: EditableListWidgetProps) {
  const t = useT();
  const pageState = usePageState();
  // Field-level RBAC cho inline edit — role + nhóm của user hiện tại.
  const rbacRole = useRbac((s) => s.role);
  const myGroupIds = useUserObjects((s) => s.myGroupIds);
  const { pending, setPending, newRows, setNewRows } = usePersistedDraft(
    stateKey ? `${stateKey}:editdraft` : undefined,
    !!batchEdit,
  );
  // Overlay HIỂN THỊ-ONLY cho cột projection (Tên VT…) khi đổi field ref —
  // KHÔNG đi vào `pending` (tránh ghi cột join read-only lên server).
  const [refOverlay, setRefOverlay] = useState<Map<string, Record<string, unknown>>>(new Map());
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState("");
  // Lỗi theo TỪNG dòng sau "Lưu tất cả" — [{ id, label, msg }].
  const [rowErrs, setRowErrs] = useState<Array<{ id: string; label: string; msg: string }>>([]);

  // Guard "pending chưa lưu": batchEdit còn ô sửa chưa lưu → chặn điều hướng
  // trong app (confirm) + reload/đóng tab (native prompt).
  const hasUnsaved = !!batchEdit && (pending.size > 0 || newRows.length > 0);
  useBlocker({
    shouldBlockFn: async () => {
      if (!hasUnsaved) return false;
      const leave = await dialog.confirm(t("widget.unsaved_leave", { count: pending.size }), {
        title: t("widget.unsaved_title"),
        danger: true,
      });
      return !leave;
    },
    enableBeforeUnload: () => hasUnsaved,
  });
  // Nhãn dòng để báo lỗi — giá trị field hiển thị đầu, else id rút gọn.
  const rowLabel = (rowId: string): string => {
    const r = filteredRows.find((x) => String(x.id) === rowId);
    const first = visibleFields[0]?.name;
    const v = r && first ? r[first] : undefined;
    return v != null && String(v).trim() ? String(v) : `#${rowId.slice(0, 8)}`;
  };

  // Lưu 1 ô: batch → gom pending; ngược lại lưu ngay. Pending cũng là overlay
  // hiển thị (ô vừa sửa thấy giá trị mới ngay, không chờ refetch). Ref để cell
  // renderer (trong columns memo) luôn gọi bản mới nhất mà không rebuild cột.
  const saveRef = useRef<(rowId: unknown, field: string, value: string) => void>(() => {});
  saveRef.current = (rowId, field, value) => {
    if (rowId == null) return;
    const rowIdStr = String(rowId);
    setPending((prev) => {
      const next = new Map(prev);
      next.set(rowIdStr, { ...(next.get(rowIdStr) ?? {}), [field]: value });
      return next;
    });
    // Đổi field REF (mã vật tư…) → auto điền cột projection (Tên VT, Quy cách…)
    // từ record master vừa chọn — hiện NGAY (overlay), không chờ server re-join.
    if (refFill && visibleFields.find((f) => f.name === field)?.ref) {
      void refFill(field, value).then(({ overlay, snapshot }) => {
        if (Object.keys(overlay).length > 0) {
          setRefOverlay((prev) => {
            const next = new Map(prev);
            next.set(rowIdStr, { ...(next.get(rowIdStr) ?? {}), ...overlay });
            return next;
          });
        }
        // NHẬT KÝ: cột base có snapshotFrom → ghi VÀO pending (sẽ LƯU) để đóng
        // băng giá trị ref tại thời điểm chọn. Non-batch lưu ngay như ô thường.
        if (Object.keys(snapshot).length > 0) {
          setPending((prev) => {
            const next = new Map(prev);
            next.set(rowIdStr, { ...(next.get(rowIdStr) ?? {}), ...snapshot });
            return next;
          });
          if (!batchEdit) {
            void onSave(rowId, snapshot).catch((e) => setSaveErr((e as Error).message));
          }
        }
      });
    }
    if (!batchEdit) {
      void onSave(rowId, { [field]: value }).catch((e) => setSaveErr((e as Error).message));
    }
  };

  // ── Thêm dòng MỚI (nháp) vào lưới — lên đầu / xuống cuối. Giá trị ô của dòng
  //    mới gom chung `pending` theo id tạm (`__new_*`); "Lưu tất cả" mới tạo
  //    record. id tạm = thời điểm + seq → không trùng UUID dòng thật. ──────────
  const newRowSeq = useRef(0);
  // Sau khi thêm dòng → báo DataGrid lật tới trang đầu/cuối để THẤY dòng mới
  // (tránh dòng mới nằm trang khác do phân trang).
  const [pageJump, setPageJump] = useState<{ token: number; to: "first" | "last" }>();
  const addRow = (pos: "top" | "bottom") => {
    const seq = newRowSeq.current++;
    setNewRows((prev) => [...prev, { id: `__new_${Date.now()}_${seq}`, pos }]);
    setPageJump({ token: seq, to: pos === "top" ? "first" : "last" });
  };
  const removeRowRef = useRef<(id: string) => void>(() => {});
  removeRowRef.current = (id) => {
    setNewRows((prev) => prev.filter((r) => r.id !== id));
    setPending((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
    setRefOverlay((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
  };

  // Data hiển thị = dòng mới nháp (đầu) + filteredRows + overlay pending + dòng
  // mới nháp (cuối). Dòng mới đánh dấu __isNew để DataGrid tô nền + cho phép xoá.
  const displayData = useMemo(() => {
    const hasOverlay = pending.size > 0 || refOverlay.size > 0;
    const base = !hasOverlay
      ? filteredRows
      : filteredRows.map((row) => {
          const id = String(row.id);
          const p = pending.get(id);
          const o = refOverlay.get(id);
          return p || o ? { ...row, ...o, ...p } : row;
        });
    if (newRows.length === 0) return base;
    const synth = (r: NewRowDraft) => ({
      ...createDefaults,
      ...(refOverlay.get(r.id) ?? {}),
      ...(pending.get(r.id) ?? {}),
      id: r.id,
      __isNew: true,
    });
    const top = newRows.filter((r) => r.pos === "top").map(synth);
    const bottom = newRows.filter((r) => r.pos === "bottom").map(synth);
    return [...top, ...base, ...bottom];
  }, [filteredRows, pending, refOverlay, newRows, createDefaults]);

  // Tập id dòng có thay đổi pending — truyền xuống DataGrid để tô màu.
  const changedRowIdsEdit = useMemo(() => new Set(pending.keys()), [pending]);

  // Dán dữ liệu (PasteGridModal) → cập nhật nhiều dòng: overlay pending (hiện
  // ngay) + lưu từng dòng (gom field). Lỗi 1 dòng không chặn dòng khác.
  const applyPaste = async (updates: Array<{ rowId: string; changes: Record<string, string> }>) => {
    if (!updates.length) return;
    setPending((prev) => {
      const next = new Map(prev);
      for (const u of updates) next.set(u.rowId, { ...(next.get(u.rowId) ?? {}), ...u.changes });
      return next;
    });
    for (const u of updates) {
      await onSave(u.rowId, u.changes).catch((e) => setSaveErr((e as Error).message));
    }
  };

  // Cột TanStack: cell = ô sửa inline. Cột số → summary=sum (footer tổng hợp).
  const columns = useMemo<ColumnDef<Record<string, unknown>>[]>(() => {
    const cols: ColumnDef<Record<string, unknown>>[] = visibleFields.map((f) => ({
      id: f.name,
      accessorKey: f.name,
      header: columnLabels?.[f.name] ?? f.label,
      enableGrouping: true,
      meta: {
        techName: f.name,
        ...(f.type === "number" || f.type === "integer" || f.type === "currency"
          ? { summary: "sum" as const }
          : { noSummary: true }),
      },
      cell: (ctx) => {
        const row = ctx.row.original as Record<string, unknown> & { id?: unknown };
        if (f.type === "drawing_page") {
          return (
            <DrawingPageCell
              masp={String(row.masp ?? "")}
              detail={{
                mact: String(row.mact ?? ""),
                chitiet: String(row.chitiet ?? ""),
                dims: [row.dayy_tc, row.rong_tc, row.dai_tc].map((v) => v as string | number),
              }}
              page={String(ctx.getValue() ?? "")}
              canWrite={fieldCan(rbacRole, "write", f, myGroupIds)}
              onCommit={(v) => saveRef.current(row.id, f.name, v)}
            />
          );
        }
        return (
          <EditableCell
            value={ctx.getValue()}
            isImage={f.type === "image"}
            canWrite={fieldCan(rbacRole, "write", f, myGroupIds)}
            onCommit={(v) => saveRef.current(row.id, f.name, v)}
            fieldType={f.type}
            refEntityId={(f as { ref?: string }).ref}
            refValueField={(f as { refValueField?: string }).refValueField}
            getLookupOptions={() =>
              Array.from(ctx.column.getFacetedUniqueValues().keys())
                .filter((v) => v != null && String(v).trim() !== "")
                .map((v) => String(v))
                .sort((a, b) => a.localeCompare(b))
                .slice(0, 500)
            }
          />
        );
      },
    }));
    // Cột ✕ RIÊNG để bỏ dòng MỚI nháp — CHỈ khi lưới KHÔNG có cột hành động.
    // Có cột hành động (__rowacts__) → ✕ nằm TRONG cột đó (cell __isNew bên dưới).
    const hasActionCol = !!(rowActions && rowActions.length > 0);
    if (newRows.length > 0 && !hasActionCol) {
      cols.unshift({
        id: "__rmnew",
        header: "",
        enableGrouping: false,
        enableSorting: false,
        size: 32,
        cell: (ctx) => {
          const row = ctx.row.original as { id?: unknown; __isNew?: boolean };
          if (!row.__isNew) return null;
          return <RemoveNewRowButton onRemove={() => removeRowRef.current(String(row.id))} />;
        },
      });
    }
    // Cột "Hành động" (Xem/Sửa/Xoá) — render ActionWidget cho từng dòng đã lưu
    // (dòng MỚI chưa có id → bỏ qua). Đặt đầu lưới.
    if (rowActions && rowActions.length > 0) {
      // Mặc định INLINE (Xem/Sửa/Xoá thẳng dòng); chỉ "popover" khi đặt rõ.
      const inline = rowActionsStyle !== "popover";
      cols.unshift({
        id: "__rowacts__",
        // Tiêu đề gọn: icon ⋯ (không chiếm chỗ như chữ "Hành động").
        header: () => (
          <span title="Hành động">
            <I.MoreHorizontal size={13} className="text-muted/70" />
          </span>
        ),
        enableGrouping: false,
        enableSorting: false,
        meta: { compact: true, label: "Hành động" }, // gọn + nhãn ở "Chọn cột hiển thị"
        // PHẢI có size số (kể cả inline) → cột được GHIM (resize kéo nhỏ/rộng được +
        // không tự giãn theo nội dung). size undefined = table-auto, không kéo được.
        // Mặc định inline tính theo số nút; người dùng kéo đổi, width được nhớ.
        size: inline ? Math.min(48 + rowActions.length * 40, 240) : 28,
        // Sàn hẹp: cột compact tự co theo NÚT (autofit COMPACT_CLAMP ~24-30px) —
        // minSize cao sẽ kẹp ngược lại làm cột rộng hơn tổng bề rộng các nút.
        minSize: 24,
        cell: (ctx) => {
          const row = ctx.row.original as Record<string, unknown> & {
            id?: unknown;
            __isNew?: boolean;
          };
          // Dòng MỚI nháp → nút ✕ bỏ dòng ngay TRONG cột hành động (thay cho
          // Xem/Sửa/Xoá của dòng đã lưu).
          if (row.__isNew)
            return (
              <div className="flex items-center w-fit" onClick={(e) => e.stopPropagation()}>
                <RemoveNewRowButton onRemove={() => removeRowRef.current(String(row.id))} />
              </div>
            );
          // bindRowIdToAction nhận row (hỗ trợ recordIdField — bind theo field
          // nghiệp vụ thay vì id uuid).
          const bound = rowActions.map((a) => bindRowIdToAction(a, row));
          if (inline) {
            return (
              // w-fit: co sát các nút (flex thường là block → giãn đầy ô, khiến
              // autofit đo ra bề rộng Ô thay vì bề rộng NÚT). data-col-content:
              // mốc để measureCol đo đúng cụm nút → cột bám sát tổng các nút.
              <div
                data-col-content=""
                className="flex items-center gap-0.5 w-fit"
                onClick={(e) => e.stopPropagation()}
              >
                {bound.map((a) => (
                  <ActionWidget key={a.label} config={a} pageState={pageState} inline compact />
                ))}
              </div>
            );
          }
          return (
            <RowActionsCell
              actions={bound}
              pageState={pageState}
              row={row}
              cols={visibleFields.map((f) => ({
                key: f.name,
                label: columnLabels?.[f.name] ?? f.label ?? f.name,
              }))}
              title={title}
              hidden={rowActionsHidden}
            />
          );
        },
      });
    }
    return cols;
  }, [
    visibleFields,
    columnLabels,
    rbacRole,
    myGroupIds,
    newRows.length,
    rowActions,
    pageState,
    title,
    rowActionsHidden,
    rowActionsStyle,
  ]);

  const saveAll = async () => {
    setSaving(true);
    setSaveErr("");
    setRowErrs([]);
    // Tách: dòng MỚI (tạo qua onBulkCreate) vs ô sửa dòng cũ (update batch).
    const newIds = new Set(newRows.map((r) => r.id));
    const updates = new Map([...pending].filter(([id]) => !newIds.has(id)));
    const creates = newRows
      .map((r) => ({ ...createDefaults, ...(pending.get(r.id) ?? {}) }))
      .filter((rec) => Object.keys(rec).length > 0);
    if (creates.length > 0) {
      if (!onBulkCreate) {
        setSaveErr("Lưới này chưa hỗ trợ tạo dòng mới.");
        setSaving(false);
        return;
      }
      try {
        await onBulkCreate(creates);
      } catch (e) {
        // Tạo lỗi → GIỮ nháp dòng mới để user sửa lại, không mất.
        setSaveErr((e as Error).message);
        setSaving(false);
        return;
      }
      // Tạo xong → bỏ nháp dòng mới + pending + overlay của chúng.
      setNewRows([]);
      setPending((prev) => {
        const next = new Map(prev);
        for (const id of newIds) next.delete(id);
        return next;
      });
      setRefOverlay((prev) => {
        const next = new Map(prev);
        for (const id of newIds) next.delete(id);
        return next;
      });
    }
    const { failed, errs, cancelled } = await runBatchSave(
      updates,
      rowLabel,
      { batchOps, onSaveRow: onSave },
      t,
    );
    if (!cancelled) {
      setPending(failed);
      setRowErrs(errs);
      // Dòng lưu THÀNH CÔNG → bỏ overlay (refetch server mang giá trị join đúng);
      // giữ overlay cho dòng còn lỗi (pending của chúng còn).
      setRefOverlay((prev) => new Map([...prev].filter(([id]) => failed.has(id))));
    }
    setSaving(false);
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
      {batchEdit &&
        (pending.size > 0 || newRows.length > 0) &&
        (() => {
          // Đếm tách: dòng MỚI (nháp) vs dòng cũ có ô sửa (pending không tính dòng mới).
          const newIdSet = new Set(newRows.map((r) => r.id));
          const editCount = [...pending.keys()].filter((id) => !newIdSet.has(id)).length;
          const parts: string[] = [];
          if (newRows.length > 0) parts.push(`${newRows.length} dòng mới`);
          if (editCount > 0) parts.push(`${editCount} dòng sửa`);
          return (
            <div className="flex items-center gap-2 px-3 py-1.5 bg-warning/10 border-b border-warning/30 shrink-0">
              <I.AlertCircle size={12} className="text-warning shrink-0" />
              <span className="text-xs text-warning shrink-0">{parts.join(" · ")} chưa lưu</span>
              {/* Lỗi theo từng dòng — nhãn + tooltip; dòng lỗi giữ lại để thử lại. */}
              {rowErrs.length > 0 ? (
                <span
                  className="text-xs text-danger flex-1 truncate"
                  title={rowErrs.map((r) => `${r.label}: ${r.msg}`).join("\n")}
                >
                  ⚠ {rowErrs.length} dòng lỗi:{" "}
                  {rowErrs
                    .slice(0, 3)
                    .map((r) => r.label)
                    .join(", ")}
                  {rowErrs.length > 3 ? "…" : ""}
                </span>
              ) : (
                <span className="flex-1" />
              )}
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
                  setNewRows([]);
                  setRowErrs([]);
                }}
                className="px-2.5 py-0.5 rounded text-xs border border-border hover:bg-hover"
              >
                {t("common.cancel")}
              </button>
            </div>
          );
        })()}
      {!batchEdit && saveErr && (
        <div className="px-3 py-1 text-xs text-danger border-b border-danger/30 shrink-0">
          {saveErr}
        </div>
      )}
      {err ? (
        <div className="p-3 text-xs text-danger">{t("widget.error_load", { err })}</div>
      ) : (
        <div className="flex-1 min-h-0">
          {/* Lưới đầy đủ chức năng (sort/filter/group/summary/export/resize/
              reorder/chooser) — ô sửa inline qua EditableCell trong column.cell. */}
          <DataGrid
            columns={columns}
            columnGroups={columnGroups}
            data={displayData}
            emptyText={t("widget.empty_records")}
            label={title}
            onRowClick={onRowClick}
            isRowSelected={isRowSelected}
            onPasteApply={applyPaste}
            onPasteCreate={onBulkCreate}
            pasteCreateDefaults={createDefaults}
            onAddRow={batchEdit && onBulkCreate ? addRow : undefined}
            inlineAddRow={addRowAtEnd}
            addRowPos={addRowPos}
            pageJump={pageJump}
            enableSelection={selectable}
            changedRowIds={changedRowIdsEdit}
          />
        </div>
      )}
    </div>
  );
}

/* ─── ServerPagedListWidget — danh sách bảng LỚN, phân trang/sắp/lọc SERVER-SIDE.
   KHÔNG kéo cả cửa sổ về client: mỗi trang là 1 round-trip → sort/lọc/đếm phản
   ánh TOÀN BẢNG (không chỉ window). Hỗ trợ sửa ô inline (ghi về entity/
   datasource, overlay pending xuyên trang theo id). Không có filter-tree/
   master-detail client (cần toàn bộ dòng) — dùng loadFilters (server-side) +
   lọc-cột contains thay thế. ── */
function ServerPagedListWidget({
  entityId,
  dataSourceId,
  stateKey,
  fields,
  columnLabels,
  title,
  pageSize,
  loadFilters,
  loadGate,
  selectionStateKey,
  multiSelect,
  editable,
  batchEdit,
  columnGroups,
  selectable,
}: {
  entityId?: string;
  dataSourceId?: string;
  stateKey?: string;
  fields?: string[];
  columnLabels?: Record<string, string>;
  title?: string;
  pageSize?: number;
  loadFilters?: LoadFilters;
  loadGate?: string;
  selectionStateKey?: string;
  multiSelect?: boolean;
  editable?: boolean;
  batchEdit?: boolean;
  /** Nhóm tiêu đề cột (banded header nhiều cấp). */
  columnGroups?: ColumnGroupNode[];
  /** Bật chọn dòng (checkbox). */
  selectable?: boolean;
}) {
  const t = useT();
  const ent = useEntity(entityId);
  const pageState = usePageState();
  const rbacRole = useRbac((s) => s.role);
  const myGroupIds = useUserObjects((s) => s.myGroupIds);

  // Cổng tải (loadGate): chỉ fetch khi state có giá trị.
  const gateKey = loadGate?.trim();
  const gateVal = gateKey ? pageState.get(gateKey) : undefined;
  const enabled =
    !gateKey ||
    !(
      gateVal === undefined ||
      gateVal === null ||
      gateVal === "" ||
      (Array.isArray(gateVal) && gateVal.length === 0)
    );
  const ps = pageSize && pageSize > 0 ? pageSize : 50;

  // Cột số hiển thị → aggregates (footer summary toàn bảng). CHỈ entity-backed
  // (datasource chưa hỗ trợ aggregate server-side). Tính từ ent.fields (có sẵn
  // trước hook) để truyền vào hook.
  const fieldsKey = fields ? fields.join(",") : "";
  // biome-ignore lint/correctness/useExhaustiveDependencies: bám fieldsKey thay mảng fields
  const aggregates = useMemo<AggSpec[]>(() => {
    if (dataSourceId || !ent) return [];
    const all = ent.fields ?? [];
    const vis =
      fields && fields.length > 0
        ? (fields.map((n) => all.find((f) => f.name === n)).filter(Boolean) as EntityField[])
        : all.filter((f) => f.defaultVisible !== false);
    return vis
      .filter((f) => f.type === "number" || f.type === "integer")
      .map((f) => ({ field: f.name, fn: "sum" }));
  }, [ent, dataSourceId, fieldsKey]);

  const {
    rows,
    fields: dataFields,
    total,
    loading,
    err,
    onQueryChange,
    refresh,
    summary,
  } = useServerPagedRecords({
    entityId,
    dataSourceId,
    baseFilters: loadFilters,
    pageSize: ps,
    enabled,
    aggregates,
  });

  const allFields = dataSourceId ? dataFields : (ent?.fields ?? []);
  const visibleFields =
    fields && fields.length > 0
      ? (fields.map((n) => allFields.find((f) => f.name === n)).filter(Boolean) as EntityField[])
      : allFields.filter((f) => f.defaultVisible !== false);

  // Map summary (field→số) → controller.summary (colId→{type,value}) cho footer.
  const serverSummary = useMemo(() => {
    const out: Record<string, { type: "sum"; value: number }> = {};
    for (const a of aggregates) {
      const v = summary[a.field];
      if (v !== undefined) out[a.field] = { type: "sum", value: v };
    }
    return out;
  }, [aggregates, summary]);

  // ── Inline-edit (chỉ khi editable): pending overlay + ghi về server. ──
  const { pending, setPending } = usePersistedDraft(
    stateKey ? `${stateKey}:editdraft` : undefined,
    !!batchEdit,
  );
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState("");
  // Lỗi theo TỪNG dòng sau "Lưu tất cả" — [{ id, label, msg }].
  const [rowErrs, setRowErrs] = useState<Array<{ id: string; label: string; msg: string }>>([]);

  // Guard "pending chưa lưu": batchEdit còn ô sửa chưa lưu → chặn điều hướng
  // TRONG app (confirm dialog) + reload/đóng tab (native prompt). Chống mất edit
  // dồn qua nhiều trang server. (Lật trang server KHÔNG mất — pending sống xuyên
  // trang vì component không unmount.)
  const hasUnsaved = !!batchEdit && pending.size > 0;
  useBlocker({
    shouldBlockFn: async () => {
      if (!hasUnsaved) return false;
      const leave = await dialog.confirm(t("widget.unsaved_leave", { count: pending.size }), {
        title: t("widget.unsaved_title"),
        danger: true,
      });
      return !leave; // chặn nếu user chọn ở lại
    },
    enableBeforeUnload: () => hasUnsaved,
  });

  const writeRecord = (rowId: unknown, changes: Record<string, unknown>) =>
    dataSourceId
      ? api.updateDataSourceRecord(dataSourceId, String(rowId), changes).then(() => undefined)
      : api.updateRecord(String(rowId), changes).then(() => undefined);
  // Bulk + dry-run validate — chỉ entity-backed (datasource ghi từng dòng).
  const batchOps: BatchOps | undefined =
    !dataSourceId && entityId
      ? {
          validate: (items) => api.bulkValidateRecords(entityId, items).then((r) => r.results),
          bulkUpdate: (ids, patch) => api.bulkUpdateRecords(entityId, ids, patch),
        }
      : undefined;
  // Nhãn dòng để báo lỗi — lấy giá trị field hiển thị đầu tiên (nếu dòng đang
  // ở trang hiện tại), else id rút gọn (dòng đã sửa ở trang khác).
  const rowLabel = (rowId: string): string => {
    const r = rows.find((x) => String(x.id) === rowId);
    const first = visibleFields[0]?.name;
    const v = r && first ? r[first] : undefined;
    return v != null && String(v).trim() ? String(v) : `#${rowId.slice(0, 8)}`;
  };
  // saveRef: cell renderer (trong columns memo) luôn gọi bản mới nhất mà không
  // rebuild cột mỗi lần pending đổi.
  const saveRef = useRef<(rowId: unknown, field: string, value: string) => void>(() => {});
  saveRef.current = (rowId, field, value) => {
    if (rowId == null) return;
    const rowIdStr = String(rowId);
    setPending((prev) => {
      const next = new Map(prev);
      next.set(rowIdStr, { ...(next.get(rowIdStr) ?? {}), [field]: value });
      return next;
    });
    if (!batchEdit) {
      void writeRecord(rowId, { [field]: value })
        .then(() => refresh())
        .catch((e) => setSaveErr((e as Error).message));
    }
  };
  const saveAll = async () => {
    setSaving(true);
    setSaveErr("");
    setRowErrs([]);
    const { failed, errs, cancelled } = await runBatchSave(
      pending,
      rowLabel,
      { batchOps, onSaveRow: writeRecord },
      t,
    );
    if (!cancelled) {
      setPending(failed);
      setRowErrs(errs);
    }
    setSaving(false);
    if (!cancelled) refresh();
  };

  const columns = useMemo<ColumnDef<Record<string, unknown>>[]>(
    () =>
      visibleFields.map((f) => ({
        id: f.name,
        accessorKey: f.name,
        header: columnLabels?.[f.name] ?? f.label,
        enableGrouping: false,
        meta: { techName: f.name },
        cell: editable
          ? (ctx) => (
              <EditableCell
                value={ctx.getValue()}
                isImage={f.type === "image"}
                canWrite={fieldCan(rbacRole, "write", f, myGroupIds)}
                onCommit={(v) =>
                  saveRef.current((ctx.row.original as { id?: unknown }).id, f.name, v)
                }
                fieldType={f.type}
                refEntityId={(f as { ref?: string }).ref}
                refValueField={(f as { refValueField?: string }).refValueField}
                getLookupOptions={() =>
                  Array.from(ctx.column.getFacetedUniqueValues().keys())
                    .filter((v) => v != null && String(v).trim() !== "")
                    .map((v) => String(v))
                    .sort((a, b) => a.localeCompare(b))
                    .slice(0, 500)
                }
              />
            )
          : (ctx) => {
              const v = ctx.getValue();
              const s = v == null ? "" : String(v);
              if (f.type === "image" && s.startsWith("data:image/"))
                return (
                  <img
                    src={s}
                    alt=""
                    className="h-6 max-w-[120px] object-contain mx-auto py-0.5"
                    loading="lazy"
                  />
                );
              const disp =
                f.type === "date" || f.type === "datetime"
                  ? fmtDateCell(s, f.type === "datetime")
                  : s;
              return <span className="block truncate">{disp}</span>;
            },
      })),
    [visibleFields, columnLabels, editable, rbacRole, myGroupIds],
  );

  // Data hiển thị = rows trang hiện tại + overlay pending (ô đã sửa, theo id).
  const displayData = useMemo(() => {
    if (!editable || pending.size === 0) return rows;
    return rows.map((row) => {
      const p = pending.get(String(row.id));
      return p ? { ...row, ...p } : row;
    });
  }, [rows, pending, editable]);

  const changedRowIdsSvr = useMemo(() => new Set(pending.keys()), [pending]);

  const server = useMemo<ServerPagingController>(
    () => ({
      total,
      loading,
      onQueryChange: (q) => onQueryChange(q),
      summary: Object.keys(serverSummary).length ? serverSummary : undefined,
    }),
    [total, loading, onQueryChange, serverSummary],
  );

  // Chọn dòng (lưu id vào pageState) — hoạt động xuyên trang vì lưu theo id.
  const selectedRaw = selectionStateKey ? pageState.get(selectionStateKey) : undefined;
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
        if (multiSelect)
          return (
            Array.isArray(selectedRaw) &&
            (selectedRaw as unknown[]).some((x) => String(x) === String(id))
          );
        return selectedRaw != null && String(selectedRaw) === String(id);
      }
    : undefined;

  if (!entityId && !dataSourceId) {
    return <div className="p-3 text-xs text-muted">{t("widget.no_entity_list")}</div>;
  }

  return (
    <div className="h-full flex flex-col">
      {err && (
        <div className="px-3 py-1 text-xs text-danger border-b border-danger/30 shrink-0">
          {t("widget.error_load", { err })}
        </div>
      )}
      {editable && batchEdit && pending.size > 0 && (
        <div className="flex items-center gap-2 px-3 py-1.5 bg-warning/10 border-b border-warning/30 shrink-0">
          <I.AlertCircle size={12} className="text-warning shrink-0" />
          <span className="text-xs text-warning shrink-0">
            {t("widget.pending_records", { count: pending.size })}
          </span>
          {/* Lỗi theo từng dòng — nhãn + tooltip thông điệp đầy đủ. Dòng lỗi vẫn
              nằm trong pending (count trên) để thử lại. */}
          {rowErrs.length > 0 && (
            <span
              className="text-xs text-danger flex-1 truncate"
              title={rowErrs.map((r) => `${r.label}: ${r.msg}`).join("\n")}
            >
              ⚠ {rowErrs.length} dòng lỗi:{" "}
              {rowErrs
                .slice(0, 3)
                .map((r) => r.label)
                .join(", ")}
              {rowErrs.length > 3 ? "…" : ""}
            </span>
          )}
          {rowErrs.length === 0 && <span className="flex-1" />}
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
              setRowErrs([]);
            }}
            className="px-2.5 py-0.5 rounded text-xs border border-border hover:bg-hover"
          >
            {t("common.cancel")}
          </button>
        </div>
      )}
      {editable && !batchEdit && saveErr && (
        <div className="px-3 py-1 text-xs text-danger border-b border-danger/30 shrink-0">
          {saveErr}
        </div>
      )}
      <div className="flex-1 min-h-0">
        <DataGrid
          columns={columns}
          columnGroups={columnGroups}
          data={displayData}
          stateKey={stateKey}
          emptyText={t("widget.empty_records")}
          label={title}
          onRowClick={onRowClick}
          isRowSelected={isRowSelected}
          pageSize={ps}
          server={server}
          enableSelection={selectable}
          changedRowIds={changedRowIdsSvr}
        />
      </div>
    </div>
  );
}

/** Cấu hình cột "Hành động" (Xem/Sửa) mở dialog record con master-detail. */
type RowDetailCfg = {
  /** entityId của bảng con (vd tr_order_detail). */
  entity: string;
  /** Field trên dòng cha lấy giá trị khoá (vd order_number). */
  parentField: string;
  /** Field trên bảng con để lọc theo khoá cha (vd order_number). */
  childField: string;
  /** Tiêu đề dialog. */
  title?: string;
  /** Cột con hiển thị (mặc định: theo entity con). */
  fields?: string[];
  /** Override nhãn cột con. */
  columnLabels?: Record<string, string>;
};

/** Gắn id của dòng vào action per-row: mọi step có recordIdBinding
 *  (open-popup/delete-record/open-wizard) → trỏ tới recordId của đúng dòng bấm.
 *  recordId = row[action.recordIdField] nếu cấu hình (khoá nghiệp vụ, vd
 *  id_quytrinh), ngược lại row.id (uuid). */
function bindRowIdToAction(action: ActionConfig, row: Record<string, unknown>): ActionConfig {
  const rowId =
    action.recordIdField != null ? row[action.recordIdField] : (row.id ?? row.ID ?? row._id);
  return {
    ...action,
    steps: action.steps.map((s) =>
      s.kind === "open-popup" || s.kind === "delete-record" || s.kind === "open-wizard"
        ? { ...s, recordIdBinding: { source: "const" as const, value: rowId } }
        : s,
    ),
  };
}

/** Widget "list" — bảng record thật, cột suy từ field của entity. */
function parseCsvRows(csv: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let i = 0; i < csv.length; i++) {
    const ch = csv[i];
    if (ch === '"') {
      if (quoted && csv[i + 1] === '"') {
        cell += '"';
        i++;
      } else {
        quoted = !quoted;
      }
    } else if (ch === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((ch === "\n" || ch === "\r") && !quoted) {
      if (ch === "\r" && csv[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += ch;
    }
  }

  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

type EmbeddedFilter = {
  label?: string;
  stateKey: string;
  options?: string;
  optionLabels?: Record<string, string>;
};

async function exportCsvContentAsXlsx(csv: string, filename: string) {
  const { default: writeXlsxFile } = await import("write-excel-file/browser");
  const rows = parseCsvRows(csv.replace(/^\uFEFF/, ""));
  const workbookRows = rows.map((row, rowIndex) =>
    row.map((value) => ({
      type: String,
      value,
      ...(rowIndex === 0 ? { fontWeight: "bold" as const } : {}),
    })),
  );
  // biome-ignore lint/suspicious/noExplicitAny: cell-shape của write-excel-file không có kiểu tiện dụng để tái sử dụng.
  await writeXlsxFile(workbookRows as any).toFile(`${filename || "export"}.xlsx`);
}

function ListWidget({
  entityId,
  dataSourceId,
  stateKey,
  fields,
  columnLabels,
  selectionStateKey,
  selectionField,
  selectionEmits,
  filterFromState,
  filterConditions,
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
  columnGroups,
  defaultGrouping,
  rowDetail,
  createForm,
  editForm,
  rowActions,
  rowActionsBuiltin,
  rowActionsHidden,
  rowActionsStyle,
  editFields,
  selectable,
  embeddedActions,
  embeddedFilters: _embeddedFilters,
  addRowAtEnd,
  addRowPos,
  defaultSort,
  refetchOnSave,
  valueLabels,
}: {
  entityId?: string;
  stateKey?: string;
  fields?: string[];
  /** Nhóm tiêu đề cột (banded header nhiều cấp). */
  columnGroups?: ColumnGroupNode[];
  /** Gom HÀNG theo cột mặc định khi chưa có view lưu (vd ["phanloai"]). */
  defaultGrouping?: string[];
  /** Override nhãn header theo cột (field name → header DQHF của form gốc).
   *  Ưu tiên hơn label DataSource (global) — cho phép mỗi page hiện đúng
   *  tiêu đề cột của form DQHF tương ứng. */
  columnLabels?: Record<string, string>;
  /** Phase V: khi click row, set page-state[selectionStateKey] = row.id. */
  selectionStateKey?: string;
  /** Lưu giá trị field nghiệp vụ (vd "masp") vào selectionStateKey thay vì id uuid
   *  — để list chi tiết filterFromState theo cột nghiệp vụ (master-detail không UUID). */
  selectionField?: string;
  /** Khi click dòng, lưu THÊM giá trị các field khác vào state ({stateKey: field}).
   *  Vd {selKetcau: "ketcau"} để widget khác ẩn/hiện theo kết cấu SP đang chọn. */
  selectionEmits?: Record<string, string>;
  /** Legacy single-equality filter. Khi state rỗng → hide all rows
   *  (master-detail), TRỪ KHI emptyStateShowsAll=true (combobox lọc:
   *  "tất cả" = rỗng → hiện hết). */
  filterFromState?: { field: string; stateKey: string };
  /** Nhiều điều kiện lọc AND từ nhiều cột phát / nhiều panel.
   *  Áp sau filterFromState (không thay thế). Khi bất kỳ điều kiện nào rỗng
   *  (state chưa có giá trị) → ẩn hết hàng (master-detail UX). */
  filterConditions?: Array<{ field: string; stateKey: string }>;
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
  /** Cột "Hành động" theo dòng — nút Xem/Sửa mở dialog danh sách record con
   *  (master-detail). Lọc child theo childField = giá trị parentField của dòng. */
  rowDetail?: RowDetailCfg;
  /** Nút "Thêm mới" mở dialog 2 tab tạo record cha + nhiều dòng con. */
  createForm?: CreateFormCfg;
  /** Nút "Sửa" theo dòng mở dialog 2 tab sửa record cha + dòng con (master-detail). */
  editForm?: CreateFormCfg;
  /** Nút hành động theo dòng (vd Sửa/Xóa) — id dòng tự bind vào step. */
  rowActions?: ActionConfig[];
  /** Cột hành động dựng sẵn (Xem/Sửa/Xoá) — bật trong cài đặt list (mặc định ẩn). */
  rowActionsBuiltin?: boolean;
  /** Field hiển thị trong form sửa built-in (khác list columns). Mặc định = fields. */
  editFields?: string[];
  /** Key các nút bị ẩn trên popover hành động (cài đặt list). */
  rowActionsHidden?: string[];
  /** Kiểu cột hành động: "popover" (⋯, mặc định) | "inline" (Xem/Sửa/Xoá). */
  rowActionsStyle?: "inline" | "popover";
  /** Bật chọn dòng (checkbox) — bật trong cài đặt list (mặc định ẩn). */
  selectable?: boolean;
  /** Nút embeddedActions render CÙNG hàng với nút "Thêm mới" trong header
   *  (thay vì strip riêng phía trên) — chỉ truyền khi list có createForm. */
  embeddedActions?: ActionBarItem[];
  /** Dropdown lọc ngay trong toolbar (cạnh nút Thêm) — set pageState[stateKey];
   *  list lọc qua cfg.filters tham chiếu stateKey đó. */
  embeddedFilters?: Array<{
    label?: string;
    stateKey: string;
    options?: string;
    optionLabels?: Record<string, string>;
  }>;
  /** Hiện DÒNG "＋ Thêm dòng mới" trong lưới (cfg.addRowAtEnd) — chỉ khi editable
   *  + batchEdit (mới tạo được dòng nháp). */
  addRowAtEnd?: boolean;
  /** Vị trí dòng thêm mới: "top" | "bottom" (cfg.addRowPos, mặc định "bottom"). */
  addRowPos?: "top" | "bottom";
  /** Sắp xếp mặc định khi chưa có view lưu — vd {field:"id",dir:"desc"} bản ghi
   *  mới lên đầu. Bản ghi sửa giữ vị trí (id không đổi). */
  defaultSort?: { field: string; dir: "asc" | "desc" };
  /** Sau khi LƯU 1 ô inline (non-batch) → nạp lại lưới để cập nhật các cột phụ
   *  thuộc do server tính lại (vd diện tích sơn = base × phần trăm). */
  refetchOnSave?: boolean;
  /** Map value→label hiển thị theo cột (vd Phân loại TRONG→"Màu trong"). */
  valueLabels?: Record<string, Record<string, string>>;
}) {
  const t = useT();
  const ent = useEntity(entityId);
  const [editModal, setEditModal] = useState<{ id: string; readOnly: boolean } | null>(null);
  const [detailModal, setDetailModal] = useState<{ value: unknown; editable: boolean } | null>(
    null,
  );
  const [createOpen, setCreateOpen] = useState(false);
  const {
    rows,
    loading,
    err,
    fields: dataFields,
    isDataSource,
    update: dataUpdate,
    create: dataCreate,
    refFill,
  } = useWidgetData({ entity: entityId, dataSourceId, rowLimit, loadFilters, loadGate });
  const pageState = usePageState();
  // Các ref cho cell functions trong useMemo — đọc giá trị mới nhất mà không cần
  // đưa vào deps (pageState thay identity mỗi khi set gọi; visibleFields/columnLabels
  // /title ít đổi). Khai báo sớm (trước conditional return) để tuân thủ rules of hooks.
  const pageStateRef = useRef(pageState);
  pageStateRef.current = pageState;
  const _rafVisibleFields = useRef<EntityField[]>([]);
  const _rafColumnLabels = useRef(columnLabels);
  _rafColumnLabels.current = columnLabels;
  const _rafTitle = useRef(title);
  _rafTitle.current = title;
  // RBAC để cho phép tick checkbox boolean ngay ở lưới (chỉ khi có quyền ghi field).
  // Cột hành động dựng sẵn (Xem/Sửa/Xoá) — gộp với rowActions cấu hình. Dùng
  // ActionWidget: Xem/Sửa mở popup detail/form của entity cho ĐÚNG dòng; Xoá =
  // confirm → delete-record (recordIdBinding gắn id dòng qua bindRowIdToAction).
  const effectiveRowActions = useMemo<ActionConfig[]>(() => {
    const base = rowActions ?? [];
    if (!rowActionsBuiltin || !entityId) return base;
    const builtin = [
      {
        id: "__ra_view",
        label: "Xem",
        icon: "Eye",
        iconOnly: true,
        variant: "default",
        steps: [
          {
            id: "v",
            kind: "open-popup",
            title: "Xem chi tiết",
            entity: entityId,
            fields,
            popupMode: "detail",
            saveOutputTo: "_viewed",
          },
        ],
      },
      {
        id: "__ra_edit",
        label: "Sửa",
        icon: "Edit",
        iconOnly: true,
        variant: "default",
        steps: [
          {
            id: "e",
            kind: "open-popup",
            title: "Sửa",
            entity: entityId,
            fields: editFields ?? fields,
            popupMode: "form",
            persist: true,
            invalidateEntities: [entityId],
            saveOutputTo: "_edited",
          },
        ],
      },
      {
        id: "__ra_del",
        label: "Xoá",
        icon: "Trash",
        iconOnly: true,
        variant: "danger",
        steps: [
          {
            id: "c",
            kind: "confirm",
            title: "Xác nhận xoá",
            danger: true,
            message: "Xoá dòng này?",
          },
          { id: "d", kind: "delete-record", invalidateEntities: [entityId] },
        ],
      },
    ] as unknown as ActionConfig[];
    // Dedup: nếu rowActions cấu hình ĐÃ có hành động trùng nhãn (Xem/Sửa/Xoá)
    // thì bỏ builtin tương ứng → popover KHÔNG nhân đôi nút.
    const baseLabels = new Set(base.map((a) => a.label));
    return [...base, ...builtin.filter((b) => !baseLabels.has(b.label))];
  }, [rowActions, rowActionsBuiltin, entityId, fields, editFields]);

  // Field cố định cho dòng TẠO MỚI (dán thêm hàng loạt): suy từ loadFilters op
  // "=" (resolve fromState qua pageState) — vd masp = sản phẩm đang chọn ở bộ
  // lọc header. Tính inline mỗi render để bám selMasp hiện tại (re-render khi
  // đổi SP). Không memo vì pageState identity ổn định → memo sẽ ôm giá trị cũ.
  const createDefaults: Record<string, string> = {};
  {
    const lf = loadFilters as
      | Record<string, { op?: string; value?: unknown; fromState?: string }>
      | undefined;
    for (const [field, cond] of Object.entries(lf ?? {})) {
      if (cond.op !== "=") continue;
      const v = cond.fromState ? pageState.get(cond.fromState) : cond.value;
      if (v != null && v !== "") createDefaults[field] = String(v);
    }
  }
  // Dán THÊM MỚI: tạo từng record rồi refetch để hiện dòng mới (datasource
  // re-resolve join). Lỗi 1 record ném ra → PasteGridModal hiện lỗi.
  const bulkCreate = async (records: Array<Record<string, string>>) => {
    for (const r of records) await dataCreate(r);
    if (dataSourceId) {
      const key = `__refresh:ds:${dataSourceId}`;
      pageState.set(key, ((pageState.get(key) as number | undefined) ?? 0) + 1);
    }
  };

  // Cột "Hành động" theo dòng từ cấu hình rowActions (vd Sửa/Xóa) — mỗi nút là
  // ActionWidget với recordIdBinding trỏ tới id của đúng dòng.
  // Mặc định INLINE; chỉ "popover" khi đặt rõ.
  // useMemo phải khai báo TRƯỚC early return để tuân thủ rules of hooks.
  const rowActsInline = rowActionsStyle !== "popover";
  const rowActionCol = useMemo(
    () =>
      effectiveRowActions.length > 0
        ? [
            {
              id: "__rowacts__",
              header: () => (
                <span title="Hành động">
                  <I.MoreHorizontal size={13} className="text-muted/70" />
                </span>
              ),
              size: rowActsInline ? Math.min(48 + effectiveRowActions.length * 44, 240) : 28,
              minSize: 24,
              meta: { compact: true, label: "Hành động" },
              enableSorting: false,
              cell: ({ row }: { row: { original: Record<string, unknown> } }) => {
                const bound = effectiveRowActions.map((a) => bindRowIdToAction(a, row.original));
                if (rowActsInline) {
                  return (
                    <div
                      data-col-content=""
                      className="flex items-center gap-1 w-fit"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {bound.map((a) => (
                        <ActionWidget
                          key={a.label}
                          config={a}
                          pageState={pageStateRef.current}
                          inline
                        />
                      ))}
                    </div>
                  );
                }
                return (
                  <RowActionsCell
                    actions={bound}
                    pageState={pageStateRef.current}
                    row={row.original}
                    cols={_rafVisibleFields.current.map((f) => ({
                      key: f.name,
                      label: _rafColumnLabels.current?.[f.name] ?? f.label ?? f.name,
                    }))}
                    title={_rafTitle.current}
                    hidden={rowActionsHidden}
                  />
                );
              },
            },
          ]
        : [],
    [effectiveRowActions, rowActsInline, rowActionsHidden],
  );

  if (!entityId && !dataSourceId) {
    return <div className="p-3 text-xs text-muted">{t("widget.no_entity_list")}</div>;
  }
  const allFields = isDataSource ? dataFields : (ent?.fields ?? []);

  // fields=[...] → dùng đúng list đó THEO THỨ TỰ fields (bám layout grid DQHF);
  // không có config → lọc theo defaultVisible của field (giữ thứ tự nguồn).
  const visibleFields =
    fields && fields.length > 0
      ? (fields
          .map((name) => allFields.find((f) => f.name === name))
          .filter(Boolean) as typeof allFields)
      : allFields.filter((f) => f.defaultVisible !== false);
  _rafVisibleFields.current = visibleFields;

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
  // filterConditions: AND nhiều điều kiện bổ sung (từ sourceFields đa cột).
  // Bất kỳ điều kiện nào rỗng → ẩn hết (master-detail UX nhất quán).
  if (filterConditions?.length) {
    const vals = filterConditions.map((c) => pageState.get(c.stateKey));
    const anyEmpty = vals.some(
      (v) => v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0),
    );
    if (anyEmpty) {
      filteredRows = [];
    } else {
      filteredRows = filteredRows.filter((r) =>
        filterConditions.every((c, i) => {
          const sv = vals[i];
          const v = r[c.field];
          if (Array.isArray(sv)) return (sv as string[]).includes(String(v));
          return v === sv || String(v) === String(sv);
        }),
      );
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

  const onRowClick =
    selectionStateKey || selectionEmits
      ? (row: Record<string, unknown>) => {
          // selectionEmits: lưu thêm giá trị field khác của dòng vào state (vd
          // ketcau → selKetcau) để widget khác ẩn/hiện theo (visibleWhen).
          if (selectionEmits) {
            for (const [k, f] of Object.entries(selectionEmits)) pageState.set(k, row[f] ?? "");
          }
          if (!selectionStateKey) return;
          // selectionField: lưu giá trị 1 field nghiệp vụ (vd masp) thay vì id uuid
          // — để list khác filterFromState theo cột nghiệp vụ (vd tr_dinhmuc_son.masp).
          const id = selectionField ? row[selectionField] : (row.id ?? row.ID ?? row._id);
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
        const id = selectionField ? row[selectionField] : (row.id ?? row.ID ?? row._id);
        if (id == null) return false;
        if (multiSelect) return selectedIds.some((x) => String(x) === String(id));
        return id === selectedId || String(id) === String(selectedId);
      }
    : undefined;

  const fieldColumns = visibleFields.map((f) => ({
    accessorKey: f.name,
    // Header DQHF per-page (columnLabels) ưu tiên hơn label DataSource global.
    header: columnLabels?.[f.name] ?? f.label,
    // Tên cột kỹ thuật hiện mono dưới nhãn ở header (DataGrid đọc meta.techName).
    // Tổng (Σ) chỉ cho cột SỐ theo kiểu field — cột chữ (vd Hiệu ứng) lỡ chứa
    // số cũng KHÔNG bị auto cộng (noSummary).
    meta: {
      techName: f.name,
      ...(f.type === "number" || f.type === "integer" || f.type === "currency"
        ? { summary: "sum" as const }
        : { noSummary: true }),
    },
    cell: (c: { getValue: () => unknown }) => {
      const raw = c.getValue();
      // Map value→label per-page (vd Phân loại: TRONG → "Màu trong").
      const vmap = valueLabels?.[f.name];
      if (vmap && raw != null && vmap[String(raw)] != null) return vmap[String(raw)];
      // Field ảnh: render thumbnail nếu là data:image hoặc URL http(s).
      const s = raw == null ? "" : String(raw);
      if (f.type === "image" && (s.startsWith("data:image/") || /^https?:\/\//.test(s))) {
        return (
          <img src={s} alt="" className="h-7 max-w-[90px] object-contain mx-auto" loading="lazy" />
        );
      }
      return applyFieldFormat(f, raw);
    },
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

  // Cột "Hành động" theo dòng: nút Xem (read-only) + Sửa (editable) → mở dialog
  // record con lọc theo parentField. stopPropagation để không kích hoạt row-click.
  const actionCol = rowDetail
    ? [
        {
          id: "__rowactions__",
          // Header chuỗi (không bọc hàm) → "Chọn cột hiển thị" hiện đúng "Hành động".
          header: "Hành động",
          size: 96,
          enableSorting: false,
          cell: ({ row }: { row: { original: Record<string, unknown> } }) => {
            const pv = row.original[rowDetail.parentField];
            const rid = row.original.id ?? row.original.ID ?? row.original._id;
            return (
              <div className="flex items-center gap-1 justify-center">
                {/* editForm có cấu hình → Xem mở dialog master+detail read-only;
                    không thì giữ hành vi cũ (xem danh sách dòng con). */}
                <button
                  type="button"
                  title="Xem chi tiết"
                  className="p-1 rounded hover:bg-hover text-muted hover:text-accent"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (editForm && rid != null) setEditModal({ id: String(rid), readOnly: true });
                    else setDetailModal({ value: pv, editable: false });
                  }}
                >
                  <I.Eye size={14} />
                </button>
                {/* editForm có cấu hình → nút Sửa mở dialog master+detail mới;
                    không thì giữ hành vi cũ (sửa inline dòng con). */}
                <button
                  type="button"
                  title={editForm ? "Sửa đơn hàng" : "Sửa chi tiết"}
                  className="p-1 rounded hover:bg-hover text-muted hover:text-accent"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (editForm && rid != null) setEditModal({ id: String(rid), readOnly: false });
                    else setDetailModal({ value: pv, editable: true });
                  }}
                >
                  <I.Edit size={14} />
                </button>
              </div>
            );
          },
        },
      ]
    : [];

  // Cột nút "Sửa đơn" độc lập — CHỈ khi có editForm mà KHÔNG có rowDetail
  // (có rowDetail thì nút Sửa trong cột Hành động đã mở dialog edit này).
  const editFormCol =
    editForm && entityId && !rowDetail
      ? [
          {
            id: "__editform__",
            header: () => "Sửa",
            size: 56,
            enableSorting: false,
            cell: ({ row }: { row: { original: Record<string, unknown> } }) => {
              const rid = row.original.id ?? row.original.ID ?? row.original._id;
              if (rid == null) return null;
              return (
                <div
                  className="flex items-center justify-center"
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    type="button"
                    title="Sửa đơn hàng"
                    className="p-1 rounded hover:bg-hover text-muted hover:text-accent"
                    onClick={() => setEditModal({ id: String(rid), readOnly: false })}
                  >
                    <I.Edit size={14} />
                  </button>
                </div>
              );
            },
          },
        ]
      : [];

  const columns = [...editFormCol, ...rowActionCol, ...actionCol, ...checkboxCol, ...fieldColumns];

  // Hàm lưu 1 record (dùng cho editable và excelMode). Datasource → ghi qua
  // resolver (base field về record gốc), entity → records.update trực tiếp.
  const saveRecord = async (rowId: unknown, changes: Record<string, unknown>) => {
    if (isDataSource) await dataUpdate(String(rowId), changes);
    else await api.updateRecord(String(rowId), changes);
    // Cột phụ thuộc tính ở server (trigger): vd đổi % → diện tích sơn tính lại.
    // Nạp lại lưới để hiện giá trị mới (chỉ khi cấu hình bật refetchOnSave).
    if (refetchOnSave) {
      pageState.set(
        isDataSource ? `__refresh:ds:${dataSourceId}` : `__refresh:${entityId}`,
        Date.now(),
      );
    }
  };
  // Bulk + dry-run validate cho batch edit — chỉ entity-backed.
  const editBatchOps: BatchOps | undefined =
    !isDataSource && entityId
      ? {
          validate: (items) => api.bulkValidateRecords(entityId, items).then((r) => r.results),
          bulkUpdate: (ids, patch) => api.bulkUpdateRecords(entityId, ids, patch),
        }
      : undefined;

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
        columnLabels={columnLabels}
        batchEdit={!!batchEdit}
        onSave={saveRecord}
        batchOps={editBatchOps}
        onRowClick={onRowClick}
        isRowSelected={isRowSelected}
        columnGroups={columnGroups}
        onBulkCreate={bulkCreate}
        createDefaults={createDefaults}
        stateKey={stateKey}
        rowActions={effectiveRowActions}
        selectable={selectable}
        rowActionsHidden={rowActionsHidden}
        rowActionsStyle={rowActionsStyle}
        refFill={refFill}
        addRowAtEnd={addRowAtEnd}
        addRowPos={addRowPos}
      />
    );
  }

  // ── Chế độ mặc định (read-only) ─────────────────────────────────────
  return (
    <div className="h-full flex flex-col">
      {(createForm || (embeddedActions && embeddedActions.length > 0)) && (
        <div className="px-2 py-1.5 border-b border-border flex items-center gap-1.5 flex-wrap shrink-0">
          {createForm && (
            <Button
              variant="primary"
              icon={<I.Plus size={13} />}
              onClick={() => setCreateOpen(true)}
            >
              {createForm.title ?? "Thêm mới đơn hàng"}
            </Button>
          )}
          {embeddedActions?.map((item) => (
            <ActionWidget key={item.id} config={item} pageState={pageState} inline />
          ))}
        </div>
      )}
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
            columnGroups={columnGroups}
            defaultGrouping={defaultGrouping}
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
            defaultSort={defaultSort}
            enableSelection={selectable}
            onExportAll={
              entityId && !isDataSource
                ? async (format) => {
                    const r = await api.exportRecords(entityId, "csv");
                    const name = title ?? ent?.name ?? "export";
                    if (format === "xlsx") {
                      await exportCsvContentAsXlsx(r.content, name);
                    } else {
                      const blob = new Blob([r.content], { type: "text/csv;charset=utf-8" });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement("a");
                      a.href = url;
                      a.download = `${name}.csv`;
                      a.click();
                      URL.revokeObjectURL(url);
                    }
                  }
                : undefined
            }
          />
        )}
      </div>
      {rowDetail && detailModal && (
        <Modal
          open
          onClose={() => setDetailModal(null)}
          title={`${rowDetail.title ?? "Chi tiết"}${
            detailModal.value != null ? ` — ${String(detailModal.value)}` : ""
          }${detailModal.editable ? " (Sửa)" : ""}`}
          width={960}
          footer={
            <Button variant="ghost" onClick={() => setDetailModal(null)}>
              Đóng
            </Button>
          }
        >
          <div className="h-[460px]">
            <ListWidget
              entityId={rowDetail.entity}
              fields={rowDetail.fields}
              columnLabels={rowDetail.columnLabels}
              loadFilters={{ [rowDetail.childField]: { op: "=", value: detailModal.value } }}
              editable={detailModal.editable}
              rowLimit={1000}
              pageSize={50}
            />
          </div>
        </Modal>
      )}
      {createForm && createOpen && (
        <MasterDetailCreateModal
          config={createForm}
          onClose={() => setCreateOpen(false)}
          onCreated={() => {
            const stamp = Date.now();
            pageState.set(`__refresh:${createForm.master.entity}`, stamp);
            pageState.set(`__refresh:${createForm.detail.entity}`, stamp);
          }}
        />
      )}
      {editForm && editModal && (
        <MasterDetailEditModal
          config={editForm}
          recordId={editModal.id}
          readOnly={editModal.readOnly}
          onClose={() => setEditModal(null)}
          onSaved={() => {
            const stamp = Date.now();
            pageState.set(`__refresh:${editForm.master.entity}`, stamp);
            pageState.set(`__refresh:${editForm.detail.entity}`, stamp);
          }}
        />
      )}
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
  const filterConditions = cfg.filterConditions as
    | Array<{ field: string; stateKey: string }>
    | undefined;
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
  if (filterConditions?.length) {
    const vals = filterConditions.map((c) => pageState.get(c.stateKey));
    const anyEmpty = vals.some((v) => v === undefined || v === null || v === "");
    if (anyEmpty) {
      rows = [];
    } else {
      rows = rows.filter((r) =>
        filterConditions.every((c, i) => {
          const sv = vals[i];
          const v = r[c.field];
          return v === sv || String(v) === String(sv);
        }),
      );
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
  const filterConditions = cfg.filterConditions as
    | Array<{ field: string; stateKey: string }>
    | undefined;
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
  if (filterConditions?.length) {
    const vals = filterConditions.map((c) => pageState.get(c.stateKey));
    const anyEmpty = vals.some((v) => v === undefined || v === null || v === "");
    if (anyEmpty) {
      rows = [];
    } else {
      rows = rows.filter((r) =>
        filterConditions.every((c, i) => {
          const sv = vals[i];
          const v = r[c.field];
          return v === sv || String(v) === String(sv);
        }),
      );
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
    ? (ent?.fields ?? []).filter((f) => step.fields?.includes(f.name))
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
          {step.actions?.map((a) => (
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
type SplitPanelCfg = {
  kind?: string;
  entity?: string;
  dataSourceId?: string;
  title?: string;
  linkField?: string;
  /** Cột phát khi chọn dòng — giá trị của cột này được lưu vào state thay vì row.id.
   *  Dùng khi panel nguồn liên kết với panel đích qua business-key (vd masp, code)
   *  thay vì UUID. Panel đích đặt linkField = cột có cùng giá trị đó. */
  sourceField?: string;
  /** Nhiều cột phát cùng lúc. Mỗi cột fieldX được lưu vào state key
   *  `${splitKey}:${panelKey}:${fieldX}`. Panel đích dùng linkConditions
   *  để khai báo điều kiện lọc theo cột phát tương ứng. */
  sourceFields?: string[];
  /** Nhiều điều kiện lọc (AND). Mỗi điều kiện chỉ định: panel nguồn phát
   *  (fromPanel), cột phát từ panel đó (fromField, bỏ trống = dùng main key),
   *  và cột trong panel này để so sánh (toField). */
  linkConditions?: Array<{ fromPanel?: string; fromField?: string; toField: string }>;
  /** Panel nguồn để lọc/hiển thị detail: "a"|"b"|"c"|"d". Mặc định "a" (Panel A). */
  filterFromPanel?: string;
  chartKind?: string; // bar|line|area|pie|doughnut — loại biểu đồ
  groupBy?: string; // chart / kanban: field nhóm
  valueField?: string; // chart: field tổng hợp giá trị
  selectable?: boolean; // list: hiện checkbox chọn dòng
  addRowAtEnd?: boolean; // list+batchEdit: dòng thêm mới
  addRowPos?: string; // top | bottom
  // Các trường được copy từ list/form/detail khi kéo thả vào panel
  fields?: string[];
  columnLabels?: Record<string, string>;
  columnGroups?: ColumnGroupNode[];
  serverPaging?: boolean;
  editable?: boolean;
  batchEdit?: boolean;
  excelMode?: boolean;
  multiSelect?: boolean;
  loadGate?: string;
  rowLimit?: number;
  pageSize?: number;
  defaultSort?: { field: string; dir: "asc" | "desc" };
};

type SplitGridCell = SplitPanelCfg & {
  id: string;
  col: number;
  row: number;
  colSpan: number;
  rowSpan: number;
};

/** Drag-resize cho N panel: mảng ratios + onHandleDrag(index, e) cho từng thanh ngăn */
function useSplitRatios(
  initRatios: number[],
  containerRef: React.RefObject<HTMLDivElement | null>,
  axis: "h" | "v",
) {
  const [ratios, setRatios] = useState(() => [...initRatios]);
  const onHandleDrag = (i: number, e: React.MouseEvent) => {
    e.preventDefault();
    const start = axis === "h" ? e.clientX : e.clientY;
    const snap = [...ratios];
    const total = snap.reduce((a, b) => a + b, 0);
    const onMove = (ev: MouseEvent) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const size = axis === "h" ? rect.width : rect.height;
      const delta = (((axis === "h" ? ev.clientX : ev.clientY) - start) / size) * total;
      const min = total * 0.05;
      const next = [...snap];
      // biome-ignore lint/style/noNonNullAssertion: i/i+1 always in range
      next[i] = Math.max(min, snap[i]! + delta);
      // biome-ignore lint/style/noNonNullAssertion: i/i+1 always in range
      next[i + 1] = Math.max(min, snap[i]! + snap[i + 1]! - next[i]!);
      setRatios(next);
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };
  return { ratios, onHandleDrag };
}

/** Drag-resize cho grid N×M: trả colFr/rowFr local + handler mousedown cho mỗi thanh ngăn */
function useGridDrag(
  initColFr: number[],
  initRowFr: number[],
  containerRef: React.RefObject<HTMLDivElement | null>,
) {
  const [colFr, setColFr] = useState(() => [...initColFr]);
  const [rowFr, setRowFr] = useState(() => [...initRowFr]);

  const onColDrag = (i: number, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const snap = [...colFr];
    const total = snap.reduce((a, b) => a + b, 0);
    const onMove = (ev: MouseEvent) => {
      const cw = containerRef.current?.getBoundingClientRect().width ?? 0;
      if (!cw) return;
      const delta = ((ev.clientX - startX) / cw) * total;
      const minFr = total * 0.05;
      const next = [...snap];
      // biome-ignore lint/style/noNonNullAssertion: i and i+1 are always in range
      next[i] = Math.max(minFr, snap[i]! + delta);
      // biome-ignore lint/style/noNonNullAssertion: i and i+1 are always in range
      next[i + 1] = Math.max(minFr, snap[i]! + snap[i + 1]! - next[i]!);
      setColFr(next);
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  const onRowDrag = (j: number, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startY = e.clientY;
    const snap = [...rowFr];
    const total = snap.reduce((a, b) => a + b, 0);
    const onMove = (ev: MouseEvent) => {
      const ch = containerRef.current?.getBoundingClientRect().height ?? 0;
      if (!ch) return;
      const delta = ((ev.clientY - startY) / ch) * total;
      const minFr = total * 0.05;
      const next = [...snap];
      // biome-ignore lint/style/noNonNullAssertion: j and j+1 are always in range
      next[j] = Math.max(minFr, snap[j]! + delta);
      // biome-ignore lint/style/noNonNullAssertion: j and j+1 are always in range
      next[j + 1] = Math.max(minFr, snap[j]! + snap[j + 1]! - next[j]!);
      setRowFr(next);
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  return { colFr, rowFr, onColDrag, onRowDrag };
}

/**
 * panelKey: "a"|"b"|"c"|"d" khi gọi từ SplitWidget — mỗi panel có key riêng để
 * các panel khác có thể lọc độc lập. Bỏ qua (undefined) khi gọi từ GridWidget
 * để giữ hành vi cũ (dùng chung splitKey).
 */
function buildSubCfg(
  panel: SplitPanelCfg,
  splitKey: string,
  panelKey?: string,
): Record<string, unknown> {
  const kind = panel.kind ?? "list";
  // Với split widget: mỗi panel dùng key riêng; grid widget dùng splitKey chung.
  const ownStateKey = panelKey ? `${splitKey}:${panelKey}` : splitKey;
  const srcStateKey = panelKey ? `${splitKey}:${panel.filterFromPanel ?? "a"}` : splitKey;
  return {
    entity: panel.entity,
    dataSourceId: panel.dataSourceId,
    title: panel.title,
    fields: panel.fields,
    columnLabels: panel.columnLabels,
    columnGroups: panel.columnGroups,
    serverPaging: panel.serverPaging,
    editable: panel.editable,
    batchEdit: panel.batchEdit,
    excelMode: panel.excelMode,
    multiSelect: panel.multiSelect,
    loadGate: panel.loadGate,
    rowLimit: panel.rowLimit,
    pageSize: panel.pageSize,
    defaultSort: panel.defaultSort,
    selectable: panel.selectable,
    addRowAtEnd: panel.addRowAtEnd,
    addRowPos: panel.addRowPos,
    groupBy: panel.groupBy,
    valueField: panel.valueField,
    // chart kind maps to cfg.kind (ChartWidget reads cfg.kind for bar/line/pie…)
    ...(kind === "chart" ? { kind: panel.chartKind ?? "bar" } : {}),
    ...(kind === "list"
      ? {
          selectionStateKey: ownStateKey,
          ...(panel.sourceField ? { selectionField: panel.sourceField } : {}),
          // sourceFields: mỗi field phát thêm 1 state key riêng {ownStateKey}:{field}
          ...(panel.sourceFields?.length
            ? {
                selectionEmits: Object.fromEntries(
                  panel.sourceFields.map((f) => [`${ownStateKey}:${f}`, f]),
                ),
              }
            : {}),
        }
      : {}),
    ...(kind === "detail" ? { recordIdFromState: srcStateKey } : {}),
    // linkField đơn (backwards compat) → filterFromState như cũ.
    // Bỏ qua khi linkConditions đã khai báo: linkConditions ưu tiên + filterFromState
    // sẽ dùng row-id (uuid) làm stateKey → không bao giờ khớp field nghiệp vụ → ẩn hết.
    ...((kind === "list" || kind === "chart" || kind === "kanban") &&
    panel.linkField &&
    !panel.linkConditions?.length
      ? { filterFromState: { field: panel.linkField, stateKey: srcStateKey } }
      : {}),
    // linkConditions: mảng điều kiện AND — fromField → key phụ; bỏ fromField → key chính
    ...((kind === "list" || kind === "chart" || kind === "kanban") && panel.linkConditions?.length
      ? {
          filterConditions: panel.linkConditions.map((c) => {
            const fp = c.fromPanel ?? panel.filterFromPanel ?? "a";
            const fromStateKey = panelKey
              ? c.fromField
                ? `${splitKey}:${fp}:${c.fromField}`
                : `${splitKey}:${fp}`
              : splitKey;
            return { field: c.toField, stateKey: fromStateKey };
          }),
        }
      : {}),
    ...(kind === "form" && panel.linkField
      ? { linkedToState: { field: panel.linkField, stateKey: srcStateKey } }
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
  if (kind === "list") {
    // Bảng lớn: serverPaging → phân trang/sắp/lọc server-side (hỗ trợ cả sửa ô).
    if (cfg.serverPaging === true && cfg.excelMode !== true)
      return (
        <ServerPagedListWidget
          entityId={cfg.entity as string | undefined}
          dataSourceId={cfg.dataSourceId as string | undefined}
          stateKey={stateKey}
          fields={cfg.fields as string[] | undefined}
          columnLabels={cfg.columnLabels as Record<string, string> | undefined}
          columnGroups={cfg.columnGroups as ColumnGroupNode[] | undefined}
          selectionStateKey={cfg.selectionStateKey as string | undefined}
          title={cfg.title as string | undefined}
          multiSelect={cfg.multiSelect === true}
          editable={cfg.editable === true}
          batchEdit={cfg.batchEdit === true}
          pageSize={cfg.pageSize as number | undefined}
          loadFilters={cfg.loadFilters as LoadFilters | undefined}
          loadGate={cfg.loadGate as string | undefined}
          selectable={cfg.selectable === true}
        />
      );
    return (
      <ListWidget
        entityId={cfg.entity as string | undefined}
        dataSourceId={cfg.dataSourceId as string | undefined}
        stateKey={stateKey}
        fields={cfg.fields as string[] | undefined}
        columnLabels={cfg.columnLabels as Record<string, string> | undefined}
        columnGroups={cfg.columnGroups as ColumnGroupNode[] | undefined}
        defaultGrouping={cfg.defaultGrouping as string[] | undefined}
        selectionStateKey={cfg.selectionStateKey as string | undefined}
        selectionField={cfg.selectionField as string | undefined}
        selectionEmits={cfg.selectionEmits as Record<string, string> | undefined}
        filterFromState={cfg.filterFromState as { field: string; stateKey: string } | undefined}
        filterConditions={
          cfg.filterConditions as Array<{ field: string; stateKey: string }> | undefined
        }
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
        rowDetail={cfg.rowDetail as RowDetailCfg | undefined}
        createForm={cfg.createForm as CreateFormCfg | undefined}
        editForm={cfg.editForm as CreateFormCfg | undefined}
        rowActions={cfg.rowActions as ActionConfig[] | undefined}
        rowActionsBuiltin={cfg.rowActionsBuiltin === true}
        editFields={cfg.editFields as string[] | undefined}
        rowActionsHidden={cfg.rowActionsHidden as string[] | undefined}
        rowActionsStyle={cfg.rowActionsStyle as "inline" | "popover" | undefined}
        selectable={cfg.selectable === true}
        addRowAtEnd={cfg.addRowAtEnd === true}
        addRowPos={cfg.addRowPos === "top" ? "top" : "bottom"}
        defaultSort={cfg.defaultSort as { field: string; dir: "asc" | "desc" } | undefined}
      />
    );
  }
  if (kind === "detail") return <DetailWidget cfg={cfg} />;
  if (kind === "form") return <FormWidget cfg={cfg} />;
  if (kind === "chart") return <ChartWidget cfg={cfg} />;
  if (kind === "kanban") return <KanbanWidget cfg={cfg} />;
  return null;
}

/** Grid Layout N×M — kind="grid", config.cells[]; có drag handle giữa cột/hàng */
function GridWidget({ comp }: { comp: PageComponent }) {
  const cfg = comp.config ?? {};
  const splitKey = `split_${comp.id}_sel`;
  const cols = (cfg.cols as number) || 2;
  const rows = (cfg.rows as number) || 1;
  const cells = (cfg.cells as SplitGridCell[]) ?? [];
  const gridLabel = cfg.label as string | undefined;

  // Normalize fr arrays to match col/row count
  const savedColFr = cfg.colFr as number[] | undefined;
  const savedRowFr = cfg.rowFr as number[] | undefined;
  const initColFr: number[] = Array.from({ length: cols }, (_, i): number => savedColFr?.[i] ?? 1);
  const initRowFr: number[] = Array.from({ length: rows }, (_, j): number => savedRowFr?.[j] ?? 1);

  const containerRef = useRef<HTMLDivElement>(null);
  const { colFr, rowFr, onColDrag, onRowDrag } = useGridDrag(
    initColFr,
    initRowFr,
    containerRef as React.RefObject<HTMLDivElement | null>,
  );

  // Template interleaves content fr tracks with 4px handle tracks
  // e.g. cols=3: "1fr 4px 1fr 4px 1fr"
  const colTemplate = colFr.map((f, i) => (i < cols - 1 ? `${f}fr 4px` : `${f}fr`)).join(" ");
  const rowTemplate = rowFr.map((f, j) => (j < rows - 1 ? `${f}fr 4px` : `${f}fr`)).join(" ");

  // Content col c → display col (c-1)*2+1; colSpan s → display span s*2-1
  const cellStyle = (cell: SplitGridCell) => ({
    gridColumn: `${(cell.col - 1) * 2 + 1} / span ${cell.colSpan * 2 - 1}`,
    gridRow: `${(cell.row - 1) * 2 + 1} / span ${cell.rowSpan * 2 - 1}`,
  });

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {gridLabel && (
        <div className="px-3 py-1.5 border-b border-border/40 shrink-0 text-sm font-medium">
          {gridLabel}
        </div>
      )}
      <div
        ref={containerRef}
        className="flex-1 overflow-hidden"
        style={{ display: "grid", gridTemplateColumns: colTemplate, gridTemplateRows: rowTemplate }}
      >
        {/* Handles rendered BEFORE cells — merged cells sit on top via DOM stacking order */}
        {Array.from({ length: cols - 1 }, (_, i) => (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: thanh ngăn cột — index ổn định
            key={`ch-${i}`}
            className="cursor-col-resize bg-border/30 hover:bg-accent/40 active:bg-accent/60 transition-colors"
            style={{
              gridColumn: `${(i + 1) * 2}`,
              gridRow: `1 / span ${rows * 2 - 1}`,
            }}
            onMouseDown={(e) => onColDrag(i, e)}
          />
        ))}
        {Array.from({ length: rows - 1 }, (_, j) => (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: thanh ngăn hàng — index ổn định
            key={`rh-${j}`}
            className="cursor-row-resize bg-border/30 hover:bg-accent/40 active:bg-accent/60 transition-colors"
            style={{
              gridColumn: `1 / span ${cols * 2 - 1}`,
              gridRow: `${(j + 1) * 2}`,
            }}
            onMouseDown={(e) => onRowDrag(j, e)}
          />
        ))}
        {/* Content cells — rendered last, on top of handle divs */}
        {cells.map((cell) => {
          const kind = cell.kind ?? "list";
          const cellCfg = buildSubCfg(cell as SplitPanelCfg, splitKey);
          return (
            <div key={cell.id} className="overflow-hidden" style={cellStyle(cell)}>
              {cell.entity || cell.dataSourceId ? (
                <RenderSubWidget kind={kind} cfg={cellCfg} stateKey={`${comp.id}:${cell.id}`} />
              ) : (
                <div className="h-full flex items-center justify-center text-sm text-muted/50">
                  Chưa bind
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SplitWidget({ comp }: { comp: PageComponent }) {
  const cfg = comp.config ?? {};
  const splitKey = `split_${comp.id}_sel`;

  const orientation = (cfg.orientation as string) ?? "h";
  const count = Math.max(2, Math.min(3, (cfg.count as number) ?? 2));
  const isTabs = orientation === "tabs";
  const isBoth = orientation === "both";
  const isBoth2 = orientation === "both2";
  const isBoth3 = orientation === "both3";
  const isBoth4 = orientation === "both4";
  const isBoth5 = orientation === "both5";
  const isH =
    !isBoth && !isBoth2 && !isBoth3 && !isBoth4 && !isBoth5 && !isTabs && orientation !== "v";

  const panelA = (cfg.panelA as SplitPanelCfg | undefined) ?? {};
  const panelB = (cfg.panelB as SplitPanelCfg | undefined) ?? {};
  const panelC = (cfg.panelC as SplitPanelCfg | undefined) ?? {};
  const panelD = (cfg.panelD as SplitPanelCfg | undefined) ?? {};
  const kindA = panelA.kind ?? "list";
  const kindB = panelB.kind ?? "detail";
  const kindC = panelC.kind ?? "list";
  const kindD = panelD.kind ?? "list";
  const cfgA = buildSubCfg({ ...panelA, kind: kindA, linkField: undefined }, splitKey, "a");
  const cfgB = buildSubCfg({ ...panelB, kind: kindB }, splitKey, "b");
  const cfgC = buildSubCfg({ ...panelC, kind: kindC }, splitKey, "c");
  const cfgD = buildSubCfg({ ...panelD, kind: kindD }, splitKey, "d");

  // Ratios — initialized from saved config, adjusted by drag at runtime only
  const savedRatios = cfg.splitRatios as number[] | undefined;
  const initRatioH = (cfg.ratio as number) ?? 40;
  const initRatioV = (cfg.ratioV as number) ?? 50;
  const initRatioV2 = (cfg.ratioV2 as number) ?? 50;
  const panelCount = isBoth || isBoth2 || isBoth3 || isBoth4 || isBoth5 ? 2 : count;
  const initMain = savedRatios ?? (panelCount >= 3 ? [33, 33, 34] : [initRatioH, 100 - initRatioH]);
  const initBothV = [initRatioV, 100 - initRatioV];
  const initBothV2 = [initRatioV2, 100 - initRatioV2];

  // All hooks unconditional (React rules)
  const containerRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  const rightRef2 = useRef<HTMLDivElement>(null);
  const subRowRef = useRef<HTMLDivElement>(null);
  const subRowRef2 = useRef<HTMLDivElement>(null);
  const mainRef = containerRef as React.RefObject<HTMLDivElement | null>;
  const bvRef = rightRef as React.RefObject<HTMLDivElement | null>;
  const bvRef2 = rightRef2 as React.RefObject<HTMLDivElement | null>;
  const bhRef = subRowRef as React.RefObject<HTMLDivElement | null>;
  const bhRef2 = subRowRef2 as React.RefObject<HTMLDivElement | null>;
  const { ratios: mainR, onHandleDrag: onMainDrag } = useSplitRatios(
    initMain,
    mainRef,
    isH || isBoth || isBoth2 || isBoth3 ? "h" : "v",
  );
  const { ratios: bothVR, onHandleDrag: onBothVDrag } = useSplitRatios(initBothV, bvRef, "v");
  const { ratios: bothVR2, onHandleDrag: onBothVDrag2 } = useSplitRatios(initBothV2, bvRef2, "v");
  // both4/both5: sub-row horizontal split (reuse ratioV for ratio source)
  const { ratios: bothHR, onHandleDrag: onBothHDrag } = useSplitRatios(initBothV, bhRef, "h");
  const { ratios: bothHR2, onHandleDrag: onBothHDrag2 } = useSplitRatios(initBothV, bhRef2, "h");
  const [activeTab, setActiveTab] = useState("A");

  const handleCls = (ax: "h" | "v") =>
    `shrink-0 ${ax === "h" ? "w-1.5 cursor-col-resize" : "h-1.5 cursor-row-resize"} bg-border hover:bg-accent/50 transition-colors active:bg-accent`;

  // ── Tabs ──────────────────────────────────────────────────────────────
  if (isTabs) {
    const tabDefs = [
      { key: "A", cfg: cfgA, kind: kindA, label: panelA.title || "A" },
      { key: "B", cfg: cfgB, kind: kindB, label: panelB.title || "B" },
      ...(count >= 3 ? [{ key: "C", cfg: cfgC, kind: kindC, label: panelC.title || "C" }] : []),
    ];
    return (
      <div className="flex flex-col h-full overflow-hidden">
        <div className="flex border-b border-border shrink-0">
          {tabDefs.map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => setActiveTab(p.key)}
              className={cn(
                "px-4 py-2 text-sm -mb-px border-b-2 transition-colors whitespace-nowrap",
                activeTab === p.key
                  ? "border-accent text-accent font-medium"
                  : "border-transparent text-muted hover:text-text",
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="flex-1 overflow-hidden">
          {tabDefs.map((p) => (
            <div
              key={p.key}
              className="h-full overflow-hidden"
              style={{ display: activeTab === p.key ? "block" : "none" }}
            >
              <RenderSubWidget
                kind={p.kind}
                cfg={p.cfg}
                stateKey={`${comp.id}:${p.key.toLowerCase()}`}
              />
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ── Both (A | B trên / C dưới) ────────────────────────────────────────
  if (isBoth) {
    const total = mainR[0]! + mainR[1]!;
    const hPct = (mainR[0]! / total) * 100;
    const vTotal = bothVR[0]! + bothVR[1]!;
    const vPct = (bothVR[0]! / vTotal) * 100;
    return (
      <div ref={containerRef} className="flex flex-row h-full overflow-hidden">
        <div className="overflow-hidden" style={{ width: `${hPct}%` }}>
          <RenderSubWidget kind={kindA} cfg={cfgA} stateKey={`${comp.id}:a`} />
        </div>
        <div onMouseDown={(e) => onMainDrag(0, e)} className={handleCls("h")} />
        <div ref={rightRef} className="flex flex-col flex-1 overflow-hidden">
          <div className="overflow-hidden" style={{ height: `${vPct}%` }}>
            <RenderSubWidget kind={kindB} cfg={cfgB} stateKey={`${comp.id}:b`} />
          </div>
          <div onMouseDown={(e) => onBothVDrag(0, e)} className={handleCls("v")} />
          <div className="flex-1 overflow-hidden">
            <RenderSubWidget kind={kindC} cfg={cfgC} stateKey={`${comp.id}:c`} />
          </div>
        </div>
      </div>
    );
  }

  // ── Both2 ((A trên / B dưới) | C) ────────────────────────────────────
  if (isBoth2) {
    const total = mainR[0]! + mainR[1]!;
    const hPct = (mainR[0]! / total) * 100;
    const vTotal = bothVR[0]! + bothVR[1]!;
    const vPct = (bothVR[0]! / vTotal) * 100;
    return (
      <div ref={containerRef} className="flex flex-row h-full overflow-hidden">
        <div ref={rightRef} className="flex flex-col overflow-hidden" style={{ width: `${hPct}%` }}>
          <div className="overflow-hidden" style={{ height: `${vPct}%` }}>
            <RenderSubWidget kind={kindA} cfg={cfgA} stateKey={`${comp.id}:a`} />
          </div>
          <div onMouseDown={(e) => onBothVDrag(0, e)} className={handleCls("v")} />
          <div className="flex-1 overflow-hidden">
            <RenderSubWidget kind={kindB} cfg={cfgB} stateKey={`${comp.id}:b`} />
          </div>
        </div>
        <div onMouseDown={(e) => onMainDrag(0, e)} className={handleCls("h")} />
        <div className="flex-1 overflow-hidden">
          <RenderSubWidget kind={kindC} cfg={cfgC} stateKey={`${comp.id}:c`} />
        </div>
      </div>
    );
  }

  // ── Both3 ((A/B) | (C/D)) ────────────────────────────────────────────
  if (isBoth3) {
    const total3 = mainR[0]! + mainR[1]!;
    const hPct = (mainR[0]! / total3) * 100;
    const vTotal = bothVR[0]! + bothVR[1]!;
    const vPct = (bothVR[0]! / vTotal) * 100;
    const vTotal2 = bothVR2[0]! + bothVR2[1]!;
    const vPct2 = (bothVR2[0]! / vTotal2) * 100;
    return (
      <div ref={containerRef} className="flex flex-row h-full overflow-hidden">
        <div ref={rightRef} className="flex flex-col overflow-hidden" style={{ width: `${hPct}%` }}>
          <div className="overflow-hidden" style={{ height: `${vPct}%` }}>
            <RenderSubWidget kind={kindA} cfg={cfgA} stateKey={`${comp.id}:a`} />
          </div>
          <div onMouseDown={(e) => onBothVDrag(0, e)} className={handleCls("v")} />
          <div className="flex-1 overflow-hidden">
            <RenderSubWidget kind={kindB} cfg={cfgB} stateKey={`${comp.id}:b`} />
          </div>
        </div>
        <div onMouseDown={(e) => onMainDrag(0, e)} className={handleCls("h")} />
        <div ref={rightRef2} className="flex flex-col flex-1 overflow-hidden">
          <div className="overflow-hidden" style={{ height: `${vPct2}%` }}>
            <RenderSubWidget kind={kindC} cfg={cfgC} stateKey={`${comp.id}:c`} />
          </div>
          <div onMouseDown={(e) => onBothVDrag2(0, e)} className={handleCls("v")} />
          <div className="flex-1 overflow-hidden">
            <RenderSubWidget kind={kindD} cfg={cfgD} stateKey={`${comp.id}:d`} />
          </div>
        </div>
      </div>
    );
  }

  // ── Both4 (A trên / B trái dưới, C phải dưới) ────────────────────────
  if (isBoth4) {
    const total = mainR[0]! + mainR[1]!;
    const vPct = (mainR[0]! / total) * 100;
    const hTotal = bothHR[0]! + bothHR[1]!;
    const hPct = (bothHR[0]! / hTotal) * 100;
    return (
      <div ref={containerRef} className="flex flex-col h-full overflow-hidden">
        <div className="overflow-hidden" style={{ height: `${vPct}%` }}>
          <RenderSubWidget kind={kindA} cfg={cfgA} stateKey={`${comp.id}:a`} />
        </div>
        <div onMouseDown={(e) => onMainDrag(0, e)} className={handleCls("v")} />
        <div ref={subRowRef} className="flex flex-row flex-1 overflow-hidden">
          <div className="overflow-hidden" style={{ width: `${hPct}%` }}>
            <RenderSubWidget kind={kindB} cfg={cfgB} stateKey={`${comp.id}:b`} />
          </div>
          <div onMouseDown={(e) => onBothHDrag(0, e)} className={handleCls("h")} />
          <div className="flex-1 overflow-hidden">
            <RenderSubWidget kind={kindC} cfg={cfgC} stateKey={`${comp.id}:c`} />
          </div>
        </div>
      </div>
    );
  }

  // ── Both5 (A trái trên, B phải trên / C dưới) ─────────────────────────
  if (isBoth5) {
    const total = mainR[0]! + mainR[1]!;
    const vPct = (mainR[0]! / total) * 100;
    const hTotal = bothHR2[0]! + bothHR2[1]!;
    const hPct = (bothHR2[0]! / hTotal) * 100;
    return (
      <div ref={containerRef} className="flex flex-col h-full overflow-hidden">
        <div
          ref={subRowRef2}
          className="flex flex-row overflow-hidden"
          style={{ height: `${vPct}%` }}
        >
          <div className="overflow-hidden" style={{ width: `${hPct}%` }}>
            <RenderSubWidget kind={kindA} cfg={cfgA} stateKey={`${comp.id}:a`} />
          </div>
          <div onMouseDown={(e) => onBothHDrag2(0, e)} className={handleCls("h")} />
          <div className="flex-1 overflow-hidden">
            <RenderSubWidget kind={kindB} cfg={cfgB} stateKey={`${comp.id}:b`} />
          </div>
        </div>
        <div onMouseDown={(e) => onMainDrag(0, e)} className={handleCls("v")} />
        <div className="flex-1 overflow-hidden">
          <RenderSubWidget kind={kindC} cfg={cfgC} stateKey={`${comp.id}:c`} />
        </div>
      </div>
    );
  }

  // ── H / V (2 hoặc 3 panels) ───────────────────────────────────────────
  const flexDir = isH ? "flex-row" : "flex-col";
  const sizeKey = isH ? "width" : "height";
  const dragAxis = isH ? "h" : "v";
  const total = mainR.reduce((a, b) => a + b, 0);
  const allPanels = [
    { key: "a", cfg: cfgA, kind: kindA },
    { key: "b", cfg: cfgB, kind: kindB },
    ...(panelCount >= 3 ? [{ key: "c", cfg: cfgC, kind: kindC }] : []),
  ];

  return (
    <div ref={containerRef} className={`flex ${flexDir} h-full overflow-hidden`}>
      {allPanels.map((p, idx) => {
        const isLast = idx === allPanels.length - 1;
        const pct = ((mainR[idx] ?? 1) / total) * 100;
        return (
          <Fragment key={p.key}>
            <div
              className="overflow-hidden"
              style={isLast ? { flex: 1 } : { [sizeKey]: `${pct}%` }}
            >
              <RenderSubWidget kind={p.kind} cfg={p.cfg} stateKey={`${comp.id}:${p.key}`} />
            </div>
            {!isLast && (
              <div onMouseDown={(e) => onMainDrag(idx, e)} className={handleCls(dragAxis)} />
            )}
          </Fragment>
        );
      })}
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

/** Widget "filter" — bộ lọc header: Hệ hàng → Sản phẩm (cascade) + "Nạp lại".
 *  Chọn sản phẩm → set pageState[emitStateKey] = mã SP → list (loadGate +
 *  loadFilters fromState) MỚI tải định mức của SP đó (server-side, đúng tập).
 *  Dữ liệu SP lấy từ datasource gọn (cfg.dataSourceId = ds_sanpham_filter). */
function FilterWidget({ cfg }: { cfg: Record<string, unknown> }) {
  const pageState = usePageState();
  const { rows, loading } = useWidgetData(cfg);
  const familyField = (cfg.familyField as string) || "hehang";
  const valueField = (cfg.valueField as string) || "masp";
  const labelField = (cfg.labelField as string) || "tensp";
  const emitStateKey = (cfg.emitStateKey as string) || "selMasp";
  const refreshDsId = cfg.refreshDataSourceId as string | undefined;
  const [hehang, setHehang] = useState("");
  const masp = (pageState.get(emitStateKey) as string) ?? "";
  const isMobile = useIsMobile();

  const families = useMemo(() => {
    const s = new Set<string>();
    for (const r of rows) {
      const v = r[familyField];
      if (v != null && v !== "") s.add(String(v));
    }
    return [...s].sort((a, b) => a.localeCompare(b)).map((v) => ({ value: v, label: v }));
  }, [rows, familyField]);

  const productOptions = useMemo(() => {
    const list = hehang ? rows.filter((r) => String(r[familyField] ?? "") === hehang) : rows;
    return list.map((r) => {
      const code = String(r[valueField] ?? "");
      const name = String(r[labelField] ?? "");
      return { value: code, label: name ? `${code} — ${name}` : code };
    });
  }, [rows, hehang, familyField, valueField, labelField]);

  // NHỚ lựa chọn (hệ hàng + sản phẩm) qua điều hướng: lưu localStorage theo
  // emitStateKey (chung cho các trang cùng bộ lọc). Mở lại / qua trang khác →
  // khôi phục cả 2 → list tự tải định mức của SP đã chọn.
  const persistKey = `filter-sel:${emitStateKey}`;
  const skipSaveRef = useRef(true);
  // biome-ignore lint/correctness/useExhaustiveDependencies: chỉ khôi phục 1 lần khi mount (persistKey ổn định)
  useEffect(() => {
    try {
      const r = localStorage.getItem(persistKey);
      if (r) {
        const saved = JSON.parse(r) as { hehang?: string; masp?: string };
        if (saved.hehang) setHehang(saved.hehang);
        if (saved.masp) pageState.set(emitStateKey, saved.masp);
      }
    } catch {}
  }, [persistKey]);
  useEffect(() => {
    // Bỏ lần lưu đầu (mount) để không ghi đè giá trị đã lưu bằng giá trị rỗng
    // trước khi effect khôi phục chạy.
    if (skipSaveRef.current) {
      skipSaveRef.current = false;
      return;
    }
    try {
      localStorage.setItem(persistKey, JSON.stringify({ hehang, masp }));
    } catch {}
  }, [hehang, masp, persistKey]);

  const reloadBtn = (
    <button
      type="button"
      onClick={() => {
        if (refreshDsId) pageState.set(`__refresh:ds:${refreshDsId}`, Date.now());
      }}
      className="btn btn-sm btn-default shrink-0"
      title="Tải lại định mức của sản phẩm đang chọn"
    >
      <I.RefreshCw size={13} /> Nạp lại
    </button>
  );

  return (
    // Mobile: label TRÊN combobox (xếp dọc) + nút Nạp lại cùng dòng combobox Hệ
    // hàng. ≥md: 1 hàng ngang, label inline. Select thu nhỏ 28px/12px.
    <div className="px-2 py-0.5 h-full flex flex-col md:flex-row md:flex-wrap md:items-center gap-1 text-xs">
      {/* Hệ hàng */}
      <div className="flex flex-col md:flex-row md:items-center gap-1">
        <span className="text-muted shrink-0">Hệ hàng</span>
        <div className="flex items-center gap-1">
          <div className="flex-1 md:flex-none md:w-40">
            <SearchableSelect
              className="w-full"
              triggerClassName="h-7! text-xs!"
              value={hehang}
              onChange={(v) => {
                setHehang(v);
                // Đổi hệ hàng → reset sản phẩm → list ẩn (chờ chọn lại SP).
                pageState.set(emitStateKey, "");
              }}
              options={families}
              emptyOption="— Tất cả —"
            />
          </div>
          {/* Mobile: Nạp lại cùng dòng combobox Hệ hàng */}
          {isMobile && reloadBtn}
        </div>
      </div>
      {/* Sản phẩm */}
      <div className="flex flex-col md:flex-row md:items-center gap-1 md:flex-1 md:min-w-[200px]">
        <span className="text-muted shrink-0">
          Sản phẩm{loading ? " (đang tải…)" : ` (${productOptions.length})`}
        </span>
        <div className="md:flex-1 md:min-w-0">
          <SearchableSelect
            className="w-full"
            triggerClassName="h-7! text-xs!"
            wrapOptions
            value={masp}
            onChange={(v) => pageState.set(emitStateKey, v)}
            options={productOptions}
            emptyOption="— Chọn sản phẩm —"
          />
        </div>
      </div>
      {/* ≥md: Nạp lại ở cuối hàng */}
      {!isMobile && reloadBtn}
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
    // Bảng lớn: serverPaging → phân trang/sắp/lọc server-side (hỗ trợ cả sửa ô).
    if (cfg.serverPaging === true && cfg.excelMode !== true)
      return withEmbeddedActions(
        <ServerPagedListWidget
          entityId={cfg.entity as string | undefined}
          dataSourceId={cfg.dataSourceId as string | undefined}
          stateKey={stateKey}
          fields={cfg.fields as string[] | undefined}
          columnLabels={cfg.columnLabels as Record<string, string> | undefined}
          columnGroups={cfg.columnGroups as ColumnGroupNode[] | undefined}
          selectionStateKey={cfg.selectionStateKey as string | undefined}
          title={cfg.title as string | undefined}
          multiSelect={cfg.multiSelect === true}
          editable={cfg.editable === true}
          batchEdit={cfg.batchEdit === true}
          pageSize={cfg.pageSize as number | undefined}
          loadFilters={cfg.loadFilters as LoadFilters | undefined}
          loadGate={cfg.loadGate as string | undefined}
          selectable={cfg.selectable === true}
        />,
        embActs,
        pageState,
      );
    return withEmbeddedActions(
      <ListWidget
        entityId={cfg.entity as string | undefined}
        dataSourceId={cfg.dataSourceId as string | undefined}
        stateKey={stateKey}
        fields={cfg.fields as string[] | undefined}
        columnLabels={cfg.columnLabels as Record<string, string> | undefined}
        columnGroups={cfg.columnGroups as ColumnGroupNode[] | undefined}
        defaultGrouping={cfg.defaultGrouping as string[] | undefined}
        selectionStateKey={cfg.selectionStateKey as string | undefined}
        selectionField={cfg.selectionField as string | undefined}
        selectionEmits={cfg.selectionEmits as Record<string, string> | undefined}
        filterFromState={cfg.filterFromState as { field: string; stateKey: string } | undefined}
        filterConditions={
          cfg.filterConditions as Array<{ field: string; stateKey: string }> | undefined
        }
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
        rowDetail={cfg.rowDetail as RowDetailCfg | undefined}
        createForm={cfg.createForm as CreateFormCfg | undefined}
        editForm={cfg.editForm as CreateFormCfg | undefined}
        rowActions={cfg.rowActions as ActionConfig[] | undefined}
        rowActionsBuiltin={cfg.rowActionsBuiltin === true}
        editFields={cfg.editFields as string[] | undefined}
        rowActionsHidden={cfg.rowActionsHidden as string[] | undefined}
        rowActionsStyle={cfg.rowActionsStyle as "inline" | "popover" | undefined}
        selectable={cfg.selectable === true}
        addRowAtEnd={cfg.addRowAtEnd === true}
        addRowPos={cfg.addRowPos === "top" ? "top" : "bottom"}
        defaultSort={cfg.defaultSort as { field: string; dir: "asc" | "desc" } | undefined}
        // Có createForm → nút embeddedActions (vd Nạp lại) render CÙNG hàng với
        // nút "Thêm mới" trong header ListWidget; khi đó strip trên để rỗng.
        embeddedActions={cfg.createForm ? embActs : undefined}
        embeddedFilters={
          cfg.createForm ? (cfg.embeddedFilters as EmbeddedFilter[] | undefined) : undefined
        }
        refetchOnSave={cfg.refetchOnSave === true}
        valueLabels={cfg.valueLabels as Record<string, Record<string, string>> | undefined}
      />,
      cfg.createForm ? [] : embActs,
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
  if (comp.kind === "grid") return <GridWidget comp={comp} />;
  if (comp.kind === "search") return <SearchWidget cfg={cfg} />;
  if (comp.kind === "filter") return <FilterWidget cfg={cfg} />;
  if (comp.kind === "combobox") return <ComboboxWidget cfg={cfg} />;
  if (comp.kind === "listbox") return <ListboxWidget cfg={cfg} />;
  if (comp.kind === "tagbox") return <TagboxWidget cfg={cfg} />;
  if (comp.kind === "calendar") return <CalendarWidget cfg={cfg} />;
  if (comp.kind === "map") return <MapWidget cfg={cfg} />;
  if (comp.kind === "pivot") return <PivotWidget cfg={cfg} />;
  if (comp.kind === "document") return <DocumentWidget cfg={cfg} />;
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

/** Quy tắc ẩn/hiện widget theo 1 state key (vd selKetcau). Đặt ở cfg.visibleWhen. */
type VisibleRule = {
  stateKey: string;
  op: "eq" | "neq" | "in" | "nin" | "set" | "notset";
  value?: string | string[];
};
function evalVisible(rule: VisibleRule, pageState: ReturnType<typeof usePageState>): boolean {
  const raw = pageState.get(rule.stateKey);
  const sv = raw == null ? "" : String(raw);
  const arr = Array.isArray(rule.value) ? rule.value.map(String) : [];
  switch (rule.op) {
    case "eq":
      return sv === String(rule.value ?? "");
    case "neq":
      return sv !== String(rule.value ?? "");
    case "in":
      return arr.includes(sv);
    case "nin":
      return !arr.includes(sv);
    case "set":
      return sv !== "";
    case "notset":
      return sv === "";
    default:
      return true;
  }
}
/** Bọc 1 widget: ẩn hẳn (không render ô) khi visibleWhen không thỏa. Chế độ sửa
 *  bố cục (editing) luôn hiện để còn sắp xếp được. */
function VisibilityGate({
  rule,
  editing,
  children,
}: {
  rule?: VisibleRule;
  editing: boolean;
  children: React.ReactNode;
}) {
  const pageState = usePageState();
  if (editing || !rule) return <>{children}</>;
  return evalVisible(rule, pageState) ? children : null;
}

export function ConsumerPage({
  pageId,
  chromeless = false,
  active = false,
}: {
  pageId: string;
  /** Portal: bỏ thanh tiêu đề trong trang; đẩy nút điều khiển bố cục lên header
   *  portal (slot #portal-page-actions) qua createPortal. */
  chromeless?: boolean;
  /** Trang đang xem (chỉ trang active mới đẩy nút lên slot — tránh chồng nút). */
  active?: boolean;
}) {
  const t = useT();
  const isMobile = useIsMobile();
  const content = useUserObjects((s) => s.pageContent[pageId]);
  const userId = useAuth((s) => s.user?.id ?? null);

  // Slot header portal cho nút điều khiển bố cục khi chromeless.
  const [actionSlot, setActionSlot] = useState<HTMLElement | null>(null);
  useEffect(() => {
    if (chromeless) setActionSlot(document.getElementById("portal-page-actions"));
  }, [chromeless]);

  // Hỗ trợ 2 định dạng content: mảng cũ (PageComponent[]) hoặc mới { meta, components }.
  type RawContent =
    | PageComponent[]
    | { meta?: Record<string, unknown>; components?: PageComponent[] };
  const rawContent = content as RawContent;
  const baseComponents: PageComponent[] = Array.isArray(rawContent)
    ? (rawContent as PageComponent[])
    : ((rawContent as { components?: PageComponent[] }).components ?? []);
  const pageMeta: Record<string, unknown> = Array.isArray(rawContent)
    ? {}
    : ((rawContent as { meta?: Record<string, unknown> }).meta ?? {});
  const screenFit = !!pageMeta.screenFit;

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

  // Tự KHÍT viewport: widget cuộn được (list/chart/…) ở ĐÁY trang được giãn
  // số hàng (span) để lấp hết chiều cao còn lại của khung main → trang KHÔNG
  // cuộn ngoài, chỉ cuộn trong widget đó. Chỉ desktop + không sửa layout.
  const fillId = useMemo(() => {
    // screenFit: toàn bộ lưới co giãn theo viewport → không cần fillId riêng.
    if (isMobile || layoutEditing || screenFit) return null;
    const FILL = new Set(["list", "chart", "kanban", "pivot", "table"]);

    // Ưu tiên: widget có config.fillHeight === true (opt-in tường minh).
    const explicit = renderComps.filter((c) => c.config?.fillHeight === true && FILL.has(c.kind));
    if (explicit.length === 1) return explicit[0]?.id ?? null;
    // Nhiều widget opt-in → dùng screenFit thay vì fillId; không tự chọn 1.
    if (explicit.length > 1) return null;

    // Fallback: auto-detect widget cuộn được ở đáy (hành vi cũ).
    let bottom: PageComponent | null = null;
    let bottomEnd = -1;
    let tieCount = 0; // số widget cùng chạm hàng đáy (y+h lớn nhất)
    for (const c of renderComps) {
      const end = (c.y ?? 0) + (c.h ?? 0);
      if (end > bottomEnd) {
        bottomEnd = end;
        bottom = c;
        tieCount = 1;
      } else if (end === bottomEnd) {
        tieCount++;
      }
    }
    // Nhiều widget cùng chạm đáy (vd các cột full-height cạnh nhau: trái/giữa/phải
    // đều y=0,h=20) → KHÔNG có widget "đáy" duy nhất để giãn. Nếu vẫn giãn 1 widget
    // (gridRow "1/-1" + gridTemplateRows 1 hàng 1fr) thì các widget kia span nhiều
    // hàng tạo hàng ngầm 76px → ép hàng 1fr co về ~0 → widget fill bị ẩn. Bỏ fill,
    // để lưới render tự nhiên theo h (mọi cột cao bằng nhau, đều hiển thị).
    if (tieCount > 1) return null;
    return bottom && FILL.has(bottom.kind) ? bottom.id : null;
  }, [renderComps, isMobile, layoutEditing, screenFit]);
  const [availH, setAvailH] = useState(0);
  useEffect(() => {
    if (!fillId && !screenFit) {
      setAvailH(0);
      return;
    }
    const measure = () => {
      const top = gridRef.current?.getBoundingClientRect().top ?? 0;
      setAvailH(Math.max(0, window.innerHeight - top - 8));
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [fillId, screenFit]);
  // Hàng (1-based) bắt đầu của widget fill — để dựng gridTemplateRows: các hàng
  // trên cố định ROW_H, hàng widget fill = 1fr → lấp KHÍT phần dư (không làm
  // tròn theo bội số ROW_H như cách giãn span cũ → hết khoảng trống dưới list).
  const fillRowStart = useMemo(() => {
    const fc = renderComps.find((c) => c.id === fillId);
    return fc ? (fc.y ?? 0) + 1 : 0;
  }, [renderComps, fillId]);
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

  // Nút điều khiển bố cục (Mặc định / Sắp xếp / Xong) — chỉ dùng cho header portal (chromeless).
  const headerControls = (
    <>
      {/* Nút trở về mặc định — hiện khi có bố cục cá nhân */}
      {hasPersonal && !layoutEditing && !isMobile && (
        <button
          type="button"
          onClick={handleReset}
          className="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-md border border-border hover:bg-danger/10 hover:border-danger/40 hover:text-danger text-muted transition-colors"
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
          className="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-md bg-accent text-white hover:bg-accent/90 font-medium"
        >
          <I.Check size={13} />
          Xong
        </button>
      ) : (
        <button
          type="button"
          onClick={enterEdit}
          className="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-md border border-border hover:bg-hover text-muted"
        >
          <I.Grip size={13} />
          Sắp xếp
        </button>
      )}
    </>
  );

  return (
    <PageStateProvider>
      <div ref={canvasRef} className="overflow-y-auto overflow-x-hidden h-full">
        {/* Nội dung trang full width (bỏ giới hạn max-w để tràn 100%).
            px trái/phải = 1px để thành phần sát mép; giữ py trên/dưới. */}
        <div className="py-0.5 px-px">
          {/* Chromeless (portal): CHỈ trang đang xem đẩy nút lên header portal. */}
          {chromeless &&
            active &&
            actionSlot &&
            createPortal(
              <div className="flex items-center gap-1.5">{headerControls}</div>,
              actionSlot,
            )}

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
                className="grid gap-1"
                style={{
                  gridTemplateColumns: isMobile ? "1fr" : "repeat(12, 1fr)",
                  // screenFit → mỗi hàng 1fr (chia tỷ lệ theo h);
                  // mặc định: ROW_H px cố định (mobile = auto-fit nội dung).
                  gridAutoRows: isMobile
                    ? "auto"
                    : !layoutEditing && screenFit && availH > 0
                      ? "1fr"
                      : `${ROW_H}px`,
                  // screenFit: ghim chiều cao = availH để fr hoạt động.
                  ...(!isMobile && !layoutEditing && screenFit && availH > 0
                    ? { height: availH }
                    : // fillId: 1 widget đáy lấp hết chiều cao còn lại (hành vi cũ).
                      !isMobile && fillId && availH > 0 && fillRowStart > 0
                      ? {
                          height: availH,
                          // fillRowStart===1 → repeat(0,…) CSS không hợp lệ → chỉ
                          // phát repeat khi có hàng trên widget fill.
                          gridTemplateRows:
                            fillRowStart > 1
                              ? `repeat(${fillRowStart - 1}, auto) minmax(0, 1fr)`
                              : "minmax(0, 1fr)",
                        }
                      : {}),
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
                  // Widget fill (đáy, cuộn được): giãn span để lấp hết viewport.
                  let h = c.h || 2;
                  if (c.id === fillId && availH > 0) {
                    const GAP = 4; // gap-1 giữa các hàng
                    const availForFill = availH - (rowStart - 1) * (ROW_H + GAP);
                    h = Math.max(2, Math.floor((availForFill + GAP) / (ROW_H + GAP)));
                  }
                  const isBeingDragged = dragCompId === c.id;
                  const isBeingResized = resizingId === c.id;
                  return (
                    <VisibilityGate
                      key={c.id}
                      rule={(c.config as { visibleWhen?: VisibleRule } | undefined)?.visibleWhen}
                      editing={layoutEditing}
                    >
                      <div
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
                                // Widget fill: span tới HÀNG CUỐI (1fr) để lấp khít;
                                // còn lại span theo số hàng h.
                                gridRow:
                                  c.id === fillId && availH > 0
                                    ? `${rowStart} / -1`
                                    : `${rowStart} / span ${h}`,
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
                    </VisibilityGate>
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
