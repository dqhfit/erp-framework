<!--
SYNC IMPACT REPORT
==================
Version change: (template chưa phê chuẩn) → 1.0.0  [MAJOR: phê chuẩn lần đầu]
Phê chuẩn lần đầu — toàn bộ nguyên tắc là MỚI, chắt lọc từ CLAUDE.md + convention repo.

Nguyên tắc (6):
  I.   Đa tenant — cô lập theo company_id (NON-NEGOTIABLE)
  II.  RBAC fail-closed + bảo mật theo lớp
  III. Lean code — tái dùng trước khi viết
  IV.  Fail-safe dữ liệu + kỷ luật migration
  V.   UI nhất quán: token sáng/tối + a11y + dialog (NON-NEGOTIABLE)
  VI.  Chứng minh trước khi "xong" (lint 0-error + test)

Sections:
  + Ràng buộc kỹ thuật & kiến trúc (Section 2)
  + Quy trình phát triển & cổng chất lượng (Section 3)
  + Governance

Templates đồng bộ:
  ✅ .specify/templates/plan-template.md   (Constitution Check tham chiếu generic — không cần sửa)
  ✅ .specify/templates/spec-template.md   (không gắn nguyên tắc cứng — tương thích)
  ✅ .specify/templates/tasks-template.md  (phân loại task tương thích nguyên tắc)
  ✅ CLAUDE.md                             (nguồn nguyên tắc; constitution trỏ về, không mâu thuẫn)

Follow-up TODO: (không có)
-->

# erp-framework Constitution

> Hiến pháp dự án: các nguyên tắc BẤT BIẾN của erp-framework — nền tảng ERP low-code,
> multi-tenant. Chi tiết vận hành hằng ngày ở `CLAUDE.md`; tài liệu này là khế ước
> cao nhất khi có xung đột.

## Core Principles

### I. Đa tenant — cô lập theo company_id (NON-NEGOTIABLE)
- Mọi bảng dữ liệu PHẢI có cột `company_id` + cascade FK; session lưu `active_company_id`.
- MỌI truy vấn / lookup-by-id / cache / polling / WebSocket subscribe PHẢI scope theo
  `company_id` — kể cả job state in-memory và channel realtime.
- Truy cập chéo tenant PHẢI fail-closed: reject im lặng, KHÔNG tiết lộ sự tồn tại của resource.

**Lý do**: rò rỉ chéo tenant là lỗi bảo mật nghiêm trọng nhất của hệ đa khách hàng — biết
một UUID KHÔNG được phép đọc dữ liệu của công ty khác.

### II. RBAC fail-closed + bảo mật theo lớp
- Endpoint thao tác data PHẢI dùng `rbacProcedure(action, obj)` hoặc `resourceProcedure`.
  TUYỆT ĐỐI KHÔNG dùng `protectedProcedure` cho mutate data (pending user sẽ bypass approval gate).
- Chỉ MỘT ma trận RBAC tại `packages/core/src/permissions.ts`; frontend re-export, KHÔNG
  định nghĩa song song.
- API key scope **deny-by-default** (rỗng = không quyền); field-level RBAC áp đồng nhất ở
  create/update/bulkImport/export/invoke.
- Secret/khoá PHẢI mã hoá (AES-256-GCM, prefix `enc:v1:`); KHÔNG hardcode; fallback env LLM key
  chỉ kích hoạt khi có cờ cho phép.

**Lý do**: bảo mật phải mặc định ĐÓNG — thêm endpoint mà quên gate là lỗ hổng, không phải bất tiện.

### III. Lean code — tái dùng trước khi viết
- Trước khi viết code mới PHẢI đi qua thang quyết định, dừng ở nấc đầu áp dụng được:
  (1) có cần không (YAGNI) → (2) đã có trong codebase (DataSource, `proc-table`, primitive
  `components/ui/`, `I.*`) → (3) stdlib/JS built-in → (4) native nền tảng (React/Fastify/
  Postgres/Drizzle) → (5) dep đã cài → (6) một dòng → (7) mới viết lượng tối thiểu.
- Sửa bug PHẢI trị GỐC (hàm dùng-chung), KHÔNG vá từng caller. Ưu tiên XOÁ hơn THÊM,
  boring hơn clever.
- KHÔNG thêm dependency / abstraction / boilerplate không được yêu cầu. Chỗ cố ý đơn giản hoá
  đánh dấu comment `ponytail:` (ghi trần hiện tại + đường nâng cấp).
- Proc đọc phức tạp → mở rộng DataSource, KHÔNG port code; Tier D chỉ cho proc GHI/scalar.

**Lý do**: diff nhỏ nhất chạy được (SAU khi hiểu trọn vấn đề) dễ review, ít lỗi, rẻ bảo trì.

### IV. Fail-safe dữ liệu + kỷ luật migration
- Lỗi LLM / embedding / AI KHÔNG được làm vỡ data: trả `null` / fail-safe, caller xử lý nhánh thiếu.
- Validate input ở trust boundary; error handling chống mất data; thao tác data route theo
  `meta.storage.tier` (bảng thật vs EAV); update `entities.meta` PHẢI merge jsonb, KHÔNG ghi đè.
- Migration: file `NNNN_<name>.sql` + entry `_journal.json` với timestamp **unique tăng dần**;
  idempotent (`IF EXISTS` + DO/EXCEPTION); comment ASCII, không `/*` lồng; ALTER/INDEX trên
  bảng nguồn (`tr_*`/`dq_*`) bọc table-check. JSONB qua postgres-js dùng `sql.json`, không `JSON.stringify`.

**Lý do**: dữ liệu khách hàng là tài sản; tính năng phụ hỏng không được kéo đổ luồng chính;
migration cẩu thả = prod crash lúc boot.

### V. UI nhất quán: token sáng/tối + a11y + dialog (NON-NEGOTIABLE)
- Màu ngữ nghĩa PHẢI qua token semantic (`bg/panel/text/muted/border/accent/accent-2/
  success/warning/danger`); CẤM palette cứng (`*-500`, `#hex`, `bg-white`) trừ ngoại lệ
  màu-là-dữ-liệu (chart, swatch, ErrorBoundary).
- KHÔNG dùng native `alert/confirm/prompt` — dùng `dialog.*` (`src/lib/dialog.ts`).
  Modal/Drawer dùng `useFocusTrap`; icon mới thêm vào `Icons.tsx` (`I.*`).
- a11y là bắt buộc; KHÔNG "tối giản" làm mất.

**Lý do**: hardcode màu vỡ chế độ sáng/tối; native dialog chặn toàn bộ event + phá UX;
a11y là chất lượng nền không thương lượng.

### VI. Chứng minh trước khi "xong" (lint 0-error + test)
- Trước khi báo "đã xong" PHẢI chạy `pnpm lint` (Biome — CI hard-fail 0 error) + `pnpm test`.
  Logic non-trivial để lại ≥1 test; mỗi bug fix kèm 1 test tái hiện bug.
- PHẢI chứng minh thay đổi chạy được (dán lệnh/output), KHÔNG tin "đã sửa" suông.
- Suppress lint đúng cú pháp `// biome-ignore lint/<group>/<rule>: <lý do>` đúng vị trí;
  KHÔNG sửa `useExhaustiveDependencies` bằng cách thêm/bớt deps (nguy cơ loop re-render).

**Lý do**: "tin tưởng nhưng kiểm chứng" — warning không chặn nhưng error chặn merge.

## Ràng buộc kỹ thuật & kiến trúc

- **Stack lõi (không đổi nếu không qua amendment)**: React 19 + Vite 6 / Fastify 5 + tRPC 11 +
  Drizzle ORM (PostgreSQL 18 + pgvector) / Vitest + Playwright / Node 22. pgvector là phụ thuộc cứng.
- **Monorepo pnpm**: `packages/{core,db,server,client,plugins}` + `src/` frontend. Quy tắc phụ thuộc:
  `core` thuần (không framework); `ui → domain → infra`, KHÔNG cho `domain` import `ui`.
- **DataSource-first**; Tier D thao tác qua `packages/plugins/src/proc-table.ts`; mọi tool/plugin/script
  để **in-tree** (`tooling/`, `packages/`), KHÔNG dùng `D:\code\cowok\Tools\`.
- **Server bootstrap** thứ tự cứng: `runMigrations` → register plugins/routes →
  `bootstrapTools` (gọi 1 lần, TRƯỚC `listen()`) → `listen()`.

## Quy trình phát triển & cổng chất lượng

- Việc không tầm thường bắt đầu ở **plan mode**; câu hỏi cấu trúc (ai gọi ai / định nghĩa / blast
  radius) dùng **codegraph** thay vì grep.
- **Commit**: prefix theo domain (`entity:|db:|sec:|perf:|ai:|ux:|a11y:|lint:|docs:|feat:|fix:|
  refactor:`), body tiếng Việt, kết `Co-Authored-By` (skill `commit-helper`); commit nhỏ theo
  lát cắt dọc hoàn chỉnh.
- **Deploy**: code TRƯỚC → config (page/datasource/entity qua MCP `/mcp/migration`) SAU. Prod chạy
  image Coolify build — `git push` KHÔNG tự deploy (ngoại lệ: `nginx.conf` volume-mount). GHI data
  prod CHỈ khi cutover `sync.state='live'`; mirror-write KHÔNG bật trên prod.
- **Cổng merge**: Biome hard-fail 0 error (warning không chặn); CI chạy test + e2e trên push.

## Governance

- Hiến pháp này có hiệu lực CAO HƠN mọi thói quen khác khi xung đột.
- Sửa đổi PHẢI: (a) ghi tài liệu lý do, (b) tăng version theo semver, (c) lan truyền đồng bộ sang
  template `.specify/` và `CLAUDE.md` liên quan TRONG CÙNG thay đổi.
- `CLAUDE.md` là hướng dẫn vận hành hằng ngày + nguồn chi tiết; constitution là nguyên tắc bất biến.
  Khi hai bên mâu thuẫn: ưu tiên constitution và mở amendment để đồng bộ lại.
- Mọi PR/review PHẢI kiểm chứng tuân thủ 6 nguyên tắc; độ phức tạp tăng PHẢI được biện minh
  (comment `ponytail:` + đường nâng cấp). Các mục NON-NEGOTIABLE không có ngoại lệ.
- **Versioning**: MAJOR = gỡ/định nghĩa lại nguyên tắc hoặc đổi governance không tương thích;
  MINOR = thêm/mở rộng nguyên tắc hay section; PATCH = làm rõ câu chữ, không đổi ngữ nghĩa.

**Version**: 1.0.0 | **Ratified**: 2026-06-30 | **Last Amended**: 2026-06-30
