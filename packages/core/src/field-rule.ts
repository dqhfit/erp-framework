/* ==========================================================
   field-rule.ts — Đánh giá FieldRule (requiredIf/visibleIf).
   Pure sync — chạy được cả client (AutoForm hide field) và server
   (validate conditional required).
   ========================================================== */
import type { FieldRule, FieldRuleCondition, FieldRuleOp } from "./datasource/index";

function evalCondition(c: FieldRuleCondition, row: Record<string, unknown>): boolean {
  const lhs = row[c.field];
  const rhs = c.value;
  const op: FieldRuleOp = c.op;
  switch (op) {
    case "=":  return lhs === rhs;
    case "!=": return lhs !== rhs;
    case ">":  return Number(lhs) > Number(rhs);
    case ">=": return Number(lhs) >= Number(rhs);
    case "<":  return Number(lhs) < Number(rhs);
    case "<=": return Number(lhs) <= Number(rhs);
    case "in":
      return Array.isArray(rhs) && rhs.includes(lhs);
    case "notin":
      return Array.isArray(rhs) && !rhs.includes(lhs);
    case "empty":
      return lhs == null || lhs === ""
        || (Array.isArray(lhs) && lhs.length === 0);
    case "nonempty":
      return !(lhs == null || lhs === ""
        || (Array.isArray(lhs) && lhs.length === 0));
    default:
      return false;
  }
}

/** Eval rule với row hiện tại. Rule vắng → trả default (true cho visible/false cho required, caller tự xử). */
export function evalFieldRule(
  rule: FieldRule | undefined,
  row: Record<string, unknown>,
): boolean {
  if (!rule || rule.conditions.length === 0) return false;
  const combinator = rule.combinator ?? "all";
  if (combinator === "any") {
    return rule.conditions.some((c) => evalCondition(c, row));
  }
  return rule.conditions.every((c) => evalCondition(c, row));
}
