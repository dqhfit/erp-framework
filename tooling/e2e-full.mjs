#!/usr/bin/env node
/* ==========================================================
   e2e-full.mjs — chạy e2e full-stack "một lệnh".
   - Local: tự dựng PostgreSQL (container erp-e2e-db), chờ sẵn
     sàng, migrate + seed, rồi chạy Playwright.
   - CI (process.env.CI): bỏ qua phần Docker — postgres do CI
     service cung cấp; chỉ migrate + seed + Playwright.
   ========================================================== */
import { execSync } from "node:child_process";

const isCI = !!process.env.CI;
const DB_URL = process.env.DATABASE_URL
  ?? "postgres://erp:erp@localhost:5432/erp_framework";
const env = {
  ...process.env,
  DATABASE_URL: DB_URL,
  ENCRYPTION_KEY: process.env.ENCRYPTION_KEY ?? "e2e-key",
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function sh(cmd, opts = {}) {
  execSync(cmd, { stdio: "inherit", env, ...opts });
}

async function waitForPg() {
  for (let i = 0; i < 40; i++) {
    try {
      execSync("docker exec erp-e2e-db pg_isready -U erp -d erp_framework",
        { stdio: "ignore" });
      console.log("✓ PostgreSQL sẵn sàng");
      return;
    } catch { /* chưa sẵn sàng */ }
    await sleep(1000);
  }
  throw new Error("PostgreSQL chưa sẵn sàng sau 40s");
}

async function main() {
  if (!isCI) {
    console.log("• Dựng PostgreSQL e2e (container erp-e2e-db)…");
    try { execSync("docker rm -f erp-e2e-db", { stdio: "ignore" }); }
    catch { /* chưa có container */ }
    sh("docker run -d --name erp-e2e-db -p 5432:5432 "
      + "-e POSTGRES_USER=erp -e POSTGRES_PASSWORD=erp "
      + "-e POSTGRES_DB=erp_framework postgres:18");
    await waitForPg();
  }
  console.log("• Áp migration…");
  sh("pnpm --filter @erp-framework/db migrate");
  console.log("• Seed ERP mẫu…");
  sh("pnpm --filter @erp-framework/server seed");
  console.log("• Chạy Playwright full-stack…");
  sh("pnpm exec playwright test -c playwright.fullstack.config.ts");
}

main().catch((e) => {
  console.error("e2e:full lỗi:", e.message);
  process.exit(1);
});
