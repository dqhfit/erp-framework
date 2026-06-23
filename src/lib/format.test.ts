import { describe, expect, it } from "vitest";
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

import type { EntityField } from "@/lib/object-types";
import { useLocale } from "@/stores/locale";
import { applyFieldFormat } from "./format";

const dateField = { id: "f1", name: "ngay", label: "Ngày", type: "date" } as EntityField;
const dtField = { id: "f2", name: "luc", label: "Lúc", type: "datetime" } as EntityField;
const boolField = { id: "f3", name: "ok", label: "OK", type: "boolean" } as EntityField;

describe("applyFieldFormat theo ngôn ngữ (useLocale)", () => {
  it("vi: dd/MM/yyyy + Có/Không", () => {
    useLocale.setState({ lang: "vi" });
    expect(applyFieldFormat(dateField, "2026-05-01")).toBe("01/05/2026");
    expect(applyFieldFormat(boolField, true)).toBe("Có");
    expect(applyFieldFormat(boolField, false)).toBe("Không");
  });

  it("en: MM/dd/yyyy + Yes/No + 12h", () => {
    useLocale.setState({ lang: "en" });
    expect(applyFieldFormat(dateField, "2026-05-01")).toBe("05/01/2026");
    expect(applyFieldFormat(boolField, true)).toBe("Yes");
    expect(applyFieldFormat(dtField, "2026-05-01T15:30:00")).toMatch(/05\/01\/2026 03:30 PM/);
    useLocale.setState({ lang: "vi" });
  });

  it("date-only KHÔNG lệch ngày theo timezone (bài học #9)", () => {
    useLocale.setState({ lang: "vi" });
    // Parse theo phần LOCAL — mọi tz đều ra đúng 01/05.
    expect(applyFieldFormat(dateField, "2026-05-01")).toBe("01/05/2026");
  });

  it("per-field format override thắng locale default", () => {
    useLocale.setState({ lang: "en" });
    const f = { ...dateField, format: { dateFormat: "dd/MM/yyyy" } } as EntityField;
    expect(applyFieldFormat(f, "2026-05-01")).toBe("01/05/2026");
    useLocale.setState({ lang: "vi" });
  });

  it("trả về chuỗi rỗng khi giá trị là null, undefined hoặc rỗng", () => {
    expect(applyFieldFormat(dateField, null)).toBe("");
    expect(applyFieldFormat(dateField, undefined)).toBe("");
    expect(applyFieldFormat(dateField, "")).toBe("");
  });
});
