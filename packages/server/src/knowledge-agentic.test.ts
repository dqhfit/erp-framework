import { describe, expect, it } from "vitest";
import { filterUsable, mergeHits } from "./knowledge-agentic";
import type { KnowledgeHit } from "./knowledge-search";

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
