import { test, expect } from "@playwright/test";
import { ensureLoggedIn } from "./helpers";

/* Workflow — designer (palette node) + panel Chạy thử / Vận hành. */

async function openFirstWorkflow(page: import("@playwright/test").Page): Promise<boolean> {
  const wf = page.locator('a[href^="/workflows/"]').first();
  if (await wf.count() === 0) return false;
  await wf.click();
  await expect(page).toHaveURL(/\/workflows\//);
  return true;
}

test("mở workflow → designer hiện palette node", async ({ page }) => {
  await ensureLoggedIn(page);
  if (!(await openFirstWorkflow(page))) test.skip(true, "Chưa seed workflow");
  await expect(page.getByText("Nodes", { exact: true })).toBeVisible();
});

test("workflow designer có nút Chạy thử / Vận hành", async ({ page }) => {
  await ensureLoggedIn(page);
  if (!(await openFirstWorkflow(page))) test.skip(true, "Chưa seed workflow");
  await expect(
    page.getByRole("button", { name: /Chạy thử \/ Vận hành/ }),
  ).toBeVisible();
});
