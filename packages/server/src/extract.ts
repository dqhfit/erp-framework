/* ==========================================================
   extract.ts — Trích văn bản từ file qua sidecar Apache Tika.
   Tika (container riêng) lo mọi định dạng: PDF/DOCX/XLSX/PPTX/
   HTML/RTF/ODT… và OCR PDF scan (bản image `-full`). Module này
   chỉ là client HTTP thuần — không phụ thuộc thư viện npm nào.
   Cấu hình endpoint qua biến môi trường TIKA_URL.
   ========================================================== */

import { splitUrlAuth } from "./url-auth";

// Tika có thể đứng sau reverse-proxy basic-auth (vd dev-infra Caddy) →
// TIKA_URL dạng http://user:pass@host. fetch() không nhận credentials
// trong URL nên tách ra header Authorization.
const { url: TIKA_URL, headers: TIKA_AUTH } = splitUrlAuth(
  process.env.TIKA_URL || "http://localhost:9998",
);

/** Trích văn bản thuần từ nội dung file. `mime` (nếu biết) giúp Tika
   chọn parser; bỏ trống thì Tika tự dò theo nội dung. */
export async function extractText(buf: Buffer, mime?: string): Promise<string> {
  let res: Response;
  try {
    res = await fetch(`${TIKA_URL}/tika`, {
      method: "PUT",
      headers: {
        accept: "text/plain",
        ...TIKA_AUTH,
        ...(mime ? { "content-type": mime } : {}),
      },
      body: new Uint8Array(buf),
    });
  } catch (e) {
    throw new Error(
      `Không kết nối được Apache Tika (${TIKA_URL}) — kiểm tra service ` +
        `"tika" đã chạy: ${(e as Error).message}`,
    );
  }
  if (!res.ok) {
    throw new Error(`Tika lỗi ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  return (await res.text()).trim();
}
