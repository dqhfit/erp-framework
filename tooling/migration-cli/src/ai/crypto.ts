/* ==========================================================
   crypto.ts — Decrypt API key của llm_profile.

   Port logic từ packages/server/src/crypto.ts vì migration-cli
   không thể import @erp-framework/server (circular dep). Khóa
   ENCRYPTION_KEY phải khớp với server để decrypt thành công.
   ========================================================== */

import { createDecipheriv, createHash } from "node:crypto";

const DEV_KEY = "erp-framework-dev-key-change-me";

function getKey(): Buffer {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw || raw === DEV_KEY) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "ENCRYPTION_KEY chưa được đặt (hoặc còn dev) — " +
          "phải đặt khóa thay khi chạy migration-cli production.",
      );
    }
    return createHash("sha256").update(DEV_KEY).digest();
  }
  return createHash("sha256").update(raw).digest();
}

export function decryptSecret(enc: string): string {
  if (!enc) return "";
  const parts = enc.split(":");
  if (parts.length !== 3) return enc;
  const [ivH, tagH, ctH] = parts;
  try {
    const decipher = createDecipheriv("aes-256-gcm", getKey(), Buffer.from(ivH!, "hex"));
    decipher.setAuthTag(Buffer.from(tagH!, "hex"));
    return Buffer.concat([decipher.update(Buffer.from(ctH!, "hex")), decipher.final()]).toString(
      "utf8",
    );
  } catch {
    return enc;
  }
}
