/* BanVeTypePage — component chung cho 6 trang bản vẽ theo loại.
   Nhận prop `phanloai` (vd "Bản vẽ kỹ thuật") để lọc + tạo đúng loại.
   Layout: filter bar → file table → PDF viewer inline.
   Định mức ngũ kim / gỗ ván được tách ra trang riêng (/dinh-muc/...). */

import { useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { I } from "@/components/Icons";
import { Modal, SearchableSelect } from "@/components/ui";

/* ── Types ── */
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

/* ── Helpers ── */
async function jget<T = unknown>(url: string): Promise<T> {
  const r = await fetch(url, { credentials: "include" });
  return (await r.json().catch(() => ({}))) as T;
}

/* ── Modal thêm bản vẽ ── */
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
        <div className="flex gap-2 justify-end w-full">
          <button type="button" className="btn btn-default px-4 py-1.5 text-sm" onClick={onClose}>
            Hủy
          </button>
          <button
            type="button"
            disabled={uploading}
            className="btn btn-primary px-4 py-1.5 text-sm disabled:opacity-60 flex items-center gap-1.5"
            onClick={handleSubmit}
          >
            {uploading && <I.Loader size={13} className="animate-spin" />}
            Lưu
          </button>
        </div>
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
              const sp = products.find((p) => p.masp === v) ?? null;
              setSpInfo(sp);
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

/* ── Main component ── */
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

  return (
    <div className="min-h-screen flex flex-col bg-bg text-text">
      {/* ── Header standalone ── */}
      <div className="sticky top-0 z-10 bg-panel border-b border-border px-3 py-2.5 flex items-center gap-2 shrink-0">
        <button
          type="button"
          onClick={() => void navigate({ to: "/banve" })}
          className="-ml-1 p-1 rounded hover:bg-hover text-muted shrink-0"
          aria-label="Quay lại"
        >
          <I.ChevronLeft size={20} />
        </button>
        <I.FileText size={16} className="text-accent shrink-0" />
        <h1 className="font-semibold text-sm flex-1 truncate">{phanloai}</h1>
      </div>

      {/* ── Filter bar ── */}
      <div className="shrink-0 border-b border-border bg-panel px-4 py-3">
        <div className="flex flex-wrap gap-3 items-end max-w-5xl">
          <div className="flex-1 min-w-40">
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
                  setSpInfo(null);
                  setBanveRows([]);
                  setSelectedBvId(null);
                }
              }}
              options={hehangs}
              placeholder="Chọn hệ hàng…"
            />
          </div>

          <div className="flex-[2] min-w-56">
            <label className="block text-xs text-muted mb-1">
              Mã sản phẩm
              {products.length > 0 && (
                <span className="ml-1 text-accent font-medium">({products.length})</span>
              )}
            </label>
            <SearchableSelect
              className="w-full"
              value={selectedMasp}
              onChange={(v) => {
                setSelectedMasp(v);
                const sp = products.find((p) => p.masp === v) ?? null;
                setSpInfo(sp);
                if (v) void loadBanve(v);
              }}
              options={productOpts}
              placeholder={
                !hehang
                  ? "Chọn hệ hàng trước"
                  : loadingProd
                    ? "Đang tải…"
                    : products.length === 0
                      ? "Không có sản phẩm"
                      : "Chọn mã sản phẩm…"
              }
            />
          </div>

          {spInfo?.tensp && (
            <div className="flex flex-wrap gap-3 text-xs text-muted py-1">
              <span>
                Tên: <span className="text-text font-medium">{spInfo.tensp}</span>
              </span>
              {spInfo.hehang && (
                <span>
                  HH: <span className="text-text font-medium">{spInfo.hehang}</span>
                </span>
              )}
            </div>
          )}

          <button
            type="button"
            onClick={() => setShowThem(true)}
            className="btn btn-primary px-3 py-1.5 text-xs flex items-center gap-1.5 shrink-0"
          >
            <I.Plus size={13} />
            Thêm
          </button>
        </div>
      </div>

      {/* ── Empty state ── */}
      {!selectedMasp && (
        <div className="flex-1 flex items-center justify-center text-muted text-sm">
          <div className="text-center space-y-2">
            <I.FileText size={40} className="mx-auto opacity-30" />
            <p>Chọn hệ hàng và mã sản phẩm để xem {phanloai.toLowerCase()}</p>
          </div>
        </div>
      )}

      {/* ── Danh sách + PDF viewer ── */}
      {selectedMasp && (
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
          {/* File table */}
          <div className="border-b border-border shrink-0">
            <div className="px-4 py-2 bg-panel/50 flex items-center gap-2">
              <I.FileText size={14} className="text-accent" />
              <span className="text-xs font-semibold text-text uppercase tracking-wide">
                {phanloai}
              </span>
              {banveRows.length > 0 && (
                <span className="text-xs text-muted ml-1">({banveRows.length})</span>
              )}
              {loadingDetail && <I.Loader size={12} className="animate-spin text-muted ml-1" />}
            </div>

            {banveRows.length === 0 && !loadingDetail ? (
              <div className="px-4 py-3 text-xs text-muted flex items-center gap-2">
                <I.FileX size={14} className="opacity-50" />
                Chưa có {phanloai.toLowerCase()} cho sản phẩm này
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-bg-soft border-b border-border">
                    <tr>
                      <th className="text-left px-3 py-1.5 text-muted font-medium w-8">#</th>
                      <th className="text-left px-3 py-1.5 text-muted font-medium">Tên file</th>
                      <th className="text-left px-3 py-1.5 text-muted font-medium">Định dạng</th>
                      <th className="text-left px-3 py-1.5 text-muted font-medium">Ngày tải</th>
                      <th className="text-left px-3 py-1.5 text-muted font-medium">Ngày sửa</th>
                      <th className="px-3 py-1.5 text-right text-muted font-medium w-20" />
                    </tr>
                  </thead>
                  <tbody>
                    {banveRows.map((bv, i) => {
                      const active = selectedBvId === bv.id;
                      return (
                        <tr
                          key={bv.id}
                          className={`border-b border-border/50 cursor-pointer transition-colors ${active ? "bg-accent/10" : "hover:bg-hover"}`}
                          onClick={() => setSelectedBvId(active ? null : bv.id)}
                        >
                          <td className="px-3 py-1.5 text-muted">{i + 1}</td>
                          <td className="px-3 py-1.5 max-w-48 truncate">{bv.seq2 ?? ""}</td>
                          <td className="px-3 py-1.5 text-muted">{bv.seq1 ?? ""}</td>
                          <td className="px-3 py-1.5 text-muted">{bv.create_date ?? ""}</td>
                          <td className="px-3 py-1.5 text-muted">{bv.update_date ?? ""}</td>
                          <td className="px-3 py-1.5 text-right">
                            <div className="flex gap-1 justify-end">
                              <a
                                href={`/banvesvc/file?id=${encodeURIComponent(bv.id)}`}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-0.5 text-accent border border-accent/40 rounded px-1.5 py-0.5 hover:bg-accent/10 text-[11px]"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <I.ExternalLink size={10} />
                                Mở
                              </a>
                              <button
                                type="button"
                                className="inline-flex items-center text-danger border border-danger/40 rounded px-1.5 py-0.5 hover:bg-danger/10 text-[11px]"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void handleDelete(bv.id);
                                }}
                              >
                                <I.Trash2 size={10} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* PDF viewer */}
          {selectedBv?.filepath && (
            <div className="flex-1 flex flex-col min-h-0" style={{ minHeight: "40vh" }}>
              <div className="px-4 py-2 bg-panel/50 border-b border-border flex items-center gap-2 shrink-0">
                <I.FileText size={13} className="text-accent" />
                <span className="text-xs font-semibold text-text flex-1 truncate min-w-0">
                  {selectedBv.seq2 || phanloai}
                </span>
                <a
                  href={`/banvesvc/file?id=${encodeURIComponent(selectedBv.id)}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-accent border border-accent/40 rounded px-2 py-0.5 hover:bg-accent/10 shrink-0"
                >
                  <I.ExternalLink size={11} />
                  Mở tab
                </a>
                <button
                  type="button"
                  onClick={() => setSelectedBvId(null)}
                  className="p-1 rounded hover:bg-hover text-muted shrink-0"
                  aria-label="Đóng xem"
                >
                  <I.X size={14} />
                </button>
              </div>
              <iframe
                key={selectedBv.id}
                src={`/banvesvc/file?id=${encodeURIComponent(selectedBv.id)}`}
                title={phanloai}
                className="flex-1 w-full bg-white"
                sandbox="allow-scripts allow-same-origin allow-popups allow-forms allow-downloads"
              />
            </div>
          )}

          {!selectedBv && banveRows.length > 0 && (
            <div className="shrink-0 px-4 py-3 text-xs text-muted flex items-center gap-2 border-t border-border bg-panel/30">
              <I.MousePointerClick size={13} className="opacity-50" />
              Click vào một bản vẽ để xem PDF
            </div>
          )}
        </div>
      )}

      {showThem && (
        <ThemModal
          hehangs={hehangs}
          phanloai={phanloai}
          onClose={() => setShowThem(false)}
          onSuccess={() => {
            void reloadBanve();
          }}
        />
      )}
    </div>
  );
}
