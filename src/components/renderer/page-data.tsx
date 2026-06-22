/* Foundation dữ liệu cho renderer: api client, page-state context/provider/hook,
   và các hook đọc record (entity + datasource, client-window + server-paged) +
   hook meta. ConsumerPage và mọi widget tách ra đều import từ đây. Chỉ DI CHUYỂN
   code từ ConsumerPage.tsx (Phase A2), KHÔNG đổi hành vi. */
import { createApiDataSource } from "@erp-framework/client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ServerGridQuery } from "@/components/renderer/DataGrid";
import type {
  AggSpec,
  LoadFilterOp,
  LoadFilters,
  PageStateCtx,
  PageStateValue,
  RefFillResult,
  ServerPagedResult,
  UseRecordsOpts,
  WidgetData,
} from "@/components/renderer/page-types";
import type { EntityField, MockEntity } from "@/lib/object-types";
import { idbGet, idbSet } from "@/lib/page-state-idb";
import { useUserObjects } from "@/stores/userObjects";

export const api = createApiDataSource("");

const PageStateContext = createContext<PageStateCtx | null>(null);

export function PageStateProvider({
  children,
  pageId,
}: {
  children: React.ReactNode;
  pageId?: string;
}) {
  const [values, setValues] = useState<Record<string, PageStateValue>>({});
  const idbKey = pageId ? `pageState:${pageId}` : null;

  // Restore từ IDB 1 lần khi mount (chỉ các key không phải refresh signal).
  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current || !idbKey) return;
    restoredRef.current = true;
    idbGet<Record<string, PageStateValue>>(idbKey).then((saved) => {
      if (!saved) return;
      // Bỏ qua __refresh:* — tín hiệu 1 lần, không có nghĩa sau reload.
      const clean: Record<string, PageStateValue> = {};
      for (const [k, v] of Object.entries(saved)) {
        if (!k.startsWith("__refresh:")) clean[k] = v;
      }
      if (Object.keys(clean).length > 0) setValues(clean);
    });
  }, [idbKey]);

  // Debounce save — bỏ __refresh:* để không lưu tín hiệu tạm thời.
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!idbKey) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const clean: Record<string, PageStateValue> = {};
      for (const [k, v] of Object.entries(values)) {
        if (!k.startsWith("__refresh:")) clean[k] = v;
      }
      void idbSet(idbKey, clean);
    }, 400);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [idbKey, values]);

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

export function usePageState(): PageStateCtx {
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

/** Số dòng mặc định khi widget không cấu hình rowLimit. */
export const DEFAULT_ROW_LIMIT = 500;
/** Trần cứng — khớp queryParams.limit.max(10_000) ở server (tránh lỗi validate). */
const MAX_ROW_LIMIT = 10_000;

/** Suy ra UseRecordsOpts từ config widget + page-state.
 *  - rowLimit  : số dòng (number > 0).
 *  - loadFilters: điều kiện server-side {field: {op, value}}.
 *  - loadGate  : stateKey — chỉ tải khi state này có giá trị. */
function useDataOpts(cfg: Record<string, unknown>): UseRecordsOpts {
  const pageState = usePageState();
  const rawLimit = cfg.rowLimit ?? cfg.pageSize;
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
          console.error("[useRecords] entity:", entityId, "filters:", filtersKey, "err:", e);
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

export function useEntity(entityId?: string): MockEntity | undefined {
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
export function useServerPagedRecords(opts: {
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

/* ── Hook hợp nhất — widget bind ENTITY (cfg.entity) hoặc DATASOURCE
   (cfg.dataSourceId). Nhánh entity giữ NGUYÊN hành vi cũ (tương thích
   ngược); nhánh datasource đọc/ghi row phẳng đã join. */
export function useWidgetData(cfg: Record<string, unknown>): WidgetData {
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
export function useWidgetMeta(cfg: Record<string, unknown>): {
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
