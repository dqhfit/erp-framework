import { test, expect } from "@playwright/test";
import { ensureLoggedIn } from "./helpers";

/* Các trang Cấu hình & Hệ thống — kiểm mở được và hiện đúng tiêu đề. */

test("trang Quản lý công ty", async ({ page }) => {
  await ensureLoggedIn(page);
  await page.goto("/settings/companies");
  await expect(
    page.getByRole("heading", { name: "Quản lý công ty" }),
  ).toBeVisible();
});

test("trang Cấu hình Embedding", async ({ page }) => {
  await ensureLoggedIn(page);
  await page.goto("/settings/embedding");
  await expect(
    page.getByRole("heading", { name: "Cấu hình Embedding" }),
  ).toBeVisible();
});

test("trang Nhúng builder (Embed)", async ({ page }) => {
  await ensureLoggedIn(page);
  await page.goto("/settings/embed");
  await expect(
    page.getByRole("heading", { name: /Nhúng builder/ }),
  ).toBeVisible();
});

test("trang Xuất / Nhập cấu hình", async ({ page }) => {
  await ensureLoggedIn(page);
  await page.goto("/settings/transfer");
  await expect(
    page.getByRole("heading", { name: /Xuất \/ Nhập/ }),
  ).toBeVisible();
});

test("trang Plugin", async ({ page }) => {
  await ensureLoggedIn(page);
  await page.goto("/settings/plugins");
  await expect(page.getByRole("heading", { name: "Plugin" })).toBeVisible();
});

test("trang LLM và MCP mở được", async ({ page }) => {
  await ensureLoggedIn(page);
  await page.goto("/settings/llm");
  await expect(page).toHaveURL(/\/settings\/llm/);
  await page.goto("/settings/mcp");
  await expect(page).toHaveURL(/\/settings\/mcp/);
});
