/* ==========================================================
   schedules-router.test.ts — Unit test schedule (cron) CRUD.
   ========================================================== */
import { describe, it, expect } from "vitest";
import { schedulesRouter } from "./schedules-router";
import { createCallerFactory } from "./trpc";
import {
  makeMockCtx, makeMockDb, makeMockUser, assertThrowsTRPCError,
} from "./test-helpers";

const caller = createCallerFactory(schedulesRouter);
const VALID_UUID = "11111111-1111-4111-8111-111111111111";
const VALID_UUID_2 = "22222222-2222-4222-8222-222222222222";

describe("schedules-router", () => {
  describe("list", () => {
    it("trả schedules của company", async () => {
      const { db, enqueueSelect } = makeMockDb();
      enqueueSelect([{ id: VALID_UUID, cronExpr: "0 * * * *", enabled: true }]);
      const r = await caller(makeMockCtx({ db })).list();
      expect(r).toHaveLength(1);
    });
  });

  describe("save", () => {
    it("insert mới + check workflow thuộc company", async () => {
      const { db, enqueueSelect, enqueueInsert } = makeMockDb();
      enqueueSelect([{ id: VALID_UUID_2 }]);  // workflow exists check
      enqueueInsert([{ id: VALID_UUID, cronExpr: "0 9 * * *" }]);
      const r = await caller(makeMockCtx({ db })).save({
        workflowId: VALID_UUID_2,
        cronExpr: "0 9 * * *",
      });
      expect(r?.id).toBe(VALID_UUID);
    });

    it("NOT_FOUND khi workflow của lịch không thuộc company", async () => {
      const { db, enqueueSelect } = makeMockDb();
      enqueueSelect([]);  // workflow not found
      const ctx = makeMockCtx({ db });
      await assertThrowsTRPCError(
        () => caller(ctx).save({
          workflowId: VALID_UUID_2,
          cronExpr: "0 * * * *",
        }),
        "NOT_FOUND",
      );
    });

    it("FORBIDDEN khi update schedule công ty khác", async () => {
      const { db, enqueueSelect } = makeMockDb();
      enqueueSelect([{ id: VALID_UUID_2 }]);    // workflow OK
      enqueueSelect([{ companyId: "co_other" }]);  // existing schedule company khác
      const ctx = makeMockCtx({ db });
      await assertThrowsTRPCError(
        () => caller(ctx).save({
          id: VALID_UUID,
          workflowId: VALID_UUID_2,
          cronExpr: "0 * * * *",
        }),
        "FORBIDDEN",
      );
    });

    it("RBAC: viewer không có edit:workflow", async () => {
      const ctx = makeMockCtx({ user: makeMockUser({ role: "viewer" }) });
      await assertThrowsTRPCError(
        () => caller(ctx).save({
          workflowId: VALID_UUID,
          cronExpr: "* * * * *",
        }),
        "FORBIDDEN",
      );
    });

    it("validation: cronExpr không rỗng", async () => {
      const ctx = makeMockCtx();
      await assertThrowsTRPCError(
        () => caller(ctx).save({
          workflowId: VALID_UUID,
          cronExpr: "",
        }),
        "BAD_REQUEST",
      );
    });
  });

  describe("delete", () => {
    it("admin xoá được", async () => {
      const { db, ops } = makeMockDb();
      await caller(makeMockCtx({ db })).delete(VALID_UUID);
      expect(ops.some((o) => o.kind === "delete")).toBe(true);
    });

    it("viewer không có delete:workflow", async () => {
      const ctx = makeMockCtx({ user: makeMockUser({ role: "viewer" }) });
      await assertThrowsTRPCError(
        () => caller(ctx).delete(VALID_UUID),
        "FORBIDDEN",
      );
    });
  });
});
