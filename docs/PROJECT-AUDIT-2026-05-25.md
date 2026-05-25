# Project Audit — ERP Framework

**Ngày**: 2026-05-25
**Phạm vi**: toàn dự án sau ~22 sprint (S6→S22) + tool system + feedback + AI generator
**Phương pháp**: 3 góc nhìn song song (backend, frontend, ops/DX) qua subagent + spot-check manual

---

## 1. Architecture snapshot

### Backend (`packages/server` + `packages/db` + `packages/core`)

| | Số liệu |
|---|---|
| tRPC routers | 14 chính, ~200+ endpoint (tính sub-router) |
| REST endpoints | `/api/v1/entities/:name/*` (X-API-Key + scope) |
| GraphQL | `/graphql` schema tự sinh per entity (Yoga), cache 60s |
| WebSocket | `/ws` realtime pub/sub qua `ws-hub.ts` |
| MQTT | IoT telemetry qua `iot-mqtt.ts` |
| OAuth 2.0 | `/oauth/token` + PKCE auth codes |
| DB tables | 53 (sau migration backfill 0013-0029) |
| Migrations | 40 SQL files, journal đã sync |
| Background jobs | pg-boss, 8 queue (workflow-run, kb-ingest, feedback-ai, …) |

**Mã hoá + bảo mật**:
- `crypto.ts`: AES-256-GCM, prefix `enc:v1:`
- `ENCRYPTION_KEY` bắt buộc ở production (throw nếu thiếu)
- RBAC: 68 procedure dùng `rbacProcedure("action","resource")`; chỉ 4 endpoint public (register/login/invitePreview/acceptInvite), tất cả rate-limited 5/15min

### Frontend (root `src/`)

| | Số liệu |
|---|---|
| Routes (TanStack file-based) | 35 file `.tsx` |
| Components | 50 file (16 UI primitives + 6 designer + 4 renderer + …) |
| Zustand stores | 8 (auth, ui, settings, entities, rbac, locale, userObjects, dialog) |
| i18n dictionaries | 1 (`dict-chrome.ts`, ~145 dòng) |
| Bundle output | **1.6 MB / 462 KB gzip** — vượt cảnh báo 500KB |
| LLM adapters | API key, Claude Pro OAuth, Claude CLI Bridge, Ollama |

### Ops + DX

| | Số liệu |
|---|---|
| Docker services | 8 (db, tika, server, app, bridge, ollama, ollama-pull, mosquitto) |
| CI workflows | `.github/workflows/ci.yml` — typecheck + vitest + e2e (smoke + fullstack) |
| Unit tests | 9 (`packages/core` 2, `packages/server` 5, `src/lib` 2) |
| E2E specs | 12 file (`e2e/fullstack/*` 11 + `e2e/smoke/*` 1) |
| Documentation | 10 file `docs/*.md` |
| Node.js | 22 (CI), pnpm 11 workspace |
| Linter | Biome 1.9.4 |

---

## 2. Findings theo mức nghiêm trọng

### 🔴 P0 — Critical (phải fix ngay)

| # | Vấn đề | File | Tác động |
|---|---|---|---|
| P0.1 | **CVE-GHSA-gpj5-g38j-94v9** — `drizzle-orm@0.36.4` SQL injection qua escaped identifiers. Phải bump ≥**0.45.2**. | `packages/{db,server}/package.json` | Attacker có thể inject SQL nếu identifier (column/table name) đến từ user input — hiện không có nhưng tránh blast radius. |
| P0.2 | `llm-client.ts` TODO: decrypt **fallback về plaintext env var** → API key Claude/OpenAI có thể bị log/leak qua heap dump. | `packages/server/src/llm-client.ts` | Vi phạm "secrets at rest". Nếu env file lộ → leak full API key. |
| P0.3 | `vite@6.4.2` CVE path traversal (moderate) + `esbuild ≤0.24.2` dev server CSRF (moderate). | `package.json` root | Chỉ ảnh hưởng dev server, không production — nhưng nên patch để tránh blast vào CI runner. |

### 🟠 P1 — Production readiness (fix trong tuần)

| # | Vấn đề | File |
|---|---|---|
| P1.1 | **Modal + Drawer không focus trap** — user Tab thoát modal, accessibility fail (WCAG 2.4.3). | `src/components/ui/modal.tsx`, `drawer.tsx` |
| P1.2 | Bundle **1.6MB / 462KB gzip** — không có `manualChunks`; LCP/FCP > 2s trên mạng 3G. | `vite.config.ts` |
| P1.3 | Command Palette **thiếu 4 entry** (/tools, /feedback, /procedures, /enums). Sidebar có nhưng Cmd+K không. | `src/components/CommandPalette.tsx` |
| P1.4 | **5 file còn `console.log/error`** sót: `stores/userObjects.ts`, `routes/procedures.$id.tsx`, `components/renderer/AutoForm.tsx`, `components/designer/WorkflowDesigner.tsx`, `components/ErrorBoundary.tsx`. | listed |
| P1.5 | **CI thiếu lint check** — `pnpm lint` không có trong workflow; Biome config tồn tại nhưng không enforce pre-merge. | `.github/workflows/ci.yml` |
| P1.6 | **Chưa có `CLAUDE.md`** root — mỗi session Claude Code phải re-discover convention (migration timestamp unique, bootstrap order, loc.search là object…). | `CLAUDE.md` (mới) |

### 🟡 P2 — Tech debt (kế hoạch sprint tới)

- **`router.ts` 2289 dòng** — monolith API surface; cần tách thành sub-router theo domain (entity/record/agent/…).
- **`EntityDesigner.tsx` 868 dòng (39KB)** — gộp layout + fields + MCP + formula + AI; lazy-load tabs.
- **Major dep bumps lùi**: Vite 6→8, Vitest 2→4, Zod 3→4, Tailwind 3→4, Biome 1→2, TypeScript 5.9→6 — làm từng cái, không gộp.
- **Test coverage <10%**: chỉ test auth + chunk + code-runner + validate + permissions + format + normalize + procedure-runner. Bulk ops (1000 records), cascade delete, approval workflow chưa test.
- **pgvector thiếu IVFFlat index explicit** — `entity_record_embeddings.embedding` chỉ có schema column, không có index → semantic search linear scan khi vượt 5k row.
- **pg-boss workflow worker không timeout** — risk loop vô hạn trong subworkflow recursive → starve 5 worker pool.
- **WS pub/sub + GraphQL cache single-process** — không scale ngang (Kubernetes/PM2 cluster) trừ khi thêm Redis.
- **6 file UI dùng `as any`/`as unknown as`**: `settings.backup.tsx`, `iot.$id.tsx`, `iot.tsx`, `EntityData.tsx`, `agent-runner.ts`, `mcp.ts` — narrow types từng cái.
- **`router.ts`-level audit log**: activity_log có UPDATE/DELETE quyền (admin ẩn vết); `audit_log_immutable` đã có (trigger raise) nhưng chưa dùng cho mọi route nhạy cảm.

---

## 3. Strengths

- **RBAC mạnh + nhất quán**: 68/72 procedure được wrap `rbacProcedure`, field-level RBAC qua `stripUnreadableFields`/`stripUnwritableFields`.
- **Encryption layer chuẩn**: AES-256-GCM, key prefix `enc:v1:` để versioning sau này.
- **Multi-tenant sạch**: mọi bảng dữ liệu có `company_id` FK + cascade; session lưu `active_company_id` cho phép user switch công ty.
- **Type-safety end-to-end**: tRPC + Drizzle infer cho cả client; chỉ 1 `as any` ở server (acceptable trong code dynamic).
- **Plugin + Tool 2-lớp**: plugin in-process (compile-time), tool ngoài monorepo (runtime discover) — không lẫn.
- **AI integration đẹp**: feedback enrichment + enum/procedure generator chia sẻ helper `callLlmJson` chung, hỗ trợ Anthropic + OpenAI/Ollama.
- **Migration idempotent**: tất cả SQL dùng `IF NOT EXISTS` + `DO $$ EXCEPTION` — an toàn re-run.
- **CI nhiều tầng**: typecheck + unit + e2e smoke + e2e fullstack (với DB thật).

---

## 4. Remediation roadmap

### Phase 1 — Tuần này (P0, ~2-4h công)

| Bước | Effort | Risk | Verify |
|---|---|---|---|
| Bump Drizzle 0.36 → ≥0.45.2 | 1-2h | Trung bình (9 minor, có thể đổi import path) | `pnpm -r typecheck && pnpm --filter @erp-framework/db migrate` |
| Bump Vite 6.4.2 → 6.x patch hoặc 7+ | 30m | Thấp nếu giữ 6.x; cao nếu 7+ (TanStack plugin) | `pnpm build` + Lighthouse |
| Fix `llm-client.ts` plaintext fallback | 15m | Thấp | Test gọi `/agent/chat` với profile encrypted vs missing |

### Phase 2 — Tuần này (P1, ~4-6h công)

| Bước | Effort | Verify |
|---|---|---|
| `CLAUDE.md` root | 30m | Đọc lại đảm bảo cover migration discipline + commit style |
| Command Palette 4 entries | 15m | Cmd+K → tìm "Phản hồi" → click → mở /feedback |
| Focus trap Modal + Drawer | 1h | Tab/Shift+Tab loop trong modal, Esc return focus về trigger |
| Vite `manualChunks` | 1h | `pnpm build` log: main chunk <500KB |
| Remove console.log sót + biome rule | 30m | `pnpm lint` không warn console |
| CI lint step | 15m | Push → workflow chạy + lint job pass |

### Phase 3 — Sprint sau (P2, ~3-5 ngày công)

| Bước | Effort | Note |
|---|---|---|
| Split `router.ts` → sub-routers theo domain | 1-2 ngày | Cần test e2e full đảm bảo signature giữ nguyên |
| Lazy-load `EntityDesigner` tabs | 4h | Inspector/Layout/Formula tabs riêng |
| Major dep bumps từng bước | 2 ngày | Vite, Vitest, Zod, Tailwind — mỗi bump 1 commit |
| Tests coverage 10% → 40% | 2-3 ngày | Focus router CRUD/RBAC + bulk ops |
| pgvector IVFFlat migration | 30m | Khi `entity_record_embeddings` > 5k row |
| Workflow worker timeout | 1h | Wrap `executeWorkflow` trong AbortController 5-min timeout |
| Redis cho WS + GraphQL cache | 1 ngày | Nếu cần scale ngang |

---

## 5. Metrics baseline (chốt cho lần audit kế tiếp)

| | Hiện tại (2026-05-25) | Mục tiêu sau Phase 1+2 | Mục tiêu Phase 3 |
|---|---|---|---|
| Drizzle | 0.36.4 (vulnerable) | ≥0.45.2 | latest |
| Vite | 6.4.2 (CVE) | ≥6.4.2-fix hoặc 7+ | latest |
| Bundle main chunk | 1.6MB / 462KB gz | <500KB main + 4-5 chunk vendor | <300KB main |
| router.ts LOC | 2289 | giữ | <500 mỗi sub-router (target ~6 router) |
| Test files | 9 unit + 12 e2e | giữ | 25 unit + 20 e2e |
| Coverage est. | <10% | <10% | ≥40% |
| Console.log sót | 5 file | 0 | 0 + biome enforce |
| pnpm audit | 1 HIGH + 2 MOD | 0 HIGH 0 MOD | 0 HIGH 0 MOD |
| Command Palette entries | 8 | 12 | thêm Quick Action |
| Modal a11y (focus trap) | ❌ | ✅ | ✅ + screen reader test |
| CLAUDE.md | ❌ | ✅ | ✅ kèm decision log |

---

## 6. Bài học từ session vừa qua (đáng ghi vào CLAUDE.md)

1. **Migration timestamps phải unique tăng dần** — Drizzle dùng `created_at` (không phải hash) để check "đã apply chưa". Reuse timestamp = migration sau bị skip im lặng.
2. **Pre-existing journal gap nguy hiểm** — 17 SQL file 0013-0029 commit không kèm journal entry → fresh DB thiếu bảng → lỗi runtime khó debug. Đã backfill + script `tooling/ascii-migrations.mjs` để chuẩn hoá comment.
3. **`bootstrapTools` chỉ gọi 1 lần TRƯỚC `app.listen()`** — `@fastify/http-proxy` không register được sau khi Fastify đã boot → "Root plugin has already booted".
4. **TanStack `useLocation().search` là OBJECT**, không phải string. `loc.pathname + loc.search` throw "Cannot convert object to primitive value". Dùng `loc.href`.
5. **SQL comment `/api/v1/*`** bên trong block comment làm Postgres parse nested → "unterminated /* comment". Tránh `*` trong path khi viết comment SQL.
6. **AI enrichment phải fail-safe** — embedding/LLM lỗi không được vỡ submit. `callLlmJson` trả `null` khi sai, caller phải handle.

---

## Phụ lục — Audit phương pháp

- 3 subagent Explore chạy song song: backend (server/db/security), frontend (UI/state/UX), ops/DX (CI/docs/deps).
- Manual verify: `wc -l` cho file lớn, `find -name "*.test.ts"`, `pnpm audit`, `pnpm outdated`.
- Reference: `pnpm-lock.yaml`, `package.json`, `biome.json`, `vite.config.ts`, `.github/workflows/ci.yml`.
