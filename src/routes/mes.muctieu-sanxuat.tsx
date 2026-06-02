/* ==========================================================
   mes.muctieu-sanxuat — Mục tiêu sản xuất (MES)
   Port từ frmMucTieuSanXuat2 DQHF WinForms.

   Kiểu kỳ (period mode):
   - Tháng       : chọn tháng + năm → Tải + sửa grid + Tính toán (flow gốc).
   - Ngày        : chọn 1 ngày → xem read-only (header tháng đó + ngày đó).
   - Khoảng ngày : từ ngày → đến ngày → xem read-only gộp nhiều ngày.
   - Khoảng tháng: từ tháng/năm → đến tháng/năm → xem read-only gộp.

   Chế độ read-only hiển thị CẢ header tổng hợp (4 mức thưởng / tháng) lẫn
   chi tiết hàng ngày gộp; không sửa, không Tính toán.
   ========================================================== */

import {
  createMesMucTieuSanXuatClient,
  type MucTieuChitietRow,
  type MucTieuThangRow,
} from "@erp-framework/client";
import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { I } from "@/components/Icons";
import { Button, SearchableSelect } from "@/components/ui";
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

const pad2 = (n: number) => String(n).padStart(2, "0");
/** ISO YYYY-MM-DD theo lịch địa phương (dùng cho giá trị mặc định picker). */
function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
function curYm(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
}
function firstDayIso(nam: number, thang: number): string {
  return `${nam}-${pad2(thang)}-01`;
}
function lastDayIso(nam: number, thang: number): string {
  const last = new Date(Date.UTC(nam, thang, 0)).getUTCDate();
  return `${nam}-${pad2(thang)}-${pad2(last)}`;
}
/** Tách "YYYY-MM" → [nam, thang]. */
function ymParse(ym: string): [number, number] {
  const [y, m] = ym.split("-").map(Number);
  return [y || new Date().getFullYear(), m || 1];
}
/** Tách "YYYY-MM-DD" → [nam, thang]. */
function dateMonth(iso: string): [number, number] {
  const [y, m] = iso.split("-").map(Number);
  return [y || new Date().getFullYear(), m || 1];
}

type PeriodMode = "thang" | "ngay" | "khoangNgay" | "khoangThang";

const MODE_OPTIONS: Array<{ value: PeriodMode; label: string }> = [
  { value: "thang", label: "Tháng (sửa)" },
  { value: "ngay", label: "Ngày" },
  { value: "khoangNgay", label: "Khoảng ngày" },
  { value: "khoangThang", label: "Khoảng tháng" },
];

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

function HeaderGrid({
  rows,
  showPeriod,
}: {
  rows: MucTieuThangRow[];
  /** Hiện cột Năm/Tháng (chế độ xem nhiều tháng). */
  showPeriod?: boolean;
}) {
  if (rows.length === 0) {
    return <p className="text-sm text-muted italic">Chưa có dữ liệu header.</p>;
  }
  return (
    <div className="overflow-x-auto rounded border border-border">
      <table className="w-full text-xs">
        <thead>
          <tr className="bg-bg-soft border-b border-border">
            {showPeriod && (
              <>
                <th className="px-2 py-1.5 text-center font-medium text-muted">Năm</th>
                <th className="px-2 py-1.5 text-center font-medium text-muted">Th</th>
              </>
            )}
            {HEADER_COLS.map((c) => (
              <th
                key={c.key}
                title={c.title}
                className="px-2 py-1.5 text-right font-medium text-muted whitespace-nowrap first:text-center"
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-b border-border/50 last:border-0 hover:bg-hover/30">
              {showPeriod && (
                <>
                  <td className="px-2 py-1 text-center text-muted tabular-nums">{row.nam}</td>
                  <td className="px-2 py-1 text-center text-muted tabular-nums">{row.thang}</td>
                </>
              )}
              {HEADER_COLS.map((c) => {
                const v = row[c.key];
                return (
                  <td
                    key={c.key}
                    className={`px-2 py-1 text-right ${c.key === "mucThuong" ? "text-center font-bold text-sky-700" : ""} ${c.key === "col18" ? (v === "Dat" ? "text-emerald-600 font-semibold text-center" : "text-muted text-center") : ""}`}
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
  readOnly,
}: {
  rows: MucTieuChitietRow[];
  dirty: Set<string>;
  onCellChange: (id: string, field: EditableField, value: number) => void;
  /** Chế độ xem (khoảng/ngày): hiện text thay input, ngày kèm năm. */
  readOnly?: boolean;
}) {
  if (rows.length === 0) {
    return <p className="text-sm text-muted italic">Chưa có dữ liệu chi tiết.</p>;
  }

  return (
    <div className="overflow-x-auto rounded border border-border">
      <table className="w-full text-xs">
        <thead>
          <tr className="bg-bg-soft border-b border-border">
            <th className="px-2 py-1.5 text-left font-medium text-muted whitespace-nowrap">Ngày</th>
            <th className="px-2 py-1.5 text-center font-medium text-muted">Thứ</th>
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
                className="px-1.5 py-1.5 text-right font-medium text-muted whitespace-nowrap"
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
                  "border-b border-border/50 last:border-0",
                  isSun ? "bg-orange-50" : "hover:bg-hover/20",
                  isDirty ? "ring-1 ring-inset ring-amber-300" : "",
                ].join(" ")}
              >
                <td className="px-2 py-1 whitespace-nowrap text-text tabular-nums">
                  {/* ngaythang lưu UTC-midnight (cột PG `date`) — đọc UTC để
                      khớp dayName và không lệch ngày ở trình duyệt tz âm. */}
                  {date.getUTCDate().toString().padStart(2, "0")}/
                  {(date.getUTCMonth() + 1).toString().padStart(2, "0")}
                  {readOnly ? `/${date.getUTCFullYear()}` : ""}
                </td>
                <td
                  className={`px-2 py-1 text-center ${isSun ? "font-semibold text-orange-600" : "text-muted"}`}
                >
                  {dayLabel}
                </td>
                {EDITABLE_FIELDS.map((c) =>
                  readOnly ? (
                    <td key={c.key} className="px-2 py-1 text-right tabular-nums text-text">
                      {fmt(row[c.key] as number)}
                    </td>
                  ) : (
                    <td key={c.key} className="px-0.5 py-0.5 bg-sky-50/40">
                      <input
                        type="number"
                        step="any"
                        value={(row[c.key] as number) || ""}
                        onChange={(e) =>
                          onCellChange(row.id, c.key, parseFloat(e.target.value) || 0)
                        }
                        className="w-16 rounded border border-border px-1.5 py-0.5 text-right text-xs focus:border-accent focus:outline-none bg-panel"
                      />
                    </td>
                  ),
                )}
                {READ_COLS.map((c) => {
                  const v = row[c.key] as number;
                  const neg = typeof v === "number" && v < 0;
                  return (
                    <td
                      key={String(c.key)}
                      className={`px-2 py-1 text-right tabular-nums ${neg ? "text-red-500" : "text-muted"}`}
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
  const [mode, setMode] = useState<PeriodMode>("thang");

  // Chế độ Tháng (sửa)
  const [nam, setNam] = useState(CURRENT_YEAR);
  const [thang, setThang] = useState(new Date().getMonth() + 1);
  // Chế độ Ngày
  const [ngay, setNgay] = useState<string>(todayIso());
  // Chế độ Khoảng ngày
  const [tuNgay, setTuNgay] = useState<string>(
    firstDayIso(CURRENT_YEAR, new Date().getMonth() + 1),
  );
  const [denNgay, setDenNgay] = useState<string>(todayIso());
  // Chế độ Khoảng tháng (input type=month → "YYYY-MM")
  const [tuThangYm, setTuThangYm] = useState<string>(curYm());
  const [denThangYm, setDenThangYm] = useState<string>(curYm());

  const [maBoPhan, setMaBoPhan] = useState("");

  const [boPhanList, setBoPhanList] = useState<string[]>([]);
  const [namList, setNamList] = useState<number[]>([]);

  const [headerRows, setHeaderRows] = useState<MucTieuThangRow[]>([]);
  const [chitietRows, setChitietRows] = useState<MucTieuChitietRow[]>([]);
  // Lưu edit state cục bộ (chưa save) — chỉ dùng ở chế độ Tháng.
  const editRef = useRef<Record<string, Partial<MucTieuChitietRow>>>({});
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  // Mô tả kỳ đã tải (để tiêu đề khớp dữ liệu, không đổi theo input đang gõ).
  const [loadedLabel, setLoadedLabel] = useState<string>("");

  const isReadOnly = mode !== "thang";

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

  /* Merge edits vào rows để hiển thị (chế độ Tháng) */
  const mergedRows = chitietRows.map((r) => ({
    ...r,
    ...editRef.current[r.id],
  }));

  const reload = useCallback(async () => {
    if (!maBoPhan.trim()) return;
    setLoading(true);
    try {
      if (mode === "thang") {
        const [ct, ht] = await Promise.all([
          api.getOrCreateChitiet(nam, thang, maBoPhan),
          api.initThang(nam, thang, maBoPhan),
        ]);
        setChitietRows(ct as MucTieuChitietRow[]);
        setHeaderRows(ht as MucTieuThangRow[]);
        setLoadedLabel(`Tháng ${thang}/${nam}`);
      } else {
        // Suy ra khoảng ngày (chi tiết) + khoảng tháng (header) theo từng mode.
        let fromDate: string;
        let toDate: string;
        let namFrom: number;
        let thangFrom: number;
        let namTo: number;
        let thangTo: number;
        let label: string;

        if (mode === "ngay") {
          fromDate = ngay;
          toDate = ngay;
          [namFrom, thangFrom] = dateMonth(ngay);
          [namTo, thangTo] = [namFrom, thangFrom];
          label = `Ngày ${ngay.split("-").reverse().join("/")}`;
        } else if (mode === "khoangNgay") {
          fromDate = tuNgay <= denNgay ? tuNgay : denNgay;
          toDate = tuNgay <= denNgay ? denNgay : tuNgay;
          [namFrom, thangFrom] = dateMonth(fromDate);
          [namTo, thangTo] = dateMonth(toDate);
          label = `${fromDate.split("-").reverse().join("/")} → ${toDate.split("-").reverse().join("/")}`;
        } else {
          // khoangThang
          const [yF, mF] = ymParse(tuThangYm);
          const [yT, mT] = ymParse(denThangYm);
          const aKey = yF * 100 + mF;
          const bKey = yT * 100 + mT;
          [namFrom, thangFrom] = aKey <= bKey ? [yF, mF] : [yT, mT];
          [namTo, thangTo] = aKey <= bKey ? [yT, mT] : [yF, mF];
          fromDate = firstDayIso(namFrom, thangFrom);
          toDate = lastDayIso(namTo, thangTo);
          label = `${pad2(thangFrom)}/${namFrom} → ${pad2(thangTo)}/${namTo}`;
        }

        const [ct, ht] = await Promise.all([
          api.listChitietRange({ fromDate, toDate, maBoPhan }),
          api.listThangRange({ namFrom, thangFrom, namTo, thangTo, maBoPhan }),
        ]);
        setChitietRows(ct as MucTieuChitietRow[]);
        setHeaderRows(ht as MucTieuThangRow[]);
        setLoadedLabel(label);
      }
      editRef.current = {};
      setDirty(new Set());
    } catch (e: unknown) {
      dialog.alert(`Lỗi tải dữ liệu: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, [mode, nam, thang, ngay, tuNgay, denNgay, tuThangYm, denThangYm, maBoPhan]);

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

  /* ── Bộ chọn kỳ theo mode ── */
  const renderPeriodInputs = () => {
    if (mode === "thang") {
      return (
        <>
          <div>
            <p className="mb-1 text-xs font-medium text-muted">Tháng</p>
            <SearchableSelect
              value={String(thang)}
              onChange={(v) => setThang(Number(v))}
              options={Array.from({ length: 12 }, (_, i) => i + 1).map((m) => ({
                value: String(m),
                label: `Tháng ${m}`,
              }))}
              className="w-32"
            />
          </div>
          <div>
            <p className="mb-1 text-xs font-medium text-muted">Năm</p>
            <SearchableSelect
              value={String(nam)}
              onChange={(v) => setNam(Number(v))}
              options={namList.map((y) => ({ value: String(y), label: String(y) }))}
              className="w-28"
            />
          </div>
        </>
      );
    }
    if (mode === "ngay") {
      return (
        <div>
          <p className="mb-1 text-xs font-medium text-muted">Ngày</p>
          <input
            type="date"
            value={ngay}
            onChange={(e) => setNgay(e.target.value)}
            className="rounded border border-border px-2 py-1.5 text-sm focus:border-accent focus:outline-none"
          />
        </div>
      );
    }
    if (mode === "khoangNgay") {
      return (
        <>
          <div>
            <p className="mb-1 text-xs font-medium text-muted">Từ ngày</p>
            <input
              type="date"
              value={tuNgay}
              onChange={(e) => setTuNgay(e.target.value)}
              className="rounded border border-border px-2 py-1.5 text-sm focus:border-accent focus:outline-none"
            />
          </div>
          <div>
            <p className="mb-1 text-xs font-medium text-muted">Đến ngày</p>
            <input
              type="date"
              value={denNgay}
              onChange={(e) => setDenNgay(e.target.value)}
              className="rounded border border-border px-2 py-1.5 text-sm focus:border-accent focus:outline-none"
            />
          </div>
        </>
      );
    }
    // khoangThang
    return (
      <>
        <div>
          <p className="mb-1 text-xs font-medium text-muted">Từ tháng</p>
          <input
            type="month"
            value={tuThangYm}
            onChange={(e) => setTuThangYm(e.target.value)}
            className="rounded border border-border px-2 py-1.5 text-sm focus:border-accent focus:outline-none"
          />
        </div>
        <div>
          <p className="mb-1 text-xs font-medium text-muted">Đến tháng</p>
          <input
            type="month"
            value={denThangYm}
            onChange={(e) => setDenThangYm(e.target.value)}
            className="rounded border border-border px-2 py-1.5 text-sm focus:border-accent focus:outline-none"
          />
        </div>
      </>
    );
  };

  return (
    <div className="flex h-full flex-col gap-4 overflow-auto p-4">
      {/* Tiêu đề + bộ lọc */}
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <p className="mb-1 text-xs font-medium text-muted">Kiểu kỳ</p>
          <SearchableSelect
            value={mode}
            onChange={(v) => setMode(v as PeriodMode)}
            options={MODE_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
            className="w-40"
          />
        </div>

        {renderPeriodInputs()}

        <div>
          <p className="mb-1 text-xs font-medium text-muted">Bộ phận / Công đoạn</p>
          {boPhanList.length > 0 ? (
            <SearchableSelect
              value={maBoPhan}
              onChange={setMaBoPhan}
              options={boPhanList.map((bp) => ({ value: bp, label: bp }))}
              placeholder="Chọn bộ phận"
              searchPlaceholder="Tìm bộ phận…"
              className="w-44"
            />
          ) : (
            <div className="rounded border border-border bg-bg-soft px-2 py-1.5 text-sm text-muted">
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
          {isReadOnly ? "Xem" : "Tải"}
        </Button>
        {!isReadOnly && chitietRows.length > 0 && (
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
        {isReadOnly && (
          <span className="self-center rounded bg-sky-50 px-2 py-1 text-xs text-sky-700">
            Chế độ xem (read-only)
          </span>
        )}
      </div>

      {/* Grid header 4 mức thưởng */}
      {headerRows.length > 0 && (
        <section>
          <h2 className="mb-1.5 text-sm font-semibold text-text">
            Tổng hợp {loadedLabel}
            <span className="ml-2 rounded bg-panel-2 px-1.5 py-0.5 text-xs font-normal text-muted">
              Bộ phận: {maBoPhan}
            </span>
          </h2>
          <HeaderGrid rows={headerRows} showPeriod={isReadOnly} />
        </section>
      )}

      {/* Grid chi tiết hàng ngày */}
      {chitietRows.length > 0 && (
        <section>
          <h2 className="mb-1.5 text-sm font-semibold text-text">
            Chi tiết từng ngày
            <span className="ml-2 text-xs font-normal text-muted">({chitietRows.length} ngày)</span>
            {dirty.size > 0 && (
              <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700">
                {dirty.size} hàng chưa lưu
              </span>
            )}
          </h2>
          <ChitietGrid
            rows={mergedRows}
            dirty={dirty}
            onCellChange={handleCellChange}
            readOnly={isReadOnly}
          />
        </section>
      )}

      {chitietRows.length === 0 && headerRows.length === 0 && !loading && maBoPhan && (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 text-muted">
          <I.Table size={36} className="opacity-30" />
          <p className="text-sm">
            Chọn kỳ + bộ phận rồi nhấn <strong>{isReadOnly ? "Xem" : "Tải"}</strong> để bắt đầu.
          </p>
        </div>
      )}
    </div>
  );
}

export const Route = createFileRoute("/mes/muctieu-sanxuat")({
  component: MucTieuSanXuatPage,
});
