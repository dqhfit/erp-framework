# Phân tích tính năng — ERP Framework

Rà soát hiện trạng sau khi hoàn tất nâng cấp P1–P6. Ba phần: (1) kiểm kê
tính năng, (2) lỗ hổng & điểm yếu, (3) lộ trình đề xuất.

## 1. Kiểm kê hiện trạng

### Nền tảng
- Monorepo pnpm 5 package: `core` (thuần), `db` (Drizzle/PG18), `server`
  (Fastify+tRPC), `client`, `plugins`. **Chạy thật.**
- Backend: xác thực phiên (cookie), RBAC server-side, validate-on-write,
  scheduler pg-boss, MCP client, LLM client, mã hoá API key (AES-256-GCM).
  **Chạy thật.**
- Self-host: Docker 4 service (db + server + app/nginx + bridge claude CLI).
  CI GitHub Actions (typecheck + build + test + e2e + e2e-full). **Chạy thật.**

### Bốn đối tượng low-code

**Entity** — Designer đầy đủ: palette kiểu field (18 builtin + plugin),
kéo-thả, AI Assist sinh schema, import schema từ MCP, Formula editor,
McpBindings (map 5 op CRUD → MCP tool). Schema lưu PostgreSQL. **Chạy thật.**
Hạn chế: xem/sửa *bản ghi* (record) chỉ có ở route demo `/server-data`.

**Page** — Designer kéo-thả widget (KPI, chart, list, form, kanban, html),
AI Assist, chế độ Consumer. Nội dung lưu backend. **Designer chạy thật**,
nhưng **renderer hiển thị dữ liệu GIẢ**: `ConsumerPage` dùng `ORDER_ROWS`
hardcode, widget "list" chưa truy vấn record thật của entity.

**Workflow** — Designer ReactFlow: 6 node builtin (trigger/action/condition/
agent/approval/delay) + node plugin, AI Assist. Lưu backend. Chạy thật
phía server (`executeWorkflow` qua tRPC), có lịch sử run, scheduler cron.
**Chạy thật.** Lưu ý: nút "Test Run" trong designer là **mô phỏng client**
— khác bộ runner thật, dễ lệch hành vi.

**Agent** — Designer cấu hình: model, system prompt, temperature, tool MCP.
Lưu backend. Chat qua AgentPanel. **Chạy được** nhưng chat thực thi
**phía client** (`src/core/llm`, `src/core/agent-runner`), chưa đi qua
`llm-client` của backend.

### Tính năng hệ thống
- Xác thực: cổng đăng nhập toàn app, tài khoản đầu = admin. **Chạy thật.**
- RBAC: server enforce; UI `/settings/rbac` chỉnh ma trận quyền. **Chạy thật.**
- Nhật ký & chi phí: store activity, đếm token/cost, dashboard. **Chạy** (ghi
  ở tầng client store; chưa đồng bộ bảng `activity_log` server).
- Plugin SDK: 5 loại; field-type & workflow-node mở rộng được, loader tự
  nạp, CLI `new:plugin`, package dùng chung. **Chạy thật.**
- AI Assist (sinh entity/page/workflow/agent), Command Palette, hệ Dialog,
  i18n (Việt/Anh), MCP client. **Chạy thật.**

## 2. Lỗ hổng & điểm yếu

**Nghiêm trọng**
- *Page renderer dùng dữ liệu giả.* `ConsumerPage` hiển thị `ORDER_ROWS`
  + `SAMPLE_CHART` hardcode. Widget list/kpi/chart không đọc record thật
  → trang do user thiết kế không phản ánh dữ liệu thật trong DB.
- *Thiếu giao diện dữ liệu chuẩn.* Backend có CRUD record đầy đủ, nhưng
  app chỉ xem/sửa record ở route demo `/server-data`. Không có màn hình
  "dữ liệu" theo từng entity trong luồng chính (dù đã có sẵn component
  `DataGrid` + `AutoForm`).

**Trung bình**
- *Trùng lặp `src/core/`.* App vẫn giữ `src/core/workflow-runner.ts`,
  `scheduler.ts`, `mcp.ts`, `db.ts`… song song với `packages/core` +
  `server`. Có hai bộ workflow-runner → nguy cơ lệch logic, khó bảo trì.
- *Test Run ≠ runner thật.* Mô phỏng client trong WorkflowDesigner tách
  rời bộ thực thi server → kết quả test không đảm bảo khớp khi chạy thật.
- *Plugin chưa thông suốt server.* Mới có node `log` chạy server-side;
  `coerce` của field-type plugin chưa được `validate.ts` của server dùng
  → record kiểu plugin không được ép kiểu phía backend.
- *Agent thực thi client-side.* Chat agent chưa đi qua backend → token/chi
  phí, tool-call không tập trung, khó kiểm soát/ghi log nhất quán.

**Nhỏ**
- `index.tsx` khối "Gần đây" là link tĩnh, trỏ tới id không tồn tại (404).
- `mock-data.ts` còn hằng số không dùng (ENTITIES/PAGES… cũ).
- Bridge `/models` dễ timeout nếu claude CLI chưa đăng nhập (đã có fallback).
- Activity log ghi ở client store, chưa tận dụng bảng `activity_log` server.

## 3. Lộ trình đề xuất

**Ưu tiên cao — biến app thành ERP dùng được thật**
- **R1. Nối Page renderer vào dữ liệu thật.** Widget list/table/kpi/chart
  trong `ConsumerPage` truy vấn record qua `ApiDataSource.getRecords` theo
  `config.entity`. Bỏ `ORDER_ROWS`. Đây là mảnh ghép biến trang thiết kế
  thành trang nghiệp vụ thật.
- **R2. Màn hình Dữ liệu theo entity.** Thêm tab/route xem-sửa record cho
  mỗi entity (DataGrid danh sách + AutoForm thêm/sửa), đưa khỏi `/server-data`
  vào luồng chính.

**Ưu tiên trung — củng cố nền**
- **R3. Dọn `src/core/` trùng lặp.** Thống nhất một nguồn cho workflow-runner
  / scheduler; phần client-only (LLM adapter OAuth, MCP browser) giữ lại có
  chủ đích và tách rõ.
- **R4. Hợp nhất Test Run.** Cho designer gọi `executeWorkflow` thật (dry-run)
  thay vì mô phỏng riêng.
- **R5. Plugin thông suốt server.** Đưa `validate.ts` server dùng `coerce`
  của field-type plugin; mở rộng plugin server-side.

**Ưu tiên thấp — hoàn thiện**
- R6. Agent chat đi qua backend `llm-client` (token/cost tập trung).
- R7. Activity log đồng bộ bảng `activity_log` server.
- R8. Dọn `mock-data.ts`, sửa khối "Gần đây" trang chủ thành dữ liệu thật.
- R9. Mở rộng e2e full-stack (tạo entity, nhập record, chạy workflow).

### Tóm lại
Nền tảng (backend, plugin, self-host, CI) đã chắc. Khoảng cách lớn nhất để
thành một ERP *dùng được* nằm ở tầng hiển thị dữ liệu: **Page và màn hình
record phải đọc dữ liệu thật từ backend** (R1, R2). Đây nên là việc làm
tiếp theo.
