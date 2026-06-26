/* MapWidget thật — import react-leaflet + leaflet.css.
   File này được lazy-load từ viz-widgets.tsx để leaflet (~700 KB) KHÔNG kéo
   vào bundle chính của trang không có widget map. */
import "leaflet/dist/leaflet.css";
import { MapContainer, Marker, Popup, TileLayer } from "react-leaflet";
import { I } from "@/components/Icons";
import { useEntity, usePageState, useWidgetData } from "@/components/renderer/page-data";
import { useT } from "@/hooks/useT";
import { applyFilters } from "@/lib/page-filters";
import type { FilterNode } from "@/types/page";

/** Nội dung bản đồ — MapContainer + marker từ Leaflet. */
function LeafletMap({ points }: { points: Array<{ lat: number; lng: number; title: string }> }) {
  // Default center = trung tâm trung bình các điểm; fallback HCMC.
  const center: [number, number] =
    points.length > 0
      ? [
          points.reduce((s, p) => s + p.lat, 0) / points.length,
          points.reduce((s, p) => s + p.lng, 0) / points.length,
        ]
      : [10.776, 106.7];
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

/** Widget "map" — hiển thị record có field geo {lat, lng}. Dùng Leaflet
 *  + OpenStreetMap tiles (free, không cần API key). Field shape:
 *  geo: { lat: number, lng: number }. */
export default function MapWidgetImpl({ cfg }: { cfg: Record<string, unknown> }) {
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
