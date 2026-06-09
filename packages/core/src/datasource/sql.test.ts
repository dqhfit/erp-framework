import { describe, expect, it } from "vitest";
import type { DataSourceConfig } from "./config";
import type { DslEntity } from "./dsl";
import { dataSourceToSql, sqlToDataSource } from "./sql";

/* Catalog: đơn hàng → khách hàng (lookup) + dòng hàng (1-N reverse FK). */
const entities: DslEntity[] = [
  {
    id: "ent_order",
    name: "don_hang",
    fields: [
      { name: "id", type: "text" },
      { name: "ma", type: "text" },
      { name: "khach_id", type: "lookup", ref: "ent_customer" },
      { name: "trang_thai", type: "text" },
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

describe("sqlToDataSource — parse cơ bản", () => {
  it("SELECT + LEFT JOIN → base + relation + cột chiếu", () => {
    const sql = `
      SELECT base.ma, kh.ten AS ten_kh
      FROM don_hang AS base
      LEFT JOIN khach_hang AS kh ON base.khach_id = kh.id
    `;
    const { config, errors } = sqlToDataSource(sql, entities);
    expect(errors).toEqual([]);
    expect(config.baseEntityId).toBe("ent_order");
    expect(config.relations).toHaveLength(1);
    const rel = config.relations[0]!;
    expect(rel.targetEntityId).toBe("ent_customer");
    expect(rel.fromField).toBe("khach_id");
    expect(rel.toField).toBeUndefined(); // = id
    expect(rel.joinKind).toBe("left");
    expect(config.fields.map((f) => f.key)).toEqual(["ma", "ten_kh"]);
  });

  it("INNER JOIN / JOIN trần → joinKind inner", () => {
    const sql = `SELECT base.ma FROM don_hang base JOIN khach_hang kh ON base.khach_id = kh.id`;
    const { config } = sqlToDataSource(sql, entities);
    expect(config.relations[0]?.joinKind).toBe("inner");
  });

  it("ON ngược chiều (kh.id = base.khach_id) vẫn nhận đúng from/to", () => {
    const sql = `SELECT base.ma FROM don_hang base LEFT JOIN khach_hang kh ON kh.id = base.khach_id`;
    const { config, errors } = sqlToDataSource(sql, entities);
    expect(errors).toEqual([]);
    expect(config.relations[0]?.fromField).toBe("khach_id");
  });

  it("join cột↔cột (toField ≠ id) giữ toField", () => {
    const sql = `SELECT base.ma FROM don_hang base LEFT JOIN khach_hang kh ON base.khach_id = kh.ma_kh`;
    const { config } = sqlToDataSource(sql, entities);
    expect(config.relations[0]?.toField).toBe("ma_kh");
  });

  it("node.* mở rộng toàn bộ field của node", () => {
    const sql = `SELECT kh.* FROM don_hang base LEFT JOIN khach_hang kh ON base.khach_id = kh.id`;
    const { config } = sqlToDataSource(sql, entities);
    expect(config.fields.map((f) => f.sourceField)).toEqual(["id", "ten", "ma_kh"]);
  });
});

describe("sqlToDataSource — aggregate subquery tương quan", () => {
  it("COUNT(*) → aggregate count 1-N", () => {
    const sql = `
      SELECT base.ma,
        (SELECT COUNT(*) FROM dong_hang c WHERE c.don_id = base.id) AS so_dong
      FROM don_hang base
    `;
    const { config, errors } = sqlToDataSource(sql, entities);
    expect(errors).toEqual([]);
    expect(config.aggregates).toHaveLength(1);
    const a = config.aggregates![0]!;
    expect(a.agg).toBe("count");
    expect(a.targetEntityId).toBe("ent_line");
    expect(a.targetField).toBe("don_id");
    expect(a.key).toBe("so_dong");
  });

  it("SUM(c.thanh_tien) → aggregate sum + valueField", () => {
    const sql = `
      SELECT base.ma,
        (SELECT SUM(c.thanh_tien) FROM dong_hang c WHERE c.don_id = base.id) AS tong
      FROM don_hang base
    `;
    const { config } = sqlToDataSource(sql, entities);
    const a = config.aggregates![0]!;
    expect(a.agg).toBe("sum");
    expect(a.valueField).toBe("thanh_tien");
  });
});

describe("sqlToDataSource — WHERE / ORDER BY / LIMIT / TOP", () => {
  it("WHERE field gốc → baseFilters; ops =,>,LIKE,IN", () => {
    const sql = `
      SELECT base.ma FROM don_hang base
      WHERE base.trang_thai = 'moi' AND base.tong_tien > 1000
        AND base.ma LIKE '%DH%' AND base.trang_thai IN ('moi','xong')
    `;
    const { config, errors } = sqlToDataSource(sql, entities);
    expect(errors).toEqual([]);
    expect(config.baseFilters?.tong_tien).toEqual({ op: ">", value: 1000 });
    expect(config.baseFilters?.ma).toEqual({ op: "contains", value: "DH" });
    expect(config.baseFilters?.trang_thai).toEqual({ op: "in", value: ["moi", "xong"] });
  });

  it("WHERE trên field join → cảnh báo, không vào baseFilters", () => {
    const sql = `
      SELECT base.ma FROM don_hang base
      LEFT JOIN khach_hang kh ON base.khach_id = kh.id
      WHERE kh.ten = 'A'
    `;
    const { config, warnings } = sqlToDataSource(sql, entities);
    expect(config.baseFilters).toBeUndefined();
    expect(warnings.some((w) => w.includes("kh.ten"))).toBe(true);
  });

  it("OR trong WHERE → lỗi", () => {
    const sql = `SELECT base.ma FROM don_hang base WHERE base.tong_tien > 1 OR base.tong_tien < 0`;
    const { errors } = sqlToDataSource(sql, entities);
    expect(errors.some((e) => e.includes("OR"))).toBe(true);
  });

  it("ORDER BY base.field (đã chọn) → sort theo key cột chiếu", () => {
    const sql = `SELECT base.tong_tien FROM don_hang base ORDER BY base.tong_tien DESC`;
    const { config } = sqlToDataSource(sql, entities);
    expect(config.sort).toEqual({ key: "tong_tien", dir: "desc" });
  });

  it("SELECT TOP n và LIMIT n đều → defaultLimit", () => {
    expect(
      sqlToDataSource(`SELECT TOP 25 base.ma FROM don_hang base`, entities).config.defaultLimit,
    ).toBe(25);
    expect(
      sqlToDataSource(`SELECT base.ma FROM don_hang base LIMIT 10`, entities).config.defaultLimit,
    ).toBe(10);
  });

  it("nhận [ngoặc vuông], comment -- và /* */", () => {
    const sql = `
      -- nguồn đơn hàng
      SELECT [base].[ma] /* mã đơn */ FROM don_hang base LIMIT 5
    `;
    const { config, errors } = sqlToDataSource(sql, entities);
    expect(errors).toEqual([]);
    expect(config.fields[0]?.sourceField).toBe("ma");
    expect(config.defaultLimit).toBe(5);
  });
});

describe("sqlToDataSource — lỗi", () => {
  it("không SELECT → lỗi", () => {
    expect(sqlToDataSource("UPDATE x SET y=1", entities).errors.length).toBeGreaterThan(0);
  });
  it("base không tồn tại → lỗi (qua compile DSL)", () => {
    const { errors } = sqlToDataSource("SELECT a.x FROM khong_co a", entities);
    expect(errors.some((e) => e.includes("khong_co"))).toBe(true);
  });
});

describe("round-trip config ↔ SQL", () => {
  it("dataSourceToSql → sqlToDataSource giữ nguyên cấu trúc", () => {
    const cfg: DataSourceConfig = {
      baseEntityId: "ent_order",
      relations: [
        {
          id: "rel_kh",
          alias: "kh",
          fromRelationId: null,
          fromField: "khach_id",
          targetEntityId: "ent_customer",
          joinKind: "left",
        },
      ],
      fields: [
        {
          key: "ma",
          sourceRelationId: "base",
          sourceField: "ma",
          label: "Mã",
          type: "text",
          writable: true,
        },
        {
          key: "ten_kh",
          sourceRelationId: "rel_kh",
          sourceField: "ten",
          label: "Tên KH",
          type: "text",
          writable: false,
        },
      ],
      aggregates: [
        {
          key: "so_dong",
          label: "Số dòng",
          agg: "count",
          targetEntityId: "ent_line",
          targetField: "don_id",
        },
      ],
      baseFilters: { trang_thai: { op: "=", value: "moi" } },
      sort: { key: "ma", dir: "asc" },
      defaultLimit: 100,
    };
    const sql = dataSourceToSql(cfg, entities);
    const { config, errors } = sqlToDataSource(sql, entities);
    expect(errors).toEqual([]);
    expect(config.baseEntityId).toBe("ent_order");
    expect(config.relations).toHaveLength(1);
    expect(config.relations[0]?.fromField).toBe("khach_id");
    expect(config.fields.map((f) => f.key).sort()).toEqual(["ma", "ten_kh"]);
    expect(config.aggregates?.[0]?.agg).toBe("count");
    expect(config.baseFilters?.trang_thai).toEqual({ op: "=", value: "moi" });
    expect(config.sort).toEqual({ key: "ma", dir: "asc" });
    expect(config.defaultLimit).toBe(100);
  });
});

describe("tên kỹ thuật (techName) — bền vững qua đổi nhãn", () => {
  // Nhãn (name) đã bị đổi sau migrate; techName (snake_case) giữ nguyên.
  const ents: DslEntity[] = [
    {
      id: "ent_dm",
      name: "Định mức (đã đổi nhãn)",
      techName: "mes_dinhmuc",
      fields: [
        { name: "id", type: "text" },
        { name: "so_luong", type: "number" },
        { name: "kh_id", type: "lookup", ref: "ent_kh" },
      ],
    },
    {
      id: "ent_kh",
      name: "Khách",
      techName: "dm_khach",
      fields: [
        { name: "id", type: "text" },
        { name: "ten", type: "text" },
      ],
    },
  ];

  it("FROM/JOIN theo TÊN KỸ THUẬT resolve đúng entity", () => {
    const sql = `SELECT base.so_luong, kh.ten AS ten_kh
      FROM mes_dinhmuc base LEFT JOIN dm_khach kh ON base.kh_id = kh.id`;
    const { config, errors } = sqlToDataSource(sql, ents);
    expect(errors).toEqual([]);
    expect(config.baseEntityId).toBe("ent_dm");
    expect(config.relations[0]?.targetEntityId).toBe("ent_kh");
    expect(config.fields.map((f) => f.key)).toEqual(["so_luong", "ten_kh"]);
  });

  it("vẫn nhận NHÃN hiển thị (nếu chưa đổi) — tương thích ngược", () => {
    const sql = `SELECT base.so_luong FROM "Định mức (đã đổi nhãn)" base`;
    const { config, errors } = sqlToDataSource(sql, ents);
    expect(errors).toEqual([]);
    expect(config.baseEntityId).toBe("ent_dm");
  });

  it("dataSourceToSql PHÁT tên kỹ thuật (không phát nhãn)", () => {
    const cfg: DataSourceConfig = {
      baseEntityId: "ent_dm",
      relations: [
        {
          id: "rel_kh",
          alias: "kh",
          fromRelationId: null,
          fromField: "kh_id",
          targetEntityId: "ent_kh",
          joinKind: "left",
        },
      ],
      fields: [
        {
          key: "so_luong",
          sourceRelationId: "base",
          sourceField: "so_luong",
          label: "SL",
          type: "number",
          writable: true,
        },
      ],
    };
    const sql = dataSourceToSql(cfg, ents);
    expect(sql).toContain("FROM mes_dinhmuc base");
    expect(sql).toContain("dm_khach kh");
    expect(sql).not.toContain("Định mức");
  });
});
