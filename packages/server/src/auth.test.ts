import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword, newSessionToken } from "./auth";

describe("auth", () => {
  it("hashPassword trả định dạng salt:hash (hex)", async () => {
    const h = await hashPassword("matkhau123");
    expect(h).toMatch(/^[0-9a-f]+:[0-9a-f]+$/);
  });

  it("verifyPassword đúng mật khẩu → true", async () => {
    const h = await hashPassword("matkhau123");
    expect(await verifyPassword("matkhau123", h)).toBe(true);
  });

  it("verifyPassword sai mật khẩu → false", async () => {
    const h = await hashPassword("matkhau123");
    expect(await verifyPassword("saibet", h)).toBe(false);
  });

  it("hai lần hash cùng mật khẩu khác nhau (salt ngẫu nhiên)", async () => {
    expect(await hashPassword("x")).not.toBe(await hashPassword("x"));
  });

  it("newSessionToken: đủ dài, mỗi lần khác nhau", () => {
    const a = newSessionToken();
    const b = newSessionToken();
    expect(a.length).toBeGreaterThan(20);
    expect(a).not.toBe(b);
  });
});
