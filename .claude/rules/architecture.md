# Rule: Kiến trúc & phân tầng (erp-framework)

> Cheat-sheet ngắn. Nguồn chi tiết là `CLAUDE.md` (§1,2,4,5,11) — file này chỉ tóm để quét nhanh.

## Phân tầng monorepo (pnpm workspaces)
- `packages/core` — logic thuần (vd MATRIX RBAC `permissions.ts`), không phụ thuộc framework.
- `packages/db` — schema Drizzle + `migrations/` (drizzle-kit đọc `.env` RIÊNG của package này).
- `packages/server` — Fastify + tRPC + Drizzle runtime; bootstrap `src/index.ts`.
- `packages/client` — client tRPC dùng chung.
- `packages/plugins` — plugin in-process (field-type/workflow-node/widget...) + Tier D proc.
- `src/` (root) — frontend React 19 + Vite (manualChunks).
- Tool/script in-tree: `tooling/`, `packages/plugins/`, `packages/` — KHÔNG dùng `D:\code\cowok\Tools\`.

## Bất biến cốt lõi
- **Đa-tenant từ schema**: mọi bảng data có `company_id` + cascade FK; session `active_company_id`.
  Mọi lookup/cache/poll scope theo `company_id`.
- **RBAC 4 tầng** (`packages/server/src/trpc.ts`): `publicProcedure` → `protectedProcedure` →
  `approvedProcedure` → `rbacProcedure(action,obj)` / `resourceProcedure`. Mutate data = rbac/resource,
  fail-closed. MATRIX chỉ ở `packages/core/src/permissions.ts` (frontend re-export, không định nghĩa song song).
- **DataSource-first**: proc đọc phức tạp → mở rộng DataSource (groupBy server-side), KHÔNG port code.
  Tier D chỉ cho proc GHI/scalar, phải qua `packages/plugins/src/proc-table.ts`.
- **Storage tier**: entity có thể bảng-thật (cột `f_<slug>` + `ext` jsonb) hoặc EAV; route theo
  `meta.storage.tier`. Update `entities.meta` = merge jsonb, không ghi đè.

## Khi thay đổi
- Câu hỏi cấu trúc (ai gọi ai / định nghĩa / blast radius) → **codegraph** (`codegraph_context`,
  `codegraph_impact`) thay vì grep.
- Đổi public API → kiểm blast radius trước. Thêm tính năng → **lát cắt dọc** (UI→tRPC→DB) end-to-end.
- Server bootstrap thứ tự cứng: `runMigrations` → register plugins/routes → `bootstrapTools` (1 lần,
  TRƯỚC `listen()`) → `listen()`.

## Deploy (CLAUDE.md §11)
- Prod chạy image Coolify build; `git push` KHÔNG tự deploy (trừ nginx.conf volume-mount).
- Config (page/datasource/entity) local KHÔNG tự lên prod → đẩy qua MCP `/mcp/migration`; deploy
  CODE trước, config sau; giữ `id` page chống đẻ trùng.
