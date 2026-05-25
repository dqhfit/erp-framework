/* ==========================================================
   permissions.ts — RBAC thuần. Ma trận quyền theo vai trò.
   Pure logic (không React, không I/O) — server VÀ frontend
   đều import. Đây là nguồn sự thật RBAC của framework.
   ========================================================== */

export type Role = "admin" | "editor" | "viewer";

export type Action = "view" | "create" | "edit" | "delete" | "run";

export type ObjectType =
  | "entity" | "page" | "workflow" | "agent"
  | "settings" | "activity" | "rbac" | "company" | "knowledge" | "iot"
  | "procedure" | "enum";

export const ALL_ROLES: Role[] = ["admin", "editor", "viewer"];

/** Ma trận quyền: role → danh sách rule "action:object" ("*" = mọi). */
const MATRIX: Record<Role, string[]> = {
  admin: ["*:*"],
  editor: [
    "view:*",
    "create:entity", "edit:entity", "run:entity",
    "create:page", "edit:page", "run:page",
    "create:workflow", "edit:workflow", "run:workflow",
    "create:agent", "edit:agent", "run:agent",
    "create:knowledge", "edit:knowledge", "delete:knowledge",
    "create:iot", "edit:iot", "delete:iot",
    "create:procedure", "edit:procedure", "run:procedure",
    "create:enum", "edit:enum", "delete:enum",
  ],
  viewer: ["view:*", "run:workflow", "run:agent", "run:procedure"],
};

/** Vai trò `role` có được phép `action` trên `obj` không. */
export function roleCan(role: Role, action: Action, obj: ObjectType): boolean {
  const rules = MATRIX[role];
  if (!rules) return false;
  return rules.some((rule) => {
    const [a, o] = rule.split(":");
    return (a === "*" || a === action) && (o === "*" || o === obj);
  });
}

/** Field-level RBAC — kiểm tra role có được đọc/ghi field theo cờ
 *  readableBy/writableBy. Default (cờ vắng) = cho phép. */
export function fieldCan(
  role: Role,
  action: "read" | "write",
  field: { readableBy?: Role[]; writableBy?: Role[] },
): boolean {
  const allowed = action === "read" ? field.readableBy : field.writableBy;
  if (!allowed || allowed.length === 0) return true;
  return allowed.includes(role);
}
