/* ==========================================================
   pages-router.test.ts — Unit test pages CRUD.
   ========================================================== */
import { describe, expect, it } from "vitest";
import { pagesRouter } from "./pages-router";
import { assertThrowsTRPCError, makeMockCtx, makeMockDb, makeMockUser } from "./test-helpers";
import { createCallerFactory } from "./trpc";

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
        name: "p",
        label: "P",
      });
      expect(r?.id).toBe(VALID_UUID);
    });

    it("upsert: update khi id đã có + companyId khớp", async () => {
      const { db, enqueueSelect, enqueueUpdate } = makeMockDb();
      enqueueSelect([{ companyId: "co_test_1" }]);
      enqueueUpdate([{ id: VALID_UUID, name: "p2", label: "P2" }]);
      const r = await caller(makeMockCtx({ db })).save({
        id: VALID_UUID,
        name: "p2",
        label: "P2",
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
      await assertThrowsTRPCError(() => caller(ctx).save({ name: "p", label: "P" }), "FORBIDDEN");
    });
  });

  describe("delete", () => {
    it("admin xoá được", async () => {
      // XOÁ MỀM (mig 0081): delete = update set deleted_at + returning({id}).
      const { db, enqueueUpdate, ops } = makeMockDb();
      enqueueUpdate([{ id: VALID_UUID }]);
      await caller(makeMockCtx({ db })).delete(VALID_UUID);
      expect(ops.some((o) => o.kind === "update")).toBe(true);
    });

    it("viewer không có delete:page → FORBIDDEN", async () => {
      const ctx = makeMockCtx({ user: makeMockUser({ role: "viewer" }) });
      await assertThrowsTRPCError(() => caller(ctx).delete(VALID_UUID), "FORBIDDEN");
    });
  });

  describe("setStatus", () => {
    it("gắn cờ built-in cho trang", async () => {
      const { db, enqueueUpdate, ops } = makeMockDb();
      enqueueUpdate([{ id: VALID_UUID, status: "in_progress" }]);
      const r = await caller(makeMockCtx({ db })).setStatus({
        id: VALID_UUID,
        status: "in_progress",
      });
      expect(r.status).toBe("in_progress");
      expect(ops.some((o) => o.kind === "update")).toBe(true);
    });

    it("gỡ cờ (status = null)", async () => {
      const { db, enqueueUpdate } = makeMockDb();
      enqueueUpdate([{ id: VALID_UUID, status: null }]);
      const r = await caller(makeMockCtx({ db })).setStatus({ id: VALID_UUID, status: null });
      expect(r.status).toBeNull();
    });

    it("NOT_FOUND khi trang không tồn tại", async () => {
      const { db, enqueueUpdate } = makeMockDb();
      enqueueUpdate([]);
      await assertThrowsTRPCError(
        () => caller(makeMockCtx({ db })).setStatus({ id: VALID_UUID, status: "done" }),
        "NOT_FOUND",
      );
    });

    it("RBAC: viewer không có edit:page → FORBIDDEN", async () => {
      const ctx = makeMockCtx({ user: makeMockUser({ role: "viewer" }) });
      await assertThrowsTRPCError(
        () => caller(ctx).setStatus({ id: VALID_UUID, status: "new" }),
        "FORBIDDEN",
      );
    });
  });

  describe("cờ tùy chỉnh (page_flags)", () => {
    it("flagSave: tạo cờ mới khi không có id", async () => {
      const { db, enqueueInsert } = makeMockDb();
      enqueueInsert([{ id: VALID_UUID, label: "Ưu tiên", color: "danger" }]);
      const r = await caller(makeMockCtx({ db })).flagSave({ label: "Ưu tiên", color: "danger" });
      expect(r?.label).toBe("Ưu tiên");
    });

    it("flagSave: từ chối màu không hợp lệ (zod)", async () => {
      const { db } = makeMockDb();
      await assertThrowsTRPCError(
        // @ts-expect-error — cố tình truyền màu sai để test validate
        () => caller(makeMockCtx({ db })).flagSave({ label: "X", color: "#ff0000" }),
        "BAD_REQUEST",
      );
    });

    it("flagDelete: xoá cờ + gỡ binding khỏi trang", async () => {
      const { db, ops } = makeMockDb();
      const r = await caller(makeMockCtx({ db })).flagDelete(VALID_UUID);
      expect(r.ok).toBe(true);
      expect(ops.some((o) => o.kind === "delete")).toBe(true);
      expect(ops.some((o) => o.kind === "update")).toBe(true);
    });
  });
});
