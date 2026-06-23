/* ==========================================================
   dinhmuc-pages.spec.ts — E2E cho 3 trang Định mức:
     - Định mức gỗ ván   (d7c566ff)
     - Định mức ngũ kim  (e69c332b)
     - Định mức đóng gói (7bd5a6fc)

   Luồng: mở designer → consumer mode → bộ lọc SP → danh sách tải.
   Test dữ liệu: ngũ kim đã sync 10k+ hàng; gỗ ván/đóng gói skip nếu rỗng.
   ========================================================== */
import { expect, type Page, test } from "@playwright/test";
import { switchToConsumer } from "./helpers";

// ── Hằng số ──────────────────────────────────────────────────────

const GOVAN_PAGE_ID = "d7c566ff-7eca-4c16-893b-32fe9e8da39a";
const NGUKIM_PAGE_ID = "e69c332b-93b4-4761-82ac-c756841d4df9";
const DONGGOI_PAGE_ID = "7bd5a6fc-cc96-4c0e-8bf0-5635f075a840";

// SP đã xác nhận có trong cả tr_sanpham và tr_dinhmuc_ngukim của dev
const NGUKIM_TEST_MASP = "WCB004_2126_CLA";
const NGUKIM_TEST_SEARCH = "WCB004";

// ── Helpers ───────────────────────────────────────────────────────

/** Mở trang ở consumer mode và đợi FilterWidget hiển thị xong. */
async function openConsumerPage(page: Page, pageId: string): Promise<void> {
  await page.goto(`/pages/${pageId}`);
  await expect(page.getByRole("button", { name: "Xem trước", exact: true })).toBeVisible({
    timeout: 20_000,
  });
  await switchToConsumer(page);
  // FilterWidget render xong = nhãn "Hệ hàng" xuất hiện
  await expect(page.getByText("Hệ hàng", { exact: false }).first()).toBeVisible({
    timeout: 20_000,
  });
}

/** Chọn sản phẩm trong FilterWidget:
 *  click trigger → nhập tìm kiếm → click option đầu khớp. */
async function pickProduct(page: Page, search: string, maspPrefix: string): Promise<void> {
  // Đợi datasource sản phẩm tải xong (hiện số lượng: "Sản phẩm (N)")
  await expect(page.getByText(/Sản phẩm \(\d+\)/)).toBeVisible({ timeout: 25_000 });

  await page.getByRole("button", { name: "— Chọn sản phẩm —" }).click();

  const searchInput = page.getByPlaceholder("Tìm…").first();
  await expect(searchInput).toBeVisible({ timeout: 5_000 });
  await searchInput.fill(search);

  // Option có dạng "<masp> — <tensp>" render qua portal
  const option = page.getByRole("button", { name: new RegExp(maspPrefix, "i") }).first();
  await expect(option).toBeVisible({ timeout: 5_000 });
  await option.click();
}

/** Chọn option đầu tiên có dạng "MMMM — TTTT" (bỏ qua "— Chọn sản phẩm —"). */
async function pickFirstProduct(page: Page): Promise<string> {
  await page.getByRole("button", { name: "— Chọn sản phẩm —" }).click();
  // Tìm button trong dropdown portal: ít nhất 1 chữ, dấu —, ít nhất 3 ký tự
  const firstOpt = page
    .getByRole("button")
    .filter({ hasText: /\S.+ — .{3,}/ })
    .first();
  await expect(firstOpt).toBeVisible({ timeout: 8_000 });
  const label = (await firstOpt.textContent()) ?? "";
  await firstOpt.click();
  return label.split(" — ")[0].trim();
}

// ──────────────────────────────────────────────────────────────────
//  Định mức GỖ VÁN
// ──────────────────────────────────────────────────────────────────
test.describe("Trang Định mức gỗ ván", () => {
  test("mở chế độ thiết kế thành công", async ({ page }) => {
    await page.goto(`/pages/${GOVAN_PAGE_ID}`);
    await expect(page).toHaveURL(new RegExp(GOVAN_PAGE_ID));
    await expect(page.getByRole("button", { name: "Xem trước", exact: true })).toBeVisible({
      timeout: 20_000,
    });
  });

  test("consumer mode → FilterWidget hiển thị đúng", async ({ page }) => {
    await openConsumerPage(page, GOVAN_PAGE_ID);
    await expect(page.getByRole("button", { name: "— Chọn sản phẩm —" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Nạp lại" })).toBeVisible();
  });

  test("chọn sản phẩm → list tải định mức hoặc bỏ qua nếu chưa có dữ liệu", async ({ page }) => {
    await openConsumerPage(page, GOVAN_PAGE_ID);
    await expect(page.getByText(/Sản phẩm \(\d+\)/)).toBeVisible({ timeout: 25_000 });

    const masp = await pickFirstProduct(page);

    // Đợi 3s cho grid phản hồi sau khi chọn SP
    await page.waitForTimeout(3_000);
    const rowCount = await page.locator("tbody tr").count();
    if (rowCount === 0) {
      test.info().annotations.push({
        type: "skip-reason",
        description: `${masp}: tr_dinhmuc_govan chưa có dữ liệu (workflow sync chưa hoàn tất)`,
      });
    } else {
      await expect(page.locator("tbody tr").first()).toBeVisible();
      await expect(page.getByText("Mã chi tiết").first()).toBeVisible();
    }
  });
});

// ──────────────────────────────────────────────────────────────────
//  Định mức NGŨ KIM
// ──────────────────────────────────────────────────────────────────
test.describe("Trang Định mức ngũ kim", () => {
  test("mở chế độ thiết kế thành công", async ({ page }) => {
    await page.goto(`/pages/${NGUKIM_PAGE_ID}`);
    await expect(page).toHaveURL(new RegExp(NGUKIM_PAGE_ID));
    await expect(page.getByRole("button", { name: "Xem trước", exact: true })).toBeVisible({
      timeout: 20_000,
    });
  });

  test("consumer mode → FilterWidget hiển thị đúng", async ({ page }) => {
    await openConsumerPage(page, NGUKIM_PAGE_ID);
    await expect(page.getByRole("button", { name: "— Chọn sản phẩm —" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Nạp lại" })).toBeVisible();
  });

  test("chọn WCB004_2126_CLA → danh sách ngũ kim tải", async ({ page }) => {
    await openConsumerPage(page, NGUKIM_PAGE_ID);

    await pickProduct(page, NGUKIM_TEST_SEARCH, NGUKIM_TEST_MASP);

    // DataGrid tải hàng từ tr_dinhmuc_ngukim
    await expect(page.locator("tbody tr").first()).toBeVisible({ timeout: 15_000 });

    // Kiểm tra header cột đặc trưng của ngũ kim
    await expect(page.getByText("Mã chi tiết").first()).toBeVisible();
    await expect(page.getByText("Tên chi tiết").first()).toBeVisible();
    await expect(page.getByText("Số lượng").first()).toBeVisible();
  });

  test("Nạp lại → list vẫn hiển thị dữ liệu", async ({ page }) => {
    await openConsumerPage(page, NGUKIM_PAGE_ID);
    await pickProduct(page, NGUKIM_TEST_SEARCH, NGUKIM_TEST_MASP);
    await expect(page.locator("tbody tr").first()).toBeVisible({ timeout: 15_000 });

    await page.getByRole("button", { name: "Nạp lại" }).click();
    // Sau reload danh sách hiện lại trong 10s
    await expect(page.locator("tbody tr").first()).toBeVisible({ timeout: 10_000 });
  });

  test("hiệu năng: list tải trong 5 giây", async ({ page }) => {
    await openConsumerPage(page, NGUKIM_PAGE_ID);
    await pickProduct(page, NGUKIM_TEST_SEARCH, NGUKIM_TEST_MASP);
    const start = Date.now();
    await expect(page.locator("tbody tr").first()).toBeVisible({ timeout: 10_000 });
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(5_000);
  });
});

// ──────────────────────────────────────────────────────────────────
//  Định mức ĐÓNG GÓI
// ──────────────────────────────────────────────────────────────────
test.describe("Trang Định mức đóng gói", () => {
  test("mở chế độ thiết kế thành công", async ({ page }) => {
    await page.goto(`/pages/${DONGGOI_PAGE_ID}`);
    await expect(page).toHaveURL(new RegExp(DONGGOI_PAGE_ID));
    await expect(page.getByRole("button", { name: "Xem trước", exact: true })).toBeVisible({
      timeout: 20_000,
    });
  });

  test("consumer mode → FilterWidget hiển thị đúng", async ({ page }) => {
    await openConsumerPage(page, DONGGOI_PAGE_ID);
    await expect(page.getByRole("button", { name: "— Chọn sản phẩm —" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Nạp lại" })).toBeVisible();
  });

  test("chọn sản phẩm → list tải định mức hoặc bỏ qua nếu chưa có dữ liệu", async ({ page }) => {
    await openConsumerPage(page, DONGGOI_PAGE_ID);
    await expect(page.getByText(/Sản phẩm \(\d+\)/)).toBeVisible({ timeout: 25_000 });

    const masp = await pickFirstProduct(page);

    await page.waitForTimeout(3_000);
    const rowCount = await page.locator("tbody tr").count();
    if (rowCount === 0) {
      test.info().annotations.push({
        type: "skip-reason",
        description: `${masp}: tr_dinhmuc_donggoi chưa có dữ liệu`,
      });
    } else {
      await expect(page.locator("tbody tr").first()).toBeVisible();
      await expect(page.getByText("Mã chi tiết").first()).toBeVisible();
    }
  });
});
