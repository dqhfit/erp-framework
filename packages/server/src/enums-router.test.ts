/* ==========================================================
   enums-router.test.ts — Unit test cho enums router (Danh mục).
   Pattern: tạo caller với mock ctx, enqueue DB result trước mỗi gọi,
   verify return value + RBAC + validation.
   ========================================================== */
import { describe, it, expect } from "vitest";
import { enumsRouter } from "./enums-router";
import { createCallerFactory } from "./trpc";
import {
  makeMockCtx, makeMockDb, makeMockUser, assertThrowsTRPCError,
} from "./test-helpers";

const caller = createCallerFactory(enumsRouter);
const VALID_UUID = "11111111-1111-4111-8111-111111111111";

describe("enums-router", () => {
  describe("list", () => {
    it("trả mảng enum của company hiện tại", async () => {
      const { db, enqueueSelect } = makeMockDb();
      enqueueSelect([
        {
          id: VALID_UUID, companyId: "co_test_1", name: "order_status",
          label: "Trạng thái đơn", values: [{ value: "new", label: "Mới" }],
          enabled: true,
        },
        {
          id: "e2", companyId: "co_test_1", name: "priority",
          label: "Ưu tiên", values: [], enabled: true,
        },
      ]);
      const ctx = makeMockCtx({ db, user: makeMockUser({ role: "viewer" }) });
      const r = await caller(ctx).list();
      expect(r).toHaveLength(2);
      expect(r[0]?.name).toBe("order_status");
    });

    it("RBAC: user chưa thuộc company → FORBIDDEN", async () => {
      const ctx = makeMockCtx({
        user: makeMockUser({ companyId: null }),
      });
      await assertThrowsTRPCError(() => caller(ctx).list(), "FORBIDDEN");
    });

    it("RBAC: viewer xem được (view:enum)", async () => {
      const { db, enqueueSelect } = makeMockDb();
      enqueueSelect([]);
      const ctx = makeMockCtx({ db, user: makeMockUser({ role: "viewer" }) });
      const r = await caller(ctx).list();
      expect(r).toEqual([]);
    });
  });

  describe("get", () => {
    it("trả enum nếu tồn tại trong company", async () => {
      const { db, enqueueSelect } = makeMockDb();
      const row = {
        id: VALID_UUID, companyId: "co_test_1", name: "color",
        label: "Màu sắc", values: [{ value: "red", label: "Đỏ" }],
        enabled: true,
      };
      enqueueSelect([row]);
      const ctx = makeMockCtx({ db });
      const r = await caller(ctx).get(VALID_UUID);
      expect(r).toEqual(row);
    });

    it("trả null nếu không tìm thấy", async () => {
      const { db, enqueueSelect } = makeMockDb();
      enqueueSelect([]);
      const ctx = makeMockCtx({ db });
      const r = await caller(ctx).get(VALID_UUID);
      expect(r).toBeNull();
    });

    it("validation: input phải là UUID hợp lệ", async () => {
      const ctx = makeMockCtx();
      await assertThrowsTRPCError(
        () => caller(ctx).get("not-a-uuid"),
        "BAD_REQUEST",
      );
    });
  });

  describe("save", () => {
    it("tạo mới khi không có row trùng name", async () => {
      const { db, enqueueSelect, enqueueInsert } = makeMockDb();
      enqueueSelect([]);                       // check existing → not found
      enqueueInsert([{ id: "new-id", name: "color" }]);  // insert returning
      const ctx = makeMockCtx({ db });
      const r = await caller(ctx).save({
        name: "color",
        label: "Màu",
        values: [{ value: "red", label: "Đỏ" }],
      });
      expect(r?.id).toBe("new-id");
    });

    it("update khi name đã tồn tại", async () => {
      const { db, enqueueSelect, enqueueUpdate } = makeMockDb();
      enqueueSelect([{ id: "existing-id" }]);   // existing row found
      enqueueUpdate([{ id: "existing-id", name: "color", label: "Mới" }]);
      const ctx = makeMockCtx({ db });
      const r = await caller(ctx).save({
        name: "color",
        label: "Mới",
        values: [],
      });
      expect(r?.label).toBe("Mới");
    });

    it("validation: name phải snake_case bắt đầu bằng chữ", async () => {
      const ctx = makeMockCtx();
      await assertThrowsTRPCError(
        () => caller(ctx).save({
          name: "1_invalid",       // bắt đầu bằng số
          label: "x",
          values: [],
        }),
        "BAD_REQUEST",
      );
    });

    it("RBAC: viewer không có edit:enum → FORBIDDEN", async () => {
      const ctx = makeMockCtx({ user: makeMockUser({ role: "viewer" }) });
      await assertThrowsTRPCError(
        () => caller(ctx).save({ name: "x_y", label: "X", values: [] }),
        "FORBIDDEN",
      );
    });
  });

  describe("setEnabled", () => {
    it("toggle enabled flag", async () => {
      const { db, ops } = makeMockDb();
      const ctx = makeMockCtx({ db });
      const r = await caller(ctx).setEnabled({ id: VALID_UUID, enabled: false });
      expect(r).toEqual({ ok: true });
      expect(ops.some((o) => o.kind === "update")).toBe(true);
    });

    it("RBAC: editor được, viewer không", async () => {
      const ctx = makeMockCtx({ user: makeMockUser({ role: "viewer" }) });
      await assertThrowsTRPCError(
        () => caller(ctx).setEnabled({ id: VALID_UUID, enabled: true }),
        "FORBIDDEN",
      );
    });
  });

  describe("delete", () => {
    it("admin xoá được", async () => {
      const { db, ops } = makeMockDb();
      const ctx = makeMockCtx({ db, user: makeMockUser({ role: "admin" }) });
      await caller(ctx).delete(VALID_UUID);
      expect(ops.some((o) => o.kind === "delete")).toBe(true);
    });

    it("editor cũng được delete:enum (RBAC matrix cấp editor)", async () => {
      const { db, ops } = makeMockDb();
      const ctx = makeMockCtx({ db, user: makeMockUser({ role: "editor" }) });
      await caller(ctx).delete(VALID_UUID);
      expect(ops.some((o) => o.kind === "delete")).toBe(true);
    });

    it("RBAC: viewer KHÔNG có delete:enum", async () => {
      const ctx = makeMockCtx({ user: makeMockUser({ role: "viewer" }) });
      await assertThrowsTRPCError(
        () => caller(ctx).delete(VALID_UUID),
        "FORBIDDEN",
      );
    });
  });
});
