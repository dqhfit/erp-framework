/* ==========================================================
   page-filters.test.ts — Unit test cho engine filter cây.
   ========================================================== */
import { describe, expect, it } from "vitest";
import type { FilterNode } from "@/types/page";
import { applyFilters, evalLeaf, isStateEmpty, legacyToFilters } from "./page-filters";

function state(values: Record<string, unknown>) {
  return { get: (k: string) => values[k] };
}

const rows = [
  { id: 1, status: "open", amount: 50, tags: ["a"], owner: "Alice" },
  { id: 2, status: "in_progress", amount: 150, tags: ["b"], owner: "Bob" },
  { id: 3, status: "closed", amount: 200, tags: ["a", "b"], owner: "Alice" },
  { id: 4, status: "open", amount: 0, tags: [], owner: "" },
];

describe("isStateEmpty", () => {
  it("null/undefined/empty string/empty array → empty", () => {
    expect(isStateEmpty(null)).toBe(true);
    expect(isStateEmpty(undefined)).toBe(true);
    expect(isStateEmpty("")).toBe(true);
    expect(isStateEmpty([])).toBe(true);
  });
  it("non-empty value → not empty", () => {
    expect(isStateEmpty(0)).toBe(false);
    expect(isStateEmpty(false)).toBe(false);
    expect(isStateEmpty("x")).toBe(false);
    expect(isStateEmpty(["x"])).toBe(false);
  });
});

describe("evalLeaf — operators", () => {
  const s = state({ x: "open", q: "ali", n: 100, nums: [10, 200], tags: ["a", "b"] });

  it("eq", () => {
    const leaf: FilterNode = { kind: "leaf", field: "status", stateKey: "x", op: "eq" };
    expect(evalLeaf(rows[0]!, leaf, s)).toBe(true);
    expect(evalLeaf(rows[1]!, leaf, s)).toBe(false);
  });
  it("neq", () => {
    const leaf: FilterNode = { kind: "leaf", field: "status", stateKey: "x", op: "neq" };
    expect(evalLeaf(rows[0]!, leaf, s)).toBe(false);
    expect(evalLeaf(rows[1]!, leaf, s)).toBe(true);
  });
  it("contains case-insensitive", () => {
    const leaf: FilterNode = { kind: "leaf", field: "owner", stateKey: "q", op: "contains" };
    expect(evalLeaf(rows[0]!, leaf, s)).toBe(true); // Alice contains ali
    expect(evalLeaf(rows[1]!, leaf, s)).toBe(false);
  });
  it("in (array state)", () => {
    const leaf: FilterNode = { kind: "leaf", field: "status", stateKey: "tags", op: "in" };
    // tags = ["a","b"] but field "status" của row 0 = "open" → not in
    expect(evalLeaf(rows[0]!, leaf, s)).toBe(false);
  });
  it("gt/gte/lt/lte", () => {
    const gt: FilterNode = { kind: "leaf", field: "amount", stateKey: "n", op: "gt" };
    expect(evalLeaf(rows[0]!, gt, s)).toBe(false); // 50 > 100
    expect(evalLeaf(rows[1]!, gt, s)).toBe(true); // 150 > 100
    const lte: FilterNode = { kind: "leaf", field: "amount", stateKey: "n", op: "lte" };
    expect(evalLeaf(rows[0]!, lte, s)).toBe(true); // 50 <= 100
  });
  it("between", () => {
    const leaf: FilterNode = { kind: "leaf", field: "amount", stateKey: "nums", op: "between" };
    // nums = [10, 200], row 0 amount = 50 ∈ [10, 200] → pass
    expect(evalLeaf(rows[0]!, leaf, s)).toBe(true);
    expect(evalLeaf({ amount: 5 }, leaf, s)).toBe(false);
    expect(evalLeaf({ amount: 999 }, leaf, s)).toBe(false);
  });
  it("isEmpty/isNotEmpty test field, không phụ thuộc state", () => {
    const empty: FilterNode = { kind: "leaf", field: "owner", stateKey: "", op: "isEmpty" };
    expect(evalLeaf(rows[3]!, empty, state({}))).toBe(true);
    expect(evalLeaf(rows[0]!, empty, state({}))).toBe(false);
    const ne: FilterNode = { kind: "leaf", field: "owner", stateKey: "", op: "isNotEmpty" };
    expect(evalLeaf(rows[0]!, ne, state({}))).toBe(true);
  });
});

describe("evalLeaf — pass-through khi state rỗng", () => {
  const empty = state({ x: "", y: null, z: [] });
  it("eq pass-through nếu state rỗng", () => {
    const leaf: FilterNode = { kind: "leaf", field: "status", stateKey: "x", op: "eq" };
    expect(evalLeaf(rows[0]!, leaf, empty)).toBe(true);
    expect(evalLeaf(rows[1]!, leaf, empty)).toBe(true);
  });
  it("in pass-through nếu state array rỗng", () => {
    const leaf: FilterNode = { kind: "leaf", field: "status", stateKey: "z", op: "in" };
    expect(evalLeaf(rows[0]!, leaf, empty)).toBe(true);
  });
});

describe("applyFilters — cây AND/OR", () => {
  const s = state({ st: "open", amt: 40 });
  it("AND: cả 2 điều kiện đều phải đúng", () => {
    const node: FilterNode = {
      kind: "group",
      logic: "and",
      children: [
        { kind: "leaf", field: "status", stateKey: "st", op: "eq" },
        { kind: "leaf", field: "amount", stateKey: "amt", op: "gt" },
      ],
    };
    const r = applyFilters(rows, node, s);
    expect(r.map((r) => r.id)).toEqual([1]); // status=open AND amount>40
  });
  it("OR: 1 trong 2 đúng là pass", () => {
    const node: FilterNode = {
      kind: "group",
      logic: "or",
      children: [
        { kind: "leaf", field: "status", stateKey: "st", op: "eq" },
        { kind: "leaf", field: "amount", stateKey: "amt", op: "gt" },
      ],
    };
    const r = applyFilters(rows, node, s);
    expect(r.map((r) => r.id).sort()).toEqual([1, 2, 3, 4]);
  });
  it("Nested: (status=open OR amount>100) AND owner=Alice", () => {
    const node: FilterNode = {
      kind: "group",
      logic: "and",
      children: [
        {
          kind: "group",
          logic: "or",
          children: [
            { kind: "leaf", field: "status", stateKey: "st", op: "eq" },
            { kind: "leaf", field: "amount", stateKey: "amt2", op: "gt" },
          ],
        },
        { kind: "leaf", field: "owner", stateKey: "own", op: "eq" },
      ],
    };
    const r = applyFilters(rows, node, state({ st: "open", amt2: 100, own: "Alice" }));
    // row 1: open + Alice → true. row 3: closed + amount=200>100 + Alice → true. row 2: in_progress + Bob → false. row 4: open + "" → false.
    expect(r.map((r) => r.id).sort()).toEqual([1, 3]);
  });
  it("Empty group → all pass", () => {
    const node: FilterNode = { kind: "group", logic: "and", children: [] };
    expect(applyFilters(rows, node, s).length).toBe(4);
  });
  it("null/undefined node → all pass", () => {
    expect(applyFilters(rows, null, s).length).toBe(4);
    expect(applyFilters(rows, undefined, s).length).toBe(4);
  });
});

describe("legacyToFilters", () => {
  it("wrap legacy {field, stateKey} thành 1-leaf eq", () => {
    const node = legacyToFilters({ field: "status", stateKey: "x" });
    expect(node).toEqual({ kind: "leaf", field: "status", stateKey: "x", op: "eq" });
  });
});
