/* ==========================================================
   pdf.ts — Tiện ích PDF phía client (pdfjs-dist) cho tính năng "gán trang bản
   vẽ kỹ thuật cho chi tiết": load PDF (cache), trích text từng trang (auto-match
   mã chi tiết), render 1 trang → thumbnail dataURL.

   Nặng (~1MB) → import ĐỘNG (await import("@/lib/pdf")) ở component để vào
   chunk lazy riêng (manualChunks 'pdf' trong vite.config), không nằm bundle chính.
   ========================================================== */

import type { PDFDocumentProxy } from "pdfjs-dist";
import * as pdfjs from "pdfjs-dist";
// Worker pdf.js — Vite trả URL asset; chạy off-main-thread.
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

// ?v=1: đổi URL để bỏ qua bản worker .mjs từng bị cache SAI MIME (octet-stream,
// immutable 1 năm) trước khi nginx được vá — vẫn khớp location ~* \.mjs$.
pdfjs.GlobalWorkerOptions.workerSrc = `${workerUrl}?v=1`;

// Cache document theo URL — lưới nhiều dòng cùng 1 PDF sản phẩm → load 1 lần.
const docCache = new Map<string, Promise<PDFDocumentProxy>>();

/** Load (cache) PDF theo URL. withCredentials để gửi cookie phiên (/banvesvc/file). */
export function loadPdf(url: string): Promise<PDFDocumentProxy> {
  let p = docCache.get(url);
  if (!p) {
    p = pdfjs.getDocument({ url, withCredentials: true }).promise;
    docCache.set(url, p);
  }
  return p;
}

/** Text từng trang (index mảng = trang-1). Fail-safe: lỗi 1 trang → chuỗi rỗng. */
export async function getPageTexts(pdf: PDFDocumentProxy): Promise<string[]> {
  const out: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    try {
      const page = await pdf.getPage(i);
      const tc = await page.getTextContent();
      out.push(tc.items.map((it) => ("str" in it ? it.str : "")).join(" "));
    } catch {
      out.push("");
    }
  }
  return out;
}

/** Render 1 trang (1-based) → dataURL PNG, scale theo bề rộng mong muốn. */
export async function renderPageToDataUrl(
  pdf: PDFDocumentProxy,
  pageNum: number,
  maxWidth = 240,
): Promise<string> {
  const page = await pdf.getPage(pageNum);
  const base = page.getViewport({ scale: 1 });
  // Trần 3 (thay 2) để trang born-digital nhỏ (A4) render sắc, zoom vẫn rõ.
  const scale = Math.min(3, Math.max(0.2, maxWidth / base.width));
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Không tạo được canvas");
  await page.render({ canvasContext: ctx, viewport }).promise;
  return canvas.toDataURL("image/png");
}
