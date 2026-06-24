import { useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
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

function buildPdfJsViewerUrl(fileUrl: string): string | null {
  if (!fileUrl) return null;
  const base =
    (import.meta.env.VITE_PDFJS_BASE as string | undefined) ?? "https://view.dongquochung.com:4432";
  const abs = fileUrl.startsWith("http") ? fileUrl : window.location.origin + fileUrl;
  return `${base.replace(/\/+$/, "")}/web/viewer.html?file=${encodeURIComponent(abs)}`;
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
  onClose,
  onSuccess,
}: {
  hehangs: Opt[];
  phanloai: string;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [hehang, setHehang] = useState("");
  const [products, setProducts] = useState<SpRow[]>([]);
  const [masp, setMasp] = useState("");
  const [spInfo, setSpInfo] = useState<SpRow | null>(null);
  const [seq1, setSeq1] = useState("");
  const [seq2, setSeq2] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState("");

  const loadProducts = useCallback(async (hh: string) => {
    if (!hh) {
      setProducts([]);
      return;
    }
    const d = await jget<{ rows: SpRow[] }>(
      `/banvesvc/sanpham-by-hehang?hehang=${encodeURIComponent(hh)}`,
    );
    setProducts(d.rows ?? []);
  }, []);

  const productOpts: Opt[] = products.map((p) => ({
    value: p.masp,
    label: p.tensp ? `${p.masp} — ${p.tensp}` : p.masp,
  }));

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] ?? null;
    setFile(f);
    if (f && !seq2) setSeq2(f.name.replace(/\.[^.]+$/, ""));
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
      const upRes = await fetch("/upload/file", {
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
              void loadProducts(v);
            }}
            options={hehangs}
            placeholder="Chọn hệ hàng…"
          />
        </div>
        <div>
          <label className="block text-xs text-muted mb-1">Mã sản phẩm</label>
          <SearchableSelect
            className="w-full"
            value={masp}
            onChange={(v) => {
              setMasp(v);
              setSpInfo(products.find((p) => p.masp === v) ?? null);
            }}
            options={productOpts}
            placeholder={
              !hehang ? "Chọn hệ hàng trước" : products.length === 0 ? "Không có SP" : "Chọn mã SP…"
            }
          />
        </div>
        {spInfo?.tensp && (
          <div>
            <label className="block text-xs text-muted mb-1">Tên sản phẩm</label>
            <input
              className="input w-full text-sm bg-bg-soft text-muted cursor-default"
              readOnly
              value={spInfo.tensp}
            />
          </div>
        )}
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-xs text-muted mb-1">Định dạng</label>
            <input
              className="input w-full text-sm"
              placeholder="vd: PDF, DWG, AI…"
              value={seq1}
              onChange={(e) => setSeq1(e.target.value)}
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
  const navigate = useNavigate();
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

  useEffect(() => {
    jget<{ rows: string[] }>("/banvesvc/hehang").then((d) => {
      setHehangs((d.rows ?? []).map((h) => ({ value: h, label: h })));
    });
  }, []);

  const loadProducts = useCallback(async (hh: string) => {
    setLoadingProd(true);
    setProducts([]);
    setSelectedMasp("");
    setSpInfo(null);
    setBanveRows([]);
    setSelectedBvId(null);
    try {
      const d = await jget<{ rows: SpRow[] }>(
        `/banvesvc/sanpham-by-hehang?hehang=${encodeURIComponent(hh)}`,
      );
      setProducts(d.rows ?? []);
    } finally {
      setLoadingProd(false);
    }
  }, []);

  const loadBanve = useCallback(
    async (masp: string) => {
      if (!masp) return;
      setBanveRows([]);
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

  const reloadBanve = useCallback(async () => {
    if (!selectedMasp) return;
    const d = await jget<{ rows: BanveRow[] }>(
      `/banvesvc/banve-list?masp=${encodeURIComponent(selectedMasp)}&phanloai=${encodeURIComponent(phanloai)}`,
    );
    setBanveRows(d.rows ?? []);
  }, [selectedMasp, phanloai]);

  const handleDelete = useCallback(
    async (id: string) => {
      if (!confirm("Xóa bản vẽ này?")) return;
      await fetch(`/banvesvc/banve-delete?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (selectedBvId === id) setSelectedBvId(null);
      void reloadBanve();
    },
    [selectedBvId, reloadBanve],
  );

  const productOpts: Opt[] = products.map((p) => ({
    value: p.masp,
    label: p.tensp ? `${p.masp} — ${p.tensp}` : p.masp,
  }));

  const selectedBv = banveRows.find((r) => r.id === selectedBvId);
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
                if (v) void loadProducts(v);
                else {
                  setProducts([]);
                  setSelectedMasp("");
                  setSpInfo(null);
                  setBanveRows([]);
                  setSelectedBvId(null);
                }
              }}
              options={hehangs}
              placeholder="Chọn hệ hàng…"
            />
          </div>
          <div className="min-w-44 flex-[2]">
            <label className="block text-xs text-muted mb-0.5">
              Mã sản phẩm
              {products.length > 0 && (
                <Chip variant="accent" className="ml-1 text-[10px]">
                  {products.length}
                </Chip>
              )}
            </label>
            <SearchableSelect
              className="w-full"
              triggerClassName="h-8! text-xs!"
              value={selectedMasp}
              onChange={(v) => {
                setSelectedMasp(v);
                setSpInfo(products.find((p) => p.masp === v) ?? null);
                if (v) void loadBanve(v);
              }}
              options={productOpts}
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

      {/* Product info bar */}
      {spInfo?.tensp && (
        <div className="shrink-0 border-b border-border bg-accent/5 px-3 py-1.5 flex items-center gap-2 text-xs">
          <I.Package size={13} className="text-accent shrink-0" />
          <span className="font-medium text-text">{selectedMasp}</span>
          <span className="text-muted truncate">{spInfo.tensp}</span>
          {spInfo.hehang && <Chip className="text-[10px] ml-auto">{spInfo.hehang}</Chip>}
        </div>
      )}

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

      {/* Table */}
      {hasSelection && (
        <>
          <div className="shrink-0 border-b border-border bg-panel/30 px-3 py-1.5 flex items-center gap-2">
            <I.FileText size={13} className="text-accent" />
            <span className="text-xs font-semibold uppercase tracking-wide">{phanloai}</span>
            {loadingDetail ? (
              <I.Loader size={11} className="animate-spin text-muted" />
            ) : (
              <Chip variant="accent" className="text-[10px]">
                {banveRows.length}
              </Chip>
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
              <table className="w-full text-sm">
                <thead className="bg-bg-soft text-xs text-muted sticky top-0">
                  <tr>
                    <th className="text-left font-medium px-3 py-2 w-6">#</th>
                    <th className="text-left font-medium px-3 py-2">Tên file</th>
                    <th className="text-left font-medium px-3 py-2">Định dạng</th>
                    <th className="text-left font-medium px-3 py-2 hidden sm:table-cell">
                      Ngày tải
                    </th>
                    <th className="px-3 py-2 text-right w-16" />
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
                        <td className="px-3 py-2 text-muted text-xs">{i + 1}</td>
                        <td className="px-3 py-2 max-w-36 truncate font-medium">{bv.seq2 ?? ""}</td>
                        <td className="px-3 py-2 text-muted text-xs">
                          {bv.seq1 ?? <span className="italic opacity-50">—</span>}
                        </td>
                        <td className="px-3 py-2 text-muted text-xs hidden sm:table-cell">
                          {bv.create_date ?? "—"}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <Button
                            variant="ghost"
                            size="xs"
                            icon={<I.Trash2 size={11} />}
                            className="text-danger/60 hover:text-danger hover:bg-danger/15"
                            onClick={(e) => {
                              e.stopPropagation();
                              void handleDelete(bv.id);
                            }}
                          />
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
    </div>
  );

  /* ── Right panel: PDF viewer ── */
  const rightPanel = selectedBv?.filepath ? (
    <div className="flex flex-col h-full">
      <div className="shrink-0 border-b border-border bg-panel/50 px-3 py-2 flex items-center gap-2">
        <I.FileText size={13} className="text-accent" />
        <span className="text-xs font-semibold flex-1 truncate min-w-0">
          {selectedBv.seq2 || phanloai}
        </span>
        <Button
          variant="ghost"
          size="xs"
          icon={<I.ExternalLink size={11} />}
          onClick={() => {
            const fileUrl =
              selectedBv.filepath ?? `/banvesvc/file?id=${encodeURIComponent(selectedBv.id)}`;
            window.open(buildPdfJsViewerUrl(fileUrl) ?? fileUrl, "_blank");
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
      {/* Header */}
      <div className="sticky top-0 z-10 bg-panel border-b border-border px-4 py-2.5 flex items-center gap-2 shrink-0">
        <button
          type="button"
          onClick={() => void navigate({ to: "/ban-ve" })}
          className="-ml-1 p-1 rounded hover:bg-hover text-muted shrink-0"
          aria-label="Quay lại"
        >
          <I.ChevronLeft size={20} />
        </button>
        <I.FileText size={16} className="text-accent shrink-0" />
        <h1 className="font-semibold text-sm flex-1 truncate">{phanloai}</h1>
      </div>

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
          onClose={() => setShowThem(false)}
          onSuccess={() => void reloadBanve()}
        />
      )}
    </div>
  );
}
