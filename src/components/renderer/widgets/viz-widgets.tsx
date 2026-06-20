/* Leaf widget hiển thị (viz) cho renderer: Chart / Kanban / Step / Calendar /
   Map / Kpi / Pivot. Mỗi widget đọc dữ liệu qua foundation page-data. Tách từ
   ConsumerPage.tsx (Phase A3) — chỉ di chuyển code, KHÔNG đổi hành vi. */
import { useState } from "react";
import { MapContainer, Marker, Popup, TileLayer } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { I } from "@/components/Icons";
import { ActionWidget } from "@/components/renderer/ActionWidget";
import { Chart } from "@/components/renderer/Chart";
import { LookupPicker } from "@/components/renderer/LookupPicker";
import { api, useEntity, usePageState, useWidgetData } from "@/components/renderer/page-data";
import type { ChartKind } from "@/components/renderer/page-types";
import { SearchableSelect } from "@/components/ui";
import { useT } from "@/hooks/useT";
import { applyFilters } from "@/lib/page-filters";
import { cn } from "@/lib/utils";
import { useUserObjects } from "@/stores/userObjects";
import type { ActionConfig, FilterNode } from "@/types/page";

/** Widget "chart" — gom nhóm record thật theo `groupBy`, tổng hợp
   `valueField` (nếu trống → đếm số bản ghi).
   filterFromState: lọc rows trước khi gom nhóm theo master selection. */
export function ChartWidget({ cfg }: { cfg: Record<string, unknown> }) {
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

/** Widget "kanban" — gom record thật thành cột theo field `groupBy`.
 *  filterFromState: lọc records theo master selection trước khi gom cột. */
export function KanbanWidget({ cfg }: { cfg: Record<string, unknown> }) {
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
export function StepWidget({ cfg }: { cfg: Record<string, unknown> }) {
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
export function CalendarWidget({ cfg }: { cfg: Record<string, unknown> }) {
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
export function MapWidget({ cfg }: { cfg: Record<string, unknown> }) {
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
export function KpiWidget({ cfg }: { cfg: Record<string, unknown> }) {
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

export function PivotWidget({ cfg }: { cfg: Record<string, unknown> }) {
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
