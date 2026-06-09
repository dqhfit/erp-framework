/* ==========================================================
   hybrid-storage.db.test.ts — Integration test Phase 1-3 lưu trữ HYBRID
   trên Postgres THẬT. BỎ QUA mặc định; chỉ chạy khi HYBRID_DB=1 + có DB đã
   migrate (gồm 0070). Tự tạo company/entity/record throwaway rồi dọn sạch.

   Chạy:
     pnpm db:up && pnpm --filter @erp-framework/db migrate
     HYBRID_DB=1 DATABASE_URL=postgres://erp:erp@localhost:5432/erp_framework \
       pnpm --filter @erp-framework/server exec vitest run hybrid-storage.db

   (ERP_HYBRID_TABLES được bật trong beforeAll — đọc lười nên có hiệu lực.)
   Đây là chốt kiểm chứng nhánh bảng thật (DDL + TableRecordStore + dispatcher +
   promote + JOIN SQL gỡ giới hạn v1) mà unit test thuần không chạm tới.
   ========================================================== */

import type { DataSourceConfig, EntityFieldDef } from "@erp-framework/core";
import { companies, entities, recordLocator } from "@erp-framework/db";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "./db";
import { resolveList } from "./datasource-resolver";
import { promoteEntityToTable } from "./entity-promote";
import { ensureEntityTable, tableNameForEntity } from "./entity-table-ddl";
import { getRecordStore } from "./record-store";

const RUN = process.env.HYBRID_DB === "1";

describe.skipIf(!RUN)("HYBRID storage (Postgres thật)", () => {
  let companyId = "";
  const createdEntityIds: string[] = [];

  const makeTableEntity = async (name: string, fields: EntityFieldDef[]): Promise<string> => {
    const [e] = await db
      .insert(entities)
      .values({ companyId, name, label: name, fields })
      .returning();
    const storage = await ensureEntityTable(db, e!.id, fields);
    await db.update(entities).set({ meta: { storage } }).where(eq(entities.id, e!.id));
    createdEntityIds.push(e!.id);
    return e!.id;
  };

  beforeAll(async () => {
    process.env.ERP_HYBRID_TABLES = "1";
    const slug = `hyb-test-${Date.now()}`;
    const [c] = await db.insert(companies).values({ name: "Hybrid Test", slug }).returning();
    companyId = c!.id;
  });

  afterAll(async () => {
    for (const eid of createdEntityIds) {
      try {
        await db.execute(sql.raw(`DROP TABLE IF EXISTS "${tableNameForEntity(eid)}"`));
      } catch {
        /* bỏ qua lỗi dọn */
      }
    }
    if (companyId) {
      try {
        await db.delete(companies).where(eq(companies.id, companyId)); // cascade entity/record/locator
      } catch {
        /* bỏ qua */
      }
    }
  });

  it("Phase 1 — entity bảng thật: CRUD + reconstruct data (numeric→number, ext)", async () => {
    const eid = await makeTableEntity("hyb_item", [
      { name: "ma", label: "Mã", type: "text", unique: true },
      { name: "so_luong", label: "SL", type: "number", filterable: true },
      { name: "tags", label: "Tags", type: "multiselect" }, // → ext
    ]);
    const store = getRecordStore(db);
    const created = await store.insert(
      companyId,
      eid,
      { ma: "A1", so_luong: 5, tags: ["x", "y"] },
      null,
    );
    expect(created).toBeTruthy();
    const got = await store.getById(companyId, created!.id);
    const d = got!.data as Record<string, unknown>;
    expect(d.ma).toBe("A1");
    expect(d.so_luong).toBe(5);
    expect(typeof d.so_luong).toBe("number"); // numeric col → number, không phải "5"
    expect(d.tags).toEqual(["x", "y"]); // từ ext

    // locator được ghi (op chỉ-recordId định tuyến được)
    const [loc] = await db.select().from(recordLocator).where(eq(recordLocator.id, created!.id));
    expect(loc?.entityId).toBe(eid);

    // list + filter cột base
    const l = await store.list(companyId, eid, { filters: { so_luong: { op: ">", value: 3 } } });
    expect(l.total).toBe(1);

    // merge giữ field cũ
    const merged = await store.merge(companyId, created!.id, { so_luong: 9 }, created!.version + 1);
    expect((merged!.data as Record<string, unknown>).so_luong).toBe(9);
    expect((merged!.data as Record<string, unknown>).ma).toBe("A1");

    // unique check qua store (dispatch table)
    expect(await store.existsWithFieldValue(companyId, eid, "ma", "A1")).toBe(true);
    expect(await store.existsWithFieldValue(companyId, eid, "ma", "ZZZ")).toBe(false);

    // soft delete → getActiveById null
    await store.softDelete(companyId, created!.id);
    expect(await store.getActiveById(companyId, eid, created!.id)).toBeNull();
  });

  it("Phase 2 — promote EAV→table: copy đủ + flip meta", async () => {
    const [e] = await db
      .insert(entities)
      .values({
        companyId,
        name: "hyb_eav",
        label: "EAV",
        fields: [
          { name: "ma", label: "Mã", type: "text" },
          { name: "gia", label: "Giá", type: "number" },
        ],
      })
      .returning();
    // Cờ bật nhưng entity CHƯA có storage → dispatcher đi EAV.
    const s2 = getRecordStore(db);
    await s2.insert(companyId, e!.id, { ma: "E1", gia: 10 }, null);
    await s2.insert(companyId, e!.id, { ma: "E2", gia: 20 }, null);

    const res = await promoteEntityToTable(db, companyId, e!.id);
    createdEntityIds.push(e!.id); // để afterAll DROP bảng er_
    expect(res.migrated).toBe(2);
    expect(res.total).toBe(2);
    expect(res.errors).toEqual([]);

    // Sau flip meta → đọc từ bảng thật.
    const s3 = getRecordStore(db);
    const list = await s3.list(companyId, e!.id, {});
    expect(list.total).toBe(2);
    const one = list.rows.find((r) => (r.data as Record<string, unknown>).ma === "E1");
    expect((one!.data as Record<string, unknown>).gia).toBe(10);
  });

  it("Phase 3 — JOIN SQL: filter field JOIN đúng trên TOÀN tập (gỡ giới hạn v1)", async () => {
    const custId = await makeTableEntity("hyb_cust", [
      { name: "ten", label: "Tên", type: "text", filterable: true },
    ]);
    const orderId = await makeTableEntity("hyb_order", [
      { name: "so", label: "Số", type: "text" },
      { name: "kh_id", label: "KH", type: "lookup", relationEntityId: custId, filterable: true },
    ]);
    const cs = getRecordStore(db);
    const c1 = await cs.insert(companyId, custId, { ten: "An" }, null);
    const c2 = await cs.insert(companyId, custId, { ten: "Binh" }, null);
    // 2 đơn của An (O1,O4), 3 của Binh.
    await cs.insert(companyId, orderId, { so: "O1", kh_id: c1!.id }, null);
    await cs.insert(companyId, orderId, { so: "O2", kh_id: c2!.id }, null);
    await cs.insert(companyId, orderId, { so: "O3", kh_id: c2!.id }, null);
    await cs.insert(companyId, orderId, { so: "O4", kh_id: c1!.id }, null);
    await cs.insert(companyId, orderId, { so: "O5", kh_id: c2!.id }, null);

    const cfg: DataSourceConfig = {
      baseEntityId: orderId,
      relations: [
        {
          id: "rel_kh",
          alias: "kh",
          fromRelationId: null,
          fromField: "kh_id",
          targetEntityId: custId,
          joinKind: "left",
        },
      ],
      fields: [
        { key: "so", sourceRelationId: "base", sourceField: "so", label: "Số", type: "text" },
        {
          key: "kh_ten",
          sourceRelationId: "rel_kh",
          sourceField: "ten",
          label: "Tên KH",
          type: "text",
        },
      ],
    };
    // Lọc theo field JOIN kh_ten='An' + limit nhỏ. Batch-stitch CŨ chỉ lọc trên
    // trang đã limit → sót O4. JOIN SQL đẩy filter xuống → đúng O1+O4, total=2.
    const r = await resolveList(db, companyId, "admin", cfg, {
      filters: { kh_ten: { op: "=", value: "An" } },
      limit: 2,
    });
    expect(r.total).toBe(2);
    expect(r.rows.every((row) => row.kh_ten === "An")).toBe(true);
    expect(r.rows.map((x) => x.so).sort()).toEqual(["O1", "O4"]);
  });
});
