/* ==========================================================
   records-router.test.ts — Unit test cho router CRUD record (LỚN nhất,
   thao tác trực tiếp dữ liệu). Tập trung LƯỚI AN TOÀN:
   - RBAC boundary: vai trò không đủ quyền bị chặn ở cổng rbacProcedure
     (viewer không ghi; editor không xoá — khớp ma trận permissions.ts).
   - Optimistic locking + trạng thái record của update (NOT_FOUND / CONFLICT
     version mismatch / BAD_REQUEST khi đã xoá mềm).
   - get trả null khi record không tồn tại.

   Chạy KHÔNG cần Postgres: getRecordStore → EavRecordStore (ERP_HYBRID_TABLES
   mặc định tắt) → mỗi op 1 query, mock qua makeMockDb (enqueue kết quả).
   ========================================================== */
import { describe, expect, it } from "vitest";
import { recordsRouter } from "./records-router";
import { assertThrowsTRPCError, makeMockCtx, makeMockDb, makeMockUser } from "./test-helpers";
import { createCallerFactory } from "./trpc";

const caller = createCallerFactory(recordsRouter);
const UUID = "11111111-1111-4111-8111-111111111111";

describe("records-router", () => {
  /* ── RBAC: ranh giới quyền theo vai trò (ma trận permissions.ts) ──
     viewer: chỉ view:entity → MỌI thao tác ghi bị chặn.
     editor: create/edit nhưng KHÔNG delete:entity → delete/hardDelete bị chặn.
     Cổng rbacProcedure ném FORBIDDEN TRƯỚC handler (không chạm DB). */
  describe("RBAC boundary", () => {
    it("create: viewer → FORBIDDEN", async () => {
      const ctx = makeMockCtx({ user: makeMockUser({ role: "viewer" }) });
      await assertThrowsTRPCError(
        () => caller(ctx).create({ entityId: UUID, data: {} }),
        "FORBIDDEN",
      );
    });

    it("update: viewer → FORBIDDEN", async () => {
      const ctx = makeMockCtx({ user: makeMockUser({ role: "viewer" }) });
      await assertThrowsTRPCError(
        () => caller(ctx).update({ recordId: UUID, data: {} }),
        "FORBIDDEN",
      );
    });

    it("delete: viewer → FORBIDDEN", async () => {
      const ctx = makeMockCtx({ user: makeMockUser({ role: "viewer" }) });
      await assertThrowsTRPCError(() => caller(ctx).delete(UUID), "FORBIDDEN");
    });

    it("restore: viewer → FORBIDDEN", async () => {
      const ctx = makeMockCtx({ user: makeMockUser({ role: "viewer" }) });
      await assertThrowsTRPCError(() => caller(ctx).restore(UUID), "FORBIDDEN");
    });

    it("delete: editor → FORBIDDEN (editor KHÔNG có delete:entity)", async () => {
      const ctx = makeMockCtx({ user: makeMockUser({ role: "editor" }) });
      await assertThrowsTRPCError(() => caller(ctx).delete(UUID), "FORBIDDEN");
    });

    it("hardDelete: editor → FORBIDDEN", async () => {
      const ctx = makeMockCtx({ user: makeMockUser({ role: "editor" }) });
      await assertThrowsTRPCError(() => caller(ctx).hardDelete(UUID), "FORBIDDEN");
    });
  });

  /* ── get ── */
  describe("get", () => {
    it("record không tồn tại → null", async () => {
      const { db, enqueueSelect } = makeMockDb();
      enqueueSelect([]); // EavRecordStore.getById → không có row
      const r = await caller(makeMockCtx({ db })).get(UUID);
      expect(r).toBeNull();
    });

    it("viewer ĐƯỢC đọc (view:entity) — không FORBIDDEN", async () => {
      const { db, enqueueSelect } = makeMockDb();
      enqueueSelect([]);
      const ctx = makeMockCtx({ db, user: makeMockUser({ role: "viewer" }) });
      await expect(caller(ctx).get(UUID)).resolves.toBeNull();
    });
  });

  /* ── update: optimistic locking + kiểm trạng thái (admin mặc định) ── */
  describe("update — optimistic locking + trạng thái", () => {
    it("record không tồn tại → NOT_FOUND", async () => {
      const { db, enqueueSelect } = makeMockDb();
      enqueueSelect([]); // loadState → undefined
      await assertThrowsTRPCError(
        () => caller(makeMockCtx({ db })).update({ recordId: UUID, data: { x: 1 } }),
        "NOT_FOUND",
      );
    });

    it("version mismatch → CONFLICT", async () => {
      const { db, enqueueSelect } = makeMockDb();
      enqueueSelect([{ entityId: UUID, data: {}, version: 5, deletedAt: null }]);
      await assertThrowsTRPCError(
        () =>
          caller(makeMockCtx({ db })).update({
            recordId: UUID,
            data: { x: 1 },
            expectedVersion: 1,
          }),
        "CONFLICT",
      );
    });

    it("record đã xoá mềm → BAD_REQUEST (phải restore trước)", async () => {
      const { db, enqueueSelect } = makeMockDb();
      enqueueSelect([{ entityId: UUID, data: {}, version: 1, deletedAt: new Date() }]);
      await assertThrowsTRPCError(
        () => caller(makeMockCtx({ db })).update({ recordId: UUID, data: { x: 1 } }),
        "BAD_REQUEST",
      );
    });
  });
});
