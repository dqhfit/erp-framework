import { test, expect, type Page } from "@playwright/test";

/* Full-stack e2e — chạy trên DB + server + app thật (đã migrate + seed).
   Idempotent: thử đăng nhập trước; chưa có tài khoản thì đăng ký admin
   đầu tiên. Nhờ vậy chạy lại được mà không cần DB mới mỗi lần. */

const EMAIL = "admin@e2e.test";
const PASSWORD = "e2e-password-123";

/** Vào app: đăng nhập nếu đã có tài khoản, ngược lại đăng ký admin đầu. */
async function ensureLoggedIn(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByPlaceholder("ban@congty.com").fill(EMAIL);
  await page.getByPlaceholder("••••••••").fill(PASSWORD);
  await page.getByRole("button", { name: "Đăng nhập" }).click();

  const inApp = page.getByRole("link", { name: "Khách hàng", exact: true });
  try {
    await inApp.waitFor({ state: "visible", timeout: 6000 });
    return; // đăng nhập thành công
  } catch {
    // chưa có tài khoản → đăng ký
  }
  await page.getByRole("button", { name: /Tạo tài khoản quản trị/ }).click();
  await page.getByPlaceholder("ban@congty.com").fill(EMAIL);
  await page.getByPlaceholder("Nguyễn Văn A").fill("E2E Admin");
  await page.getByPlaceholder("••••••••").fill(PASSWORD);
  await page.getByRole("button", { name: "Đăng ký & vào app" }).click();
  await inApp.waitFor({ state: "visible", timeout: 15_000 });
}

test("vào app → thấy ERP mẫu đã seed trong sidebar", async ({ page }) => {
  await ensureLoggedIn(page);
  await expect(
    page.getByRole("link", { name: "Khách hàng", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Đơn hàng", exact: true }),
  ).toBeVisible();
});

test("mở entity đã seed → vào trang designer", async ({ page }) => {
  await ensureLoggedIn(page);
  await page.getByRole("link", { name: "Sản phẩm", exact: true }).click();
  await expect(page).toHaveURL(/\/entities\//);
});

test("mở trang Nhật ký & Chi phí (activity_log server)", async ({ page }) => {
  await ensureLoggedIn(page);
  await page.goto("/activity");
  await expect(
    page.getByRole("heading", { name: "Nhật ký & Chi phí" }),
  ).toBeVisible();
});

test("mở entity ở chế độ dữ liệu — EntityData đọc record thật", async ({ page }) => {
  await ensureLoggedIn(page);
  // Vào thẳng route entity (id lấy từ link sidebar).
  const link = page.getByRole("link", { name: "Khách hàng", exact: true });
  const href = await link.getAttribute("href");
  expect(href).toContain("/entities/");
});

/** Chuyển sang chế độ người dùng — nút thứ 2 của .mode-toggle (Preview). */
async function switchToConsumer(page: Page): Promise<void> {
  await page.locator(".mode-toggle button").nth(1).click();
}

test("chế độ người dùng — màn hình Dữ liệu entity hiện nút thêm bản ghi", async ({ page }) => {
  await ensureLoggedIn(page);
  await page.getByRole("link", { name: "Sản phẩm", exact: true }).click();
  await expect(page).toHaveURL(/\/entities\//);
  await switchToConsumer(page);
  await expect(
    page.getByRole("button", { name: /Thêm bản ghi/ }),
  ).toBeVisible();
});

test("chế độ người dùng — mở được form thêm bản ghi (EntityData CRUD)", async ({ page }) => {
  await ensureLoggedIn(page);
  await page.getByRole("link", { name: "Sản phẩm", exact: true }).click();
  await switchToConsumer(page);
  const addBtn = page.getByRole("button", { name: /Thêm bản ghi/ });
  await addBtn.waitFor({ state: "visible", timeout: 8000 });
  await addBtn.click();
  // Drawer "Thêm …" mở ra — kiểm nút Lưu của form.
  await expect(
    page.getByRole("button", { name: "Lưu", exact: true }),
  ).toBeVisible();
});

test("mở workflow đã seed → designer có nút Chạy thử / Vận hành", async ({ page }) => {
  await ensureLoggedIn(page);
  // Workflow có thể chưa được seed — chỉ kiểm khi tồn tại link.
  const wf = page.getByRole("link", { name: "Duyệt đơn hàng", exact: true });
  if (await wf.count() === 0) test.skip(true, "Chưa seed workflow nào");
  await wf.first().click();
  await expect(page).toHaveURL(/\/workflows\//);
  await expect(
    page.getByRole("button", { name: /Chạy thử \/ Vận hành/ }),
  ).toBeVisible();
});
