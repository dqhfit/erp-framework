/* playwright.dinhmuc.config.ts — Chạy test định mức trên dev server đang sẵn sàng.
   Dùng khi: dev server (8910) + Vite (5173) + DB dev (5433/erp_sample) đã chạy.
   Không dùng e2e:full (cần tắt server); không commit file này. */
import { defineConfig, devices } from "@playwright/test";

const STORAGE_STATE = "e2e/.auth/state.json";
const DATABASE_URL = process.env.DATABASE_URL ?? "postgres://erp:erp@localhost:5433/erp_sample";
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY ?? "e2e-encryption-key-not-secret";

export default defineConfig({
  testDir: "./e2e/fullstack",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  forbidOnly: false,
  retries: 0,
  reporter: "list",
  use: { baseURL: "http://127.0.0.1:5173", trace: "on-first-retry" },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], storageState: STORAGE_STATE },
      dependencies: ["setup"],
    },
  ],
  webServer: [
    {
      command: "node tooling/e2e-stub-server.mjs",
      url: "http://127.0.0.1:9100/health",
      reuseExistingServer: true,
      timeout: 30_000,
    },
    {
      command: "pnpm --filter @erp-framework/server start",
      url: "http://127.0.0.1:8910/health",
      reuseExistingServer: true,
      timeout: 60_000,
      env: { DATABASE_URL, ENCRYPTION_KEY, PORT: "8910", HOST: "127.0.0.1" },
    },
    {
      command: "pnpm dev:app",
      url: "http://127.0.0.1:5173",
      reuseExistingServer: true,
      timeout: 120_000,
    },
  ],
});
