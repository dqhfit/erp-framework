import { expect, test } from "@playwright/test";

/* Smoke test — không cần backend. Chưa có phiên → AuthGate hiện
   màn hình đăng nhập. Kiểm luồng UI cốt lõi (gate + toggle form). */

test("hiện màn hình đăng nhập khi chưa có phiên", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Đăng nhập" })).toBeVisible();
});

test("chuyển qua lại giữa đăng nhập và đăng ký", async ({ page }) => {
  // Smoke chạy app-only nên mock đúng response tRPC tối thiểu:
  // mở đăng ký nhưng vẫn trả UNAUTHORIZED cho auth.me.
  // Pattern rộng hơn vì app có thể batch nhiều lần gọi trong 1 request
  // (vd: registrationOpen,auth.me,registrationOpen,auth.me?batch=1).
  await page.route("**/trpc/**registrationOpen**", async (route) => {
    const url = route.request().url();
    const count = (url.match(/registrationOpen/g) ?? []).length;
    const mockOpen = { result: { data: { open: true } } };
    const mockUnauth = {
      error: {
        message: "Cần đăng nhập",
        code: -32001,
        data: { code: "UNAUTHORIZED", httpStatus: 401, path: "auth.me" },
      },
    };
    const body = [];
    for (let i = 0; i < count; i++) body.push(mockOpen, mockUnauth);
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  // Sang form đăng ký.
  await page.getByRole("button", { name: /Tạo tài khoản quản trị/ }).click();
  await expect(page.getByRole("heading", { name: "Tạo tài khoản quản trị" })).toBeVisible();
  // Form đăng ký có thêm ô "Tên hiển thị".
  await expect(page.getByText("Tên hiển thị")).toBeVisible();
  // Quay lại form đăng nhập.
  await page.getByRole("button", { name: /Đã có tài khoản/ }).click();
  await expect(page.getByRole("heading", { name: "Đăng nhập" })).toBeVisible();
});

test("nút đăng nhập hiển thị và bấm được", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const submit = page.getByRole("button", { name: "Đăng nhập" });
  await expect(submit).toBeEnabled();
});
