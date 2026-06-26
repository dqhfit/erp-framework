/* ChartWidget thật — import recharts qua Chart.tsx.
   File này được lazy-load từ viz-widgets.tsx để recharts KHÔNG kéo vào
   bundle chính của trang không có widget chart. */
import { Chart } from "@/components/renderer/Chart";
import { usePageState, useWidgetData } from "@/components/renderer/page-data";
import type { ChartKind } from "@/components/renderer/page-types";
import { useT } from "@/hooks/useT";
import { applyFilters } from "@/lib/page-filters";
import type { FilterNode } from "@/types/page";

/** Widget "chart" — gom nhóm record thật theo `groupBy`, tổng hợp
 *  `valueField` (nếu trống → đếm số bản ghi).
 *  filterFromState: lọc rows trước khi gom nhóm theo master selection. */
export default function ChartWidgetImpl({ cfg }: { cfg: Record<string, unknown> }) {
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
