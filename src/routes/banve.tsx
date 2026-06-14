/* ==========================================================
   banve.tsx — Trang MOBILE xem bản vẽ cho sản xuất (xưởng).
   Port từ BanVe.Blazor.Server (DQHF252). Công nhân: chọn loại bản vẽ →
   nhập/quét mã sản phẩm → xem PDF. File do server tự serve qua
   /banve/file?id= (mount BANVE_FILES_DIR); tra qua /banve/lookup.

   Quét QR dùng BarcodeDetector API (Chrome Android) — thiếu thì ẩn nút,
   nhập tay. Mã QR DQHF có 2 dạng: "MaDonHang:MaSanPham:MaChiTiet" (lấy
   phần giữa làm masp) hoặc mã thẻ pallet (chưa resolve — follow-up).
   ========================================================== */

import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useState } from "react";
import { I } from "@/components/Icons";
import { canScanBarcode, QrScanner } from "@/components/QrScanner";
import { Button, Select } from "@/components/ui";

export const Route = createFileRoute("/banve")({
  component: BanVePage,
});

/** Loại bản vẽ — khớp giá trị cột tr_banve.phanloai (tên tiếng Việt). */
const BANVE_TYPES = [
  "Bản vẽ kỹ thuật",
  "Bản vẽ phát triển",
  "Bản vẽ mẫu",
  "Bản vẽ đóng gói",
  "Bản vẽ AI",
  "Bản vẽ dao",
] as const;

interface BanVeRow {
  id: string;
  tensp: string | null;
  hehang: string | null;
  phanloai: string | null;
}

/** Tách mã sản phẩm từ chuỗi quét. Dạng QR DQHF: "DonHang:MaSP:ChiTiet". */
function maspFromCode(code: string): string {
  const c = code.trim();
  if (c.includes(":")) {
    const parts = c.split(":");
    return (parts[1] ?? "").replace(/\+/g, "_").trim();
  }
  return c; // mã thẻ pallet — chưa resolve, dùng tạm nguyên văn
}

function BanVePage() {
  const [type, setType] = useState<string>(BANVE_TYPES[0]);
  const [masp, setMasp] = useState("");
  const [rows, setRows] = useState<BanVeRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [searched, setSearched] = useState(false);
  const [viewId, setViewId] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);

  const canScan = canScanBarcode();

  const search = useCallback(async (m: string, t: string) => {
    const q = m.trim();
    if (!q) return;
    setLoading(true);
    setErr("");
    setSearched(true);
    try {
      const res = await fetch(
        `/banve/lookup?masp=${encodeURIComponent(q)}&type=${encodeURIComponent(t)}`,
        { credentials: "include" },
      );
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `Lỗi ${res.status}`);
      }
      const data = (await res.json()) as { rows: BanVeRow[] };
      setRows(data.rows ?? []);
    } catch (e) {
      setErr((e as Error).message);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  return (
    <div className="min-h-screen bg-bg text-text flex flex-col">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-panel border-b border-border px-3 py-2.5 flex items-center gap-2">
        <I.FileText size={18} className="text-accent shrink-0" />
        <span className="font-semibold text-sm">Xem bản vẽ</span>
      </div>

      {/* Bộ tra cứu */}
      <div className="p-3 space-y-2.5 max-w-xl w-full mx-auto">
        <label className="block">
          <span className="text-xs text-muted">Loại bản vẽ</span>
          <Select
            value={type}
            onChange={(e) => {
              setType(e.target.value);
              if (masp.trim()) void search(masp, e.target.value);
            }}
            className="mt-1 w-full"
          >
            <option value="">Tất cả loại</option>
            {BANVE_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </Select>
        </label>

        <label className="block">
          <span className="text-xs text-muted">Mã sản phẩm</span>
          <div className="mt-1 flex gap-2">
            <input
              value={masp}
              onChange={(e) => setMasp(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void search(masp, type);
              }}
              placeholder="Nhập hoặc quét mã sản phẩm…"
              className="input flex-1 h-10 text-sm"
              autoCapitalize="characters"
            />
            <Button onClick={() => void search(masp, type)} disabled={loading || !masp.trim()}>
              <I.Search size={16} />
            </Button>
            {canScan && (
              <Button variant="ghost" onClick={() => setScanning(true)}>
                <I.QrCode size={16} />
              </Button>
            )}
          </div>
        </label>

        {/* Kết quả */}
        {err && (
          <div className="text-xs text-danger border border-danger/30 rounded p-2">{err}</div>
        )}
        {loading && <div className="text-xs text-muted py-3 text-center">Đang tra…</div>}
        {!loading && searched && rows.length === 0 && !err && (
          <div className="text-xs text-muted py-6 text-center">
            Không tìm thấy bản vẽ cho mã <b>{masp}</b>
            {type ? (
              <>
                {" "}
                loại <b>{type}</b>
              </>
            ) : null}
            .
          </div>
        )}
        <div className="space-y-2">
          {rows.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => setViewId(r.id)}
              className="w-full text-left card p-3 hover:border-accent/50 transition-colors flex items-center gap-3"
            >
              <span className="w-9 h-9 rounded bg-accent/15 text-accent flex items-center justify-center shrink-0">
                <I.FileText size={18} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium truncate">{r.tensp || masp}</span>
                <span className="block text-xs text-muted truncate">
                  {[r.phanloai, r.hehang].filter(Boolean).join(" · ")}
                </span>
              </span>
              <I.ChevronRight size={16} className="text-muted shrink-0" />
            </button>
          ))}
        </div>
      </div>

      {viewId && <PdfViewer id={viewId} onClose={() => setViewId(null)} />}
      {scanning && (
        <QrScanner
          title="Quét mã sản phẩm"
          onClose={() => setScanning(false)}
          onResult={(code) => {
            setScanning(false);
            const m = maspFromCode(code);
            setMasp(m);
            void search(m, type);
          }}
        />
      )}
    </div>
  );
}

/* ── PDF viewer toàn màn hình (iframe; nút mở tab mới cho iOS Safari) ── */
function PdfViewer({ id, onClose }: { id: string; onClose: () => void }) {
  const src = `/banve/file?id=${encodeURIComponent(id)}`;
  return (
    <div className="fixed inset-0 z-50 bg-black/90 flex flex-col">
      <div className="flex items-center gap-2 px-3 py-2 bg-panel border-b border-border">
        <span className="text-sm font-medium flex-1">Bản vẽ</span>
        <a
          href={src}
          target="_blank"
          rel="noreferrer"
          className="btn-default text-xs px-2 py-1 inline-flex items-center gap-1"
        >
          <I.ExternalLink size={14} /> Mở tab mới
        </a>
        <button
          type="button"
          onClick={onClose}
          className="p-1.5 rounded hover:bg-hover text-muted"
          aria-label="Đóng"
        >
          <I.X size={18} />
        </button>
      </div>
      <iframe src={src} title="Bản vẽ PDF" className="flex-1 w-full bg-white" />
    </div>
  );
}
