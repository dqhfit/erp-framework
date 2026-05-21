# ERP Framework

Low-code/no-code ERP builder. MCP làm data source. Multi-LLM agents.
Người dùng tự thiết kế Entity → Page → Workflow → Dashboard.

## Stack
React 19 + TypeScript 5 + Vite 5 + TanStack Router/Query/Table +
Zustand + react-hook-form + Zod + @xyflow/react + @dnd-kit + Tailwind +
shadcn/ui + Recharts + Biome.

## Setup

```bash
pnpm install
pnpm dev           # Dev server localhost:5173
pnpm build         # Output → dist/
```

## LLM Authentication — 4 cách

### 1. API Key (đơn giản nhất)
Vào `/settings/llm` → tạo profile → nhập API key của Anthropic/OpenAI/Gemini/Ollama.

### 2. Claude Pro/Max OAuth (dùng quota subscription)
- Vào `/settings/llm` → click **"Đăng nhập với Claude Pro/Max"**
- Sẽ redirect tới claude.ai, login, approve.
- Token lưu localStorage, auto-refresh.
- Tạo profile "Claude Pro" → chat trong app, dùng quota subscription thay vì trả API.

### 3. Claude Code CLI Bridge (khuyến nghị nếu đã có CLI)
Tận dụng `claude` CLI đã đăng nhập Pro/Max (hoặc API key) làm backend.

```bash
# 1 lần: cài Claude Code CLI
npm install -g @anthropic-ai/claude-code

# 1 lần: login
claude

# Mỗi lần dev: chạy bridge song song với Vite
pnpm bridge      # → localhost:8909
# hoặc cùng lúc:
pnpm dev:all     # cần `pnpm add -D concurrently` trước
```

Sau đó vào `/settings/llm` → card "Claude Code CLI Bridge" → click **Test** → nếu OK click **+ Tạo profile** → dùng adapter `claude-cli`.

Ưu điểm: không cần copy-paste API key, không cần OAuth setup, dùng auth của CLI luôn.

### 4. Local LLM (Ollama)
Chạy Ollama tại `localhost:11434`. Vào settings tạo profile adapter `ollama`, chọn model `llama3` / `qwen2.5`.

## Deploy lên Coolify

App là **SPA thuần client** — build ra `dist/` rồi serve tĩnh. Có sẵn `Dockerfile` (multi-stage: Node build → nginx serve, kèm SPA fallback).

### Cách 1 — Dockerfile (khuyến nghị)
1. Push repo lên Git (GitHub/GitLab).
2. Trên Coolify: **New Resource → Application → từ Git repo**.
3. Build Pack: chọn **Dockerfile** (Coolify tự nhận `Dockerfile` ở root).
4. Port: `80`. Coolify tự cấp domain + HTTPS.
5. Deploy. Healthcheck đã cấu hình sẵn (`HEALTHCHECK` trong Dockerfile).

### Cách 2 — Static site
1. Build Pack: **Static** (hoặc Nixpacks).
2. Install command: `corepack enable && pnpm install`
3. Build command: `pnpm build`
4. Output / publish directory: `dist`
5. Bật **SPA mode** (fallback về `index.html`) — bắt buộc, nếu không refresh route con sẽ 404.

### Sau khi deploy
- **OAuth redirect**: `redirect_uri` tự lấy theo `window.location.origin` → không cần sửa code. Nhưng phải đảm bảo domain production được Anthropic chấp nhận cho OAuth flow.
- **MCP**: user tự cấu hình URL MCP server trong `/settings/mcp` lúc dùng.

**Lưu ý — Bridge**: `pnpm bridge` (Claude Code CLI proxy + config-sync) **không deploy được trong container** vì cần `claude` CLI cài trên máy. Bridge là tool *optional, local*: app deploy chạy bình thường không cần bridge — chỉ adapter `claude-cli` và tính năng config-sync cần user tự chạy `pnpm bridge` trên máy họ. Production dùng API Key / OAuth là đủ.

## Docs
- [ROADMAP.md](./ROADMAP.md) — Architecture + sprints + decisions
- [DESIGN_SPEC.md](./DESIGN_SPEC.md) — UX/UI spec
- `src/core/llm/` — Multi-LLM adapter system
- `src/routes/` — File-based routing
