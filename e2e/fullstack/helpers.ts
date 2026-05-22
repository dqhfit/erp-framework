/* ==========================================================
   helpers.ts — tiện ích dùng chung cho e2e full-stack.
   File .ts (không .spec) nên Playwright không coi là test file.
   ========================================================== */
import { expect, type Page } from "@playwright/test";

export const EMAIL = "admin@e2e.test";
export const PASSWORD = "e2e-password-123";

/** URL stub dịch vụ ngoài — xem tooling/e2e-stub-server.mjs. */
export const STUB_URL = "http://127.0.0.1:9100";

/** Vào app: đăng nhập nếu đã có tài khoản, ngược lại đăng ký admin đầu.
   Idempotent — chạy lại được trên DB dùng chung. */
export async function ensureLoggedIn(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByPlaceholder("ban@congty.com").fill(EMAIL);
  await page.getByPlaceholder("••••••••").fill(PASSWORD);
  await page.getByRole("button", { name: "Đăng nhập" }).click();

  const inApp = page.getByRole("link", { name: "Khách hàng", exact: true });
  try {
    await inApp.waitFor({ state: "visible", timeout: 6000 });
    return;
  } catch {
    // chưa có tài khoản → đăng ký admin đầu tiên
  }
  await page.getByRole("button", { name: /Tạo tài khoản quản trị/ }).click();
  await page.getByPlaceholder("ban@congty.com").fill(EMAIL);
  await page.getByPlaceholder("Nguyễn Văn A").fill("E2E Admin");
  await page.getByPlaceholder("••••••••").fill(PASSWORD);
  await page.getByRole("button", { name: "Đăng ký & vào app" }).click();
  await inApp.waitFor({ state: "visible", timeout: 15_000 });
}

/** Chuyển sang chế độ Người dùng — nút thứ 2 của .mode-toggle (Preview).
   Chỉ có trên route entities/pages/workflows. */
export async function switchToConsumer(page: Page): Promise<void> {
  await page.locator(".mode-toggle button").nth(1).click();
}

/** Mở một mục ở sidebar theo tên hiển thị. */
export async function openSidebarLink(page: Page, name: string): Promise<void> {
  await page.getByRole("link", { name, exact: true }).first().click();
}

/** Tên duy nhất cho dữ liệu test (DB dùng chung giữa các lần chạy). */
export function uniqueName(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}`;
}

/** Cấu hình embedding profile trỏ vào stub (cho test Knowledge Base).
   Vào /settings/embedding, chọn adapter OpenAI-compat → stub. */
export async function configureEmbeddingStub(page: Page): Promise<void> {
  await page.goto("/settings/embedding");
  // Select "Nhà cung cấp" — lọc theo option "Ollama" để không trúng
  // LanguagePicker (cũng là <select>) ở Topbar.
  await page.locator("select").filter({ hasText: "Ollama" })
    .selectOption("openai");
  await page.getByPlaceholder("nomic-embed-text").fill("stub-embed");
  await page.getByPlaceholder("https://api.openai.com").fill(STUB_URL);
  await page.getByPlaceholder("sk-...").fill("stub-key");
  await page.getByRole("button", { name: /Lưu cấu hình/ }).click();
  await expect(page.getByText(/Đã lưu cấu hình embedding/)).toBeVisible();
}
