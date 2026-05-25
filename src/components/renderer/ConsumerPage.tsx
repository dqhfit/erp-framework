/* ==========================================================
   ConsumerPage — render trang ĐÃ THIẾT KẾ ở chế độ người dùng.
   Đọc danh sách widget từ pageContent (do PageDesigner lưu) và
   render trên lưới 12 cột. Widget list/chart/kanban truy vấn
   RECORD THẬT của entity bound (qua ApiDataSource); widget form
   ghi record thật vào backend. KHÔNG còn dữ liệu giả.
   ========================================================== */
import { useState, useEffect } from "react";
import { MapContainer, TileLayer, Marker, Popup } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { I } from "@/components/Icons";
import { DataGrid } from "@/components/renderer/DataGrid";
import { Chart } from "@/components/renderer/Chart";
import { useUserObjects } from "@/stores/userObjects";
import { createApiDataSource } from "@erp-framework/client";
import { formatVND } from "@/lib/format";
import type { MockEntity } from "@/lib/object-types";

const api = createApiDataSource("");

type ChartKind = "bar" | "line" | "area" | "pie" | "doughnut";

interface PageComponent {
  id: string;
  kind: string;
  x: number; y: number; w: number; h: number;
  config: Record<string, unknown>;
}

/** Hook nhỏ — nạp record thật của một entity (giới hạn 500 dòng). */
function useRecords(entityId?: string) {
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState<boolean>(!!entityId);
  const [err, setErr] = useState("");
  useEffect(() => {
    if (!entityId) { setRows([]); setLoading(false); return; }
    let alive = true;
    setLoading(true); setErr("");
    api.getRecords(entityId, { limit: 500 })
      .then((res) => { if (alive) { setRows(res.rows.map((r) => r.data)); setLoading(false); } })
      .catch((e) => { if (alive) { setErr((e as Error).message); setLoading(false); } });
    return () => { alive = false; };
  }, [entityId]);
  return { rows, loading, err };
}

function useEntity(entityId?: string): MockEntity | undefined {
  const entities = useUserObjects((s) => s.entities);
  return entities.find((e) => e.id === entityId);
}

/** Widget "list" — bảng record thật, cột suy từ field của entity. */
function ListWidget({ entityId }: { entityId?: string }) {
  const ent = useEntity(entityId);
  const { rows, loading, err } = useRecords(entityId);

  if (!entityId) {
    return <div className="p-3 text-xs text-muted">Widget list chưa bind entity.</div>;
  }
  const columns = (ent?.fields ?? []).slice(0, 6).map((f) => ({
    accessorKey: f.name,
    header: f.label,
    cell: (c: { getValue: () => unknown }) => {
      const v = c.getValue();
      if (f.type === "currency") return formatVND(Number(v ?? 0));
      return v == null ? "" : String(v);
    },
  }));

  return (
    <div className="h-full flex flex-col">
      <div className="text-xs px-2 py-1 border-b border-border text-muted flex items-center gap-1">
        <I.Table size={11} />
        {ent?.name ?? "List"}
        <span className="ml-auto">{loading ? "đang tải…" : `${rows.length} bản ghi`}</span>
      </div>
      <div className="flex-1 min-h-0 overflow-auto">
        {err
          ? <div className="p-3 text-xs text-danger">Lỗi tải dữ liệu: {err}</div>
          : <DataGrid toolbar={false} data={rows} columns={columns}
              emptyText="Chưa có bản ghi nào." />}
      </div>
    </div>
  );
}

/** Widget "chart" — gom nhóm record thật theo `groupBy`, tổng hợp
   `valueField` (nếu trống → đếm số bản ghi). */
function ChartWidget({ cfg }: { cfg: Record<string, unknown> }) {
  const entityId = cfg.entity as string | undefined;
  const groupBy = (cfg.groupBy as string) || "";
  const valueField =
    (cfg.valueField as string) || (cfg.field as string) || (cfg.metric as string) || "";
  const kind = ((cfg.kind as string) || "bar") as ChartKind;
  // Chỉ truy vấn khi đã cấu hình đủ entity + field nhóm.
  const { rows, loading, err } = useRecords(entityId && groupBy ? entityId : undefined);

  if (!entityId || !groupBy) {
    return (
      <div className="p-3 text-xs text-muted">
        Chart chưa cấu hình — chọn entity + field nhóm ở trình thiết kế.
      </div>
    );
  }
  if (loading) return <div className="p-3 text-xs text-muted">đang tải…</div>;
  if (err) return <div className="p-3 text-xs text-danger">Lỗi: {err}</div>;

  const agg = new Map<string, number>();
  for (const r of rows) {
    const key = String(r[groupBy] ?? "(trống)");
    const inc = valueField ? (Number(r[valueField]) || 0) : 1;
    agg.set(key, (agg.get(key) ?? 0) + inc);
  }
  const data = [...agg.entries()].map(([k, v]) => ({ k, v }));

  return (
    <div className="p-2 h-full flex flex-col">
      {cfg.title ? (
        <div className="text-xs font-medium mb-1 truncate">{String(cfg.title)}</div>
      ) : null}
      <div className="flex-1 min-h-0">
        {data.length === 0
          ? <div className="text-xs text-muted p-2">Chưa có dữ liệu để vẽ.</div>
          : <Chart kind={kind} data={data} labelKey="k" valueKeys={["v"]} />}
      </div>
    </div>
  );
}

/** Widget "form" — sinh form từ field của entity, lưu record thật. */
function FormWidget({ cfg }: { cfg: Record<string, unknown> }) {
  const entityId = cfg.entity as string | undefined;
  const ent = useEntity(entityId);
  const [form, setForm] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  if (!entityId || !ent) {
    return <div className="p-3 text-xs text-muted">Form chưa bind entity.</div>;
  }
  const fields = ent.fields ?? [];

  const submit = async () => {
    setBusy(true); setErr(""); setMsg("");
    try {
      // Bỏ field rỗng — server validate-on-write tự ép kiểu phần còn lại.
      const data: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(form)) if (v !== "") data[k] = v;
      await api.createRecord(entityId, data);
      setForm({});
      setMsg("✓ Đã lưu bản ghi.");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="p-3 h-full overflow-auto">
      {cfg.title ? (
        <div className="text-sm font-medium mb-2">{String(cfg.title)}</div>
      ) : null}
      <div className="space-y-2">
        {fields.length === 0 && (
          <div className="text-xs text-muted">Entity chưa có field nào.</div>
        )}
        {fields.map((f) => (
          <div key={f.id}>
            <label className="text-xs text-muted">
              {f.label}{f.required ? " *" : ""}
            </label>
            {f.type === "select" && f.options?.length ? (
              <select
                className="input w-full"
                value={form[f.name] ?? ""}
                onChange={(e) => setForm({ ...form, [f.name]: e.target.value })}
              >
                <option value="">— chọn —</option>
                {f.options.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            ) : (
              <input
                className="input w-full"
                type={f.type === "number" || f.type === "currency" ? "number"
                  : f.type === "date" ? "date"
                  : f.type === "email" ? "email" : "text"}
                value={form[f.name] ?? ""}
                onChange={(e) => setForm({ ...form, [f.name]: e.target.value })}
              />
            )}
          </div>
        ))}
        <button
          className="btn btn-primary btn-sm"
          disabled={busy || fields.length === 0}
          onClick={() => void submit()}
        >
          {busy ? "Đang lưu…" : "Lưu bản ghi"}
        </button>
        {msg && <div className="text-xs text-success">{msg}</div>}
        {err && <div className="text-xs text-danger">{err}</div>}
      </div>
    </div>
  );
}

/** Widget "kanban" — gom record thật thành cột theo field `groupBy`. */
function KanbanWidget({ cfg }: { cfg: Record<string, unknown> }) {
  const entityId = cfg.entity as string | undefined;
  const groupBy = (cfg.groupBy as string) || "status";
  const ent = useEntity(entityId);
  const { rows, loading, err } = useRecords(entityId);

  if (!entityId || !ent) {
    return <div className="p-3 text-xs text-muted">Kanban chưa bind entity.</div>;
  }
  if (loading) return <div className="p-3 text-xs text-muted">đang tải…</div>;
  if (err) return <div className="p-3 text-xs text-danger">Lỗi: {err}</div>;

  // Tiêu đề thẻ = field đầu tiên khác field nhóm.
  const titleField = ent.fields.find((f) => f.name !== groupBy)?.name ?? groupBy;
  const groups = new Map<string, Record<string, unknown>[]>();
  for (const r of rows) {
    const key = String(r[groupBy] ?? "(trống)");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }

  return (
    <div className="h-full flex flex-col">
      <div className="text-xs px-2 py-1 border-b border-border text-muted flex items-center gap-1">
        <I.Kanban size={11} /> {ent.name} · nhóm theo "{groupBy}"
      </div>
      <div className="flex-1 min-h-0 overflow-auto flex gap-2 p-2">
        {groups.size === 0 && (
          <div className="text-xs text-muted p-2">Chưa có bản ghi nào.</div>
        )}
        {[...groups.entries()].map(([col, items]) => (
          <div key={col} className="w-[180px] shrink-0 bg-bg-soft rounded-md border border-border">
            <div className="text-xs font-medium px-2 py-1 border-b border-border flex justify-between">
              <span className="truncate">{col}</span>
              <span className="text-muted">{items.length}</span>
            </div>
            <div className="p-1.5 space-y-1.5">
              {items.slice(0, 30).map((it, i) => (
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

/** Widget "calendar" — render record theo dateField, group by ngày. */
function CalendarWidget({ cfg }: { cfg: Record<string, unknown> }) {
  const entityId = cfg.entity as string | undefined;
  const dateField = (cfg.dateField as string) || "date";
  const titleField = (cfg.titleField as string) || "name";
  const ent = useEntity(entityId);
  const { rows, loading, err } = useRecords(entityId);

  if (!entityId || !ent) return <div className="p-3 text-xs text-muted">Calendar chưa bind entity.</div>;
  if (loading) return <div className="p-3 text-xs text-muted">đang tải…</div>;
  if (err) return <div className="p-3 text-xs text-danger">Lỗi: {err}</div>;

  const byDate = new Map<string, Record<string, unknown>[]>();
  for (const r of rows) {
    const raw = r[dateField];
    if (!raw) continue;
    const d = new Date(String(raw));
    if (isNaN(d.getTime())) continue;
    const key = d.toISOString().slice(0, 10);
    if (!byDate.has(key)) byDate.set(key, []);
    byDate.get(key)!.push(r);
  }
  const sorted = [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b)).slice(0, 30);

  return (
    <div className="h-full flex flex-col">
      <div className="text-xs px-2 py-1 border-b border-border text-muted flex items-center gap-1">
        <I.Calendar size={11} /> {ent.name} · theo "{dateField}"
      </div>
      <div className="flex-1 min-h-0 overflow-auto p-2 space-y-1.5">
        {sorted.length === 0 && (
          <div className="text-xs text-muted">Chưa có bản ghi có ngày.</div>
        )}
        {sorted.map(([date, items]) => (
          <div key={date} className="border border-border rounded-md">
            <div className="text-xs font-medium px-2 py-1 bg-bg-soft border-b border-border flex justify-between">
              <span>{new Date(date).toLocaleDateString("vi-VN", { weekday: "short", day: "2-digit", month: "2-digit" })}</span>
              <span className="text-muted">{items.length}</span>
            </div>
            <div className="p-1.5 space-y-1">
              {items.slice(0, 5).map((it, i) => (
                <div key={i} className="text-xs truncate">{String(it[titleField] ?? "(không tên)")}</div>
              ))}
              {items.length > 5 && <div className="text-[10px] text-muted">+{items.length - 5} nữa</div>}
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
  const entityId = cfg.entity as string | undefined;
  const geoField = (cfg.geoField as string) || "location";
  const titleField = (cfg.titleField as string) || "name";
  const ent = useEntity(entityId);
  const { rows, loading, err } = useRecords(entityId);

  if (!entityId || !ent) return <div className="p-3 text-xs text-muted">Map chưa bind entity.</div>;
  if (loading) return <div className="p-3 text-xs text-muted">đang tải…</div>;
  if (err) return <div className="p-3 text-xs text-danger">Lỗi: {err}</div>;

  const points = rows.flatMap((r) => {
    const g = r[geoField];
    if (g && typeof g === "object" && "lat" in g && "lng" in g) {
      return [{ lat: (g as { lat: number }).lat, lng: (g as { lng: number }).lng, title: String(r[titleField] ?? "") }];
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
            Chưa có record có geo. Field "{geoField}" cần shape {`{lat, lng}`}.
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
  const center: [number, number] = points.length > 0
    ? [
        points.reduce((s, p) => s + p.lat, 0) / points.length,
        points.reduce((s, p) => s + p.lng, 0) / points.length,
      ]
    : [10.776, 106.700];
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
        <Marker key={i} position={[p.lat, p.lng]}>
          <Popup>{p.title || "(không tên)"}</Popup>
        </Marker>
      ))}
    </MapContainer>
  );
}

/** Widget "pivot" — cross-tab aggregation: rows × cols → value (sum/count). */
function PivotWidget({ cfg }: { cfg: Record<string, unknown> }) {
  const entityId = cfg.entity as string | undefined;
  const rowField = (cfg.rowField as string) || "category";
  const colField = (cfg.colField as string) || "status";
  const valueField = cfg.valueField as string | undefined;
  const agg = (cfg.agg as string) || "count";
  const ent = useEntity(entityId);
  const { rows, loading, err } = useRecords(entityId);

  if (!entityId || !ent) return <div className="p-3 text-xs text-muted">Pivot chưa bind entity.</div>;
  if (loading) return <div className="p-3 text-xs text-muted">đang tải…</div>;
  if (err) return <div className="p-3 text-xs text-danger">Lỗi: {err}</div>;

  const rowKeys = new Set<string>();
  const colKeys = new Set<string>();
  const matrix = new Map<string, Map<string, number[]>>(); // row → col → values
  for (const r of rows) {
    const rk = String(r[rowField] ?? "(trống)");
    const ck = String(r[colField] ?? "(trống)");
    rowKeys.add(rk); colKeys.add(ck);
    if (!matrix.has(rk)) matrix.set(rk, new Map());
    const m = matrix.get(rk)!;
    if (!m.has(ck)) m.set(ck, []);
    const v = valueField ? Number(r[valueField] ?? 0) : 1;
    m.get(ck)!.push(v);
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
              <th className="border border-border px-2 py-1 bg-bg-soft sticky top-0">{rowField}\\{colField}</th>
              {colList.map((c) => <th key={c} className="border border-border px-2 py-1 bg-bg-soft text-right sticky top-0">{c}</th>)}
            </tr>
          </thead>
          <tbody>
            {rowList.map((r) => (
              <tr key={r}>
                <td className="border border-border px-2 py-1 font-medium">{r}</td>
                {colList.map((c) => {
                  const vs = matrix.get(r)?.get(c) ?? [];
                  const v = reduce(vs);
                  return <td key={c} className="border border-border px-2 py-1 text-right font-mono">{vs.length === 0 ? "·" : v.toLocaleString("vi-VN")}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Render một widget theo kind. */
function Widget({ comp }: { comp: PageComponent }) {
  const cfg = comp.config ?? {};
  if (comp.kind === "kpi") {
    return (
      <div className="p-3 h-full flex flex-col justify-center">
        <div className="text-xs text-muted uppercase tracking-wider">
          {(cfg.label as string) ?? "KPI"}
        </div>
        <div className="text-2xl font-bold mt-1">{(cfg.value as string) ?? "—"}</div>
        {cfg.trend ? <div className="text-xs text-success mt-0.5">{String(cfg.trend)}</div> : null}
      </div>
    );
  }
  if (comp.kind === "chart") return <ChartWidget cfg={cfg} />;
  if (comp.kind === "list") {
    return <ListWidget entityId={cfg.entity as string | undefined} />;
  }
  if (comp.kind === "form") return <FormWidget cfg={cfg} />;
  if (comp.kind === "kanban") return <KanbanWidget cfg={cfg} />;
  if (comp.kind === "calendar") return <CalendarWidget cfg={cfg} />;
  if (comp.kind === "map") return <MapWidget cfg={cfg} />;
  if (comp.kind === "pivot") return <PivotWidget cfg={cfg} />;
  if (comp.kind === "html") {
    return (
      <div className="p-3 text-sm"
        dangerouslySetInnerHTML={{ __html: (cfg.html as string) ?? "" }} />
    );
  }
  return (
    <div className="p-3 text-xs text-muted h-full flex items-center justify-center text-center">
      Widget "{comp.kind}" — chưa hỗ trợ ở chế độ người dùng.
    </div>
  );
}

export function ConsumerPage({ pageId }: { pageId: string }) {
  const page = useUserObjects((s) => s.pages).find((p) => p.id === pageId);
  const content = useUserObjects((s) => s.pageContent[pageId]);
  const components: PageComponent[] = Array.isArray(content)
    ? (content as PageComponent[])
    : [];

  return (
    <div className="overflow-y-auto h-full">
      <div className="max-w-[1180px] mx-auto p-6">
        <div className="mb-4">
          <h1 className="text-2xl font-semibold">{page?.name ?? "Trang"}</h1>
          <div className="text-sm text-muted">Chế độ người dùng — dữ liệu thật từ backend</div>
        </div>

        {components.length === 0 ? (
          <div className="card p-12 text-center text-muted text-sm">
            Trang chưa có widget nào. Chuyển sang chế độ thiết kế để thêm.
          </div>
        ) : (
          <div
            className="grid gap-3"
            style={{ gridTemplateColumns: "repeat(12, 1fr)", gridAutoRows: "76px" }}
          >
            {components.map((c) => (
              <div
                key={c.id}
                className="card overflow-hidden"
                style={{
                  gridColumn: `span ${Math.min(c.w || 3, 12)}`,
                  gridRow: `span ${c.h || 2}`,
                }}
              >
                <Widget comp={c} />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
