import { test, expect } from "@playwright/test";
import { ensureLoggedIn } from "./helpers";

/* RBAC — trang Vai trò & Quyền: ma trận + đổi vai trò.
   (Không test đăng nhập đa vai trò: auth.register chỉ cho user đầu;
   enforcement có unit test permissions.test.ts.) */

test("trang RBAC hiện ma trận quyền", async ({ page }) => {
  await ensureLoggedIn(page);
  await page.goto("/settings/rbac");
  await expect(
    page.getByRole("heading", { name: /Vai trò & Quyền/ }),
  ).toBeVisible();
  await expect(page.getByRole("table")).toBeVisible();
});

test("đổi vai trò cập nhật ma trận quyền", async ({ page }) => {
  await ensureLoggedIn(page);
  await page.goto("/settings/rbac");
  await page.getByRole("button", { name: /Người xem/ }).click();
  await expect(page.getByText(/Ma trận quyền/)).toContainText("Người xem");
});
