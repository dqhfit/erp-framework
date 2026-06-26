import type { EntityFieldDef, FilterOp } from "@erp-framework/core";
import { describe, expect, it } from "vitest";
import { sanitizeAgentFilters } from "./agent-records-search";

/** Field-def tối thiểu cho test cổng RBAC filter. */
const fields: EntityFieldDef[] = [
  { name: "ten", label: "Tên", type: "text" },
  { name: "tong_tien", label: "Tổng tiền", type: "number" },
  { name: "luong", label: "Lương", type: "number", encrypted: true },
  { name: "ghi_chu_admin", label: "Ghi chú admin", type: "text", readableBy: ["admin"] },
];

describe("sanitizeAgentFilters", () => {
  it("giữ filter field hợp lệ role đọc được", () => {
    expect(sanitizeAgentFilters(fields, { tong_tien: { op: ">", value: 100 } }, "viewer")).toEqual({
      tong_tien: { op: ">", value: 100 },
    });
  });

  it("bỏ field không tồn tại (LLM bịa / dò jsonb key)", () => {
    expect(
      sanitizeAgentFilters(fields, { khong_co: { op: "=", value: "x" } }, "admin"),
    ).toBeUndefined();
  });

  it("bỏ field mã hoá (so sánh ciphertext vô nghĩa)", () => {
    expect(sanitizeAgentFilters(fields, { luong: { op: ">", value: 1 } }, "admin")).toBeUndefined();
  });

  it("bỏ field role KHÔNG đọc được (chống filter-oracle)", () => {
    expect(
      sanitizeAgentFilters(fields, { ghi_chu_admin: { op: "contains", value: "a" } }, "viewer"),
    ).toBeUndefined();
    // admin đọc được → giữ
    expect(
      sanitizeAgentFilters(fields, { ghi_chu_admin: { op: "contains", value: "a" } }, "admin"),
    ).toEqual({ ghi_chu_admin: { op: "contains", value: "a" } });
  });

  it("bỏ op không hợp lệ", () => {
    const bad = { ten: { op: "like" as unknown as FilterOp, value: "x" } };
    expect(sanitizeAgentFilters(fields, bad, "admin")).toBeUndefined();
  });

  it("undefined / rỗng → undefined", () => {
    expect(sanitizeAgentFilters(fields, undefined, "admin")).toBeUndefined();
    expect(sanitizeAgentFilters(fields, {}, "admin")).toBeUndefined();
  });

  it("giữ phần hợp lệ, bỏ phần xấu trong cùng tập filter", () => {
    const out = sanitizeAgentFilters(
      fields,
      {
        ten: { op: "contains", value: "abc" },
        luong: { op: ">", value: 1 }, // encrypted → bỏ
        khong_co: { op: "=", value: "z" }, // lạ → bỏ
      },
      "admin",
    );
    expect(out).toEqual({ ten: { op: "contains", value: "abc" } });
  });
});
