# Thiết kế: Tách DB theo công ty (control plane + data plane)

> Trạng thái: **ĐỀ XUẤT — chưa triển khai.** Tài liệu này phác kiến trúc
> "DB hệ thống dùng chung + DB dữ liệu riêng từng công ty" để bàn/duyệt
> trước khi code. Hiện framework đang multi-tenant **theo dòng** (cột
> `company_id` + 1 `DATABASE_URL` / 1 pool). (Cập nhật 2026-06-10.)

## 1. Mục tiêu & động lực

- **Cô lập dữ liệu mạnh** giữa các công ty (compliance, "lỡ tay" cross-tenant).
- **Sao lưu/khôi phục/di trú theo từng khách** độc lập.
- Bảng thật mang **đúng tên bảng DB cũ** trở nên **sạch tự nhiên**: mỗi công
  ty 1 DB → không còn đụng tên giữa các công ty (vấn đề chính ở mô hình
  shared-DB, xem `entity-promote.ts: resolveTableName`).

## 2. Kiến trúc đích

Hai lớp:

- **DB HỆ THỐNG (control plane) — DÙNG CHUNG**: đăng nhập, phân quyền, điều
  phối. Bảng: `companies`, `users`, `sessions`, `company_members`,
  `company_invites`, `api_keys`, `llm_profiles`, `embedding_profiles`,
  `mssql_connections`, `migration_*` (job/queue), `notifications`?,
  `activity_log`?, `client_errors`?, `feedbacks`?. (Cần chốt danh sách —
  xem §3.)
- **DB DỮ LIỆU (data plane) — RIÊNG TỪNG CÔNG TY**: nội dung tenant. Bảng:
  `entities`, `entity_records`, `entity_record_versions`, `record_locator`,
  **bảng thật `er_<id>`/tên DB cũ**, `record_comments`, `saved_views`,
  `pages`, `workflows`, `workflow_runs`, `agents`, `agent_*`,
  `knowledge_*`, `data_sources`, `nav_items`, `print_templates`,
  `resource_members`…

Mỗi công ty 1 DB (vd `erp_tenant_<companyId>`) trên cùng cluster Postgres.
Phương án nhẹ hơn (cùng ý tưởng): **schema-per-tenant** (1 DB, mỗi công ty 1
schema, đổi `search_path`) — ít tốn kết nối hơn, vẫn cô lập logic.

## 3. Phân loại bảng (việc thiết kế cốt lõi)

Ranh giới quyết định độ phức tạp. Quy tắc nháp:
- Bảng có ý nghĩa **xuyên công ty** hoặc cần khi **chưa chọn công ty** (login,
  list công ty, chuyển công ty, RBAC, khoá API, kết nối nguồn) → **system**.
- Bảng mang `company_id` và là **nội dung do tenant tạo** → **tenant**.
- Vùng xám cần chốt: `notifications`, `activity_log`, `feedbacks`,
  `client_errors`, `migration_full_jobs`. Khuyến nghị: để **system** (điều
  phối/giám sát toàn cục) trừ khi cần cô lập tuyệt đối.

## 4. Thay đổi kỹ thuật chính

1. **Bộ định tuyến connection**: thay 1 `db` toàn cục bằng `systemDb` +
   `tenantDb(companyId)` (cache pool theo công ty, LRU + đóng idle). `ctx.db`
   hiện ở khắp nơi → cần phân tách: query bảng system dùng `ctx.systemDb`,
   query tenant dùng `ctx.db` (= tenantDb của công ty đang chọn). Đây là phần
   **đụng nhiều call-site nhất**.
2. **Provisioning**: tạo công ty → tạo DB/schema + chạy migration tenant +
   seed tối thiểu. Xoá công ty → drop (hoặc archive) DB.
3. **Migrations 2 tập**: `migrations/system/*` (1 DB) và `migrations/tenant/*`
   (chạy trên MỌI tenant DB lúc deploy + lúc tạo công ty mới). Runner phải
   lặp N DB, idempotent, ghi nhận DB nào tới version nào.
4. **Pool & giới hạn**: N công ty × pool → cần cap tổng connection (PgBouncer
   hoặc pool nhỏ/tenant + đóng idle). Cân nhắc schema-per-tenant để né.
5. **Bề mặt ngoài** (REST `/api`, GraphQL, MCP, IoT): resolve công ty từ API
   key/session rồi route sang tenant DB tương ứng.
6. **FK xuyên lớp biến mất**: `entity_records.company_id → companies.id` không
   còn FK cứng (khác DB). Ràng buộc chuyển sang tầng app.

## 5. Lộ trình đề xuất (sau cờ, mặc định OFF)

- **P0 — Trừu tượng kết nối**: thêm `getSystemDb()`/`getTenantDb(companyId)`;
  khi cờ `ERP_DB_PER_TENANT=0` cả hai trỏ về cùng 1 DB (hành vi hiện tại,
  không vỡ gì). Dần thay `db`/`ctx.db` theo phân loại.
- **P1 — Migration runner 2 tập** + provisioning khi tạo công ty (chạy được
  cả khi cờ off: tenant = chính DB chung).
- **P2 — Bật cờ cho 1 công ty thử**: tạo DB riêng, copy dữ liệu tenant sang,
  verify, route.
- **P3 — Công cụ di trú** dữ liệu tenant hiện có (gồm **bảng thật tên DB cũ**)
  từ DB chung sang DB riêng; backup/restore theo tenant.

## 6. Rủi ro

- **Blast radius lớn**: `ctx.db` ở hàng trăm chỗ — phân loại sai → đọc nhầm
  DB. Cần kiểm thử kỹ + bật dần sau cờ.
- **Bùng nổ connection** nếu nhiều tenant → cần PgBouncer/cap.
- **Migration drift** giữa các tenant DB (1 DB lỗi giữa chừng) → runner phải
  theo dõi version từng DB + resume.
- **Tính năng cross-company** (user nhiều công ty, chuyển qua lại) phải luôn đi
  qua system DB.

## 7. Liên hệ với tính năng "tên bảng thật theo DB cũ" (đã làm)

Tính năng đặt tên bảng thật theo DB cũ + import thẳng vào bảng thật (đã ship
trên DB hiện tại) **chuyển sang mô hình per-tenant gần như nguyên vẹn**: chỉ
đổi *nơi* bảng nằm (tenant DB) — còn logic DDL/đặt tên/COMMENT/upsert
(`entity-table-ddl.ts`, `entity-promote.ts`, `migration-full-import.ts`) dùng
lại được. Khi đã per-tenant, `resolveTableName` có thể bỏ bước chống-đụng giữa
các công ty (mỗi DB cô lập) — tên DB cũ dùng trực tiếp, không cần fallback.
