/* file-token.ts — HMAC-signed file URL helpers.
   URL format: /f/{base64url(JSON)}.{hmac-sha256}
   Payload JSON: { c: companyId, t: "doc"|"img", f: filename }
   Secret: FILE_SIGNING_SECRET ?? ENCRYPTION_KEY (đã bắt buộc ở prod). */
import { createHmac, timingSafeEqual } from "node:crypto";

const SECRET = process.env.FILE_SIGNING_SECRET ?? process.env.ENCRYPTION_KEY ?? "dev-no-secret";

/** Tạo URL dạng /f/{token}/{displayName}.
 *  displayName trong path → Chrome PDF viewer dùng làm tiêu đề tài liệu.
 *  Server route /f/:token/:displayname ignore phần :displayname — chỉ dùng token để serve file. */
export function signFileUrl(companyId: string, type: "doc" | "img", filename: string): string {
  const payload = Buffer.from(JSON.stringify({ c: companyId, t: type, f: filename })).toString(
    "base64url",
  );
  const sig = createHmac("sha256", SECRET).update(payload).digest("base64url");
  const dunder = filename.indexOf("__");
  const displayName = dunder >= 0 ? filename.slice(dunder + 2) : filename;
  return `/f/${payload}.${sig}/${encodeURIComponent(displayName)}`;
}

/** Xác minh token, trả {companyId, type, filename} hoặc null nếu không hợp lệ. */
export function verifyFileToken(
  token: string,
): { companyId: string; type: "doc" | "img"; filename: string } | null {
  const dot = token.lastIndexOf(".");
  if (dot < 0) return null;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (!payload || !sig) return null;

  const expected = createHmac("sha256", SECRET).update(payload).digest("base64url");
  // base64url decode để so sánh bytes (tránh timing attack).
  let sigBuf: Buffer;
  let expBuf: Buffer;
  try {
    sigBuf = Buffer.from(sig, "base64url");
    expBuf = Buffer.from(expected, "base64url");
  } catch {
    return null;
  }
  if (sigBuf.length !== expBuf.length) return null;
  if (!timingSafeEqual(sigBuf, expBuf)) return null;

  try {
    const obj = JSON.parse(Buffer.from(payload, "base64url").toString()) as {
      c?: string;
      t?: string;
      f?: string;
    };
    if (!obj.c || !obj.t || !obj.f) return null;
    if (obj.t !== "doc" && obj.t !== "img") return null;
    return { companyId: obj.c, type: obj.t as "doc" | "img", filename: obj.f };
  } catch {
    return null;
  }
}
