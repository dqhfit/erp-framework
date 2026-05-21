/* ==========================================================
   ConsumerPage — render trang ĐÃ THIẾT KẾ ở chế độ người dùng.
   Đọc danh sách widget từ pageContent (do PageDesigner lưu) và
   render trên lưới 12 cột. Widget "list" truy vấn RECORD THẬT
   của entity bound (qua ApiDataSource) — không còn dữ liệu giả.
   ========================================================== */
import { useState, useEffect } from "react";
import { I } from "@/components/Icons";
import { DataGrid } from "@/components/renderer/DataGrid";
import { Chart } from "@/components/renderer/Chart";
import { useUserObjects } from "@/stores/userObjects";
import { createApiDataSource } from "@erp-framework/client";
import { formatVND, type MockEntity } from "@/lib/mock-data";

const api = createApiDataSource("");

interface PageComponent {
  id: string;
  kind: string;
  x: number; y: number; w: number; h: number;
  config: Record<string, unknown>;
}

/* Lưới demo nhỏ cho widget chart khi chưa có nguồn dữ liệu thật. */
const DEMO_CHART = [
  { k: "T1", v: 12 }, { k: "T2", v: 19 }, { k: "T3", v: 15 },
  { k: "T4", v: 25 }, { k: "T5", v: 22 },
];

/** Widget "list" — đọc record thật của entity, cột suy từ field. */
function ListWidget({ entityId }: { entityId?: string }) {
  const entities = useUserObjects((s) => s.entities);
  const ent: MockEntity | undefined = entities.find((e) => e.id === entityId);
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!entityId) { setLoading(false); return; }
    let alive = true;
    setLoading(true); setErr("");
    api.getRecords(entityId, { limit: 50 })
      .then((res) => { if (alive) { setRows(res.rows.map((r) => r.data)); setLoading(false); } })
      .catch((e) => { if (alive) { setErr((e as Error).message); setLoading(false); } });
    return () => { alive = false; };
  }, [entityId]);

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
  if (comp.kind === "chart") {
    return (
      <div className="p-2 h-full flex flex-col">
        {cfg.title ? <div className="text-xs font-medium mb-1 truncate">{String(cfg.title)}</div> : null}
        <div className="flex-1 min-h-0">
          <Chart kind={(cfg.kind as "bar" | "line" | "area" | "pie" | "doughnut") ?? "bar"}
            data={DEMO_CHART} labelKey="k" valueKeys={["v"]} />
        </div>
      </div>
    );
  }
  if (comp.kind === "list") {
    return <ListWidget entityId={cfg.entity as string | undefined} />;
  }
  if (comp.kind === "html") {
    return (
      <div className="p-3 text-sm"
        dangerouslySetInnerHTML={{ __html: (cfg.html as string) ?? "" }} />
    );
  }
  // form / kanban — chưa render đầy đủ ở consumer.
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
