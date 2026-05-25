/* ==========================================================
   pages-router.test.ts — Unit test pages CRUD.
   ========================================================== */
import { describe, it, expect } from "vitest";
import { pagesRouter } from "./pages-router";
import { createCallerFactory } from "./trpc";
import {
  makeMockCtx, makeMockDb, makeMockUser, assertThrowsTRPCError,
} from "./test-helpers";

const caller = createCallerFactory(pagesRouter);
const VALID_UUID = "11111111-1111-4111-8111-111111111111";

describe("pages-router", () => {
  describe("list", () => {
    it("trả mảng pages của company", async () => {
      const { db, enqueueSelect } = makeMockDb();
      enqueueSelect([{ id: VALID_UUID, name: "dashboard", label: "Dashboard" }]);
      const ctx = makeMockCtx({ db });
      const r = await caller(ctx).list();
      expect(r).toHaveLength(1);
    });

    it("RBAC: viewer xem được (view:page)", async () => {
      const { db, enqueueSelect } = makeMockDb();
      enqueueSelect([]);
      const ctx = makeMockCtx({ db, user: makeMockUser({ role: "viewer" }) });
      await caller(ctx).list();
    });
  });

  describe("get", () => {
    it("trả page nếu tồn tại", async () => {
      const { db, enqueueSelect } = makeMockDb();
      const row = { id: VALID_UUID, name: "p1", label: "Page 1" };
      enqueueSelect([row]);
      const r = await caller(makeMockCtx({ db })).get(VALID_UUID);
      expect(r).toEqual(row);
    });

    it("trả null nếu không tìm thấy", async () => {
      const { db, enqueueSelect } = makeMockDb();
      enqueueSelect([]);
      const r = await caller(makeMockCtx({ db })).get(VALID_UUID);
      expect(r).toBeNull();
    });
  });

  describe("save", () => {
    it("upsert: insert mới khi không có id", async () => {
      const { db, enqueueInsert } = makeMockDb();
      enqueueInsert([{ id: VALID_UUID, name: "p", label: "P" }]);
      const r = await caller(makeMockCtx({ db })).save({
        name: "p", label: "P",
      });
      expect(r?.id).toBe(VALID_UUID);
    });

    it("upsert: update khi id đã có + companyId khớp", async () => {
      const { db, enqueueSelect, enqueueUpdate } = makeMockDb();
      enqueueSelect([{ companyId: "co_test_1" }]);
      enqueueUpdate([{ id: VALID_UUID, name: "p2", label: "P2" }]);
      const r = await caller(makeMockCtx({ db })).save({
        id: VALID_UUID, name: "p2", label: "P2",
      });
      expect(r?.label).toBe("P2");
    });

    it("FORBIDDEN: page thuộc company khác", async () => {
      const { db, enqueueSelect } = makeMockDb();
      enqueueSelect([{ companyId: "co_other" }]);
      const ctx = makeMockCtx({ db });
      await assertThrowsTRPCError(
        () => caller(ctx).save({ id: VALID_UUID, name: "p", label: "P" }),
        "FORBIDDEN",
      );
    });

    it("RBAC: viewer không có edit:page", async () => {
      const ctx = makeMockCtx({ user: makeMockUser({ role: "viewer" }) });
      await assertThrowsTRPCError(
        () => caller(ctx).save({ name: "p", label: "P" }),
        "FORBIDDEN",
      );
    });
  });

  describe("delete", () => {
    it("admin xoá được", async () => {
      const { db, ops } = makeMockDb();
      await caller(makeMockCtx({ db })).delete(VALID_UUID);
      expect(ops.some((o) => o.kind === "delete")).toBe(true);
    });

    it("viewer không có delete:page → FORBIDDEN", async () => {
      const ctx = makeMockCtx({ user: makeMockUser({ role: "viewer" }) });
      await assertThrowsTRPCError(
        () => caller(ctx).delete(VALID_UUID),
        "FORBIDDEN",
      );
    });
  });
});
