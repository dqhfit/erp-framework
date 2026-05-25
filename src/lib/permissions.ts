/* ==========================================================
   permissions.ts — re-export RBAC từ @erp-framework/core.
   Trước đây file này tự định nghĩa MATRIX → lệch với server
   (vd thiếu "procedure"/"enum"/"feedback", viewer thiếu
   "run:procedure"). Centralize vào core là nguồn sự thật duy
   nhất cho cả server và frontend.
   ========================================================== */

export {
  type Action,
  ALL_ACTIONS,
  ALL_OBJECT_TYPES,
  ALL_ROLES,
  fieldCan,
  type ObjectType,
  permissionsOf,
  ROLE_DESC,
  ROLE_LABEL,
  type Role,
  roleCan,
} from "@erp-framework/core";
