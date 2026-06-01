import { test, expect, type Page } from "@playwright/test";
import { ensureLoggedIn, openSidebarLink } from "./helpers";

/* Agentic RAG — P3 source routing opt-in.
   Toggle "Cho phép agent tra cứu (records_search)" ở tab MCP của Entity
   Designer ghi meta.agentSearchable qua mutation entities.setAgentSearchable
   và phải BỀN sau reload (deny-by-default → bật mới cho agent truy).
   Deterministic — không cần LLM. */

const TOGGLE = "Cho phép agent tra cứu";

/** Switch: <label> chứa <span track onClick> + <span text>. Track là span đầu. */
function track(page: Page) {
  return page.locator("label", { hasText: TOGGLE }).locator("span").first();
}
const label = (page: Page) => page.locator("label", { hasText: TOGGLE });

/** Mở tab "MCP bindings" của designer (đang ở route /entities/$id). */
async function openMcpTab(page: Page) {
  await page.getByRole("button", { name: "MCP bindings" }).click();
  // Chờ toggle tải xong trạng thái (hết disabled → label hết opacity-50).
  await expect(label(page)).not.toHaveClass(/opacity-50/, { timeout: 10_000 });
}

/** Bấm toggle rồi chờ mutation trả về (tránh reload trước khi DB ghi). */
async function clickAndPersist(page: Page) {
  await Promise.all([
    page.waitForResponse((r) => r.url().includes("setAgentSearchable") && r.status() === 200),
    track(page).click(),
  ]);
}

test("P3: agentSearchable bật/tắt bền sau reload", async ({ page }) => {
  await ensureLoggedIn(page);
  await openSidebarLink(page, "Khách hàng");
  await expect(page).toHaveURL(/\/entities\//);
  await openMcpTab(page);

  // ── BẬT (nếu chưa) → kỳ vọng track bg-accent ──
  const onNow = /bg-accent/.test((await track(page).getAttribute("class")) ?? "");
  if (!onNow) await clickAndPersist(page);
  await expect(track(page)).toHaveClass(/bg-accent/);

  // Reload → mở lại tab MCP → vẫn BẬT (đã ghi DB).
  await page.reload();
  await openMcpTab(page);
  await expect(track(page)).toHaveClass(/bg-accent/);

  // ── TẮT → off, reload → vẫn off (trả DB về sạch cho lần chạy sau) ──
  await clickAndPersist(page);
  await expect(track(page)).not.toHaveClass(/bg-accent/);
  await page.reload();
  await openMcpTab(page);
  await expect(track(page)).not.toHaveClass(/bg-accent/);
});
