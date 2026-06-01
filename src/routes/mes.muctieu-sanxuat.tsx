/* ==========================================================
   mes.muctieu-sanxuat — Mục tiêu sản xuất (MES)
   Port từ frmMucTieuSanXuat2 DQHF WinForms.

   Luồng:
   1. Chọn Tháng / Năm + Bộ phận (mã công đoạn)
   2. Nhấn "Tải" → getOrCreateChitiet + initThang
   3. Grid header: 4 mức thưởng (col summary)
   4. Grid chi tiết: từng ngày trong tháng (editable)
   5. Nút "Lưu chi tiết" → saveChitiet cho từng row đã thay đổi
   6. Nút "Tính toán" → tinhtoan → reload header
   ========================================================== */

import {
  createMesMucTieuSanXuatClient,
  type MucTieuChitietRow,
  type MucTieuThangRow,
} from "@erp-framework/client";
import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { I } from "@/components/Icons";
import { Button } from "@/components/ui";
import { dialog } from "@/lib/dialog";

const api = createMesMucTieuSanXuatClient("");

/* ── Helpers ── */

const DAY_VI: Record<string, string> = {
  Mon: "Thứ 2",
  Tue: "Thứ 3",
  Wed: "Thứ 4",
  Thu: "Thứ 5",
  Fri: "Thứ 6",
  Sat: "Thứ 7",
  Sun: "Chủ nhật",
};

function fmt(v: number | null | undefined, dp = 1): string {
  if (v == null || Number.isNaN(v)) return "";
  return v === 0 ? "0" : v.toFixed(dp).replace(/\.?0+$/, "");
}

/* ── Grid header (4 mức thưởng) ── */

const HEADER_COLS: Array<{ key: keyof MucTieuThangRow; label: string; title: string }> = [
  { key: "mucThuong", label: "Mức", title: "Mức thưởng" },
  { key: "soNguoi", label: "SN", title: "Số người" },
  { key: "col2", label: "Ráp", title: "Cont ráp MT" },
  { key: "col1", label: "Rời", title: "Cont rời MT" },
  { key: "col5", label: "M³MT", title: "Số khối MT không TC" },
  { key: "col6", label: "TL", title: "Tỉ lệ MT (M³/8h)" },
  { key: "col11", label: "M³TC", title: "Số khối MT có TC" },
  { key: "col13", label: "GiTT", title: "Giờ thực tế" },
  { key: "col14", label: "M³TT", title: "Số khối thực tế" },
  { key: "col16", label: "M³HT", title: "Số khối hoàn thành" },
  { key: "col17", label: "TLHT", title: "Tỉ lệ hoàn thành" },
  { key: "col18", label: "KQ", title: "Kết quả" },
  { key: "col19", label: "SNTB", title: "Số người TB" },
  { key: "col20", label: "Tiền", title: "Tiền thưởng/người" },
  { key: "col21", label: "T.Tiền", title: "Tổng tiền thưởng" },
];

function HeaderGrid({ rows }: { rows: MucTieuThangRow[] }) {
  if (rows.length === 0) {
    return <p className="text-sm text-slate-400 italic">Chưa có dữ liệu header tháng.</p>;
  }
  return (
    <div className="overflow-x-auto rounded border border-slate-200">
      <table className="w-full text-xs">
        <thead>
          <tr className="bg-slate-50 border-b border-slate-200">
            {HEADER_COLS.map((c) => (
              <th
                key={c.key}
                title={c.title}
                className="px-2 py-1.5 text-right font-medium text-slate-600 whitespace-nowrap first:text-center"
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-b border-slate-100 last:border-0 hover:bg-sky-50/40">
              {HEADER_COLS.map((c) => {
                const v = row[c.key];
                return (
                  <td
                    key={c.key}
                    className={`px-2 py-1 text-right ${c.key === "mucThuong" ? "text-center font-bold text-sky-700" : ""} ${c.key === "col18" ? (v === "Dat" ? "text-emerald-600 font-semibold text-center" : "text-slate-400 text-center") : ""}`}
                  >
                    {c.key === "col18"
                      ? v === "Dat"
                        ? "Đạt"
                        : "—"
                      : c.key === "mucThuong"
                        ? `Mức ${v}`
                        : typeof v === "number"
                          ? fmt(v)
                          : ((v as string | null) ?? "")}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ── Grid chi tiết hàng ngày ── */

type EditableField =
  | "mucTieuSoGio"
  | "soNguoiHienDienHc"
  | "soNguoiHienDienTc"
  | "soKhoiHoanThanh"
  | "veGiuaGio"
  | "contRoi"
  | "contRap";

const EDITABLE_FIELDS: Array<{ key: EditableField; label: string; title: string }> = [
  { key: "mucTieuSoGio", label: "GioMT", title: "Giờ mục tiêu/ngày (>8 = có TC)" },
  { key: "soNguoiHienDienHc", label: "NHC", title: "Số người hiện diện HC" },
  { key: "soNguoiHienDienTc", label: "NTC", title: "Số người hiện diện TC" },
  { key: "soKhoiHoanThanh", label: "M³HT", title: "Số khối hoàn thành (GetM3)" },
  { key: "veGiuaGio", label: "VGG", title: "Về giữa giờ (h)" },
  { key: "contRoi", label: "CRoi", title: "Cont rời thực tế" },
  { key: "contRap", label: "CRap", title: "Cont ráp thực tế" },
];

const READ_COLS: Array<{ key: keyof MucTieuChitietRow; label: string; title: string }> = [
  { key: "mucTieuTongGio", label: "GioMT∑", title: "Tổng giờ mục tiêu" },
  { key: "tongGio", label: "GioTT", title: "Tổng giờ thực tế" },
  { key: "soKhoi", label: "M³", title: "Số khối" },
  { key: "tile", label: "TL", title: "Tỉ lệ" },
  { key: "tileHoanThanh", label: "TLHT", title: "Tỉ lệ hoàn thành" },
  { key: "gioChenhlech", label: "GioCL", title: "Giờ chênh lệch" },
  { key: "gioCanBu", label: "GioBu", title: "Giờ cần bù lũy kế" },
];

function ChitietGrid({
  rows,
  dirty,
  onCellChange,
}: {
  rows: MucTieuChitietRow[];
  dirty: Set<string>;
  onCellChange: (id: string, field: EditableField, value: number) => void;
}) {
  if (rows.length === 0) {
    return <p className="text-sm text-slate-400 italic">Chưa có dữ liệu chi tiết.</p>;
  }

  return (
    <div className="overflow-x-auto rounded border border-slate-200">
      <table className="w-full text-xs">
        <thead>
          <tr className="bg-slate-50 border-b border-slate-200">
            <th className="px-2 py-1.5 text-left font-medium text-slate-600 whitespace-nowrap">
              Ngày
            </th>
            <th className="px-2 py-1.5 text-center font-medium text-slate-600">Thứ</th>
            {EDITABLE_FIELDS.map((c) => (
              <th
                key={c.key}
                title={c.title}
                className="px-1.5 py-1.5 text-right font-medium text-sky-700 whitespace-nowrap bg-sky-50"
              >
                {c.label}
              </th>
            ))}
            {READ_COLS.map((c) => (
              <th
                key={String(c.key)}
                title={c.title}
                className="px-1.5 py-1.5 text-right font-medium text-slate-500 whitespace-nowrap"
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const isSun = row.dayName === "Sun";
            const isDirty = dirty.has(row.id);
            const date = new Date(row.ngaythang);
            const dayLabel = DAY_VI[row.dayName ?? ""] ?? row.dayName ?? "";
            return (
              <tr
                key={row.id}
                className={[
                  "border-b border-slate-100 last:border-0",
                  isSun ? "bg-orange-50" : "hover:bg-sky-50/30",
                  isDirty ? "ring-1 ring-inset ring-amber-300" : "",
                ].join(" ")}
              >
                <td className="px-2 py-1 whitespace-nowrap text-slate-700">
                  {/* ngaythang lưu UTC-midnight (cột PG `date`) — đọc UTC để
                      khớp dayName và không lệch ngày ở trình duyệt tz âm. */}
                  {date.getUTCDate().toString().padStart(2, "0")}/
                  {(date.getUTCMonth() + 1).toString().padStart(2, "0")}
                </td>
                <td
                  className={`px-2 py-1 text-center ${isSun ? "font-semibold text-orange-600" : "text-slate-500"}`}
                >
                  {dayLabel}
                </td>
                {EDITABLE_FIELDS.map((c) => (
                  <td key={c.key} className="px-0.5 py-0.5 bg-sky-50/40">
                    <input
                      type="number"
                      step="any"
                      value={(row[c.key] as number) || ""}
                      onChange={(e) => onCellChange(row.id, c.key, parseFloat(e.target.value) || 0)}
                      className="w-16 rounded border border-slate-200 px-1.5 py-0.5 text-right text-xs focus:border-sky-400 focus:outline-none bg-white"
                    />
                  </td>
                ))}
                {READ_COLS.map((c) => {
                  const v = row[c.key] as number;
                  const neg = typeof v === "number" && v < 0;
                  return (
                    <td
                      key={String(c.key)}
                      className={`px-2 py-1 text-right tabular-nums ${neg ? "text-red-500" : "text-slate-600"}`}
                    >
                      {fmt(v)}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ── Main page ── */

const CURRENT_YEAR = new Date().getFullYear();

/** Dải năm fallback khi DB chưa có dữ liệu. */
function fallbackYears(): number[] {
  return Array.from({ length: 7 }, (_, i) => CURRENT_YEAR - 3 + i);
}

function MucTieuSanXuatPage() {
  const [nam, setNam] = useState(CURRENT_YEAR);
  const [thang, setThang] = useState(new Date().getMonth() + 1);
  const [maBoPhan, setMaBoPhan] = useState("");

  const [boPhanList, setBoPhanList] = useState<string[]>([]);
  const [namList, setNamList] = useState<number[]>([]);

  const [headerRows, setHeaderRows] = useState<MucTieuThangRow[]>([]);
  const [chitietRows, setChitietRows] = useState<MucTieuChitietRow[]>([]);
  // Lưu edit state cục bộ (chưa save)
  const editRef = useRef<Record<string, Partial<MucTieuChitietRow>>>({});
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  /* Load danh sách bộ phận + năm khi mount — chạy 1 lần */
  useEffect(() => {
    Promise.all([api.listBoPhan(), api.listNam()])
      .then(([bp, nm]) => {
        setBoPhanList(bp);
        setNamList(nm.length ? nm : fallbackYears());
        // Tự chọn bộ phận đầu tiên nếu user chưa chọn
        if (bp.length) setMaBoPhan((prev) => (prev || bp[0]) ?? "");
      })
      .catch(() => {
        setNamList(fallbackYears());
      });
  }, []); // mount-only — api là module singleton, không thay đổi

  /* Merge edits vào rows để hiển thị */
  const mergedRows = chitietRows.map((r) => ({
    ...r,
    ...editRef.current[r.id],
  }));

  const reload = useCallback(async () => {
    if (!maBoPhan.trim()) return;
    setLoading(true);
    try {
      const [ct, ht] = await Promise.all([
        api.getOrCreateChitiet(nam, thang, maBoPhan),
        api.initThang(nam, thang, maBoPhan),
      ]);
      setChitietRows(ct as MucTieuChitietRow[]);
      setHeaderRows(ht as MucTieuThangRow[]);
      editRef.current = {};
      setDirty(new Set());
    } catch (e: unknown) {
      dialog.alert(`Lỗi tải dữ liệu: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, [nam, thang, maBoPhan]);

  const handleCellChange = useCallback((id: string, field: EditableField, value: number) => {
    editRef.current[id] = { ...editRef.current[id], [field]: value };
    setDirty((prev) => new Set(prev).add(id));
  }, []);

  const handleSaveChitiet = async () => {
    const ids = Array.from(dirty);
    if (ids.length === 0) return;
    setBusy("save");
    try {
      for (const id of ids) {
        const base = chitietRows.find((r) => r.id === id);
        if (!base) continue;
        const edit = editRef.current[id] ?? {};
        await api.saveChitiet({
          id,
          mucTieuSoGio: (edit.mucTieuSoGio ?? base.mucTieuSoGio) as number,
          soNguoiHcInput: (edit.soNguoiHienDienHc ?? base.soNguoiHienDienHc) as number,
          soNguoiTcInput: (edit.soNguoiHienDienTc ?? base.soNguoiHienDienTc) as number,
          soKhoiHoanThanh: (edit.soKhoiHoanThanh ?? base.soKhoiHoanThanh) as number,
          veGiuaGio: (edit.veGiuaGio ?? base.veGiuaGio) as number,
          contRoi: (edit.contRoi ?? base.contRoi) as number,
          contRap: (edit.contRap ?? base.contRap) as number,
        });
      }
      await reload();
    } catch (e: unknown) {
      dialog.alert(`Lỗi lưu: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  const handleTinhtoan = async () => {
    if (!maBoPhan.trim()) return;
    setBusy("tinhtoan");
    try {
      await api.tinhtoan(nam, thang, maBoPhan);
      const ht = await api.listThang(nam, thang, maBoPhan);
      setHeaderRows(ht as MucTieuThangRow[]);
      // Reload chitiet để cập nhật sokhoi, tile_hoanthanh, gio_canbu
      const ct = await api.getOrCreateChitiet(nam, thang, maBoPhan);
      setChitietRows(ct as MucTieuChitietRow[]);
      editRef.current = {};
      setDirty(new Set());
    } catch (e: unknown) {
      dialog.alert(`Lỗi tính toán: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex h-full flex-col gap-4 overflow-auto p-4">
      {/* Tiêu đề + bộ lọc */}
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <p className="mb-1 text-xs font-medium text-slate-500">Tháng</p>
          <select
            value={thang}
            onChange={(e) => setThang(Number(e.target.value))}
            className="rounded border border-slate-200 px-2 py-1.5 text-sm focus:border-sky-400 focus:outline-none"
          >
            {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
              <option key={m} value={m}>
                Tháng {m}
              </option>
            ))}
          </select>
        </div>
        <div>
          <p className="mb-1 text-xs font-medium text-slate-500">Năm</p>
          <select
            value={nam}
            onChange={(e) => setNam(Number(e.target.value))}
            className="rounded border border-slate-200 px-2 py-1.5 text-sm focus:border-sky-400 focus:outline-none"
          >
            {namList.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </div>
        <div>
          <p className="mb-1 text-xs font-medium text-slate-500">Bộ phận / Công đoạn</p>
          {boPhanList.length > 0 ? (
            <select
              value={maBoPhan}
              onChange={(e) => setMaBoPhan(e.target.value)}
              className="rounded border border-slate-200 px-2 py-1.5 text-sm focus:border-sky-400 focus:outline-none"
            >
              {boPhanList.map((bp) => (
                <option key={bp} value={bp}>
                  {bp}
                </option>
              ))}
            </select>
          ) : (
            <div className="rounded border border-slate-200 bg-slate-50 px-2 py-1.5 text-sm text-slate-400">
              Chưa có dữ liệu — hãy migrate trước
            </div>
          )}
        </div>
        <Button
          onClick={reload}
          disabled={!maBoPhan || loading}
          className="flex items-center gap-1.5"
        >
          {loading ? <I.Loader size={14} className="animate-spin" /> : <I.Download size={14} />}
          Tải
        </Button>
        {chitietRows.length > 0 && (
          <>
            <Button
              onClick={handleSaveChitiet}
              disabled={dirty.size === 0 || busy === "save"}
              variant="ghost"
              className="flex items-center gap-1.5"
            >
              {busy === "save" ? (
                <I.Loader size={14} className="animate-spin" />
              ) : (
                <I.Save size={14} />
              )}
              Lưu chi tiết ({dirty.size})
            </Button>
            <Button
              onClick={handleTinhtoan}
              disabled={busy === "tinhtoan"}
              variant="ghost"
              className="flex items-center gap-1.5"
            >
              {busy === "tinhtoan" ? (
                <I.Loader size={14} className="animate-spin" />
              ) : (
                <I.Calculator size={14} />
              )}
              Tính toán
            </Button>
          </>
        )}
      </div>

      {/* Grid header 4 mức thưởng */}
      {headerRows.length > 0 && (
        <section>
          <h2 className="mb-1.5 text-sm font-semibold text-slate-700">
            Tổng hợp tháng {thang}/{nam}
            <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs font-normal text-slate-600">
              Bộ phận: {maBoPhan}
            </span>
          </h2>
          <HeaderGrid rows={headerRows} />
        </section>
      )}

      {/* Grid chi tiết hàng ngày */}
      {chitietRows.length > 0 && (
        <section>
          <h2 className="mb-1.5 text-sm font-semibold text-slate-700">
            Chi tiết từng ngày
            {dirty.size > 0 && (
              <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700">
                {dirty.size} hàng chưa lưu
              </span>
            )}
          </h2>
          <ChitietGrid rows={mergedRows} dirty={dirty} onCellChange={handleCellChange} />
        </section>
      )}

      {chitietRows.length === 0 && !loading && maBoPhan && (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 text-slate-400">
          <I.Table size={36} className="opacity-30" />
          <p className="text-sm">
            Chọn bộ phận và nhấn <strong>Tải</strong> để bắt đầu.
          </p>
        </div>
      )}
    </div>
  );
}

export const Route = createFileRoute("/mes/muctieu-sanxuat")({
  component: MucTieuSanXuatPage,
});
