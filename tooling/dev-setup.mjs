/* ==========================================================
   dev-setup.mjs — Thiết lập môi trường DEV một lần.
   Cài dependency → dựng DB (db:setup: Postgres + migration +
   seed) → bật hạ tầng Knowledge Base (Tika + Ollama + tự kéo
   model embedding). Xong chỉ cần `pnpm dev`.

   Chạy MỘT LẦN trên máy dev:  pnpm dev:setup
   ========================================================== */
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const COMPOSE = "docker/docker-compose.yml";

function run(cmd) {
  console.log(`\n$ ${cmd}`);
  execSync(cmd, { cwd: ROOT, stdio: "inherit" });
}

function main() {
  console.log("== Thiết lập môi trường DEV — ERP Framework ==");

  /* 0. Bắt buộc có Docker. */
  try {
    execSync("docker --version", { stdio: "ignore" });
  } catch {
    console.error("✗ Không tìm thấy Docker. Cài Docker Desktop rồi chạy lại.");
    process.exit(1);
  }

  /* 1. Cài dependency toàn monorepo. */
  run("pnpm install");

  /* 2. Database: dò cổng host trống → Postgres → migration → seed.
     Tái dùng db:setup; nó cũng ghi packages/{db,server}/.env. */
  run("pnpm db:setup");

  /* 3. Hạ tầng Knowledge Base: Tika (trích văn bản từ file) + Ollama
     (sinh embedding) + ollama-pull (tự kéo model nomic-embed-text).
     Server + app vẫn chạy trên host qua `pnpm dev`. */
  run(`docker compose -f ${COMPOSE} up -d tika ollama ollama-pull`);

  console.log(`
✓ Môi trường DEV đã sẵn sàng.

  Ollama đang tải model nomic-embed-text (~275MB) ở nền — theo dõi:
    docker compose -f ${COMPOSE} logs -f ollama-pull

Bước tiếp theo:
  1. pnpm dev                      → app: http://localhost:5173
  2. Đăng nhập (hoặc đăng ký tài khoản admin đầu tiên)
  3. Cài đặt → Embedding: chọn Ollama · model nomic-embed-text ·
     endpoint http://localhost:11434 · Lưu
  4. Mở /knowledge để dùng Knowledge Base

  (Mặc định file tải lên lưu ở /data/uploads — đổi bằng cách đặt
   UPLOAD_DIR trong packages/server/.env nếu cần.)
`);
}

try {
  main();
} catch (e) {
  console.error("\n✗ Thiết lập DEV thất bại:", e.message);
  process.exit(1);
}
