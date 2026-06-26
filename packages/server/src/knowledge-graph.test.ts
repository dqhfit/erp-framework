import { describe, expect, it } from "vitest";
import { normalizeEntity } from "./knowledge-graph";

describe("normalizeEntity", () => {
  it("hạ chữ thường + bỏ dấu tiếng Việt", () => {
    expect(normalizeEntity("Khách Hàng")).toBe("khach hang");
    expect(normalizeEntity("Định Mức")).toBe("dinh muc");
  });

  it("đổi đ/Đ → d", () => {
    expect(normalizeEntity("Đơn hàng")).toBe("don hang");
    expect(normalizeEntity("đỏ")).toBe("do");
  });

  it("nuốt dấu câu/ký tự lạ thành khoảng trắng", () => {
    expect(normalizeEntity("SP-001 (mã)")).toBe("sp 001 ma");
    expect(normalizeEntity("A&B, C/D")).toBe("a b c d");
  });

  it("gộp khoảng trắng + trim", () => {
    expect(normalizeEntity("  nhiều   khoảng  trắng  ")).toBe("nhieu khoang trang");
  });

  it("rỗng / chỉ ký tự lạ → chuỗi rỗng", () => {
    expect(normalizeEntity("")).toBe("");
    expect(normalizeEntity("   ")).toBe("");
    expect(normalizeEntity("!@#$%")).toBe("");
  });

  it("hai biến thể hoa-thường/dấu khác nhau chuẩn hoá VỀ CÙNG khoá", () => {
    expect(normalizeEntity("Công Ty VFM")).toBe(normalizeEntity("cong ty vfm"));
  });
});
