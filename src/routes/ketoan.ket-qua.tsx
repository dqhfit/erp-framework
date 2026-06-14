/* ==========================================================
   ketoan.ket-qua.tsx — Báo cáo KẾT QUẢ KINH DOANH / P&L (port KetQuaKinhDoanhL,
   DQHF252). Nguồn kt_ketqua_kinhdoanh (per tuần × bộ phận) → gộp theo BỘ PHẬN
   cho 1 năm (kỳ lấy qua f_tuan → kt_ketqua_kinhdoanh_tuan.f_nam) qua endpoint
   /banvesvc/kqkd. Lãi/Lỗ = Tổng thu − Tổng chi. Chọn bộ phận → chi tiết theo
   tuần (thu/chi/lãi + bóc tách lương, xuất hàng, khấu hao, điện nước…).
   ⚠ Chỉ năm đã chốt tổng (vd 2024) mới có số; năm chưa chốt hiện 0.
   ========================================================== */
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { I } from "@/components/Icons";
import { Select } from "@/components/ui";

export const Route = createFileRoute("/ketoan/ket-qua")({ component: KetQuaPage });

interface BpRow {
  bophan_id: string;
  bophan: string | null;
  sotuan: number;
  thu: number;
  chi: number;
  lai: number;
}
interface WeekRow {
  tuan: string;
  denngay: string;
  thu: number;
  chi: number;
  lai: number;
  luong: number;
  xuathang: number;
  khauhao: number;
  diennuoc: number;
  tongcodinh: number;
  chiphoi: number;
  thuphoi: number;
}

const fmtVnd = (v: unknown): string => {
  const n = Number(v);
  return Number.isFinite(n) ? n.toLocaleString("vi-VN", { maximumFractionDigits: 0 }) : "0";
};
const n = (v: unknown): number => Number(v) || 0;
const toBp = (r: Record<string, unknown>): BpRow => ({
  bophan_id: String(r.bophan_id ?? ""),
  bophan: (r.bophan as string | null) ?? null,
  sotuan: n(r.sotuan),
  thu: n(r.thu),
  chi: n(r.chi),
  lai: n(r.lai),
});
const toWeek = (r: Record<string, unknown>): WeekRow => ({
  tuan: String(r.tuan ?? ""),
  denngay: String(r.denngay ?? ""),
  thu: n(r.thu),
  chi: n(r.chi),
  lai: n(r.lai),
  luong: n(r.luong),
  xuathang: n(r.xuathang),
  khauhao: n(r.khauhao),
  diennuoc: n(r.diennuoc),
  tongcodinh: n(r.tongcodinh),
  chiphoi: n(r.chiphoi),
  thuphoi: n(r.thuphoi),
});
const laiClass = (n: number) =>
  Math.round(n) < 0 ? "text-danger" : Math.round(n) > 0 ? "text-success" : "text-muted";

function KetQuaPage() {
  const [years, setYears] = useState<number[]>([]);
  const [nam, setNam] = useState<string>("");
  const [rows, setRows] = useState<BpRow[] | null>(null);
  const [err, setErr] = useState("");
  const [sel, setSel] = useState<BpRow | null>(null);
  const [detail, setDetail] = useState<WeekRow[] | null>(null);

  // Năm có dữ liệu — mặc định năm mới nhất CÓ số (thu≠0).
  useEffect(() => {
    let alive = true;
    fetch("/banvesvc/kqkd?years=1", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : { rows: [] }))
      .then((d: { rows?: Array<{ nam: string; thu: string }> }) => {
        if (!alive) return;
        const ys = (d.rows ?? []).map((r) => ({ nam: Number(r.nam), thu: Number(r.thu) || 0 }));
        setYears(ys.map((y) => y.nam));
        const withData = ys.find((y) => y.thu !== 0);
        setNam(String(withData?.nam ?? ys[0]?.nam ?? new Date().getFullYear()));
      })
      .catch(() => alive && setErr("Không tải được danh sách năm."));
    return () => {
      alive = false;
    };
  }, []);

  // Summary theo bộ phận.
  useEffect(() => {
    if (!nam) return;
    let alive = true;
    setRows(null);
    setSel(null);
    fetch(`/banvesvc/kqkd?nam=${nam}`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`Lỗi ${r.status}`))))
      .then((d: { rows?: Record<string, unknown>[] }) => {
        if (alive) setRows((d.rows ?? []).map(toBp));
      })
      .catch((e) => alive && setErr((e as Error).message));
    return () => {
      alive = false;
    };
  }, [nam]);

  // Chi tiết tuần.
  useEffect(() => {
    if (!sel) {
      setDetail(null);
      return;
    }
    let alive = true;
    setDetail(null);
    fetch(`/banvesvc/kqkd?nam=${nam}&bophan=${encodeURIComponent(sel.bophan_id)}`, {
      credentials: "include",
    })
      .then((r) => (r.ok ? r.json() : { rows: [] }))
      .then((d: { rows?: Record<string, unknown>[] }) => {
        if (alive) setDetail((d.rows ?? []).map(toWeek));
      })
      .catch(() => alive && setDetail([]));
    return () => {
      alive = false;
    };
  }, [sel, nam]);

  const tot = useMemo(() => {
    const r = rows ?? [];
    return {
      thu: r.reduce((a, x) => a + x.thu, 0),
      chi: r.reduce((a, x) => a + x.chi, 0),
      lai: r.reduce((a, x) => a + x.lai, 0),
    };
  }, [rows]);

  return (
    <div className="h-full flex flex-col bg-bg text-text overflow-hidden">
      <div className="shrink-0 px-4 py-3 border-b border-border flex items-center gap-3 flex-wrap">
        <I.BarChart size={18} className="text-accent shrink-0" />
        <span className="font-semibold">Kết quả kinh doanh</span>
        <div className="flex-1" />
        <Select value={nam} onChange={(e) => setNam(e.target.value)} className="w-28">
          {years.map((y) => (
            <option key={y} value={String(y)}>
              Năm {y}
            </option>
          ))}
        </Select>
      </div>

      {err && (
        <div className="m-4 text-sm text-danger border border-danger/30 rounded p-2">{err}</div>
      )}
      {rows === null && !err && (
        <div className="p-6 text-sm text-muted text-center">Đang tải kết quả…</div>
      )}

      {rows !== null && (
        <div className="flex-1 flex min-h-0 overflow-hidden">
          <div className="flex-1 min-w-0 overflow-auto">
            {Math.round(tot.thu) === 0 && Math.round(tot.chi) === 0 && rows.length > 0 && (
              <div className="m-3 text-xs text-muted border border-border rounded p-2">
                Năm {nam} chưa chốt tổng thu/chi (nguồn để 0). Chọn năm đã chốt để xem số liệu.
              </div>
            )}
            <table className="w-full text-sm border-collapse">
              <thead className="sticky top-0 bg-panel text-muted text-xs z-10">
                <tr className="border-b border-border text-left">
                  <th className="py-2 px-3">Bộ phận</th>
                  <th className="py-2 px-3 text-right">Tuần</th>
                  <th className="py-2 px-3 text-right">Tổng thu</th>
                  <th className="py-2 px-3 text-right">Tổng chi</th>
                  <th className="py-2 px-3 text-right">Lãi/Lỗ</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.bophan_id}
                    onClick={() => setSel(r)}
                    className={`border-b border-border/50 cursor-pointer hover:bg-hover ${
                      sel?.bophan_id === r.bophan_id ? "bg-accent/10" : ""
                    }`}
                  >
                    <td className="py-1.5 px-3 font-medium">{r.bophan ?? `#${r.bophan_id}`}</td>
                    <td className="py-1.5 px-3 text-right tabular-nums">{r.sotuan}</td>
                    <td className="py-1.5 px-3 text-right tabular-nums">{fmtVnd(r.thu)}</td>
                    <td className="py-1.5 px-3 text-right tabular-nums">{fmtVnd(r.chi)}</td>
                    <td
                      className={`py-1.5 px-3 text-right tabular-nums font-semibold ${laiClass(r.lai)}`}
                    >
                      {fmtVnd(r.lai)}
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-muted text-xs">
                      Không có dữ liệu.
                    </td>
                  </tr>
                )}
              </tbody>
              <tfoot className="sticky bottom-0 bg-panel">
                <tr className="border-t border-border font-semibold">
                  <td className="py-2 px-3" colSpan={2}>
                    Toàn công ty
                  </td>
                  <td className="py-2 px-3 text-right tabular-nums">{fmtVnd(tot.thu)}</td>
                  <td className="py-2 px-3 text-right tabular-nums">{fmtVnd(tot.chi)}</td>
                  <td className={`py-2 px-3 text-right tabular-nums ${laiClass(tot.lai)}`}>
                    {fmtVnd(tot.lai)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          {sel && (
            <div className="w-[52%] min-w-[380px] border-l border-border flex flex-col overflow-hidden">
              <div className="shrink-0 px-3 py-2 border-b border-border flex items-center gap-2 bg-panel">
                <span className="text-sm font-medium flex-1 truncate">
                  {sel.bophan ?? `#${sel.bophan_id}`} — theo tuần
                </span>
                <button
                  type="button"
                  onClick={() => setSel(null)}
                  className="p-1 rounded hover:bg-hover text-muted"
                  aria-label="Đóng"
                >
                  <I.X size={16} />
                </button>
              </div>
              <div className="flex-1 overflow-auto">
                {detail === null ? (
                  <div className="p-4 text-xs text-muted text-center">Đang tải…</div>
                ) : (
                  <table className="w-full text-xs border-collapse">
                    <thead className="sticky top-0 bg-panel text-muted">
                      <tr className="border-b border-border text-left">
                        <th className="py-1.5 px-2">Tuần</th>
                        <th className="py-1.5 px-2 text-right">Thu</th>
                        <th className="py-1.5 px-2 text-right">Chi</th>
                        <th className="py-1.5 px-2 text-right">Lãi/Lỗ</th>
                        <th className="py-1.5 px-2 text-right">Lương</th>
                        <th className="py-1.5 px-2 text-right">Cố định</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.map((r, i) => (
                        // biome-ignore lint/suspicious/noArrayIndexKey: read-only, không reorder
                        <tr key={i} className="border-b border-border/50">
                          <td className="py-1.5 px-2 whitespace-nowrap">{r.tuan || r.denngay}</td>
                          <td className="py-1.5 px-2 text-right tabular-nums">{fmtVnd(r.thu)}</td>
                          <td className="py-1.5 px-2 text-right tabular-nums">{fmtVnd(r.chi)}</td>
                          <td className={`py-1.5 px-2 text-right tabular-nums ${laiClass(r.lai)}`}>
                            {fmtVnd(r.lai)}
                          </td>
                          <td className="py-1.5 px-2 text-right tabular-nums text-muted">
                            {fmtVnd(r.luong)}
                          </td>
                          <td className="py-1.5 px-2 text-right tabular-nums text-muted">
                            {fmtVnd(r.tongcodinh)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
