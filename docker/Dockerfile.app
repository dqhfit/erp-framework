# @erp-framework app (SPA) — self-host trong monorepo pnpm.
#   Stage 1 (deps): copy manifest → pnpm install (cached khi không đổi deps)
#   Stage 2 (build): copy source → vite build (chỉ chậm khi code đổi)
#   Stage 3 (serve): nginx phục vụ dist/ + proxy API
FROM node:22-slim AS deps
RUN npm install -g pnpm@11
RUN pnpm config set minimum-release-age 0 && pnpm config set verify-deps-before-run false
WORKDIR /app

# ── LAYER CACHING: manifest trước source ──────────────────────
# Layer này cache hit khi chỉ sửa code (không đổi package.json/lock).
# pnpm install của toàn workspace (~2 phút) không chạy lại mỗi push code.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/server/package.json packages/server/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY packages/client/package.json packages/client/
COPY packages/mssql-client/package.json packages/mssql-client/
COPY packages/plugins/package.json packages/plugins/

RUN pnpm install --ignore-scripts --config.minimum-release-age=0
RUN pnpm rebuild esbuild @swc/core @biomejs/biome || true

# ── Stage build: copy source → vite build ─────────────────────
FROM deps AS build
# Copy toàn bộ source (node_modules đã có từ stage deps qua cache).
COPY . .
# vite build (không tsc): routeTree.gen.ts được TanStack plugin sinh lại
# trong buildStart — tsc typecheck thuộc khâu CI, không cần trong image.
RUN pnpm exec vite build

# ── Stage serve: nginx phục vụ SPA + proxy backend ────────────
FROM nginx:1.27-alpine AS serve
# nginx.conf bake vào image làm fallback; production dùng volume mount
# (docker-compose.yml) để thay đổi proxy rule không cần rebuild image:
#   git pull && docker exec <app-container> nginx -s reload  (< 1 giây)
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1/ >/dev/null 2>&1 || exit 1
CMD ["nginx", "-g", "daemon off;"]
