import { describe, it, expect } from "vitest";
import { chunkText } from "./chunk";

describe("chunkText", () => {
  it("văn bản rỗng → mảng rỗng", () => {
    expect(chunkText("")).toEqual([]);
    expect(chunkText("   \n\n  ")).toEqual([]);
  });

  it("văn bản ngắn → một chunk", () => {
    const out = chunkText("Xin chào thế giới.");
    expect(out).toHaveLength(1);
    expect(out[0]?.seq).toBe(0);
    expect(out[0]?.content).toBe("Xin chào thế giới.");
    expect(out[0]?.tokens).toBeGreaterThan(0);
  });

  it("văn bản dài → nhiều chunk, seq tăng dần từ 0", () => {
    const para = "Câu văn mẫu khá dài để kiểm thử việc cắt đoạn. ".repeat(60);
    const text = `${para}\n\n${para}\n\n${para}`;
    const out = chunkText(text);
    expect(out.length).toBeGreaterThan(1);
    out.forEach((c, i) => expect(c.seq).toBe(i));
  });

  it("mỗi chunk không vượt quá ~MAX_CHARS + chồng lấp", () => {
    const text = "abcdefghij ".repeat(500);
    for (const c of chunkText(text)) {
      expect(c.content.length).toBeLessThanOrEqual(1200);
    }
  });

  it("một đoạn dài hơn giới hạn vẫn bị cắt nhỏ", () => {
    const out = chunkText("x".repeat(5000));
    expect(out.length).toBeGreaterThan(1);
  });
});
