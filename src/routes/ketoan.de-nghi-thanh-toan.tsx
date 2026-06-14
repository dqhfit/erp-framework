/* ==========================================================
   ketoan.de-nghi-thanh-toan.tsx — Theo dõi ĐỀ NGHỊ THANH TOÁN (port
   DenghiThanhtoanL, DQHF252). Nguồn tr_denghi_thanhtoan (3259 phiếu). Đọc qua
   records API tier-safe (thanhtien_vnd/dathanhtoan/noidung nằm ext jsonb —
   KHÔNG query SQL thô được). Trạng thái suy từ ngayduyet/ngayhuyduyet/dathanhtoan.
   Lọc năm + trạng thái + tìm; chip tổng hợp theo trạng thái.
   ========================================================== */
import { createApiDataSource } from "@erp-framework/client";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { I } from "@/components/Icons";
import { Input, Select } from "@/components/ui";
import { useUserObjects } from "@/stores/userObjects";

export const Route = createFileRoute("/ketoan/de-nghi-thanh-toan")({ component: DeNghiPage });

type StatusKey = "cho" | "duyet" | "tt" | "huy";
interface DnRow {
  sophieu: string;
  ngay: string;
  nguoidenghi: string;
  bophan: string;
  noidung: string;
  tien: number;
  nam: string;
  status: StatusKey;
}

const STATUS: Record<StatusKey, { label: string; cls: string }> = {
  cho: { label: "Chờ duyệt", cls: "bg-warning/15 text-warning" },
  duyet: { label: "Đã duyệt", cls: "bg-accent/15 text-accent" },
  tt: { label: "Đã thanh toán", cls: "bg-success/15 text-success" },
  huy: { label: "Hủy duyệt", cls: "bg-danger/15 text-danger" },
};
const fmtVnd = (n: number): string =>
  Number.isFinite(n) ? n.toLocaleString("vi-VN", { maximumFractionDigits: 0 }) : "0";
const str = (v: unknown): string => (v == null ? "" : String(v)).trim();
const numv = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(String(v ?? "").replace(/[,\s]/g, ""));
  return Number.isNaN(n) ? 0 : n;
};
const truthy = (v: unknown): boolean => v === true || v === "true" || v === "1" || v === 1;

function statusOf(d: Record<string, unknown>): StatusKey {
  if (str(d.ngayhuyduyet)) return "huy";
  if (truthy(d.dathanhtoan)) return "tt";
  if (str(d.ngayduyet)) return "duyet";
  return "cho";
}

function DeNghiPage() {
  const entities = useUserObjects((s) => s.entities);
  const entId = entities.find((e) => e.name === "tr_denghi_thanhtoan")?.id;
  const data = useMemo(() => createApiDataSource(""), []);

  const [rows, setRows] = useState<DnRow[] | null>(null);
  const [err, setErr] = useState("");
  const [year, setYear] = useState("all");
  const [st, setSt] = useState<StatusKey | "all">("all");
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!entId) return;
    let alive = true;
    setRows(null);
    setErr("");
    data
      .getRecords(entId, { limit: 10000, sort: { field: "ngayphieu", dir: "desc" } })
      .then((res) => {
        if (!alive) return;
        setRows(
          res.rows.map((r) => {
            const d = r.data as Record<string, unknown>;
            const ngay = str(d.ngayphieu).slice(0, 10);
            const tien = numv(d.thanhtien_vnd) || numv(d.thanhtien);
            return {
              sophieu: str(d.sophieu),
              ngay,
              nguoidenghi: str(d.nguoidenghi),
              bophan: str(d.bophan),
              noidung: str(d.noidung),
              tien,
              nam: ngay.slice(0, 4),
              status: statusOf(d),
            };
          }),
        );
      })
      .catch((e) => alive && setErr((e as Error).message));
    return () => {
      alive = false;
    };
  }, [entId, data]);

  const years = useMemo(() => {
    const s = new Set<string>();
    for (const r of rows ?? []) if (r.nam) s.add(r.nam);
    return [...s].sort((a, b) => b.localeCompare(a));
  }, [rows]);

  const counts = useMemo(() => {
    const c: Record<StatusKey, { n: number; tien: number }> = {
      cho: { n: 0, tien: 0 },
      duyet: { n: 0, tien: 0 },
      tt: { n: 0, tien: 0 },
      huy: { n: 0, tien: 0 },
    };
    for (const r of (rows ?? []).filter((r) => year === "all" || r.nam === year)) {
      c[r.status].n += 1;
      c[r.status].tien += r.tien;
    }
    return c;
  }, [rows, year]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (rows ?? []).filter(
      (r) =>
        (year === "all" || r.nam === year) &&
        (st === "all" || r.status === st) &&
        (!q || `${r.sophieu} ${r.nguoidenghi} ${r.bophan} ${r.noidung}`.toLowerCase().includes(q)),
    );
  }, [rows, year, st, search]);

  const totalFiltered = useMemo(() => filtered.reduce((a, r) => a + r.tien, 0), [filtered]);

  if (!entId) {
    return (
      <div className="p-6 text-sm text-muted">
        Chưa có entity <code>tr_denghi_thanhtoan</code>.
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-bg text-text overflow-hidden">
      <div className="shrink-0 px-4 py-3 border-b border-border flex items-center gap-3 flex-wrap">
        <I.FileCheck size={18} className="text-accent shrink-0" />
        <span className="font-semibold">Đề nghị thanh toán</span>
        <div className="flex-1" />
        <Select value={year} onChange={(e) => setYear(e.target.value)} className="w-32">
          <option value="all">Tất cả năm</option>
          {years.map((y) => (
            <option key={y} value={y}>
              Năm {y}
            </option>
          ))}
        </Select>
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Tìm phiếu / người / nội dung…"
          className="w-60 h-9"
        />
      </div>

      {/* Chip trạng thái — bấm để lọc */}
      {rows !== null && (
        <div className="shrink-0 px-4 py-2 border-b border-border flex gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => setSt("all")}
            className={`px-2.5 py-1 rounded text-xs ${st === "all" ? "bg-accent/15 text-accent font-semibold" : "bg-bg-soft text-muted"}`}
          >
            Tất cả
          </button>
          {(Object.keys(STATUS) as StatusKey[]).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setSt(st === k ? "all" : k)}
              className={`px-2.5 py-1 rounded text-xs ${st === k ? `${STATUS[k].cls} font-semibold` : "bg-bg-soft text-muted"}`}
            >
              {STATUS[k].label}: {counts[k].n} ({fmtVnd(counts[k].tien)})
            </button>
          ))}
        </div>
      )}

      {err && (
        <div className="m-4 text-sm text-danger border border-danger/30 rounded p-2">{err}</div>
      )}
      {rows === null && !err && (
        <div className="p-6 text-sm text-muted text-center">Đang tải đề nghị…</div>
      )}

      {rows !== null && (
        <div className="flex-1 overflow-auto">
          <table className="w-full text-sm border-collapse">
            <thead className="sticky top-0 bg-panel text-muted text-xs z-10">
              <tr className="border-b border-border text-left">
                <th className="py-2 px-3">Số phiếu</th>
                <th className="py-2 px-3">Ngày</th>
                <th className="py-2 px-3">Người đề nghị</th>
                <th className="py-2 px-3">Bộ phận</th>
                <th className="py-2 px-3">Nội dung</th>
                <th className="py-2 px-3 text-right">Thành tiền</th>
                <th className="py-2 px-3 text-center">Trạng thái</th>
              </tr>
            </thead>
            <tbody>
              {filtered.slice(0, 1000).map((r, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: read-only, không reorder
                <tr key={i} className="border-b border-border/50 hover:bg-hover">
                  <td className="py-1.5 px-3 whitespace-nowrap font-medium">{r.sophieu}</td>
                  <td className="py-1.5 px-3 whitespace-nowrap">{r.ngay}</td>
                  <td className="py-1.5 px-3 whitespace-nowrap">{r.nguoidenghi}</td>
                  <td className="py-1.5 px-3 whitespace-nowrap">{r.bophan}</td>
                  <td className="py-1.5 px-3 max-w-[360px] truncate" title={r.noidung}>
                    {r.noidung}
                  </td>
                  <td className="py-1.5 px-3 text-right tabular-nums">{fmtVnd(r.tien)}</td>
                  <td className="py-1.5 px-3 text-center">
                    <span className={`px-2 py-0.5 rounded text-xs ${STATUS[r.status].cls}`}>
                      {STATUS[r.status].label}
                    </span>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-muted text-xs">
                    Không có đề nghị.
                  </td>
                </tr>
              )}
            </tbody>
            <tfoot className="sticky bottom-0 bg-panel">
              <tr className="border-t border-border font-semibold">
                <td className="py-2 px-3" colSpan={5}>
                  {filtered.length} phiếu{filtered.length > 1000 ? " (hiện 1000)" : ""}
                </td>
                <td className="py-2 px-3 text-right tabular-nums text-accent">
                  {fmtVnd(totalFiltered)}
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
