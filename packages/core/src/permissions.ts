/* ==========================================================
   permissions.ts — RBAC thuần. Ma trận quyền theo vai trò.
   Pure logic (không React, không I/O) — server VÀ frontend
   đều import. Đây là nguồn sự thật RBAC của framework.
   ========================================================== */

export type Role = "admin" | "editor" | "viewer";

export type Action = "view" | "create" | "edit" | "delete" | "run";

export type ObjectType =
  | "entity"
  | "page"
  | "workflow"
  | "agent"
  | "settings"
  | "activity"
  | "rbac"
  | "company"
  | "knowledge"
  | "iot"
  | "procedure"
  | "enum"
  | "feedback";

export const ALL_ROLES: Role[] = ["admin", "editor", "viewer"];
export const ALL_ACTIONS: Action[] = ["view", "create", "edit", "delete", "run"];

/** Danh sách ObjectType — dùng cho UI hiển thị + permissionsOf(). */
export const ALL_OBJECT_TYPES: ObjectType[] = [
  "entity",
  "page",
  "workflow",
  "agent",
  "settings",
  "activity",
  "rbac",
  "company",
  "knowledge",
  "iot",
  "procedure",
  "enum",
  "feedback",
];

/** Nhãn hiển thị (VI) cho role — UI labels. */
export const ROLE_LABEL: Record<Role, string> = {
  admin: "Quản trị viên",
  editor: "Biên tập viên",
  viewer: "Người xem",
};

export const ROLE_DESC: Record<Role, string> = {
  admin: "Toàn quyền: tạo/sửa/xóa mọi thứ, quản lý role và cấu hình hệ thống.",
  editor: "Tạo/sửa/chạy entity, page, workflow, agent. Không xóa, không đổi cấu hình.",
  viewer: "Chỉ xem và chạy workflow/agent. Không chỉnh sửa.",
};

/** Ma trận quyền: role → danh sách rule "action:object" ("*" = mọi). */
const MATRIX: Record<Role, string[]> = {
  admin: ["*:*"],
  editor: [
    "view:*",
    "create:entity",
    "edit:entity",
    "run:entity",
    "create:page",
    "edit:page",
    "run:page",
    "create:workflow",
    "edit:workflow",
    "run:workflow",
    "create:agent",
    "edit:agent",
    "run:agent",
    "create:knowledge",
    "edit:knowledge",
    "delete:knowledge",
    "create:iot",
    "edit:iot",
    "delete:iot",
    "create:procedure",
    "edit:procedure",
    "run:procedure",
    "create:enum",
    "edit:enum",
    "delete:enum",
    "create:feedback",
    "edit:feedback",
    "delete:feedback",
  ],
  // viewer được "create:feedback" để mọi user gửi phản hồi sản phẩm được.
  viewer: ["view:*", "run:workflow", "run:agent", "run:procedure", "create:feedback"],
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

/** Liệt kê toàn bộ quyền (dạng "action:object") mà role có — cho UI hiển thị. */
export function permissionsOf(role: Role): string[] {
  const out: string[] = [];
  for (const obj of ALL_OBJECT_TYPES) {
    for (const action of ALL_ACTIONS) {
      if (roleCan(role, action, obj)) out.push(`${action}:${obj}`);
    }
  }
  return out;
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
