import { useCallback, useEffect, useRef, useState } from "react";
import { I } from "@/components/Icons";
import {
  Button,
  Card,
  Chip,
  EmptyState,
  Modal,
  SearchableSelect,
  SplitPane,
} from "@/components/ui";
import { dialog } from "@/lib/dialog";
import { fmtNum, GoVanGrid, type GoVanRow, NguKimGrid, type NguKimRow } from "@/routes/ban-ve";

interface DongGoiRow {
  stt: unknown;
  ccode: unknown;
  chitiet: unknown;
  quycach: unknown;
  soluong: unknown;
  dvt: unknown;
  ghichu: unknown;
  nhom: unknown;
}

export function DongGoiGrid({
  rows,
  masp,
  mausac,
}: {
  rows: DongGoiRow[];
  masp: string;
  mausac: string | null;
}) {
  if (rows.length === 0)
    return <div className="text-xs text-muted py-6 text-center">Không có định mức đóng gói.</div>;
  return (
    <div className="overflow-x-auto pt-1">
      <table className="w-full text-xs border-collapse border border-border">
        <thead className="text-muted bg-panel-2">
          <tr>
            <th className="p-2 border border-border text-left font-medium">Mã sản phẩm</th>
            <th className="p-2 border border-border text-left font-medium">Mã chi tiết</th>
            <th className="p-2 border border-border text-left font-medium">Mô tả</th>
            <th className="p-2 border border-border text-left font-medium">Quy cách</th>
            <th className="p-2 border border-border text-left font-medium">Màu sắc</th>
            <th className="p-2 border border-border text-right font-medium">Số lượng</th>
            <th className="p-2 border border-border text-center font-medium">ĐVT</th>
            <th className="p-2 border border-border text-left font-medium">Ghi chú</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: grid read-only, không reorder
            <tr key={i} className="hover:bg-hover/20">
              <td className="p-2 border border-border/60 whitespace-nowrap text-left">{masp}</td>
              <td className="p-2 border border-border/60 whitespace-nowrap text-left">
                {String(r.ccode ?? "")}
              </td>
              <td className="p-2 border border-border/60 text-left">{String(r.chitiet ?? "")}</td>
              <td className="p-2 border border-border/60 text-left">{String(r.quycach ?? "")}</td>
              <td className="p-2 border border-border/60 text-left">{mausac ?? ""}</td>
              <td className="p-2 border border-border/60 text-right whitespace-nowrap">
                {fmtNum(r.soluong)}
              </td>
              <td className="p-2 border border-border/60 text-center whitespace-nowrap">
                {String(r.dvt ?? "")}
              </td>
              <td className="p-2 border border-border/60 text-left">{String(r.ghichu ?? "")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface SpRow {
  masp: string;
  tensp: string | null;
  hehang: string | null;
}
interface BanveRow {
  id: string;
  masp: string;
  tensp: string | null;
  hehang: string | null;
  phanloai: string | null;
  filepath: string | null;
  seq1: string | null;
  seq2: string | null;
  khachhang: string | null;
  create_date: string | null;
  update_date: string | null;
}
type Opt = { value: string; label: string };

async function jget<T = unknown>(url: string): Promise<T> {
  const r = await fetch(url, { credentials: "include" });
  return (await r.json().catch(() => ({}))) as T;
}

function ThemModal({
  hehangs,
  phanloai,
  defaultHehang,
  defaultMasp,
  onClose,
  onSuccess,
}: {
  hehangs: Opt[];
  phanloai: string;
  defaultHehang?: string;
  defaultMasp?: string;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [hehang, setHehang] = useState(defaultHehang || "");
  const [products, setProducts] = useState<SpRow[]>([]);
  const [masp, setMasp] = useState(defaultMasp || "");
  const [spInfo, setSpInfo] = useState<SpRow | null>(null);
  const [seq1, setSeq1] = useState("");
  const [seq2, setSeq2] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState("");
  const [maspAutoOpen, setMaspAutoOpen] = useState(false);

  const loadProducts = useCallback(async (hh: string, shouldAutoOpen = false) => {
    if (!hh) {
      setProducts([]);
      return [];
    }
    const d = await jget<{ rows: SpRow[] }>(
      `/banvesvc/sanpham-by-hehang?hehang=${encodeURIComponent(hh)}`,
    );
    const rows = d.rows ?? [];
    setProducts(rows);
    if (shouldAutoOpen) {
      setMaspAutoOpen(true);
    }
    return rows;
  }, []);

  useEffect(() => {
    if (defaultHehang) {
      void loadProducts(defaultHehang, false).then((rows) => {
        if (rows && defaultMasp) {
          setSpInfo(rows.find((p) => p.masp === defaultMasp) ?? null);
        }
      });
    }
  }, [defaultHehang, defaultMasp, loadProducts]);

  const productOpts: Opt[] = products.map((p) => ({
    value: p.masp,
    label: p.tensp ? `${p.masp} — ${p.tensp}` : p.masp,
  }));

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] ?? null;
    setFile(f);
    if (f) {
      const ext = f.name.split(".").pop() || "";
      setSeq1(ext.toUpperCase());
      setSeq2(f.name.replace(/\.[^.]+$/, ""));
    }
  };

  const handleSubmit = async () => {
    if (!masp) {
      setErr("Vui lòng chọn mã sản phẩm");
      return;
    }
    if (!file) {
      setErr("Vui lòng chọn file bản vẽ");
      return;
    }
    setErr("");
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);

      const getPhanloaiSlug = (p: string): string => {
        const map: Record<string, string> = {
          "Bản vẽ kỹ thuật": "ky-thuat",
          "Bản vẽ phát triển": "phat-trien",
          "Bản vẽ đóng gói": "dong-goi",
          "Bản vẽ mẫu (PPS)": "mau",
          "Bản vẽ mẫu": "mau",
          "Bản vẽ AI": "ai",
          "Bản vẽ dao": "dao",
        };
        return map[p] || "ky-thuat";
      };
      const sub = getPhanloaiSlug(phanloai);

      const upRes = await fetch(`/upload/file?subfolder=${sub}`, {
        method: "POST",
        credentials: "include",
        body: fd,
      });
      if (!upRes.ok) {
        setErr("Lỗi tải file lên");
        return;
      }
      const { url: filepath } = (await upRes.json()) as { url: string };

      const createRes = await fetch("/banvesvc/banve-create", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          masp,
          tensp: spInfo?.tensp ?? "",
          hehang: spInfo?.hehang ?? hehang,
          phanloai,
          filepath,
          seq1: seq1.trim(),
          seq2: seq2.trim(),
        }),
      });
      if (!createRes.ok) {
        const body = (await createRes.json().catch(() => ({}))) as { error?: string };
        setErr(body.error ?? "Lỗi tạo bản vẽ");
        setUploading(false);
        return;
      }
      onSuccess();
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setUploading(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`Thêm ${phanloai.toLowerCase()}`}
      width={540}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Hủy
          </Button>
          <Button
            variant="primary"
            disabled={uploading}
            onClick={handleSubmit}
            icon={uploading ? <I.Loader size={13} className="animate-spin" /> : undefined}
          >
            Lưu
          </Button>
        </>
      }
    >
      <div className="space-y-3 py-1">
        <div>
          <label className="block text-xs text-muted mb-1">Hệ hàng</label>
          <SearchableSelect
            className="w-full"
            value={hehang}
            onChange={(v) => {
              setHehang(v);
              setMasp("");
              setSpInfo(null);
              setMaspAutoOpen(false);
              void loadProducts(v, true);
            }}
            options={hehangs}
            placeholder="Chọn hệ hàng…"
          />
        </div>
        <div>
          <label className="block text-xs text-muted mb-1">Mã sản phẩm</label>
          <SearchableSelect
            key={hehang}
            className="w-full"
            value={masp}
            onChange={(v) => {
              setMasp(v);
              setSpInfo(products.find((p) => p.masp === v) ?? null);
            }}
            options={productOpts}
            autoOpen={maspAutoOpen}
            placeholder={
              !hehang ? "Chọn hệ hàng trước" : products.length === 0 ? "Không có SP" : "Chọn mã SP…"
            }
          />
        </div>
        <div>
          <label className="block text-xs text-muted mb-1">Tên sản phẩm</label>
          <input
            className="input w-full text-sm bg-bg-soft text-muted cursor-default"
            readOnly
            value={spInfo?.tensp ?? ""}
            placeholder="Chưa chọn sản phẩm"
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-xs text-muted mb-1">Định dạng</label>
            <input
              className="input w-full text-sm bg-bg-soft text-muted cursor-default"
              readOnly
              placeholder="Tự động nhận diện…"
              value={seq1}
            />
          </div>
          <div>
            <label className="block text-xs text-muted mb-1">Tên file</label>
            <input
              className="input w-full text-sm"
              placeholder="Tên hiển thị…"
              value={seq2}
              onChange={(e) => setSeq2(e.target.value)}
            />
          </div>
        </div>
        <div>
          <label className="block text-xs text-muted mb-1">
            File bản vẽ <span className="text-danger">*</span>
          </label>
          <label className="flex items-center gap-2 border border-border rounded px-3 py-2 cursor-pointer hover:bg-hover text-sm transition-colors">
            <I.Upload size={14} className="text-accent shrink-0" />
            <span className="flex-1 truncate min-w-0 text-muted">
              {file ? file.name : "Chọn file PDF, DWG, AI…"}
            </span>
            <input type="file" className="sr-only" onChange={handleFileChange} />
          </label>
        </div>
        {err && <p className="text-xs text-danger">{err}</p>}
      </div>
    </Modal>
  );
}

export function BanVeTypePage({ phanloai }: { phanloai: string }) {
  const [hehangs, setHehangs] = useState<Opt[]>([]);
  const [hehang, setHehang] = useState("");
  const [products, setProducts] = useState<SpRow[]>([]);
  const [selectedMasp, setSelectedMasp] = useState("");
  const [spInfo, setSpInfo] = useState<SpRow | null>(null);
  const [loadingProd, setLoadingProd] = useState(false);
  const [banveRows, setBanveRows] = useState<BanveRow[]>([]);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [selectedBvId, setSelectedBvId] = useState<string | null>(null);
  const [showThem, setShowThem] = useState(false);
  const [maspAutoOpen, setMaspAutoOpen] = useState(false);

  // Tab & BOM states
  const [tab, setTab] = useState<"banve" | "govan" | "ngukim" | "donggoi">("banve");
  const [govan, setGovan] = useState<GoVanRow[]>([]);
  const [ngukim, setNgukim] = useState<NguKimRow[]>([]);
  const [donggoi, setDonggoi] = useState<DongGoiRow[]>([]);
  const [donggoiMausac, setDonggoiMausac] = useState<string | null>(null);
  const [loadingBoms, setLoadingBoms] = useState(false);
  const [loadingDongGoi, setLoadingDongGoi] = useState(false);

  const selectedBv = banveRows.find((r) => r.id === selectedBvId);

  const [updatingFileId, setUpdatingFileId] = useState<string | null>(null);
  const [targetBvId, setTargetBvId] = useState<string | null>(null);
  const rowInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    jget<{ rows: string[] }>("/banvesvc/hehang").then((d) => {
      setHehangs((d.rows ?? []).map((h) => ({ value: h, label: h })));
    });
  }, []);

  const loadProducts = useCallback(async (hh: string, shouldAutoOpen = false) => {
    setLoadingProd(true);
    setSelectedMasp("");
    setSpInfo(null);
    setBanveRows([]);
    setSelectedBvId(null);
    setGovan([]);
    setNgukim([]);
    setDonggoi([]);
    setDonggoiMausac(null);
    setTab("banve");
    setMaspAutoOpen(false);
    try {
      const d = await jget<{ rows: SpRow[] }>(
        `/banvesvc/sanpham-by-hehang?hehang=${encodeURIComponent(hh)}`,
      );
      setProducts(d.rows ?? []);
      if (shouldAutoOpen) {
        setMaspAutoOpen(true);
      }
    } finally {
      setLoadingProd(false);
    }
  }, []);

  const loadBanve = useCallback(
    async (masp: string) => {
      if (!masp) return;
      setSelectedBvId(null);
      setLoadingDetail(true);
      try {
        const d = await jget<{ rows: BanveRow[] }>(
          `/banvesvc/banve-list?masp=${encodeURIComponent(masp)}&phanloai=${encodeURIComponent(phanloai)}`,
        );
        setBanveRows(d.rows ?? []);
      } finally {
        setLoadingDetail(false);
      }
    },
    [phanloai],
  );

  const loadBoms = useCallback(async (masp: string) => {
    if (!masp) return;
    setLoadingBoms(true);
    try {
      const res = await fetch(`/banvesvc/product?masp=${encodeURIComponent(masp)}`, {
        credentials: "include",
      });
      if (res.ok) {
        const p = (await res.json()) as { govan?: GoVanRow[]; ngukim?: NguKimRow[] };
        setGovan(p.govan ?? []);
        setNgukim(p.ngukim ?? []);
      }
    } catch (e) {
      console.error("Error loading BOMs", e);
    } finally {
      setLoadingBoms(false);
    }
  }, []);

  const loadDongGoi = useCallback(async (masp: string) => {
    if (!masp) return;
    setLoadingDongGoi(true);
    try {
      const res = await fetch(`/banvesvc/donggoi-chitiet?masp=${encodeURIComponent(masp)}`, {
        credentials: "include",
      });
      if (res.ok) {
        const p = (await res.json()) as { masp: string; mausac: string | null; rows: DongGoiRow[] };
        setDonggoi(p.rows ?? []);
        setDonggoiMausac(p.mausac ?? null);
      }
    } catch (e) {
      console.error("Error loading Dong Goi details", e);
    } finally {
      setLoadingDongGoi(false);
    }
  }, []);

  const reloadBanve = useCallback(async () => {
    if (!selectedMasp) return;
    const d = await jget<{ rows: BanveRow[] }>(
      `/banvesvc/banve-list?masp=${encodeURIComponent(selectedMasp)}&phanloai=${encodeURIComponent(phanloai)}`,
    );
    setBanveRows(d.rows ?? []);
  }, [selectedMasp, phanloai]);

  const handleDelete = useCallback(
    async (id: string) => {
      const ok = await dialog.confirm("Xóa bản vẽ này?");
      if (!ok) return;
      await fetch(`/banvesvc/banve-delete?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (selectedBvId === id) setSelectedBvId(null);
      void reloadBanve();
    },
    [selectedBvId, reloadBanve],
  );

  const handleRowFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const f = e.target.files?.[0];
      if (!f || !targetBvId) return;
      setUpdatingFileId(targetBvId);
      try {
        const fd = new FormData();
        fd.append("file", f);

        const getPhanloaiSlug = (p: string): string => {
          const map: Record<string, string> = {
            "Bản vẽ kỹ thuật": "ky-thuat",
            "Bản vẽ phát triển": "phat-trien",
            "Bản vẽ đóng gói": "dong-goi",
            "Bản vẽ mẫu (PPS)": "mau",
            "Bản vẽ mẫu": "mau",
            "Bản vẽ AI": "ai",
            "Bản vẽ dao": "dao",
          };
          return map[p] || "ky-thuat";
        };
        const sub = getPhanloaiSlug(phanloai);

        const upRes = await fetch(`/upload/file?subfolder=${sub}`, {
          method: "POST",
          credentials: "include",
          body: fd,
        });
        if (!upRes.ok) {
          void dialog.alert("Lỗi tải file lên");
          return;
        }
        const { url: filepath } = (await upRes.json()) as { url: string };

        const ext = f.name.split(".").pop() || "";
        const seq1 = ext.toUpperCase();
        const seq2 = f.name.replace(/\.[^.]+$/, "");

        const updateRes = await fetch("/banvesvc/banve-update", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: targetBvId,
            filepath,
            seq1,
            seq2,
          }),
        });
        if (!updateRes.ok) {
          void dialog.alert("Lỗi cập nhật bản vẽ");
          return;
        }

        await reloadBanve();
        if (rowInputRef.current) rowInputRef.current.value = "";
        void dialog.alert("Cập nhật file thành công!");
      } catch (err) {
        void dialog.alert("Lỗi: " + (err as Error).message);
      } finally {
        setUpdatingFileId(null);
        setTargetBvId(null);
      }
    },
    [targetBvId, phanloai, reloadBanve],
  );

  const productOpts: Opt[] = products.map((p) => ({
    value: p.masp,
    label: p.tensp ? `${p.masp} — ${p.tensp}` : p.masp,
  }));

  const hasSelection = !!selectedMasp;

  /* ── Left panel: filter + table ── */
  const leftPanel = (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Filter bar */}
      <div className="shrink-0 border-b border-border bg-panel/60 px-3 py-2.5">
        <Card className="p-2.5 flex flex-wrap items-end gap-2">
          <div className="min-w-36 flex-1">
            <label className="block text-xs text-muted mb-0.5">Hệ hàng</label>
            <SearchableSelect
              className="w-full"
              triggerClassName="h-8! text-xs!"
              value={hehang}
              onChange={(v) => {
                setHehang(v);
                if (v) void loadProducts(v, true);
                else {
                  setProducts([]);
                  setSelectedMasp("");
                  setSpInfo(null);
                  setBanveRows([]);
                  setSelectedBvId(null);
                  setDonggoi([]);
                  setDonggoiMausac(null);
                  setMaspAutoOpen(false);
                }
              }}
              options={hehangs}
              placeholder="Chọn hệ hàng…"
            />
          </div>
          <div className="min-w-44 flex-[2]">
            <label className="flex items-center h-5 text-xs text-muted mb-0.5">
              <span>Mã sản phẩm</span>
              {products.length > 0 && (
                <Chip variant="accent" className="ml-1 text-[10px] shrink-0">
                  {products.length}
                </Chip>
              )}
            </label>
            <SearchableSelect
              key={hehang}
              className="w-full"
              triggerClassName="h-8! text-xs!"
              value={selectedMasp}
              onChange={(v) => {
                setSelectedMasp(v);
                setSpInfo(products.find((p) => p.masp === v) ?? null);
                setTab("banve");
                if (v) {
                  void loadBanve(v);
                  if (phanloai === "Bản vẽ đóng gói") {
                    void loadDongGoi(v);
                  } else {
                    void loadBoms(v);
                  }
                }
              }}
              options={productOpts}
              autoOpen={maspAutoOpen}
              placeholder={
                !hehang
                  ? "Chọn hệ hàng trước"
                  : loadingProd
                    ? "Đang tải…"
                    : products.length === 0
                      ? "Không có SP"
                      : "Chọn SP…"
              }
            />
          </div>
          <Button
            variant="primary"
            size="sm"
            onClick={() => setShowThem(true)}
            icon={<I.Plus size={12} />}
            className="shrink-0"
          >
            Thêm
          </Button>
        </Card>
      </div>

      {/* Empty state */}
      {!hasSelection && (
        <div className="flex-1 flex items-center justify-center">
          <EmptyState
            icon={<I.FileText size={24} />}
            title="Chọn sản phẩm"
            hint={`Chọn hệ hàng và mã sản phẩm để xem ${phanloai.toLowerCase()}`}
          />
        </div>
      )}

      {/* Table & Tabs */}
      {hasSelection && (
        <>
          <div className="flex border-b border-border overflow-x-auto bg-panel/20 px-3 shrink-0">
            <button
              type="button"
              onClick={() => setTab("banve")}
              className={`px-3 py-2 text-xs whitespace-nowrap border-b-2 -mb-px ${
                tab === "banve"
                  ? "border-accent text-accent font-semibold"
                  : "border-transparent text-muted"
              }`}
            >
              Bản vẽ
            </button>
            {phanloai === "Bản vẽ đóng gói" ? (
              <button
                type="button"
                onClick={() => setTab("donggoi")}
                className={`px-3 py-2 text-xs whitespace-nowrap border-b-2 -mb-px ${
                  tab === "donggoi"
                    ? "border-accent text-accent font-semibold"
                    : "border-transparent text-muted"
                }`}
              >
                Đóng gói
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => setTab("govan")}
                  className={`px-3 py-2 text-xs whitespace-nowrap border-b-2 -mb-px ${
                    tab === "govan"
                      ? "border-accent text-accent font-semibold"
                      : "border-transparent text-muted"
                  }`}
                >
                  Gỗ ván
                </button>
                <button
                  type="button"
                  onClick={() => setTab("ngukim")}
                  className={`px-3 py-2 text-xs whitespace-nowrap border-b-2 -mb-px ${
                    tab === "ngukim"
                      ? "border-accent text-accent font-semibold"
                      : "border-transparent text-muted"
                  }`}
                >
                  Ngũ kim
                </button>
              </>
            )}
          </div>

          {tab === "banve" && (
            <>
              <div className="shrink-0 border-b border-border bg-panel/30 px-3 py-1.5 flex items-center gap-2">
                <I.FileText size={13} className="text-accent" />
                <span className="text-xs font-semibold uppercase tracking-wide">{phanloai}</span>
                <Chip variant="accent" className="text-[10px]">
                  {banveRows.length}
                </Chip>
                {loadingDetail && (
                  <I.Loader size={11} className="animate-spin text-muted shrink-0" />
                )}
                <div className="flex-1" />
                {banveRows.length > 0 && !selectedBv && (
                  <span className="text-[10px] text-muted">Click để xem PDF</span>
                )}
              </div>
              <div className="flex-1 overflow-y-auto">
                {banveRows.length === 0 && !loadingDetail ? (
                  <div className="p-3">
                    <EmptyState
                      icon={<I.FileX size={20} />}
                      title="Chưa có bản vẽ"
                      hint={`Nhấn "Thêm" để tải lên ${phanloai.toLowerCase()}.`}
                    />
                  </div>
                ) : (
                  <table className="w-full text-sm table-fixed">
                    <thead className="bg-bg-soft text-xs text-muted sticky top-0">
                      <tr>
                        <th className="text-left font-medium px-3 py-2 w-8 shrink-0">#</th>
                        <th className="text-left font-medium px-3 py-2 min-w-0">Tên file</th>
                        <th className="text-left font-medium px-3 py-2 w-24 shrink-0">Định dạng</th>
                        <th className="text-left font-medium px-3 py-2 w-32 shrink-0 hidden sm:table-cell">
                          Ngày tải
                        </th>
                        <th className="px-3 py-2 text-right w-24 shrink-0" />
                      </tr>
                    </thead>
                    <tbody>
                      {banveRows.map((bv, i) => {
                        const active = selectedBvId === bv.id;
                        return (
                          <tr
                            key={bv.id}
                            className={`border-t border-border/50 cursor-pointer transition-colors ${active ? "bg-accent/10" : "hover:bg-hover/40"}`}
                            onClick={() => setSelectedBvId(active ? null : bv.id)}
                          >
                            <td className="px-3 py-2 text-muted text-xs truncate w-8 shrink-0">
                              {i + 1}
                            </td>
                            <td
                              className="px-3 py-2 truncate font-medium min-w-0"
                              title={bv.seq2 ?? ""}
                            >
                              {bv.seq2 ?? ""}
                            </td>
                            <td className="px-3 py-2 text-muted text-xs truncate w-24 shrink-0">
                              {bv.seq1 ?? <span className="italic opacity-50">—</span>}
                            </td>
                            <td className="px-3 py-2 text-muted text-xs truncate w-32 shrink-0 hidden sm:table-cell">
                              {bv.create_date ?? "—"}
                            </td>
                            <td className="px-3 py-2 text-right">
                              <div
                                className="inline-flex items-center gap-1 justify-end"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <Button
                                  variant="ghost"
                                  size="xs"
                                  icon={
                                    updatingFileId === bv.id ? (
                                      <I.Loader size={11} className="animate-spin text-muted" />
                                    ) : (
                                      <I.Upload size={11} />
                                    )
                                  }
                                  className="text-muted hover:text-text hover:bg-hover"
                                  onClick={() => {
                                    setTargetBvId(bv.id);
                                    setTimeout(() => rowInputRef.current?.click(), 0);
                                  }}
                                  disabled={updatingFileId !== null}
                                  title="Cập nhật file"
                                />
                                <Button
                                  variant="ghost"
                                  size="xs"
                                  icon={<I.Download size={11} />}
                                  className="text-muted hover:text-text hover:bg-hover"
                                  onClick={() => {
                                    const fileUrl = `/banvesvc/file?id=${encodeURIComponent(bv.id)}`;
                                    const link = document.createElement("a");
                                    link.href = fileUrl;
                                    const ext = (bv.filepath || "").split(".").pop() || "pdf";
                                    link.download = `${bv.seq2 || phanloai}.${ext}`;
                                    document.body.appendChild(link);
                                    link.click();
                                    document.body.removeChild(link);
                                  }}
                                  title="Tải file"
                                />
                                <Button
                                  variant="ghost"
                                  size="xs"
                                  icon={<I.Trash2 size={11} />}
                                  className="text-danger/60 hover:text-danger hover:bg-danger/15"
                                  onClick={() => void handleDelete(bv.id)}
                                  title="Xóa"
                                />
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </>
          )}

          {tab === "govan" && phanloai !== "Bản vẽ đóng gói" && (
            <>
              <div className="shrink-0 border-b border-border bg-panel/30 px-3 py-1.5 flex items-center gap-2">
                <I.FileText size={13} className="text-accent" />
                <span className="text-xs font-semibold uppercase tracking-wide">
                  Định mức gỗ ván
                </span>
                <Chip variant="accent" className="text-[10px]">
                  {govan.length}
                </Chip>
                {loadingBoms && <I.Loader size={11} className="animate-spin text-muted shrink-0" />}
              </div>
              <div className="flex-1 overflow-auto p-3">
                <GoVanGrid rows={govan} />
              </div>
            </>
          )}

          {tab === "ngukim" && phanloai !== "Bản vẽ đóng gói" && (
            <>
              <div className="shrink-0 border-b border-border bg-panel/30 px-3 py-1.5 flex items-center gap-2">
                <I.FileText size={13} className="text-accent" />
                <span className="text-xs font-semibold uppercase tracking-wide">
                  Định mức ngũ kim
                </span>
                <Chip variant="accent" className="text-[10px]">
                  {ngukim.length}
                </Chip>
                {loadingBoms && <I.Loader size={11} className="animate-spin text-muted shrink-0" />}
              </div>
              <div className="flex-1 overflow-auto p-3">
                <NguKimGrid rows={ngukim} />
              </div>
            </>
          )}

          {tab === "donggoi" && phanloai === "Bản vẽ đóng gói" && (
            <>
              <div className="shrink-0 border-b border-border bg-panel/30 px-3 py-1.5 flex items-center gap-2">
                <I.FileText size={13} className="text-accent" />
                <span className="text-xs font-semibold uppercase tracking-wide">
                  Định mức đóng gói
                </span>
                <Chip variant="accent" className="text-[10px]">
                  {donggoi.length}
                </Chip>
                {loadingDongGoi && (
                  <I.Loader size={11} className="animate-spin text-muted shrink-0" />
                )}
              </div>
              <div className="flex-1 overflow-auto p-3">
                <DongGoiGrid rows={donggoi} masp={selectedMasp} mausac={donggoiMausac} />
              </div>
            </>
          )}
        </>
      )}
    </div>
  );

  /* ── Right panel: PDF viewer ── */
  const rightPanel = selectedBv?.filepath ? (
    <div className="flex flex-col h-full">
      <div className="shrink-0 border-b border-border bg-panel/50 px-3 py-2 flex items-center gap-2">
        <I.FileText size={13} className="text-accent" />
        <span className="text-xs font-semibold flex-1 truncate min-w-0">
          {selectedBv.seq2 || phanloai}
          {spInfo?.tensp ? ` (${selectedMasp} — ${spInfo.tensp})` : ` (${selectedMasp})`}
        </span>
        <Button
          variant="ghost"
          size="xs"
          icon={<I.Download size={11} />}
          onClick={() => {
            const fileUrl = `/banvesvc/file?id=${encodeURIComponent(selectedBv.id)}`;
            const link = document.createElement("a");
            link.href = fileUrl;
            const ext = (selectedBv.filepath || "").split(".").pop() || "pdf";
            link.download = `${selectedBv.seq2 || phanloai}.${ext}`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
          }}
        >
          Tải file
        </Button>
        <Button
          variant="ghost"
          size="xs"
          icon={<I.ExternalLink size={11} />}
          onClick={() => {
            const fileUrl = `/banvesvc/file?id=${encodeURIComponent(selectedBv.id)}`;
            window.open(fileUrl, "_blank");
          }}
        >
          Mở tab
        </Button>
        <Button
          variant="ghost"
          size="xs"
          icon={<I.X size={14} />}
          onClick={() => setSelectedBvId(null)}
        />
      </div>
      <iframe
        key={selectedBv.id}
        src={`/banvesvc/file?id=${encodeURIComponent(selectedBv.id)}`}
        title={phanloai}
        className="flex-1 w-full bg-white"
        sandbox="allow-scripts allow-same-origin allow-popups allow-forms allow-downloads"
      />
    </div>
  ) : (
    <div className="h-full flex items-center justify-center">
      <EmptyState
        icon={<I.FileText size={28} />}
        title={hasSelection ? "Chọn bản vẽ để xem" : "Chưa có sản phẩm"}
        hint={
          hasSelection
            ? "Click vào một bản vẽ ở danh sách bên trái"
            : "Chọn hệ hàng và mã sản phẩm trước"
        }
      />
    </div>
  );

  return (
    <div className="h-screen flex flex-col bg-bg text-text">
      <input
        type="file"
        ref={rowInputRef}
        onChange={handleRowFileChange}
        className="sr-only"
        accept=".pdf,.dwg,.ai,.dxf,.jpg,.png"
      />
      {/* SplitPane layout: list left + PDF preview right */}
      <SplitPane
        left={leftPanel}
        right={rightPanel}
        defaultLeftWidth={480}
        minLeft={320}
        minRight={320}
        storageKey="banve:splitsize"
        className="flex-1"
      />

      {showThem && (
        <ThemModal
          hehangs={hehangs}
          phanloai={phanloai}
          defaultHehang={hehang}
          defaultMasp={selectedMasp}
          onClose={() => setShowThem(false)}
          onSuccess={() => void reloadBanve()}
        />
      )}
    </div>
  );
}
