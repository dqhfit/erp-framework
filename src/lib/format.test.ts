import { describe, it, expect } from "vitest";
import { formatVND } from "./format";

describe("formatVND", () => {
  it("luôn kèm ký hiệu ₫ ở cuối", () => {
    expect(formatVND(1000).endsWith(" ₫")).toBe(true);
    expect(formatVND(0).endsWith(" ₫")).toBe(true);
  });

  it("giữ đủ chữ số (không phụ thuộc ký tự phân tách)", () => {
    expect(formatVND(84500000).replace(/\D/g, "")).toBe("84500000");
    expect(formatVND(0).replace(/\D/g, "")).toBe("0");
  });

  it("có phân tách nhóm cho số lớn", () => {
    // Số >= 1000 phải có ít nhất một ký tự phân tách nhóm.
    expect(/\D/.test(formatVND(1000).replace(" ₫", ""))).toBe(true);
  });
});
