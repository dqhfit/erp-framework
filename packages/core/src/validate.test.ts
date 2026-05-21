import { describe, it, expect } from "vitest";
import { validateRecord } from "./validate";
import type { EntityFieldDef } from "./datasource/index";

const fields: EntityFieldDef[] = [
  { name: "ten", label: "Tên", type: "text", required: true },
  { name: "gia", label: "Giá", type: "number" },
  { name: "active", label: "Kích hoạt", type: "boolean" },
  { name: "loai", label: "Loại", type: "select", options: ["A", "B"] },
  { name: "tong", label: "Tổng", type: "formula", formula: "{gia}*2" },
];

describe("validateRecord", () => {
  it("ép kiểu number từ chuỗi số → JS number", () => {
    const r = validateRecord(fields, { ten: "Bàn", gia: "100" });
    expect(r.ok).toBe(true);
    expect(r.data.gia).toBe(100);
    expect(typeof r.data.gia).toBe("number");
  });

  it("ép kiểu boolean từ chuỗi 'true'", () => {
    const r = validateRecord(fields, { ten: "X", active: "true" });
    expect(r.ok).toBe(true);
    expect(r.data.active).toBe(true);
  });

  it("field required rỗng → lỗi", () => {
    const r = validateRecord(fields, { gia: 5 });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.field === "ten")).toBe(true);
  });

  it("number không hợp lệ → lỗi", () => {
    const r = validateRecord(fields, { ten: "X", gia: "abc" });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.field === "gia")).toBe(true);
  });

  it("select ngoài options → lỗi", () => {
    const r = validateRecord(fields, { ten: "X", loai: "C" });
    expect(r.ok).toBe(false);
  });

  it("field rỗng bỏ key; field lạ bỏ qua; formula không nhận", () => {
    const r = validateRecord(fields, { ten: "X", gia: "", tong: 999, la: "z" });
    expect(r.ok).toBe(true);
    expect("gia" in r.data).toBe(false);
    expect("tong" in r.data).toBe(false);
    expect("la" in r.data).toBe(false);
    expect(r.data.ten).toBe("X");
  });

  it("partial: field required vắng mặt → không bắt lỗi", () => {
    const r = validateRecord(fields, { gia: 50 }, { partial: true });
    expect(r.ok).toBe(true);
    expect(r.data.gia).toBe(50);
  });
});
