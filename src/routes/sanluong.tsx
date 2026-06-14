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
import { Button, Input } from "@/components/ui";
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
  // stages = công đoạn user được xếp. null = chưa tải.
  const [stages, setStages] = useState<Stage[] | null>(null);

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
