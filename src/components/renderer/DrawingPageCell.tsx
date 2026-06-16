/* ==========================================================
   DrawingPageCell — ô "Bản vẽ" trong lưới định mức: hiển thị THUMBNAIL trang
   bản vẽ kỹ thuật (PDF) đã gán cho chi tiết + nút "Gán trang" mở modal chọn.

   - PDF kỹ thuật của sản phẩm: 1 file/masp (tr_banve phanloai 'Bản vẽ kỹ thuật'),
     lấy URL qua /banvesvc/product → /banvesvc/file?id=.
   - Modal: tự gợi ý trang khớp MÃ CHI TIẾT (text PDF) + cho lật/nhập trang tay.
   - pdfjs nặng → import ĐỘNG (@/lib/pdf) để vào chunk lazy.
   ========================================================== */
import { useEffect, useRef, useState } from "react";
import { I } from "@/components/Icons";
import { Modal } from "@/components/ui";
import { cn } from "@/lib/utils";

// masp → URL PDF kỹ thuật (cache; lưới nhiều dòng cùng sản phẩm).
const urlCache = new Map<string, Promise<string | null>>();
function resolveProductPdfUrl(masp: string): Promise<string | null> {
  let p = urlCache.get(masp);
  if (!p) {
    p = (async () => {
      try {
        const res = await fetch(`/banvesvc/product?masp=${encodeURIComponent(masp)}`, {
          credentials: "include",
        });
        if (!res.ok) return null;
        const data = (await res.json()) as { banve?: Array<{ id: string; phanloai?: string }> };
        const bv = (data.banve ?? []).find((b) => /kỹ thuật/i.test(b.phanloai ?? ""));
        return bv ? `/banvesvc/file?id=${encodeURIComponent(bv.id)}` : null;
      } catch {
        return null;
      }
    })();
    urlCache.set(masp, p);
  }
  return p;
}

interface CellProps {
  masp: string;
  mact: string;
  page: string;
  canWrite: boolean;
  onCommit: (value: string) => void;
}

/** Ô lưới: thumbnail trang đã gán + nút gán/sửa. */
export function DrawingPageCell({ masp, mact, page, canWrite, onCommit }: CellProps) {
  const [thumb, setThumb] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const pageNum = Number(page) || 0;

  useEffect(() => {
    if (!pageNum || !masp) {
      setThumb(null);
      return;
    }
    let alive = true;
    (async () => {
      const url = await resolveProductPdfUrl(masp);
      if (!url || !alive) return;
      const pdfMod = await import("@/lib/pdf");
      const pdf = await pdfMod.loadPdf(url);
      if (pageNum > pdf.numPages) return;
      const dataUrl = await pdfMod.renderPageToDataUrl(pdf, pageNum, 160);
      if (alive) setThumb(dataUrl);
    })().catch(() => {});
    return () => {
      alive = false;
    };
  }, [masp, pageNum]);

  return (
    <div className="flex items-center gap-1.5">
      {pageNum > 0 ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setOpen(true);
          }}
          title={`Bản vẽ trang ${pageNum} — bấm để xem/đổi`}
          className="shrink-0"
        >
          {thumb ? (
            <img
              src={thumb}
              alt={`Trang ${pageNum}`}
              className="h-12 w-auto max-w-[88px] rounded border border-border object-contain bg-white"
            />
          ) : (
            <span className="inline-flex h-12 w-16 items-center justify-center rounded border border-border text-[10px] text-muted">
              tr.{pageNum}…
            </span>
          )}
        </button>
      ) : (
        <span className="text-muted text-xs">—</span>
      )}
      {canWrite && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setOpen(true);
          }}
          className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[11px] text-accent hover:bg-accent/10"
          title="Gán trang bản vẽ cho chi tiết này"
        >
          <I.Image size={11} />
          {pageNum > 0 ? "Đổi" : "Gán trang"}
        </button>
      )}
      {open && (
        <AssignDrawingPageModal
          masp={masp}
          mact={mact}
          currentPage={pageNum}
          onSave={(p) => {
            onCommit(p > 0 ? String(p) : "");
            setOpen(false);
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}

interface ModalProps {
  masp: string;
  mact: string;
  currentPage: number;
  onSave: (page: number) => void;
  onClose: () => void;
}

function AssignDrawingPageModal({ masp, mact, currentPage, onSave, onClose }: ModalProps) {
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [err, setErr] = useState("");
  const [numPages, setNumPages] = useState(0);
  const [page, setPage] = useState(currentPage > 0 ? currentPage : 1);
  const [suggested, setSuggested] = useState<number | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  // biome-ignore lint/suspicious/noExplicitAny: PDFDocumentProxy của pdfjs (import động)
  const pdfRef = useRef<any>(null);

  // Tải PDF + tự gợi ý trang khớp mã chi tiết.
  // biome-ignore lint/correctness/useExhaustiveDependencies: chỉ chạy 1 lần khi mở
  useEffect(() => {
    let alive = true;
    (async () => {
      const url = await resolveProductPdfUrl(masp);
      if (!alive) return;
      if (!url) {
        setErr("Sản phẩm này chưa có file bản vẽ kỹ thuật.");
        setLoading(false);
        return;
      }
      try {
        const pdfMod = await import("@/lib/pdf");
        const pdf = await pdfMod.loadPdf(url);
        if (!alive) return;
        pdfRef.current = pdf;
        setNumPages(pdf.numPages);
        const texts = await pdfMod.getPageTexts(pdf);
        if (!alive) return;
        const match = pdfMod.findPageByCode(texts, mact);
        setSuggested(match);
        if (currentPage <= 0 && match) setPage(match);
        setLoading(false);
        setLoaded(true);
      } catch (e) {
        if (alive) {
          setErr(`Không đọc được PDF: ${(e as Error).message}`);
          setLoading(false);
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // Render xem trước trang hiện tại (sau khi PDF đã nạp + mỗi khi đổi trang).
  useEffect(() => {
    if (!loaded || !pdfRef.current || page < 1) return;
    let alive = true;
    (async () => {
      const pdfMod = await import("@/lib/pdf");
      const dataUrl = await pdfMod.renderPageToDataUrl(pdfRef.current, page, 640);
      if (alive) setPreview(dataUrl);
    })().catch(() => {});
    return () => {
      alive = false;
    };
  }, [page, loaded]);

  const clamp = (p: number) => Math.max(1, Math.min(numPages || 1, p));

  return (
    <Modal
      open
      onClose={onClose}
      title={`Gán trang bản vẽ — chi tiết ${mact || ""}`}
      width={760}
      footer={
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => onSave(0)}
            className="text-xs text-danger hover:underline"
          >
            Bỏ gán
          </button>
          <div className="flex items-center gap-2">
            <button type="button" onClick={onClose} className="btn-ghost text-sm px-3 py-1.5">
              Huỷ
            </button>
            <button
              type="button"
              disabled={loading || !!err}
              onClick={() => onSave(page)}
              className="btn-primary text-sm px-3 py-1.5 disabled:opacity-50"
            >
              Gán trang {page}
            </button>
          </div>
        </div>
      }
    >
      {loading ? (
        <div className="py-10 text-center text-sm text-muted">Đang tải bản vẽ…</div>
      ) : err ? (
        <div className="py-10 text-center text-sm text-danger">{err}</div>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2 text-xs">
            <button
              type="button"
              onClick={() => setPage((p) => clamp(p - 1))}
              className="rounded border border-border px-2 py-1 hover:bg-hover"
            >
              ‹ Trước
            </button>
            <span>
              Trang
              <input
                type="number"
                min={1}
                max={numPages}
                value={page}
                onChange={(e) => setPage(clamp(Number(e.target.value)))}
                className="input mx-1 w-16 px-1.5 py-0.5 text-center"
              />
              / {numPages}
            </span>
            <button
              type="button"
              onClick={() => setPage((p) => clamp(p + 1))}
              className="rounded border border-border px-2 py-1 hover:bg-hover"
            >
              Sau ›
            </button>
            {suggested ? (
              <button
                type="button"
                onClick={() => setPage(suggested)}
                className={cn(
                  "ml-auto rounded px-2 py-1",
                  page === suggested
                    ? "bg-success/15 text-success"
                    : "bg-accent/10 text-accent hover:bg-accent/20",
                )}
                title="Trang khớp mã chi tiết trong text PDF"
              >
                ✨ Gợi ý: trang {suggested}
                {page === suggested ? " ✓" : ""}
              </button>
            ) : (
              <span className="ml-auto text-muted">Không tự tìm thấy trang khớp mã — chọn tay</span>
            )}
          </div>
          <div className="flex max-h-[60vh] items-center justify-center overflow-auto rounded border border-border bg-bg-soft p-2">
            {preview ? (
              <img src={preview} alt={`Trang ${page}`} className="max-w-full bg-white shadow" />
            ) : (
              <span className="py-10 text-sm text-muted">Đang render trang…</span>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
