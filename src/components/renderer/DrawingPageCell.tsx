/* ==========================================================
   DrawingPageCell — ô "Bản vẽ" trong lưới định mức: thumbnail trang bản vẽ kỹ
   thuật (PDF) đã gán cho chi tiết + tự nhận diện trang + cảnh báo lệch.

   - SP CHƯA có PDF kỹ thuật → ô báo "Chưa có bản vẽ".
   - Ô TRỐNG + có PDF → tự gợi ý trang khớp (mã + tên + kích thước) → "✓ Dùng".
   - Ô ĐÃ gán → thumbnail; nếu trang gán không khớp chi tiết mà có trang khác
     khớp hơn → cảnh báo "⚠ Lệch".
   - Modal "Gán trang": auto gợi ý + nút "Tự nhận diện lại" + lật/nhập trang tay.
   - pdfjs nặng → import ĐỘNG (@/lib/pdf) để vào chunk lazy.
   ========================================================== */
import { type ReactNode, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { I } from "@/components/Icons";
import { Modal } from "@/components/ui";
import {
  type DetailInfo,
  findBestPage,
  MATCH_CONFIDENT,
  scorePageForDetail,
} from "@/lib/pdf-match";
import { cn } from "@/lib/utils";

// masp → URL PDF kỹ thuật (cache).
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
        // raw=1: server proxy bytes PDF thô (pdfjs không đọc được viewer HTML khi
        // prod chưa mount BANVE_FILES_DIR → /banvesvc/file 302 sang viewer).
        return bv ? `/banvesvc/file?id=${encodeURIComponent(bv.id)}&raw=1` : null;
      } catch {
        return null;
      }
    })();
    urlCache.set(masp, p);
  }
  return p;
}

// masp → {url, texts} PDF (cache; lưới nhiều dòng chung 1 PDF → load + trích text 1 lần).
const dataCache = new Map<string, Promise<{ url: string; texts: string[] } | null>>();
function getProductPdf(masp: string): Promise<{ url: string; texts: string[] } | null> {
  let p = dataCache.get(masp);
  if (!p) {
    p = (async () => {
      const url = await resolveProductPdfUrl(masp);
      if (!url) return null;
      const pdfMod = await import("@/lib/pdf");
      const pdf = await pdfMod.loadPdf(url);
      const texts = await pdfMod.getPageTexts(pdf);
      return { url, texts };
    })();
    dataCache.set(masp, p);
  }
  return p;
}

interface CellProps {
  masp: string;
  detail: DetailInfo;
  page: string;
  canWrite: boolean;
  onCommit: (value: string) => void;
}

export function DrawingPageCell({ masp, detail, page, canWrite, onCommit }: CellProps) {
  const assigned = Number(page) || 0;
  const [status, setStatus] = useState<"loading" | "nopdf" | "ready">("loading");
  const [texts, setTexts] = useState<string[]>([]);
  const [thumb, setThumb] = useState<string | null>(null);
  const [suggest, setSuggest] = useState<number | null>(null); // gợi ý cho ô trống
  const [mismatch, setMismatch] = useState<number | null>(null); // trang khớp hơn (lệch)
  const [open, setOpen] = useState(false);
  const detailKey = JSON.stringify(detail);

  // Tải PDF + trích text (cache) → xác định trạng thái.
  useEffect(() => {
    if (!masp) {
      setStatus("nopdf");
      return;
    }
    let alive = true;
    setStatus("loading");
    getProductPdf(masp)
      .then((data) => {
        if (!alive) return;
        if (!data) setStatus("nopdf");
        else {
          setTexts(data.texts);
          setStatus("ready");
        }
      })
      .catch(() => alive && setStatus("nopdf"));
    return () => {
      alive = false;
    };
  }, [masp]);

  // Sẵn sàng: ô trống → gợi ý; ô có trang → render thumbnail + kiểm lệch.
  // biome-ignore lint/correctness/useExhaustiveDependencies: detail bám theo detailKey
  useEffect(() => {
    if (status !== "ready" || texts.length === 0) return;
    let alive = true;
    (async () => {
      const best = findBestPage(texts, detail);
      if (assigned > 0) {
        setSuggest(null);
        const data = await getProductPdf(masp);
        if (data && assigned <= texts.length) {
          const pdfMod = await import("@/lib/pdf");
          const pdf = await pdfMod.loadPdf(data.url);
          const dataUrl = await pdfMod.renderPageToDataUrl(pdf, assigned, 260);
          if (alive) setThumb(dataUrl);
        }
        const aScore = scorePageForDetail(texts[assigned - 1] ?? "", detail);
        if (alive) {
          setMismatch(
            aScore < MATCH_CONFIDENT && best.score >= MATCH_CONFIDENT && best.page !== assigned
              ? best.page
              : null,
          );
        }
      } else if (alive) {
        setThumb(null);
        setMismatch(null);
        setSuggest(best.score >= MATCH_CONFIDENT ? best.page : null);
      }
    })().catch(() => {});
    return () => {
      alive = false;
    };
  }, [status, texts, assigned, detailKey, masp]);

  if (status === "loading") return <span className="text-muted text-[11px]">…</span>;
  if (status === "nopdf") {
    return (
      <span
        className="text-warning/80 text-[11px] italic"
        title="Sản phẩm chưa có file bản vẽ kỹ thuật"
      >
        Chưa có bản vẽ
      </span>
    );
  }

  return (
    <div className="flex items-center gap-1.5">
      {assigned > 0 ? (
        <>
          <HoverPreview masp={masp} pageNum={assigned} className="inline-flex shrink-0">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setOpen(true);
              }}
              title={`Bản vẽ trang ${assigned} — rê chuột để xem, bấm để đổi`}
              className="shrink-0"
            >
              {thumb ? (
                <img
                  src={thumb}
                  alt={`Trang ${assigned}`}
                  className={cn(
                    "h-12 w-auto max-w-[88px] rounded border object-contain bg-white",
                    mismatch ? "border-warning ring-1 ring-warning" : "border-border",
                  )}
                />
              ) : (
                <span className="inline-flex h-12 w-16 items-center justify-center rounded border border-border text-[10px] text-muted">
                  tr.{assigned}…
                </span>
              )}
            </button>
          </HoverPreview>
          {mismatch && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                canWrite ? onCommit(String(mismatch)) : setOpen(true);
              }}
              title={`Trang ${assigned} có thể không đúng chi tiết — khớp hơn ở trang ${mismatch}${canWrite ? " (bấm để đổi)" : ""}`}
              className="inline-flex items-center gap-0.5 rounded px-1 text-[10px] text-warning hover:bg-warning/10"
            >
              <I.AlertCircle size={11} /> Lệch? tr.{mismatch}
            </button>
          )}
        </>
      ) : suggest ? (
        <HoverPreview masp={masp} pageNum={suggest} className="inline-flex">
          <span
            className="inline-flex items-center gap-1 text-[11px] text-accent"
            title="Rê chuột để xem trang gợi ý"
          >
            ✨ Gợi ý tr.{suggest}
            {canWrite && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onCommit(String(suggest));
                }}
                className="rounded bg-accent/15 px-1 py-0.5 hover:bg-accent/25"
              >
                ✓ Dùng
              </button>
            )}
          </span>
        </HoverPreview>
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
          {assigned > 0 ? "Đổi" : "Gán trang"}
        </button>
      )}
      {open && (
        <AssignDrawingPageModal
          masp={masp}
          detail={detail}
          currentPage={assigned}
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
  detail: DetailInfo;
  currentPage: number;
  onSave: (page: number) => void;
  onClose: () => void;
}

function AssignDrawingPageModal({ masp, detail, currentPage, onSave, onClose }: ModalProps) {
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [err, setErr] = useState("");
  const [numPages, setNumPages] = useState(0);
  const [page, setPage] = useState(currentPage > 0 ? currentPage : 1);
  const [suggested, setSuggested] = useState<number | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  // biome-ignore lint/suspicious/noExplicitAny: PDFDocumentProxy (import động)
  const pdfRef = useRef<any>(null);
  const textsRef = useRef<string[]>([]);

  const detect = (texts: string[]) => {
    const best = findBestPage(texts, detail);
    return best.score >= MATCH_CONFIDENT ? best.page : null;
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: chỉ chạy 1 lần khi mở
  useEffect(() => {
    let alive = true;
    (async () => {
      const data = await getProductPdf(masp);
      if (!alive) return;
      if (!data) {
        setErr("Sản phẩm này chưa có file bản vẽ kỹ thuật.");
        setLoading(false);
        return;
      }
      try {
        const pdfMod = await import("@/lib/pdf");
        const pdf = await pdfMod.loadPdf(data.url);
        if (!alive) return;
        pdfRef.current = pdf;
        textsRef.current = data.texts;
        setNumPages(pdf.numPages);
        const match = detect(data.texts);
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

  useEffect(() => {
    if (!loaded || !pdfRef.current || page < 1) return;
    let alive = true;
    (async () => {
      const pdfMod = await import("@/lib/pdf");
      const dataUrl = await pdfMod.renderPageToDataUrl(pdfRef.current, page, 2000);
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
      title={`Gán trang bản vẽ — chi tiết ${detail.mact || ""}`}
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
            <button
              type="button"
              onClick={() => {
                const m = detect(textsRef.current);
                setSuggested(m);
                if (m) setPage(m);
              }}
              className="rounded border border-accent/40 px-2 py-1 text-accent hover:bg-accent/10"
              title="Tự nhận diện trang theo mã + tên + kích thước"
            >
              ✨ Tự nhận diện
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
                title="Trang khớp mã/tên/kích thước"
              >
                Gợi ý: trang {suggested}
                {page === suggested ? " ✓" : ""}
              </button>
            ) : (
              <span className="ml-auto text-muted">Không tự tìm thấy trang khớp — chọn tay</span>
            )}
          </div>
          <div className="h-[60vh] overflow-hidden rounded border border-border">
            {preview ? (
              <ZoomableImage src={preview} alt={`Trang ${page}`} />
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-muted">
                Đang render trang…
              </div>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}

/* ----- Ảnh trang PDF có ZOOM + cuộn để xem chi tiết (dùng chung hover-card +
   modal). Render sẵn ở độ phân giải cao; zoom = đổi bề rộng hiển thị, hộp
   overflow-auto để kéo xem. ----- */
function ZoomableImage({ src, alt }: { src: string; alt: string }) {
  const [zoom, setZoom] = useState(1);
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const dec = () => setZoom((z) => Math.max(1, round2(z - 0.5)));
  const inc = () => setZoom((z) => Math.min(5, round2(z + 0.5)));
  return (
    <div className="flex h-full w-full flex-col bg-bg-soft">
      <div className="flex shrink-0 items-center gap-1 border-b border-border bg-panel-2 px-2 py-1 text-xs">
        <button
          type="button"
          onClick={dec}
          className="rounded px-2 py-0.5 hover:bg-hover"
          title="Thu nhỏ"
        >
          −
        </button>
        <span className="w-10 text-center text-muted tabular-nums">{Math.round(zoom * 100)}%</span>
        <button
          type="button"
          onClick={inc}
          className="rounded px-2 py-0.5 hover:bg-hover"
          title="Phóng to"
        >
          +
        </button>
        <button
          type="button"
          onClick={() => setZoom(1)}
          className="ml-1 rounded px-2 py-0.5 text-muted hover:bg-hover"
          title="Vừa khít khung"
        >
          Vừa khít
        </button>
        <span className="ml-auto text-[10px] text-muted">Cuộn/kéo để xem chi tiết</span>
      </div>
      <div className="flex-1 overflow-auto p-1">
        <img
          src={src}
          alt={alt}
          draggable={false}
          className="block bg-white"
          style={{ width: `${zoom * 100}%`, maxWidth: "none", height: "auto" }}
        />
      </div>
    </div>
  );
}

/** Vị trí popover hover: ưu tiên bên phải ô, hết chỗ thì sang trái; kẹp trong viewport. */
function popPos(rect: DOMRect) {
  const m = 8;
  const w = Math.min(620, Math.round(window.innerWidth * 0.5));
  const h = Math.round(window.innerHeight * 0.72);
  let left = rect.right + m;
  if (left + w > window.innerWidth - m) left = Math.max(m, rect.left - w - m);
  let top = Math.min(rect.top, window.innerHeight - m - h);
  if (top < m) top = m;
  return { left, top, width: w, height: h };
}

/* ----- Rê chuột vào ô/gợi ý → hiện popover xem trang PDF (render nét, có zoom),
   không cần mở modal. Popover tương tác được (di chuột vào để zoom) nhờ đóng
   trễ; portal ra body để không bị overflow của bảng cắt. ----- */
function HoverPreview({
  masp,
  pageNum,
  className = "inline-flex",
  children,
}: {
  masp: string;
  pageNum: number;
  className?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [img, setImg] = useState<string | null>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const openTimer = useRef<number | null>(null);
  const closeTimer = useRef<number | null>(null);
  const startedRef = useRef(false);

  // Đổi sản phẩm/trang → bỏ ảnh đã render (cho render lại đúng trang).
  // biome-ignore lint/correctness/useExhaustiveDependencies: cố ý phụ thuộc masp/pageNum để reset khi đổi (body không đọc nhưng cần chạy lại)
  useEffect(() => {
    setImg(null);
    startedRef.current = false;
  }, [masp, pageNum]);

  // Dọn timer khi unmount.
  useEffect(
    () => () => {
      if (openTimer.current) window.clearTimeout(openTimer.current);
      if (closeTimer.current) window.clearTimeout(closeTimer.current);
    },
    [],
  );

  const startRender = () => {
    if (startedRef.current) return; // chỉ render 1 lần (tránh StrictMode 2×)
    startedRef.current = true;
    (async () => {
      try {
        const data = await getProductPdf(masp);
        if (!data || pageNum > data.texts.length) return;
        const pdfMod = await import("@/lib/pdf");
        const pdf = await pdfMod.loadPdf(data.url);
        const url = await pdfMod.renderPageToDataUrl(pdf, pageNum, 2000);
        setImg(url);
      } catch {
        /* lỗi render → giữ trạng thái "đang tải" */
      }
    })();
  };

  const cancelClose = () => {
    if (closeTimer.current) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };
  const scheduleClose = () => {
    cancelClose();
    closeTimer.current = window.setTimeout(() => setOpen(false), 180);
  };
  const onEnter = () => {
    cancelClose();
    if (wrapRef.current) setRect(wrapRef.current.getBoundingClientRect());
    if (openTimer.current) window.clearTimeout(openTimer.current);
    openTimer.current = window.setTimeout(() => {
      setOpen(true);
      startRender();
    }, 130);
  };
  const onLeave = () => {
    if (openTimer.current) window.clearTimeout(openTimer.current);
    scheduleClose();
  };

  if (!pageNum || pageNum < 1) return <>{children}</>;

  const pos = rect ? popPos(rect) : null;

  return (
    <span ref={wrapRef} onMouseEnter={onEnter} onMouseLeave={onLeave} className={className}>
      {children}
      {open &&
        pos &&
        createPortal(
          <div
            onMouseEnter={cancelClose}
            onMouseLeave={scheduleClose}
            className="fixed z-[55] flex flex-col overflow-hidden rounded-lg border border-border bg-panel shadow-2xl"
            style={{ left: pos.left, top: pos.top, width: pos.width, height: pos.height }}
          >
            {img ? (
              <ZoomableImage src={img} alt={`Trang ${pageNum}`} />
            ) : (
              <div className="flex flex-1 items-center justify-center text-xs text-muted">
                Đang tải bản xem…
              </div>
            )}
          </div>,
          document.body,
        )}
    </span>
  );
}
