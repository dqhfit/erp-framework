/* ==========================================================
   permissions.ts — RBAC thuần. Ma trận quyền theo vai trò.
   Pure logic (không React, không I/O) — server VÀ frontend
   đều import. Đây là nguồn sự thật RBAC của framework.
   ========================================================== */

export type Role = "admin" | "editor" | "viewer";

export type Action =
  | "view"
  | "create"
  | "edit"
  | "delete"
  | "run"
  // Action mở rộng (P2.2):
  | "manage_members" // quản lý thành viên resource (agent, page, record share)
  | "publish" // chuyển workflow/entity sang public/active
  | "approve"; // duyệt thành viên công ty hoặc nội dung chờ duyệt

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
  | "feedback"
  | "datasource" // nguồn dữ liệu (join nhiều entity, ORM-like)
  // Object mở rộng (P2.2):
  | "tool" // tool registry (MCP/HTTP)
  | "notification" // in-app notifications
  | "comment" // record/feedback comments
  | "view" // saved views
  | "member"; // company member (CRUD + approve)

export const ALL_ROLES: Role[] = ["admin", "editor", "viewer"];
export const ALL_ACTIONS: Action[] = [
  "view",
  "create",
  "edit",
  "delete",
  "run",
  "manage_members",
  "publish",
  "approve",
];

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
  "datasource",
  "tool",
  "notification",
  "comment",
  "view",
  "member",
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
    "publish:entity",
    "create:page",
    "edit:page",
    "run:page",
    "publish:page",
    "create:workflow",
    "edit:workflow",
    "run:workflow",
    "publish:workflow",
    "create:agent",
    "edit:agent",
    "run:agent",
    "manage_members:agent",
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
    "create:datasource",
    "edit:datasource",
    "run:datasource",
    "delete:datasource",
    "create:feedback",
    "edit:feedback",
    "delete:feedback",
    // Object mở rộng (P2.2):
    "edit:tool", // rescan, registerRemote, enable, spawn, stop
    "create:view",
    "edit:view",
    "delete:view",
    "create:comment",
    "edit:comment",
    "delete:comment",
    "edit:notification", // mark read / dismiss của user
  ],
  // viewer: chỉ xem + chạy + tham gia cá nhân. CRUD đầy đủ trên view +
  // comment cá nhân (handler chịu trách nhiệm filter createdBy=user.id
  // để chỉ tác động lên record của chính user). Feedback chỉ create —
  // sửa/xoá feedback đi qua canMutate() trong handler (author trong 1h
  // hoặc admin).
  viewer: [
    "view:*",
    "run:workflow",
    "run:agent",
    "run:procedure",
    "create:feedback",
    "create:comment",
    "edit:comment",
    "delete:comment",
    "create:view",
    "edit:view",
    "delete:view",
    "edit:notification",
  ],
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

/** Field-level RBAC — kiểm tra role + NHÓM + TÀI KHOẢN CÁ NHÂN có được đọc/ghi field.
 *  Thứ tự ưu tiên:
 *  1. readableBy/writableBy (role): cờ vắng/rỗng = mọi role.
 *  2. readableByGroups/writableByGroups: cờ vắng/rỗng = mọi nhóm.
 *     Có cấu hình nhóm → ADMIN bypass; viewer phải trong nhóm HOẶC
 *     được cấp quyền cá nhân (readableByUsers/writableByUsers ưu tiên).
 *  Caller không truyền groupIds/userId + field có cấu hình → DENY (fail-closed). */
export function fieldCan(
  role: Role,
  action: "read" | "write",
  field: {
    readableBy?: Role[];
    writableBy?: Role[];
    readableByGroups?: string[];
    writableByGroups?: string[];
    readableByUsers?: string[];
    writableByUsers?: string[];
  },
  groupIds?: string[],
  userId?: string,
): boolean {
  const roles = action === "read" ? field.readableBy : field.writableBy;
  if (roles && roles.length > 0 && !roles.includes(role)) return false;
  const groups = action === "read" ? field.readableByGroups : field.writableByGroups;
  if (groups && groups.length > 0 && role !== "admin") {
    // Quyền cá nhân ưu tiên nhóm.
    const users = action === "read" ? field.readableByUsers : field.writableByUsers;
    if (userId && users && users.includes(userId)) return true;
    return (groupIds ?? []).some((g) => groups.includes(g));
  }
  return true;
}
