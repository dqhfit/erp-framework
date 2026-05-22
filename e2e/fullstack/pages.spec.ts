import { test, expect } from "@playwright/test";
import { ensureLoggedIn, switchToConsumer } from "./helpers";

/* Page — mở designer + render ở chế độ Người dùng. */

test("mở page đã seed → vào trang designer", async ({ page }) => {
  await ensureLoggedIn(page);
  const pageLink = page.locator('a[href^="/pages/"]').first();
  if (await pageLink.count() === 0) test.skip(true, "Chưa seed page nào");
  await pageLink.click();
  await expect(page).toHaveURL(/\/pages\//);
});

test("chế độ Người dùng — ConsumerPage render", async ({ page }) => {
  await ensureLoggedIn(page);
  const pageLink = page.locator('a[href^="/pages/"]').first();
  if (await pageLink.count() === 0) test.skip(true, "Chưa seed page nào");
  await pageLink.click();
  await expect(page).toHaveURL(/\/pages\//);
  await switchToConsumer(page);
  await expect(page.getByText(/Chế độ người dùng/)).toBeVisible();
});
