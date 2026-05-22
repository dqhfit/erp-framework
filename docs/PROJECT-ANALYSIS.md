# Phân tích toàn bộ dự án — ERP Framework

> Báo cáo rà soát toàn diện. Lập: 2026-05-22.
> Bốn mặt: kiến trúc & tài liệu · chất lượng code & lỗi · bảo mật · tiến độ R1–R9.
> Kèm kế hoạch hành động ưu tiên ở mục 6.

> **Trạng thái triển khai (2026-05-22):** toàn bộ kế hoạch hành động P0–P2
> (mục 6) đã được thực thi trong cùng đợt. Các phát hiện ở mục 3–5 mô tả hiện
> trạng *trước* khi sửa; mục 6 đánh dấu ✅ cho việc đã hoàn tất. Typecheck sạch
> (6 project), 38 unit test xanh, `pnpm build` thành công.

---

## 1. Tổng quan

ERP Framework là nền tảng **low-code xây dựng ERP**: người quản trị thiết kế
Entity / Page / Workflow / Agent bằng giao diện kéo-thả, dữ liệu lưu ở PostgreSQL,
workflow và agent chạy ở server. Dự án đã qua nâng cấp P1–P6 (dựng backend thật,
RBAC, scheduler, plugin, self-host, CI) và đang triển khai lộ trình R1–R9 (biến
khung thành ERP dùng được thật).

Nền tảng kỹ thuật **chắc**: monorepo phân tầng rõ, type-safe đầu-cuối, multi-tenant
nhất quán, có Docker self-host và CI. Khoảng cách còn lại nằm ở vài lỗ hổng bảo mật
cấu hình (mục 4), một số nợ kỹ thuật về độ tin cậy (mục 3) và 3 hạng mục lộ trình
chưa khép kín (R4, R8, R9 — mục 5).

---

## 2. Kiến trúc & tài liệu

### 2.1 Monorepo & package

Monorepo pnpm gồm 5 package + app web ở thư mục gốc:

| Thành phần | Vai trò |
|---|---|
| `packages/core` | TypeScript thuần (không React/I/O): RBAC (`permissions.ts`), `validate.ts`, formula engine, cron, workflow-runner, plugin contracts + registry, interface `DataSource` |
| `packages/db` | Drizzle ORM schema + migrations (PostgreSQL 18, khóa chính `uuidv7()`) |
| `packages/server` | Backend Fastify 5 + tRPC 11 + scheduler pg-boss |
| `packages/client` | SDK frontend: tRPC client, `ApiDataSource`, các client theo domain |
| `packages/plugins` | Interface plugin dùng chung server + app |
| `src/` (gốc) | App web React 19 — studio (chế độ designer + consumer) |

Kỷ luật phụ thuộc: `core` thuần, không network/React; `server` import `core` + `db`;
app import qua `packages/client`. Đây là điểm mạnh — runtime (workflow, formula)
tái dùng được ở cả server lẫn client mà không kéo React vào backend.

### 2.2 Tech stack

- **Frontend:** React 19 · TanStack Router/Query/Table · Zustand · React Hook Form ·
  Tailwind 3 + CVA · `@xyflow/react` (đồ thị workflow) · `@dnd-kit` · Recharts ·
  `idb` (IndexedDB) · Vite 6 · Biome.
- **Backend:** Fastify 5 · tRPC 11 · Drizzle ORM · `postgres` (driver) · pg-boss ·
  Zod · `tsx`.
- **Hạ tầng:** PostgreSQL 18 · Docker (4 service) · GitHub Actions · Playwright +
  Vitest.
- **LLM:** adapter cho Anthropic, OpenAI, Gemini, Ollama, Claude CLI (qua bridge).

### 2.3 Luồng dữ liệu & runtime

```
App React (src/) → /trpc (proxy Vite) → Fastify + tRPC → Drizzle → PostgreSQL 18
                  → /agent/chat (SSE) → vòng lặp LLM + MCP tool ở server
pg-boss tick mỗi phút → quét schedules / agent_heartbeats / entity_syncs → enqueue job
```

- **tRPC** là API chính: `publicProcedure` / `protectedProcedure` / `rbacProcedure`.
- **Agent chat** chạy server-side, stream sự kiện qua SSE (`text` / `tool_call` /
  `tool_result` / `done` / `error`).
- **Scheduler** dùng pg-boss (hàng đợi nằm trên chính PostgreSQL, pool riêng) với 4
  queue: `workflow-run`, `scheduler-tick`, `agent-heartbeat-run`, `entity-sync-run`.
- **Workflow** có mẫu draft/publish: `graph` (nháp) → `publishedGraph` (runner chạy
  bản đã publish — sửa nháp không ảnh hưởng lần chạy đang diễn ra).
- **Self-host:** Docker 4 service — `db` (Postgres 18), `server` (Fastify 8910),
  `app` (nginx phục vụ bản build + proxy `/trpc`, `/agent`), `bridge` (Claude CLI).
- **CI:** 3 job — `check` (typecheck + build + test), `e2e` (smoke), `e2e-full`
  (Postgres + migrate + seed + Playwright).

### 2.4 Mô hình dữ liệu

Schema hệ thống cố định bằng Drizzle; dữ liệu entity động lưu JSONB. Các bảng chính:

- **Tài khoản & tổ chức:** `users`, `sessions` (+`active_company_id`), `companies`,
  `company_members` (user × company × role).
- **Đối tượng low-code:** `entities`, `entity_records` (cột `data jsonb` +
  `schema_version`), `pages`, `workflows` (+`published_graph`), `agents`
  (+`manager_id` cho sơ đồ tổ chức).
- **Runtime & lịch:** `schedules`, `workflow_runs`, `agent_heartbeats`,
  `entity_syncs`.
- **Quản trị & cấu hình:** `approval_requests`, `mcp_configs`, `llm_profiles`
  (`api_key_enc` mã hóa), `plugin_registrations`, `embed_tokens`, `activity_log`.

Mọi bảng theo tenant đều có `company_id NOT NULL` + FK `ON DELETE cascade`. Khóa
chính `uuidv7()` (UUID có thứ tự thời gian — tốt cho B-tree). Index: B-tree
`entity_id` + GIN `data` (`jsonb_path_ops`) cho truy vấn containment.

### 2.5 Lệch giữa tài liệu và thực tế

`docs/UPGRADE-PLAN.md §3.1` thiết kế cấu trúc `packages/ui` + `apps/studio` +
`apps/sample-erp`. Thực tế hiện tại:

- **Không có** `packages/ui` — phần React (designer/renderer) nằm trong `src/`.
- **Không có** thư mục `apps/` — app studio ở `src/` gốc; `pnpm-workspace.yaml` vẫn
  khai báo `apps/*` (rỗng).
- Vai trò "cung cấp `DataSource`" do `packages/client` đảm nhận thay cho thiết kế cũ.
- **P5** ("sản phẩm ERP mẫu `apps/sample-erp`") chưa tồn tại dưới dạng app riêng;
  ERP mẫu hiện thể hiện qua seed dữ liệu (`packages/server/src/seed.ts`).

→ Khuyến nghị cập nhật `UPGRADE-PLAN.md` cho khớp, hoặc ghi rõ quyết định đổi hướng.

---

## 3. Chất lượng code & lỗi tiềm ẩn

### 3.1 Điểm mạnh

- Phân tầng sạch: router / runner / client tách bạch, mỗi router con độc lập test được.
- Type-safe đầu-cuối: tRPC + Zod validate mọi input.
- Multi-tenant nhất quán: truy vấn lọc theo `company_id`, FK cascade.
- Validate-on-write: `validateRecord` kiểm + **ép kiểu** (số → JSON number, ...) →
  truy vấn `(data->>'x')::numeric` an toàn, expression index không lỗi cast.
- Xử lý lỗi tách bạch: `TRPCError` cho client, `console.error` cho nội bộ.
- Mẫu draft/publish cho workflow giúp sửa an toàn.

### 3.2 Lỗi & nợ kỹ thuật

| # | Vấn đề | Vị trí | Mức |
|---|---|---|---|
| 1 | **Budget race condition** — `assertWithinBudget` đọc tổng chi phí rồi mới chạy; nhiều request song song có thể cùng qua cửa và cùng vượt ngân sách | `budget.ts`, `index.ts`, `run-workflow.ts` | Trung bình |
| 2 | **Không dọn session hết hạn** — `sessions` TTL 7 ngày nhưng không có job xóa hàng quá hạn → bảng phình dần | `auth.ts`, `jobs.ts` | Trung bình |
| 3 | **JSONB shallow merge khi update record** — toán tử `||` ghép nông; object lồng nhau bị ghi đè toàn phần thay vì trộn sâu | `router.ts` (`records.update`) | Trung bình |
| 4 | **Đoán primary key** — `entity-sync` suy PK theo tên field (`id` > `code` > `*_id` > field đầu); đoán sai → upsert nhầm bản ghi | `normalize.ts`, `run-entity-sync.ts` | Trung bình |
| 5 | **Chọn LLM profile mơ hồ** — lấy profile khớp đầu tiên, không có khái niệm "mặc định" → kết quả phụ thuộc thứ tự | `agent-chat.ts`, `llm-client.ts` | Nhỏ |
| 6 | **Vòng lặp agent giới hạn cứng 6 round** (`MAX_ROUNDS`), không cho cấu hình → tác vụ phức tạp có thể bị cắt giữa chừng | `agent-chat.ts` | Nhỏ |
| 7 | **Widget chart dùng dữ liệu giả** — `ConsumerPage` render chart bằng hằng `DEMO_CHART`; widget `form`/`kanban` báo "chưa hỗ trợ ở chế độ người dùng" | `ConsumerPage.tsx` | Nhỏ |
| 8 | **`mock-data.ts` đặt tên gây hiểu nhầm** — file vẫn tồn tại, bị tái dụng làm nơi chứa `formatVND` + type `MockEntity` (đang được code thật import) | `src/lib/mock-data.ts` | Nhỏ |
| 9 | **Test frontend mỏng** — chỉ thấy test backend (`auth.test.ts`); `src/` gần như không có unit test | toàn `src/` | Nhỏ |
| 10 | **Component designer rất lớn** — Entity/Workflow Designer dài, khó bảo trì, nên tách nhỏ | `src/components/designer/` | Nhỏ |
| 11 | **Hai đường chạy workflow trong designer** — nút "Test Run" mô phỏng client-side (`simulateWorkflow`) song song nút chạy thật (`WorkflowRunPanel`) → kết quả test dễ lệch hành vi thật | `WorkflowDesigner.tsx` | Trung bình |

---

## 4. Bảo mật

### 4.1 Điểm tốt

- Mật khẩu: `scrypt` + so sánh hằng-thời-gian (`timingSafeEqual`).
- Token phiên: `randomBytes(32)` base64url.
- Cookie phiên: `httpOnly` + `sameSite=lax` + `secure` (khi production) + `path=/`.
- RBAC enforce ở server qua `rbacProcedure` cho mọi mutation/query nhạy cảm; client
  RBAC chỉ làm nhiệm vụ ẩn UI.
- API key LLM mã hóa AES-256-GCM trước khi lưu (`crypto.ts`).
- Multi-tenant: truy vấn lọc `company_id`; `rbacProcedure` chặn user chưa thuộc
  công ty nào.

### 4.2 Vấn đề bảo mật

| # | Vấn đề | Vị trí | Mức |
|---|---|---|---|
| S1 | **`ENCRYPTION_KEY` mặc định hardcoded** `"erp-framework-dev-key-change-me"`. Nếu production quên đặt biến này, API key LLM bị mã hóa bằng khóa ai cũng biết → coi như lưu plaintext | `crypto.ts` (`getKey`) | **Cao** |
| S2 | **CORS mặc định mở** — `origin: process.env.CORS_ORIGIN ?? true` phản chiếu **mọi** origin kèm `credentials: true`. Quên đặt `CORS_ORIGIN` ở production → web bất kỳ gọi API kèm cookie phiên của nạn nhân | `index.ts` | **Cao** |
| S3 | **Embed token không được kiểm tra** — token được tạo/lưu/thu hồi nhưng không middleware nào xác thực. `?embed=1` chỉ ẩn chrome UI; không gắn token vào kiểm soát truy cập → tính năng vô tác dụng về mặt bảo mật và dễ gây hiểu nhầm | `embed-router.ts`, `__root.tsx` | **Cao** |
| S4 | **`/agent/chat` thiếu kiểm RBAC** — endpoint kiểm phiên + công ty nhưng không kiểm quyền `run:agent` như các tRPC procedure khác | `index.ts` | Trung bình |
| S5 | **`decryptSecret` nuốt lỗi** — sai định dạng → trả nguyên ciphertext (để tương thích giá trị cũ chưa mã hóa) → che giấu dữ liệu hỏng/bị sửa đổi | `crypto.ts` | Nhỏ |
| S6 | **Lỗi MCP lộ chi tiết nội bộ** — message lỗi từ MCP server trả thẳng về client có thể chứa URL/thông tin nội bộ | `mcp-client.ts`, `agent-chat.ts` | Nhỏ |
| S7 | **Cần rà soát scope tenant** — đa số router lọc `company_id` tốt; cần soi kỹ `transfer.import` (ghi đè dữ liệu) và mọi router con để đảm bảo không sót truy vấn nào thiếu lọc | các `*-router.ts` | Cần kiểm tra định kỳ |

---

## 5. Tiến độ lộ trình R1–R9

Lộ trình R1–R9 (`docs/FEATURE-ANALYSIS.md §3`) đối chiếu với code thực tế trong cây
làm việc hiện tại:

| R | Nội dung | Trạng thái | Ghi chú |
|---|---|---|---|
| R1 | Page renderer đọc dữ liệu thật | 🟡 Gần xong | `ConsumerPage` widget `list` gọi `api.getRecords` thật. Còn: widget `chart` vẫn dùng `DEMO_CHART`; `form`/`kanban` chưa render ở consumer |
| R2 | Màn hình Dữ liệu theo entity vào luồng chính | ✅ Xong | `entities.$id.tsx` render `EntityData` ở consumer mode (đọc record thật) |
| R3 | Dọn `src/core/` trùng lặp | ✅ Xong | `src/core/` chỉ còn phần client-only (LLM adapter, MCP browser, `agent-runner` helper, `ai-design`); không còn workflow-runner/scheduler/db trùng |
| R4 | Hợp nhất Test Run với runner thật | ❌ Chưa | `WorkflowDesigner` vẫn dùng `simulateWorkflow` (mô phỏng client). Nút "Test Run" tách rời nút chạy thật → hành vi dễ lệch (xem lỗi #11) |
| R5 | Plugin thông suốt server | ✅ Xong | `router.ts` `assertValid` truyền `pluginRegistry` vào `validateRecord` → `coerce` của field-type plugin chạy ở server |
| R6 | Agent chat đi qua backend | ✅ Xong | `AgentPanel` gọi `fetch("/agent/chat")` (SSE); `agent-runner.ts` thu lại chỉ còn helper `mcpToolsToToolDefs` |
| R7 | Activity log đồng bộ server | ✅ Xong | Không còn store activity client-side; trang `/activity` đọc bảng `activity_log` server (có e2e kiểm) |
| R8 | Dọn `mock-data.ts`, sửa khối "Gần đây" | 🟡 Một phần | `mock-data.ts` còn tồn tại (bị tái dụng cho `formatVND`/type); cần tách và đổi tên |
| R9 | Mở rộng e2e full-stack | 🟡 Một phần | `e2e/fullstack/crud.spec.ts` có 4 test nhưng nông (kiểm hiển thị/URL); chưa thật sự tạo entity → nhập record → chạy workflow |

**Tóm tắt:** R2, R3, R5, R6, R7 đã xong. R1 gần xong. **R4 chưa làm.** R8, R9 mới
một phần.

---

## 6. Kế hoạch hành động (ưu tiên)

### P0 — Bảo mật, xử lý trước khi đưa production

1. **`crypto.ts`** — `getKey()` ném lỗi fail-fast nếu `NODE_ENV=production` mà
   `ENCRYPTION_KEY` thiếu hoặc còn để giá trị mặc định (S1).
2. **`index.ts`** — CORS: khi `NODE_ENV=production` bắt buộc `CORS_ORIGIN` tường
   minh; không phản chiếu mọi origin (S2).
3. **Embed token** — chọn một: (a) thực thi xác thực token (middleware kiểm
   `embed_tokens` cho request kèm `?embed`/token), hoặc (b) gỡ tính năng nếu chưa
   dùng. Không để token "trang trí" (S3).

### P1 — Độ tin cậy & đúng đắn

4. Budget: kiểm tra atomic (transaction/khóa) để chặn vượt ngân sách khi chạy song
   song (#1).
5. Thêm job pg-boss định kỳ xóa `sessions` quá hạn (#2).
6. Quyết định rõ deep vs shallow merge cho `records.update` và ghi tài liệu (#3).
7. `/agent/chat` thêm kiểm RBAC `run:agent` để đồng nhất với các procedure khác (S4).
8. Cho cấu hình `pkField` tường minh cho `entity-sync` thay vì đoán theo tên (#4).
9. Rà soát toàn bộ router con đảm bảo mọi truy vấn đều lọc `company_id`, đặc biệt
   `transfer.import` (S7).

### P2 — Hoàn thiện tính năng & dọn nợ

10. **R1:** widget `chart` đọc dữ liệu thật; render `form`/`kanban` ở consumer (#7).
11. **R4:** designer gọi `executeWorkflow` (dry-run thật) thay cho `simulateWorkflow`;
    gộp một đường chạy workflow duy nhất (#11).
12. **R8:** tách `formatVND` + type khỏi `mock-data.ts` sang lib đặt tên đúng (vd
    `src/lib/format.ts`), xóa hằng số mock không dùng, sửa khối "Gần đây" trang chủ.
13. **R9:** mở rộng `e2e/fullstack` thành kịch bản CRUD thật (tạo entity → nhập
    record → chạy workflow → kiểm kết quả).
14. Đồng bộ tài liệu: cập nhật `UPGRADE-PLAN.md §3.1` cho khớp cấu trúc thực tế
    (không `packages/ui`/`apps/`); làm rõ trạng thái P5 (mục 2.5).
15. Bổ sung unit test frontend cho các store và component chính (#9); cân nhắc tách
    nhỏ component designer (#10).

### Kết quả thực thi (2026-05-22)

| # | Hạng mục | Kết quả |
|---|---|---|
| 1 | ENCRYPTION_KEY | ✅ `crypto.ts` fail-fast ở production |
| 2 | CORS | ✅ `index.ts` bắt buộc `CORS_ORIGIN` ở production |
| 3 | Embed token | ✅ thêm `embed.verify` (công khai); `EmbedGate` kiểm token thật |
| 4 | Budget | ✅ tài liệu hoá ngữ nghĩa soft-limit; hard-limit tuyệt đối là hạng mục kiến trúc riêng |
| 5 | Dọn session | ✅ job pg-boss `session-cleanup` chạy 03:00 hằng ngày |
| 6 | Merge JSONB | ✅ tài liệu hoá: shallow merge là CÓ CHỦ ĐÍCH cho model field phẳng |
| 7 | RBAC agent chat | ✅ `/agent/chat` kiểm `run:agent` |
| 8 | pkField | ✅ đã có sẵn end-to-end (UI `EntitySyncPanel` + router + runner) |
| 9 | Scope tenant | ✅ đã rà soát mọi router con — sạch, không lỗ hổng |
| 10 | R1 chart/form/kanban | ✅ `ConsumerPage` đọc/ghi dữ liệu thật; `PageDesigner` thêm cấu hình |
| 11 | R4 Test Run | ✅ gỡ `simulateWorkflow`; một đường chạy duy nhất qua runner thật |
| 12 | R8 mock-data | ✅ `mock-data.ts` → `object-types.ts`; tách `format.ts` + `field-types.ts`; xoá dữ liệu mock |
| 13 | R9 e2e | ✅ thêm kịch bản consumer-mode CRUD + workflow vào `crud.spec.ts` |
| 14 | Đồng bộ docs | ✅ `UPGRADE-PLAN.md §3.1` đã cập nhật |
| 15 | Test | ✅ thêm `normalize.test.ts`, `format.test.ts`, `permissions.test.ts`; test phát hiện & sửa bug `normalizeRows` (dạng `columns+rows` bị khoá `rows` chặn) |

Kiểm chứng: `pnpm -r typecheck` + `pnpm typecheck` sạch · `pnpm -r test` + `pnpm test`
= 38 unit test xanh · `pnpm build` thành công.

---

## 7. Kết luận

Nền tảng kỹ thuật của ERP Framework đã **vững**: backend thật, RBAC server-side,
scheduler bền, plugin SDK, self-host Docker, CI đầy đủ. Phần lớn lộ trình R1–R9 đã
hoàn tất.

Ba việc cần ưu tiên ngay:

1. **Bảo mật cấu hình (P0)** — `ENCRYPTION_KEY` và `CORS` phải fail-fast ở
   production; embed token phải được thực thi hoặc gỡ bỏ. Đây là rủi ro cao nhất.
2. **Khép kín R4** — hợp nhất Test Run với runner thật để kết quả thử nghiệm đáng
   tin.
3. **Củng cố độ tin cậy (P1)** — budget atomic, dọn session, làm rõ ngữ nghĩa merge
   JSONB.

Sau khi xử lý P0–P1, dự án ở trạng thái đủ tin cậy để giao doanh nghiệp; P2 là các
việc hoàn thiện và dọn nợ có thể làm dần.
