import { describe, expect, it } from "vitest";
import { permissionsOf, roleCan } from "./permissions";

describe("roleCan", () => {
  it("admin có mọi quyền trên mọi object", () => {
    expect(roleCan("admin", "delete", "rbac")).toBe(true);
    expect(roleCan("admin", "edit", "settings")).toBe(true);
    expect(roleCan("admin", "run", "workflow")).toBe(true);
  });

  it("editor sửa/chạy được entity nhưng không xoá", () => {
    expect(roleCan("editor", "edit", "entity")).toBe(true);
    expect(roleCan("editor", "run", "entity")).toBe(true);
    expect(roleCan("editor", "delete", "entity")).toBe(false);
  });

  it("editor không đổi được cấu hình hệ thống", () => {
    expect(roleCan("editor", "edit", "settings")).toBe(false);
    expect(roleCan("editor", "edit", "rbac")).toBe(false);
  });

  it("viewer chỉ xem mọi thứ + chạy workflow/agent", () => {
    expect(roleCan("viewer", "view", "entity")).toBe(true);
    expect(roleCan("viewer", "run", "workflow")).toBe(true);
    expect(roleCan("viewer", "run", "agent")).toBe(true);
    expect(roleCan("viewer", "create", "entity")).toBe(false);
    expect(roleCan("viewer", "edit", "page")).toBe(false);
  });
});

describe("permissionsOf", () => {
  it("admin có nhiều quyền hơn editor, editor hơn viewer", () => {
    expect(permissionsOf("admin").length).toBeGreaterThan(permissionsOf("editor").length);
    expect(permissionsOf("editor").length).toBeGreaterThan(permissionsOf("viewer").length);
  });

  it("mọi quyền của viewer đều nằm trong tập quyền của admin", () => {
    const admin = new Set(permissionsOf("admin"));
    expect(permissionsOf("viewer").every((p) => admin.has(p))).toBe(true);
  });
});
