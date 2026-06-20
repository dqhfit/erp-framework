/* ==========================================================
   schema.ts — Drizzle schema toàn bộ bảng HỆ THỐNG của ERP
   Framework. Dữ liệu động của entity do user tạo nằm trong
   entity_records.data (JSONB) — xem UPGRADE-PLAN mục 3.4.
   Khóa chính dùng uuidv7() — yêu cầu PostgreSQL 18+ (UUID có thứ tự
   thời gian, tốt cho locality của B-tree index).

   ĐA CÔNG TY (multi-tenant): mọi bảng dữ liệu mang cột company_id.
   Một user có thể là thành viên nhiều công ty (bảng company_members)
   và chuyển qua lại — công ty đang chọn lưu ở sessions.active_company_id.
   ========================================================== */

export * from "./schema/activity";
export * from "./schema/auth";
export * from "./schema/entities";
export * from "./schema/entity-advanced";
export * from "./schema/enums";
export * from "./schema/errors-chat";
export * from "./schema/feedback";
export * from "./schema/iot";
export * from "./schema/knowledge";
export * from "./schema/legacy";
export * from "./schema/mes";
export * from "./schema/migration-jobs";
export * from "./schema/migration-sync";
export * from "./schema/pages";
export * from "./schema/plugins";
export * from "./schema/security";
export * from "./schema/tenant";
export * from "./schema/workflows";
