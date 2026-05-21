/* ==========================================================
   permissions.ts — RBAC thuần. Ma trận quyền theo vai trò.
   Pure logic (không React, không I/O) — server VÀ frontend
   đều import. Đây là nguồn sự thật RBAC của framework.
   ========================================================== */

export type Role = "admin" | "editor" | "viewer";

export type Action = "view" | "create" | "edit" | "delete" | "run";

export type ObjectType =
  | "entity" | "page" | "workflow" | "agent"
  | "settings" | "activity" | "rbac";

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
  ],
  viewer: ["view:*", "run:workflow", "run:agent"],
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
