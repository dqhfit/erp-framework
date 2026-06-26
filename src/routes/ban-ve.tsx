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
import { useNavTree } from "@/hooks/useNavTree";
import { normalizeVi } from "@/lib/text-utils";
import { useAuth } from "@/stores/auth";
import { useUserObjects } from "@/stores/userObjects";

function matchesPage(p: { name?: string; techName?: string }, type: string) {
  const tech = (p.techName || "").toLowerCase();
  const label = (p.name || "").toLowerCase();

  if (type === "ky-thuat" || type === "ky_thuat") {
    return (
      tech.includes("ban_ve_ky_thuat") ||
      tech.includes("ban_ve_kt") ||
      (label.includes("bản vẽ") && label.includes("kỹ thuật"))
    );
  }
  if (type === "dong-goi" || type === "dong_goi") {
    return (
      tech.includes("ban_ve_dong_goi") ||
      tech.includes("ban_ve_dgo") ||
      (label.includes("bản vẽ") && label.includes("đóng gói"))
    );
  }
  if (type === "ai") {
    return (
      tech.includes("ban_ve_ai") ||
      tech.includes("dinh_muc_ban_ve_ai") ||
      (label.includes("bản vẽ") && label.includes("ai")) ||
      label.includes("định mức - bản vẽ - ai")
    );
  }
  if (type === "dao") {
    return tech.includes("ban_ve_dao") || (label.includes("bản vẽ") && label.includes("dao"));
  }
  if (type === "mau") {
    return tech.includes("ban_ve_mau") || (label.includes("bản vẽ") && label.includes("mẫu"));
  }
  if (type === "phat-trien" || type === "phat_trien") {
    return (
      tech.includes("ban_ve_phat_trien") ||
      (label.includes("bản vẽ") && label.includes("phát triển"))
    );
  }
  return false;
}

export const Route = createFileRoute("/ban-ve")({ component: BanVeLayout });

// Viewer 3D tách chunk riêng (three.js) — chỉ tải khi mở mô hình 3D.
const Model3dViewer = lazy(() => import("@/components/Model3dViewer"));

function BanVeLayout() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  if (pathname === "/ban-ve") return <BanVePage />;
  return <Outlet />;
}

interface BanVeItem {
  id: string;
  phanloai: string;
  /** Nhãn phụ (vd dao toàn bộ: "mã SP — tên") — ưu tiên hiển thị nếu có. */
  label?: string;
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
export interface DongGoiRow {
  stt: unknown;
  ccode: unknown;
  chitiet: unknown;
  quycach: unknown;
  soluong: unknown;
  dvt: unknown;
  nhom: unknown;
  ghichu: unknown;
}
export interface SonRow {
  stt: unknown;
  buoc: unknown;
  mact: unknown;
  tenct: unknown;
  sl_m2: unknown;
  sl_sp: unknown;
  dvt: unknown;
  nhom: unknown;
  mamau: unknown;
  ghichu: unknown;
}
interface Product {
  found: boolean;
  masp?: string;
  tensp?: string | null;
  banve?: BanVeItem[];
  govan?: GoVanRow[];
  ngukim?: NguKimRow[];
  donggoi?: DongGoiRow[];
  son?: SonRow[];
}

const LS_MASP = "banve:lastmasp";
type Tab = "banve" | "dao" | "govan" | "ngukim" | "donggoi" | "son";

function BanVePage() {
  const navigate = useNavigate();
  const router = useRouter();
  const role = useAuth((s) => s.user?.role);
  const { data: navNodes } = useNavTree();
  const pages = useUserObjects((s) => s.pages);
  // Về ĐÚNG trang trước nếu có lịch sử; vào thẳng (QR/refresh) → cổng/trang chủ.
  const goBack = () => {
    if (router.history.canGoBack()) router.history.back();
    else void navigate({ to: role === "viewer" ? "/portal" : "/" });
  };

  const getPageIdForType = (type: string) => {
    let menuCodes: string[] = [];
    let matchType = "";
    if (type === "ky-thuat") {
      menuCodes = ["bbiBanVe", "I1", "CUST-97ae4fcc-5194-40a0-b34a-28d340f68079"];
      matchType = "ky-thuat";
    } else if (type === "dong-goi") {
      menuCodes = ["bbiBanVeDongGoi", "D1"];
      matchType = "dong-goi";
    } else if (type === "phat-trien") {
      menuCodes = ["bbiBanVePhatTrien"];
      matchType = "phat-trien";
    } else if (type === "ai") {
      menuCodes = ["bbiBanVeAI", "I1217", "I1013"];
      matchType = "ai";
    } else if (type === "mau") {
      menuCodes = ["bbiBanVeMau", "I1227", "I1193"];
      matchType = "mau";
    } else if (type === "dao") {
      menuCodes = ["bbiBanVeDao", "I1141"];
      matchType = "dao";
    }

    // 1. Tìm pageId liên kết trong menu
    const menuNode = navNodes?.find((n) => n.code && menuCodes.includes(n.code));
    if (menuNode?.pageId) return menuNode.pageId;

    // 2. Tìm trang khớp thông minh
    const fallbackPage = pages.find((p) => matchesPage(p, matchType));
    return fallbackPage?.id;
  };
  const [masp, setMasp] = useState("");
  const [product, setProduct] = useState<Product | null>(null);
  const [tab, setTab] = useState<Tab>("banve");
  const [viewId, setViewId] = useState<string | null>(null);
  const [viewTitle, setViewTitle] = useState("Bản vẽ");
  const [view3dId, setView3dId] = useState<string | null>(null);
  // Bản vẽ dao: LUÔN tải tất cả, không phụ thuộc sản phẩm đã chọn.
  const [allDao, setAllDao] = useState<BanVeItem[]>([]);
  // Mở PDF kèm tiêu đề loại bản vẽ.
  const openPdf = (id: string, phanloai?: string) => {
    setViewId(id);
    setViewTitle(phanloai?.trim() || "Bản vẽ");
  };
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [scanning, setScanning] = useState(false);
  const [searching, setSearching] = useState(false);

  const load = useCallback(async (m: string): Promise<Product | null> => {
    const q = m.trim();
    if (!q) return null;
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
      return p;
    } catch (e) {
      setErr((e as Error).message);
      setProduct(null);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const scanResult = useCallback(
    async (code: string) => {
      setScanning(false);
      // Resolve mã quét → masp (fallback: dùng chính mã thô nếu resolve lỗi).
      let m = code.trim();
      try {
        const res = await fetch(`/banvesvc/resolve?code=${encodeURIComponent(code)}`, {
          credentials: "include",
        });
        const j = (await res.json()) as { masp?: string };
        m = (j.masp ?? "").trim() || code.trim();
      } catch {
        /* fail-safe: giữ mã thô */
      }
      setMasp(m);
      const p = await load(m);
      // Nếu SP chỉ có ĐÚNG 1 loại bản vẽ hiển thị (đã loại "Bản vẽ dao" cho nhất
      // quán với banveList) → mở thẳng, khỏi bắt người dùng chọn. >1 loại → giữ
      // hành vi cũ (hiện danh sách tab Bản vẽ). Dùng setter stable, tránh dep useCallback.
      if (p?.found && p.banve) {
        const shown = p.banve.filter((b) => !b.phanloai.startsWith("Bản vẽ dao"));
        const distinct = [...new Set(shown.map((b) => b.phanloai))];
        if (distinct.length === 1 && shown[0]) {
          setViewId(shown[0].id);
          setViewTitle(shown[0].phanloai?.trim() || "Bản vẽ");
        }
      }
    },
    [load],
  );

  // Tải TẤT CẢ bản vẽ dao (1 lần khi mở trang) — tab Dao luôn hiện đầy đủ,
  // không phụ thuộc sản phẩm đã chọn. Fail-safe: lỗi → để trống.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(
          `/banvesvc/banve-list?phanloai=${encodeURIComponent("Bản vẽ dao")}`,
          {
            credentials: "include",
          },
        );
        const j = (await res.json().catch(() => ({}))) as { rows?: Array<Record<string, unknown>> };
        if (!alive) return;
        setAllDao(
          (j.rows ?? []).map((r) => {
            const m = String(r.masp ?? "");
            const tn = String(r.tensp ?? "");
            const hh = String(r.hehang ?? "");
            return {
              id: String(r.id ?? ""),
              phanloai: String(r.phanloai ?? "Bản vẽ dao"),
              label: [m, tn].filter(Boolean).join(" — ") || hh || "Bản vẽ dao",
            };
          }),
        );
      } catch {
        /* fail-safe */
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // Hiện tất cả loại bản vẽ (trừ dao — dao có tab riêng).
  // Không còn lọc theo "loại đã chọn" vì tag trên mỗi SP đã mở thẳng bản vẽ.
  const banveList = (product?.banve ?? []).filter((b) => !b.phanloai.startsWith("Bản vẽ dao"));
  const govan = product?.govan ?? [];
  const ngukim = product?.ngukim ?? [];
  const donggoi = product?.donggoi ?? [];
  const son = product?.son ?? [];

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
              { label: "Kỹ thuật", type: "ky-thuat" },
              { label: "Đóng gói", type: "dong-goi" },
              { label: "Phát triển", type: "phat-trien" },
              { label: "AI", type: "ai" },
              { label: "Mẫu", type: "mau" },
              { label: "Dao", type: "dao" },
            ] as const
          ).map(({ label, type: t }) => {
            const pageId = getPageIdForType(t);
            return (
              <button
                key={t}
                type="button"
                onClick={() => {
                  if (pageId) {
                    void navigate({ to: `/pages/${pageId}` });
                  }
                }}
                className="chip chip-default text-xs"
                disabled={!pageId}
              >
                {label}
              </button>
            );
          })}
        </div>
      )}
      <div className="p-3 space-y-2.5 max-w-2xl w-full mx-auto">
        {/* Tìm sản phẩm + Quét phiếu — cùng dòng */}
        <div className="flex gap-2">
          <Button
            variant="ghost"
            onClick={() => setSearching(true)}
            className="flex-1 justify-start"
          >
            <I.Search size={15} /> Tìm sản phẩm (hệ hàng / đơn đặt hàng / PO#)
          </Button>
          {canScanBarcode() && (
            <Button onClick={() => setScanning(true)}>
              <I.QrCode size={16} /> Quét
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

        {/* Tabs — LUÔN hiển thị. Dao luôn hiện tất cả; các tab khác cần chọn SP. */}
        <div className="flex border-b border-border overflow-x-auto -mx-1 px-1">
          <TabBtn active={tab === "banve"} onClick={() => setTab("banve")}>
            Bản vẽ {banveList.length > 0 && `(${banveList.length})`}
          </TabBtn>
          <TabBtn active={tab === "dao"} onClick={() => setTab("dao")}>
            Bản vẽ dao {allDao.length > 0 && `(${allDao.length})`}
          </TabBtn>
          <TabBtn active={tab === "govan"} onClick={() => setTab("govan")}>
            Định mức gỗ ván {govan.length > 0 && `(${govan.length})`}
          </TabBtn>
          <TabBtn active={tab === "ngukim"} onClick={() => setTab("ngukim")}>
            Định mức ngũ kim {ngukim.length > 0 && `(${ngukim.length})`}
          </TabBtn>
          <TabBtn active={tab === "donggoi"} onClick={() => setTab("donggoi")}>
            Định mức đóng gói {donggoi.length > 0 && `(${donggoi.length})`}
          </TabBtn>
          <TabBtn active={tab === "son"} onClick={() => setTab("son")}>
            Định mức sơn {son.length > 0 && `(${son.length})`}
          </TabBtn>
        </div>

        <div className="pt-1">
          {tab === "banve" &&
            (product?.found ? (
              <BanVeList
                items={banveList}
                onView={openPdf}
                onView3d={setView3dId}
                empty="loại này"
              />
            ) : (
              <div className="text-xs text-muted py-6 text-center">
                Chọn sản phẩm để xem bản vẽ.
              </div>
            ))}
          {tab === "dao" && <BanVeList items={allDao} onView={openPdf} empty="dao" />}
          {tab === "govan" &&
            (product?.found ? (
              <GoVanGrid rows={govan} />
            ) : (
              <div className="text-xs text-muted py-6 text-center">
                Chọn sản phẩm để xem định mức.
              </div>
            ))}
          {tab === "ngukim" &&
            (product?.found ? (
              <NguKimGrid rows={ngukim} />
            ) : (
              <div className="text-xs text-muted py-6 text-center">
                Chọn sản phẩm để xem định mức.
              </div>
            ))}
          {tab === "donggoi" &&
            (product?.found ? (
              <DongGoiGrid rows={donggoi} />
            ) : (
              <div className="text-xs text-muted py-6 text-center">
                Chọn sản phẩm để xem định mức.
              </div>
            ))}
          {tab === "son" &&
            (product?.found ? (
              <SonGrid rows={son} />
            ) : (
              <div className="text-xs text-muted py-6 text-center">
                Chọn sản phẩm để xem định mức.
              </div>
            ))}
        </div>
      </div>

      {viewId && <PdfViewer id={viewId} title={viewTitle} onClose={() => setViewId(null)} />}
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
          onPick={(m, phanloai) => {
            setSearching(false);
            setMasp(m);
            // Nếu user nhấn tag loại BV → tải SP rồi mở thẳng bản vẽ loại đó.
            void (async () => {
              const p = await load(m);
              if (phanloai && p?.found && p?.banve) {
                const bv = p.banve.find((b) => b.phanloai === phanloai);
                if (bv) openPdf(bv.id, bv.phanloai);
              }
            })();
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
type Opt = {
  value: string;
  label: string;
  daco?: number;
  chuaco?: number;
  total?: number;
  types?: string[];
};

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
  /** Chọn sản phẩm. phanloai truyền thêm khi user nhấn tag loại BV → mở thẳng bản vẽ. */
  onPick: (masp: string, phanloai?: string) => void;
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
  // Bộ lọc client-side: hệ hàng (cấp 1) và sản phẩm (cấp 2).
  const [hehangFilter, setHehangFilter] = useState("");
  const [productFilter, setProductFilter] = useState("");
  // Nhớ chế độ + giá trị cấp 1 đã chọn → khôi phục khi mở lại popup.
  const savedL1v = useRef(
    typeof localStorage !== "undefined" ? localStorage.getItem("banve:find:l1v") || "" : "",
  );
  const restored = useRef(false);

  const setMode = (m: FindMode) => {
    setModeRaw(m);
    restored.current = true; // user đổi chế độ → không khôi phục l1v cũ
    savedL1v.current = "";
    setHehangFilter("");
    setProductFilter("");
    if (typeof localStorage !== "undefined") localStorage.setItem("banve:find:mode", m);
  };
  const setL1v = (v: string) => {
    setL1vRaw(v);
    setProductFilter(""); // reset khi đổi hệ hàng
    if (typeof localStorage !== "undefined" && v) localStorage.setItem("banve:find:l1v", v);
  };

  // Lọc client-side không dấu cho danh sách hệ hàng.
  const normHehangFilter = hehangFilter ? normalizeVi(hehangFilter) : "";
  const filteredL1 = normHehangFilter
    ? l1.filter((o) => normalizeVi(o.label).includes(normHehangFilter))
    : l1;

  // Lọc client-side không dấu cho danh sách sản phẩm.
  const normProductFilter = productFilter ? normalizeVi(productFilter) : "";
  const filteredProducts = normProductFilter
    ? products.filter((p) => normalizeVi(p.label).includes(normProductFilter))
    : products;

  const loadL1 = useCallback(async (m: FindMode) => {
    setBusy(true);
    setL1([]);
    setL1vRaw("");
    setProducts([]);
    try {
      if (m === "hehang") {
        const d = await jget("/banvesvc/hehang");
        // Shape mới: [{hehang,daco,chuaco}]; cũ: string[] (server chưa redeploy).
        const rows =
          (d.rows as Array<
            string | { hehang: string; daco?: number; chuaco?: number; total?: number }
          >) ?? [];
        setL1(
          rows.map((r) =>
            typeof r === "string"
              ? { value: r, label: r }
              : {
                  value: r.hehang,
                  label: r.hehang,
                  daco: r.daco ?? 0,
                  chuaco: r.chuaco ?? 0,
                  total: r.total ?? 0,
                },
          ),
        );
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
          // types = loại bản vẽ SP đang có (chỉ /banvesvc/search trả) → hiện tag.
          const types = Array.isArray(r.types)
            ? (r.types as unknown[]).map(String).filter(Boolean)
            : undefined;
          return { value: masp, label: name ? `${masp} — ${name}` : masp, types };
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
        {/* Cấp 1: HỆ HÀNG = danh sách (mỗi dòng: số SP đã/chưa có bản vẽ);
            ĐƠN ĐẶT HÀNG / PO# giữ combobox. Cấp 2: SẢN PHẨM = danh sách. */}
        <div className="p-3 space-y-3 overflow-y-auto">
          {mode === "hehang" ? (
            <div className="space-y-1">
              <div className="flex items-center justify-between text-xs text-muted px-0.5">
                <span>Hệ hàng</span>
                <span>
                  <span className="text-success">có BV</span> / tất cả
                </span>
              </div>
              {/* Ô lọc hệ hàng (client, không dấu) */}
              <input
                type="text"
                value={hehangFilter}
                onChange={(e) => setHehangFilter(e.target.value)}
                placeholder="Tìm hệ hàng…"
                className="input w-full h-7 text-xs"
              />
              <div className="max-h-44 overflow-y-auto rounded border border-border divide-y divide-border">
                {busy && filteredL1.length === 0 ? (
                  <div className="px-2 py-3 text-xs text-muted">Đang tải…</div>
                ) : filteredL1.length === 0 ? (
                  <div className="px-2 py-3 text-xs text-muted">
                    {hehangFilter ? "Không khớp" : "Không có hệ hàng"}
                  </div>
                ) : (
                  filteredL1.map((o) => (
                    <button
                      key={o.value}
                      type="button"
                      onClick={() => {
                        setL1v(o.value);
                        void loadProducts(mode, o.value);
                      }}
                      className={`w-full flex items-center gap-2 px-2 py-1.5 text-left text-sm hover:bg-hover ${
                        l1v === o.value ? "bg-accent/10 text-accent font-medium" : ""
                      }`}
                    >
                      <span className="flex-1 truncate">{o.label}</span>
                      <span className="text-xs shrink-0">
                        <span className="text-success">{o.daco ?? 0}</span>
                        <span className="text-muted"> / {o.total ?? 0}</span>
                      </span>
                    </button>
                  ))
                )}
              </div>
            </div>
          ) : (
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
          )}
          <div className="space-y-1">
            <span className="block text-xs text-muted px-0.5">
              Sản phẩm{products.length > 0 && ` (${products.length})`}
            </span>
            {/* Ô lọc sản phẩm (client, không dấu) — hiện khi đã chọn cấp 1 */}
            {l1v && (
              <input
                type="text"
                value={productFilter}
                onChange={(e) => setProductFilter(e.target.value)}
                placeholder="Tìm sản phẩm…"
                className="input w-full h-7 text-xs"
              />
            )}
            <div className="max-h-52 overflow-y-auto rounded border border-border divide-y divide-border">
              {!l1v ? (
                <div className="px-2 py-3 text-xs text-muted">Chọn ở trên trước</div>
              ) : busy ? (
                <div className="px-2 py-3 text-xs text-muted">Đang tải…</div>
              ) : filteredProducts.length === 0 ? (
                <div className="px-2 py-3 text-xs text-muted">
                  {productFilter ? "Không khớp" : "Không có sản phẩm"}
                </div>
              ) : (
                filteredProducts.map((p) => (
                  // Tách tên SP và tags thành 2 phần để tránh nested button (HTML không hợp lệ).
                  <div key={p.value} className="w-full">
                    <button
                      type="button"
                      onClick={() => onPick(p.value)}
                      className="w-full block px-2 pt-1.5 pb-1 text-left text-sm hover:bg-hover"
                    >
                      <span className="block truncate">{p.label}</span>
                    </button>
                    {p.types && p.types.length > 0 && (
                      // Tags loại BV — nhấn tag → mở thẳng bản vẽ loại đó cho SP này.
                      <div className="px-2 pb-1.5 flex flex-wrap gap-1">
                        {p.types.map((t) => (
                          <button
                            key={t}
                            type="button"
                            onClick={() => onPick(p.value, t)}
                            className="text-[10px] leading-tight px-1.5 py-0.5 rounded bg-accent/15 text-accent hover:bg-accent/30 transition-colors"
                            title={`Mở ${t}`}
                          >
                            {t.replace(/^Bản vẽ\s*/i, "") || t}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
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
  onView: (id: string, phanloai?: string) => void;
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
            onClick={() => onView(b.id, b.phanloai)}
            className="flex items-center gap-3 flex-1 min-w-0 text-left"
          >
            <span className="w-9 h-9 rounded bg-accent/15 text-accent flex items-center justify-center shrink-0">
              <I.FileText size={18} />
            </span>
            <span className="flex-1 min-w-0">
              <span className="block text-sm font-medium truncate">
                {b.label || b.phanloai || "Bản vẽ"}
              </span>
              {b.label && <span className="block text-xs text-muted truncate">{b.phanloai}</span>}
            </span>
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

export function DongGoiGrid({ rows }: { rows: DongGoiRow[] }) {
  if (rows.length === 0)
    return <div className="text-xs text-muted py-6 text-center">Không có định mức đóng gói.</div>;

  return (
    <div className="overflow-x-auto pt-1">
      <table className="w-full text-xs border-collapse border border-border">
        <thead className="text-muted bg-panel-2">
          <tr>
            <th className="p-2 border border-border text-left font-medium">STT</th>
            <th className="p-2 border border-border text-left font-medium">Mã chi tiết</th>
            <th className="p-2 border border-border text-left font-medium">Chi tiết</th>
            <th className="p-2 border border-border text-left font-medium">Quy cách</th>
            <th className="p-2 border border-border text-right font-medium">Số lượng</th>
            <th className="p-2 border border-border text-center font-medium">ĐVT</th>
            <th className="p-2 border border-border text-left font-medium">Nhóm</th>
            <th className="p-2 border border-border text-left font-medium">Ghi chú</th>
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
                {String(r.ccode ?? "")}
              </td>
              <td className="p-2 border border-border/60 text-left">{String(r.chitiet ?? "")}</td>
              <td className="p-2 border border-border/60 text-left">{String(r.quycach ?? "")}</td>
              <td className="p-2 border border-border/60 text-right whitespace-nowrap">
                {fmtNum(r.soluong)}
              </td>
              <td className="p-2 border border-border/60 text-center whitespace-nowrap">
                {String(r.dvt ?? "")}
              </td>
              <td className="p-2 border border-border/60 text-left">{String(r.nhom ?? "")}</td>
              <td className="p-2 border border-border/60 text-left">{String(r.ghichu ?? "")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function SonGrid({ rows }: { rows: SonRow[] }) {
  if (rows.length === 0)
    return <div className="text-xs text-muted py-6 text-center">Không có định mức sơn.</div>;

  return (
    <div className="overflow-x-auto pt-1">
      <table className="w-full text-xs border-collapse border border-border">
        <thead className="text-muted bg-panel-2">
          <tr>
            <th className="p-2 border border-border text-left font-medium">STT</th>
            <th className="p-2 border border-border text-left font-medium">Bước sơn</th>
            <th className="p-2 border border-border text-left font-medium">Mã chi tiết</th>
            <th className="p-2 border border-border text-left font-medium">Tên chi tiết</th>
            <th className="p-2 border border-border text-right font-medium">SL/m²</th>
            <th className="p-2 border border-border text-right font-medium">SL/SP</th>
            <th className="p-2 border border-border text-center font-medium">ĐVT</th>
            <th className="p-2 border border-border text-left font-medium">Mã màu</th>
            <th className="p-2 border border-border text-left font-medium">Nhóm</th>
            <th className="p-2 border border-border text-left font-medium">Ghi chú</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: grid read-only, không reorder
            <tr key={i} className="hover:bg-hover/20">
              <td className="p-2 border border-border/60 text-left whitespace-nowrap">
                {String(r.stt ?? "")}
              </td>
              <td className="p-2 border border-border/60 text-left">{String(r.buoc ?? "")}</td>
              <td className="p-2 border border-border/60 text-left whitespace-nowrap">
                {String(r.mact ?? "")}
              </td>
              <td className="p-2 border border-border/60 text-left">{String(r.tenct ?? "")}</td>
              <td className="p-2 border border-border/60 text-right whitespace-nowrap">
                {fmtNum(r.sl_m2)}
              </td>
              <td className="p-2 border border-border/60 text-right whitespace-nowrap">
                {fmtNum(r.sl_sp)}
              </td>
              <td className="p-2 border border-border/60 text-center whitespace-nowrap">
                {String(r.dvt ?? "")}
              </td>
              <td className="p-2 border border-border/60 text-left whitespace-nowrap">
                {String(r.mamau ?? "")}
              </td>
              <td className="p-2 border border-border/60 text-left">{String(r.nhom ?? "")}</td>
              <td className="p-2 border border-border/60 text-left">{String(r.ghichu ?? "")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ── PDF viewer toàn màn hình (iframe; nút mở tab mới cho iOS Safari) ── */
function PdfViewer({ id, title, onClose }: { id: string; title?: string; onClose: () => void }) {
  const src = `/banvesvc/file?id=${encodeURIComponent(id)}`;
  return (
    <div className="fixed inset-0 z-50 bg-black/90 flex flex-col">
      <div className="flex items-center gap-2 px-3 py-2 bg-panel border-b border-border">
        <span className="text-sm font-medium flex-1 truncate">{title || "Bản vẽ"}</span>
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
