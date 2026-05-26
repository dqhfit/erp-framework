import { describe, expect, it } from "vitest";
import { fieldCan, permissionsOf, roleCan } from "./permissions";

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

  /* P1.2 — feedback ObjectType (mọi user gửi phản hồi được). */
  describe("feedback (P1.2)", () => {
    it("viewer create:feedback (gửi phản hồi sản phẩm)", () => {
      expect(roleCan("viewer", "create", "feedback")).toBe(true);
    });
    it("viewer KHÔNG edit/delete feedback (chỉ author qua canMutate)", () => {
      expect(roleCan("viewer", "edit", "feedback")).toBe(false);
      expect(roleCan("viewer", "delete", "feedback")).toBe(false);
    });
    it("editor full CRUD trên feedback", () => {
      expect(roleCan("editor", "create", "feedback")).toBe(true);
      expect(roleCan("editor", "edit", "feedback")).toBe(true);
      expect(roleCan("editor", "delete", "feedback")).toBe(true);
    });
  });

  /* P2.2 — ObjectType mới: tool, comment, view, notification, member. */
  describe("ObjectType mới (P2.2)", () => {
    it("viewer CRUD đầy đủ trên comment/view personal (filter ở handler)", () => {
      expect(roleCan("viewer", "create", "comment")).toBe(true);
      expect(roleCan("viewer", "edit", "comment")).toBe(true);
      expect(roleCan("viewer", "delete", "comment")).toBe(true);
      expect(roleCan("viewer", "create", "view")).toBe(true);
      expect(roleCan("viewer", "edit", "view")).toBe(true);
      expect(roleCan("viewer", "delete", "view")).toBe(true);
    });

    it("viewer edit:notification (mark own read)", () => {
      expect(roleCan("viewer", "edit", "notification")).toBe(true);
    });

    it("editor edit:tool (rescan/spawn/enable)", () => {
      expect(roleCan("editor", "edit", "tool")).toBe(true);
    });

    it("viewer KHÔNG edit:tool", () => {
      expect(roleCan("viewer", "edit", "tool")).toBe(false);
    });

    it("admin có quyền member operations (approve)", () => {
      expect(roleCan("admin", "approve", "member")).toBe(true);
      expect(roleCan("admin", "manage_members", "agent")).toBe(true);
    });

    it("viewer KHÔNG manage_members hoặc approve", () => {
      expect(roleCan("viewer", "manage_members", "agent")).toBe(false);
      expect(roleCan("viewer", "approve", "member")).toBe(false);
    });
  });

  /* P2.2 — Action mới: publish, manage_members, approve. */
  describe("Action mới (P2.2)", () => {
    it("editor publish được entity/page/workflow", () => {
      expect(roleCan("editor", "publish", "entity")).toBe(true);
      expect(roleCan("editor", "publish", "page")).toBe(true);
      expect(roleCan("editor", "publish", "workflow")).toBe(true);
    });

    it("viewer KHÔNG publish được gì", () => {
      expect(roleCan("viewer", "publish", "workflow")).toBe(false);
      expect(roleCan("viewer", "publish", "entity")).toBe(false);
    });

    it("editor manage_members:agent (share agent)", () => {
      expect(roleCan("editor", "manage_members", "agent")).toBe(true);
    });
  });
});

/* P3 — field-level RBAC via fieldCan. */
describe("fieldCan", () => {
  it("Default (cờ vắng) cho phép mọi role", () => {
    expect(fieldCan("viewer", "read", {})).toBe(true);
    expect(fieldCan("viewer", "write", {})).toBe(true);
  });

  it("Empty array cũng coi như default (allow all)", () => {
    expect(fieldCan("viewer", "read", { readableBy: [] })).toBe(true);
  });

  it("writableBy: ['admin'] chỉ admin write được", () => {
    expect(fieldCan("admin", "write", { writableBy: ["admin"] })).toBe(true);
    expect(fieldCan("editor", "write", { writableBy: ["admin"] })).toBe(false);
    expect(fieldCan("viewer", "write", { writableBy: ["admin"] })).toBe(false);
  });

  it("readableBy: ['admin','editor'] viewer bị ẩn field", () => {
    expect(fieldCan("admin", "read", { readableBy: ["admin", "editor"] })).toBe(true);
    expect(fieldCan("editor", "read", { readableBy: ["admin", "editor"] })).toBe(true);
    expect(fieldCan("viewer", "read", { readableBy: ["admin", "editor"] })).toBe(false);
  });
});

/* Invariants giữ qua các sprint mở rộng matrix. */
describe("Matrix invariants", () => {
  it("admin có ≥ permissions của editor", () => {
    const adminSet = new Set(permissionsOf("admin"));
    expect(permissionsOf("editor").every((p) => adminSet.has(p))).toBe(true);
  });

  it("admin có ≥ permissions của viewer", () => {
    const adminSet = new Set(permissionsOf("admin"));
    expect(permissionsOf("viewer").every((p) => adminSet.has(p))).toBe(true);
  });

  it("admin có nhiều quyền hơn editor", () => {
    expect(permissionsOf("admin").length).toBeGreaterThan(permissionsOf("editor").length);
  });
});
