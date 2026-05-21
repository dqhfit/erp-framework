import { test, expect } from "@playwright/test";

/* Smoke test — không cần backend. Chưa có phiên → AuthGate hiện
   màn hình đăng nhập. Kiểm luồng UI cốt lõi (gate + toggle form). */

test("hiện màn hình đăng nhập khi chưa có phiên", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Đăng nhập" }),
  ).toBeVisible();
});

test("chuyển qua lại giữa đăng nhập và đăng ký", async ({ page }) => {
  await page.goto("/");
  // Sang form đăng ký.
  await page.getByRole("button", { name: /Tạo tài khoản quản trị/ }).click();
  await expect(
    page.getByRole("heading", { name: "Tạo tài khoản quản trị" }),
  ).toBeVisible();
  // Form đăng ký có thêm ô "Tên hiển thị".
  await expect(page.getByText("Tên hiển thị")).toBeVisible();
  // Quay lại form đăng nhập.
  await page.getByRole("button", { name: /Đã có tài khoản/ }).click();
  await expect(
    page.getByRole("heading", { name: "Đăng nhập" }),
  ).toBeVisible();
});

test("nút đăng nhập hiển thị và bấm được", async ({ page }) => {
  await page.goto("/");
  const submit = page.getByRole("button", { name: "Đăng nhập" });
  await expect(submit).toBeEnabled();
});
