import { defineConfig, devices } from "@playwright/test";

/* Playwright — FULL-STACK e2e: PostgreSQL + server + app thật.
   Yêu cầu: một PostgreSQL đang chạy (DATABASE_URL). Trước khi chạy
   phải migrate + seed DB — xem script "e2e:full" trong package.json
   và job "e2e-full" trong CI.
   webServer khởi động server (:8910) rồi app (:5173). */
const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://erp:erp@localhost:5432/erp_framework";
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY ?? "e2e-encryption-key-not-secret";

export default defineConfig({
  testDir: "./e2e/fullstack",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,        // chia sẻ một DB → chạy tuần tự
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  use: { baseURL: "http://127.0.0.1:5173", trace: "on-first-retry" },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: [
    {
      command: "pnpm --filter @erp-framework/server start",
      url: "http://127.0.0.1:8910/health",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: { DATABASE_URL, ENCRYPTION_KEY, PORT: "8910", HOST: "127.0.0.1" },
    },
    {
      command: "pnpm dev:app",
      url: "http://127.0.0.1:5173",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
