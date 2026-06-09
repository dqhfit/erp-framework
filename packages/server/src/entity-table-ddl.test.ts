/* ==========================================================
   entity-table-ddl.test.ts — Unit test logic THUẦN của DDL động:
   quyết tier, map kiểu cột, slug + dedupe + an toàn identifier, sinh DDL.
   (Phần thực thi ensureEntityTable cần Postgres → verify e2e riêng.)
   ========================================================== */
import type { EntityFieldDef } from "@erp-framework/core";
import { describe, expect, it } from "vitest";
import {
  assertIdent,
  buildColumnMap,
  coerceColumnValue,
  createTableDDL,
  fieldTier,
  indexDDL,
  pgTypeFor,
  planFieldChange,
  planStorageSync,
  slugIdent,
  storageDescriptor,
  tableNameForEntity,
} from "./entity-table-ddl";

const f = (over: Partial<EntityFieldDef>): EntityFieldDef => ({
  name: over.name ?? "x",
  label: over.label ?? "X",
  type: over.type ?? "text",
  ...over,
});

describe("fieldTier", () => {
  it("vô hướng + quan hệ đơn → column", () => {
    for (const t of [
      "text",
      "number",
      "boolean",
      "date",
      "datetime",
      "select",
      "enum",
      "sequence",
      "relation",
      "lookup",
    ]) {
      expect(fieldTier(f({ type: t }))).toBe("column");
    }
  });
  it("đa-trị / tính toán / json → ext", () => {
    for (const t of [
      "multiselect",
      "multienum",
      "multilookup",
      "collection",
      "rollup",
      "formula",
      "json",
    ]) {
      expect(fieldTier(f({ type: t }))).toBe("ext");
    }
  });
  it("timeseries → none", () => {
    expect(fieldTier(f({ type: "timeseries" }))).toBe("none");
  });
  it("encrypted → ext dù là vô hướng", () => {
    expect(fieldTier(f({ type: "text", encrypted: true }))).toBe("ext");
  });
  it("kiểu lạ (plugin) → ext (an toàn)", () => {
    expect(fieldTier(f({ type: "rating" }))).toBe("ext");
  });
});

describe("pgTypeFor", () => {
  it("number→numeric, boolean→boolean, còn lại→text", () => {
    expect(pgTypeFor(f({ type: "number" }))).toBe("numeric");
    expect(pgTypeFor(f({ type: "boolean" }))).toBe("boolean");
    expect(pgTypeFor(f({ type: "date" }))).toBe("text");
    expect(pgTypeFor(f({ type: "lookup" }))).toBe("text");
  });
});

describe("coerceColumnValue", () => {
  it("null/'' → null", () => {
    expect(coerceColumnValue("text", "")).toBeNull();
    expect(coerceColumnValue("numeric", null)).toBeNull();
  });
  it("numeric: số hợp lệ giữ, rác → null", () => {
    expect(coerceColumnValue("numeric", "12.5")).toBe(12.5);
    expect(coerceColumnValue("numeric", "abc")).toBeNull();
  });
  it("boolean: nhận nhiều dạng", () => {
    expect(coerceColumnValue("boolean", "true")).toBe(true);
    expect(coerceColumnValue("boolean", 0)).toBe(false);
    expect(coerceColumnValue("boolean", "maybe")).toBeNull();
  });
});

describe("slugIdent + assertIdent", () => {
  it("bỏ dấu tiếng Việt, [^a-z0-9]→_", () => {
    expect(slugIdent("Mã Đơn Hàng")).toBe("ma_don_hang");
    expect(slugIdent("tổng-tiền (VND)")).toBe("tong_tien_vnd");
  });
  it("rỗng → x", () => {
    expect(slugIdent("***")).toBe("x");
  });
  it("assertIdent chặn ký tự lạ / mở đầu số", () => {
    expect(() => assertIdent("f_ok")).not.toThrow();
    expect(() => assertIdent("1bad")).toThrow();
    expect(() => assertIdent('a"; DROP TABLE x; --')).toThrow();
  });
});

describe("tableNameForEntity", () => {
  it("er_ + hex(entityId) bỏ gạch", () => {
    expect(tableNameForEntity("11111111-1111-4111-8111-111111111111")).toBe(
      "er_11111111111141118111111111111111",
    );
  });
});

describe("buildColumnMap", () => {
  it("tách column vs ext theo tier; ext giữ field đa-trị/encrypted", () => {
    const { columns, extFields } = buildColumnMap([
      f({ name: "ma", type: "text" }),
      f({ name: "so_luong", type: "number" }),
      f({ name: "tags", type: "multiselect" }),
      f({ name: "luong", type: "number", encrypted: true }),
      f({ name: "lich_su", type: "timeseries" }),
    ]);
    expect(columns.map((c) => c.field)).toEqual(["ma", "so_luong"]);
    expect(columns.find((c) => c.field === "so_luong")?.pgType).toBe("numeric");
    expect(extFields.sort()).toEqual(["luong", "tags"]);
  });

  it("dedupe tên cột khi slug trùng", () => {
    const { columns } = buildColumnMap([f({ name: "Mã Đơn" }), f({ name: "mã-đơn" })]);
    const cols = columns.map((c) => c.col);
    expect(cols).toHaveLength(2);
    expect(new Set(cols).size).toBe(2); // không trùng
    expect(cols[0]).toBe("f_ma_don");
  });

  it("không đụng tên cột hệ thống (prefix f_)", () => {
    const { columns } = buildColumnMap([f({ name: "version" }), f({ name: "id" })]);
    for (const c of columns) expect(c.col.startsWith("f_")).toBe(true);
  });

  it("đánh dấu unique/indexed theo cờ field", () => {
    const { columns } = buildColumnMap([
      f({ name: "ma", unique: true }),
      f({ name: "ten", filterable: true }),
      f({ name: "ghi_chu" }),
    ]);
    expect(columns.find((c) => c.field === "ma")?.unique).toBe(true);
    expect(columns.find((c) => c.field === "ten")?.indexed).toBe(true);
    expect(columns.find((c) => c.field === "ghi_chu")?.indexed).toBe(false);
  });
});

describe("createTableDDL + indexDDL", () => {
  const { columns } = buildColumnMap([
    f({ name: "ma", type: "text", unique: true }),
    f({ name: "gia", type: "number", filterable: true }),
  ]);
  const tn = tableNameForEntity("22222222-2222-4222-8222-222222222222");

  it("CREATE TABLE có cột hệ thống + ext + cột typed", () => {
    const ddl = createTableDDL(tn, columns);
    expect(ddl).toContain("CREATE TABLE IF NOT EXISTS");
    expect(ddl).toContain("ext jsonb NOT NULL DEFAULT");
    expect(ddl).toContain('"f_ma" text');
    expect(ddl).toContain('"f_gia" numeric');
    expect(ddl).toContain("company_id uuid NOT NULL");
  });

  it("index: company/deleted/ext-gin + unique partial + per-column", () => {
    const ix = indexDDL(tn, columns);
    expect(ix.some((s) => s.includes("USING gin (ext)"))).toBe(true);
    expect(
      ix.some(
        (s) =>
          s.includes("UNIQUE INDEX") &&
          s.includes('"f_ma"') &&
          s.includes("WHERE deleted_at IS NULL"),
      ),
    ).toBe(true);
    expect(ix.some((s) => s.includes('("f_gia")') && !s.includes("UNIQUE"))).toBe(true);
  });
});

describe("planStorageSync", () => {
  const base = storageDescriptor("44444444-4444-4444-8444-444444444444", [
    f({ name: "ma", type: "text" }),
    f({ name: "gia", type: "number" }),
  ]);

  it("thêm field column → addColumns + giữ cột cũ", () => {
    const { next, addColumns, dropColumns } = planStorageSync(base, [
      f({ name: "ma", type: "text" }),
      f({ name: "gia", type: "number" }),
      f({ name: "ten", type: "text" }),
    ]);
    expect(addColumns.map((c) => c.field)).toEqual(["ten"]);
    expect(dropColumns).toEqual([]);
    expect(next.columns.ten?.col).toBe("f_ten");
    expect(next.columns.ma?.col).toBe("f_ma"); // giữ nguyên
    expect(next.version).toBe(base.version + 1);
  });

  it("xoá field → dropColumns", () => {
    const { addColumns, dropColumns, next } = planStorageSync(base, [
      f({ name: "ma", type: "text" }),
    ]);
    expect(addColumns).toEqual([]);
    expect(dropColumns).toEqual(["f_gia"]);
    expect(next.columns.gia).toBeUndefined();
  });

  it("field column → ext (đổi sang multiselect) → drop cột", () => {
    const { addColumns, dropColumns } = planStorageSync(base, [
      f({ name: "ma", type: "text" }),
      f({ name: "gia", type: "multiselect" }),
    ]);
    expect(addColumns).toEqual([]);
    expect(dropColumns).toEqual(["f_gia"]);
  });

  it("không đổi → không add/drop", () => {
    const { addColumns, dropColumns } = planStorageSync(base, [
      f({ name: "ma", type: "text" }),
      f({ name: "gia", type: "number" }),
    ]);
    expect(addColumns).toEqual([]);
    expect(dropColumns).toEqual([]);
  });
});

describe("planFieldChange", () => {
  const st = storageDescriptor("55555555-5555-4555-8555-555555555555", [
    f({ name: "ma", type: "text" }),
    f({ name: "gia", type: "number" }),
  ]);

  it("cùng pgType → none", () => {
    expect(planFieldChange(st, "ma", f({ name: "ma", type: "text" })).plan.kind).toBe("none");
  });
  it("đổi pgType text→number → type", () => {
    const { plan, next } = planFieldChange(st, "ma", f({ name: "ma", type: "number" }));
    expect(plan).toMatchObject({ kind: "type", col: "f_ma", newPgType: "numeric" });
    expect(next.columns.ma?.pgType).toBe("numeric");
  });
  it("column → ext (text→multiselect) → col-to-ext, bỏ khỏi columns", () => {
    const { plan, next } = planFieldChange(st, "ma", f({ name: "ma", type: "multiselect" }));
    expect(plan).toMatchObject({ kind: "col-to-ext", col: "f_ma" });
    expect(next.columns.ma).toBeUndefined();
  });
  it("ext → column (field chưa có cột) → ext-to-col", () => {
    const { plan, next } = planFieldChange(st, "tags", f({ name: "tags", type: "text" }));
    expect(plan).toMatchObject({ kind: "ext-to-col", col: "f_tags", pgType: "text" });
    expect(next.columns.tags?.col).toBe("f_tags");
  });
  it("ext → ext → none", () => {
    expect(planFieldChange(st, "tags", f({ name: "tags", type: "json" })).plan.kind).toBe("none");
  });
});

describe("storageDescriptor", () => {
  it("trả tier table + tableName + map field→col/pgType", () => {
    const st = storageDescriptor("33333333-3333-4333-8333-333333333333", [
      f({ name: "ma", type: "text" }),
      f({ name: "tags", type: "multiselect" }),
    ]);
    expect(st.tier).toBe("table");
    expect(st.tableName).toBe("er_33333333333343338333333333333333");
    expect(st.columns.ma).toEqual({ col: "f_ma", pgType: "text" });
    expect(st.columns.tags).toBeUndefined(); // ext → không vào columns
  });
});
