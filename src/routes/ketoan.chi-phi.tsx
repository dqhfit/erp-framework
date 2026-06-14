/* ==========================================================
   ketoan.chi-phi.tsx — Báo cáo CHI PHÍ KINH DOANH (port ChiPhiKinhDoanhL,
   DQHF252). Nguồn kt_chiphi_kinhdoanh (70k dòng, 2005→nay) → gộp theo NHÓM
   chi phí (kt_nhom_chiphi.f_nhomchiphi) SERVER-SIDE qua /banvesvc/chiphi.
   loại = KHOANCHI (chi) | KHOANTHU (thu). Số tiền = sotien × (tygia=0?1:tygia).
   Chọn nhóm → xem chi tiết từng khoản (≤500 dòng gần nhất).
   ========================================================== */
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { I } from "@/components/Icons";
import { Select } from "@/components/ui";

export const Route = createFileRoute("/ketoan/chi-phi")({ component: ChiPhiPage });

interface SumRow {
  nhom_id: string;
  nhom: string | null;
  loai: string | null;
  sl: number;
  tong: number;
}
interface DetailRow {
  ngay: string;
  tenchiphi: string;
  sotien: number;
  amount: number;
  loai: string;
  nhacungcap: string;
  ghichu: string;
}

const LOAI_LABEL: Record<string, string> = { KHOANCHI: "Chi", KHOANTHU: "Thu" };
const fmtVnd = (v: unknown): string => {
  const n = Number(v);
  return Number.isFinite(n) ? n.toLocaleString("vi-VN", { maximumFractionDigits: 0 }) : "0";
};

function ChiPhiPage() {
  const thisYear = new Date().getFullYear();
  const years = useMemo(
    () => Array.from({ length: thisYear - 2017 }, (_, i) => thisYear - i),
    [thisYear],
  );
  const [nam, setNam] = useState(String(thisYear));
  const [loai, setLoai] = useState("KHOANCHI"); // chi phí mặc định
  const [rows, setRows] = useState<SumRow[] | null>(null);
  const [err, setErr] = useState("");
  const [sel, setSel] = useState<SumRow | null>(null);
  const [detail, setDetail] = useState<DetailRow[] | null>(null);

  // Summary theo nhóm.
  useEffect(() => {
    let alive = true;
    setRows(null);
    setErr("");
    setSel(null);
    fetch(`/banvesvc/chiphi?nam=${nam}&loai=${loai}`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`Lỗi ${r.status}`))))
      .then((d: { rows?: SumRow[] }) => {
        if (alive)
          setRows(
            (d.rows ?? []).map((r) => ({ ...r, sl: Number(r.sl), tong: Number(r.tong) || 0 })),
          );
      })
      .catch((e) => alive && setErr((e as Error).message));
    return () => {
      alive = false;
    };
  }, [nam, loai]);

  // Chi tiết khi chọn nhóm.
  useEffect(() => {
    if (!sel) {
      setDetail(null);
      return;
    }
    let alive = true;
    setDetail(null);
    fetch(`/banvesvc/chiphi?nam=${nam}&loai=${loai}&nhom=${encodeURIComponent(sel.nhom_id)}`, {
      credentials: "include",
    })
      .then((r) => (r.ok ? r.json() : { rows: [] }))
      .then((d: { rows?: DetailRow[] }) => {
        if (alive)
          setDetail(
            (d.rows ?? []).map((r) => ({
              ...r,
              sotien: Number(r.sotien) || 0,
              amount: Number(r.amount) || 0,
            })),
          );
      })
      .catch(() => alive && setDetail([]));
    return () => {
      alive = false;
    };
  }, [sel, nam, loai]);

  const total = useMemo(() => (rows ?? []).reduce((a, r) => a + r.tong, 0), [rows]);

  return (
    <div className="h-full flex flex-col bg-bg text-text overflow-hidden">
      <div className="shrink-0 px-4 py-3 border-b border-border flex items-center gap-3 flex-wrap">
        <I.DollarSign size={18} className="text-accent shrink-0" />
        <span className="font-semibold">Chi phí kinh doanh</span>
        <div className="flex-1" />
        <Select value={loai} onChange={(e) => setLoai(e.target.value)} className="w-28">
          <option value="KHOANCHI">Chi</option>
          <option value="KHOANTHU">Thu</option>
          <option value="">Tất cả</option>
        </Select>
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
        <div className="p-6 text-sm text-muted text-center">Đang tải chi phí…</div>
      )}

      {rows !== null && (
        <div className="flex-1 flex min-h-0 overflow-hidden">
          <div className="flex-1 min-w-0 overflow-auto">
            <table className="w-full text-sm border-collapse">
              <thead className="sticky top-0 bg-panel text-muted text-xs z-10">
                <tr className="border-b border-border text-left">
                  <th className="py-2 px-3">Nhóm chi phí</th>
                  <th className="py-2 px-3 text-center">Loại</th>
                  <th className="py-2 px-3 text-right">Số dòng</th>
                  <th className="py-2 px-3 text-right">Tổng tiền</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.nhom_id}
                    onClick={() => setSel(r)}
                    className={`border-b border-border/50 cursor-pointer hover:bg-hover ${
                      sel?.nhom_id === r.nhom_id ? "bg-accent/10" : ""
                    }`}
                  >
                    <td className="py-1.5 px-3 font-medium">{r.nhom ?? `#${r.nhom_id}`}</td>
                    <td className="py-1.5 px-3 text-center text-xs text-muted">
                      {LOAI_LABEL[r.loai ?? ""] ?? r.loai}
                    </td>
                    <td className="py-1.5 px-3 text-right tabular-nums">{r.sl}</td>
                    <td className="py-1.5 px-3 text-right tabular-nums font-semibold">
                      {fmtVnd(r.tong)}
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={4} className="py-8 text-center text-muted text-xs">
                      Không có chi phí.
                    </td>
                  </tr>
                )}
              </tbody>
              <tfoot className="sticky bottom-0 bg-panel">
                <tr className="border-t border-border font-semibold">
                  <td className="py-2 px-3" colSpan={3}>
                    Tổng ({rows.length} nhóm)
                  </td>
                  <td className="py-2 px-3 text-right tabular-nums text-accent">{fmtVnd(total)}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          {sel && (
            <div className="w-[46%] min-w-[340px] border-l border-border flex flex-col overflow-hidden">
              <div className="shrink-0 px-3 py-2 border-b border-border flex items-center gap-2 bg-panel">
                <span className="text-sm font-medium flex-1 truncate">
                  {sel.nhom ?? `#${sel.nhom_id}`} — chi tiết
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
                        <th className="py-1.5 px-2">Ngày</th>
                        <th className="py-1.5 px-2">Khoản chi phí</th>
                        <th className="py-1.5 px-2">NCC</th>
                        <th className="py-1.5 px-2 text-right">Số tiền</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.map((r, i) => (
                        // biome-ignore lint/suspicious/noArrayIndexKey: read-only, không reorder
                        <tr key={i} className="border-b border-border/50">
                          <td className="py-1.5 px-2 whitespace-nowrap">{r.ngay}</td>
                          <td className="py-1.5 px-2">{r.tenchiphi}</td>
                          <td className="py-1.5 px-2">{r.nhacungcap}</td>
                          <td className="py-1.5 px-2 text-right tabular-nums">
                            {fmtVnd(r.amount)}
                          </td>
                        </tr>
                      ))}
                      {detail.length >= 500 && (
                        <tr>
                          <td colSpan={4} className="py-1 text-center text-[10px] text-muted">
                            Hiển thị 500 dòng gần nhất.
                          </td>
                        </tr>
                      )}
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
