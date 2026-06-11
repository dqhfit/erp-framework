/* ==========================================================
   workflows-router.test.ts — Unit test workflow CRUD + publish + replay.
   ========================================================== */
import { describe, expect, it, vi } from "vitest";
import { assertThrowsTRPCError, makeMockCtx, makeMockDb, makeMockUser } from "./test-helpers";
import { createCallerFactory } from "./trpc";
import { workflowsRouter } from "./workflows-router";

const caller = createCallerFactory(workflowsRouter);
const VALID_UUID = "11111111-1111-4111-8111-111111111111";

vi.mock("./run-workflow", () => ({
  executeWorkflow: vi.fn().mockResolvedValue({
    runId: "11111111-1111-4111-8111-111111111111",
    status: "completed",
    stepCount: 3,
  }),
  recentRuns: vi.fn().mockResolvedValue([]),
  // No-op: graph test không có node requiresRole nên gate luôn pass.
  assertGraphRoleRequirements: vi.fn(),
}));
vi.mock("./activity", () => ({
  logActivity: vi.fn().mockResolvedValue(undefined),
}));

describe("workflows-router", () => {
  describe("list / get / delete", () => {
    it("list của company", async () => {
      const { db, enqueueSelect } = makeMockDb();
      enqueueSelect([{ id: VALID_UUID, name: "wf1" }]);
      const r = await caller(makeMockCtx({ db })).list();
      expect(r).toHaveLength(1);
    });

    it("get trả null nếu vắng", async () => {
      const { db, enqueueSelect } = makeMockDb();
      enqueueSelect([]);
      const r = await caller(makeMockCtx({ db })).get(VALID_UUID);
      expect(r).toBeNull();
    });

    it("delete: viewer FORBIDDEN", async () => {
      const ctx = makeMockCtx({ user: makeMockUser({ role: "viewer" }) });
      await assertThrowsTRPCError(() => caller(ctx).delete(VALID_UUID), "FORBIDDEN");
    });
  });

  describe("save", () => {
    it("insert mới khi không có id", async () => {
      const { db, enqueueInsert } = makeMockDb();
      enqueueInsert([{ id: VALID_UUID, name: "new wf" }]);
      const r = await caller(makeMockCtx({ db })).save({
        name: "new wf",
      });
      expect(r?.name).toBe("new wf");
    });

    it("id chưa tồn tại → INSERT với chính id đó (client-generated UUID)", async () => {
      // Pattern SELECT→INSERT-or-UPDATE (fix "workflow không tồn tại khi chạy
      // thử"): client sinh crypto.randomUUID() trước khi server biết — lần lưu
      // đầu phải INSERT, KHÔNG NOT_FOUND như hành vi UPDATE-only cũ.
      const { db, enqueueSelect, enqueueInsert } = makeMockDb();
      enqueueSelect([]); // SELECT theo id → chưa có row
      enqueueInsert([{ id: VALID_UUID, name: "n" }]);
      const r = await caller(makeMockCtx({ db })).save({
        id: VALID_UUID,
        name: "n",
      });
      expect(r?.id).toBe(VALID_UUID);
      expect(r?.name).toBe("n");
    });

    it("id thuộc công ty KHÁC → FORBIDDEN (chống cross-tenant)", async () => {
      const { db, enqueueSelect } = makeMockDb();
      enqueueSelect([{ companyId: "khac-cong-ty" }]); // row tồn tại, company khác
      await assertThrowsTRPCError(
        () =>
          caller(makeMockCtx({ db })).save({
            id: VALID_UUID,
            name: "n",
          }),
        "FORBIDDEN",
      );
    });
  });

  describe("publish", () => {
    it("NOT_FOUND khi workflow vắng", async () => {
      const { db, enqueueSelect } = makeMockDb();
      enqueueSelect([]);
      const ctx = makeMockCtx({ db });
      await assertThrowsTRPCError(() => caller(ctx).publish(VALID_UUID), "NOT_FOUND");
    });

    it("publish + snapshot vào workflow_versions", async () => {
      const { db, enqueueSelect } = makeMockDb();
      enqueueSelect([{ name: "wf1", graph: { nodes: [], edges: [] } }]);
      enqueueSelect([{ version: 2 }]); // last version
      const r = await caller(makeMockCtx({ db })).publish(VALID_UUID);
      expect(r.ok).toBe(true);
      expect(r.version).toBe(3); // nextVersion = 2 + 1
    });

    it("log activity khi publish có code-node", async () => {
      const { db, enqueueSelect } = makeMockDb();
      enqueueSelect([
        {
          name: "wf1",
          graph: { nodes: [{ data: { kind: "code" } }], edges: [] },
        },
      ]);
      enqueueSelect([]); // no prior version
      await caller(makeMockCtx({ db })).publish(VALID_UUID);
      const { logActivity } = await import("./activity");
      expect(logActivity).toHaveBeenCalled();
    });
  });

  describe("trigger", () => {
    it("gọi executeWorkflow + trả runId", async () => {
      const { db } = makeMockDb();
      const r = await caller(makeMockCtx({ db })).trigger({
        workflowId: VALID_UUID,
      });
      expect(r.status).toBe("completed");
      const { executeWorkflow } = await import("./run-workflow");
      expect(executeWorkflow).toHaveBeenCalled();
    });

    it("RBAC: viewer được trigger (run:workflow)", async () => {
      const { db } = makeMockDb();
      const ctx = makeMockCtx({ db, user: makeMockUser({ role: "viewer" }) });
      await caller(ctx).trigger({ workflowId: VALID_UUID });
    });
  });

  describe("setVersionWeight", () => {
    it("update weight + active", async () => {
      const { db, ops } = makeMockDb();
      const r = await caller(makeMockCtx({ db })).setVersionWeight({
        versionId: VALID_UUID,
        weight: 50,
        active: true,
      });
      expect(r.ok).toBe(true);
      expect(ops.some((o) => o.kind === "update")).toBe(true);
    });

    it("validation: weight 0-100", async () => {
      const ctx = makeMockCtx();
      await assertThrowsTRPCError(
        () =>
          caller(ctx).setVersionWeight({
            versionId: VALID_UUID,
            weight: 150,
          }),
        "BAD_REQUEST",
      );
    });
  });

  describe("replay", () => {
    it("NOT_FOUND khi run vắng", async () => {
      const { db, enqueueSelect } = makeMockDb();
      enqueueSelect([]);
      const ctx = makeMockCtx({ db });
      await assertThrowsTRPCError(() => caller(ctx).replay({ runId: VALID_UUID }), "NOT_FOUND");
    });

    it("replay từ snapshot vars", async () => {
      const { db, enqueueSelect } = makeMockDb();
      enqueueSelect([
        {
          id: VALID_UUID,
          workflowId: VALID_UUID,
          vars: { x: 1 },
          companyId: "co_test_1",
        },
      ]);
      const r = await caller(makeMockCtx({ db })).replay({
        runId: VALID_UUID,
        fromStep: 2,
      });
      expect(r.replayedFrom).toBe(2);
    });
  });
});
