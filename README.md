# ERP Framework

Framework low-code/no-code để dựng ứng dụng ERP: người dùng tự thiết kế
Entity → Page → Workflow → Agent qua giao diện kéo-thả, dữ liệu chạy trên
backend thật (PostgreSQL). Mở rộng được bằng plugin, tự host được.

## Kiến trúc — monorepo pnpm

| Package                | Vai trò                                                        |
|------------------------|----------------------------------------------------------------|
| `@erp-framework/core`  | Lõi THUẦN (không React/IO): DataSource interface, RBAC, validate-on-write, formula, workflow-runner, Plugin SDK |
| `@erp-framework/db`    | Schema Drizzle + migration (PostgreSQL 18, `uuidv7`)           |
| `@erp-framework/server`| Backend Fastify + tRPC + Drizzle: auth phiên, RBAC, scheduler pg-boss, MCP/LLM client |
| `@erp-framework/client`| Client cho frontend: `ApiDataSource`, auth client, objects client |
| `@erp-framework/plugins`| Plugin dùng chung cho cả app lẫn server                       |
| `src/` (gốc)           | App ERP mẫu — React 19 + Vite + TanStack Router                |

## Chạy môi trường dev

```bash
pnpm install
pnpm dev          # chạy app (vite :5173) + server (:8910) cùng lúc
```

Lần đầu cần một PostgreSQL — xem `packages/server/.env.example`. App mở
màn hình đăng nhập; tài khoản đầu tiên là quản trị viên.

```bash
pnpm -r typecheck # kiểm type toàn monorepo
pnpm build        # build app (tsc + vite)
pnpm test         # chạy test
```

## Tự host (self-host)

Triển khai đầy đủ bằng Docker — PostgreSQL + server + app (nginx) + bridge:

```bash
cp docker/.env.example docker/.env   # đặt ENCRYPTION_KEY
docker compose -f docker/docker-compose.yml up -d --build
```

Mở <http://localhost:3000>. Chi tiết: [docs/SELF-HOST.md](./docs/SELF-HOST.md).

## Hệ plugin

Mở rộng framework (kiểu field, node workflow, widget, MCP connector, LLM
adapter) mà không sửa lõi:

```bash
pnpm new:plugin ten-plugin   # scaffold src/plugins/ten-plugin.ts
```

Loader tự nạp mọi file trong `src/plugins/`. Chi tiết:
[docs/PLUGINS.md](./docs/PLUGINS.md).

## Xác thực LLM — 4 cách

1. **API Key** — `/settings/llm` → tạo profile → nhập key Anthropic/OpenAI/Gemini/Ollama.
2. **Claude Pro/Max OAuth** — đăng nhập claude.ai, dùng quota subscription.
3. **Claude Code CLI Bridge** — dùng `claude` CLI làm nguồn LLM. Trong
   self-host, bridge chạy sẵn thành một container (cổng 8909); đăng nhập một
   lần bằng `docker compose ... exec -it bridge claude`.
4. **Local LLM (Ollama)** — adapter `ollama`, `localhost:11434`.

## Tài liệu

- [docs/UPGRADE-PLAN.md](./docs/UPGRADE-PLAN.md) — kế hoạch & kiến trúc đích
- [docs/SELF-HOST.md](./docs/SELF-HOST.md) — triển khai Docker
- [docs/PLUGINS.md](./docs/PLUGINS.md) — hệ plugin
- [ROADMAP.md](./ROADMAP.md) · [DESIGN_SPEC.md](./DESIGN_SPEC.md)

## CI

`.github/workflows/ci.yml` chạy typecheck + build + test mỗi lần push/PR.
