/* ==========================================================
   permissions.ts — RBAC thuần (pure). Định nghĩa Role, Action,
   ObjectType và ma trận quyền. Hàm can() là pure → dễ test,
   không phụ thuộc store. Store rbac.ts giữ role hiện tại.
   ========================================================== */

/** Vai trò người dùng — xếp theo cấp độ quyền giảm dần. */
export type Role = "admin" | "editor" | "viewer";

/** Hành động trên một object. */
export type Action = "view" | "create" | "edit" | "delete" | "run";

/** Loại object trong hệ thống. */
export type ObjectType =
  | "entity"
  | "page"
  | "workflow"
  | "agent"
  | "settings"
  | "activity"
  | "rbac"
  | "knowledge"
  | "iot";

export const ALL_ROLES: Role[] = ["admin", "editor", "viewer"];
export const ALL_ACTIONS: Action[] = ["view", "create", "edit", "delete", "run"];

/** Nhãn hiển thị (VI) cho role. */
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

/**
 * Ma trận quyền: role → set các "action:objectType".
 * Dùng "*" cho action hoặc objectType để cấp toàn bộ.
 */
const MATRIX: Record<Role, string[]> = {
  // Admin: mọi hành động trên mọi object.
  admin: ["*:*"],

  // Editor: xem/tạo/sửa/chạy 4 loại object nội dung; xem activity & settings;
  // quản lý nguồn Knowledge Base.
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
  ],

  // Viewer: chỉ xem mọi thứ + chạy workflow/agent.
  viewer: ["view:*", "run:workflow", "run:agent"],
};

/** Kiểm tra một role có quyền thực hiện action trên objectType không. */
export function roleCan(role: Role, action: Action, obj: ObjectType): boolean {
  const rules = MATRIX[role];
  if (!rules) return false;
  return rules.some((rule) => {
    const [a, o] = rule.split(":");
    const actionOk = a === "*" || a === action;
    const objOk = o === "*" || o === obj;
    return actionOk && objOk;
  });
}

/** Liệt kê toàn bộ quyền (dạng "action:object") mà role có — cho UI hiển thị. */
export function permissionsOf(role: Role): string[] {
  const out: string[] = [];
  const objs: ObjectType[] = [
    "entity",
    "page",
    "workflow",
    "agent",
    "settings",
    "activity",
    "rbac",
    "knowledge",
    "iot",
  ];
  for (const obj of objs) {
    for (const action of ALL_ACTIONS) {
      if (roleCan(role, action, obj)) out.push(`${action}:${obj}`);
    }
  }
  return out;
}
