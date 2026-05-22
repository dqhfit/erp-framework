import { test, expect } from "@playwright/test";
import { ensureLoggedIn } from "./helpers";

/* Governance — Phê duyệt + Sơ đồ tổ chức. */

test("trang Phê duyệt mở được", async ({ page }) => {
  await ensureLoggedIn(page);
  await page.goto("/approvals");
  await expect(
    page.getByRole("heading", { name: /Phê duyệt/ }),
  ).toBeVisible();
});

test("trang Sơ đồ tổ chức mở được", async ({ page }) => {
  await ensureLoggedIn(page);
  await page.goto("/org-chart");
  await expect(
    page.getByRole("heading", { name: /Sơ đồ phân cấp agent/ }),
  ).toBeVisible();
});
