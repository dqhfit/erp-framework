/* ==========================================================
   ban-ve.tsx — Layout route /ban-ve (standalone, không có AppShell).
   - Khi ở đúng /ban-ve: render trang mobile xem bản vẽ (BanVePage).
   - Khi ở /ban-ve/*:   render <Outlet /> → child routes hiển thị standalone.
   ========================================================== */

import {
  createFileRoute,
  Outlet,
  useNavigate,
  useRouter,
  useRouterState,
} from "@tanstack/react-router";
import { lazy, type ReactNode, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { I } from "@/components/Icons";
import { canScanBarcode, QrScanner } from "@/components/QrScanner";
import { Button, SearchableSelect, Select } from "@/components/ui";
import { useAuth } from "@/stores/auth";

export const Route = createFileRoute("/ban-ve")({ component: BanVeLayout });

// Viewer 3D tách chunk riêng (three.js) — chỉ tải khi mở mô hình 3D.
const Model3dViewer = lazy(() => import("@/components/Model3dViewer"));

function BanVeLayout() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  if (pathname === "/ban-ve") return <BanVePage />;
  return <Outlet />;
}

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
export interface GoVanRow {
  stt: unknown;
  mact: unknown;
  chitiet: unknown;
  nguyenlieu: unknown;
  dayy_tc: unknown;
  rong_tc: unknown;
  dai_tc: unknown;
  soluong_tc: unknown;
  m3_tc: unknown;
  phoi_tructiep: unknown;
  phoi_ghep: unknown;
  dayy_sc: unknown;
  rong_sc: unknown;
  dai_sc: unknown;
  mong1: unknown;
  mong2: unknown;
  veneer_matchinh: unknown;
  veneer_matphu: unknown;
  veneer_canhngan: unknown;
  veneer_canhdai: unknown;
  veneer_dan_canh: unknown;
  uv_matchinh: unknown;
  uv_matphu: unknown;
  uv_canhdai: unknown;
  uv_canhngan: unknown;
  fsc_100: unknown;
  fsc_mix: unknown;
  fsc_cw: unknown;
  ghichu: unknown;
}
export interface NguKimRow {
  mavt: unknown;
  chitiet: unknown;
  quycach: unknown;
  mausac: unknown;
  soluong: unknown;
  dvt: unknown;
  hwforai: unknown;
  hwforww: unknown;
  hwforpacking: unknown;
  ghichu: unknown;
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
  const navigate = useNavigate();
  const router = useRouter();
  const role = useAuth((s) => s.user?.role);
  // Về ĐÚNG trang trước nếu có lịch sử; vào thẳng (QR/refresh) → cổng/trang chủ.
  const goBack = () => {
    if (router.history.canGoBack()) router.history.back();
    else void navigate({ to: role === "viewer" ? "/portal" : "/" });
  };
  const [type, setType] = useState<string>(BANVE_TYPES[0].val);
  const [masp, setMasp] = useState("");
  const [product, setProduct] = useState<Product | null>(null);
  const [tab, setTab] = useState<Tab>("banve");
  const [viewId, setViewId] = useState<string | null>(null);
  const [view3dId, setView3dId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [scanning, setScanning] = useState(false);
  const [searching, setSearching] = useState(false);

  const load = useCallback(async (m: string) => {
    const q = m.trim();
    if (!q) return;
    setLoading(true);
    setErr("");
    try {
      const res = await fetch(`/banvesvc/product?masp=${encodeURIComponent(q)}`, {
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
        const res = await fetch(`/banvesvc/resolve?code=${encodeURIComponent(code)}`, {
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
        <button
          type="button"
          onClick={goBack}
          className="-ml-1 p-1 rounded hover:bg-hover text-muted shrink-0"
          aria-label="Quay lại"
        >
          <I.ChevronLeft size={20} />
        </button>
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

      {/* Quick links quản lý — chỉ hiện với non-viewer */}
      {role !== "viewer" && (
        <div className="shrink-0 border-b border-border bg-panel/60 px-3 py-1.5 flex flex-wrap gap-1.5 items-center">
          <span className="text-xs text-muted">Quản lý:</span>
          {(
            [
              { label: "Kỹ thuật", to: "/ban-ve/ky-thuat" },
              { label: "Đóng gói", to: "/ban-ve/dong-goi" },
              { label: "Phát triển", to: "/ban-ve/phat-trien" },
              { label: "AI", to: "/ban-ve/ai" },
              { label: "Mẫu", to: "/ban-ve/mau" },
              { label: "Dao", to: "/ban-ve/dao" },
            ] as const
          ).map(({ label, to }) => (
            <button
              key={to}
              type="button"
              onClick={() => void navigate({ to })}
              className="chip chip-default text-xs"
            >
              {label}
            </button>
          ))}
        </div>
      )}

      <div className="p-3 space-y-2.5 max-w-2xl w-full mx-auto">
        {/* Tìm sản phẩm */}
        <Button variant="ghost" onClick={() => setSearching(true)} className="w-full justify-start">
          <I.Search size={15} /> Tìm sản phẩm (hệ hàng / đơn đặt hàng / PO#)
        </Button>

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
                <BanVeList
                  items={banveList}
                  onView={setViewId}
                  onView3d={setView3dId}
                  empty="loại này"
                />
              )}
              {tab === "dao" && <BanVeList items={daoList} onView={setViewId} empty="dao" />}
              {tab === "govan" && <GoVanGrid rows={govan} />}
              {tab === "ngukim" && <NguKimGrid rows={ngukim} />}
            </div>
          </>
        )}
      </div>

      {viewId && <PdfViewer id={viewId} onClose={() => setViewId(null)} />}
      {view3dId && (
        <Suspense
          fallback={
            <div className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center text-muted text-sm gap-2">
              <I.Loader size={16} className="animate-spin" /> Đang mở trình xem 3D…
            </div>
          }
        >
          <Model3dViewer id={view3dId} onClose={() => setView3dId(null)} />
        </Suspense>
      )}
      {scanning && (
        <QrScanner title="Quét phiếu" onClose={() => setScanning(false)} onResult={scanResult} />
      )}
      {searching && (
        <TimSanPham
          onClose={() => setSearching(false)}
          onScan={() => {
            setSearching(false);
            setScanning(true);
          }}
          onPick={(m) => {
            setSearching(false);
            setMasp(m);
            void load(m);
          }}
        />
      )}
    </div>
  );
}

/* ── "Tìm sản phẩm" — COMBOBOX chọn (không gõ tay): 3 chế độ Hệ hàng / Đơn đặt
   hàng / Đơn hàng PO#. Mỗi chế độ 2 combobox xâu chuỗi: chọn cấp 1 → load sản
   phẩm → chọn sản phẩm → xong. Combobox có ô lọc sẵn (gõ để thu hẹp). ── */
type FindMode = "hehang" | "donhang" | "order";
const FIND_MODES: [FindMode, string][] = [
  ["hehang", "Hệ hàng"],
  ["donhang", "Đơn đặt hàng"],
  ["order", "Đơn hàng PO#"],
];
type Opt = { value: string; label: string };

async function jget(url: string): Promise<{ rows?: unknown[] }> {
  const res = await fetch(url, { credentials: "include" });
  return (await res.json().catch(() => ({}))) as { rows?: unknown[] };
}

function TimSanPham({
  onClose,
  onPick,
  onScan,
}: {
  onClose: () => void;
  onPick: (masp: string) => void;
  onScan: () => void;
}) {
  const initMode = (): FindMode => {
    if (typeof localStorage === "undefined") return "hehang";
    const m = localStorage.getItem("banve:find:mode");
    return m === "donhang" || m === "order" ? m : "hehang";
  };
  const [mode, setModeRaw] = useState<FindMode>(initMode);
  const [l1, setL1] = useState<Opt[]>([]);
  const [l1v, setL1vRaw] = useState("");
  const [products, setProducts] = useState<Opt[]>([]);
  const [busy, setBusy] = useState(false);
  // Nhớ chế độ + giá trị cấp 1 đã chọn → khôi phục khi mở lại popup.
  const savedL1v = useRef(
    typeof localStorage !== "undefined" ? localStorage.getItem("banve:find:l1v") || "" : "",
  );
  const restored = useRef(false);

  const setMode = (m: FindMode) => {
    setModeRaw(m);
    restored.current = true; // user đổi chế độ → không khôi phục l1v cũ
    savedL1v.current = "";
    if (typeof localStorage !== "undefined") localStorage.setItem("banve:find:mode", m);
  };
  const setL1v = (v: string) => {
    setL1vRaw(v);
    if (typeof localStorage !== "undefined" && v) localStorage.setItem("banve:find:l1v", v);
  };

  const loadL1 = useCallback(async (m: FindMode) => {
    setBusy(true);
    setL1([]);
    setL1vRaw("");
    setProducts([]);
    try {
      if (m === "hehang") {
        const d = await jget("/banvesvc/hehang");
        setL1(((d.rows as string[]) ?? []).map((h) => ({ value: h, label: h })));
      } else if (m === "donhang") {
        const d = await jget("/banvesvc/donhang");
        setL1(
          ((d.rows as Array<{ maddh?: string; tenddh?: string }>) ?? []).map((r) => ({
            value: String(r.maddh ?? ""),
            label: r.tenddh ? `${r.maddh} — ${r.tenddh}` : String(r.maddh ?? ""),
          })),
        );
      } else {
        const d = await jget("/banvesvc/order");
        setL1(
          ((d.rows as Array<{ order_number?: string; customer?: string }>) ?? []).map((r) => ({
            value: String(r.order_number ?? ""),
            label: r.customer ? `${r.order_number} — ${r.customer}` : String(r.order_number ?? ""),
          })),
        );
      }
    } finally {
      setBusy(false);
    }
  }, []);

  const loadProducts = useCallback(async (m: FindMode, key: string) => {
    if (!key) {
      setProducts([]);
      return;
    }
    setBusy(true);
    try {
      const url =
        m === "hehang"
          ? `/banvesvc/search?hehang=${encodeURIComponent(key)}`
          : m === "donhang"
            ? `/banvesvc/donhang-items?maddh=${encodeURIComponent(key)}`
            : `/banvesvc/order-items?order=${encodeURIComponent(key)}`;
      const d = await jget(url);
      setProducts(
        ((d.rows as Array<Record<string, unknown>>) ?? []).map((r) => {
          const masp = String(r.masp ?? "");
          const name = String(r.tensp ?? r.tenchitiet ?? r.description ?? r.hehang ?? "");
          return { value: masp, label: name ? `${masp} — ${name}` : masp };
        }),
      );
    } finally {
      setBusy(false);
    }
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: loadL1 ổn định (useCallback []); chạy lại khi đổi chế độ
  useEffect(() => {
    void loadL1(mode);
  }, [mode]);

  // Khôi phục giá trị cấp 1 đã lưu sau khi danh sách cấp 1 tải xong (1 lần).
  useEffect(() => {
    if (restored.current || l1.length === 0) return;
    restored.current = true;
    const v = savedL1v.current;
    if (v && l1.some((o) => o.value === v)) {
      setL1vRaw(v);
      void loadProducts(mode, v);
    }
  }, [l1, mode, loadProducts]);

  const l1Label =
    mode === "hehang" ? "Hệ hàng" : mode === "donhang" ? "Mã đơn đặt hàng" : "Đơn hàng PO#";

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-panel w-full max-w-md rounded-lg flex flex-col max-h-[85vh] overflow-visible">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
          <span className="text-sm font-medium flex-1">Tìm sản phẩm</span>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded hover:bg-hover text-muted"
            aria-label="Đóng"
          >
            <I.X size={18} />
          </button>
        </div>
        {/* Chế độ */}
        <div className="flex border-b border-border">
          {FIND_MODES.map(([m, label]) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={`flex-1 px-2 py-2 text-xs border-b-2 -mb-px ${
                mode === m
                  ? "border-accent text-accent font-semibold"
                  : "border-transparent text-muted"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        {/* 2 combobox xâu chuỗi */}
        <div className="p-3 space-y-3">
          <label className="block">
            <span className="text-xs text-muted">{l1Label}</span>
            <div className="mt-1">
              <SearchableSelect
                className="w-full"
                value={l1v}
                onChange={(v) => {
                  setL1v(v);
                  void loadProducts(mode, v);
                }}
                options={l1}
                placeholder={
                  busy && l1.length === 0 ? "Đang tải…" : `Chọn ${l1Label.toLowerCase()}…`
                }
              />
            </div>
          </label>
          <label className="block">
            <span className="text-xs text-muted">Sản phẩm</span>
            <div className="mt-1">
              <SearchableSelect
                className="w-full"
                value=""
                onChange={(v) => v && onPick(v)}
                options={products}
                placeholder={
                  !l1v
                    ? "Chọn ở trên trước"
                    : busy
                      ? "Đang tải…"
                      : products.length === 0
                        ? "Không có sản phẩm"
                        : "Chọn sản phẩm…"
                }
              />
            </div>
          </label>
        </div>
        {/* Quét mã QR thẻ pallet → sản phẩm (cách thứ 4) */}
        {canScanBarcode() && (
          <div className="px-3 pb-3 pt-1 border-t border-border">
            <Button variant="ghost" onClick={onScan} className="w-full justify-center">
              <I.QrCode size={16} /> Quét mã QR thẻ pallet
            </Button>
          </div>
        )}
      </div>
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
  onView3d,
  empty,
}: {
  items: BanVeItem[];
  onView: (id: string) => void;
  onView3d?: (id: string) => void;
  empty: string;
}) {
  if (items.length === 0)
    return <div className="text-xs text-muted py-6 text-center">Không có bản vẽ {empty}.</div>;
  return (
    <div className="space-y-2">
      {items.map((b) => (
        <div
          key={b.id}
          className="card p-3 hover:border-accent/50 transition-colors flex items-center gap-3"
        >
          <button
            type="button"
            onClick={() => onView(b.id)}
            className="flex items-center gap-3 flex-1 min-w-0 text-left"
          >
            <span className="w-9 h-9 rounded bg-accent/15 text-accent flex items-center justify-center shrink-0">
              <I.FileText size={18} />
            </span>
            <span className="flex-1 text-sm font-medium truncate">{b.phanloai || "Bản vẽ"}</span>
          </button>
          {onView3d && b.phanloai === "Bản vẽ AI" && (
            <button
              type="button"
              onClick={() => onView3d(b.id)}
              className="shrink-0 inline-flex items-center gap-1 text-xs text-accent border border-accent/40 rounded px-2 py-1 hover:bg-accent/10"
            >
              <I.Box size={14} /> 3D
            </button>
          )}
          <I.ChevronRight size={16} className="text-muted shrink-0" />
        </div>
      ))}
    </div>
  );
}

export const fmtNum = (v: unknown): string => {
  const n = typeof v === "number" ? v : Number(String(v ?? "").replace(/[,\s]/g, ""));
  return Number.isNaN(n)
    ? String(v ?? "")
    : n.toLocaleString("vi-VN", { maximumFractionDigits: 2 });
};

export function GoVanGrid({ rows }: { rows: GoVanRow[] }) {
  if (rows.length === 0)
    return <div className="text-xs text-muted py-6 text-center">Không có định mức gỗ ván.</div>;

  const flag = (v: unknown) => (v == null || ["0", "false", "0.0"].includes(String(v)) ? "" : "✓");
  const textVal = (v: unknown) =>
    v == null || ["0", "false", "0.0"].includes(String(v)) ? "" : String(v);

  const fmtCellNum = (v: unknown, maxDigits = 2) => {
    if (v == null || v === "") return "";
    const n = typeof v === "number" ? v : Number(String(v).replace(/[,\s]/g, ""));
    if (Number.isNaN(n) || n === 0) return "";
    return n.toLocaleString("vi-VN", { maximumFractionDigits: maxDigits });
  };

  const getFscText = (r: GoVanRow) => {
    const parts: string[] = [];
    if (r.fsc_100 && !["0", "false"].includes(String(r.fsc_100))) parts.push("100%");
    if (r.fsc_mix && !["0", "false"].includes(String(r.fsc_mix))) parts.push("Mix");
    if (r.fsc_cw && !["0", "false"].includes(String(r.fsc_cw))) parts.push("CW");
    return parts.length > 0 ? parts.join("/") : "";
  };

  return (
    <div className="overflow-x-auto pt-1">
      <table className="w-full text-xs border-collapse border border-border">
        <thead className="text-muted bg-panel-2">
          <tr>
            <th
              colSpan={4}
              className="p-2 border border-border text-center font-semibold text-text"
            >
              Thông tin
            </th>
            <th
              colSpan={5}
              className="p-2 border border-border text-center font-semibold text-text"
            >
              Tinh chế (mm)
            </th>
            <th
              rowSpan={2}
              className="p-2 border border-border text-center font-semibold text-text align-middle"
            >
              Phôi liền
            </th>
            <th
              rowSpan={2}
              className="p-2 border border-border text-center font-semibold text-text align-middle"
            >
              Phôi ghép
            </th>
            <th
              colSpan={3}
              className="p-2 border border-border text-center font-semibold text-text"
            >
              Sơ chế
            </th>
            <th
              colSpan={2}
              className="p-2 border border-border text-center font-semibold text-text"
            >
              Mộng
            </th>
            <th
              colSpan={5}
              className="p-2 border border-border text-center font-semibold text-text"
            >
              Dán veneer
            </th>
            <th
              colSpan={4}
              className="p-2 border border-border text-center font-semibold text-text"
            >
              UV
            </th>
            <th
              rowSpan={2}
              className="p-2 border border-border text-center font-semibold text-text align-middle"
            >
              Tình trạng FSC
            </th>
            <th
              rowSpan={2}
              className="p-2 border border-border text-left font-semibold text-text align-middle"
            >
              Ghi chú
            </th>
          </tr>
          <tr>
            {/* Thông tin */}
            <th className="p-2 border border-border text-left font-medium">STT</th>
            <th className="p-2 border border-border text-left font-medium">Mã chi tiết</th>
            <th className="p-2 border border-border text-left font-medium">Tên chi tiết</th>
            <th className="p-2 border border-border text-left font-medium">NL</th>
            {/* Tinh chế */}
            <th className="p-2 border border-border text-right font-medium">Dày</th>
            <th className="p-2 border border-border text-right font-medium">Rộng</th>
            <th className="p-2 border border-border text-right font-medium">Dài</th>
            <th className="p-2 border border-border text-right font-medium">SL</th>
            <th className="p-2 border border-border text-right font-medium">M3</th>
            {/* Sơ chế */}
            <th className="p-2 border border-border text-right font-medium">Dày</th>
            <th className="p-2 border border-border text-right font-medium">Rộng</th>
            <th className="p-2 border border-border text-right font-medium">Dài</th>
            {/* Mộng */}
            <th className="p-2 border border-border text-center font-medium">Mộng 1</th>
            <th className="p-2 border border-border text-center font-medium">Mộng 2</th>
            {/* Dán veneer */}
            <th className="p-2 border border-border text-center font-medium">Mặt chính</th>
            <th className="p-2 border border-border text-center font-medium">Mặt phụ</th>
            <th className="p-2 border border-border text-center font-medium">Cạnh ngắn</th>
            <th className="p-2 border border-border text-center font-medium">Cạnh dài</th>
            <th className="p-2 border border-border text-center font-medium">Dán cạnh</th>
            {/* UV */}
            <th className="p-2 border border-border text-center font-medium">Mặt chính</th>
            <th className="p-2 border border-border text-center font-medium">Mặt phụ</th>
            <th className="p-2 border border-border text-center font-medium">Cạnh dài</th>
            <th className="p-2 border border-border text-center font-medium">Cạnh ngắn</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: grid read-only, không reorder
            <tr key={i} className="hover:bg-hover/20">
              <td className="p-2 border border-border/60 text-left whitespace-nowrap">
                {String(r.stt ?? "")}
              </td>
              <td className="p-2 border border-border/60 text-left whitespace-nowrap">
                {String(r.mact ?? "")}
              </td>
              <td className="p-2 border border-border/60 text-left">{String(r.chitiet ?? "")}</td>
              <td className="p-2 border border-border/60 text-left">
                {String(r.nguyenlieu ?? "")}
              </td>
              {/* Tinh chế */}
              <td className="p-2 border border-border/60 text-right whitespace-nowrap">
                {fmtCellNum(r.dayy_tc, 2)}
              </td>
              <td className="p-2 border border-border/60 text-right whitespace-nowrap">
                {fmtCellNum(r.rong_tc, 2)}
              </td>
              <td className="p-2 border border-border/60 text-right whitespace-nowrap">
                {fmtCellNum(r.dai_tc, 2)}
              </td>
              <td className="p-2 border border-border/60 text-right whitespace-nowrap">
                {fmtCellNum(r.soluong_tc, 2)}
              </td>
              <td className="p-2 border border-border/60 text-right whitespace-nowrap">
                {fmtCellNum(r.m3_tc, 6)}
              </td>
              {/* Phôi */}
              <td className="p-2 border border-border/60 text-center text-success font-bold">
                {flag(r.phoi_tructiep)}
              </td>
              <td className="p-2 border border-border/60 text-center text-success font-bold">
                {flag(r.phoi_ghep)}
              </td>
              {/* Sơ chế */}
              <td className="p-2 border border-border/60 text-right whitespace-nowrap">
                {fmtCellNum(r.dayy_sc, 2)}
              </td>
              <td className="p-2 border border-border/60 text-right whitespace-nowrap">
                {fmtCellNum(r.rong_sc, 2)}
              </td>
              <td className="p-2 border border-border/60 text-right whitespace-nowrap">
                {fmtCellNum(r.dai_sc, 2)}
              </td>
              {/* Mộng */}
              <td className="p-2 border border-border/60 text-center">{textVal(r.mong1)}</td>
              <td className="p-2 border border-border/60 text-center">{textVal(r.mong2)}</td>
              {/* Dán veneer */}
              <td className="p-2 border border-border/60 text-center">
                {textVal(r.veneer_matchinh)}
              </td>
              <td className="p-2 border border-border/60 text-center">
                {textVal(r.veneer_matphu)}
              </td>
              <td className="p-2 border border-border/60 text-center">
                {textVal(r.veneer_canhngan)}
              </td>
              <td className="p-2 border border-border/60 text-center">
                {textVal(r.veneer_canhdai)}
              </td>
              <td className="p-2 border border-border/60 text-center">
                {textVal(r.veneer_dan_canh)}
              </td>
              {/* UV */}
              <td className="p-2 border border-border/60 text-center text-success font-bold">
                {flag(r.uv_matchinh)}
              </td>
              <td className="p-2 border border-border/60 text-center text-success font-bold">
                {flag(r.uv_matphu)}
              </td>
              <td className="p-2 border border-border/60 text-center text-success font-bold">
                {flag(r.uv_canhdai)}
              </td>
              <td className="p-2 border border-border/60 text-center text-success font-bold">
                {flag(r.uv_canhngan)}
              </td>
              {/* FSC */}
              <td className="p-2 border border-border/60 text-center font-medium text-accent whitespace-nowrap">
                {getFscText(r)}
              </td>
              {/* Ghi chú */}
              <td className="p-2 border border-border/60 text-left">{String(r.ghichu ?? "")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function NguKimGrid({ rows }: { rows: NguKimRow[] }) {
  if (rows.length === 0)
    return <div className="text-xs text-muted py-6 text-center">Không có định mức ngũ kim.</div>;
  const flag = (v: unknown) => (v == null || ["0", "false"].includes(String(v)) ? "" : "✓");
  return (
    <div className="overflow-x-auto pt-1">
      <table className="w-full text-xs border-collapse border border-border">
        <thead className="text-muted bg-panel-2">
          <tr>
            <th
              colSpan={6}
              className="p-2 border border-border text-center font-semibold text-text"
            >
              Thông tin chi tiết
            </th>
            <th
              colSpan={3}
              className="p-2 border border-border text-center font-semibold text-text"
            >
              Cấp phát
            </th>
            <th
              rowSpan={2}
              className="p-2 border border-border text-left font-semibold text-text align-middle"
            >
              Ghi chú
            </th>
          </tr>
          <tr>
            <th className="p-2 border border-border text-left font-medium">Mã vật tư</th>
            <th className="p-2 border border-border text-left font-medium">Chi tiết</th>
            <th className="p-2 border border-border text-left font-medium">Quy cách</th>
            <th className="p-2 border border-border text-left font-medium">Màu sắc</th>
            <th className="p-2 border border-border text-center font-medium">Đơn vị tính</th>
            <th className="p-2 border border-border text-right font-medium">Số lượng</th>
            <th className="p-2 border border-border text-center font-medium">Trước sơn</th>
            <th className="p-2 border border-border text-center font-medium">Sau sơn</th>
            <th className="p-2 border border-border text-center font-medium">AI</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: grid read-only, không reorder
            <tr key={i} className="hover:bg-hover/20">
              <td className="p-2 border border-border/60 whitespace-nowrap text-left">
                {String(r.mavt ?? "")}
              </td>
              <td className="p-2 border border-border/60 text-left">{String(r.chitiet ?? "")}</td>
              <td className="p-2 border border-border/60 text-left">{String(r.quycach ?? "")}</td>
              <td className="p-2 border border-border/60 text-left">{String(r.mausac ?? "")}</td>
              <td className="p-2 border border-border/60 text-center whitespace-nowrap">
                {String(r.dvt ?? "")}
              </td>
              <td className="p-2 border border-border/60 text-right whitespace-nowrap">
                {fmtNum(r.soluong)}
              </td>
              <td className="p-2 border border-border/60 text-center text-success font-bold">
                {flag(r.hwforpacking)}
              </td>
              <td className="p-2 border border-border/60 text-center text-success font-bold">
                {flag(r.hwforww)}
              </td>
              <td className="p-2 border border-border/60 text-center text-success font-bold">
                {flag(r.hwforai)}
              </td>
              <td className="p-2 border border-border/60 text-left">{String(r.ghichu ?? "")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ── PDF viewer toàn màn hình (iframe; nút mở tab mới cho iOS Safari) ── */
function PdfViewer({ id, onClose }: { id: string; onClose: () => void }) {
  const src = `/banvesvc/file?id=${encodeURIComponent(id)}`;
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
