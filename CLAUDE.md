# CLAUDE.md — Hướng dẫn cho Claude Code làm việc với repo này

> Tài liệu instruction tự động được Claude Code đọc đầu mỗi session.
> Cập nhật khi: chốt convention mới, học được bài học từ bug, đổi
> kiến trúc lõi. Cuối tài liệu có "Bài học từ session trước" — dồn
> dần để Claude tránh lặp lại.

## 1. Định dạng + scope

- **Ngôn ngữ**: tiếng Việt cho comment code + commit message + UI label;
  code/identifier vẫn tiếng Anh chuẩn.
- **Monorepo pnpm workspaces**: `packages/{core,db,server,client,plugins}` +
  root app frontend (`src/`, vite). Workspace pattern khai báo ở
  `pnpm-workspace.yaml`.
- **Multi-tenant ngay từ schema**: mọi bảng dữ liệu có cột `company_id`
  + cascade FK. Session lưu `active_company_id`.

## 2. Tech stack chốt

| Layer | Tech |
|---|---|
| Frontend | React 19, Vite 6 (manualChunks), TanStack Router/Query/Table, Zustand, react-hook-form, Tailwind 3, Biome 1.9 |
| Backend | Fastify 5, tRPC 11, Drizzle ORM 0.45.2 (PostgreSQL 18 + pgvector), pg-boss queues, isolated-vm |
| Test | Vitest 2 (unit), Playwright (e2e smoke + fullstack) |
| Ops | Docker compose 8 services (db/tika/server/app/bridge/ollama/mosquitto), Node 22 |

### Dev KHÔNG cài được Docker (máy yếu / OS không hỗ trợ)

- **Chỉ Postgres 18 + pgvector là phụ thuộc cứng.** `pnpm dev` chạy
  server + app (vite) ngay trên host; Docker chỉ để dựng DB + sidecar.
  Tika/Ollama/MQTT/bridge/nginx đều **tùy chọn** — thiếu chỉ tắt tính
  năng tương ứng (KB trích file / embedding local / IoT / claude-cli).
- **Đường ít ma sát nhất**: trỏ `DATABASE_URL` sang Postgres remote có
  sẵn pgvector (Neon/Supabase/server LAN). Template điền sẵn ở
  `packages/server/.env.no-docker.example` (mọi sidecar mặc định tắt).
  Setup: copy template → `.env`, **dán `DATABASE_URL` y hệt sang
  `packages/db/.env`** (drizzle migrate đọc file đó, KHÔNG đọc env của
  server) → `pnpm install` → `pnpm --filter @erp-framework/db migrate`
  → `pnpm --filter @erp-framework/server seed` → `pnpm dev`.
- **Tự dựng hạ tầng remote** (khi không có Neon/Supabase): deploy
  `docker/docker-compose.dev-infra.yaml` lên Coolify (hoặc bất kỳ host
  có Docker) — CHỈ hạ tầng (db pgvector + tika/ollama/mqtt tùy chọn),
  KHÔNG có server/app (máy dev tự chạy + tự migrate/seed). Khác
  `docker-compose.coolify.yaml` (deploy full app). ⚠ Mở Postgres ra
  Internet → BẮT BUỘC firewall allowlist theo IP + mật khẩu mạnh
  (Coolify `SERVICE_PASSWORD_64_DB`); tika/ollama không có auth sẵn.
- ⚠ **KHÔNG chạy `pnpm db:setup` / `pnpm dev:setup`** ở chế độ này:
  `dev:setup` check `docker --version` ngay đầu → in lỗi + `exit 1` SẠCH
  (chưa ghi gì). Nhưng `db:setup` KHÔNG có guard đó — nó GHI ĐÈ
  `packages/{db,server}/.env` (về `DATABASE_URL` docker) RỒI mới fail ở
  bước `docker compose up` → xoá mất `.env` no-Docker bạn vừa cấu hình.
  Xem `tooling/{dev-setup,setup-db}.mjs`.
- **pgvector bắt buộc**: migration 0007 chạy `CREATE EXTENSION vector` —
  DB remote phải có sẵn, nếu không migrate đỏ. `UPLOAD_DIR` đặt thư mục
  cục bộ (vd `./.uploads`), KHÔNG để `/data/uploads` (path volume Docker).
- Nếu chỉ vướng license Docker Desktop → Podman / Rancher Desktop /
  WSL2 Docker Engine chạy `docker/docker-compose.yml` y nguyên.

## 3. Convention bắt buộc

### Migration

- File SQL ở `packages/db/migrations/` đặt tên `NNNN_<name>.sql`.
- **Mỗi migration phải có entry trong `_journal.json`** — drizzle dùng
  `created_at` (timestamp `when`) chứ KHÔNG dùng hash để check
  "đã apply chưa". **TIMESTAMP `when` PHẢI UNIQUE TĂNG DẦN** — reuse
  timestamp → migration mới bị skip im lặng.
- Pattern idempotent: `CREATE TABLE IF NOT EXISTS` + `DO $$ ... EXCEPTION
  WHEN duplicate_object` cho FK / index — an toàn re-run khi DB drift.
- **KHÔNG đặt `*/` hoặc `/*` lồng nhau trong block comment** — Postgres
  parse nested comment → "unterminated /* comment". Đặc biệt khi
  comment có path như `/api/v1/*`, thay bằng `/api/v1/...`.

### Commit style

- Prefix theo domain: `entity:` (low-code), `db:` (schema), `sec:`,
  `perf:`, `ai:`, `ux:`, `a11y:`, `lint:`, `docs:`, `feat:`, `fix:`,
  `refactor:`. Body có thể đa dòng + giải thích lý do.
- Kết thúc: `Co-Authored-By: <Claude model identity>` nếu Claude góp.
- Tránh commit message tiếng Anh thuần — team Việt đọc.

### Server bootstrap (`packages/server/src/index.ts`)

- Thứ tự cứng: `runMigrations(db)` → register Fastify plugins/routes
  → `await bootstrapTools(app, db)` → `app.listen()`. KHÔNG gọi
  `bootstrapTools` 2 lần — sau `listen()` Fastify reject plugin mới
  với "Root plugin has already booted".
- Shutdown chain: `stopIotMqtt() → stopJobs() → shutdownTools() →
  process.exit(0)`.

### Frontend bootstrap

- `useLocation()` của TanStack: `loc.pathname` (string), `loc.searchStr`
  (string, có `?`), `loc.search` (**OBJECT**), `loc.href` (full).
  ⚠ `loc.pathname + loc.search` → throw "Cannot convert object to
  primitive value". Dùng `loc.href`.

## 4. RBAC + Security

**4-tier procedure chain** (`packages/server/src/trpc.ts`):

| Layer | Check | Khi nào dùng |
|---|---|---|
| `publicProcedure` | — | 4 endpoint auth + invite verify (rate-limit) |
| `protectedProcedure` | đăng nhập | White-list: auth.logout/me, companies.list/current/switch, notifications.unreadCount |
| `approvedProcedure` | + companyId + approved + !disabled | Endpoint user-personal không vào RBAC matrix (vd agents.get) |
| `rbacProcedure(action, obj)` | + role-can(action, obj) | **Mọi endpoint thao tác data** |
| `resourceProcedure(action, policy)` | + per-resource ACL | Endpoint thao tác resource cá nhân (agent share, page share) |

- Mặc định MỌI tRPC procedure thao tác data dùng `rbacProcedure` hoặc
  `resourceProcedure`. KHÔNG dùng `protectedProcedure` cho mutate data —
  nếu pending user gọi sẽ bypass approval gate.
- Matrix RBAC tại `packages/core/src/permissions.ts`. 3 Role × 8 Action ×
  18 ObjectType. Frontend re-export qua `src/lib/permissions.ts` —
  KHÔNG tự định nghĩa MATRIX song song.
- Per-resource ACL: bảng `resource_members` (P2.3) generic cho mọi loại
  resource. Policy thuộc về từng resource type (`agent-acl.ts`).
- Field-level RBAC: `fieldCan(role, action, field)` + `stripUnreadable/
  Unwritable Fields`. Áp dụng đồng nhất ở `records.create/update/
  bulkUpdate/bulkImport/export`, `procedures.invoke` (args), `workflow`
  step config (`requiresRole`).
- REST API key scopes (`api_keys.scopes`): **deny-by-default** (empty =
  không quyền gì). Dùng `"*"` cho full hoặc `entity:<name>:read|write`.
- Encryption: `crypto.ts` AES-256-GCM, prefix `enc:v1:`. `ENCRYPTION_KEY`
  bắt buộc ở production.
- LLM API key: lưu encrypted `llm_profiles.api_key_enc`. Fallback env
  var (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`) **chỉ kích hoạt** khi
  `ERP_ALLOW_ENV_LLM_KEY=1` — tránh leak tenant isolation.
- Tool proxy HMAC header: `TOOL_SIGNING_SECRET` ký `X-ERP-User-Id`,
  `X-ERP-Company-Id`, `X-ERP-Role` trước khi forward đến tool external.
  Pre-flight check `company_tools.enabled=true` (P4.2) — fail-closed.
- WebSocket subscribe: channel allowlist + scope check (`isChannelAllowed`
  trong `index.ts`). Cross-tenant channel reject silently. Patterns:
  `notifications:<userId>`, `record:<entity>:<companyId>`, `presence:<uuid>`.

## 5. Plugin vs Tool

| | Plugin | Tool |
|---|---|---|
| Vị trí | `packages/plugins/` in-process TS module | `D:\code\cowok\Tools\*` artifact riêng |
| Đăng ký | Compile-time `pluginRegistry.register(mod)` | Auto-scan TOOLS_DIR + manifest |
| Kind | field-type, workflow-node, page-widget, mcp-connector, llm-adapter | web-app, mcp-server, cli, plugin |
| Vòng đời | Sống cùng server | embedded / spawn / remote |

## 6. AI integration

- Helper chung: `packages/server/src/llm-json.ts` → `callLlmJson<T>(db,
  companyId, opts)` — gọi LLM 1 shot, parse JSON. Hỗ trợ Anthropic +
  OpenAI/Ollama. Tự lookup `llm_profiles` đầu tiên kind="chat" của công ty.
- Embedding: `embedTexts(db, companyId, texts)` ở `embeddings.ts`.
- Async enrich: queue `feedback-ai` (pg-boss) — pattern: insert record
  → fire-and-forget enqueue → worker lazy fill embedding + summary +
  tags. AI fail KHÔNG được vỡ data — luôn fail-safe trả `null` →
  caller handle.

## 7. UI patterns

- UI primitives ở `src/components/ui/`: Button, Card, Chip, Modal, Drawer,
  Tabs, Switch, Input, Select, Textarea, FormField, EmptyState, …
- **Modal + Drawer** dùng hook `useFocusTrap` từ `src/hooks/useFocusTrap.ts`
  cho Esc + Tab loop + return focus. Tự cài, không thêm dep.
- Icon: `src/components/Icons.tsx` xuất `I.{name}`. Khi cần icon mới,
  thêm vào file này thay vì import lucide rời (giữ bundle nhỏ).
- Form: `react-hook-form` + zod resolver.
- Toast/dialog: `src/lib/dialog.ts` `dialog.confirm`, `dialog.prompt`,
  `dialog.alert`.

### Màu sáng/tối — QUY TẮC BẮT BUỘC

- **Mọi màu UI PHẢI đi qua token semantic**, không hardcode màu palette.
  Token khai báo ở `src/styles/index.css`: `:root` = **dark (mặc định)**,
  `:root.light` ghi đè cho sáng. `useApplyTheme` gắn cả `.dark` lẫn
  `.light` lên `<html>`.
- Token dùng được (Tailwind class + biến CSS): nền `bg-bg / bg-bg-soft /
  bg-panel / bg-panel-2 / bg-hover`, chữ `text-text / text-muted`, viền
  `border-border`, nhấn `accent / accent-2`, trạng thái `success /
  warning / danger`. Cần opacity → `hsl(var(--accent)/0.15)` hoặc
  `bg-accent/15`. Class dựng sẵn: `.btn-*`, `.input`, `.chip-*`, `.card`,
  `.panel`, `.sidebar-item`.
- **CẤM** cho màu ngữ nghĩa (chữ/nền/viền/icon trạng thái, màu loại đối
  tượng): màu palette Tailwind cố định (`text-amber-500`, `bg-white`,
  `text-gray-700`, `text-sky-400`…) và `#hex`/`text-[#…]` inline. Chúng
  KHÔNG đổi theo theme → ở nền sáng bị chìm/nhạt, nền tối bị chói. Đây là
  lỗi "màu chưa chuẩn sáng tối" hay gặp. Map loại đối tượng dùng token:
  vd entity/datasource→`accent`, page→`accent-2`, workflow→`warning`,
  agent/group→`success`/`warning` — KHÔNG `*-500`.
- `dark:` variant CÓ hoạt động (vì `.dark` được gắn) nhưng **ưu tiên
  token** để khỏi nuôi 2 nhánh màu; chỉ dùng `dark:` khi token không diễn
  đạt nổi.
- **Ngoại lệ hợp lệ** (màu là *dữ liệu*, không phải chrome): bảng màu chart
  `renderer/Chart.tsx`, swatch chọn accent `TweaksPanel.tsx`, preset màu
  nhóm `settings.viewer-groups.tsx`, màn lỗi tách-theme `ErrorBoundary.tsx`.
  Ngoài các chỗ này, thấy `#hex`/`*-500` cho màu UI là cần sửa về token.

## 8. Cấu trúc test

- Unit: `*.test.ts` cạnh source. Chạy `pnpm test` (vitest).
- E2E smoke: `e2e/smoke/*.spec.ts` — app-only, không DB. `pnpm e2e`.
- E2E fullstack: `e2e/fullstack/*.spec.ts` — cần DB + server.
  `pnpm e2e:full` tự migrate + seed + bring up.

## 9. Lint hiện trạng

- Biome **2.4.15** config `biome.json`. `pnpm lint` = `biome check src`.
- **CI HARD-ENFORCE 0 error** (job `check` → step "Lint (Biome, hard-fail)").
  Error-level phải = 0 mới merge; **warning KHÔNG chặn** (vd
  `noNonNullAssertion`, `suppressions/unused`). Một số a11y rule đã disable
  ở `biome.json` cho intentional UI pattern.
- **Mục này từng nói "467 issues, không enforce" — ĐÃ LỖI THỜI.** Lint
  được hard-fail từ CI commit (May 26). Khi thêm code mới, chạy `pnpm lint`
  trước khi push; safe-autofix bằng `npx biome check src --write` (KHÔNG
  `--unsafe` mặc định — unsafe đụng hook deps gây đổi hành vi).
- **Biome KHÔNG đọc `// eslint-disable-line` cũ** — phải dùng
  `// biome-ignore lint/<group>/<rule>: <lý do>` đặt NGAY TRÊN dòng vi phạm
  (với rule cấp-element a11y: trên dòng thẻ mở JSX, không phải dòng attribute;
  với `key={...}`/`useEffect`: trên đúng dòng đó). Comment sai vị trí →
  `suppressions/unused` (warning) mà rule gốc vẫn nổ.
- `useExhaustiveDependencies`: KHÔNG sửa bằng cách thêm/bớt deps (nguy cơ
  loop re-render) — suppress có lý do nếu deps cố ý không đầy đủ.

## 10. Audit baseline

Xem `docs/PROJECT-AUDIT-2026-05-25.md` cho:
- Findings P0/P1/P2 + remediation roadmap
- Metrics baseline (LOC, deps, bundle, coverage)
- Strengths đã xác nhận

---

## Bài học từ session trước (đừng lặp lại)

1. **Migration timestamp collision** — Drizzle dùng `created_at` để check
   "đã apply", reuse timestamp = skip im lặng. Backfill phải gán
   timestamp > max hiện tại.
2. **`bootstrapTools` chỉ gọi 1 lần TRƯỚC `app.listen()`** — Fastify
   plugin register sau listen sẽ throw "Root plugin has already booted".
3. **TanStack `loc.search` là object** — đừng concat string. Dùng `loc.href`.
4. **SQL comment chứa `/*` lồng (vd `/api/v1/*`)** → Postgres parse nested,
   throw "unterminated /* comment". Thay bằng `...` hoặc tách comment.
5. **AI fail-safe** — embedding/LLM lỗi không vỡ submit. `callLlmJson`
   trả null, caller handle nhánh thiếu.
6. **`pnpm overrides` để vá CVE transitive** — vd ép `esbuild ^0.25.0`,
   `vite ^6.4.2`. **CHÚ Ý pnpm 11**: khai báo ở `pnpm-workspace.yaml`
   (`overrides:`), KHÔNG chỉ ở `package.json#pnpm` — pnpm 11 bỏ qua field
   đó (xem bài học #19). Giữ bản sao package.json cho pnpm 10 local.
7. **Drizzle 0.36 → 0.45.2 không phá API** — 9 minor nhưng schema/query
   builder/migrator giữ nguyên. An toàn bump nếu tests pass.
8. **Bundle 1.6MB main → 490KB qua `manualChunks`** vite — tách
   react-vendor/router/query/designer/viz/icons. Viz vẫn 577KB nhưng
   lazy load theo route nên LCP không impact main.
9. **Cột PG `date` PHẢI khai báo Drizzle là `date(...)`, KHÔNG `timestamp`**
   — `timestamp` parser làm `new Date(value + "+0000")`; chuỗi date-only
   "2026-05-01" → `new Date("2026-05-01+0000")` = **Invalid Date** →
   `.toISOString()` throw **"Invalid time value"** lúc đọc. Cột `date`
   round-trip qua UTC (mapToDriverValue = `toISOString`), nên dựng/đọc
   ngày bằng `Date.UTC` + `getUTC*` để khỏi lệch ±1 ngày ở server tz≠0.

### Bài học từ audit Migrate (2026-06-02)

10. **Resume PHẢI đọc/ghi cùng file state.** enrich non-apply ghi progress
    (`enrichedAt`) vào `<module>.enriched.yaml` nhưng `readManifest` đọc
    `.yaml` gốc → `skipEnriched` không skip gì → enrich lại từ đầu, đốt
    token. Khi state lưu ở file phụ, resume phải đọc đúng file phụ đó
    (`readManifestFrom`).
11. **Đừng overload status `failed` cho cả lỗi vĩnh viễn + lỗi tạm.**
    Full-import dùng `failed` cho cả bảng no-PK (vĩnh viễn) lẫn lỗi mạng
    (tạm); resume query loại `failed` → bảng lỗi tạm KẸT mãi. Tách
    `skipped` (vĩnh viễn: không retry, KHÔNG chặn job hoàn thành) vs
    `failed` (tạm: retry từ checkpoint). Cột `status` là `text` thường
    nên thêm giá trị mới KHÔNG cần migration đổi enum.
12. **Cost/token cap phải PERSIST mới là trần thật.** enrich tính token từ
    0 mỗi run → `--max-cost-usd` reset mỗi resume → job stop/resume N lần
    tiêu 5 USD × N. Lưu token tích lũy vào DB (`migration_jobs.tokens_in/
    out`), nạp làm baseline khi resume, cap theo `base + run này`.
13. **Streaming theo PK: bắt buộc PK tiến + checkpoint atomic với data.**
    (a) `nextLastPk == null` (hoặc không đổi) mà batch đầy → `WHERE pk >
    null` bỏ mệnh đề → đọc LẠI từ đầu → loop vô hạn; phải abort. (b) Bọc
    insert/update + ghi `lastPk`/`rowsImported` trong 1 `db.transaction`
    — crash giữa 2 bước → resume re-đọc batch → over-count.
14. **Boot auto-resume CHỈ `running`/`queued`, KHÔNG `paused`.** `paused`
    là user chủ động dừng hoặc partial-fail cần user quyết; auto-resume
    mỗi lần boot = chạy import ngoài ý muốn lặp lại.
15. **Path/prefix guard PHẢI dùng `+ sep` + realpath.** `abs.startsWith(
    dir)` khiến `module-x-evil` khớp prefix `module-x`. Dùng `real ===
    base || real.startsWith(base + sep)` + `realpathSync` chống symlink
    escape (đã đúng ở ai-log/codegen, nhưng dễ quên ở code mới).
16. **Guard Bash cho agent: exact-match, KHÔNG `startsWith(prefix)`.**
    `cmd.startsWith("pnpm typecheck")` cho `pnpm typecheck; rm -rf` lọt.
    Yêu cầu `cmd === prefix` hoặc `prefix + " "` + chặn shell-meta
    (`; & | \` $ > < \n`).
17. **MỌI lookup-by-id phải scope `companyId` — kể cả polling/in-memory.**
    `getMigrationJobStatus(jobId)` thiếu companyId → biết UUID là đọc chéo
    tenant (status/message/error). Áp cho cả endpoint poll lẫn cache
    in-memory (lưu `companyId` trong JobState để verify).
18. **React polling effect: state phải sống xuyên re-run + không side-
    effect trong updater.** `prevStatus` là biến local trong effect +
    `reloadKey` trong deps → mỗi reload teardown effect → reset lịch sử →
    job thứ 2+ xong không detect. Dùng `useRef`. Và đừng gọi `fetch()`
    trong `setState(prev => ...)` (StrictMode chạy 2× = gấp đôi request)
    — đọc cờ active từ ref.

### Bài học từ session CI/lint (2026-06-03)

19. **pnpm 11 (CI) KHÔNG đọc settings từ `.npmrc` lẫn `package.json#pnpm`**
    — đã dời "settings home" sang `pnpm-workspace.yaml`. Triệu chứng: step
    "Cài dependency" (`pnpm install --ignore-scripts`) exit 1 trên runner
    NHƯNG pnpm 10 local pass. Ba setting bắt buộc ở `pnpm-workspace.yaml`:
    (a) `onlyBuiltDependencies`; (b) `minimumReleaseAge` (+ `…Exclude`) —
    `.npmrc minimum-release-age=0` bị bỏ qua → default ~24h chặn dep vừa
    publish (`ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION`); (c) `overrides` —
    `package.json#pnpm.overrides` bị bỏ qua → frozen install báo
    `ERR_PNPM_LOCKFILE_CONFIG_MISMATCH`. Tái hiện local: `CI=true npx
    pnpm@11 install --frozen-lockfile --ignore-scripts
    --config.confirmModulesPurge=false`.
20. **Update `entities.meta` PHẢI merge jsonb, KHÔNG ghi đè object.**
    `.set({ meta: { source: {...} } })` thay cả meta → xoá mất `meta.storage`
    (marker bảng thật HYBRID) → reads rơi về EAV rỗng, bảng thật mồ côi.
    Dùng `meta: sql\`coalesce(meta,'{}') || ${json}::jsonb\`` (đã dính 2 lần:
    full-import + re-migrate). Tương tự: mọi thao tác data theo entity phải
    route theo `meta.storage.tier` (bảng thật vs EAV), kể cả delete/count.

21. **CI hard-fail Biome 0 error** (xem mục 9). `// eslint-disable-line` cũ
    KHÔNG có tác dụng với Biome — chuyển sang `// biome-ignore lint/<group>/
    <rule>: <lý do>` đúng vị trí (cấp-element a11y: dòng trên thẻ mở JSX).
    `useExhaustiveDependencies`: suppress, ĐỪNG thêm/bớt deps (loop re-render).
    `noNonNullAssertion` là warning — không chặn.
