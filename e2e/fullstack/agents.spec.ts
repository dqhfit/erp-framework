import { test, expect, type Page } from "@playwright/test";
import { ensureLoggedIn } from "./helpers";

/* Agent — trang cấu hình + khung chat Trợ lý. */

async function openFirstAgent(page: Page): Promise<boolean> {
  const a = page.locator('a[href^="/agents/"]').first();
  if (await a.count() === 0) return false;
  await a.click();
  await expect(page).toHaveURL(/\/agents\//);
  return true;
}

test("mở agent → trang cấu hình hiển thị", async ({ page }) => {
  await ensureLoggedIn(page);
  if (!(await openFirstAgent(page))) test.skip(true, "Chưa seed agent");
  await expect(page.getByRole("heading").first()).toBeVisible();
});

test("sửa tên agent + lưu", async ({ page }) => {
  await ensureLoggedIn(page);
  if (!(await openFirstAgent(page))) test.skip(true, "Chưa seed agent");
  const name = "Agent E2E " + Date.now().toString(36);
  await page.getByRole("textbox").first().fill(name);
  await expect(page.getByRole("heading", { name })).toBeVisible();
  await page.getByRole("button", { name: "Lưu", exact: true }).click();
});

test("mở khung chat Trợ lý từ trang chủ", async ({ page }) => {
  await ensureLoggedIn(page);
  await page.goto("/");
  await page.getByRole("button", { name: /Phác thảo bằng AI/ }).click();
  // AgentPanel mở — tin nhắn chào mừng chứa "Trợ lý ERP".
  await expect(page.getByText(/Trợ lý ERP/).first()).toBeVisible();
});
