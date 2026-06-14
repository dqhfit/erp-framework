/* ==========================================================
   banve.tsx — Trang MOBILE xem bản vẽ cho sản xuất (xưởng). Port màn XAF
   SanPham_DetailView_XemBanVe (DQHF252). Master = sản phẩm (masp); chọn loại
   bản vẽ + nhập/quét mã → xem 4 tab:
     Bản vẽ | Bản vẽ dao | Định mức gỗ ván | Định mức ngũ kim.
   Data qua /banve/product; PDF qua /banve/file; quét QR → /banve/resolve.
   ========================================================== */

import { createFileRoute } from "@tanstack/react-router";
import { type ReactNode, useCallback, useState } from "react";
import { I } from "@/components/Icons";
import { canScanBarcode, QrScanner } from "@/components/QrScanner";
import { Button, Select } from "@/components/ui";

export const Route = createFileRoute("/banve")({ component: BanVePage });

/** 6 loại bản vẽ (BanVeType). val = giá trị khớp tr_banve.phanloai (PPS strip
 *  " (PPS)"). Tab "Bản vẽ" lọc theo val; tab "Bản vẽ dao" độc lập. */
const BANVE_TYPES = [
  { label: "Bản vẽ kỹ thuật", val: "Bản vẽ kỹ thuật" },
  { label: "Bản vẽ phát triển", val: "Bản vẽ phát triển" },
  { label: "Bản vẽ mẫu (PPS)", val: "Bản vẽ mẫu" },
  { label: "Bản vẽ đóng gói", val: "Bản vẽ đóng gói" },
  { label: "Bản vẽ AI", val: "Bản vẽ AI" },
] as const;

interface BanVeItem {
  id: string;
  phanloai: string;
}
interface GoVanRow {
  stt: unknown;
  chitiet: unknown;
  nguyenlieu: unknown;
  dayy_tc: unknown;
  rong_tc: unknown;
  dai_tc: unknown;
  soluong: unknown;
}
interface NguKimRow {
  mavt: unknown;
  chitiet: unknown;
  quycach: unknown;
  soluong: unknown;
  dvt: unknown;
  hwforai: unknown;
  hwforww: unknown;
  hwforpacking: unknown;
}
interface Product {
  found: boolean;
  masp?: string;
  tensp?: string | null;
  banve?: BanVeItem[];
  govan?: GoVanRow[];
  ngukim?: NguKimRow[];
}

const LS_MASP = "banve:lastmasp";
type Tab = "banve" | "dao" | "govan" | "ngukim";

function BanVePage() {
  const [type, setType] = useState<string>(BANVE_TYPES[0].val);
  const [masp, setMasp] = useState("");
  const [product, setProduct] = useState<Product | null>(null);
  const [tab, setTab] = useState<Tab>("banve");
  const [viewId, setViewId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [scanning, setScanning] = useState(false);

  const load = useCallback(async (m: string) => {
    const q = m.trim();
    if (!q) return;
    setLoading(true);
    setErr("");
    try {
      const res = await fetch(`/banve/product?masp=${encodeURIComponent(q)}`, {
        credentials: "include",
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `Lỗi ${res.status}`);
      }
      const p = (await res.json()) as Product;
      setProduct(p);
      if (p.found && typeof localStorage !== "undefined") localStorage.setItem(LS_MASP, q);
    } catch (e) {
      setErr((e as Error).message);
      setProduct(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const scanResult = useCallback(
    async (code: string) => {
      setScanning(false);
      try {
        const res = await fetch(`/banve/resolve?code=${encodeURIComponent(code)}`, {
          credentials: "include",
        });
        const j = (await res.json()) as { masp?: string };
        const m = (j.masp ?? "").trim() || code.trim();
        setMasp(m);
        await load(m);
      } catch {
        setMasp(code.trim());
        await load(code.trim());
      }
    },
    [load],
  );

  const banveList = (product?.banve ?? []).filter(
    (b) => b.phanloai === type && !b.phanloai.startsWith("Bản vẽ dao"),
  );
  const daoList = (product?.banve ?? []).filter((b) => b.phanloai.startsWith("Bản vẽ dao"));
  const govan = product?.govan ?? [];
  const ngukim = product?.ngukim ?? [];

  return (
    <div className="min-h-screen bg-bg text-text flex flex-col">
      <div className="sticky top-0 z-10 bg-panel border-b border-border px-3 py-2.5 flex items-center gap-2">
        <I.FileText size={18} className="text-accent shrink-0" />
        <span className="font-semibold text-sm flex-1">Xem bản vẽ</span>
        {typeof localStorage !== "undefined" && localStorage.getItem(LS_MASP) && (
          <button
            type="button"
            onClick={() => {
              const last = localStorage.getItem(LS_MASP) ?? "";
              setMasp(last);
              void load(last);
            }}
            className="text-xs text-accent"
          >
            SP đã xem
          </button>
        )}
      </div>

      <div className="p-3 space-y-2.5 max-w-2xl w-full mx-auto">
        {/* Loại bản vẽ + quét */}
        <div className="flex gap-2">
          <Select value={type} onChange={(e) => setType(e.target.value)} className="flex-1">
            {BANVE_TYPES.map((t) => (
              <option key={t.val} value={t.val}>
                {t.label}
              </option>
            ))}
          </Select>
          {canScanBarcode() && (
            <Button onClick={() => setScanning(true)}>
              <I.QrCode size={16} /> Quét phiếu
            </Button>
          )}
        </div>

        {/* Mã + tên sản phẩm */}
        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="text-xs text-muted">Mã sản phẩm</span>
            <input
              value={masp}
              onChange={(e) => setMasp(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void load(masp);
              }}
              placeholder="Nhập/quét mã…"
              className="input mt-1 w-full h-10 text-sm"
              autoCapitalize="characters"
            />
          </label>
          <label className="block">
            <span className="text-xs text-muted">Tên sản phẩm</span>
            <div className="input mt-1 w-full h-10 flex items-center text-sm bg-bg-soft truncate">
              {product?.tensp || "—"}
            </div>
          </label>
        </div>

        {err && (
          <div className="text-xs text-danger border border-danger/30 rounded p-2">{err}</div>
        )}
        {loading && <div className="text-xs text-muted py-2 text-center">Đang tra…</div>}
        {product && !product.found && !loading && (
          <div className="text-xs text-muted py-4 text-center">
            Không tìm thấy sản phẩm <b>{masp}</b>.
          </div>
        )}

        {/* Tabs */}
        {product?.found && (
          <>
            <div className="flex border-b border-border overflow-x-auto -mx-1 px-1">
              <TabBtn active={tab === "banve"} onClick={() => setTab("banve")}>
                Bản vẽ {banveList.length > 0 && `(${banveList.length})`}
              </TabBtn>
              <TabBtn active={tab === "dao"} onClick={() => setTab("dao")}>
                Bản vẽ dao {daoList.length > 0 && `(${daoList.length})`}
              </TabBtn>
              <TabBtn active={tab === "govan"} onClick={() => setTab("govan")}>
                Định mức gỗ ván {govan.length > 0 && `(${govan.length})`}
              </TabBtn>
              <TabBtn active={tab === "ngukim"} onClick={() => setTab("ngukim")}>
                Định mức ngũ kim {ngukim.length > 0 && `(${ngukim.length})`}
              </TabBtn>
            </div>

            <div className="pt-1">
              {tab === "banve" && (
                <BanVeList items={banveList} onView={setViewId} empty="loại này" />
              )}
              {tab === "dao" && <BanVeList items={daoList} onView={setViewId} empty="dao" />}
              {tab === "govan" && <GoVanGrid rows={govan} />}
              {tab === "ngukim" && <NguKimGrid rows={ngukim} />}
            </div>
          </>
        )}
      </div>

      {viewId && <PdfViewer id={viewId} onClose={() => setViewId(null)} />}
      {scanning && (
        <QrScanner title="Quét phiếu" onClose={() => setScanning(false)} onResult={scanResult} />
      )}
    </div>
  );
}

function TabBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-2 text-xs whitespace-nowrap border-b-2 -mb-px ${
        active ? "border-accent text-accent font-semibold" : "border-transparent text-muted"
      }`}
    >
      {children}
    </button>
  );
}

function BanVeList({
  items,
  onView,
  empty,
}: {
  items: BanVeItem[];
  onView: (id: string) => void;
  empty: string;
}) {
  if (items.length === 0)
    return <div className="text-xs text-muted py-6 text-center">Không có bản vẽ {empty}.</div>;
  return (
    <div className="space-y-2">
      {items.map((b) => (
        <button
          key={b.id}
          type="button"
          onClick={() => onView(b.id)}
          className="w-full text-left card p-3 hover:border-accent/50 transition-colors flex items-center gap-3"
        >
          <span className="w-9 h-9 rounded bg-accent/15 text-accent flex items-center justify-center shrink-0">
            <I.FileText size={18} />
          </span>
          <span className="flex-1 text-sm font-medium truncate">{b.phanloai || "Bản vẽ"}</span>
          <I.ChevronRight size={16} className="text-muted shrink-0" />
        </button>
      ))}
    </div>
  );
}

const fmtNum = (v: unknown): string => {
  const n = typeof v === "number" ? v : Number(String(v ?? "").replace(/[,\s]/g, ""));
  return Number.isNaN(n)
    ? String(v ?? "")
    : n.toLocaleString("vi-VN", { maximumFractionDigits: 2 });
};
const quyCach = (r: GoVanRow): string => {
  const d = Number(r.dayy_tc) || 0;
  const w = Number(r.rong_tc) || 0;
  const l = Number(r.dai_tc) || 0;
  return d || w || l ? `${fmtNum(d)}×${fmtNum(w)}×${fmtNum(l)}` : "";
};

function GoVanGrid({ rows }: { rows: GoVanRow[] }) {
  if (rows.length === 0)
    return <div className="text-xs text-muted py-6 text-center">Không có định mức gỗ ván.</div>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs border-collapse">
        <thead className="text-muted">
          <tr className="border-b border-border text-left">
            <th className="py-1.5 pr-2">STT</th>
            <th className="py-1.5 pr-2">Tên chi tiết</th>
            <th className="py-1.5 pr-2">Nguyên liệu</th>
            <th className="py-1.5 pr-2">Quy cách</th>
            <th className="py-1.5 pr-2 text-right">SL</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: grid read-only, không reorder
            <tr key={i} className="border-b border-border/50">
              <td className="py-1.5 pr-2 whitespace-nowrap">{String(r.stt ?? "")}</td>
              <td className="py-1.5 pr-2">{String(r.chitiet ?? "")}</td>
              <td className="py-1.5 pr-2 whitespace-nowrap">{String(r.nguyenlieu ?? "")}</td>
              <td className="py-1.5 pr-2 whitespace-nowrap">{quyCach(r)}</td>
              <td className="py-1.5 pr-2 text-right whitespace-nowrap">{fmtNum(r.soluong)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function NguKimGrid({ rows }: { rows: NguKimRow[] }) {
  if (rows.length === 0)
    return <div className="text-xs text-muted py-6 text-center">Không có định mức ngũ kim.</div>;
  const flag = (v: unknown) => (v == null || ["0", "false"].includes(String(v)) ? "" : "✓");
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs border-collapse">
        <thead className="text-muted">
          <tr className="border-b border-border text-left">
            <th className="py-1.5 pr-2">Mã VT</th>
            <th className="py-1.5 pr-2">Tên vật tư</th>
            <th className="py-1.5 pr-2">Quy cách</th>
            <th className="py-1.5 pr-2 text-right">SL</th>
            <th className="py-1.5 pr-2">ĐV</th>
            <th className="py-1.5 pr-2 text-center">AI</th>
            <th className="py-1.5 pr-2 text-center">WW</th>
            <th className="py-1.5 pr-2 text-center">ĐG</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: grid read-only, không reorder
            <tr key={i} className="border-b border-border/50">
              <td className="py-1.5 pr-2 whitespace-nowrap">{String(r.mavt ?? "")}</td>
              <td className="py-1.5 pr-2">{String(r.chitiet ?? "")}</td>
              <td className="py-1.5 pr-2 whitespace-nowrap">{String(r.quycach ?? "")}</td>
              <td className="py-1.5 pr-2 text-right whitespace-nowrap">{fmtNum(r.soluong)}</td>
              <td className="py-1.5 pr-2 whitespace-nowrap">{String(r.dvt ?? "")}</td>
              <td className="py-1.5 pr-2 text-center text-success">{flag(r.hwforai)}</td>
              <td className="py-1.5 pr-2 text-center text-success">{flag(r.hwforww)}</td>
              <td className="py-1.5 pr-2 text-center text-success">{flag(r.hwforpacking)}</td>
            </tr>
          ))}
        </tbody>
      </table>
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
