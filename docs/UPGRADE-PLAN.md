# Kế hoạch nâng cấp ERP Framework thành framework chuẩn chỉnh

> Tài liệu định hướng. Cập nhật khi phạm vi thay đổi.
> Lập: 2026-05-20 · **Rev 5** — chốt PostgreSQL 18; khóa chính dùng uuidv7() thay gen_random_uuid(); + các bản sửa Rev 2-4.

## 1. Bối cảnh & quyết định đã chốt

ERP Framework hiện là app builder low-code (React 19 + TypeScript + Vite, ~11k dòng):
4 designer (Entity/Page/Workflow/Agent), tích hợp MCP, LLM đa nhà cung cấp, formula
engine, 4 tính năng doanh nghiệp (workflow execution, activity + cost, RBAC, scheduler).
**Toàn bộ dữ liệu lưu trong localStorage** — rào cản lớn nhất cho dùng thật.

| Hạng mục | Quyết định |
|---|---|
| Mục tiêu cuối | Lõi framework tái sử dụng **+** một sản phẩm ERP mẫu chạy trên lõi |
| Lưu trữ dữ liệu | **Backend thật tự xây** — Node/TypeScript + PostgreSQL |
| Mô hình triển khai | **Self-host single-tenant** — mỗi doanh nghiệp một bản cài riêng |

## 2. Định nghĩa "chuẩn chỉnh" (Definition of Done)

1. **Nguồn sự thật là server** — không còn localStorage làm kho chính.
2. **Bảo mật thực thi ở server** — auth thật, RBAC ở mọi API; client chỉ ẩn UI.
3. **Runtime độc lập UI** — workflow & scheduler chạy ở server, không cần mở trình duyệt.
4. **API public có kiểu, ổn định, gắn semver** — có `apiVersion`, CHANGELOG.
5. **Hệ thống plugin** — field type, workflow node, page widget, MCP connector, LLM
   adapter đăng ký động qua registry.
6. **Tách lõi/sản phẩm** — lõi cài độc lập; sản phẩm mẫu chứng minh lõi đủ dùng.
7. **Chất lượng** — typecheck/lint sạch, có test (unit + integration + e2e), CI.
8. **Vận hành được** — cài self-host 1 lệnh (docker-compose), có migration, backup, docs.

## 3. Kiến trúc đích

### 3.1 Monorepo (pnpm workspaces)

```
erp-framework/
  packages/
    core/     @erp-framework/core   — TypeScript THUẦN, KHÔNG phụ thuộc React.
                                      types, formula engine, workflow-runner, agent-runner,
                                      DataSource interface, hợp đồng plugin (interface).
                                      → cả server lẫn frontend đều import được.
    ui/       @erp-framework/ui     — React: designers, renderers, plugin UI registry.
                                      Phụ thuộc core. Chỉ frontend dùng.
    server/   @erp-framework/server — backend Fastify + tRPC + Drizzle. Phụ thuộc core + db.
    db/       @erp-framework/db     — schema Drizzle + migrations.
  apps/
    studio/      builder app (designer + consumer mode). Phụ thuộc core + ui.
    sample-erp/  sản phẩm ERP mẫu (Bán hàng + Kho). Phụ thuộc core + ui.
  tooling/   tsconfig base, cấu hình biome dùng chung
  docker/    docker-compose, Dockerfile, script backup
```

> **Vì sao tách `core` (thuần) khỏi `ui` (React)?** P3 đưa `workflow-runner`,
> `agent-runner`, `formula` chạy ở **server**. Nếu để chung package với designers/
> renderers (React), server sẽ kéo theo React + DOM làm dependency một cách vô ích,
> và `peerDependency` React của core sẽ rò sang backend. Tách đôi: `core` là logic
> thuần Node-an-toàn, `ui` là React. Hợp đồng plugin (interface) nằm ở `core`;
> phần *render* của plugin (field type hiển thị thế nào) nằm ở `ui`.

### 3.2 Stack backend đề xuất

| Thành phần | Lựa chọn | Lý do |
|---|---|---|
| Runtime | Node 22 + TypeScript | Đồng nhất ngôn ngữ với frontend |
| HTTP framework | Fastify | Nhẹ, nhanh, hỗ trợ TypeScript tốt |
| API | tRPC | Type-safe đầu-cuối; kèm REST gateway nếu cần tích hợp ngoài |
| ORM | Drizzle ORM | SQL-first, nhẹ, migration rõ ràng (drizzle-kit) |
| CSDL | PostgreSQL 18 | Quan hệ, bền; JSONB cho cấu hình động; uuidv7() cho khóa chính theo thứ tự thời gian |
| Auth | Cookie session | Single-tenant self-host — đơn giản, an toàn hơn JWT cho web |
| Job/scheduler | pg-boss | Hàng đợi chạy trên chính PostgreSQL — không cần Redis |

#### 3.2.1 Gotchas khi dùng pg-boss + Drizzle

- **Tách schema migration — dùng `schemaFilter`, KHÔNG dùng `tablesFilter`.**
  pg-boss tạo bảng hệ thống trong **schema riêng `pgboss`** (`pgboss.job`,
  `pgboss.schedule`, `pgboss.version`...). drizzle-kit lọc theo *schema* bằng
  `schemaFilter` (mặc định `["public"]`); `tablesFilter` chỉ lọc theo *tên bảng*
  (glob) nên không phải công cụ đúng — pg-boss cô lập bằng schema chứ không bằng
  tiền tố tên. **Khai báo tường minh `schemaFilter: ["public"]`** và giữ pg-boss ở
  schema mặc định `pgboss` (đừng cấu hình nó ghi vào `public`).
- **Connection pooling.** Fastify+tRPC mở một pool qua Drizzle; pg-boss mở pool
  **riêng** (`LISTEN/NOTIFY`). Đặt `max` cho cả hai sao cho tổng không vượt
  `max_connections` của PostgreSQL (khởi điểm: app 10, pg-boss 5, chừa dư psql/backup).
- **pgBouncer.** Nếu sau này đặt pgBouncer trước PostgreSQL, pg-boss phải nối ở
  **session mode** — `LISTEN/NOTIFY` không chạy qua transaction-pooling.

### 3.3 Sơ đồ tầng

```
[ apps/studio (React) ]            [ apps/sample-erp (React) ]
            \                               /
             \------- @erp-framework/ui ---/         (designers, renderers, plugin UI)
              \              |             /
               \      @erp-framework/core /           (logic THUẦN: formula, runner,
                \    (tRPC client inject)/             DataSource, plugin contracts)
                 \                      /
          HTTP (query/mutation)   WS (subscription)
                   |                  |
              [ @erp-framework/server (Fastify) ]
              auth · RBAC · CRUD · runtime engine · pg-boss scheduler · MCP/LLM proxy
                            |
                   @erp-framework/db (Drizzle) → [ PostgreSQL 18 ]
```

**Đồng bộ realtime.** Dùng **tRPC Subscriptions qua WebSocket** (`@fastify/websocket`).
Frontend dùng `splitLink`: query/mutation đi HTTP, subscription đi WS. WebSocket
upgrade vẫn mang cookie nên auth session dùng lại được.

Luồng sự kiện từ job chạy ngầm tới UI:

```
[Chạy ngầm]                 [Trung gian]                [Giao diện]
+------------------+        +------------------+        +--------------------+
| pg-boss Worker   |        | Fastify + tRPC   |        | Studio / Sample-ERP|
| (Workflow / LLM  |--emit->| Subscription     |--WS--> | useSubscription()  |
|  Agent tool)     |        | Router  (bus)    |        |                    |
+------------------+        +------------------+        +--------------------+
        |                                                        |
        +--------- ghi log -> [PostgreSQL: workflow_runs] --------+
```

- Worker **không gọi thẳng WebSocket** — nó phát sự kiện qua một *bus*.
- **Chọn bus theo topology tiến trình, không theo "scale":**
  - API server và worker **cùng tiến trình** → Node `EventEmitter` nội bộ là đủ.
  - API server và worker **tách tiến trình** (nên tách — worker crash không kéo sập
    API) → `EventEmitter` không bắc cầu được; phải dùng Postgres `LISTEN/NOTIFY`.
  - Khuyến nghị: bọc bus sau một interface nhỏ ngay từ P3 để đổi
    `EventEmitter` ↔ `LISTEN/NOTIFY` mà không sửa router.
- Log agent streaming có thể nhiều — gom/tiết lưu (throttle) trước khi đẩy.

### 3.4 Chiến lược schema động (dynamic schema)

Dữ liệu thực tế của entity động lưu vào cột `data jsonb` của bảng chung
`entity_records` (P1 dùng JSONB; chỉ schema hệ thống mới dùng Drizzle schema cố định).

**Chiến lược index — điểm dễ sai nhất.** GIN và B-tree giải hai bài toán *khác nhau*:

- **GIN index** trên `data` (`jsonb_path_ops`) chỉ tăng tốc truy vấn **containment /
  existence**: `data @> '{"status":"approved"}'`, `data ? 'key'`. Nó **KHÔNG** giúp
  cho so sánh khoảng (`>`, `<`) hay `ORDER BY` trên giá trị trích xuất.
- **So sánh khoảng & sắp xếp** theo field động cần **expression B-tree index** riêng
  cho từng field: `CREATE INDEX ... ON entity_records (((data->>'tong_tien')::numeric))`.
  Loại index này khó khai báo trong Drizzle (biểu thức cast tùy field) → viết bằng
  **SQL thô trong file migration** (drizzle-kit cho phép). Đây là index "theo nhu cầu":
  chỉ tạo cho field nào thực sự được lọc/sắp xếp nhiều.
- **Multicolumn GIN `(entityId, data)`** không chạy được trực tiếp: cột `entityId`
  kiểu `uuid` không vào GIN nếu thiếu extension `btree_gin`. Hai cách: bật
  `CREATE EXTENSION btree_gin` rồi mới làm composite; **hoặc đơn giản hơn** — để
  `btree(entityId)` riêng + `gin(data)` riêng, PostgreSQL tự kết hợp bằng *bitmap
  index scan*. Khuyến nghị cách thứ hai cho P1.

Các gotchas khác:
- **Validation.** PostgreSQL không ép kiểu bên trong JSONB — validate toàn bộ ở
  server theo định nghĩa field trong `entities.fields`.
- **Cast lúc query có thể ném lỗi.** `(data->>'x')::numeric` lỗi nếu giá trị rỗng/sai
  kiểu. Guard bằng validate-on-write + lọc `data ? 'x'` trước, hoặc kiểm `jsonb_typeof`.
- **Date.** Lưu ngày dạng chuỗi ISO (`YYYY-MM-DD...`) để sort text trùng sort thời
  gian; nếu không, expression index phải cast sang `timestamptz`.
- **Trôi schema.** Gắn `schemaVersion` cho record + migrate lười khi user đổi field.
- **Tham chiếu** giữa record động lưu bằng `uuid`, không lưu giá trị hiển thị.

### 3.5 Kỷ luật ghi dữ liệu (data governance) — cho P1

Vì dùng JSONB + expression index theo nhu cầu, tầng ghi dữ liệu phải có kỷ luật để
không làm sập index hay gây lỗi cast lúc vận hành (vd tính giá thành đồ gỗ VFM). Ba
quy tắc **bắt buộc**:

1. **Validate-on-write.** Trước mỗi `createRecord`/`updateRecord`, server đối chiếu
   object đầu vào với định nghĩa field trong `entities.fields`; sai kiểu → chặn ngay ở
   middleware tRPC. Quan trọng: validate **đồng thời ép kiểu (coerce)** — field số lưu
   thành **JSON number** thật, boolean thành JSON boolean — không lưu mọi thứ dạng
   chuỗi. Nhờ đó `(data->>'x')::numeric` luôn an toàn và expression index không bị
   lỗi cast khi quét bảng.
2. **Chuẩn hoá null/empty.** Field không có dữ liệu → **bỏ hẳn key khỏi object JSONB**
   (khuyến nghị) thay vì lưu chuỗi rỗng `""`. Chuỗi rỗng làm `::numeric` ném lỗi; bỏ
   key cũng giúp `data ? 'key'` mang đúng nghĩa "có giá trị". Chốt một quy ước duy
   nhất và ép trong cùng tầng validate-on-write.
3. **Sinh index tự động — nhưng KHÔNG đặt trong migration transaction.** Khi user tích
   `[x] Cho phép lọc nhanh` / `[x] Cho phép sắp xếp` cho một field trong Designer, lưu
   cờ vào `entities.fields`; hệ thống sinh `CREATE INDEX CONCURRENTLY` cho field đó.
   **Gotcha then chốt:** `CREATE INDEX CONCURRENTLY` **không chạy được trong
   transaction block** — mà drizzle-kit bọc mỗi migration trong một transaction. Đặt
   lệnh này vào file migration sẽ lỗi `cannot run inside a transaction block`. Cách đúng:
   - Chạy tạo index như một **job nền** (pg-boss là chỗ tự nhiên) trên kết nối riêng,
     **ngoài** hệ thống migration.
   - `CONCURRENTLY` có thể thất bại giữa chừng và để lại **index INVALID** — job phải
     kiểm tra, `DROP INDEX` cái hỏng rồi thử lại.
   - Quy ước tên index ổn định (vd `er_<entity>_<field>_idx`) để tránh trùng và dễ dọn.

## 4. Các giai đoạn

Cỡ tương đối: S ≈ vài ngày · M ≈ 1–2 tuần · L ≈ 3–4 tuần · XL ≈ 5–8 tuần.

### Tiền đề (P-1) — Ổn định bản hiện tại · cỡ S
- `pnpm build` xanh hoàn toàn (typecheck sạch).
- Chốt tag `v0.9.0` làm **mốc rollback cứng**.
- **Bàn giao:** app chạy ổn, có mốc so sánh hành vi.

### P0 — Tái cấu trúc monorepo & nền kỹ thuật · cỡ M
- Chuyển repo sang **pnpm workspaces**; tạo `packages/` (core, ui, server, db) và `apps/`.
- `tooling/` với `tsconfig.base.json`, cấu hình biome dùng chung.
- Di chuyển `src/` hiện tại → `apps/studio`; tách logic thuần (`types`, `lib/formula`,
  `core/workflow-runner`, `core/agent-runner`, `DataSource`) sang `packages/core`;
  tách UI (`components/designer`, `components/renderer`) sang `packages/ui`.
- **Kỷ luật phụ thuộc (ép bằng lint — `eslint no-restricted-imports` hoặc
  `dependency-cruiser`):**
  - `core` không import từ `ui` / `server` / `apps`.
  - `core` **cấm chứa logic mạng** (axios/fetch/tRPC client) — giao tiếp server chỉ
    qua `DataSource`.
  - `ui` chỉ import `core`; `server` chỉ import `core` + `db`; `apps` import tất cả.
  - App khởi tạo `ApiDataSource` (chứa tRPC client thật) rồi **inject** vào core/ui.
- CI: typecheck + lint + test + build cho toàn monorepo.
- **Bàn giao:** monorepo build xanh; `apps/studio` chạy y hệt bản cũ.

### P1 — Backend & lớp dữ liệu · cỡ XL  *(đường găng)*
- Dựng `packages/server` (Fastify) và `packages/db` (Drizzle).
- **Schema hệ thống (Drizzle cố định):** `users`, `roles`, `sessions`, `app_meta`,
  `entities`, `pages` (+`page_content` JSONB), `workflows` (+`graph` JSONB),
  `agents`, `mcp_configs`, `llm_profiles`, `activity_log`, `schedules`, `workflow_runs`.
- **Dữ liệu động:** bảng `entity_records` (cột `data jsonb`) — index theo 3.4 + Phụ lục A.
- Migration đầu tiên bằng drizzle-kit (`schemaFilter: ["public"]`).
- API tRPC: router CRUD cho metadata + record động + truy vấn.
- **Frontend:** interface `DataSource` (Phụ lục A) với 2 cài đặt —
  `LocalStorageDataSource` (giữ tạm) và `ApiDataSource` (tRPC); chuyển từng store
  (`userObjects`, `settings`, `activity`, `schedules`) sang gọi qua `DataSource`.
- Script `migrate-localstorage` nhập dữ liệu cũ vào PostgreSQL.
- **Bàn giao:** dữ liệu ở PostgreSQL; nhiều người dùng chung một bản cài.

### P2 — Xác thực & RBAC server-side · cỡ L
- Đăng nhập cookie session; quản lý user; gán role.
- **RBAC ở server:** middleware tRPC kiểm tra quyền theo `permissions.ts` cho mọi
  mutation/query. Client RBAC hạ xuống chỉ còn vai trò UX.
- `activity_log` ghi ở server, append-only.
- **Bàn giao:** bảo mật thật — không vượt quyền được bằng devtools.

### P3 — Runtime engine phía server · cỡ L
- Chuyển `workflow-runner` chạy ở server (đã ở `packages/core` thuần nên server
  import được mà không kéo React).
- Scheduler thật bằng **pg-boss**: cron job bền vững, chạy không cần UI.
- MCP/LLM call thực thi từ server; lưu kết quả vào `workflow_runs`.
- Endpoint **webhook** nhận trigger ngoài.
- UI xem lịch sử run + trạng thái realtime qua tRPC subscription (xem 3.3).
- **Bàn giao:** workflow chạy 24/7; lịch cron đáng tin cậy.

### P4 — Đóng gói lõi & Plugin SDK · cỡ L
- Hoàn thiện `@erp-framework/core` + `@erp-framework/ui` thành package cài độc lập.
- **Hợp đồng plugin:** `FieldTypePlugin`, `WorkflowNodePlugin`, `PageWidgetPlugin`,
  `McpConnectorPlugin`, `LlmAdapterPlugin` — interface ở `core`, phần render ở `ui`.
- Thay mảng hardcode (`FIELD_TYPES`, `NODE_PALETTE`, danh sách widget) bằng **registry động**.
- Plugin loader + versioning (`apiVersion` semver); giữ nhãn `@experimental` tới khi P5 xong.
- **Bàn giao:** bên thứ ba viết được plugin mà không sửa lõi.

### P5 — Sản phẩm ERP mẫu · cỡ M
- Dùng lõi dựng `apps/sample-erp` — phạm vi **Bán hàng + Kho** (sát ngữ cảnh đồ gỗ VFM).
- Thay `mock-data.ts` bằng seed thật qua migration.
- Thiếu chỗ nào sửa **trực tiếp vào core** theo "nỗi đau" thật.
- **Bàn giao:** một ERP thật chạy được, là template tham chiếu.

### P6 — DX, tài liệu, hardening & phát hành · cỡ L
- CLI `create-erp-app`; trang tài liệu (VitePress).
- Test: unit (`formula`, `permissions`, `cron`, `workflow-runner`), integration (API +
  DB thật), e2e (Playwright).
- Observability: structured logging, health check, metrics.
- `docker-compose.yml` (app + postgres), `.env.example`, script backup/restore
  **idempotent**, test luồng upgrade.
- Release: changesets, semver, CHANGELOG.
- **Bàn giao:** cài 1 lệnh, có docs, có test, sẵn sàng giao doanh nghiệp.

## 5. Bản đồ tiến trình & đường găng

```
P-1 → P0 → P1 → P2 → P3 → P4 → P5 → P6
                 └──────┘
            P1 là đường găng — mọi thứ sau phụ thuộc nó
```

| Giai đoạn | Quy mô | Trọng tâm kỹ thuật | Rủi ro lớn nhất | Giải pháp giảm thiểu |
|---|---|---|---|---|
| P-1 | S | Nợ kỹ thuật, `pnpm build` xanh | Sót lỗi runtime kín | Tag `v0.9.0` làm mốc rollback cứng |
| P0 | M | Tách monorepo (core/ui/server/db), tooling | Vòng phụ thuộc core ↔ app | Lint ép quy tắc import; cấm core import ngược |
| P1 | XL | Lớp dữ liệu (Drizzle + Postgres), API tRPC | **Đường găng:** sập toàn bộ lưu trữ | Lớp trừu tượng `DataSource`, chuyển cuốn chiếu |
| P2 | L | Cookie session auth, RBAC server | Lọt quyền qua API | Middleware tRPC bắt buộc; client chỉ ẩn UX |
| P3 | L | Runner lên server, pg-boss, realtime | Hụt tài nguyên do job ngầm | Giới hạn pool size; bus realtime sau interface |
| P4 | L | Đóng gói core/ui, plugin registry | Đóng cứng API plugin quá sớm | Nhãn `@experimental` tới khi P5 xong |
| P5 | M | Hai module Bán hàng + Kho (VFM) | Framework không khít thực tế | Sửa trực tiếp core theo "nỗi đau" code app mẫu |
| P6 | L | Dockerize, CLI, docs, e2e test | Vận hành lỗi tại nhà máy | Backup/restore idempotent, test luồng upgrade |

- **P1 không rút gọn được.** P2/P3 gối đầu một phần sau khi P1 ổn định schema.
- P4 thiết kế interface song song P3, chỉ "khoá" API sau P5.
- Muốn ra mắt sớm: dừng hết P3 đã có sản phẩm self-host thật dùng được.

### 5.1 Phân bổ nhân lực & chạy song song

```
[P-1] → [P0] → ┌─ P1 Backend: db schema + tRPC CRUD router ─┐ → [P2] → [P3] → [P4] → [P5] → [P6]
               │                                            │
               └─ P1 Frontend: DataSource + bóc tách Studio ─┘
                  (không cần đợi backend)
```

- **P1 chạy song song hai nhánh** quanh một hợp đồng chung: interface `DataSource` +
  các DTO (`EntityConfig`, `EntityRecord`, `QueryParams`) trong `packages/core`.
- **Cổng "contract-first":** việc đầu tiên của P1 là **chốt và đóng băng `DataSource`
  + DTO**. Hai nhóm đều build dựa vào đó — interface trôi giữa chừng thì cả hai nhánh
  cùng vỡ. Đây là điều kiện để chạy song song thật sự, không phải tRPC.
- **Nhóm Backend (1–2 dev):** dựng `packages/db` (schema PostgreSQL cố định), viết
  CRUD router thô trên Fastify + tRPC, đảm bảo kết quả router khớp DTO.
- **Nhóm Frontend (1–2 dev):** không đợi backend — cài `LocalStorageDataSource` theo
  interface, bóc tách `src/` → `apps/studio`, chuyển các store sang gọi qua `DataSource`.
- **Hợp long:** backend xong P1 → viết `ApiDataSource` (bám `AppRouter` type của tRPC)
  rồi đổi một dòng inject. Lưu ý: `ApiDataSource` vẫn phải viết dựa trên type router
  nên không hoàn toàn "0 công" — nhưng nhỏ, và phần lớn UI đã chạy sẵn trên
  `LocalStorageDataSource`.

## 6. Rủi ro xuyên suốt & kỷ luật vận hành

| Rủi ro | Ảnh hưởng | Giảm thiểu |
|---|---|---|
| Phình phạm vi (multi-tenant, mobile…) | Trung bình | Bám 3 quyết định; thay đổi phải sửa tài liệu này trước |
| Mất dữ liệu khi migrate localStorage → DB | Cao | Backup trước, chạy thử trên bản sao, migrate idempotent |
| Trôi schema JSONB | Trung bình | `schemaVersion` trên record + migrate lười (xem 3.4) |
| Bảng `entity_records` chậm khi lớn | Cao | Đúng loại index (GIN cho containment, B-tree biểu thức cho khoảng/sort) |

## 7. Checklist khởi động (thứ Hai tuần tới)

**1. Chốt chặn P-1.** Chạy `pnpm build`, dọn sạch type warning. Tạo tag cứng:

```
git tag -a v0.9.0 -m "Milestone trước khi lên Monorepo"
```

**2. Khởi tạo khung monorepo (P0).** Tạo cây thư mục mục 3.1 (khung trống). File
`pnpm-workspace.yaml` ở gốc:

```yaml
packages:
  - 'packages/*'
  - 'apps/*'
  - 'tooling/*'
```

**3. `drizzle.config.ts` đầu tiên.** Khai báo `schemaFilter` (đúng công cụ để cô lập
pg-boss — pg-boss ở schema riêng `pgboss`, không phải tiền tố tên bảng):

```ts
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./packages/db/src/schema.ts",
  out: "./packages/db/migrations",
  dialect: "postgresql",
  schemaFilter: ["public"],   // chỉ quản lý schema public; pg-boss nằm ở schema "pgboss"
});
```

**4. Phác thảo schema PostgreSQL** vào `packages/db/src/schema.ts` (xem Phụ lục A) để rà sớm.

## Phụ lục A — Thiết kế lớp dữ liệu cho P1

### A.1 Interface `DataSource` (đặt ở `packages/core/src/datasource/`)

Các store gọi qua interface này, không gọi thẳng `localStorage` hay `trpc` — nhờ đó
P1 chuyển đổi cuốn chiếu được. `core` chỉ *khai báo* interface; `apps` *cung cấp* cài đặt.

```ts
export interface DataSource {
  // Metadata low-code (định nghĩa do designer tạo)
  getEntity(id: string): Promise<EntityConfig>;
  saveEntity(id: string, data: EntityConfig): Promise<void>;
  listEntities(): Promise<EntityConfig[]>;

  // Dữ liệu thực tế người dùng nhập
  getRecords(entityId: string, query: QueryParams): Promise<EntityRecord[]>;
  createRecord(entityId: string, data: Record<string, unknown>): Promise<EntityRecord>;
  updateRecord(recordId: string, data: Record<string, unknown>): Promise<EntityRecord>;
  deleteRecord(recordId: string): Promise<void>;

  // Workflow & scheduler
  triggerWorkflow(workflowId: string, context: unknown): Promise<{ runId: string }>;
}
```

Hai cài đặt: `LocalStorageDataSource` (giữ tạm trong P1) và `ApiDataSource` (tRPC).

### A.2 Drizzle schema lõi (`packages/db/src/schema.ts`)

```ts
import { pgTable, uuid, text, timestamp, jsonb, boolean, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// 1. METADATA — định nghĩa bảng do user thiết kế
export const entities = pgTable("entities", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull().unique(),   // định danh máy: "so_don_hang"
  label: text("label").notNull(),          // nhãn hiển thị: "Sổ Đơn Hàng"
  fields: jsonb("fields").notNull(),        // mảng cấu hình field (type, validation…)
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// 2. DỮ LIỆU ĐỘNG — JSONB (xem 3.4)
export const entityRecords = pgTable("entity_records", {
  id: uuid("id").defaultRandom().primaryKey(),
  // Tham chiếu theo id (uuid, BẤT BIẾN) — không theo name (đổi tên sẽ vỡ FK)
  entityId: uuid("entity_id").notNull()
    .references(() => entities.id, { onDelete: "cascade" }),
  schemaVersion: text("schema_version").notNull(),   // chống trôi schema
  data: jsonb("data").notNull(),
  createdBy: uuid("created_by"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  // B-tree lọc theo loại entity (uuid KHÔNG vào GIN nếu thiếu extension btree_gin)
  entityIdIdx: index("entity_records_entity_id_idx").on(t.entityId),
  // GIN jsonb_path_ops: tăng tốc truy vấn containment  data @> '{...}'
  dataGinIdx: index("entity_records_data_gin_idx")
    .using("gin", sql`${t.data} jsonb_path_ops`),
}));

// 3. WORKFLOW — đồ thị cho Workflow Engine
export const workflows = pgTable("workflows", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  triggerType: text("trigger_type").notNull(),  // "webhook" | "cron" | "entity_changed"
  graph: jsonb("graph").notNull(),              // toàn bộ nodes + edges của Designer
  isActive: boolean("is_active").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
```

**Chỉnh sửa so với bản phác thảo ban đầu, kèm lý do:**

- `entityRecords` tham chiếu **`entityId` (uuid)**, không phải `entityName` (text):
  FK trỏ vào cột `name` đổi được sẽ vỡ khi rename entity.
- Thêm **`schemaVersion`** ngay từ đầu để xử lý trôi schema JSONB.
- `isActive` dùng `boolean`, không phải `integer 0/1`.
- Index: **chỉ** `btree(entityId)` + `gin(data)` riêng — bỏ multicolumn GIN
  `(entityId, data)` vì cột `uuid` cần extension `btree_gin` mới vào được GIN;
  PostgreSQL tự kết hợp hai index rời bằng bitmap scan.

**Index khoảng/sắp xếp — viết SQL thô trong migration**, tạo theo nhu cầu từng field:

```sql
-- ví dụ: lọc & sắp xếp theo tong_tien (số) và ngay_lap (ngày)
CREATE INDEX entity_records_tongtien_idx
  ON entity_records (((data->>'tong_tien')::numeric));
CREATE INDEX entity_records_ngaylap_idx
  ON entity_records ((data->>'ngay_lap'));
```

### A.3 Mẫu truy vấn Drizzle cho field động (trong tRPC router)

```ts
import { and, eq, sql } from "drizzle-orm";

// (a) Lọc containment — GIN index data tăng tốc:
const approved = await db.select().from(entityRecords).where(
  and(
    eq(entityRecords.entityId, entityId),
    sql`${entityRecords.data} @> '{"status":"approved"}'::jsonb`,
  ),
);

// (b) Lọc khoảng + sắp xếp — CẦN expression index ở A.2, nếu không sẽ table scan:
const big = await db.select().from(entityRecords).where(
  and(
    eq(entityRecords.entityId, entityId),
    sql`(${entityRecords.data}->>'tong_tien')::numeric > 5000000`,
  ),
).orderBy(sql`${entityRecords.data}->>'ngay_lap' DESC`).limit(20);
```

Lưu ý: cast `(data->>'x')::numeric` ném lỗi nếu giá trị rỗng/sai kiểu — guard bằng
validate-on-write, hoặc lọc `data ? 'tong_tien'` trước khi cast.

### A.4 Cấu trúc `packages/core` & `packages/ui`

```
packages/core/                    (TypeScript thuần — KHÔNG React)
├── src/
│   ├── datasource/   interface DataSource + DTOs
│   ├── formula/      formula engine
│   ├── runtime/      workflow-runner, agent-runner (server tái dùng)
│   ├── plugin/       hợp đồng plugin (interface) + registry logic
│   ├── types/        types dùng chung
│   └── index.ts      public API entry
└── package.json      KHÔNG có react ở dependencies

packages/ui/                      (React)
├── src/
│   ├── designers/    Entity/Page/Workflow/Agent designer
│   ├── renderers/    trình dựng UI động (AutoForm, DataGrid, Chart…)
│   ├── plugin-ui/    đăng ký phần render của plugin
│   └── index.ts
└── package.json      peerDependencies: react, react-dom; dependencies: @erp-framework/core
```

Kỷ luật: `core` không bao giờ chứa network client; app khởi tạo `ApiDataSource`
(bọc tRPC client) rồi inject vào core + ui khi khởi chạy.

---
*Cấu hình Coolify hiện tại vẫn dùng cho bản self-host tạm tới khi P6 chuẩn hoá docker-compose.*
