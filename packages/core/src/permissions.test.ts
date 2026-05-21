import { describe, it, expect } from "vitest";
import { roleCan } from "./permissions";

describe("roleCan", () => {
  it("admin có mọi quyền", () => {
    expect(roleCan("admin", "delete", "entity")).toBe(true);
    expect(roleCan("admin", "edit", "rbac")).toBe(true);
    expect(roleCan("admin", "create", "settings")).toBe(true);
  });

  it("editor: tạo/sửa/chạy entity nhưng KHÔNG xoá", () => {
    expect(roleCan("editor", "create", "entity")).toBe(true);
    expect(roleCan("editor", "edit", "workflow")).toBe(true);
    expect(roleCan("editor", "run", "agent")).toBe(true);
    expect(roleCan("editor", "delete", "entity")).toBe(false);
    expect(roleCan("editor", "edit", "settings")).toBe(false);
  });

  it("editor xem được mọi loại object", () => {
    expect(roleCan("editor", "view", "activity")).toBe(true);
    expect(roleCan("editor", "view", "rbac")).toBe(true);
  });

  it("viewer chỉ xem + chạy workflow/agent", () => {
    expect(roleCan("viewer", "view", "entity")).toBe(true);
    expect(roleCan("viewer", "run", "workflow")).toBe(true);
    expect(roleCan("viewer", "run", "agent")).toBe(true);
    expect(roleCan("viewer", "create", "entity")).toBe(false);
    expect(roleCan("viewer", "edit", "page")).toBe(false);
    expect(roleCan("viewer", "delete", "workflow")).toBe(false);
    expect(roleCan("viewer", "run", "entity")).toBe(false);
  });
});
