/* ==========================================================
   load-env.ts — Nạp packages/server/.env vào process.env.
   tsx KHÔNG tự nạp .env, nên module này phải được import ĐẦU TIÊN
   (trước db.ts) ở index.ts và seed.ts. Biến đã set sẵn từ môi
   trường thật sẽ được giữ nguyên (không ghi đè).
   ========================================================== */
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const envPath = join(dirname(fileURLToPath(import.meta.url)), "..", ".env");

if (existsSync(envPath)) {
  for (const raw of readFileSync(envPath, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    // Bỏ dấu nháy bao quanh nếu có.
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (key && process.env[key] === undefined) process.env[key] = val;
  }
}
