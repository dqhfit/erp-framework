import { useState } from "react";
import { createPortal } from "react-dom";
import { I } from "@/components/Icons";
import { Modal } from "@/components/ui";

/** Tạo URL PDF.js viewer giống trang bản vẽ.
 *  Trả null nếu đang chạy localhost (PDF.js server ngoài không reach được). */
function buildPdfJsSrc(fileUrl: string): string | null {
  const host = typeof window !== "undefined" ? window.location.hostname : "";
  if (host === "localhost" || host === "127.0.0.1") return null;
  const base =
    (import.meta.env.VITE_PDFJS_BASE as string | undefined) ?? "https://view.dongquochung.com:4432";
  const abs = window.location.origin + fileUrl;
  return `${base.replace(/\/+$/, "")}/web/viewer.html?file=${encodeURIComponent(abs)}`;
}

/** Tách tên file gốc từ URL.
 *  Hỗ trợ /f/{token}/{displayName}, /f/{token}?name=..., /f/{token} (atob fallback),
 *  và legacy /files/doc/:company/:uuid__name. */
export function fileDisplayName(url: string): string {
  if (url.startsWith("/f/")) {
    // 1. Path segment: /f/{token}/{displayName}  (format mới)
    const pathOnly = url.split("?")[0] ?? url;
    const segs = pathOnly.split("/"); // ["", "f", "token", "displayName"]
    if (segs.length >= 4 && segs[3]) {
      try {
        const name = decodeURIComponent(segs[3]);
        if (name) return name;
      } catch {
        // fall through
      }
    }
    // 2. Query param ?name= (URL cũ trong DB)
    const qi = url.indexOf("?name=");
    if (qi >= 0) {
      try {
        const raw = url.slice(qi + 6).split("&")[0] ?? "";
        if (raw) return decodeURIComponent(raw);
      } catch {
        // fall through
      }
    }
    // 3. atob decode: URL rất cũ không có name
    try {
      const tokenPart = qi >= 0 ? url.slice(3, qi) : url.slice(3);
      const dot = tokenPart.lastIndexOf(".");
      const payload = dot >= 0 ? tokenPart.slice(0, dot) : tokenPart;
      const b64 = payload.replace(/-/g, "+").replace(/_/g, "/");
      const pad = (4 - (b64.length % 4)) % 4;
      const obj = JSON.parse(atob(b64 + "=".repeat(pad))) as { f?: string };
      if (obj.f) {
        const idx = obj.f.indexOf("__");
        return idx !== -1 ? obj.f.slice(idx + 2) : obj.f;
      }
    } catch {
      // ignore
    }
    return "Tệp đính kèm";
  }
  // Legacy: /files/doc/:company/:uuid__originalname
  const seg = url.split("/").pop() ?? url;
  const idx = seg.indexOf("__");
  return idx !== -1 ? decodeURIComponent(seg.slice(idx + 2)) : seg;
}

/** Overlay xem file toàn màn hình — giống PdfViewer trang bản vẽ.
 *  PDF: dùng PDF.js viewer (prod) hoặc Chrome native (localhost fallback).
 *  Ảnh: hiện trực tiếp. File khác: chỉ có nút mở tab + tải về. */
function FileOverlay({ url, name, onClose }: { url: string; name: string; onClose: () => void }) {
  const isPdf = /\.pdf$/i.test(name);
  const isImg = /\.(png|jpe?g|gif|webp|svg|bmp)$/i.test(name);
  // PDF.js viewer giống trang bản vẽ; fallback sang Chrome native khi localhost
  const pdfSrc = isPdf ? (buildPdfJsSrc(url) ?? url) : null;
  // Nút "Mở tab mới" cho PDF → mở PDF.js viewer (giống click bản vẽ mở tab)
  const tabHref = isPdf ? (buildPdfJsSrc(url) ?? url) : url;
  // Portal lên document.body để thoát CSS transform/overflow của table cell.
  return createPortal(
    <div
      className="fixed inset-0 z-[1100] bg-black/90 flex flex-col"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex items-center gap-2 px-3 py-2 bg-panel border-b border-border shrink-0">
        <span className="text-sm font-medium flex-1 truncate min-w-0">{name}</span>
        <a
          href={tabHref}
          target="_blank"
          rel="noreferrer"
          className="btn-default text-xs px-2 py-1 inline-flex items-center gap-1 shrink-0"
        >
          <I.ExternalLink size={14} /> Mở tab mới
        </a>
        <a
          href={url}
          download={name}
          className="btn-default text-xs px-2 py-1 inline-flex items-center gap-1 shrink-0"
        >
          <I.Download size={14} /> Tải về
        </a>
        <button
          type="button"
          onClick={onClose}
          className="p-1.5 rounded hover:bg-hover text-muted shrink-0"
          aria-label="Đóng"
        >
          <I.X size={18} />
        </button>
      </div>

      {isPdf && pdfSrc && <iframe src={pdfSrc} title={name} className="flex-1 w-full bg-white" />}
      {isImg && (
        <div className="flex-1 flex items-center justify-center p-4 overflow-auto">
          <img src={url} alt={name} className="max-w-full max-h-full object-contain" />
        </div>
      )}
      {!isPdf && !isImg && (
        <div className="flex-1 flex flex-col items-center justify-center gap-4 text-muted">
          <I.FileText size={48} />
          <p className="text-sm">{name}</p>
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="btn-default text-xs px-3 py-1.5 inline-flex items-center gap-1.5"
          >
            <I.ExternalLink size={14} /> Mở trong tab mới
          </a>
        </div>
      )}
    </div>,
    document.body,
  );
}

/** Ảnh — click mở overlay toàn màn hình. */
export function ImageCell({ url, className }: { url: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const name = url.split("/").pop() ?? "ảnh";
  return (
    <>
      <img
        src={url}
        alt=""
        className={`cursor-zoom-in hover:opacity-90 transition-opacity ${className ?? "h-6 max-w-[120px] object-contain"}`}
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        loading="lazy"
      />
      {open && <FileOverlay url={url} name={name} onClose={() => setOpen(false)} />}
    </>
  );
}

/** Link file — click mở overlay toàn màn hình (giống trang bản vẽ). */
export function FileCell({ url }: { url: string }) {
  const [open, setOpen] = useState(false);
  const name = fileDisplayName(url);
  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        className="flex items-center gap-1 text-accent underline truncate text-xs text-left"
        title={name}
      >
        <I.FileText size={11} className="shrink-0" />
        <span className="truncate">{name}</span>
      </button>
      {open && <FileOverlay url={url} name={name} onClose={() => setOpen(false)} />}
    </>
  );
}

/** Modal preview file — giữ lại cho backward compat (dùng iframe trực tiếp, không blob).
 *  Nếu cần toàn màn hình dùng FileOverlay / FileCell. */
export function FilePreviewModal({
  url,
  name,
  onClose,
}: {
  url: string;
  name: string;
  onClose: () => void;
}) {
  const isPdf = /\.pdf$/i.test(name);
  const isImg = /\.(png|jpe?g|gif|webp|svg|bmp)$/i.test(name);

  return (
    <Modal
      open
      onClose={onClose}
      title={name}
      width={860}
      align="top"
      footer={
        <>
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="btn btn-default text-xs px-3 py-1.5 flex items-center gap-1.5"
          >
            <I.ExternalLink size={13} />
            Mở tab mới
          </a>
          <a
            href={url}
            download={name}
            className="btn btn-default text-xs px-3 py-1.5 flex items-center gap-1.5"
          >
            <I.Download size={13} />
            Tải về
          </a>
        </>
      }
    >
      <div className="w-full" style={{ height: "72vh" }}>
        {isPdf ? (
          <iframe
            src={url}
            title={name}
            className="w-full h-full rounded border border-border bg-white"
          />
        ) : isImg ? (
          <div className="w-full h-full flex items-center justify-center bg-panel-2 rounded">
            <img src={url} alt={name} className="max-w-full max-h-full object-contain" />
          </div>
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center gap-4 text-muted">
            <I.FileText size={40} />
            <p className="text-sm">{name}</p>
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              className="btn btn-default text-xs px-3 py-1.5 flex items-center gap-1.5"
            >
              <I.ExternalLink size={13} />
              Mở trong tab mới
            </a>
          </div>
        )}
      </div>
    </Modal>
  );
}
