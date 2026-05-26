/* ==========================================================
   trpc.test.ts — Regression test cho RBAC middleware chain.
   Phủ 4 layer:
   - publicProcedure   : ai gọi cũng được
   - protectedProcedure: cần login
   - approvedProcedure : + companyId + approved + !disabled (P1.1)
   - rbacProcedure     : + role-can(action, obj)

   Mục đích: chốt cứng các gap audit phát hiện (P1.1) — không cho
   regression "pending user bypass" hoặc "disabled user vẫn write".
   ========================================================== */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { assertThrowsTRPCError, makeMockCtx, makeMockUser } from "./test-helpers";
import {
  approvedProcedure,
  createCallerFactory,
  protectedProcedure,
  publicProcedure,
  rbacProcedure,
  resourceProcedure,
  router,
} from "./trpc";

/* Mini router để test từng layer độc lập. */
const testRouter = router({
  pub: publicProcedure.query(() => "pub"),
  prot: protectedProcedure.query(() => "prot"),
  apr: approvedProcedure.query(() => "apr"),
  // Action "delete" trên "rbac" → chỉ admin (matrix).
  adminOnly: rbacProcedure("delete", "rbac").query(() => "admin"),
  // Action "create" trên "feedback" → mọi role được.
  anyoneCreateFeedback: rbacProcedure("create", "feedback").query(() => "fb"),
  // resourceProcedure: dùng input string làm resourceId, policy mock pass.
  resOk: resourceProcedure("view", async (_ctx, id) => {
    if (id !== "ok-id") throw new Error("policy reject");
  })
    .input(z.string())
    .query(() => "res-ok"),
});
const caller = createCallerFactory(testRouter);

describe("publicProcedure", () => {
  it("chạy được kể cả không có user", async () => {
    const r = await caller(makeMockCtx({ user: null })).pub();
    expect(r).toBe("pub");
  });
});

describe("protectedProcedure", () => {
  it("UNAUTHORIZED khi user null", async () => {
    await assertThrowsTRPCError(() => caller(makeMockCtx({ user: null })).prot(), "UNAUTHORIZED");
  });

  it("pass khi có user dù pending/disabled (vì protectedProcedure không check)", async () => {
    // White-list endpoint dùng protectedProcedure phải xử lý pending status
    // ở mức UI hoặc tự check. protectedProcedure chỉ check login.
    const ctx = makeMockCtx({
      user: makeMockUser({ companyApproved: false, companyDisabled: true }),
    });
    const r = await caller(ctx).prot();
    expect(r).toBe("prot");
  });
});

describe("approvedProcedure (P1.1)", () => {
  it("UNAUTHORIZED khi user null", async () => {
    await assertThrowsTRPCError(() => caller(makeMockCtx({ user: null })).apr(), "UNAUTHORIZED");
  });

  it("FORBIDDEN khi user chưa thuộc company nào", async () => {
    const ctx = makeMockCtx({ user: makeMockUser({ companyId: null }) });
    const err = await assertThrowsTRPCError(() => caller(ctx).apr(), "FORBIDDEN");
    expect(err.message).toMatch(/cong ty/);
  });

  it("FORBIDDEN khi user pending (companyApproved=false)", async () => {
    const ctx = makeMockCtx({ user: makeMockUser({ companyApproved: false }) });
    const err = await assertThrowsTRPCError(() => caller(ctx).apr(), "FORBIDDEN");
    expect(err.message).toMatch(/phe duyet/);
  });

  it("FORBIDDEN khi user bị disabled", async () => {
    const ctx = makeMockCtx({ user: makeMockUser({ companyDisabled: true }) });
    const err = await assertThrowsTRPCError(() => caller(ctx).apr(), "FORBIDDEN");
    expect(err.message).toMatch(/vo hieu hoa/);
  });

  it("pass khi user đầy đủ điều kiện (login + company + approved + !disabled)", async () => {
    const r = await caller(makeMockCtx()).apr();
    expect(r).toBe("apr");
  });
});

describe("rbacProcedure", () => {
  it("FORBIDDEN khi role không có quyền (viewer delete:rbac)", async () => {
    const ctx = makeMockCtx({ user: makeMockUser({ role: "viewer" }) });
    await assertThrowsTRPCError(() => caller(ctx).adminOnly(), "FORBIDDEN");
  });

  it("pass khi role có quyền (admin delete:rbac)", async () => {
    const r = await caller(makeMockCtx({ user: makeMockUser({ role: "admin" }) })).adminOnly();
    expect(r).toBe("admin");
  });

  it("FORBIDDEN cũng chặn pending user dù có role admin (P1.1 reinforce)", async () => {
    const ctx = makeMockCtx({
      user: makeMockUser({ role: "admin", companyApproved: false }),
    });
    await assertThrowsTRPCError(() => caller(ctx).adminOnly(), "FORBIDDEN");
  });

  it("FORBIDDEN cũng chặn disabled user dù có role admin", async () => {
    const ctx = makeMockCtx({
      user: makeMockUser({ role: "admin", companyDisabled: true }),
    });
    await assertThrowsTRPCError(() => caller(ctx).adminOnly(), "FORBIDDEN");
  });

  /* P1.2 — viewer phải gửi được feedback. */
  it("P1.2: viewer create:feedback pass", async () => {
    const ctx = makeMockCtx({ user: makeMockUser({ role: "viewer" }) });
    const r = await caller(ctx).anyoneCreateFeedback();
    expect(r).toBe("fb");
  });
});

describe("resourceProcedure (P2.4)", () => {
  it("pass khi policyCheck không throw", async () => {
    const r = await caller(makeMockCtx()).resOk("ok-id");
    expect(r).toBe("res-ok");
  });

  it("propagate Error từ policyCheck", async () => {
    await expect(caller(makeMockCtx()).resOk("bad-id")).rejects.toThrow("policy reject");
  });

  it("FORBIDDEN khi user pending (build trên approvedProcedure)", async () => {
    const ctx = makeMockCtx({ user: makeMockUser({ companyApproved: false }) });
    await assertThrowsTRPCError(() => caller(ctx).resOk("ok-id"), "FORBIDDEN");
  });
});
