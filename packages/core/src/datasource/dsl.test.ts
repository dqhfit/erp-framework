import { describe, expect, it } from "vitest";
import { compileDataSourceDsl, type DataSourceDsl, type DslEntity, decompileToDsl } from "./dsl";

/* Catalog tối thiểu: đơn hàng → khách hàng (lookup) + dòng hàng (1-N). */
const entities: DslEntity[] = [
  {
    id: "ent_order",
    name: "don_hang",
    fields: [
      { name: "id", type: "text" },
      { name: "ma", type: "text" },
      { name: "khach_id", type: "lookup", ref: "ent_customer" },
      { name: "tong_tien", type: "number" },
    ],
  },
  {
    id: "ent_customer",
    name: "khach_hang",
    fields: [
      { name: "id", type: "text" },
      { name: "ten", type: "text" },
      { name: "ma_kh", type: "text" },
    ],
  },
  {
    id: "ent_line",
    name: "dong_hang",
    fields: [
      { name: "id", type: "text" },
      { name: "don_id", type: "lookup", ref: "ent_order" },
      { name: "thanh_tien", type: "number" },
    ],
  },
];

const baseDsl: DataSourceDsl = {
  base: "don_hang",
  joins: [{ as: "khach", from: "don_hang", fromField: "khach_id", to: "khach_hang" }],
  columns: [
    { from: "don_hang", field: "ma" },
    { from: "khach", field: "ten", as: "khach_ten", label: "Tên KH" },
  ],
  aggregates: [
    { as: "so_dong", fn: "count", of: "dong_hang", byField: "don_id" },
    {
      as: "tong_dong",
      fn: "sum",
      of: "dong_hang",
      byField: "don_id",
      valueField: "thanh_tien",
    },
  ],
  limit: 50,
};

describe("compileDataSourceDsl", () => {
  it("compile DSL hợp lệ → config id-based, không lỗi", () => {
    const { config, errors, warnings } = compileDataSourceDsl(baseDsl, entities);
    expect(errors).toEqual([]);
    expect(warnings).toEqual([]);
    expect(config.baseEntityId).toBe("ent_order");
    expect(config.relations).toHaveLength(1);
    expect(config.relations[0]).toMatchObject({
      id: "rel_khach",
      alias: "khach",
      fromRelationId: null,
      fromField: "khach_id",
      targetEntityId: "ent_customer",
      joinKind: "left",
    });
    expect(config.defaultLimit).toBe(50);
  });

  it("relation id sinh deterministic từ alias (rel_<slug>)", () => {
    const a = compileDataSourceDsl(baseDsl, entities).config;
    const b = compileDataSourceDsl(baseDsl, entities).config;
    expect(a.relations[0]?.id).toBe("rel_khach");
    expect(b.relations[0]?.id).toBe(a.relations[0]?.id);
  });

  it("cột join trỏ đúng sourceRelationId + suy key khi thiếu 'as'", () => {
    const { config } = compileDataSourceDsl(baseDsl, entities);
    const maCol = config.fields.find((f) => f.sourceField === "ma");
    const tenCol = config.fields.find((f) => f.sourceField === "ten");
    expect(maCol).toMatchObject({ key: "ma", sourceRelationId: "base", writable: true });
    expect(tenCol).toMatchObject({
      key: "khach_ten",
      sourceRelationId: "rel_khach",
      writable: false,
    });
  });

  it("aggregate count + sum → cấu hình đúng target/field", () => {
    const { config } = compileDataSourceDsl(baseDsl, entities);
    expect(config.aggregates).toHaveLength(2);
    expect(config.aggregates?.[0]).toMatchObject({
      key: "so_dong",
      agg: "count",
      targetEntityId: "ent_line",
      targetField: "don_id",
    });
    expect(config.aggregates?.[1]).toMatchObject({
      key: "tong_dong",
      agg: "sum",
      valueField: "thanh_tien",
    });
  });

  it("đối tượng gốc không tồn tại → lỗi chặn, config rỗng", () => {
    const { config, errors } = compileDataSourceDsl({ base: "khong_co" }, entities);
    expect(errors[0]).toContain("đối tượng gốc");
    expect(config.baseEntityId).toBe("");
  });

  it("đối tượng đích join không tồn tại → lỗi", () => {
    const dsl: DataSourceDsl = {
      base: "don_hang",
      joins: [{ as: "x", from: "don_hang", fromField: "khach_id", to: "khong_co" }],
    };
    const { errors } = compileDataSourceDsl(dsl, entities);
    expect(errors.some((e) => e.includes("đối tượng đích"))).toBe(true);
  });

  it("field không tồn tại → cảnh báo (vẫn apply được)", () => {
    const dsl: DataSourceDsl = {
      base: "don_hang",
      columns: [{ from: "don_hang", field: "khong_co_field" }],
    };
    const { config, errors, warnings } = compileDataSourceDsl(dsl, entities);
    expect(errors).toEqual([]);
    expect(warnings.some((w) => w.includes("không tồn tại"))).toBe(true);
    expect(config.fields).toHaveLength(1);
  });

  it("join cột↔cột (toField khác id) giữ toField; toField='id' bỏ qua", () => {
    const dsl: DataSourceDsl = {
      base: "don_hang",
      joins: [
        { as: "k1", from: "don_hang", fromField: "khach_id", to: "khach_hang", toField: "ma_kh" },
        { as: "k2", from: "don_hang", fromField: "khach_id", to: "khach_hang", toField: "id" },
      ],
    };
    const { config } = compileDataSourceDsl(dsl, entities);
    expect(config.relations.find((r) => r.id === "rel_k1")?.toField).toBe("ma_kh");
    expect(config.relations.find((r) => r.id === "rel_k2")?.toField).toBeUndefined();
  });

  it("inner join giữ joinKind='inner'", () => {
    const dsl: DataSourceDsl = {
      base: "don_hang",
      joins: [
        { as: "k", from: "don_hang", fromField: "khach_id", to: "khach_hang", kind: "inner" },
      ],
    };
    const { config } = compileDataSourceDsl(dsl, entities);
    expect(config.relations[0]?.joinKind).toBe("inner");
  });
});

describe("decompileToDsl ↔ compile round-trip", () => {
  it("compile → decompile → compile cho config tương đương", () => {
    const { config: c1 } = compileDataSourceDsl(baseDsl, entities);
    const dsl2 = decompileToDsl(c1, entities);
    const { config: c2, errors } = compileDataSourceDsl(dsl2, entities);
    expect(errors).toEqual([]);
    expect(c2.baseEntityId).toBe(c1.baseEntityId);
    expect(c2.relations).toEqual(c1.relations);
    expect(c2.fields).toEqual(c1.fields);
    expect(c2.aggregates).toEqual(c1.aggregates);
  });

  it("decompile dùng TÊN đối tượng (không lộ id) cho base/to/of", () => {
    const { config } = compileDataSourceDsl(baseDsl, entities);
    const dsl = decompileToDsl(config, entities);
    expect(dsl.base).toBe("don_hang");
    expect(dsl.joins?.[0]?.to).toBe("khach_hang");
    expect(dsl.aggregates?.[0]?.of).toBe("dong_hang");
  });
});

describe("nested join", () => {
  const nested: DslEntity[] = [
    ...entities,
    {
      id: "ent_region",
      name: "khu_vuc",
      fields: [
        { name: "id", type: "text" },
        { name: "ten", type: "text" },
      ],
    },
    {
      id: "ent_customer2",
      name: "khach_hang",
      fields: [
        { name: "id", type: "text" },
        { name: "ten", type: "text" },
        { name: "kv_id", type: "lookup", ref: "ent_region" },
      ],
    },
  ];

  it("join lồng (from = alias join trước) → fromRelationId trỏ relation cha", () => {
    // khach_hang ở `nested` có thêm kv_id; dùng catalog có kv_id.
    const cat = nested.filter((e) => e.id !== "ent_customer");
    const dsl: DataSourceDsl = {
      base: "don_hang",
      joins: [
        { as: "khach", from: "don_hang", fromField: "khach_id", to: "khach_hang" },
        { as: "kv", from: "khach", fromField: "kv_id", to: "khu_vuc" },
      ],
    };
    const { config, errors } = compileDataSourceDsl(dsl, cat);
    expect(errors).toEqual([]);
    const kv = config.relations.find((r) => r.id === "rel_kv");
    expect(kv?.fromRelationId).toBe("rel_khach");
  });
});
