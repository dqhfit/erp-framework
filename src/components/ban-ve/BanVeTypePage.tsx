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
  create_by?: string | null;
  update_by?: string | null;
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
  const isDao = phanloai === "Bản vẽ dao";
  const [hehang, setHehang] = useState(defaultHehang || "");
  const [products, setProducts] = useState<SpRow[]>([]);
  const [masp, setMasp] = useState(isDao ? defaultHehang || "" : defaultMasp || "");
  const [spInfo, setSpInfo] = useState<SpRow | null>(null);
  const [seq1, setSeq1] = useState("");
  const [seq2, setSeq2] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState("");
  const [maspAutoOpen, setMaspAutoOpen] = useState(false);

  const loadProducts = useCallback(
    async (hh: string, shouldAutoOpen = false) => {
      if (isDao) return [];
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
    },
    [isDao],
  );

  useEffect(() => {
    if (defaultHehang && !isDao) {
      void loadProducts(defaultHehang, false).then((rows) => {
        if (rows && defaultMasp) {
          setSpInfo(rows.find((p) => p.masp === defaultMasp) ?? null);
        }
      });
    }
  }, [defaultHehang, defaultMasp, loadProducts, isDao]);

  const productOpts: Opt[] = products.map((p) => ({
    value: p.masp,
    label: p.tensp ? `${p.masp} — ${p.tensp}` : p.masp,
  }));

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] ?? null;
    setFile(f);
    if (f) {
      const ext = f.name.split(".").pop() || "";
      setSeq1(`.${ext.toLowerCase()}`);
      setSeq2(f.name.replace(/\.[^.]+$/, ""));
    }
  };

  const handleSubmit = async () => {
    const finalMasp = isDao ? hehang : masp;
    if (!finalMasp) {
      setErr(isDao ? "Vui lòng chọn hệ hàng" : "Vui lòng chọn mã sản phẩm");
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
          masp: finalMasp,
          tensp: isDao ? "" : (spInfo?.tensp ?? ""),
          hehang: hehang,
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
              if (isDao) {
                setMasp(v);
              } else {
                setMasp("");
                setSpInfo(null);
                setMaspAutoOpen(false);
                void loadProducts(v, true);
              }
            }}
            options={hehangs}
            placeholder="Chọn hệ hàng…"
          />
        </div>
        {!isDao && (
          <>
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
                  !hehang
                    ? "Chọn hệ hàng trước"
                    : products.length === 0
                      ? "Không có SP"
                      : "Chọn mã SP…"
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
          </>
        )}
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

// 3 loại bản vẽ hiển thị dưới dạng slot trên trang Bản vẽ kỹ thuật
const KT_SUB_TYPES = ["Bản vẽ kỹ thuật", "Bản vẽ mẫu", "Bản vẽ phát triển"] as const;
type KtSubType = (typeof KT_SUB_TYPES)[number];
const KT_SUB_LABELS: Record<KtSubType, string> = {
  "Bản vẽ kỹ thuật": "Bản vẽ kỹ thuật",
  "Bản vẽ mẫu": "Bản vẽ mẫu (PPS)",
  "Bản vẽ phát triển": "Bản vẽ phát triển",
};

export function BanVeTypePage({ phanloai }: { phanloai: string }) {
  const isDao = phanloai === "Bản vẽ dao";
  const isKyThuat = phanloai === "Bản vẽ kỹ thuật";
  const isDongGoi = phanloai === "Bản vẽ đóng gói";
  const isSlotPage = isKyThuat || isDongGoi;
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

  const [slotUploading, setSlotUploading] = useState<string | null>(null);

  const selectedBv = banveRows.find((r) => r.id === selectedBvId);

  const [updatingFileId, setUpdatingFileId] = useState<string | null>(null);
  const [targetBvId, setTargetBvId] = useState<string | null>(null);
  const rowInputRef = useRef<HTMLInputElement>(null);
  const slotInputRef = useRef<HTMLInputElement>(null);
  const slotActionRef = useRef<{ subType: string; existingId: string | null }>({
    subType: "Bản vẽ kỹ thuật",
    existingId: null,
  });

  useEffect(() => {
    jget<{ rows: string[] }>("/banvesvc/hehang").then((d) => {
      setHehangs((d.rows ?? []).map((h) => ({ value: h, label: h })));
    });
  }, []);

  const loadProducts = useCallback(
    async (hh: string, shouldAutoOpen = false) => {
      if (isDao) return [];
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
        const rows = d.rows ?? [];
        setProducts(rows);
        if (shouldAutoOpen) {
          setMaspAutoOpen(true);
        }
        return rows;
      } finally {
        setLoadingProd(false);
      }
    },
    [isDao],
  );

  const loadBanve = useCallback(
    async (keyVal: string) => {
      if (!keyVal) return;
      setBanveRows([]);
      setSelectedBvId(null);
      setLoadingDetail(true);
      try {
        const queryParam = isDao
          ? `hehang=${encodeURIComponent(keyVal)}`
          : `masp=${encodeURIComponent(keyVal)}`;
        // Trang Bản vẽ kỹ thuật lấy cả 3 loại (kỹ thuật, mẫu, phát triển) trong 1 request
        const plParam = isKyThuat
          ? encodeURIComponent(KT_SUB_TYPES.join(","))
          : encodeURIComponent(phanloai);
        const d = await jget<{ rows: BanveRow[] }>(
          `/banvesvc/banve-list?${queryParam}&phanloai=${plParam}`,
        );
        const rows = d.rows ?? [];
        setBanveRows(rows);
        if (isSlotPage) {
          if (isKyThuat) {
            const firstAvailable = KT_SUB_TYPES.map((st) =>
              rows.find((r) => r.phanloai === st),
            ).find(Boolean);
            if (firstAvailable) {
              setSelectedBvId(firstAvailable.id);
            }
          } else {
            const matchingBv = rows.find((r) => r.phanloai === phanloai);
            if (matchingBv) {
              setSelectedBvId(matchingBv.id);
            }
          }
        }
      } finally {
        setLoadingDetail(false);
      }
    },
    [phanloai, isDao, isKyThuat, isSlotPage],
  );

  const loadBoms = useCallback(
    async (masp: string) => {
      if (isDao) return;
      if (!masp) return;
      setGovan([]);
      setNgukim([]);
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
    },
    [isDao],
  );

  const loadDongGoi = useCallback(
    async (masp: string) => {
      if (isDao) return;
      if (!masp) return;
      setDonggoi([]);
      setDonggoiMausac(null);
      setLoadingDongGoi(true);
      try {
        const res = await fetch(`/banvesvc/donggoi-chitiet?masp=${encodeURIComponent(masp)}`, {
          credentials: "include",
        });
        if (res.ok) {
          const p = (await res.json()) as {
            masp: string;
            mausac: string | null;
            rows: DongGoiRow[];
          };
          setDonggoi(p.rows ?? []);
          setDonggoiMausac(p.mausac ?? null);
        }
      } catch (e) {
        console.error("Error loading Dong Goi details", e);
      } finally {
        setLoadingDongGoi(false);
      }
    },
    [isDao],
  );

  // Đọc cấu hình từ URL khi mount lần đầu
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const urlHehang = params.get("hehang") || "";
    const urlMasp = params.get("masp") || "";
    const urlTab = params.get("tab") || "banve";
    const urlBvId = params.get("bvId") || null;

    if (urlHehang) {
      setHehang(urlHehang);
      if (isDao) {
        void loadBanve(urlHehang);
        if (urlBvId) {
          setSelectedBvId(urlBvId);
        }
      } else {
        void loadProducts(urlHehang, false).then((rows) => {
          if (urlMasp) {
            setSelectedMasp(urlMasp);
            if (rows) {
              setSpInfo(rows.find((p) => p.masp === urlMasp) ?? null);
            }
            void loadBanve(urlMasp);
            if (phanloai === "Bản vẽ đóng gói") {
              void loadDongGoi(urlMasp);
            } else {
              void loadBoms(urlMasp);
            }
            if (urlBvId) {
              setSelectedBvId(urlBvId);
            }
          }
        });
      }
    }

    if (urlTab && ["banve", "govan", "ngukim", "donggoi"].includes(urlTab)) {
      setTab(urlTab as "banve" | "govan" | "ngukim" | "donggoi");
    }
  }, [phanloai, isDao, loadProducts, loadBanve, loadDongGoi, loadBoms]);

  // Đồng bộ state lên URL khi thay đổi
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);

    if (hehang) params.set("hehang", hehang);
    else params.delete("hehang");

    if (isDao) {
      params.delete("masp");
    } else {
      if (selectedMasp) params.set("masp", selectedMasp);
      else params.delete("masp");
    }

    if (tab && tab !== "banve") params.set("tab", tab);
    else params.delete("tab");

    if (selectedBvId) params.set("bvId", selectedBvId);
    else params.delete("bvId");

    const newSearch = params.toString();
    const currentSearch = window.location.search.replace(/^\?/, "");
    if (newSearch !== currentSearch) {
      const u = new URL(window.location.href);
      u.search = newSearch ? `?${newSearch}` : "";
      window.history.replaceState(null, "", u.pathname + u.search);
    }
  }, [hehang, selectedMasp, tab, selectedBvId, isDao]);

  // Lắng nghe sự kiện back/forward của trình duyệt để đồng bộ URL về state
  useEffect(() => {
    if (typeof window === "undefined") return;
    const handlePopState = () => {
      const params = new URLSearchParams(window.location.search);
      const urlHehang = params.get("hehang") || "";
      const urlMasp = params.get("masp") || "";
      const urlTab = params.get("tab") || "banve";
      const urlBvId = params.get("bvId") || null;

      setHehang(urlHehang);
      setSelectedMasp(urlMasp);
      if (urlTab && ["banve", "govan", "ngukim", "donggoi"].includes(urlTab)) {
        setTab(urlTab as "banve" | "govan" | "ngukim" | "donggoi");
      }
      setSelectedBvId(urlBvId);

      if (urlHehang) {
        if (isDao) {
          void loadBanve(urlHehang);
        } else {
          void loadProducts(urlHehang, false).then((rows) => {
            if (urlMasp) {
              if (rows) {
                setSpInfo(rows.find((p) => p.masp === urlMasp) ?? null);
              }
              void loadBanve(urlMasp);
              if (phanloai === "Bản vẽ đóng gói") {
                void loadDongGoi(urlMasp);
              } else {
                void loadBoms(urlMasp);
              }
            } else {
              setSpInfo(null);
              setBanveRows([]);
              setGovan([]);
              setNgukim([]);
              setDonggoi([]);
            }
          });
        }
      } else {
        setProducts([]);
        setSpInfo(null);
        setBanveRows([]);
        setGovan([]);
        setNgukim([]);
        setDonggoi([]);
      }
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [phanloai, isDao, loadProducts, loadBanve, loadDongGoi, loadBoms]);

  const reloadBanve = useCallback(async () => {
    const keyVal = isDao ? hehang : selectedMasp;
    if (!keyVal) return;
    const queryParam = isDao
      ? `hehang=${encodeURIComponent(keyVal)}`
      : `masp=${encodeURIComponent(keyVal)}`;
    const plParam = isKyThuat
      ? encodeURIComponent(KT_SUB_TYPES.join(","))
      : encodeURIComponent(phanloai);
    const d = await jget<{ rows: BanveRow[] }>(
      `/banvesvc/banve-list?${queryParam}&phanloai=${plParam}`,
    );
    setBanveRows(d.rows ?? []);
  }, [selectedMasp, hehang, phanloai, isDao, isKyThuat]);

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
        const seq1 = `.${ext.toLowerCase()}`;
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
        void dialog.alert(`Lỗi: ${(err as Error).message}`);
      } finally {
        setUpdatingFileId(null);
        setTargetBvId(null);
      }
    },
    [targetBvId, phanloai, reloadBanve],
  );

  // Handler cho slot upload (trang Bản vẽ kỹ thuật — 3 slot)
  const handleSlotFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const f = e.target.files?.[0];
      if (!f) return;
      const { subType, existingId } = slotActionRef.current;
      setSlotUploading(subType);
      try {
        const fd = new FormData();
        fd.append("file", f);
        // Lấy thư mục tương ứng với loại bản vẽ
        const sub = subType === "Bản vẽ đóng gói" ? "dong-goi" : "ky-thuat";
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
        const seq1 = `.${ext.toLowerCase()}`;
        const seq2 = f.name.replace(/\.[^.]+$/, "");

        if (existingId) {
          // Cập nhật file cho bản vẽ đã có
          const updateRes = await fetch("/banvesvc/banve-update", {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: existingId, filepath, seq1, seq2 }),
          });
          if (!updateRes.ok) {
            void dialog.alert("Lỗi cập nhật bản vẽ");
            return;
          }
        } else {
          // Tạo mới bản vẽ cho loại này
          const createRes = await fetch("/banvesvc/banve-create", {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              masp: selectedMasp,
              tensp: spInfo?.tensp ?? "",
              hehang,
              phanloai: subType,
              filepath,
              seq1,
              seq2,
            }),
          });
          if (!createRes.ok) {
            const body = (await createRes.json().catch(() => ({}))) as { error?: string };
            void dialog.alert(body.error ?? "Lỗi tạo bản vẽ");
            return;
          }
        }
        await reloadBanve();
      } catch (err) {
        void dialog.alert(`Lỗi: ${(err as Error).message}`);
      } finally {
        setSlotUploading(null);
        if (slotInputRef.current) slotInputRef.current.value = "";
      }
    },
    [selectedMasp, spInfo, hehang, reloadBanve],
  );

  const productOpts: Opt[] = products.map((p) => ({
    value: p.masp,
    label: p.tensp ? `${p.masp} — ${p.tensp}` : p.masp,
  }));

  const hasSelection = isDao ? !!hehang : !!selectedMasp;

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
                if (v) {
                  if (isDao) {
                    void loadBanve(v);
                  } else {
                    void loadProducts(v, true);
                  }
                } else {
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
          {!isDao && (
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
          )}
          {!isSlotPage && (!isDao || banveRows.length === 0) && (
            <Button
              variant="primary"
              size="sm"
              onClick={() => setShowThem(true)}
              icon={<I.Plus size={12} />}
              className="shrink-0"
              disabled={isDao && !hehang}
            >
              Thêm
            </Button>
          )}
        </Card>
      </div>

      {/* Empty state */}
      {!hasSelection && (
        <div className="flex-1 flex items-center justify-center">
          <EmptyState
            icon={<I.FileText size={24} />}
            title={isDao ? "Chọn hệ hàng" : "Chọn sản phẩm"}
            hint={
              isDao
                ? "Chọn hệ hàng để xem bản vẽ dao"
                : `Chọn hệ hàng và mã sản phẩm để xem ${phanloai.toLowerCase()}`
            }
          />
        </div>
      )}

      {/* Table & Tabs */}
      {hasSelection && (
        <>
          {!isDao && (
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
          )}

          {tab === "banve" && (
            <>
              {/* === KỸ THUẬT & ĐÓNG GÓI: slot upload === */}
              {isSlotPage ? (
                <div className="flex-1 overflow-y-auto p-4">
                  {loadingDetail ? (
                    <div className="h-full flex items-center justify-center py-10">
                      <I.Loader size={20} className="animate-spin text-accent" />
                    </div>
                  ) : (
                    (() => {
                      const subtypesToRender = isKyThuat ? KT_SUB_TYPES : [phanloai];
                      return (
                        <div className="max-w-md mx-auto space-y-2 py-0.5">
                          {subtypesToRender.map((st) => {
                            const slotBv = banveRows.find((r) => r.phanloai === st);
                            const isUploading = slotUploading === st;
                            const activeLabel = isKyThuat
                              ? KT_SUB_LABELS[st as KtSubType]
                              : phanloai;
                            const active = slotBv && selectedBvId === slotBv.id;
                            return (
                              <div key={st} className="space-y-1">
                                <div className="text-[10px] text-muted/80 font-bold uppercase tracking-wider px-1">
                                  {activeLabel}
                                </div>

                                {slotBv ? (
                                  /* Card hiển thị file đã có (ngang rút gọn) */
                                  <Card
                                    className={`p-1.5 flex items-center justify-between gap-2.5 hover:bg-hover/10 cursor-pointer transition-all ${
                                      active ? "shadow-sm" : ""
                                    }`}
                                    style={
                                      active
                                        ? {
                                            background: "hsl(var(--accent) / 0.12)",
                                            borderColor: "hsl(var(--accent) / 0.45)",
                                          }
                                        : undefined
                                    }
                                    onClick={() => setSelectedBvId(active ? null : slotBv.id)}
                                  >
                                    <div className="flex items-center gap-2 flex-1 min-w-0">
                                      <div className="w-7 h-7 rounded bg-accent/15 flex items-center justify-center shrink-0">
                                        <I.FileText size={13} className="text-accent" />
                                      </div>
                                      <div className="flex-1 min-w-0">
                                        <p
                                          className="text-xs font-semibold truncate text-text"
                                          title={slotBv.seq2 || "Bản vẽ"}
                                        >
                                          {slotBv.seq2 || "Bản vẽ"}
                                        </p>
                                        <p className="text-[9px] text-muted truncate mt-0.5">
                                          {slotBv.seq1 || ""}
                                          {slotBv.create_date ? ` · ${slotBv.create_date}` : ""}
                                        </p>
                                      </div>
                                    </div>

                                    {/* Actions */}
                                    <div
                                      className="flex items-center gap-0.5 shrink-0"
                                      onClick={(e) => e.stopPropagation()}
                                    >
                                      <Button
                                        variant="ghost"
                                        size="xs"
                                        icon={
                                          isUploading ? (
                                            <I.Loader
                                              size={10}
                                              className="animate-spin text-muted"
                                            />
                                          ) : (
                                            <I.Upload size={10} />
                                          )
                                        }
                                        onClick={() => {
                                          slotActionRef.current = {
                                            subType: st,
                                            existingId: slotBv.id,
                                          };
                                          setTimeout(() => slotInputRef.current?.click(), 0);
                                        }}
                                        disabled={isUploading}
                                        title="Thay file"
                                        className="w-7 h-7 p-0 flex items-center justify-center rounded-md hover:bg-hover"
                                      />
                                      <Button
                                        variant="ghost"
                                        size="xs"
                                        icon={<I.Download size={10} />}
                                        onClick={() => {
                                          const fileUrl = `/banvesvc/file?id=${encodeURIComponent(slotBv.id)}`;
                                          const link = document.createElement("a");
                                          link.href = fileUrl;
                                          const ext =
                                            (slotBv.filepath || "").split(".").pop() || "pdf";
                                          link.download = `${slotBv.seq2 || st}.${ext}`;
                                          document.body.appendChild(link);
                                          link.click();
                                          document.body.removeChild(link);
                                        }}
                                        title="Tải về"
                                        className="w-7 h-7 p-0 flex items-center justify-center rounded-md hover:bg-hover"
                                      />
                                      <Button
                                        variant="ghost"
                                        size="xs"
                                        icon={<I.Trash2 size={10} />}
                                        className="w-7 h-7 p-0 flex items-center justify-center rounded-md text-danger/60 hover:text-danger hover:bg-danger/15"
                                        onClick={() => void handleDelete(slotBv.id)}
                                        title="Xóa"
                                      />
                                    </div>
                                  </Card>
                                ) : (
                                  /* Upload zone khi chưa có file (rút gọn) */
                                  <label
                                    className={`flex items-center justify-center gap-1.5 border border-dashed rounded-lg py-1.5 px-2.5 cursor-pointer transition-colors ${
                                      isUploading
                                        ? "border-accent/40 bg-accent/5"
                                        : "border-border hover:border-accent/60 hover:bg-hover/20"
                                    }`}
                                  >
                                    {isUploading ? (
                                      <I.Loader size={11} className="animate-spin text-accent" />
                                    ) : (
                                      <I.Upload size={11} className="text-muted" />
                                    )}
                                    <span className="text-[11px] text-muted font-medium">
                                      {isUploading
                                        ? "Đang tải lên…"
                                        : `Tải lên ${activeLabel.toLowerCase()}`}
                                    </span>
                                    <span className="text-[9px] text-muted/40">
                                      (PDF, DWG, AI...)
                                    </span>
                                    <input
                                      type="file"
                                      className="sr-only"
                                      accept=".pdf,.dwg,.ai,.dxf,.jpg,.png"
                                      disabled={isUploading}
                                      onChange={(e) => {
                                        slotActionRef.current = {
                                          subType: st,
                                          existingId: null,
                                        };
                                        void handleSlotFileChange(e);
                                      }}
                                    />
                                  </label>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      );
                    })()
                  )}
                </div>
              ) : (
                /* === CÁC LOẠI KHÁC: bảng danh sách cũ === */
                <>
                  <div className="shrink-0 border-b border-border bg-panel/30 px-3 py-1.5 flex items-center gap-2">
                    <I.FileText size={13} className="text-accent" />
                    <span className="text-xs font-semibold uppercase tracking-wide">
                      {phanloai}
                    </span>
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
                    {loadingDetail ? (
                      <div className="h-full flex items-center justify-center py-10">
                        <I.Loader size={20} className="animate-spin text-accent" />
                      </div>
                    ) : banveRows.length === 0 ? (
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
                            {isDao ? (
                              <>
                                <th className="text-left font-medium px-3 py-2 w-32 shrink-0">
                                  Hệ hàng
                                </th>
                                <th className="text-left font-medium px-3 py-2 w-28 shrink-0">
                                  Ngày tạo
                                </th>
                                <th className="text-left font-medium px-3 py-2 w-28 shrink-0">
                                  Người tạo
                                </th>
                                <th className="text-left font-medium px-3 py-2 w-28 shrink-0">
                                  Ngày sửa
                                </th>
                                <th className="text-left font-medium px-3 py-2 w-28 shrink-0">
                                  Người sửa
                                </th>
                              </>
                            ) : (
                              <>
                                <th className="text-left font-medium px-3 py-2 min-w-0">
                                  Tên file
                                </th>
                                <th className="text-left font-medium px-3 py-2 w-24 shrink-0">
                                  Định dạng
                                </th>
                                <th className="text-left font-medium px-3 py-2 w-32 shrink-0 hidden sm:table-cell">
                                  Ngày tải
                                </th>
                              </>
                            )}
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
                                {isDao ? (
                                  <>
                                    <td className="px-3 py-2 truncate font-medium w-32 shrink-0">
                                      {bv.hehang ?? ""}
                                    </td>
                                    <td className="px-3 py-2 text-muted text-xs truncate w-28 shrink-0">
                                      {bv.create_date ?? "—"}
                                    </td>
                                    <td className="px-3 py-2 text-muted text-xs truncate w-28 shrink-0">
                                      {bv.create_by ?? "—"}
                                    </td>
                                    <td className="px-3 py-2 text-muted text-xs truncate w-28 shrink-0">
                                      {bv.update_by ? (bv.update_date ?? "—") : "—"}
                                    </td>
                                    <td className="px-3 py-2 text-muted text-xs truncate w-28 shrink-0">
                                      {bv.update_by ?? "—"}
                                    </td>
                                  </>
                                ) : (
                                  <>
                                    <td
                                      className="px-3 py-2 truncate font-medium min-w-0"
                                      title={bv.seq2 ?? ""}
                                    >
                                      {bv.seq2 ?? ""}
                                    </td>
                                    <td className="px-3 py-2 text-muted text-xs truncate w-24 shrink-0">
                                      {bv.seq1 ? (
                                        bv.seq1.startsWith(".") ? (
                                          bv.seq1.toLowerCase()
                                        ) : (
                                          `.${bv.seq1.toLowerCase()}`
                                        )
                                      ) : (
                                        <span className="italic opacity-50">—</span>
                                      )}
                                    </td>
                                    <td className="px-3 py-2 text-muted text-xs truncate w-32 shrink-0 hidden sm:table-cell">
                                      {bv.create_date ?? "—"}
                                    </td>
                                  </>
                                )}
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
                {loadingBoms ? (
                  <div className="h-full flex items-center justify-center py-10">
                    <I.Loader size={20} className="animate-spin text-accent" />
                  </div>
                ) : (
                  <GoVanGrid rows={govan} />
                )}
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
                {loadingBoms ? (
                  <div className="h-full flex items-center justify-center py-10">
                    <I.Loader size={20} className="animate-spin text-accent" />
                  </div>
                ) : (
                  <NguKimGrid rows={ngukim} />
                )}
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
                {loadingDongGoi ? (
                  <div className="h-full flex items-center justify-center py-10">
                    <I.Loader size={20} className="animate-spin text-accent" />
                  </div>
                ) : (
                  <DongGoiGrid rows={donggoi} masp={selectedMasp} mausac={donggoiMausac} />
                )}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );

  /* ── Right panel: PDF viewer ── */
  const rightPanel = loadingDetail ? (
    <div className="h-full flex items-center justify-center">
      <I.Loader size={28} className="animate-spin text-accent" />
    </div>
  ) : selectedBv?.filepath ? (
    <div className="flex flex-col h-full">
      <div className="shrink-0 border-b border-border bg-panel/50 px-3 py-2 flex items-center gap-2">
        <I.FileText size={13} className="text-accent" />
        <span className="text-xs font-semibold flex-1 truncate min-w-0">
          {selectedBv.seq2 || phanloai}
          {isDao
            ? ` (${hehang})`
            : spInfo?.tensp
              ? ` (${selectedMasp} — ${spInfo.tensp})`
              : ` (${selectedMasp})`}
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
        title={
          hasSelection ? "Chọn bản vẽ để xem" : isDao ? "Chưa chọn hệ hàng" : "Chưa có sản phẩm"
        }
        hint={
          hasSelection
            ? "Click vào một bản vẽ ở danh sách bên trái"
            : isDao
              ? "Chọn hệ hàng trước"
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
      {/* Hidden input for slot uploads (trang kỹ thuật) */}
      <input
        type="file"
        ref={slotInputRef}
        onChange={handleSlotFileChange}
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
