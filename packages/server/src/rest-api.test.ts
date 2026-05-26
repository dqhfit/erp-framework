/* ==========================================================
   rest-api.test.ts — Regression test cho REST API scope (P1.3).
   Trước đây hasScope() trả true khi scopes=[] (empty = full) →
   mọi API key tạo mặc định có toàn quyền. Test chốt deny-by-default.
   ========================================================== */
import { describe, expect, it } from "vitest";
import { hasScope } from "./rest-api";

describe("hasScope (P1.3 deny-by-default)", () => {
  it("empty scopes = deny (KHÔNG còn full access)", () => {
    expect(hasScope({ companyId: "co", scopes: [] }, "orders", "read")).toBe(false);
    expect(hasScope({ companyId: "co", scopes: [] }, "orders", "write")).toBe(false);
  });

  it('"*" scope = full access cho mọi entity × mọi action', () => {
    const ctx = { companyId: "co", scopes: ["*"] };
    expect(hasScope(ctx, "orders", "read")).toBe(true);
    expect(hasScope(ctx, "anyentity", "write")).toBe(true);
  });

  it('"entity:<name>:<action>" chỉ match đúng entity + action', () => {
    const ctx = { companyId: "co", scopes: ["entity:orders:read"] };
    expect(hasScope(ctx, "orders", "read")).toBe(true);
    expect(hasScope(ctx, "orders", "write")).toBe(false);
    expect(hasScope(ctx, "users", "read")).toBe(false);
  });

  it('"entity:*:read" cho phép đọc mọi entity nhưng KHÔNG write', () => {
    const ctx = { companyId: "co", scopes: ["entity:*:read"] };
    expect(hasScope(ctx, "orders", "read")).toBe(true);
    expect(hasScope(ctx, "users", "read")).toBe(true);
    expect(hasScope(ctx, "orders", "write")).toBe(false);
  });

  it("Nhiều scope: union", () => {
    const ctx = {
      companyId: "co",
      scopes: ["entity:orders:read", "entity:orders:write", "entity:users:read"],
    };
    expect(hasScope(ctx, "orders", "read")).toBe(true);
    expect(hasScope(ctx, "orders", "write")).toBe(true);
    expect(hasScope(ctx, "users", "read")).toBe(true);
    expect(hasScope(ctx, "users", "write")).toBe(false);
  });

  it("Scope sai format → deny (regex trong api-keys-router chặn từ create, defensive ở runtime)", () => {
    // hasScope dùng so sánh chuỗi đơn — scope rác sẽ không match pattern hợp lệ.
    const ctx = { companyId: "co", scopes: ["garbage", "entity:orders"] };
    expect(hasScope(ctx, "orders", "read")).toBe(false);
  });
});
