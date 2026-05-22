import { test, expect } from "@playwright/test";
import { ensureLoggedIn, EMAIL } from "./helpers";

/* Xác thực — đăng ký admin đầu, đăng nhập, từ chối sai mật khẩu, giữ phiên. */

test("đăng ký/đăng nhập admin → vào được app", async ({ page }) => {
  await ensureLoggedIn(page);
  await expect(
    page.getByRole("link", { name: "Khách hàng", exact: true }),
  ).toBeVisible();
});

test("sai mật khẩu bị từ chối", async ({ page }) => {
  await ensureLoggedIn(page);            // bảo đảm tài khoản đã tồn tại
  await page.context().clearCookies();
  await page.goto("/");
  await page.getByPlaceholder("ban@congty.com").fill(EMAIL);
  await page.getByPlaceholder("••••••••").fill("sai-mat-khau-khong-dung");
  await page.getByRole("button", { name: "Đăng nhập" }).click();
  // Vẫn ở màn hình đăng nhập, không vào được app.
  await expect(page.getByRole("heading", { name: "Đăng nhập" })).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Khách hàng", exact: true }),
  ).toHaveCount(0);
});

test("phiên giữ nguyên khi tải lại trang", async ({ page }) => {
  await ensureLoggedIn(page);
  await page.reload();
  await expect(
    page.getByRole("link", { name: "Khách hàng", exact: true }),
  ).toBeVisible();
});
