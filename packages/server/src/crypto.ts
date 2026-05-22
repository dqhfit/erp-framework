/* ==========================================================
   crypto.ts — Mã hoá/giải mã bí mật (API key của LLM profile)
   bằng AES-256-GCM. Khoá dẫn xuất từ ENCRYPTION_KEY (env) qua
   sha256.

   BẢO MẬT: ở production BẮT BUỘC đặt ENCRYPTION_KEY thật. Nếu
   thiếu (hoặc còn giá trị mặc định dev), getKey() ném lỗi ngay
   lúc khởi động — vì khoá mặc định ai cũng biết, dùng nó để mã
   hoá API key chẳng khác gì lưu plaintext.
   ========================================================== */
import {
  createCipheriv, createDecipheriv, randomBytes, createHash,
} from "node:crypto";

/** Giá trị mặc định CHỈ dùng cho dev — production phải tự đặt. */
const DEV_KEY = "erp-framework-dev-key-change-me";

function getKey(): Buffer {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw || raw === DEV_KEY) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "ENCRYPTION_KEY chưa được đặt (hoặc còn giá trị mặc định dev) — "
        + "bắt buộc đặt một khoá bí mật thật ở môi trường production.",
      );
    }
    return createHash("sha256").update(DEV_KEY).digest();
  }
  return createHash("sha256").update(raw).digest(); // 32 byte cho aes-256
}

/** Mã hoá → "iv:tag:ciphertext" (hex). Chuỗi rỗng → rỗng. */
export function encryptSecret(plain: string): string {
  if (!plain) return "";
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getKey(), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${tag.toString("hex")}:${ct.toString("hex")}`;
}

/** Giải mã. Sai định dạng → trả nguyên (tương thích giá trị cũ chưa mã hoá). */
export function decryptSecret(enc: string): string {
  if (!enc) return "";
  const parts = enc.split(":");
  if (parts.length !== 3) return enc;
  const [ivH, tagH, ctH] = parts;
  try {
    const decipher = createDecipheriv("aes-256-gcm", getKey(), Buffer.from(ivH!, "hex"));
    decipher.setAuthTag(Buffer.from(tagH!, "hex"));
    return Buffer.concat([
      decipher.update(Buffer.from(ctH!, "hex")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return enc;
  }
}
