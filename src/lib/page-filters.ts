/* ==========================================================
   page-filters.ts — Apply cây filter (FilterNode) lên rows
   với state từ pageState. Pure, không phụ thuộc React.

   Quy tắc pass-through: khi state rỗng (null/undefined/""/[])
   leaf bị bỏ qua → row pass — page mới mở chưa chọn gì vẫn
   show full list. Ngoại lệ: op="isEmpty" / "isNotEmpty" cần
   chạy ngay cả khi state rỗng (vì test field, không test state).
   ========================================================== */
import type { FilterLeaf, FilterNode } from "@/types/page";

export interface StateGetter {
  get: (key: string) => unknown;
}

export function isStateEmpty(v: unknown): boolean {
  if (v === undefined || v === null || v === "") return true;
  if (Array.isArray(v) && v.length === 0) return true;
  return false;
}

export function evalLeaf(
  row: Record<string, unknown>,
  leaf: FilterLeaf,
  state: StateGetter,
): boolean {
  const v = row[leaf.field];
  const sv = state.get(leaf.stateKey);

  // isEmpty/isNotEmpty test row field, không phụ thuộc state.
  if (leaf.op === "isEmpty") return v === undefined || v === null || v === "";
  if (leaf.op === "isNotEmpty") return v !== undefined && v !== null && v !== "";

  // State rỗng → leaf pass-through (không ràng buộc).
  if (isStateEmpty(sv)) return true;

  switch (leaf.op) {
    case "eq":
      return v === sv || String(v) === String(sv);
    case "neq":
      return v !== sv && String(v) !== String(sv);
    case "contains":
      return String(v ?? "")
        .toLowerCase()
        .includes(String(sv).toLowerCase());
    case "in": {
      const arr = Array.isArray(sv) ? sv : [sv];
      return arr.map(String).includes(String(v));
    }
    case "gt":
      return Number(v) > Number(sv);
    case "gte":
      return Number(v) >= Number(sv);
    case "lt":
      return Number(v) < Number(sv);
    case "lte":
      return Number(v) <= Number(sv);
    case "between": {
      if (!Array.isArray(sv) || sv.length !== 2) return true;
      const [a, b] = sv as [unknown, unknown];
      const nv = Number(v);
      return nv >= Number(a) && nv <= Number(b);
    }
    default:
      return true;
  }
}

function evalNode(row: Record<string, unknown>, node: FilterNode, state: StateGetter): boolean {
  if (node.kind === "leaf") return evalLeaf(row, node, state);
  if (node.children.length === 0) return true;
  return node.logic === "or"
    ? node.children.some((c) => evalNode(row, c, state))
    : node.children.every((c) => evalNode(row, c, state));
}

/** Filter rows theo cây FilterNode. node = null → trả nguyên rows. */
export function applyFilters(
  rows: Record<string, unknown>[],
  node: FilterNode | null | undefined,
  state: StateGetter,
): Record<string, unknown>[] {
  if (!node) return rows;
  return rows.filter((r) => evalNode(r, node, state));
}

/** Helper: chuyển legacy `filterFromState: {field, stateKey}` thành 1-leaf
 *  với op="eq" để dùng chung pipeline applyFilters. */
export function legacyToFilters(legacy: { field: string; stateKey: string }): FilterNode {
  return {
    kind: "leaf",
    field: legacy.field,
    stateKey: legacy.stateKey,
    op: "eq",
  };
}
