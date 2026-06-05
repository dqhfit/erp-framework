import type { DataSourceConfig } from "@erp-framework/core";
import { describe, expect, it } from "vitest";
import { type AlEntity, buildFkGraph, suggestLinks } from "./datasource-autolink";

/* Fixture schema:
   order  --(khach_hang: lookup→customer)-->  customer --(khu_vuc: lookup→region)--> region
   order_line --(don_hang: lookup→order)--> order   (quan hệ ngược 1-N của order)
   note: entity rời, không FK nào.
*/
const customer: AlEntity = {
  id: "customer",
  name: "Khách hàng",
  fields: [{ id: "c_khu", name: "khu_vuc", label: "Khu vực", type: "lookup", ref: "region" }],
};
const region: AlEntity = { id: "region", name: "Khu vực", fields: [] };
const order: AlEntity = {
  id: "order",
  name: "Đơn hàng",
  fields: [
    { id: "o_kh", name: "khach_hang", label: "Khách hàng", type: "lookup", ref: "customer" },
    { id: "o_total", name: "tong_tien", label: "Tổng tiền", type: "number" },
  ],
};
const orderLine: AlEntity = {
  id: "order_line",
  name: "Dòng đơn",
  fields: [{ id: "ol_dh", name: "don_hang", label: "Đơn hàng", type: "lookup", ref: "order" }],
};
const note: AlEntity = { id: "note", name: "Ghi chú", fields: [] };

const ALL = [customer, region, order, orderLine, note];

const baseCfg = (baseEntityId: string): DataSourceConfig => ({
  baseEntityId,
  relations: [],
  fields: [],
});

describe("suggestLinks — Tier 1 (FK trực tiếp)", () => {
  it("phát hiện lookup order.khach_hang → customer", () => {
    const s = suggestLinks(ALL, baseCfg("order"));
    const direct = s.find((x) => x.kind === "join" && x.targetEntityId === "customer");
    expect(direct).toBeDefined();
    expect(direct?.tier).toBe(1);
    expect(direct?.confidence).toBeCloseTo(0.98);
    expect(direct?.steps).toHaveLength(1);
    expect(direct?.steps[0]).toMatchObject({ fromField: "khach_hang", toField: "id" });
  });
});

describe("suggestLinks — Tier 3 (gián tiếp qua bảng trung gian)", () => {
  it("order → region đi qua customer (2 hop)", () => {
    const s = suggestLinks(ALL, baseCfg("order"));
    const indirect = s.find((x) => x.kind === "join" && x.targetEntityId === "region");
    expect(indirect).toBeDefined();
    expect(indirect?.tier).toBe(3);
    expect(indirect?.steps).toHaveLength(2);
    expect(indirect?.steps.map((st) => st.toEntityId)).toEqual(["customer", "region"]);
    // confidence < tier 1
    expect(indirect?.confidence).toBeLessThan(0.98);
    expect(indirect?.confidence).toBeCloseTo(0.9 * 0.7);
  });

  it("đường ngắn nhất: region chỉ xuất hiện 1 lần (không trùng path dài)", () => {
    const s = suggestLinks(ALL, baseCfg("order"));
    expect(s.filter((x) => x.kind === "join" && x.targetEntityId === "region")).toHaveLength(1);
  });
});

describe("suggestLinks — Tier 2 (quan hệ ngược 1-N → aggregate)", () => {
  it("order nhận đề xuất aggregate từ order_line", () => {
    const s = suggestLinks(ALL, baseCfg("order"));
    const agg = s.find((x) => x.kind === "aggregate" && x.targetEntityId === "order_line");
    expect(agg).toBeDefined();
    expect(agg?.tier).toBe(2);
    expect(agg?.aggTargetField).toBe("don_hang");
  });
});

describe("suggestLinks — không tìm thấy / dedupe", () => {
  it("entity rời (note) → không có đề xuất join nào", () => {
    const s = suggestLinks(ALL, baseCfg("note"));
    expect(s.filter((x) => x.kind === "join")).toHaveLength(0);
  });

  it("bỏ đề xuất khi hop đầu đã tồn tại trong relations", () => {
    const cfg: DataSourceConfig = {
      baseEntityId: "order",
      relations: [
        {
          id: "r1",
          alias: "kh",
          fromRelationId: null,
          fromField: "khach_hang",
          targetEntityId: "customer",
          joinKind: "left",
        },
      ],
      fields: [],
    };
    const s = suggestLinks(ALL, cfg);
    // customer (hop đầu base→customer) không còn được đề xuất lại từ base…
    expect(
      s.find(
        (x) => x.kind === "join" && x.fromNodeId === "base" && x.targetEntityId === "customer",
      ),
    ).toBeUndefined();
    // …nhưng region giờ được đề xuất TRỰC TIẾP từ node "r1" (customer) như tier 1.
    const fromRel = s.find(
      (x) => x.kind === "join" && x.fromNodeId === "r1" && x.targetEntityId === "region",
    );
    expect(fromRel).toBeDefined();
    expect(fromRel?.tier).toBe(1);
  });

  it("baseEntityId rỗng → mảng rỗng", () => {
    expect(suggestLinks(ALL, baseCfg(""))).toEqual([]);
  });
});

describe("buildFkGraph", () => {
  it("bỏ qua lookup có ref trỏ tới entity không tồn tại", () => {
    const broken: AlEntity = {
      id: "x",
      name: "X",
      fields: [{ id: "f", name: "ghost", type: "lookup", ref: "khong_ton_tai" }],
    };
    const g = buildFkGraph([broken]);
    expect(g.get("x")).toEqual([]);
  });
});
