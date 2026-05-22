/* ==========================================================
   setup-db.mjs — Thiết lập database mặc định cho ERP Framework.
   Một lệnh: dọn container db cũ → tự dò cổng host trống → bật
   Postgres trong docker-compose → chờ sẵn sàng → chạy migration
   (0000–0005) → seed dữ liệu ERP mẫu.

   Chạy:  pnpm db:setup
   ========================================================== */
import { execSync, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";
import { writeFileSync } from "node:fs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const COMPOSE = "docker/docker-compose.yml";

/* Khớp với docker/docker-compose.yml (service "db"). */
const DB_USER = "erp";
const DB_PASS = "erp";
const DB_NAME = "erp_framework";

/** Ngủ đồng bộ. */
function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** Cổng có trống trên 127.0.0.1 không. */
function portFree(port) {
  return new Promise((res) => {
    const srv = createServer();
    srv.once("error", () => res(false));
    srv.once("listening", () => srv.close(() => res(true)));
    srv.listen(port, "127.0.0.1");
  });
}

async function findFreePort(start) {
  for (let p = start; p < start + 30; p++) {
    if (await portFree(p)) return p;
  }
  throw new Error("Không tìm được cổng trống quanh " + start);
}

function run(cmd, env) {
  console.log(`\n$ ${cmd}`);
  execSync(cmd, {
    cwd: ROOT,
    stdio: "inherit",
    env: env ? { ...process.env, ...env } : process.env,
  });
}

async function main() {
  console.log("== Thiết lập database ERP Framework ==");

  /* 1. Dọn container db cũ (giữ nguyên volume dữ liệu) để giải phóng cổng. */
  try {
    execSync(`docker compose -f ${COMPOSE} rm -sf db`,
      { cwd: ROOT, stdio: "inherit" });
  } catch {
    /* chưa có container — bỏ qua */
  }

  /* 2. Dò cổng host trống (mặc định bắt đầu 5433 — tránh Postgres 5432). */
  const port = await findFreePort(5433);
  const DATABASE_URL =
    `postgres://${DB_USER}:${DB_PASS}@localhost:${port}/${DB_NAME}`;
  console.log(`✓ Dùng cổng host ${port} cho Postgres.`);

  /* 3. Ghi .env để pnpm dev / drizzle-kit dùng đúng cổng. */
  writeFileSync(join(ROOT, "packages/db/.env"),
    `# Tự sinh bởi pnpm db:setup\nDATABASE_URL=${DATABASE_URL}\n`);
  writeFileSync(join(ROOT, "packages/server/.env"),
    `# Tự sinh bởi pnpm db:setup\n`
    + `DATABASE_URL=${DATABASE_URL}\nPORT=8910\nHOST=127.0.0.1\n`);
  console.log("✓ Đã cập nhật packages/db/.env và packages/server/.env");

  /* 4. Bật service db (truyền cổng qua biến ERP_DB_PORT). */
  run(`docker compose -f ${COMPOSE} up -d db`, { ERP_DB_PORT: String(port) });

  /* 5. Chờ Postgres sẵn sàng. */
  process.stdout.write("Chờ Postgres sẵn sàng");
  let ready = false;
  for (let i = 0; i < 60; i++) {
    const r = spawnSync("docker", [
      "compose", "-f", COMPOSE, "exec", "-T", "db",
      "pg_isready", "-U", DB_USER, "-d", DB_NAME,
    ], { cwd: ROOT });
    if (r.status === 0) { ready = true; break; }
    process.stdout.write(".");
    sleep(2000);
  }
  console.log("");
  if (!ready) {
    console.error("✗ Postgres không sẵn sàng sau 120s — kiểm tra Docker.");
    process.exit(1);
  }
  console.log("✓ Postgres sẵn sàng.");

  /* 6. Migration. */
  run("pnpm --filter @erp-framework/db migrate", { DATABASE_URL });

  /* 7. Seed dữ liệu ERP mẫu (idempotent). */
  try {
    run("pnpm --filter @erp-framework/server seed", { DATABASE_URL });
  } catch {
    console.warn("⚠ Seed gặp lỗi (có thể đã seed trước đó) — bỏ qua.");
  }

  console.log(`\n✓ Hoàn tất. DATABASE_URL = ${DATABASE_URL}`);
  console.log("Chạy app:  pnpm dev");
}

main().catch((e) => {
  console.error("✗ Lỗi:", e.message);
  process.exit(1);
});
