import { defineConfig, devices } from "@playwright/test";

/* Playwright — SMOKE suite (app-only, KHÔNG cần backend/DB).
   webServer chạy "pnpm dev:app": AuthGate gọi auth.me() thất bại
   → màn hình đăng nhập hiện ra — đủ smoke test luồng UI cốt lõi.
   Full-stack e2e (có DB) dùng playwright.fullstack.config.ts. */
export default defineConfig({
  testDir: "./e2e/smoke",
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  use: { baseURL: "http://127.0.0.1:5173", trace: "on-first-retry" },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: {
    command: "pnpm dev:app",
    url: "http://127.0.0.1:5173",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
