/* ==========================================================
   resource-acl.test.ts — Unit test cho generic membership layer
   (P2.3). Verify CRUD helpers dùng đúng table + filter resource_type.
   ========================================================== */
import { describe, expect, it } from "vitest";
import {
  clearResourceMembers,
  getResourceRole,
  listResourceMembers,
  removeResourceMember,
  upsertResourceMember,
} from "./resource-acl";
import { makeMockDb } from "./test-helpers";

const AGENT_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";

describe("resource-acl (P2.3)", () => {
  it("getResourceRole trả role khi member tồn tại", async () => {
    const { db, enqueueSelect } = makeMockDb();
    enqueueSelect([{ role: "owner" }]);
    const r = await getResourceRole(db, "agent", AGENT_ID, USER_ID);
    expect(r).toBe("owner");
  });

  it("getResourceRole trả null khi chưa add", async () => {
    const { db, enqueueSelect } = makeMockDb();
    enqueueSelect([]);
    const r = await getResourceRole(db, "agent", AGENT_ID, USER_ID);
    expect(r).toBeNull();
  });

  it("listResourceMembers trả danh sách member", async () => {
    const { db, enqueueSelect } = makeMockDb();
    const now = new Date();
    enqueueSelect([
      { userId: USER_ID, role: "owner", addedBy: USER_ID, addedAt: now },
      { userId: "u2", role: "operator", addedBy: USER_ID, addedAt: now },
    ]);
    const r = await listResourceMembers(db, "agent", AGENT_ID);
    expect(r).toHaveLength(2);
    expect(r[0]?.role).toBe("owner");
  });

  it("upsertResourceMember dùng insert.onConflictDoUpdate", async () => {
    const { db, ops } = makeMockDb();
    await upsertResourceMember(db, "agent", AGENT_ID, USER_ID, "operator", USER_ID);
    const inserts = ops.filter((o) => o.kind === "insert");
    expect(inserts).toHaveLength(1);
    const v = inserts[0]?.values as Record<string, unknown>;
    expect(v.resourceType).toBe("agent");
    expect(v.resourceId).toBe(AGENT_ID);
    expect(v.role).toBe("operator");
  });

  it("removeResourceMember dùng delete với filter", async () => {
    const { db, ops } = makeMockDb();
    await removeResourceMember(db, "agent", AGENT_ID, USER_ID);
    expect(ops.some((o) => o.kind === "delete")).toBe(true);
  });

  it("clearResourceMembers dùng delete", async () => {
    const { db, ops } = makeMockDb();
    await clearResourceMembers(db, "agent", AGENT_ID);
    expect(ops.some((o) => o.kind === "delete")).toBe(true);
  });
});
