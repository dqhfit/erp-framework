import { test, expect } from "@playwright/test";
import { ensureLoggedIn, switchToConsumer, openSidebarLink } from "./helpers";

/* Entity — designer + chế độ Người dùng (xem/thêm bản ghi). */

test("mở entity đã seed → vào trang designer", async ({ page }) => {
  await ensureLoggedIn(page);
  await openSidebarLink(page, "Khách hàng");
  await expect(page).toHaveURL(/\/entities\//);
});

test("chế độ Người dùng — màn hình Dữ liệu hiện nút thêm bản ghi", async ({ page }) => {
  await ensureLoggedIn(page);
  await openSidebarLink(page, "Khách hàng");
  await expect(page).toHaveURL(/\/entities\//);
  await switchToConsumer(page);
  await expect(page.getByRole("button", { name: /Thêm bản ghi/ })).toBeVisible();
});

test("chế độ Người dùng — mở được form thêm bản ghi", async ({ page }) => {
  await ensureLoggedIn(page);
  await openSidebarLink(page, "Khách hàng");
  await switchToConsumer(page);
  const addBtn = page.getByRole("button", { name: /Thêm bản ghi/ });
  await addBtn.waitFor({ state: "visible", timeout: 8000 });
  await addBtn.click();
  // Drawer "Thêm …" mở ra — kiểm nút Lưu của form.
  await expect(page.getByRole("button", { name: "Lưu", exact: true })).toBeVisible();
});

test("danh sách Entities hiển thị", async ({ page }) => {
  await ensureLoggedIn(page);
  await page.goto("/entities");
  await expect(page.getByRole("heading", { name: "Entities" })).toBeVisible();
});
