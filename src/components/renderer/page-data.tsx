/* Foundation dữ liệu cho renderer: api client, page-state context/provider/hook,
   và các hook đọc record (entity + datasource, client-window + server-paged) +
   hook meta. ConsumerPage và mọi widget tách ra đều import từ đây. Chỉ DI CHUYỂN
   code từ ConsumerPage.tsx (Phase A2), KHÔNG đổi hành vi. */
import { createApiDataSource } from "@erp-framework/client";
import { useQuery } from "@tanstack/react-query";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
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

/** Cache module: dsId → Promise<meta> — tránh fetch song song khi nhiều widget
 *  cùng dùng một DataSource trên cùng trang. Promise được giữ sau khi resolve
 *  để phục vụ widget mount muộn mà không round-trip thêm. */
const _dsMetaCache = new Map<string, Promise<Awaited<ReturnType<typeof api.getDataSourceMeta>>>>();
function cachedGetDataSourceMeta(dsId: string) {
  if (!_dsMetaCache.has(dsId)) {
    _dsMetaCache.set(dsId, api.getDataSourceMeta(dsId));
  }
  // biome-ignore lint/style/noNonNullAssertion: vừa set nên chắc chắn có
  return _dsMetaCache.get(dsId)!;
}

/* ── External store cho page state ─────────────────────────────────────────
 * Tách khỏi React state để tránh re-render dây chuyền:
 *   - Context value = store object STABLE (không đổi identity theo state).
 *   - useSyncExternalStore cho subscriber chọn đúng granularity.
 *   - usePageStateKey(key): chỉ re-render khi ĐỦ key đó đổi.
 *   - usePageState(): subscribe ALL — backward-compat, không gây context cascade.
 *   - usePageDispatch(): stable get/set, không subscribe → không gây re-render.
 * ─────────────────────────────────────────────────────────────────────────── */

type Listener = () => void;

interface PageStore {
  /** Đọc giá trị theo key (không subscribe, luôn trả giá trị mới nhất). */
  get: (key: string) => PageStateValue;
  /** Ghi giá trị; no-op nếu giá trị không đổi; notify listener theo key + all. */
  set: (key: string, value: PageStateValue) => void;
  /** Subscribe MỌI thay đổi → trả hàm unsubscribe. */
  subscribe: (fn: Listener) => Listener;
  /** Subscribe 1 key cụ thể → trả hàm unsubscribe. */
  subscribeKey: (key: string, fn: Listener) => Listener;
  /** Snapshot toàn bộ values (immutable ref mới mỗi lần set). */
  getSnapshot: () => Record<string, PageStateValue>;
  /** Nạp batch initial values — dùng cho restore từ IDB. */
  init: (vals: Record<string, PageStateValue>) => void;
}

function createPageStore(): PageStore {
  let snap: Record<string, PageStateValue> = {};
  const all = new Set<Listener>();
  const byKey = new Map<string, Set<Listener>>();

  const notifyKey = (key: string) =>
    byKey.get(key)?.forEach((f) => {
      f();
    });
  const notifyAll = () =>
    all.forEach((f) => {
      f();
    });

  return {
    get: (key) => snap[key],
    getSnapshot: () => snap,
    set: (key, value) => {
      if (snap[key] === value) return;
      snap = { ...snap, [key]: value };
      notifyKey(key);
      notifyAll();
    },
    subscribe: (fn) => {
      all.add(fn);
      return () => void all.delete(fn);
    },
    subscribeKey: (key, fn) => {
      if (!byKey.has(key)) byKey.set(key, new Set());
      // biome-ignore lint/style/noNonNullAssertion: vừa set nên chắc chắn có
      byKey.get(key)!.add(fn);
      return () => void byKey.get(key)?.delete(fn);
    },
    init: (vals) => {
      snap = { ...snap, ...vals };
      for (const k of Object.keys(vals)) notifyKey(k);
      notifyAll();
    },
  };
}

/** Singleton fallback khi component render ngoài PageStateProvider (vd editor preview). */
const _nullStore: PageStore = {
  get: () => undefined,
  set: () => {},
  subscribe: () => () => {},
  subscribeKey: () => () => {},
  getSnapshot: () => ({}),
  init: () => {},
};

/** Context chứa PageStore ổn định — identity KHÔNG đổi theo state, tránh context cascade. */
const PageStateStoreCtx = createContext<PageStore>(_nullStore);

export function PageStateProvider({
  children,
  pageId,
}: {
  children: React.ReactNode;
  pageId?: string;
}) {
  // Tạo store 1 lần (stable ref) — không đặt trong useState để không trigger re-render cha
  const storeRef = useRef<PageStore | null>(null);
  if (!storeRef.current) {
    const s = createPageStore();
    // Nạp URL params vào store ngay khi tạo (đồng bộ) để widget đọc đúng từ render đầu tiên
    if (typeof window !== "undefined") {
      const init: Record<string, PageStateValue> = {};
      for (const [k, v] of new URLSearchParams(window.location.search).entries()) init[k] = v;
      if (Object.keys(init).length > 0) s.init(init);
    }
    storeRef.current = s;
  }
  const store = storeRef.current;

  const idbKey = pageId ? `pageState:${pageId}` : null;

  // Đồng bộ tham số URL query params vào store khi URL thay đổi
  const searchStr = typeof window !== "undefined" ? window.location.search : "";
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(searchStr);
    for (const [k, v] of params.entries()) {
      store.set(k, v);
    }
    for (const key of Object.keys(store.getSnapshot())) {
      if (key.startsWith("sel_") && !params.has(key)) {
        store.set(key, "");
      }
    }
  }, [searchStr, store]);

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
        if (!k.startsWith("__refresh:") && !k.startsWith("sel_")) clean[k] = v;
      }
      if (Object.keys(clean).length > 0) store.init(clean);
    });
  }, [idbKey, store]);

  // Debounce save khi store thay đổi — bỏ __refresh:* để không lưu tín hiệu tạm thời.
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!idbKey) return;
    const unsub = store.subscribe(() => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        const s = store.getSnapshot();
        const clean: Record<string, PageStateValue> = {};
        for (const [k, v] of Object.entries(s)) {
          if (!k.startsWith("__refresh:")) clean[k] = v;
        }
        void idbSet(idbKey, clean);
      }, 400);
    });
    return () => {
      unsub();
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [idbKey, store]);

  return <PageStateStoreCtx.Provider value={store}>{children}</PageStateStoreCtx.Provider>;
}

/** Subscribe MỌI thay đổi — backward-compat, re-render khi BẤT KỲ key đổi.
 *  Dùng cho widget đọc nhiều key động (useDataOpts, FilterItem, viz widgets…).
 *  KHÔNG gây context cascade (store context stable; subscription qua useSyncExternalStore). */
export function usePageState(): PageStateCtx {
  const store = useContext(PageStateStoreCtx);
  const values = useSyncExternalStore(store.subscribe, store.getSnapshot);
  // get/set stable từ store — memo chỉ tạo object mới khi values (snapshot) đổi
  return useMemo<PageStateCtx>(() => ({ values, get: store.get, set: store.set }), [values, store]);
}

/** Subscribe CHỈ 1 key — chỉ re-render khi KEY ĐÓ thay đổi.
 *  Dùng cho consumer nóng: VisibilityGate, input widgets, filter dropdowns.
 *  Key rỗng ("") → subscribe key không-tồn-tại, không gây re-render phụ. */
export function usePageStateKey(key: string): PageStateValue {
  const store = useContext(PageStateStoreCtx);
  const subscribe = useCallback((fn: () => void) => store.subscribeKey(key, fn), [store, key]);
  const getSnapshot = useCallback(() => store.get(key), [store, key]);
  return useSyncExternalStore(subscribe, getSnapshot);
}

/** Trả về stable dispatch {get, set, values} — KHÔNG subscribe, KHÔNG gây re-render.
 *  values là getter đọc snapshot tức thì (dùng trong event handler, không reactive).
 *  Dùng cho component chỉ ghi state trong event handler (Widget, PageLeaveHandler…). */
export function usePageDispatch(): import("@/lib/run-action").PageStateLike {
  const store = useContext(PageStateStoreCtx);
  // store stable (ref trong provider) → useMemo chỉ tạo object 1 lần/page
  return useMemo(
    () => ({
      get: store.get,
      set: store.set,
      get values() {
        return store.getSnapshot();
      },
    }),
    [store],
  );
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
      let op = cond.op;
      // Op ĐỘNG: opFromState + opMap → đổi op hoặc skip filter tùy giá trị state.
      // Vd: selHoanthanh="" → is-not-true (default); "Đã HT" → is-true; "Tất cả" → skip.
      const condEx = cond as Record<string, unknown>;
      const opFromState = condEx.opFromState as string | undefined;
      const opMap = condEx.opMap as Record<string, string> | undefined;
      if (opFromState && opMap) {
        const sv = (pageState.get(opFromState) as string) ?? "";
        const mapped = opMap[sv];
        if (mapped === "__skip__") continue;
        if (mapped) op = mapped as LoadFilterOp;
      }
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
      if (op === "in" && typeof value === "string") {
        filters[field] = {
          op: "in",
          value: value
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
        };
      } else {
        // value LUÔN có mặt (server zod yêu cầu). Op rỗng (is-empty/is-not-empty/
        // is-true/is-not-true) không cần value → gửi null cho hợp lệ.
        filters[field] = { op, value: value ?? null };
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
  const q = cfg.q as string | undefined;
  // Sắp xếp server-side: cfg.sort (tường minh) → cfg.defaultSort (mặc định thiết kế).
  const rawSort = (cfg.sort ?? cfg.defaultSort) as
    | { field?: string; dir?: "asc" | "desc" }
    | undefined;
  const sort = rawSort?.field
    ? { field: rawSort.field, dir: rawSort.dir === "asc" ? ("asc" as const) : ("desc" as const) }
    : undefined;
  return { limit, filters, enabled, q, sort };
}

/** Hook nhỏ — nạp record thật của một entity (số dòng + điều kiện cấu hình được).
 *  Khi ActionWidget gọi procedure xong, nó set pageState["__refresh:<entityId>"]
 *  = timestamp; đưa tag đó vào queryKey → TanStack Query refetch tự động.
 *  Dedup: nhiều widget cùng entity/filters trên 1 trang chia sẻ 1 request. */
function useRecords(entityId?: string, opts?: UseRecordsOpts) {
  const limit = opts?.limit ?? DEFAULT_ROW_LIMIT;
  const enabled = opts?.enabled !== false;
  const filters = opts?.filters;
  const q = opts?.q;
  const sort = opts?.sort;
  // Khóa ổn định cho queryKey — tránh refetch vô hạn do object literal mới mỗi render.
  const filtersKey = filters ? JSON.stringify(filters) : "";
  const sortKey = sort ? JSON.stringify(sort) : "";

  // Subscribe CHỈ refresh tag của entity này — không re-render khi key khác đổi
  const refreshTag = usePageStateKey(entityId ? `__refresh:${entityId}` : "") as number | undefined;

  const { data, isLoading, error } = useQuery({
    // refreshTag trong queryKey → thay đổi tag = query mới → TQ refetch tự động;
    // filtersKey/sortKey (chuỗi) thay cho object để queryKey ổn định giữa các render.
    queryKey: ["records", entityId, filtersKey, limit, q, sortKey, refreshTag],
    queryFn: async () => {
      const res = await api.getRecords(entityId!, { limit, filters, q, sort });
      // id thật của record (uuid) PHẢI thắng — tránh field data.id (vd id cũ
      // kiểu integer ở entity mirror) đè lên → recordId sai khi select/sửa/xóa.
      return res.rows.map((r) => ({ ...r.data, id: r.id, created_at: r.createdAt }));
    },
    // loadGate: enabled=false → không fetch, trả rows=[] (giữ hành vi useEffect cũ)
    enabled: !!entityId && enabled,
  });

  return {
    rows: data ?? [],
    loading: isLoading,
    err: error?.message ?? "",
  };
}

export function useEntity(entityId?: string): MockEntity | undefined {
  // Selector inline — chỉ re-render khi entity CỤ THỂ này thay đổi,
  // không khi entity KHÁC trong mảng được thêm/sửa/xoá.
  return useUserObjects((s) => s.entities.find((e) => e.id === entityId));
}

/* ── DataSource (ORM-like) read hook — row PHẲNG đã join + field meta. ──
   refresh tag riêng (`__refresh:ds:<id>`) để ActionWidget có thể trigger refetch.
   field meta map sang EntityField (key→name/id) để widget dùng đồng nhất. */
function useDataSourceRecords(dataSourceId: string | undefined, opts: UseRecordsOpts) {
  const limit = opts.limit ?? DEFAULT_ROW_LIMIT;
  const enabled = opts.enabled !== false;
  const filters = opts.filters;
  const q = opts.q;
  const sort = opts.sort;
  // Khóa ổn định cho queryKey — tránh refetch vô hạn do object literal mới mỗi render.
  const filtersKey = filters ? JSON.stringify(filters) : "";
  const sortKey = sort ? JSON.stringify(sort) : "";

  // Subscribe CHỈ refresh tag của datasource này — không re-render khi key khác đổi
  const refreshTag = usePageStateKey(dataSourceId ? `__refresh:ds:${dataSourceId}` : "") as
    | number
    | undefined;

  // --- Meta query (tách khỏi data — chỉ refetch khi dataSourceId đổi) ---
  // queryFn dùng module-level _dsMetaCache: Promise được giữ → widget mount muộn
  // không thêm round-trip; TQ cũng dedup in-flight requests theo queryKey.
  const { data: meta } = useQuery({
    queryKey: ["ds-meta", dataSourceId],
    queryFn: () => cachedGetDataSourceMeta(dataSourceId!),
    enabled: !!dataSourceId,
    staleTime: Number.POSITIVE_INFINITY, // meta không đổi trong phiên làm việc
  });

  // Ref đồng bộ để refFill đọc đồng bộ mà không cần await
  const metaRef = useRef<Awaited<ReturnType<typeof api.getDataSourceMeta>> | null>(null);
  // Gán trong render (không phải side-effect — ref là container mutable)
  if (meta) metaRef.current = meta;

  // fields phẳng từ meta — chỉ tính lại khi meta đổi (thực tế = khi dataSourceId đổi)
  const fields = useMemo<EntityField[]>(() => {
    if (!meta) return [];
    return meta.fields.map((f) => ({
      id: f.key,
      name: f.key,
      label: f.label,
      type: f.type,
      ref: f.ref,
      refValueField: f.refValueField,
      writable: f.sourceRelationId === "base" && f.writable !== false,
    }));
  }, [meta]);

  // --- Data query: refetch khi filter/sort/refreshTag đổi — KHÔNG refetch meta ---
  const {
    data: rowData,
    isLoading,
    error,
  } = useQuery({
    // refreshTag trong queryKey → thay đổi tag = query mới → TQ refetch tự động;
    // filtersKey/sortKey (chuỗi) thay cho object để queryKey ổn định giữa các render.
    queryKey: ["ds-records", dataSourceId, filtersKey, limit, q, sortKey, refreshTag],
    queryFn: async () => {
      const res = await api.getDataSourceRecords(dataSourceId!, {
        limit,
        filters,
        q,
        sort: sort ? { key: sort.field, dir: sort.dir } : undefined,
      });
      return res.rows as Record<string, unknown>[];
    },
    // loadGate: enabled=false → không fetch, trả rows=[] (giữ hành vi useEffect cũ)
    enabled: !!dataSourceId && enabled,
  });

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

  return {
    rows: rowData ?? [],
    fields,
    loading: isLoading,
    err: error?.message ?? "",
    refFill,
  };
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

  // Field meta của DataSource (1 lần, dùng cache) — entity lấy thẳng từ useEntity.
  useEffect(() => {
    if (!dataSourceId) {
      setDsFields([]);
      return;
    }
    let alive = true;
    cachedGetDataSourceMeta(dataSourceId)
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
  // Chỉ cần ghi refresh tag (event handler) → dispatch stable, không gây re-render
  const dispatch = usePageDispatch();

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
            const tag = (dispatch.get(key) as number | undefined) ?? 0;
            dispatch.set(key, tag + 1);
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
    // Dùng cache — meta thường đã nạp từ useDataSourceRecords trên cùng trang
    cachedGetDataSourceMeta(dataSourceId)
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
