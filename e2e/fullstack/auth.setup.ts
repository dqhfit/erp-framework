/* ==========================================================
   auth.setup.ts — Đăng nhập MỘT lần rồi lưu storageState để mọi test
   tái dùng. Chạy như một "setup project" (xem playwright.fullstack.
   config.ts) → bảo đảm webServer đã lên trước khi login.

   Lý do: endpoint auth.login rate-limit 5 lần/15 phút/IP. Nếu mỗi test
   tự login (context mới = không cookie) thì qua test thứ 5 là bị chặn
   "Quá nhiều lần thử" → cả suite đổ. Login 1 lần ở đây = 1 request duy
   nhất, các test sau dùng cookie sẵn.
   ========================================================== */
import { test as setup } from "@playwright/test";
import { ensureLoggedIn } from "./helpers";

const STORAGE_STATE = "e2e/.auth/state.json";

setup("đăng nhập một lần → lưu session", async ({ page }) => {
  await ensureLoggedIn(page);
  // Lưu cookie (gồm session httpOnly) + localStorage cho các test sau.
  await page.context().storageState({ path: STORAGE_STATE });
});
