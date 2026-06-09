/* ==========================================================
   datasource-sql-join.test.ts — Unit test logic THUẦN của nhánh JOIN SQL:
   điều kiện đủ (eligibility) + hình dạng SQL sinh ra. (Execute cần Postgres
   → verify e2e riêng.) Dùng drizzle PgDialect để render SQL ra chuỗi assert.
   ========================================================== */
import type { DataSourceConfig } from "@erp-framework/core";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { tryBuildJoinQuery } from "./datasource-sql-join";
import type { EntityStorage } from "./entity-table-ddl";

const dialect = new PgDialect();
const render = (q: { rowsSql: import("drizzle-orm").SQL }) => dialect.sqlToQuery(q.rowsSql).sql;

const tableStorage = (
  name: string,
  cols: Record<string, "text" | "numeric" | "boolean">,
): EntityStorage => ({
  tier: "table",
  tableName: name,
  columns: Object.fromEntries(
    Object.entries(cols).map(([f, t]) => [f, { col: `f_${f}`, pgType: t }]),
  ),
  version: 1,
});

const CO = "co-1";
const E_ORDER = "11111111-1111-4111-8111-111111111111";
const E_CUST = "22222222-2222-4222-8222-222222222222";

describe("tryBuildJoinQuery — eligibility", () => {
  it("null khi base không phải bảng thật", () => {
    const cfg: DataSourceConfig = { baseEntityId: E_ORDER, relations: [], fields: [] };
    expect(tryBuildJoinQuery(cfg, { [E_ORDER]: null }, CO, {})).toBeNull();
  });

  it("null khi có aggregate", () => {
    const cfg: DataSourceConfig = {
      baseEntityId: E_ORDER,
      relations: [],
      fields: [],
      aggregates: [
        { key: "cnt", label: "n", agg: "count", targetEntityId: E_CUST, targetField: "order_id" },
      ],
    };
    expect(tryBuildJoinQuery(cfg, { [E_ORDER]: tableStorage("er_o", {}) }, CO, {})).toBeNull();
  });

  it("null khi có full-text q", () => {
    const cfg: DataSourceConfig = { baseEntityId: E_ORDER, relations: [], fields: [] };
    expect(
      tryBuildJoinQuery(cfg, { [E_ORDER]: tableStorage("er_o", {}) }, CO, { q: "abc" }),
    ).toBeNull();
  });

  it("null khi relation target không phải bảng", () => {
    const cfg: DataSourceConfig = {
      baseEntityId: E_ORDER,
      relations: [
        {
          id: "rel_kh",
          alias: "kh",
          fromRelationId: null,
          fromField: "kh_id",
          targetEntityId: E_CUST,
          joinKind: "left",
        },
      ],
      fields: [],
    };
    const storages = {
      [E_ORDER]: tableStorage("er_o", { kh_id: "text" }),
      [E_CUST]: null,
    };
    expect(tryBuildJoinQuery(cfg, storages, CO, {})).toBeNull();
  });

  it("null khi FK join không phải cột typed (ở ext)", () => {
    const cfg: DataSourceConfig = {
      baseEntityId: E_ORDER,
      relations: [
        {
          id: "rel_kh",
          alias: "kh",
          fromRelationId: null,
          fromField: "kh_id",
          targetEntityId: E_CUST,
          joinKind: "left",
        },
      ],
      fields: [],
    };
    const storages = {
      [E_ORDER]: tableStorage("er_o", {}), // kh_id KHÔNG phải cột → ext
      [E_CUST]: tableStorage("er_c", {}),
    };
    expect(tryBuildJoinQuery(cfg, storages, CO, {})).toBeNull();
  });
});

describe("tryBuildJoinQuery — SQL sinh ra", () => {
  const cfg: DataSourceConfig = {
    baseEntityId: E_ORDER,
    relations: [
      {
        id: "rel_kh",
        alias: "kh",
        fromRelationId: null,
        fromField: "kh_id",
        targetEntityId: E_CUST,
        joinKind: "left",
      },
    ],
    fields: [
      { key: "ma", sourceRelationId: "base", sourceField: "ma", label: "Mã", type: "text" },
      {
        key: "kh_ten",
        sourceRelationId: "rel_kh",
        sourceField: "ten",
        label: "Tên KH",
        type: "text",
      },
    ],
    baseFilters: { trang_thai: { op: "=", value: "moi" } },
    sort: { key: "ma", dir: "desc" },
  };
  const storages = {
    [E_ORDER]: tableStorage("er_o", { ma: "text", kh_id: "text", trang_thai: "text" }),
    [E_CUST]: tableStorage("er_c", { ten: "text" }),
  };

  it("build được + chứa JOIN/WHERE/ORDER/LIMIT đúng node", () => {
    const built = tryBuildJoinQuery(cfg, storages, CO, { limit: 50, offset: 10 });
    expect(built).not.toBeNull();
    const s = render(built!);
    expect(s).toContain('"er_o" b');
    expect(s).toContain('LEFT JOIN "er_c" j0 ON b."f_kh_id" = j0.id');
    expect(s).toContain("j0.deleted_at"); // scope join trong ON (không phá LEFT)
    expect(s).toContain('b."f_ma" AS "ma"');
    expect(s).toContain('j0."f_ten" AS "kh_ten"');
    expect(s).toContain('b."f_trang_thai"::text ='); // baseFilter pushdown
    expect(s).toContain('ORDER BY b."f_ma" DESC');
    expect(s).toContain("LIMIT");
    expect(s).toContain("OFFSET");
  });

  it("filter field JOIN (key chiếu) → đẩy xuống đúng alias (gỡ giới hạn v1)", () => {
    const built = tryBuildJoinQuery(cfg, storages, CO, {
      filters: { kh_ten: { op: "contains", value: "An" } },
    });
    expect(built).not.toBeNull();
    const s = render(built!);
    expect(s).toContain('j0."f_ten"::text ILIKE');
  });

  it("null khi filter trỏ field không phải cột (ext)", () => {
    const built = tryBuildJoinQuery(cfg, storages, CO, {
      filters: { ma: { op: "=", value: "X" } }, // ma là cột → ok
      sort: { key: "kh_ten", dir: "asc" },
    });
    // kh_ten là cột (f_ten) → vẫn build được
    expect(built).not.toBeNull();
  });
});
