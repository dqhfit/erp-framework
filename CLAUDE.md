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

## 8. Cấu trúc test

- Unit: `*.test.ts` cạnh source. Chạy `pnpm test` (vitest).
- E2E smoke: `e2e/smoke/*.spec.ts` — app-only, không DB. `pnpm e2e`.
- E2E fullstack: `e2e/fullstack/*.spec.ts` — cần DB + server.
  `pnpm e2e:full` tự migrate + seed + bring up.

## 9. Lint hiện trạng

- Biome 1.9.4 config `biome.json`. Recommended rules + noConsole
  (allow error/warn) + useImportType warn.
- **`pnpm lint` hiện báo ~467 pre-existing issues** chủ yếu
  `lint/a11y/useButtonType` và `lint/style/useTemplate`, đa số FIXABLE.
  Cleanup chưa làm → KHÔNG enforce trong CI. Sprint cleanup riêng:
  chạy `npx biome check src --fix --unsafe` rồi review từng nhóm.

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
   `vite ^6.4.2` qua root `package.json#pnpm.overrides` thay vì major
   bump vitest.
7. **Drizzle 0.36 → 0.45.2 không phá API** — 9 minor nhưng schema/query
   builder/migrator giữ nguyên. An toàn bump nếu tests pass.
8. **Bundle 1.6MB main → 490KB qua `manualChunks`** vite — tách
   react-vendor/router/query/designer/viz/icons. Viz vẫn 577KB nhưng
   lazy load theo route nên LCP không impact main.
