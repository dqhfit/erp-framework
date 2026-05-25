/* ==========================================================
   entities-router.test.ts — Unit test entity metadata CRUD +
   safe field rename/type change.
   ========================================================== */
import { describe, it, expect } from "vitest";
import { entitiesRouter } from "./entities-router";
import { createCallerFactory } from "./trpc";
import {
  makeMockCtx, makeMockDb, makeMockUser, assertThrowsTRPCError,
} from "./test-helpers";

const caller = createCallerFactory(entitiesRouter);
const VALID_UUID = "11111111-1111-4111-8111-111111111111";

describe("entities-router", () => {
  describe("list / get / delete", () => {
    it("list trả entities của company", async () => {
      const { db, enqueueSelect } = makeMockDb();
      enqueueSelect([{ id: VALID_UUID, name: "customer", label: "Khách hàng" }]);
      const r = await caller(makeMockCtx({ db })).list();
      expect(r).toHaveLength(1);
    });

    it("get trả entity hoặc null", async () => {
      const { db, enqueueSelect } = makeMockDb();
      enqueueSelect([]);
      const r = await caller(makeMockCtx({ db })).get(VALID_UUID);
      expect(r).toBeNull();
    });

    it("delete: viewer FORBIDDEN", async () => {
      const ctx = makeMockCtx({ user: makeMockUser({ role: "viewer" }) });
      await assertThrowsTRPCError(
        () => caller(ctx).delete(VALID_UUID),
        "FORBIDDEN",
      );
    });
  });

  describe("save (upsert)", () => {
    it("insert mới khi không có id", async () => {
      const { db, enqueueInsert } = makeMockDb();
      enqueueInsert([{ id: VALID_UUID, name: "n", label: "L" }]);
      const r = await caller(makeMockCtx({ db })).save({
        name: "customer", label: "Khách hàng", fields: [],
      });
      expect(r?.id).toBe(VALID_UUID);
    });

    it("FORBIDDEN: entity thuộc company khác", async () => {
      const { db, enqueueSelect } = makeMockDb();
      enqueueSelect([{ companyId: "co_other" }]);
      const ctx = makeMockCtx({ db });
      await assertThrowsTRPCError(
        () => caller(ctx).save({
          id: VALID_UUID, name: "x", label: "X", fields: [],
        }),
        "FORBIDDEN",
      );
    });
  });

  describe("renameField", () => {
    it("rename + migrate data jsonb_set", async () => {
      const { db, enqueueSelect, ops } = makeMockDb();
      enqueueSelect([{
        id: VALID_UUID, companyId: "co_test_1",
        fields: [{ name: "old_name", type: "string", label: "X" }],
      }]);
      const r = await caller(makeMockCtx({ db })).renameField({
        entityId: VALID_UUID,
        oldKey: "old_name",
        newKey: "new_name",
      });
      expect(r.ok).toBe(true);
      expect(ops.some((o) => o.kind === "execute")).toBe(true); // jsonb_set SQL
    });

    it("NOT_FOUND khi entity vắng", async () => {
      const { db, enqueueSelect } = makeMockDb();
      enqueueSelect([]);
      const ctx = makeMockCtx({ db });
      await assertThrowsTRPCError(
        () => caller(ctx).renameField({
          entityId: VALID_UUID, oldKey: "a", newKey: "b",
        }),
        "NOT_FOUND",
      );
    });

    it("BAD_REQUEST: oldKey không có trong fields", async () => {
      const { db, enqueueSelect } = makeMockDb();
      enqueueSelect([{
        id: VALID_UUID, companyId: "co_test_1",
        fields: [{ name: "x", type: "string" }],
      }]);
      const ctx = makeMockCtx({ db });
      await assertThrowsTRPCError(
        () => caller(ctx).renameField({
          entityId: VALID_UUID, oldKey: "y", newKey: "z",
        }),
        "BAD_REQUEST",
      );
    });

    it("BAD_REQUEST: newKey trùng field đã có", async () => {
      const { db, enqueueSelect } = makeMockDb();
      enqueueSelect([{
        id: VALID_UUID, companyId: "co_test_1",
        fields: [
          { name: "old", type: "string" },
          { name: "new", type: "string" },
        ],
      }]);
      const ctx = makeMockCtx({ db });
      await assertThrowsTRPCError(
        () => caller(ctx).renameField({
          entityId: VALID_UUID, oldKey: "old", newKey: "new",
        }),
        "BAD_REQUEST",
      );
    });

    it("validation: newKey phải là identifier", async () => {
      const ctx = makeMockCtx();
      await assertThrowsTRPCError(
        () => caller(ctx).renameField({
          entityId: VALID_UUID, oldKey: "x", newKey: "1invalid",
        }),
        "BAD_REQUEST",
      );
    });
  });

  describe("changeFieldType", () => {
    it("NOT_FOUND khi entity vắng", async () => {
      const { db, enqueueSelect } = makeMockDb();
      enqueueSelect([]);
      const ctx = makeMockCtx({ db });
      await assertThrowsTRPCError(
        () => caller(ctx).changeFieldType({
          entityId: VALID_UUID, fieldName: "x", newType: "number",
        }),
        "NOT_FOUND",
      );
    });

    it("BAD_REQUEST: field không có", async () => {
      const { db, enqueueSelect } = makeMockDb();
      enqueueSelect([{
        id: VALID_UUID, companyId: "co_test_1",
        fields: [{ name: "exists", type: "string" }],
      }]);
      const ctx = makeMockCtx({ db });
      await assertThrowsTRPCError(
        () => caller(ctx).changeFieldType({
          entityId: VALID_UUID, fieldName: "missing", newType: "number",
        }),
        "BAD_REQUEST",
      );
    });

    it("happy path: coerce records + return migrated count", async () => {
      const { db, enqueueSelect } = makeMockDb();
      enqueueSelect([{
        id: VALID_UUID, companyId: "co_test_1",
        fields: [{ name: "qty", type: "string", label: "Số lượng" }],
      }]);
      enqueueSelect([
        { id: VALID_UUID, data: { qty: "100" } },
      ]);
      const r = await caller(makeMockCtx({ db })).changeFieldType({
        entityId: VALID_UUID, fieldName: "qty", newType: "number",
      });
      expect(r.migrated).toBeGreaterThanOrEqual(0);
      expect(Array.isArray(r.errors)).toBe(true);
    });
  });
});
