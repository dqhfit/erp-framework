/* ==========================================================
   record-store.test.ts — Unit test EAV RecordStore (Phase 0 seam).
   Dùng makeMockDb (không Postgres thật) → assert store gọi đúng loại op
   + trả row enqueued. (list() dùng .limit().offset() mà mock chain chưa
   hỗ trợ chuỗi đó nên không test ở đây — đã verify gián tiếp qua typecheck
   + 262 test router xanh.)
   ========================================================== */
import type { EntityFieldDef } from "@erp-framework/core";
import { describe, expect, it } from "vitest";
import { getRecordStore, type RecordStore } from "./record-store";
import { assertUnique } from "./router-helpers";
import { makeMockDb } from "./test-helpers";

const CO = "co_1";
const ENT = "ent_1";
const REC = "11111111-1111-4111-8111-111111111111";

describe("record-store (EAV)", () => {
  it("getById trả row enqueued, null khi rỗng", async () => {
    const { db, enqueueSelect } = makeMockDb();
    enqueueSelect([{ id: REC, companyId: CO, data: { a: 1 } }]);
    const store = getRecordStore(db);
    expect((await store.getById(CO, REC))?.id).toBe(REC);
    enqueueSelect([]);
    expect(await store.getById(CO, REC)).toBeNull();
  });

  it("getActiveById trả row hoặc null", async () => {
    const { db, enqueueSelect } = makeMockDb();
    enqueueSelect([]);
    expect(await getRecordStore(db).getActiveById(CO, ENT, REC)).toBeNull();
  });

  it("insert ghi op insert + trả row", async () => {
    const { db, enqueueInsert, ops } = makeMockDb();
    enqueueInsert([{ id: REC }]);
    const row = await getRecordStore(db).insert(CO, ENT, { a: 1 }, "user_1");
    expect(row?.id).toBe(REC);
    expect(ops.some((o) => o.kind === "insert")).toBe(true);
  });

  it("merge ghi op update + trả row với version mới", async () => {
    const { db, enqueueUpdate, ops } = makeMockDb();
    enqueueUpdate([{ id: REC, version: 3 }]);
    const row = await getRecordStore(db).merge(CO, REC, { a: 2 }, 3);
    expect(row?.version).toBe(3);
    expect(ops.some((o) => o.kind === "update")).toBe(true);
  });

  it("replace ghi op update", async () => {
    const { db, enqueueUpdate, ops } = makeMockDb();
    enqueueUpdate([{ id: REC, version: 5 }]);
    expect((await getRecordStore(db).replace(CO, REC, { a: 9 }, 5))?.version).toBe(5);
    expect(ops.some((o) => o.kind === "update")).toBe(true);
  });

  it("findByKeyIn: values rỗng → [] không query", async () => {
    const { db, ops } = makeMockDb();
    expect(await getRecordStore(db).findByKeyIn(CO, ENT, "kh_id", [])).toEqual([]);
    expect(ops).toHaveLength(0);
  });

  it("findByKeyIn trả rows enqueued (khớp id::text khi field=null)", async () => {
    const { db, enqueueSelect } = makeMockDb();
    enqueueSelect([{ id: "a" }, { id: "b" }]);
    expect(await getRecordStore(db).findByKeyIn(CO, ENT, null, ["a", "b"])).toHaveLength(2);
  });

  it("existsWithFieldValue: true khi có row, false khi rỗng", async () => {
    const { db, enqueueSelect } = makeMockDb();
    enqueueSelect([{ id: REC }]);
    expect(await getRecordStore(db).existsWithFieldValue(CO, ENT, "ma", "X")).toBe(true);
    enqueueSelect([]);
    expect(await getRecordStore(db).existsWithFieldValue(CO, ENT, "ma", "Y", REC)).toBe(false);
  });

  it("loadState trả subset (entityId/data/version/deletedAt)", async () => {
    const { db, enqueueSelect } = makeMockDb();
    enqueueSelect([{ entityId: ENT, data: { a: 1 }, version: 2, deletedAt: null }]);
    const st = await getRecordStore(db).loadState(CO, REC);
    expect(st?.version).toBe(2);
    expect(st?.entityId).toBe(ENT);
  });

  it("softDelete/restore = 2 update; hardDelete = 1 delete", async () => {
    const { db, ops } = makeMockDb();
    const store = getRecordStore(db);
    await store.softDelete(CO, REC);
    await store.restore(CO, REC);
    await store.hardDelete(CO, REC);
    expect(ops.filter((o) => o.kind === "update")).toHaveLength(2);
    expect(ops.filter((o) => o.kind === "delete")).toHaveLength(1);
  });
});

describe("assertUnique (qua RecordStore — dispatch EAV/table)", () => {
  const uniqField: EntityFieldDef = { name: "ma", label: "Mã", type: "text", unique: true };
  const stub = (exists: boolean): RecordStore =>
    ({ existsWithFieldValue: async () => exists }) as unknown as RecordStore;

  it("trùng → CONFLICT", async () => {
    await expect(assertUnique(stub(true), CO, ENT, [uniqField], { ma: "X" })).rejects.toThrow();
  });
  it("không trùng → ok", async () => {
    await expect(
      assertUnique(stub(false), CO, ENT, [uniqField], { ma: "X" }),
    ).resolves.toBeUndefined();
  });
  it("field không unique → KHÔNG gọi store", async () => {
    let called = false;
    const s = {
      existsWithFieldValue: async () => {
        called = true;
        return true;
      },
    } as unknown as RecordStore;
    await assertUnique(s, CO, ENT, [{ name: "ghi_chu", label: "GC", type: "text" }], {
      ghi_chu: "x",
    });
    expect(called).toBe(false);
  });
});
