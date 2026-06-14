/* ==========================================================
   sanluong.tsx — Trang MOBILE nhập/cập nhật sản lượng theo công đoạn.
   Port từ NhapSanLuong (CongDoanDController, DQHF252). Công nhân tại 1 công
   đoạn: quét thẻ pallet → xem đơn/chi tiết/định mức/số còn cần → nhập quy cách
   thực tế + số lượng + công đoạn sau → "Hoàn thành".

   Tra thẻ:   procedures.invokeModule("trTrangthaiSanxuatCardInfo", ...)
   Hoàn thành: procedures.invokeModule("trTrangthaiSanxuatHoanthanh", ...) —
   proc Tier D insert 2 record GIAO/NHẬN + mark hoàn thành (phase 2a).
   ========================================================== */
import { createProceduresClient } from "@erp-framework/client";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { type ReactNode, useEffect, useState } from "react";
import { I } from "@/components/Icons";
import { canScanBarcode, QrScanner } from "@/components/QrScanner";
import { Button, Input, SearchableSelect } from "@/components/ui";
import { dialog } from "@/lib/dialog";
import { useAuth } from "@/stores/auth";

const procs = createProceduresClient("");

export const Route = createFileRoute("/sanluong")({ component: SanLuongPage });

interface CardInfo {
  found: boolean;
  message?: string;
  cardNo?: string;
  soluong?: number;
  dondathang?: string | null;
  masp?: string | null;
  mact?: string | null;
  tenct?: string | null;
  nguyenlieu?: string | null;
  dayy_tc?: number | null;
  rong_tc?: number | null;
  dai_tc?: number | null;
  soDaLam?: number;
  soCanLam?: number;
  congDoanSau?: string;
}

/** Công đoạn user được xếp (trtb_scan_op → trtb_m_location *-PROD). */
interface Stage {
  cLocation: string;
  name: string;
  op: string;
}

const LS_CONGDOAN = "sanluong:congdoan";
const todayIso = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

function SanLuongPage() {
  const navigate = useNavigate();
  const user = useAuth((s) => s.user);
  const goBack = () => void navigate({ to: user?.role === "viewer" ? "/portal" : "/" });
  const [congDoan, setCongDoan] = useState(
    () => (typeof localStorage !== "undefined" && localStorage.getItem(LS_CONGDOAN)) || "",
  );
  const [cardNo, setCardNo] = useState("");
  const [diqua, setDiqua] = useState(1);
  const [info, setInfo] = useState<CardInfo | null>(null);
  const [congDoanSau, setCongDoanSau] = useState("");
  const [oday, setOday] = useState("");
  const [orong, setOrong] = useState("");
  const [odai, setOdai] = useState("");
  const [soLuong, setSoLuong] = useState("");
  const [ngay, setNgay] = useState(todayIso);
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [findCard, setFindCard] = useState(false); // popup tìm thẻ theo đơn hàng
  // stages = công đoạn user được xếp. null = chưa tải.
  const [stages, setStages] = useState<Stage[] | null>(null);
  // bump để các tab dưới reload sau khi hoàn thành 1 phiếu.
  const [slRefresh, setSlRefresh] = useState(0);

  const setCongDoanPersist = (v: string) => {
    setCongDoan(v);
    if (typeof localStorage !== "undefined") localStorage.setItem(LS_CONGDOAN, v);
  };

  // Khi mở: tra công đoạn user được xếp. 1 công đoạn → tự chọn; >1 → nhớ
  // công đoạn đã chọn lần trước (nếu còn được xếp) → vào thẳng, không thì hiện
  // danh sách; 0 → fallback nhập tay (admin/editor hoặc user chưa xếp scan_op).
  useEffect(() => {
    let alive = true;
    fetch("/banvesvc/my-stages", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : { stages: [] }))
      .then((d: { stages?: Stage[] }) => {
        if (!alive) return;
        const st = d.stages ?? [];
        setStages(st);
        const only = st.length === 1 ? st[0] : undefined;
        if (only) {
          setCongDoan(only.cLocation);
          if (typeof localStorage !== "undefined")
            localStorage.setItem(LS_CONGDOAN, only.cLocation);
        } else if (st.length > 1) {
          // Giữ lựa chọn lần trước (congDoan đã = localStorage) nếu vẫn được
          // xếp; không hợp lệ (lần đầu / đổi phân công) → để trống → picker.
          const remembered =
            (typeof localStorage !== "undefined" && localStorage.getItem(LS_CONGDOAN)) || "";
          if (!st.some((s) => s.cLocation === remembered)) setCongDoan("");
        }
      })
      .catch(() => {
        if (alive) setStages([]);
      });
    return () => {
      alive = false;
    };
  }, []);

  const traThe = async (card: string) => {
    const c = card.trim();
    if (!c) return;
    if (!congDoan.trim()) {
      await dialog.alert("Nhập công đoạn hiện tại trước khi tra thẻ.");
      return;
    }
    setBusy(true);
    try {
      const { output } = await procs.invokeModule("trTrangthaiSanxuatCardInfo", {
        cardNo: c,
        congDoan: congDoan.trim(),
        diqua,
      });
      const i = output as CardInfo;
      if (!i.found) {
        setInfo(null);
        await dialog.alert(i.message ?? `Không tìm thấy thẻ: ${c}`);
        return;
      }
      setInfo(i);
      setCongDoanSau(i.congDoanSau ?? "");
      // Auto-fill quy cách thực tế = định mức (công nhân chỉnh nếu lệch).
      setOday(i.dayy_tc != null ? String(i.dayy_tc) : "");
      setOrong(i.rong_tc != null ? String(i.rong_tc) : "");
      setOdai(i.dai_tc != null ? String(i.dai_tc) : "");
      setSoLuong(i.soCanLam != null && i.soCanLam > 0 ? String(i.soCanLam) : "");
    } catch (e) {
      await dialog.alert((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const hoanThanh = async () => {
    if (!info?.found) {
      await dialog.alert("Tra thẻ pallet trước.");
      return;
    }
    if (!congDoanSau.trim()) {
      await dialog.alert("Chưa có công đoạn kế tiếp.");
      return;
    }
    setBusy(true);
    try {
      const { output } = await procs.invokeModule("trTrangthaiSanxuatHoanthanh", {
        cardNo: cardNo.trim(),
        congDoan: congDoan.trim(),
        congDoanSau: congDoanSau.trim(),
        soLuong: Number(soLuong),
        oday: Number(oday),
        orong: Number(orong),
        odai: Number(odai),
        diqua,
        ngay,
        // Người nhập = user viewer đang đăng nhập (truy vết sản lượng/thưởng).
        nguoitao: user?.name || user?.email || undefined,
      });
      const r = output as { soDaLam: number; hoanThanhPhieu: boolean };
      const daLam = r.soDaLam + Number(soLuong);
      await dialog.alert(
        `Đã hoàn thành: ${daLam}/${info.soluong ?? "?"}${r.hoanThanhPhieu ? " — XONG phiếu ✓" : ""}`,
      );
      // Reset cho phiếu tiếp theo (giữ công đoạn + ngày).
      setCardNo("");
      setInfo(null);
      setSoLuong("");
      setOday("");
      setOrong("");
      setOdai("");
      setCongDoanSau("");
      setSlRefresh((n) => n + 1); // reload tab Hoàn thành
    } catch (e) {
      await dialog.alert(`Lỗi: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const congDoanChosen = congDoan.trim() !== "";
  const selectedStage = (stages ?? []).find((s) => s.cLocation === congDoan);
  const stageName = selectedStage?.name ?? congDoan;
  const showPicker = stages !== null && stages.length > 1 && !congDoanChosen;

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
        <I.Box size={18} className="text-accent shrink-0" />
        <span className="font-semibold text-sm">Nhập sản lượng</span>
      </div>

      <div className="p-3 space-y-3 max-w-xl w-full mx-auto">
        {stages === null ? (
          <div className="text-xs text-muted py-8 text-center">Đang tải công đoạn…</div>
        ) : showPicker ? (
          <StagePicker stages={stages} onPick={(s) => setCongDoanPersist(s.cLocation)} />
        ) : (
          <>
            {/* Công đoạn: đã xếp → thanh + Đổi; chưa xếp (0) → nhập tay (fallback) */}
            {stages.length === 0 ? (
              <label className="block">
                <span className="text-xs text-muted">Công đoạn hiện tại (c_location)</span>
                <Input
                  value={congDoan}
                  onChange={(e) => setCongDoanPersist(e.target.value)}
                  placeholder="vd: DP09-PROD"
                  className="mt-1 w-full h-10"
                  autoCapitalize="characters"
                />
              </label>
            ) : (
              <div className="flex items-center gap-2 card px-3 py-2">
                <I.Box size={15} className="text-accent shrink-0" />
                <span className="flex-1 text-sm font-medium truncate">{stageName}</span>
                {stages.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setCongDoanPersist("")}
                    className="text-xs text-accent shrink-0"
                  >
                    Đổi công đoạn
                  </button>
                )}
              </div>
            )}

            {congDoanChosen && (
              <>
                {/* Tìm thẻ pallet theo đơn hàng (không cần quét) */}
                <Button
                  variant="ghost"
                  onClick={() => setFindCard(true)}
                  className="w-full justify-start"
                >
                  <I.Search size={15} /> Tìm thẻ pallet (đơn hàng → chi tiết → thẻ)
                </Button>

                {/* Thẻ pallet + quét */}
                <label className="block">
                  <span className="text-xs text-muted">Thẻ pallet</span>
                  <div className="mt-1 flex gap-2">
                    <Input
                      value={cardNo}
                      onChange={(e) => setCardNo(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void traThe(cardNo);
                      }}
                      placeholder="Nhập/quét mã thẻ pallet…"
                      className="flex-1 h-10"
                      autoCapitalize="characters"
                    />
                    <Button onClick={() => void traThe(cardNo)} disabled={busy || !cardNo.trim()}>
                      Tra
                    </Button>
                    {canScanBarcode() && (
                      <Button variant="ghost" onClick={() => setScanning(true)}>
                        <I.QrCode size={16} />
                      </Button>
                    )}
                  </div>
                </label>

                {/* Thông tin thẻ */}
                {info?.found && (
                  <div className="card p-3 space-y-1 text-sm">
                    <Row label="Đơn hàng" value={info.dondathang} />
                    <Row label="Bản vẽ (mã SP)" value={info.masp} />
                    <Row
                      label="Chi tiết"
                      value={[info.mact, info.tenct].filter(Boolean).join(" — ")}
                    />
                    <Row label="Nguyên liệu" value={info.nguyenlieu} />
                    <Row
                      label="Định mức (D×R×Dài)"
                      value={`${info.dayy_tc ?? "?"} × ${info.rong_tc ?? "?"} × ${info.dai_tc ?? "?"}`}
                    />
                    <div className="flex items-center gap-2 pt-1">
                      <span className="text-xs text-muted flex-1">Số lượng phiếu</span>
                      <Chip>{info.soluong ?? 0}</Chip>
                      <span className="text-xs text-muted">đã làm</span>
                      <Chip tone="warning">{info.soDaLam ?? 0}</Chip>
                      <span className="text-xs text-muted">còn cần</span>
                      <Chip tone="success">{info.soCanLam ?? 0}</Chip>
                    </div>
                  </div>
                )}

                {/* Nhập sản lượng */}
                {info?.found && (
                  <div className="space-y-2.5">
                    <label className="block">
                      <span className="text-xs text-muted">Công đoạn kế tiếp (c_location)</span>
                      <Input
                        value={congDoanSau}
                        onChange={(e) => setCongDoanSau(e.target.value)}
                        placeholder="vd: DH06-PROD"
                        className="mt-1 w-full h-10"
                        autoCapitalize="characters"
                      />
                    </label>
                    <div>
                      <span className="text-xs text-muted">Quy cách thực tế (mm)</span>
                      <div className="mt-1 grid grid-cols-3 gap-2">
                        <NumInput value={oday} onChange={setOday} placeholder="Dầy" />
                        <NumInput value={orong} onChange={setOrong} placeholder="Rộng" />
                        <NumInput value={odai} onChange={setOdai} placeholder="Dài" />
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <label className="block">
                        <span className="text-xs text-muted">Số lượng HT</span>
                        <NumInput value={soLuong} onChange={setSoLuong} placeholder="0" />
                      </label>
                      <label className="block">
                        <span className="text-xs text-muted">Lần làm</span>
                        <NumInput
                          value={String(diqua)}
                          onChange={(v) => setDiqua(Number(v) || 1)}
                        />
                      </label>
                      <label className="block">
                        <span className="text-xs text-muted">Ngày</span>
                        <Input
                          type="date"
                          value={ngay}
                          onChange={(e) => setNgay(e.target.value)}
                          className="mt-1 w-full h-10"
                        />
                      </label>
                    </div>
                    <Button
                      onClick={() => void hoanThanh()}
                      disabled={busy || !soLuong || Number(soLuong) <= 0}
                      className="w-full h-11 text-base"
                    >
                      <I.Check size={18} /> Hoàn thành
                    </Button>
                  </div>
                )}

                <SlTabs congDoan={congDoan} refresh={slRefresh} />
              </>
            )}
          </>
        )}
      </div>

      {scanning && (
        <QrScanner
          title="Quét thẻ pallet"
          onClose={() => setScanning(false)}
          onResult={(code) => {
            setScanning(false);
            setCardNo(code);
            void traThe(code);
          }}
        />
      )}
      {findCard && (
        <TimThePallet
          congDoan={congDoan.trim()}
          diqua={diqua}
          onClose={() => setFindCard(false)}
          onPick={(card) => {
            setFindCard(false);
            setCardNo(card);
            void traThe(card);
          }}
        />
      )}
    </div>
  );
}

/* ── "Tìm thẻ pallet" — COMBOBOX xâu chuỗi: Đơn hàng → Chi tiết → Thẻ pallet.
   Port NhapSoLuongSanLuongAction (lọc PalletCard theo đơn hàng). Chọn không gõ
   tay; mỗi combobox có ô lọc sẵn. ── */
type Opt = { value: string; label: string };
async function jget(url: string): Promise<{ rows?: unknown[] }> {
  const res = await fetch(url, { credentials: "include" });
  return (await res.json().catch(() => ({}))) as { rows?: unknown[] };
}
function TimThePallet({
  congDoan,
  diqua,
  onClose,
  onPick,
}: {
  congDoan: string;
  diqua: number;
  onClose: () => void;
  onPick: (cardNo: string) => void;
}) {
  const [orders, setOrders] = useState<Opt[]>([]);
  const [order, setOrder] = useState("");
  const [chitiet, setChitiet] = useState<Opt[]>([]);
  const [mact, setMact] = useState("");
  const [cards, setCards] = useState<Opt[]>([]);
  const [busy, setBusy] = useState(false);

  // Nạp danh sách đơn hàng 1 lần khi mở popup.
  useEffect(() => {
    setBusy(true);
    jget("/banvesvc/sl-orders")
      .then((d) =>
        setOrders(
          ((d.rows as Array<{ dondathang?: string }>) ?? []).map((r) => ({
            value: String(r.dondathang ?? ""),
            label: String(r.dondathang ?? ""),
          })),
        ),
      )
      .finally(() => setBusy(false));
  }, []);

  const pickOrder = (v: string) => {
    setOrder(v);
    setMact("");
    setChitiet([]);
    setCards([]);
    if (!v) return;
    setBusy(true);
    jget(
      `/banvesvc/sl-pallet-chitiet?dondathang=${encodeURIComponent(v)}&congDoan=${encodeURIComponent(congDoan)}&diqua=${diqua}`,
    )
      .then((d) =>
        setChitiet(
          ((d.rows as Array<{ mact?: string; tenct?: string; socard?: number }>) ?? []).map(
            (r) => ({
              value: String(r.mact ?? ""),
              label: `${r.tenct ?? r.mact} — ${r.mact} (còn ${r.socard ?? 0} thẻ)`,
            }),
          ),
        ),
      )
      .finally(() => setBusy(false));
  };

  const pickChitiet = (v: string) => {
    setMact(v);
    setCards([]);
    if (!v) return;
    setBusy(true);
    jget(
      `/banvesvc/sl-pallet-cards?dondathang=${encodeURIComponent(order)}&mact=${encodeURIComponent(v)}&congDoan=${encodeURIComponent(congDoan)}&diqua=${diqua}`,
    )
      .then((d) =>
        setCards(
          ((d.rows as Array<{ card_no?: string; soluong?: number; concan?: number }>) ?? []).map(
            (r) => ({
              value: String(r.card_no ?? ""),
              label: `${r.card_no} — SL ${r.soluong ?? 0} · còn cần ${r.concan ?? 0}`,
            }),
          ),
        ),
      )
      .finally(() => setBusy(false));
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-panel w-full max-w-md rounded-lg flex flex-col max-h-[85vh] overflow-visible">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
          <span className="text-sm font-medium flex-1">Tìm thẻ pallet</span>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded hover:bg-hover text-muted"
            aria-label="Đóng"
          >
            <I.X size={18} />
          </button>
        </div>
        <div className="p-3 space-y-3">
          <label className="block">
            <span className="text-xs text-muted">Đơn hàng</span>
            <div className="mt-1">
              <SearchableSelect
                className="w-full"
                value={order}
                onChange={pickOrder}
                options={orders}
                placeholder={busy && orders.length === 0 ? "Đang tải…" : "Chọn đơn hàng…"}
              />
            </div>
          </label>
          <label className="block">
            <span className="text-xs text-muted">Chi tiết</span>
            <div className="mt-1">
              <SearchableSelect
                className="w-full"
                value={mact}
                onChange={pickChitiet}
                options={chitiet}
                placeholder={!order ? "Chọn đơn hàng trước" : busy ? "Đang tải…" : "Chọn chi tiết…"}
              />
            </div>
          </label>
          <label className="block">
            <span className="text-xs text-muted">Thẻ pallet</span>
            <div className="mt-1">
              <SearchableSelect
                className="w-full"
                value=""
                onChange={(v) => v && onPick(v)}
                options={cards}
                placeholder={
                  !mact
                    ? "Chọn chi tiết trước"
                    : busy
                      ? "Đang tải…"
                      : cards.length === 0
                        ? "Không có thẻ"
                        : "Chọn thẻ pallet…"
                }
              />
            </div>
          </label>
        </div>
      </div>
    </div>
  );
}

/* ── Các tab danh sách dưới màn (port TbMLocation_DetailView tabs, DQHF252):
   Hoàn thành | Nhận hàng | Hàng lỗi | Ra/Vào cổng. Lazy load theo công đoạn. ── */
type SlTab = "hoanthanh" | "nhanhang" | "hangloi" | "ravao";
const SL_TABS: [SlTab, string][] = [
  ["hoanthanh", "Hoàn thành"],
  ["nhanhang", "Nhận hàng"],
  ["hangloi", "Hàng lỗi"],
  ["ravao", "Ra/Vào cổng"],
];

interface SlCol {
  key: string;
  label: string;
  num?: boolean;
  date?: boolean;
  qc?: boolean;
  time?: boolean;
}
const SL_COLS: Record<SlTab, SlCol[]> = {
  hoanthanh: [
    { key: "madonhang", label: "Đơn hàng" },
    { key: "tenct", label: "Chi tiết" },
    { key: "__qc", label: "Quy cách", qc: true },
    { key: "soluong", label: "SL", num: true },
    { key: "ngaythang", label: "Ngày", date: true },
    { key: "nguoitao", label: "Người làm" },
  ],
  nhanhang: [
    { key: "madonhang", label: "Đơn hàng" },
    { key: "tenct", label: "Chi tiết" },
    { key: "__qc", label: "Quy cách", qc: true },
    { key: "soluong", label: "SL", num: true },
    { key: "ngaythang", label: "Ngày", date: true },
  ],
  hangloi: [
    { key: "ngaythang", label: "Ngày", date: true },
    { key: "donhang", label: "Đơn hàng" },
    { key: "tenct", label: "Chi tiết" },
    { key: "soluong", label: "SL", num: true },
    { key: "loailoi", label: "Loại lỗi" },
    { key: "nguyennhan", label: "Nguyên nhân" },
  ],
  ravao: [
    { key: "ngay", label: "Ngày", date: true },
    { key: "mathe", label: "Mã số" },
    { key: "hoten", label: "Họ tên" },
    { key: "giovao", label: "Giờ vào", time: true },
    { key: "giora", label: "Giờ ra", time: true },
    { key: "lydo", label: "Lý do" },
  ],
};

const slFmtN = (v: unknown): string => {
  const n = Number(v);
  return v == null || v === "" || Number.isNaN(n) ? String(v ?? "") : n.toLocaleString("vi-VN");
};
const slFmtD = (v: unknown): string => (v ? String(v).slice(0, 10) : "");
// Giờ vào/ra lưu dạng giây-từ-nửa-đêm (TimeSpan) — đổi sang HH:MM. Nếu đã là
// chuỗi giờ ("15:28:00") thì giữ HH:MM.
const slFmtT = (v: unknown): string => {
  if (v == null || v === "") return "";
  const s = String(v);
  if (s.includes(":")) return s.slice(0, 5);
  const n = Number(s);
  if (Number.isNaN(n)) return s;
  if (n === 0) return "—";
  return `${String(Math.floor(n / 3600)).padStart(2, "0")}:${String(Math.floor((n % 3600) / 60)).padStart(2, "0")}`;
};
const slQc = (r: Record<string, unknown>): string => {
  const d = Number(r.oday ?? r.dayy) || 0;
  const w = Number(r.orong ?? r.rong) || 0;
  const l = Number(r.odai ?? r.dai) || 0;
  return d || w || l ? `${slFmtN(d)}×${slFmtN(w)}×${slFmtN(l)}` : "";
};
const slCell = (r: Record<string, unknown>, c: SlCol): string => {
  if (c.qc) return slQc(r);
  const v = r[c.key];
  if (c.date) return slFmtD(v);
  if (c.time) return slFmtT(v);
  if (c.num) return slFmtN(v);
  return v == null ? "" : String(v);
};

function SlTabs({ congDoan, refresh }: { congDoan: string; refresh: number }) {
  const [tab, setTab] = useState<SlTab>("hoanthanh");
  const [rows, setRows] = useState<Record<string, unknown>[] | null>(null);
  const [pending, setPending] = useState(false); // bảng nguồn chưa migrate
  const [loading, setLoading] = useState(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: refresh là trigger reload có chủ ý (không đọc trong body)
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setRows(null);
    setPending(false);
    fetch(`/banvesvc/sl-records?type=${tab}&congDoan=${encodeURIComponent(congDoan)}`, {
      credentials: "include",
    })
      .then((r) => (r.ok ? r.json() : { rows: [] }))
      .then((d: { rows?: Record<string, unknown>[]; pending?: boolean }) => {
        if (!alive) return;
        setRows(d.rows ?? []);
        setPending(!!d.pending);
      })
      .catch(() => {
        if (alive) setRows([]);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [tab, congDoan, refresh]);

  const cols = SL_COLS[tab];

  return (
    <div className="pt-3 mt-1 border-t border-border">
      <div className="flex border-b border-border overflow-x-auto -mx-1 px-1">
        {SL_TABS.map(([t, label]) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`px-3 py-2 text-xs whitespace-nowrap border-b-2 -mb-px ${
              tab === t
                ? "border-accent text-accent font-semibold"
                : "border-transparent text-muted"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {pending ? (
        <div className="text-xs text-muted py-6 text-center">
          Ra/Vào cổng — bảng <code>ns_ravaocong</code> chưa được migrate.
        </div>
      ) : loading || rows === null ? (
        <div className="text-xs text-muted py-6 text-center">Đang tải…</div>
      ) : rows.length === 0 ? (
        <div className="text-xs text-muted py-6 text-center">Không có dữ liệu.</div>
      ) : (
        <div className="overflow-x-auto pt-1">
          <table className="w-full text-xs border-collapse">
            <thead className="text-muted">
              <tr className="border-b border-border text-left">
                {cols.map((c) => (
                  <th
                    key={c.key}
                    className={`py-1.5 pr-2 whitespace-nowrap ${c.num ? "text-right" : ""}`}
                  >
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: grid read-only, không reorder
                <tr key={i} className="border-b border-border/50">
                  {cols.map((c) => (
                    <td
                      key={c.key}
                      className={`py-1.5 pr-2 ${c.num ? "text-right whitespace-nowrap" : ""}`}
                    >
                      {slCell(r, c)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length >= 200 && (
            <div className="text-[10px] text-muted py-1 text-center">
              Hiển thị 200 dòng gần nhất.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Danh sách card công đoạn user được xếp — chọn 1 để bắt đầu nhập. */
function StagePicker({ stages, onPick }: { stages: Stage[]; onPick: (s: Stage) => void }) {
  return (
    <div className="space-y-2">
      <div className="text-sm text-muted">Chọn công đoạn của bạn</div>
      {stages.map((s) => (
        <button
          key={s.cLocation}
          type="button"
          onClick={() => onPick(s)}
          className="w-full text-left card p-3 hover:border-accent/50 transition-colors flex items-center gap-3"
        >
          <span className="w-9 h-9 rounded bg-accent/15 text-accent flex items-center justify-center shrink-0">
            <I.Box size={18} />
          </span>
          <span className="flex-1 min-w-0">
            <span className="block text-sm font-medium truncate">{s.name}</span>
            <span className="block text-xs text-muted">{s.cLocation}</span>
          </span>
          <I.ChevronRight size={16} className="text-muted shrink-0" />
        </button>
      ))}
    </div>
  );
}

function Row({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-xs text-muted w-28 shrink-0">{label}</span>
      <span className="text-sm font-medium break-words">{value ? String(value) : "—"}</span>
    </div>
  );
}

function Chip({ children, tone }: { children: ReactNode; tone?: "warning" | "success" }) {
  const c =
    tone === "warning"
      ? "bg-warning/15 text-warning"
      : tone === "success"
        ? "bg-success/15 text-success"
        : "bg-accent/15 text-accent";
  return <span className={`px-2 py-0.5 rounded text-sm font-semibold ${c}`}>{children}</span>;
}

function NumInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <Input
      type="number"
      inputMode="decimal"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="mt-1 w-full h-10"
    />
  );
}
