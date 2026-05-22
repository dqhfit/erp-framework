import { test, expect } from "@playwright/test";
import { ensureLoggedIn, configureEmbeddingStub } from "./helpers";

/* Knowledge Base — cấu hình embedding (stub), nạp nguồn, tra cứu,
   sửa nguồn, lưu từ chat. Cần stub embedding (tooling/e2e-stub-server). */

test("cấu hình embedding profile (stub)", async ({ page }) => {
  await ensureLoggedIn(page);
  await configureEmbeddingStub(page);
  // configureEmbeddingStub đã assert thông báo "Đã lưu cấu hình embedding".
});

test("KB đầu-cuối: thêm văn bản → nạp xong → tìm kiếm", async ({ page }) => {
  await ensureLoggedIn(page);
  await configureEmbeddingStub(page);
  await page.goto("/knowledge");

  const title = "KB E2E " + Date.now().toString(36);
  await page.getByPlaceholder("Tiêu đề").fill(title);
  await page.getByPlaceholder(/Dán nội dung/).fill(
    "Bàn gỗ sồi cao cấp dùng cho phòng họp. Bảo hành hai năm.");
  await page.getByRole("button", { name: "Thêm văn bản" }).click();

  // Chờ ingest (chunk + embed qua stub) tới trạng thái Sẵn sàng.
  const row = page.locator("div.rounded-md.border").filter({ hasText: title });
  await expect(row.getByText(/Sẵn sàng/)).toBeVisible({ timeout: 40_000 });

  // Tra cứu — từ khoá trùng nội dung nguồn vừa nạp.
  await page.getByPlaceholder(/Nhập câu hỏi/).fill("bàn gỗ sồi phòng họp");
  await page.getByRole("button", { name: "Tìm", exact: true }).click();
  await expect(
    page.getByText(/Bàn gỗ sồi cao cấp/),
  ).toBeVisible({ timeout: 15_000 });
});

test("thêm nguồn tri thức từ dữ liệu entity", async ({ page }) => {
  await ensureLoggedIn(page);
  await page.goto("/knowledge");
  // Select entity — lọc theo "Chọn entity" để không trúng LanguagePicker.
  await page.locator("select").filter({ hasText: "Chọn entity" })
    .selectOption({ index: 1 });
  await page.getByRole("button", { name: "Thêm entity" }).click();
  await expect(page.getByText(/Đã thêm nguồn entity/)).toBeVisible();
});

test("mở Drawer sửa nguồn tri thức", async ({ page }) => {
  await ensureLoggedIn(page);
  await page.goto("/knowledge");
  // Nguồn nạp bất đồng bộ — chờ nút "Sửa" hiện (test trước đã tạo nguồn).
  const editBtn = page.getByRole("button", { name: "Sửa", exact: true }).first();
  await editBtn.waitFor({ state: "visible", timeout: 15_000 });
  await editBtn.click();
  await expect(page.getByText("Sửa nguồn tri thức")).toBeVisible();
});

test("lưu câu trả lời từ chat vào tri thức (C1)", async ({ page }) => {
  await ensureLoggedIn(page);
  await page.goto("/");
  await page.getByRole("button", { name: /Phác thảo bằng AI/ }).click();
  await page.getByRole("button", { name: /Lưu vào tri thức/ }).first().click();
  await expect(
    page.getByRole("button", { name: /Đã lưu vào tri thức/ }),
  ).toBeVisible();
});
