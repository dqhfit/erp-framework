/* ==========================================================
   ketoan.cong-no.tsx — Báo cáo CÔNG NỢ phải trả NCC (port CongNoL, DQHF252).
   Công nợ = phải trả nhà cung cấp (KHÔNG có phải thu khách hàng). Nguồn:
   tr_nhacc_congno (4585 dòng) join tr_nhacc (tên NCC). "Còn nợ" = Σ tổng tiền
   các chứng từ CHƯA thanh toán (dathanhtoan=false).

   Đọc qua records API (tier-safe: dathanhtoan là bool nằm ext jsonb — KHÔNG
   query SQL thô được). Gộp theo NCC + tính còn nợ ở client.
   ========================================================== */
import { createApiDataSource } from "@erp-framework/client";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { I } from "@/components/Icons";
import { Input, Select } from "@/components/ui";
import { useUserObjects } from "@/stores/userObjects";

export const Route = createFileRoute("/ketoan/cong-no")({ component: CongNoPage });

interface CongNoRow {
  mancc: string;
  chungtu: string;
  sohd: string;
  ngayhd: string;
  noidung: string;
  tongtien: number;
  dathanhtoan: boolean;
  nam: number | null;
}
interface NccSum {
  mancc: string;
  ten: string;
  soCt: number;
  tong: number;
  conNo: number;
}

const fmtVnd = (n: number): string =>
  Number.isFinite(n) ? n.toLocaleString("vi-VN", { maximumFractionDigits: 0 }) : "0";
const fmtDate = (v: unknown): string => (v ? String(v).slice(0, 10) : "");
const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(String(v ?? "").replace(/[,\s]/g, ""));
  return Number.isNaN(n) ? 0 : n;
};
const truthy = (v: unknown): boolean => v === true || v === "true" || v === "1" || v === 1;

function CongNoPage() {
  const entities = useUserObjects((s) => s.entities);
  const congnoId = entities.find((e) => e.name === "tr_nhacc_congno")?.id;
  const nhaccId = entities.find((e) => e.name === "tr_nhacc")?.id;
  const data = useMemo(() => createApiDataSource(""), []);

  const [rows, setRows] = useState<CongNoRow[] | null>(null);
  const [nccMap, setNccMap] = useState<Record<string, string>>({});
  const [err, setErr] = useState("");
  const [year, setYear] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [onlyDebt, setOnlyDebt] = useState(true);
  const [sel, setSel] = useState<string | null>(null); // mancc đang xem chi tiết

  useEffect(() => {
    if (!congnoId) return;
    let alive = true;
    setRows(null);
    setErr("");
    (async () => {
      try {
        const [cn, ncc] = await Promise.all([
          data.getRecords(congnoId, { limit: 10000, sort: { field: "ngayhd", dir: "desc" } }),
          nhaccId ? data.getRecords(nhaccId, { limit: 10000 }) : Promise.resolve({ rows: [] }),
        ]);
        if (!alive) return;
        const map: Record<string, string> = {};
        for (const r of ncc.rows) {
          const d = r.data as Record<string, unknown>;
          const id = String(d.vendor_id ?? "");
          if (id) map[id] = String(d.vendor_name ?? id);
        }
        setNccMap(map);
        setRows(
          cn.rows.map((r) => {
            const d = r.data as Record<string, unknown>;
            return {
              mancc: String(d.mancc ?? ""),
              chungtu: String(d.chungtu ?? ""),
              sohd: String(d.sohd ?? ""),
              ngayhd: fmtDate(d.ngayhd),
              noidung: String(d.noidung ?? ""),
              tongtien: num(d.tongtien),
              dathanhtoan: truthy(d.dathanhtoan),
              nam: d.nam != null ? num(d.nam) : null,
            };
          }),
        );
      } catch (e) {
        if (alive) setErr((e as Error).message);
      }
    })();
    return () => {
      alive = false;
    };
  }, [congnoId, nhaccId, data]);

  const years = useMemo(() => {
    const s = new Set<number>();
    for (const r of rows ?? []) if (r.nam) s.add(r.nam);
    return [...s].sort((a, b) => b - a);
  }, [rows]);

  // Lọc theo năm (client) trước khi gộp.
  const filtered = useMemo(
    () => (rows ?? []).filter((r) => year === "all" || String(r.nam) === year),
    [rows, year],
  );

  const sums = useMemo<NccSum[]>(() => {
    const m = new Map<string, NccSum>();
    for (const r of filtered) {
      let s = m.get(r.mancc);
      if (!s) {
        s = { mancc: r.mancc, ten: nccMap[r.mancc] ?? r.mancc, soCt: 0, tong: 0, conNo: 0 };
        m.set(r.mancc, s);
      }
      s.soCt += 1;
      s.tong += r.tongtien;
      if (!r.dathanhtoan) s.conNo += r.tongtien;
    }
    let arr = [...m.values()];
    if (onlyDebt) arr = arr.filter((s) => Math.round(s.conNo) !== 0);
    const q = search.trim().toLowerCase();
    if (q) arr = arr.filter((s) => `${s.ten} ${s.mancc}`.toLowerCase().includes(q));
    return arr.sort((a, b) => b.conNo - a.conNo);
  }, [filtered, nccMap, onlyDebt, search]);

  const totalConNo = useMemo(() => sums.reduce((a, s) => a + s.conNo, 0), [sums]);
  const detail = useMemo(
    () =>
      sel
        ? filtered.filter((r) => r.mancc === sel).sort((a, b) => b.ngayhd.localeCompare(a.ngayhd))
        : [],
    [sel, filtered],
  );

  if (!congnoId) {
    return (
      <div className="p-6 text-sm text-muted">
        Chưa có entity <code>tr_nhacc_congno</code> — cần migrate bảng công nợ trước.
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-bg text-text overflow-hidden">
      <div className="shrink-0 px-4 py-3 border-b border-border flex items-center gap-3 flex-wrap">
        <I.Receipt size={18} className="text-accent shrink-0" />
        <span className="font-semibold">Công nợ NCC</span>
        <div className="flex-1" />
        <Select value={year} onChange={(e) => setYear(e.target.value)} className="w-32">
          <option value="all">Tất cả năm</option>
          {years.map((y) => (
            <option key={y} value={String(y)}>
              Năm {y}
            </option>
          ))}
        </Select>
        <label className="flex items-center gap-1.5 text-sm text-muted">
          <input
            type="checkbox"
            checked={onlyDebt}
            onChange={(e) => setOnlyDebt(e.target.checked)}
            className="accent-accent"
          />
          Chỉ còn nợ
        </label>
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Tìm NCC…"
          className="w-48 h-9"
        />
      </div>

      {err && (
        <div className="m-4 text-sm text-danger border border-danger/30 rounded p-2">{err}</div>
      )}
      {rows === null && !err && (
        <div className="p-6 text-sm text-muted text-center">Đang tải công nợ…</div>
      )}

      {rows !== null && (
        <div className="flex-1 flex min-h-0 overflow-hidden">
          {/* Bảng tổng hợp theo NCC */}
          <div className="flex-1 min-w-0 overflow-auto">
            <table className="w-full text-sm border-collapse">
              <thead className="sticky top-0 bg-panel text-muted text-xs z-10">
                <tr className="border-b border-border text-left">
                  <th className="py-2 px-3">Nhà cung cấp</th>
                  <th className="py-2 px-3 text-right">Số CT</th>
                  <th className="py-2 px-3 text-right">Tổng tiền</th>
                  <th className="py-2 px-3 text-right">Còn nợ</th>
                </tr>
              </thead>
              <tbody>
                {sums.map((s) => (
                  <tr
                    key={s.mancc}
                    onClick={() => setSel(s.mancc)}
                    className={`border-b border-border/50 cursor-pointer hover:bg-hover ${
                      sel === s.mancc ? "bg-accent/10" : ""
                    }`}
                  >
                    <td className="py-1.5 px-3">
                      <span className="font-medium">{s.ten}</span>
                      {s.ten !== s.mancc && (
                        <span className="text-xs text-muted ml-1">({s.mancc})</span>
                      )}
                    </td>
                    <td className="py-1.5 px-3 text-right tabular-nums">{s.soCt}</td>
                    <td className="py-1.5 px-3 text-right tabular-nums">{fmtVnd(s.tong)}</td>
                    <td
                      className={`py-1.5 px-3 text-right tabular-nums font-semibold ${
                        Math.round(s.conNo) > 0 ? "text-danger" : "text-muted"
                      }`}
                    >
                      {fmtVnd(s.conNo)}
                    </td>
                  </tr>
                ))}
                {sums.length === 0 && (
                  <tr>
                    <td colSpan={4} className="py-8 text-center text-muted text-xs">
                      Không có công nợ.
                    </td>
                  </tr>
                )}
              </tbody>
              <tfoot className="sticky bottom-0 bg-panel">
                <tr className="border-t border-border font-semibold">
                  <td className="py-2 px-3">Tổng còn nợ ({sums.length} NCC)</td>
                  <td />
                  <td />
                  <td className="py-2 px-3 text-right tabular-nums text-danger">
                    {fmtVnd(totalConNo)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Chi tiết chứng từ của NCC đang chọn */}
          {sel && (
            <div className="w-[44%] min-w-[320px] border-l border-border flex flex-col overflow-hidden">
              <div className="shrink-0 px-3 py-2 border-b border-border flex items-center gap-2 bg-panel">
                <span className="text-sm font-medium flex-1 truncate">
                  {nccMap[sel] ?? sel} — chi tiết
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
                <table className="w-full text-xs border-collapse">
                  <thead className="sticky top-0 bg-panel text-muted">
                    <tr className="border-b border-border text-left">
                      <th className="py-1.5 px-2">Ngày HĐ</th>
                      <th className="py-1.5 px-2">Số HĐ</th>
                      <th className="py-1.5 px-2">Nội dung</th>
                      <th className="py-1.5 px-2 text-right">Tổng tiền</th>
                      <th className="py-1.5 px-2 text-center">TT</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.map((r, i) => (
                      // biome-ignore lint/suspicious/noArrayIndexKey: read-only, không reorder
                      <tr key={i} className="border-b border-border/50">
                        <td className="py-1.5 px-2 whitespace-nowrap">{r.ngayhd}</td>
                        <td className="py-1.5 px-2 whitespace-nowrap">{r.sohd || r.chungtu}</td>
                        <td className="py-1.5 px-2">{r.noidung}</td>
                        <td className="py-1.5 px-2 text-right tabular-nums">
                          {fmtVnd(r.tongtien)}
                        </td>
                        <td className="py-1.5 px-2 text-center">
                          {r.dathanhtoan ? (
                            <I.Check size={14} className="inline text-success" />
                          ) : (
                            <span className="text-danger">•</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
