import { defineConfig, devices } from "@playwright/test";

/* Playwright e2e — bộ smoke test cho app.
   webServer chạy "pnpm dev:app" (chỉ vite, KHÔNG cần backend/DB):
   AuthGate gọi auth.me() thất bại (không có server) → màn hình
   đăng nhập hiện ra — đủ để smoke test luồng UI cốt lõi.
   Test cần backend thật (đăng nhập, CRUD) nằm ngoài phạm vi suite
   này — cần dựng stack đầy đủ (xem docs/SELF-HOST.md). */
export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  use: {
    baseURL: "http://localhost:5173",
    trace: "on-first-retry",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: {
    command: "pnpm dev:app",
    url: "http://localhost:5173",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
