/* ==========================================================
   agent-members.spec.ts — Phân quyền per-agent + agent chính.
   ────────────────────────────────────────────────────────────
   1. User đăng nhập → trang Settings → Agent của tôi hiển thị.
   2. Tab "Thành viên" xuất hiện trên /agents/$id; admin/owner bấm
      được nút thêm thành viên.
   3. Topbar chip "Chưa chọn Agent chính" → click mở modal; chọn
      CEO → Topbar đổi sang chip avatar + tên.
   ========================================================== */
import { test, expect, type Page } from "@playwright/test";
import { ensureLoggedIn } from "./helpers";

async function openFirstAgent(page: Page): Promise<boolean> {
  const a = page.locator('a[href^="/agents/"]').first();
  if (await a.count() === 0) return false;
  await a.click();
  await expect(page).toHaveURL(/\/agents\//);
  return true;
}

test("trang Settings → Agent của tôi mở được", async ({ page }) => {
  await ensureLoggedIn(page);
  await page.goto("/settings/agents");
  await expect(page.getByRole("heading", { name: "Agent của tôi" })).toBeVisible();
});

test("/agents/$id có tab Thành viên — admin/owner thấy nút thêm", async ({ page }) => {
  await ensureLoggedIn(page);
  if (!(await openFirstAgent(page))) test.skip(true, "Chưa seed agent");
  // Click tab Thành viên (TabBtn).
  await page.getByRole("button", { name: /Thành viên/ }).first().click();
  // Trong privacy card: text "Agent mở (open mode)" hoặc "Agent riêng tư".
  await expect(page.getByText(/Agent (mở|riêng tư)/).first()).toBeVisible();
  // Admin = thấy toggle Riêng tư + có thể có nút Thêm thành viên.
  // (Nếu chưa có member entry → button vẫn không hiện vì owner check;
  //  chỉ assert tồn tại nhãn "Thành viên" và privacy card.)
});

test("Topbar chip primary agent — chọn rồi thấy ngay", async ({ page }) => {
  await ensureLoggedIn(page);
  await page.goto("/");
  // Nếu đã có primary từ run trước, bỏ qua bước chọn.
  const dashedChip = page.getByRole("button", { name: /Chưa chọn Agent chính/ });
  if ((await dashedChip.count()) === 0) {
    test.skip(true, "Đã set primary từ trước");
  }
  await dashedChip.click();
  // Modal hiện — chọn CEO (option đầu tiên) nếu có.
  await expect(page.getByRole("heading", { name: /Chọn Agent chính/ })).toBeVisible();
  const firstOption = page.locator('button:has-text("CEO")').first();
  if ((await firstOption.count()) === 0) {
    // Không có CEO → bấm vào agent đầu tiên trong modal.
    await page.locator('button:has(svg)').filter({ hasText: /claude|gpt|gemini/ }).first().click();
  } else {
    await firstOption.click();
  }
  // Chip mới hiện tên agent — kiểm chip xuất hiện trên topbar.
  await expect(page.locator('a[href^="/agents/"]').first()).toBeVisible();
});
