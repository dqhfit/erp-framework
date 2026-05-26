/* ==========================================================
   agents-router.test.ts — Unit test agent CRUD + membership.
   Mock assertCanActOnAgent + logActivity vì per-agent ACL phức tạp.
   ========================================================== */
import { describe, expect, it, vi } from "vitest";
import { agentsRouter } from "./agents-router";
import { assertThrowsTRPCError, makeMockCtx, makeMockDb, makeMockUser } from "./test-helpers";
import { createCallerFactory } from "./trpc";

const caller = createCallerFactory(agentsRouter);
const VALID_UUID = "11111111-1111-4111-8111-111111111111";
const VALID_UUID_2 = "22222222-2222-4222-8222-222222222222";

vi.mock("./agent-acl", () => ({
  assertCanActOnAgent: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("./activity", () => ({
  logActivity: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("./agent-memory", () => ({
  allDefaultTemplates: vi.fn((name: string) => [{ file: "IDENTITY", content: `Agent ${name}` }]),
}));

describe("agents-router", () => {
  describe("list", () => {
    it("trả agents của company", async () => {
      const { db, enqueueSelect } = makeMockDb();
      enqueueSelect([{ id: VALID_UUID, name: "Assistant", model: "claude-sonnet-4-6" }]);
      const r = await caller(makeMockCtx({ db })).list();
      expect(r).toHaveLength(1);
    });

    it("RBAC: viewer xem được (view:agent)", async () => {
      const { db, enqueueSelect } = makeMockDb();
      enqueueSelect([]);
      const ctx = makeMockCtx({ db, user: makeMockUser({ role: "viewer" }) });
      await caller(ctx).list();
    });
  });

  describe("get", () => {
    it("call assertCanActOnAgent + trả row", async () => {
      const { db, enqueueSelect } = makeMockDb();
      enqueueSelect([{ id: VALID_UUID, name: "x" }]);
      const r = await caller(makeMockCtx({ db })).get(VALID_UUID);
      expect(r?.name).toBe("x");
      const { assertCanActOnAgent } = await import("./agent-acl");
      expect(assertCanActOnAgent).toHaveBeenCalledWith(expect.anything(), VALID_UUID, "view");
    });
  });

  describe("save (create vs update)", () => {
    it("create: insert agent + auto-add owner trong resource_members", async () => {
      const { db, enqueueInsert, ops } = makeMockDb();
      enqueueInsert([{ id: VALID_UUID, name: "new agent", model: "claude" }]);
      // autoAddOwner gọi upsertResourceMember (insert.onConflictDoUpdate)
      // → 2 insert tổng: agents + resource_members.
      await caller(makeMockCtx({ db })).save({
        name: "new agent",
        model: "claude",
      });
      expect(ops.filter((o) => o.kind === "insert").length).toBeGreaterThanOrEqual(2);
    });

    it("UNAUTHORIZED khi không có user", async () => {
      const ctx = makeMockCtx({ user: null });
      await assertThrowsTRPCError(
        () => caller(ctx).save({ name: "x", model: "y" }),
        "UNAUTHORIZED",
      );
    });

    it("FORBIDDEN khi user không thuộc company", async () => {
      const ctx = makeMockCtx({ user: makeMockUser({ companyId: null }) });
      await assertThrowsTRPCError(() => caller(ctx).save({ name: "x", model: "y" }), "FORBIDDEN");
    });
  });

  describe("delete", () => {
    it("xoá agent + log activity", async () => {
      const { db, enqueueSelect, ops } = makeMockDb();
      enqueueSelect([{ name: "Old agent" }]);
      await caller(makeMockCtx({ db })).delete(VALID_UUID);
      expect(ops.some((o) => o.kind === "delete")).toBe(true);
      const { logActivity } = await import("./activity");
      expect(logActivity).toHaveBeenCalled();
    });

    it("FORBIDDEN nếu user không thuộc company", async () => {
      const ctx = makeMockCtx({ user: makeMockUser({ companyId: null }) });
      await assertThrowsTRPCError(() => caller(ctx).delete(VALID_UUID), "FORBIDDEN");
    });
  });

  describe("memoryTemplates", () => {
    it("trả templates với tên agent", async () => {
      const { db, enqueueSelect } = makeMockDb();
      enqueueSelect([{ id: VALID_UUID, name: "BotName" }]);
      const r = await caller(makeMockCtx({ db })).memoryTemplates(VALID_UUID);
      expect(r).toEqual([{ file: "IDENTITY", content: "Agent BotName" }]);
    });

    it("NOT_FOUND khi agent vắng", async () => {
      const { db, enqueueSelect } = makeMockDb();
      enqueueSelect([]);
      const ctx = makeMockCtx({ db });
      await assertThrowsTRPCError(() => caller(ctx).memoryTemplates(VALID_UUID), "NOT_FOUND");
    });
  });

  describe("setPrimary / myAgents", () => {
    it("setPrimary cập nhật users.primaryAgentId", async () => {
      const { db, ops } = makeMockDb();
      const r = await caller(makeMockCtx({ db })).setPrimary({
        agentId: VALID_UUID,
      });
      expect(r).toEqual({ ok: true });
      expect(ops.some((o) => o.kind === "update")).toBe(true);
    });

    it("setPrimary({agentId: null}) gỡ primary", async () => {
      const { db, ops } = makeMockDb();
      await caller(makeMockCtx({ db })).setPrimary({ agentId: null });
      expect(ops.some((o) => o.kind === "update")).toBe(true);
    });

    it("myAgents trả primary + members", async () => {
      const { db, enqueueSelect } = makeMockDb();
      enqueueSelect([{ primaryAgentId: VALID_UUID }]);
      enqueueSelect([{ agentId: VALID_UUID_2, role: "owner" }]);
      const r = await caller(makeMockCtx({ db })).myAgents();
      expect(r.primaryAgentId).toBe(VALID_UUID);
      expect(r.members).toHaveLength(1);
    });
  });

  describe("addMember / removeMember", () => {
    it("addMember: BAD_REQUEST khi user không là member công ty", async () => {
      const { db, enqueueSelect } = makeMockDb();
      enqueueSelect([]); // companyMembers check → not found
      const ctx = makeMockCtx({ db });
      await assertThrowsTRPCError(
        () =>
          caller(ctx).addMember({
            agentId: VALID_UUID,
            userId: VALID_UUID_2,
            role: "operator",
          }),
        "BAD_REQUEST",
      );
    });

    it("addMember: happy path + log", async () => {
      const { db, enqueueSelect, ops } = makeMockDb();
      enqueueSelect([{ companyId: "co_test_1" }]); // user trong company
      await caller(makeMockCtx({ db })).addMember({
        agentId: VALID_UUID,
        userId: VALID_UUID_2,
        role: "operator",
      });
      expect(ops.some((o) => o.kind === "insert")).toBe(true);
      const { logActivity } = await import("./activity");
      expect(logActivity).toHaveBeenCalled();
    });

    it("removeMember: delete + log", async () => {
      const { db, ops } = makeMockDb();
      await caller(makeMockCtx({ db })).removeMember({
        agentId: VALID_UUID,
        userId: VALID_UUID_2,
      });
      expect(ops.some((o) => o.kind === "delete")).toBe(true);
    });

    it("addMember validation: role enum", async () => {
      const ctx = makeMockCtx();
      await assertThrowsTRPCError(
        () =>
          caller(ctx).addMember({
            agentId: VALID_UUID,
            userId: VALID_UUID_2,
            role: "invalid" as never,
          }),
        "BAD_REQUEST",
      );
    });
  });
});
