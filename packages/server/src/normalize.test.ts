import { describe, it, expect } from "vitest";
import { normalizeRows, inferPkField } from "./normalize";

describe("normalizeRows", () => {
  it("giữ nguyên mảng object", () => {
    expect(normalizeRows([{ a: 1 }, { a: 2 }])).toEqual([{ a: 1 }, { a: 2 }]);
  });
  it("bọc mảng giá trị nguyên thuỷ thành { value }", () => {
    expect(normalizeRows([1, 2])).toEqual([{ value: 1 }, { value: 2 }]);
  });
  it("mảng-của-mảng → col_1, col_2…", () => {
    expect(normalizeRows([["x", "y"]])).toEqual([{ col_1: "x", col_2: "y" }]);
  });
  it("rút mảng từ khoá bao bọc (items/data/rows…)", () => {
    expect(normalizeRows({ items: [{ id: 1 }] })).toEqual([{ id: 1 }]);
    expect(normalizeRows({ results: [{ id: 2 }] })).toEqual([{ id: 2 }]);
  });
  it("dạng columns + rows", () => {
    expect(normalizeRows({ columns: ["a", "b"], rows: [[1, 2], [3, 4]] }))
      .toEqual([{ a: 1, b: 2 }, { a: 3, b: 4 }]);
  });
  it("bóc nội dung text kiểu MCP (JSON trong content[].text)", () => {
    const mcp = { content: [{ type: "text", text: JSON.stringify([{ id: 9 }]) }] };
    expect(normalizeRows(mcp)).toEqual([{ id: 9 }]);
  });
  it("object đơn → mảng một phần tử", () => {
    expect(normalizeRows({ name: "A" })).toEqual([{ name: "A" }]);
  });
  it("giá trị rỗng/không hợp lệ → mảng rỗng", () => {
    expect(normalizeRows(null)).toEqual([]);
    expect(normalizeRows(undefined)).toEqual([]);
    expect(normalizeRows(42)).toEqual([]);
  });
});

describe("inferPkField", () => {
  it("ưu tiên field 'id'", () => {
    expect(inferPkField(["name", "id", "code"])).toBe("id");
  });
  it("không có 'id' thì lấy 'code'", () => {
    expect(inferPkField(["name", "code"])).toBe("code");
  });
  it("không có id/code thì lấy field kết thúc bằng _id", () => {
    expect(inferPkField(["name", "user_id"])).toBe("user_id");
  });
  it("không khớp gì thì lấy field đầu tiên", () => {
    expect(inferPkField(["ten", "tuoi"])).toBe("ten");
  });
  it("danh sách rỗng → mặc định 'id'", () => {
    expect(inferPkField([])).toBe("id");
  });
});
