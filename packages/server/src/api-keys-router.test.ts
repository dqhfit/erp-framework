/* ==========================================================
   api-keys-router.test.ts — Regression test cho scope validator (P1.3).
   Chốt cứng: create không cho phép scopes=[] hoặc scope sai format.
   ========================================================== */
import { describe, expect, it } from "vitest";
import { apiKeysRouter } from "./api-keys-router";
import { assertThrowsTRPCError, makeMockCtx, makeMockDb, makeMockUser } from "./test-helpers";
import { createCallerFactory } from "./trpc";

const caller = createCallerFactory(apiKeysRouter);
const VALID_UUID = "11111111-1111-4111-8111-111111111111";

describe("apiKeys.create scope validator (P1.3)", () => {
  it("reject scopes=[] với BAD_REQUEST", async () => {
    const ctx = makeMockCtx({ user: makeMockUser({ role: "admin" }) });
    // Zod min(1) sẽ chặn trước khi validateScopes chạy.
    await assertThrowsTRPCError(
      () => caller(ctx).create({ label: "test", scopes: [] }),
      "BAD_REQUEST",
    );
  });

  it("reject scope sai format (không match regex)", async () => {
    const ctx = makeMockCtx({ user: makeMockUser({ role: "admin" }) });
    await assertThrowsTRPCError(
      () => caller(ctx).create({ label: "test", scopes: ["garbage"] }),
      "BAD_REQUEST",
    );
    await assertThrowsTRPCError(
      () => caller(ctx).create({ label: "test", scopes: ["entity:orders"] }), // thiếu :action
      "BAD_REQUEST",
    );
    await assertThrowsTRPCError(
      () => caller(ctx).create({ label: "test", scopes: ["entity:orders:invalid_action"] }),
      "BAD_REQUEST",
    );
  });

  it('accept "*" cho full access', async () => {
    const { db, enqueueInsert } = makeMockDb();
    enqueueInsert([{ id: VALID_UUID, prefix: "sk_abc", clientId: "cli_x" }]);
    const ctx = makeMockCtx({ db, user: makeMockUser({ role: "admin" }) });
    const r = await caller(ctx).create({ label: "test", scopes: ["*"] });
    expect(r.id).toBe(VALID_UUID);
    expect(r.plaintext).toMatch(/^sk_/);
  });

  it('accept "entity:<name>:read|write" + "entity:*:..."', async () => {
    const { db, enqueueInsert } = makeMockDb();
    enqueueInsert([{ id: VALID_UUID, prefix: "sk_abc", clientId: "cli_x" }]);
    const ctx = makeMockCtx({ db, user: makeMockUser({ role: "admin" }) });
    const r = await caller(ctx).create({
      label: "test",
      scopes: ["entity:orders:read", "entity:orders:write", "entity:*:read"],
    });
    expect(r.id).toBe(VALID_UUID);
  });

  /* P1.1 — non-admin không tạo API key được (rbacProcedure("edit","settings")). */
  it("FORBIDDEN khi role không phải admin", async () => {
    const ctx = makeMockCtx({ user: makeMockUser({ role: "viewer" }) });
    await assertThrowsTRPCError(
      () => caller(ctx).create({ label: "test", scopes: ["*"] }),
      "FORBIDDEN",
    );
    const ctx2 = makeMockCtx({ user: makeMockUser({ role: "editor" }) });
    await assertThrowsTRPCError(
      () => caller(ctx2).create({ label: "test", scopes: ["*"] }),
      "FORBIDDEN",
    );
  });

  it("updateScopes cũng validate format", async () => {
    const ctx = makeMockCtx({ user: makeMockUser({ role: "admin" }) });
    await assertThrowsTRPCError(
      () => caller(ctx).updateScopes({ id: VALID_UUID, scopes: ["garbage"] }),
      "BAD_REQUEST",
    );
  });
});
