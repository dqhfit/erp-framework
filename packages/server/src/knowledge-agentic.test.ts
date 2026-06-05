import { describe, expect, it } from "vitest";
import { filterUsable, mergeContiguous, mergeHits } from "./knowledge-agentic";
import type { KnowledgeHit } from "./knowledge-search";

/** Hit có kiểm soát sourceId + seq + content (cho test mergeContiguous). */
function chunk(
  sourceId: string,
  seq: number,
  score: number,
  content = `${sourceId}#${seq}`,
): KnowledgeHit {
  return {
    chunkId: `${sourceId}:${seq}`,
    sourceId,
    sourceTitle: sourceId,
    sourceKind: "text",
    seq,
    content,
    score,
  };
}

function hit(chunkId: string, score: number): KnowledgeHit {
  return {
    chunkId,
    sourceId: `src-${chunkId}`,
    sourceTitle: "t",
    sourceKind: "text",
    seq: 0,
    content: chunkId,
    score,
  };
}

describe("mergeHits", () => {
  it("khử trùng theo chunkId, giữ score cao nhất", () => {
    const out = mergeHits([[hit("a", 0.3)], [hit("a", 0.8)]], 10);
    expect(out).toHaveLength(1);
    expect(out[0]?.score).toBe(0.8);
  });

  it("sắp giảm dần theo score và cắt top limit", () => {
    const out = mergeHits([[hit("a", 0.2), hit("b", 0.9)], [hit("c", 0.5)]], 2);
    expect(out.map((h) => h.chunkId)).toEqual(["b", "c"]);
  });

  it("danh sách rỗng → trả rỗng", () => {
    expect(mergeHits([], 5)).toEqual([]);
    expect(mergeHits([[], []], 5)).toEqual([]);
  });
});

describe("filterUsable", () => {
  const hits = [hit("a", 0.4), hit("b", 0.3), hit("c", 0.2)];

  it("không có usableChunkIds → giữ nguyên", () => {
    expect(filterUsable(hits, undefined)).toBe(hits);
    expect(filterUsable(hits, [])).toBe(hits);
  });

  it("lọc đúng theo id grader cho là dùng được", () => {
    expect(filterUsable(hits, ["a", "c"]).map((h) => h.chunkId)).toEqual(["a", "c"]);
  });

  it("id lạ (lọc ra rỗng) → giữ nguyên để an toàn recall", () => {
    expect(filterUsable(hits, ["x", "y"])).toBe(hits);
  });
});

describe("mergeContiguous", () => {
  it("gộp các đoạn seq liên tiếp cùng nguồn thành 1 khối (nối nội dung)", () => {
    const out = mergeContiguous([
      chunk("s", 0, 0.5, "A"),
      chunk("s", 1, 0.9, "B"),
      chunk("s", 2, 0, "C"),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]?.content).toBe("A\nB\nC");
    // score = max của run.
    expect(out[0]?.score).toBe(0.9);
  });

  it("seq KHÔNG liên tiếp → tách khối; sắp theo score giảm dần", () => {
    const out = mergeContiguous([chunk("s", 0, 0.3, "A"), chunk("s", 5, 0.8, "B")]);
    expect(out.map((h) => h.content)).toEqual(["B", "A"]);
  });

  it("khác nguồn → không gộp dù seq trùng", () => {
    const out = mergeContiguous([chunk("s1", 0, 0.4), chunk("s2", 1, 0.6)]);
    expect(out).toHaveLength(2);
  });

  it("khử trùng chunkId trước khi gộp (giữ score cao)", () => {
    const out = mergeContiguous([chunk("s", 0, 0.2, "A"), chunk("s", 0, 0.7, "A")]);
    expect(out).toHaveLength(1);
    expect(out[0]?.score).toBe(0.7);
  });

  it("cắt theo ngân sách ký tự nhưng luôn giữ khối đầu (liên quan nhất)", () => {
    const big = "x".repeat(100);
    const out = mergeContiguous(
      [chunk("a", 0, 0.9, big), chunk("b", 0, 0.5, big), chunk("c", 0, 0.4, big)],
      150,
    );
    // Khối đầu luôn giữ; khối sau vượt ngân sách 150 → loại.
    expect(out.map((h) => h.sourceId)).toEqual(["a"]);
  });
});
