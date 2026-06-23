/* ==========================================================
   ban-ve-dong-goi.tsx — Trang DESKTOP "Bản vẽ đóng gói".
   Layout:
     1. Bộ lọc trên: Chọn Hệ hàng → Chọn Sản phẩm (có bản vẽ đóng gói).
     2. Phần dưới chia đôi 50/50:
        - Trái : Chi tiết sản phẩm (mã chi tiết, mô tả, quy cách, màu sắc, SL, DVT, ghi chú)
        - Phải : Trang 2 của file PDF bản vẽ đóng gói.
   Data: /banvesvc/hehang (hệ hàng), /banvesvc/donggoi-sanpham (SP theo hệ hàng),
         /banvesvc/donggoi-chitiet (chi tiết + mausac), /banvesvc/file?id=&raw=1 (PDF).
   PDF render: pdfjs-dist (loadPdf + renderPageToDataUrl), trang 2.
   ========================================================== */

import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { I } from "@/components/Icons";
import { SearchableSelect } from "@/components/ui";
import { useAuth } from "@/stores/auth";

export const Route = createFileRoute("/ban-ve-dong-goi")({ component: BanVeDongGoiPage });

/* ── Types ── */
interface SpRow {
  masp: string;
  tensp: string | null;
  hehang: string | null;
  banve_id: string | null;
  filepath: string | null;
}
interface ChitietRow {
  stt: unknown;
  ccode: unknown;
  chitiet: unknown;
  quycach: unknown;
  soluong: unknown;
  dvt: unknown;
  ghichu: unknown;
  nhom: unknown;
}
interface ChitietData {
  masp: string;
  mausac: string | null;
  tensp: string | null;
  rows: ChitietRow[];
}
type Opt = { value: string; label: string };

/* ── Helper fetch ── */
async function jget<T = unknown>(url: string): Promise<T> {
  const r = await fetch(url, { credentials: "include" });
  return (await r.json().catch(() => ({}))) as T;
}

/* ── Số format đẹp ── */
function fmtNum(v: unknown): string {
  const n = typeof v === "number" ? v : Number(String(v ?? "").replace(/[,\s]/g, ""));
  if (Number.isNaN(n) || v == null || v === "") return "";
  return n.toLocaleString("vi-VN", { maximumFractionDigits: 2 });
}

/* ── Main page ── */
function BanVeDongGoiPage() {
  const navigate = useNavigate();
  const role = useAuth((s) => s.user?.role);
  const goBack = () => void navigate({ to: role === "viewer" ? "/portal" : "/" });

  const [hehangs, setHehangs] = useState<Opt[]>([]);
  const [hehang, setHehang] = useState("");
  const [products, setProducts] = useState<SpRow[]>([]);
  const [selectedMasp, setSelectedMasp] = useState("");
  const [loading, setLoading] = useState(false);
  const [chitiet, setChitiet] = useState<ChitietData | null>(null);
  const [pdfSrc, setPdfSrc] = useState<string | null>(null); // data URL của trang 2 PDF
  const [pdfLoading, setPdfLoading] = useState(false);
  const [pdfErr, setPdfErr] = useState("");
  const banveId = useRef<string | null>(null);

  // Load danh sách hệ hàng khi mount
  useEffect(() => {
    jget<{ rows: string[] }>("/banvesvc/hehang").then((d) => {
      setHehangs((d.rows ?? []).map((h) => ({ value: h, label: h })));
    });
  }, []);

  // Load sản phẩm khi chọn hệ hàng
  const loadProducts = useCallback(async (hh: string) => {
    setLoading(true);
    setProducts([]);
    setSelectedMasp("");
    setChitiet(null);
    setPdfSrc(null);
    setPdfErr("");
    banveId.current = null;
    try {
      const d = await jget<{ rows: SpRow[] }>(
        `/banvesvc/donggoi-sanpham?hehang=${encodeURIComponent(hh)}`,
      );
      setProducts(d.rows ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  // Load chi tiết + PDF khi chọn sản phẩm
  const loadDetail = useCallback(
    async (masp: string) => {
      if (!masp) return;
      setChitiet(null);
      setPdfSrc(null);
      setPdfErr("");
      setPdfLoading(true);

      // Tìm banve_id từ danh sách products
      const sp = products.find((p) => p.masp === masp);
      banveId.current = sp?.banve_id ?? null;

      // Load chi tiết song song với PDF
      const chitietP = jget<ChitietData>(
        `/banvesvc/donggoi-chitiet?masp=${encodeURIComponent(masp)}`,
      ).then((d) => setChitiet(d));

      // Render trang 2 PDF nếu có banve_id
      const pdfP = (async () => {
        if (!banveId.current) {
          setPdfErr("Sản phẩm này chưa có file bản vẽ đóng gói.");
          return;
        }
        try {
          const pdfUrl = `/banvesvc/file?id=${encodeURIComponent(banveId.current)}&raw=1`;
          const { loadPdf, renderPageToDataUrl } = await import("@/lib/pdf");
          const pdf = await loadPdf(pdfUrl);
          if (pdf.numPages < 2) {
            setPdfErr(`File PDF chỉ có ${pdf.numPages} trang (cần ít nhất 2 trang).`);
            return;
          }
          const dataUrl = await renderPageToDataUrl(pdf, 2, 900);
          setPdfSrc(dataUrl);
        } catch (e) {
          setPdfErr(`Không tải được bản vẽ: ${(e as Error).message}`);
        }
      })();

      await Promise.all([chitietP, pdfP]);
      setPdfLoading(false);
    },
    [products],
  );

  const productOpts: Opt[] = products.map((p) => ({
    value: p.masp,
    label: p.tensp ? `${p.masp} — ${p.tensp}` : p.masp,
  }));

  return (
    <div className="min-h-screen bg-bg text-text flex flex-col">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-panel border-b border-border px-4 py-2.5 flex items-center gap-2">
        <button
          type="button"
          onClick={goBack}
          className="-ml-1 p-1 rounded hover:bg-hover text-muted shrink-0"
          aria-label="Quay lại"
        >
          <I.ChevronLeft size={20} />
        </button>
        <I.Package size={18} className="text-accent shrink-0" />
        <span className="font-semibold text-sm flex-1">Bản vẽ đóng gói</span>
      </div>

      {/* Body */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* ── Bộ lọc trên: Hệ hàng + Sản phẩm ── */}
        <div className="border-b border-border bg-panel px-4 py-3">
          <div className="flex flex-wrap gap-3 items-end max-w-5xl">
            {/* Hệ hàng */}
            <div className="flex-1 min-w-48">
              <label className="block text-xs text-muted mb-1">Hệ hàng</label>
              <SearchableSelect
                className="w-full"
                value={hehang}
                onChange={(v) => {
                  setHehang(v);
                  if (v) void loadProducts(v);
                  else {
                    setProducts([]);
                    setSelectedMasp("");
                    setChitiet(null);
                    setPdfSrc(null);
                  }
                }}
                options={hehangs}
                placeholder="Chọn hệ hàng…"
              />
            </div>

            {/* Sản phẩm */}
            <div className="flex-[2] min-w-64">
              <label className="block text-xs text-muted mb-1">
                Sản phẩm
                {products.length > 0 && (
                  <span className="ml-1 text-accent font-medium">({products.length})</span>
                )}
              </label>
              <SearchableSelect
                className="w-full"
                value={selectedMasp}
                onChange={(v) => {
                  setSelectedMasp(v);
                  if (v) void loadDetail(v);
                }}
                options={productOpts}
                placeholder={
                  !hehang
                    ? "Chọn hệ hàng trước"
                    : loading
                      ? "Đang tải…"
                      : products.length === 0
                        ? "Không có sản phẩm"
                        : "Chọn sản phẩm…"
                }
              />
            </div>

            {/* Info sản phẩm đã chọn */}
            {chitiet && (
              <div className="flex gap-4 text-sm text-muted py-1">
                {chitiet.tensp && (
                  <span>
                    <span className="text-muted">Tên: </span>
                    <span className="text-text font-medium">{chitiet.tensp}</span>
                  </span>
                )}
                {chitiet.mausac && (
                  <span>
                    <span className="text-muted">Màu: </span>
                    <span className="text-text font-medium">{chitiet.mausac}</span>
                  </span>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ── Nội dung dưới: chia đôi ── */}
        {!selectedMasp && (
          <div className="flex-1 flex items-center justify-center text-muted text-sm">
            <div className="text-center space-y-2">
              <I.Package size={40} className="mx-auto opacity-30" />
              <p>Chọn hệ hàng và sản phẩm để xem bản vẽ đóng gói</p>
            </div>
          </div>
        )}

        {selectedMasp && (
          <div className="flex-1 flex min-h-0 overflow-hidden">
            {/* ── Cột trái: Chi tiết sản phẩm ── */}
            <div className="w-1/2 border-r border-border flex flex-col min-h-0 overflow-hidden">
              <div className="px-4 py-2.5 border-b border-border bg-panel/50 flex items-center gap-2">
                <I.List size={14} className="text-accent" />
                <span className="text-xs font-semibold text-text uppercase tracking-wide">
                  Chi tiết sản phẩm
                </span>
                {chitiet && chitiet.rows.length > 0 && (
                  <span className="text-xs text-muted ml-auto">{chitiet.rows.length} dòng</span>
                )}
              </div>
              <div className="flex-1 overflow-auto">
                {!chitiet ? (
                  <div className="flex items-center justify-center h-full text-xs text-muted gap-2">
                    <I.Loader size={14} className="animate-spin" />
                    Đang tải chi tiết…
                  </div>
                ) : chitiet.rows.length === 0 ? (
                  <div className="flex items-center justify-center h-full text-xs text-muted flex-col gap-2">
                    <I.FileX size={32} className="opacity-30" />
                    <span>Chưa có dữ liệu chi tiết đóng gói</span>
                  </div>
                ) : (
                  <ChitietTable rows={chitiet.rows} />
                )}
              </div>
            </div>

            {/* ── Cột phải: Trang 2 PDF ── */}
            <div className="w-1/2 flex flex-col min-h-0 overflow-hidden">
              <div className="px-4 py-2.5 border-b border-border bg-panel/50 flex items-center gap-2">
                <I.FileText size={14} className="text-accent" />
                <span className="text-xs font-semibold text-text uppercase tracking-wide">
                  Bản vẽ đóng gói (trang 2)
                </span>
                {banveId.current && (
                  <a
                    href={`/banvesvc/file?id=${encodeURIComponent(banveId.current)}`}
                    target="_blank"
                    rel="noreferrer"
                    className="ml-auto inline-flex items-center gap-1 text-xs text-accent border border-accent/40 rounded px-2 py-0.5 hover:bg-accent/10"
                  >
                    <I.ExternalLink size={12} />
                    Mở file
                  </a>
                )}
              </div>
              <div className="flex-1 overflow-auto flex items-start justify-center p-2 bg-bg-soft">
                {pdfLoading ? (
                  <div className="flex items-center justify-center h-full text-xs text-muted gap-2">
                    <I.Loader size={14} className="animate-spin" />
                    Đang tải bản vẽ…
                  </div>
                ) : pdfErr ? (
                  <div className="flex items-center justify-center h-full text-xs text-muted flex-col gap-2 text-center px-4">
                    <I.AlertCircle size={32} className="opacity-30" />
                    <span>{pdfErr}</span>
                  </div>
                ) : pdfSrc ? (
                  <img
                    src={pdfSrc}
                    alt="Bản vẽ đóng gói trang 2"
                    className="max-w-full shadow-lg rounded"
                  />
                ) : null}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Bảng chi tiết ── */
function ChitietTable({ rows }: { rows: ChitietRow[] }) {
  return (
    <table className="w-full text-xs border-collapse">
      <thead className="sticky top-0 bg-panel z-10">
        <tr className="border-b border-border text-left">
          <th className="px-3 py-2 text-muted font-medium w-10">STT</th>
          <th className="px-3 py-2 text-muted font-medium">Mã chi tiết</th>
          <th className="px-3 py-2 text-muted font-medium">Mô tả / Chi tiết</th>
          <th className="px-3 py-2 text-muted font-medium">Quy cách</th>
          <th className="px-3 py-2 text-muted font-medium text-right">Số lượng</th>
          <th className="px-3 py-2 text-muted font-medium">ĐVT</th>
          <th className="px-3 py-2 text-muted font-medium">Ghi chú</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: read-only grid
          <tr key={i} className="border-b border-border/50 hover:bg-hover/40 transition-colors">
            <td className="px-3 py-2 text-muted whitespace-nowrap">{String(r.stt ?? "")}</td>
            <td className="px-3 py-2 font-mono whitespace-nowrap">{String(r.ccode ?? "")}</td>
            <td className="px-3 py-2">{String(r.chitiet ?? "")}</td>
            <td className="px-3 py-2 whitespace-nowrap">{String(r.quycach ?? "")}</td>
            <td className="px-3 py-2 text-right whitespace-nowrap">{fmtNum(r.soluong)}</td>
            <td className="px-3 py-2 whitespace-nowrap">{String(r.dvt ?? "")}</td>
            <td className="px-3 py-2 text-muted">{String(r.ghichu ?? "")}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
