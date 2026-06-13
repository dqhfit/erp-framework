/* ==========================================================
   url-auth.ts — Tách userinfo (user:pass@) khỏi URL thành header
   Authorization: Basic.

   CẦN vì fetch()/Request (undici) NÉM TypeError nếu URL chứa
   credentials ("Request cannot be constructed from a URL that includes
   credentials"). Nhờ helper này, operator cấu hình endpoint CÓ auth qua
   MỘT biến env (vd reverse-proxy Caddy basic-auth chắn trước Tika/Ollama)
   mà server vẫn gọi fetch được.
   ========================================================== */

/** Trả về `url` đã bỏ trailing slash + đã gỡ userinfo, kèm `headers`
   chứa `authorization: Basic …` nếu URL có `user:pass@`. URL không hợp
   lệ → trả nguyên trạng (caller xử lý lỗi sau). */
export function splitUrlAuth(raw: string): {
  url: string;
  headers: Record<string, string>;
} {
  try {
    const u = new URL(raw);
    if (u.username || u.password) {
      // username/password trong URL bị percent-encode → decode lại.
      const user = decodeURIComponent(u.username);
      const pass = decodeURIComponent(u.password);
      const token = Buffer.from(`${user}:${pass}`).toString("base64");
      u.username = "";
      u.password = "";
      return {
        url: u.toString().replace(/\/$/, ""),
        headers: { authorization: `Basic ${token}` },
      };
    }
  } catch {
    /* không phải URL hợp lệ — rơi xuống trả nguyên trạng */
  }
  return { url: raw.replace(/\/$/, ""), headers: {} };
}
