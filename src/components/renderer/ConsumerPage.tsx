import { useState } from "react";
import { I } from "@/components/Icons";
import { Button, Chip, Card, Input, Drawer } from "@/components/ui";
import { DataGrid } from "@/components/renderer/DataGrid";
import { Chart } from "@/components/renderer/Chart";
import { ORDER_ROWS, formatVND } from "@/lib/mock-data";
import { useUserObjects } from "@/stores/userObjects";

const SAMPLE_CHART = [
  { month: "T1", doanh_thu: 1200, don_hang: 45 },
  { month: "T2", doanh_thu: 1800, don_hang: 62 },
  { month: "T3", doanh_thu: 2200, don_hang: 78 },
  { month: "T4", doanh_thu: 1900, don_hang: 70 },
  { month: "T5", doanh_thu: 2800, don_hang: 95 },
];

const KPIS = [
  { label: "Doanh thu hôm nay", value: "84.5M ₫", trend: "+12%", tint: "success" },
  { label: "Đơn hàng",          value: "142",     trend: "+8",   tint: "accent" },
  { label: "Khách mới",         value: "23",      trend: "+15%", tint: "accent-2" },
  { label: "Tồn kho thấp",      value: "3",       trend: "⚠ Cảnh báo", tint: "warning" },
];

export function ConsumerPage({ pageId }: { pageId: string }) {
  const page = useUserObjects((s) => s.pages).find((p) => p.id === pageId);
  const [search, setSearch] = useState("");
  const [detailRow, setDetailRow] = useState<typeof ORDER_ROWS[0] | null>(null);

  const filtered = ORDER_ROWS.filter((r) =>
    !search || r.customer.toLowerCase().includes(search.toLowerCase()) || r.id.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="overflow-y-auto h-full">
      <div className="max-w-[1180px] mx-auto p-6">
        {/* Header */}
        <div className="flex items-baseline justify-between mb-4">
          <div>
            <h1 className="text-2xl font-semibold">{page?.name ?? "Page"}</h1>
            <div className="text-sm text-muted">Consumer Mode — view dành cho nhân viên</div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="default" size="sm" icon={<I.Filter size={13} />}>Lọc</Button>
            <Button variant="primary" size="sm" icon={<I.Plus size={13} />}>Đơn mới</Button>
          </div>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          {KPIS.map((kpi) => (
            <Card key={kpi.label}>
              <div className="flex items-start justify-between">
                <div>
                  <div className="text-xs text-muted uppercase tracking-wider">{kpi.label}</div>
                  <div className="text-2xl font-semibold mt-1 leading-none">{kpi.value}</div>
                </div>
                <Chip variant={kpi.tint === "warning" ? "warning" : "success"}>{kpi.trend}</Chip>
              </div>
            </Card>
          ))}
        </div>

        {/* Chart */}
        <Card className="mb-6">
          <div className="font-semibold mb-3">Doanh số theo tháng</div>
          <Chart kind="bar" data={SAMPLE_CHART} labelKey="month" valueKeys={["doanh_thu"]} height={260} />
        </Card>

        {/* Orders list with search */}
        <Card className="p-0 overflow-hidden">
          <div className="flex items-center gap-2 p-3 border-b border-border">
            <div className="font-semibold flex-1">Đơn hàng gần đây</div>
            <div className="relative w-64">
              <I.Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
              <Input
                placeholder="Tìm theo mã / khách..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-7"
              />
            </div>
          </div>
          <div className="h-[400px]">
            <DataGrid
              toolbar={false}
              columns={[
                { id: "id",       header: "Mã đơn",      accessorKey: "id",
                  cell: (ctx) => <span className="font-mono text-xs">{ctx.getValue<string>()}</span> },
                { id: "customer", header: "Khách hàng",  accessorKey: "customer" },
                { id: "total",    header: "Tổng",
                  accessorFn: (r) => (r as typeof ORDER_ROWS[0]).total,
                  cell: (ctx) => <span className="font-mono text-right block">{formatVND(ctx.getValue<number>())}</span> },
                { id: "status",   header: "Trạng thái",  accessorKey: "status",
                  cell: (ctx) => {
                    const s = ctx.getValue<string>();
                    const variant = s === "Đã giao" ? "success" : s === "Huỷ" ? "danger" : s === "Chờ duyệt" ? "warning" : "accent";
                    return <Chip variant={variant}>{s}</Chip>;
                  } },
                { id: "date",     header: "Ngày",        accessorKey: "date" },
                { id: "actions",  header: "",
                  cell: (ctx) => (
                    <button
                      onClick={() => setDetailRow(ctx.row.original as typeof ORDER_ROWS[0])}
                      className="text-accent hover:underline text-xs"
                    >Xem</button>
                  ) },
              ]}
              data={filtered}
              emptyText="Không có đơn hàng."
            />
          </div>
        </Card>
      </div>

      {/* Order detail drawer */}
      <Drawer open={!!detailRow} onClose={() => setDetailRow(null)} title={detailRow?.id ?? "Đơn"}>
        {detailRow && (
          <div className="p-4 space-y-3 text-sm">
            <Card>
              <div className="text-xs text-muted">Khách hàng</div>
              <div className="font-semibold">{detailRow.customer}</div>
            </Card>
            <div className="grid grid-cols-2 gap-3">
              <Card>
                <div className="text-xs text-muted">Tổng tiền</div>
                <div className="font-mono font-semibold text-lg">{formatVND(detailRow.total)}</div>
              </Card>
              <Card>
                <div className="text-xs text-muted">Ngày đặt</div>
                <div className="font-semibold">{detailRow.date}</div>
              </Card>
            </div>
            <Card>
              <div className="text-xs text-muted mb-1">Trạng thái</div>
              <Chip variant={detailRow.status === "Đã giao" ? "success" : "warning"}>{detailRow.status}</Chip>
            </Card>
          </div>
        )}
      </Drawer>
    </div>
  );
}
