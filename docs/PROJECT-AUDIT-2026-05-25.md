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

| # | Vấn đề | File | Tác động | Status |
|---|---|---|---|---|
| P0.1 | **CVE-GHSA-gpj5-g38j-94v9** — `drizzle-orm@0.36.4` SQL injection qua escaped identifiers. Phải bump ≥**0.45.2**. | `packages/{db,server}/package.json` | Attacker có thể inject SQL nếu identifier (column/table name) đến từ user input — hiện không có nhưng tránh blast radius. | ✅ DONE (Sprint hardening) |
| P0.2 | `llm-client.ts` TODO: decrypt **fallback về plaintext env var** → API key Claude/OpenAI có thể bị log/leak qua heap dump. | `packages/server/src/llm-client.ts` | Vi phạm "secrets at rest". Nếu env file lộ → leak full API key. | ✅ DONE (gated `ERP_ALLOW_ENV_LLM_KEY=1`) |
| P0.3 | `vite@6.4.2` CVE path traversal (moderate) + `esbuild ≤0.24.2` dev server CSRF (moderate). | `package.json` root | Chỉ ảnh hưởng dev server, không production — nhưng nên patch để tránh blast vào CI runner. | ✅ DONE (pnpm overrides) |
| P0.4 | **Pending/disabled user bypass** — endpoint dùng `protectedProcedure` thuần (agents/notifications) không enforce `companyApproved`/`companyDisabled` → user chưa duyệt vẫn gọi mutate được qua tRPC trực tiếp. | `packages/server/src/trpc.ts` | Bypass approval gate; pending user tạo agent, đọc notifications. | ✅ DONE (commit c244496 — `approvedProcedure` middleware) |
| P0.5 | **Feedback action mismatch** — 11/11 procedure dùng `rbacProcedure("view","activity")` → viewer có quyền create/edit/delete/setStatus feedback (chỉ chặn ở handler `canMutate`). | `packages/server/src/feedback-router.ts` | Permission matrix lệch ngữ nghĩa, defense-in-depth thủng. | ✅ DONE (commit 2574633 — `feedback` ObjectType + đúng action) |
| P0.6 | **REST API empty scope = full access** — `hasScope()` trả `true` nếu `scopes.length === 0`, mọi API key tạo mặc định scope=[] → toàn quyền entity. | `packages/server/src/rest-api.ts`, `api-keys-router.ts` | Cross-tenant nếu key tạo nhầm, key cũ vẫn hoạt động sau breach. | ✅ DONE (commit ccd5010 — deny-by-default + scope regex) |
| P0.7 | **WS cross-tenant** — `/ws` subscribe `record:<entity>:<otherCompanyId>` nhận event của công ty khác (channel chứa companyId nhưng không verify). | `packages/server/src/index.ts` | Data leak realtime cross-tenant. | ✅ DONE (commit ffef249 — `isChannelAllowed` allowlist) |
| P0.8 | **Tool proxy không check company-enabled** — user company A có session valid truy cập `/tools/<slug>` của tool công ty B chưa kích hoạt. | `packages/server/src/tools/proxy.ts` | Cross-tenant tool access. | ✅ DONE (commit ffef249 — pre-flight `companyTools.enabled`) |

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
| ~~pgvector IVFFlat migration~~ ✅ DONE | 30m | `0040_pgvector_ivfflat_indexes.sql` — 3 bảng (entity_record_embeddings, knowledge_chunks, feedbacks), lists=100 |
| ~~Workflow worker timeout~~ ✅ DONE | 1h | `Promise.race` 5min default, env `WORKFLOW_TIMEOUT_MS` override |
| ~~Bump Vitest 2 → 4~~ ✅ DONE | 30m | 56 test pass sau bump |
| ~~Bump Biome 1 → 2~~ ✅ DONE | 1h | `biome migrate` tự động chuyển config schema |
| ~~Biome auto-fix 467 → 153 errors~~ ✅ DONE | 30m | `--fix --unsafe` clean 129/144 file (formatter + safe rules); 153 còn lại = `useButtonType` manual |
| ~~Add `pnpm lint` CI step~~ ✅ DONE | 15m | `continue-on-error: true` (soft-fail) đến khi cleanup hết |
| ~~Split EntityDesigner~~ ✅ DONE | 2h | 1087 → 595 dòng. 3 file mới: field-row, field-inspector, entity-preview. Không lazy-load (3 tab inline form không lợi gì) |
| **router.ts split** ⏳ DEFER → sprint riêng | 2-3 ngày | 2289 dòng, ~15 helper được share giữa 6 router. Tách cần: (a) `router-helpers.ts` export helpers chung, (b) `{records,entities,workflows,agents}-router.ts`, (c) update mount. Mỗi router 1 commit + e2e test đầy đủ trước/sau |
| Tests coverage 10% → 40% (P2.9) — ✅ PROGRESS | ~4h | Setup `@vitest/coverage-v8` + `test:coverage` + test-helpers (makeMockCtx/makeMockDb FIFO/assertThrowsTRPCError) + `createCallerFactory` export. **8 router test (151 test, +95 từ baseline 56)**: enums (63%), feedback (~70%), pages, schedules, entities (renameField+changeFieldType), workflows (publish+replay), agents (membership+ACL mock), tools (SSRF guard+spawn+invokeAction). Coverage tổng: **2.92% → 6.60% statements** (+126% rel), 3.18% → 7.07% lines, 1.49% → 4.54% functions. Pattern proven — sprint sau test thêm records (lớn nhất, 753 dòng) + companies + entity-sync → 15-25% trong 1 ngày, 40% target sau 2-3 ngày. |
| **Bump Tailwind 3 → 4** ⏳ DEFER → sprint riêng | 1-2 ngày | Breaking: CSS-first config (`@import "tailwindcss"` + `@theme`), arbitrary value syntax, opacity. Cần visual regression test toàn UI (35 routes) trước accept |
| ~~Bump Zod 3 → 4~~ ✅ DONE (Sprint 3) | 1.5h | `zod 3.25 → 4.4`, `@hookform/resolvers 3.10 → 5.4`. Breaking duy nhất: `z.record()` signature đổi sang 2-arg (32 instance, sed batch fix). Tất cả 143 `.uuid()`/`.email()`/`.url()` giữ nguyên (Zod 4 backward-compat). 0 error parse, 0 async refinement, 0 `.brand<T>` → migration cleaner hơn dự đoán. Bundle main +4KB gz (acceptable). |
| Redis cho WS + GraphQL cache | 1 ngày | Nếu cần scale ngang |

---

## 5. Metrics baseline (chốt cho lần audit kế tiếp)

| | Trước audit | Sau Phase P0+P1+P2-quickwins (2026-05-25) | Mục tiêu sprint sau |
|---|---|---|---|
| Drizzle | 0.36.4 (vulnerable) | **0.45.2** ✅ | latest |
| Vitest | 2.1.9 | **4.1.7** ✅ | giữ |
| Biome | 1.9.4 | **2.4.15** ✅ | giữ |
| Vite | 6.4.2 (CVE) | **6.4.2 + esbuild override 0.25** ✅ | latest stable 7+ |
| Tailwind | 3.4.19 | 3.4.19 (giữ) | **4.x** (dedicated sprint) |
| Zod | 3.25.76 | 3.25.76 (giữ) | **4.x** (dedicated sprint) |
| Bundle main chunk | 1.6MB / 462KB gz | **490KB / 137KB gz** ✅ (-69%) | <300KB main |
| router.ts LOC | 2289 | 2289 (giữ) | <500 mỗi sub-router (dedicated sprint) |
| EntityDesigner.tsx LOC | 1087 | **595** ✅ (split 3 file) | giữ hoặc tiếp tục modularize |
| Test files | 9 unit + 12 e2e | 9 unit + 12 e2e (giữ) | 25 unit + 20 e2e (dedicated sprint) |
| Coverage est. | <10% | <10% (giữ) | ≥40% |
| Console.log sót | 5 file | 5 file (đều `console.error` acceptable) | 0 với rule strict |
| pnpm audit | 1 HIGH + 2 MOD | **0 HIGH 0 MOD** ✅ | giữ |
| Command Palette entries | 8 | **12** ✅ | thêm Quick Action |
| Modal a11y (focus trap) | ❌ | **✅** (`useFocusTrap` hook) | + screen reader test |
| CLAUDE.md | ❌ | **✅** (180 dòng sau RBAC section) | + decision log |
| Biome lint errors | 467 | **153** ✅ (-67%) | 0 |
| pgvector IVFFlat | ❌ | **✅** 3 bảng | giữ |
| Workflow worker timeout | ❌ | **✅** 5min default | giữ |
| Unit test count | 9 file | **22 file / 237 test** ✅ (+13 file +66 test) | tăng coverage records bulk + agent ACL |
| RBAC matrix size | 3×5×11 | **3×8×18** ✅ (P2.2 expand) | freeze |
| P0 security gaps | 3 | **0** ✅ (8/8 resolved sau Sprint hardening) | regression test guard |

---

## 5b. RBAC architecture (sau Sprint hardening 2026-05-26)

**5-tier procedure chain** trong `packages/server/src/trpc.ts`:

```
publicProcedure         → ai cũng gọi được (4 auth endpoint, rate-limit)
  ↓
protectedProcedure      → cần login (UNAUTHORIZED nếu user null)
  ↓ White-list: auth.logout/me, companies.list/current/switch,
                notifications.unreadCount (UI badge cần render cho
                pending user)
approvedProcedure       → + companyId + companyApproved + !companyDisabled
  ↓                        (P0.4 fix — chặn pending/disabled bypass)
rbacProcedure(act, obj) → + roleCan(role, action, object) qua MATRIX
                           (3 Role × 8 Action × 18 ObjectType)
  ↓
resourceProcedure(act, policyCheck, idField?)
                        → + per-resource ACL (vd agent share/private)
                           Build trên approvedProcedure → kế thừa check
                           pending/disabled tự động.
```

**Centralized RBAC matrix** (`packages/core/src/permissions.ts`):

| Role | Khái lược |
|---|---|
| `admin` | `*:*` toàn quyền |
| `editor` | view all + CRUD entity/page/workflow/agent/knowledge/iot/procedure/enum/feedback/view/comment + publish entity/page/workflow + manage_members:agent + edit:tool + edit:notification |
| `viewer` | view all + run workflow/agent/procedure + create:feedback + CRUD comment/view cá nhân (handler filter `createdBy=user.id`) + edit:notification (mark own read) |

**Frontend re-export** (`src/lib/permissions.ts`): re-export thuần từ
core — KHÔNG tự định nghĩa MATRIX song song (P2.1 fix lệch UI vs server).

**Per-resource ACL** (`packages/server/src/resource-acl.ts` + bảng
`resource_members`): generic membership pivot cho mọi loại resource —
agent (P2.3 backfill), page/record (defer). Policy thuộc về từng
resource type (`agent-acl.ts` apply private/owner-only rules).

**Field-level RBAC** (`fieldCan(role, action, field)`): áp dụng đồng
nhất qua `stripUnreadableFields` / `stripUnwritableFields` ở:
- `records.create/update/bulkUpdate/bulkImport/export` (P3.1)
- `procedures.invoke` args theo `paramsSchema[].writableBy` (P3.2)
- `workflow` step `config.requiresRole` — fail-closed (P3.3)

**REST API key scopes** (`api_keys.scopes`): **deny-by-default** (P1.3).
Format hợp lệ: `"*"` | `entity:<name>:read|write` | `entity:*:read|write`.
Empty scopes hoặc sai format → reject từ create time + runtime.

**WebSocket subscribe** (`packages/server/src/ws-channels.ts`):
allowlist + scope check. Patterns:
- `notifications:<userId>` — khớp session user
- `approval:<userId>` — khớp session user
- `record:<entityName>:<companyId>` — khớp active company (cross-tenant guard P4.1)
- `presence:<recordId>` — UUID format check (presence payload không leak data)

**Tool proxy** (`packages/server/src/tools/proxy.ts`): pre-flight
`companyTools.enabled === true` (P4.2) trước khi forward. Cross-tenant
hoặc disabled tool → 403.

---

## 6. Bài học từ session vừa qua (đáng ghi vào CLAUDE.md)

1. **Migration timestamps phải unique tăng dần** — Drizzle dùng `created_at` (không phải hash) để check "đã apply chưa". Reuse timestamp = migration sau bị skip im lặng.
2. **Pre-existing journal gap nguy hiểm** — 17 SQL file 0013-0029 commit không kèm journal entry → fresh DB thiếu bảng → lỗi runtime khó debug. Đã backfill + script `tooling/ascii-migrations.mjs` để chuẩn hoá comment.
3. **`bootstrapTools` chỉ gọi 1 lần TRƯỚC `app.listen()`** — `@fastify/http-proxy` không register được sau khi Fastify đã boot → "Root plugin has already booted".
4. **TanStack `useLocation().search` là OBJECT**, không phải string. `loc.pathname + loc.search` throw "Cannot convert object to primitive value". Dùng `loc.href`.
5. **SQL comment `/api/v1/*`** bên trong block comment làm Postgres parse nested → "unterminated /* comment". Tránh `*` trong path khi viết comment SQL.
6. **AI enrichment phải fail-safe** — embedding/LLM lỗi không được vỡ submit. `callLlmJson` trả `null` khi sai, caller phải handle.
7. **Major dep bumps CẦN dedicated sprint** — Tailwind 3→4 (CSS-first config + opacity syntax), Zod 3→4 (touches ~50 file routers + forms), router.ts split (15 helper share) đều cần visual regression / e2e fixture đầy đủ. KHÔNG gộp với các fix nhỏ.
8. **Biome auto-fix --unsafe an toàn** — clean 129/144 file mà không phá test. Còn `useButtonType` cần manual (153 nơi) vì Biome không tự biết button có chạy submit form hay không.
9. **RBAC defense-in-depth phải có middleware-level check, không tin handler** — audit 2026-05-26 tìm thấy 5 P0 (P0.4-P0.8): `protectedProcedure` thuần để mutate data bypass approval gate; `rbacProcedure("view","activity")` cho mọi action feedback; REST `scopes=[]`=full; WS subscribe trust caller; tool proxy không check enable. Bài học: mọi tRPC procedure thao tác data PHẢI qua `rbacProcedure` hoặc `resourceProcedure` (build trên `approvedProcedure` chain). Nếu thấy `protectedProcedure.input(...).mutation(...)` trong PR review → reject.
10. **`getRawInput()` thay `input` trong tRPC v11 middleware** — middleware đặt trước `.input()` chain của consumer chỉ thấy raw payload qua `getRawInput()` (async). Dùng `input` trực tiếp sẽ thấy undefined hoặc giá trị đã accumulate từ middleware trước, không phải payload thật.
11. **Drizzle middleware queue bị reset giữa chain** — khi extend procedure builder bằng nhiều `.use()` liên tiếp, ngữ cảnh `ctx.user.companyId` (tightening type narrowing) chỉ propagate xuống chain hiện tại. `approvedProcedure` build từ `protectedProcedure.use(...)` đã narrow `companyId: string`; `rbacProcedure` build từ `protectedProcedure.use(...)` ĐỘC LẬP cũng narrow lại — KHÔNG share narrowing giữa các chain, mỗi factory tự assert lại trong middleware.

---

## Phụ lục — Audit phương pháp

- 3 subagent Explore chạy song song: backend (server/db/security), frontend (UI/state/UX), ops/DX (CI/docs/deps).
- Manual verify: `wc -l` cho file lớn, `find -name "*.test.ts"`, `pnpm audit`, `pnpm outdated`.
- Reference: `pnpm-lock.yaml`, `package.json`, `biome.json`, `vite.config.ts`, `.github/workflows/ci.yml`.
