import { test, expect } from "@playwright/test";
import { ensureLoggedIn } from "./helpers";

/* Điều hướng — trang chủ, Command Palette, Nhật ký & Chi phí. */

test("trang chủ hiển thị thống kê đối tượng", async ({ page }) => {
  await ensureLoggedIn(page);
  await page.goto("/");
  await expect(page.getByText("Workflows", { exact: true })).toBeVisible();
});

test("Command Palette điều hướng được", async ({ page }) => {
  await ensureLoggedIn(page);
  await page.goto("/");
  // Mở Command Palette qua nút tìm kiếm ở Topbar.
  await page.getByRole("button", { name: /Tìm hoặc gõ lệnh/ }).click();
  await page.keyboard.type("Khách hàng");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/entities\//);
});

test("mở trang Nhật ký & Chi phí", async ({ page }) => {
  await ensureLoggedIn(page);
  await page.goto("/activity");
  await expect(
    page.getByRole("heading", { name: "Nhật ký & Chi phí" }),
  ).toBeVisible();
});
