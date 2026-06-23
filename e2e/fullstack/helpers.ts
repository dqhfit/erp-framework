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
   Idempotent — chạy lại được trên DB dùng chung.

   storageState-aware: nếu context đã có session (auth.setup.ts đã lưu),
   chỉ goto rồi return — KHÔNG submit login (mỗi login tốn quota
   auth.login 5/15min/IP). Chỉ thực sự login khi chưa đăng nhập (tức
   trong auth.setup hoặc khi chạy lẻ chưa có state). */
export async function ensureLoggedIn(page: Page): Promise<void> {
  await page.goto("/");
  // Tín hiệu "đã ở trong app" = nút Đăng xuất ở app-shell (LUÔN có khi đăng
  // nhập, render ngay cùng shell). KHÔNG dùng link entity seed ("Khách hàng")
  // — vừa phụ thuộc dữ liệu seed, vừa render chậm (cold-start) gây timeout.
  const inApp = page.getByTitle("Đăng xuất");
  // Login mode dùng placeholder "email hoặc tên tài khoản" (auth.email_or_username_ph),
  // không phải "ban@congty.com" (auth.email_ph — chỉ dùng trong form đăng ký).
  const emailField = page.getByPlaceholder("email hoặc tên tài khoản");

  // Chờ MỘT trong hai trạng thái ổn định: form đăng nhập HOẶC app đã vào.
  // Timeout rộng vì lần chạy đầu dev server cold-start biên dịch route —
  // 4s từng quá ngắn, app chậm hiện → rớt nhầm xuống nhánh điền form.
  await expect(emailField.or(inApp).first()).toBeVisible({ timeout: 30_000 });

  // Đã ở trong app (không có form) → đã đăng nhập qua storageState → xong.
  // KHÔNG điền form (sẽ treo vì không có input + tốn quota auth.login).
  if (!(await emailField.isVisible().catch(() => false))) {
    await inApp.waitFor({ state: "visible", timeout: 15_000 });
    return;
  }

  // Còn form đăng nhập → flow login, fallback đăng ký admin đầu.
  await emailField.fill(EMAIL);
  await page.getByPlaceholder("••••••••").fill(PASSWORD);
  await page.getByRole("button", { name: "Đăng nhập" }).click();
  try {
    await inApp.waitFor({ state: "visible", timeout: 10_000 });
    return;
  } catch {
    // chưa có tài khoản → đăng ký admin đầu tiên
  }
  await page.getByRole("button", { name: /Tạo tài khoản quản trị/ }).click();
  // Sau khi chuyển mode register, email field đổi placeholder → "ban@congty.com".
  await page.getByPlaceholder("ban@congty.com").fill(EMAIL);
  await page.getByPlaceholder("Nguyễn Văn A").fill("E2E Admin");
  await page.getByPlaceholder("••••••••").fill(PASSWORD);
  await page.getByRole("button", { name: "Đăng ký & vào app" }).click();
  await inApp.waitFor({ state: "visible", timeout: 15_000 });
}

/** Chuyển sang chế độ Người dùng — nút "Xem trước" (designer.preview),
   dùng chung EntityDesigner (→ localView "data") lẫn PageDesigner
   (→ previewMode). Chỉ có trên route entities/pages. */
export async function switchToConsumer(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Xem trước", exact: true }).click();
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
  await page.locator("select").filter({ hasText: "Ollama" }).selectOption("openai");
  await page.getByPlaceholder("nomic-embed-text").fill("stub-embed");
  await page.getByPlaceholder("https://api.openai.com").fill(STUB_URL);
  await page.getByPlaceholder("sk-...").fill("stub-key");
  await page.getByRole("button", { name: /Lưu cấu hình/ }).click();
  await expect(page.getByText(/Đã lưu cấu hình embedding/)).toBeVisible();
}
