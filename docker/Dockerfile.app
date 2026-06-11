# @erp-framework app (SPA) — self-host trong monorepo pnpm.
# LƯU Ý: KHÔNG thêm "# syntax=docker/dockerfile:1" — Coolify bake load
# fail (exit 255 "load local bake definitions"). Engine hiện đại hỗ trợ
# RUN --mount=type=cache sẵn qua builtin frontend, không cần directive.
#   Stage 1 (build): pnpm install + vite build
#   Stage 2 (serve): nginx phục vụ dist/ + proxy API
#
# Tốc độ deploy: pnpm store được cache qua --mount=type=cache trên server
# Coolify (persistent, không phải ephemeral CI). Lần đầu tải package về;
# lần sau hit cache → install chỉ link workspace, bỏ qua download (~30s).
FROM node:22-slim AS build
RUN npm install -g pnpm@11
RUN pnpm config set minimum-release-age 0 && pnpm config set verify-deps-before-run false
WORKDIR /app

COPY . .

# --mount=type=cache: pnpm store nằm ngoài layer, persist giữa các lần build.
# Coolify build trên server cố định → cache sống lâu dài (không như CI ephemeral).
RUN --mount=type=cache,id=pnpm-store-app,target=/pnpm-store \
    pnpm install --store-dir=/pnpm-store --ignore-scripts \
    --config.minimum-release-age=0
RUN pnpm rebuild esbuild @swc/core @biomejs/biome || true

# vite build (không tsc): routeTree.gen.ts được TanStack plugin sinh lại
# trong buildStart — tsc typecheck thuộc khâu CI, không cần trong image.
RUN pnpm exec vite build

# ---------- Stage 2: serve ----------
FROM nginx:1.27-alpine AS serve
# nginx.conf bake vào image làm fallback; production dùng volume mount
# (docker-compose.yml) để thay đổi proxy rule không cần rebuild image:
#   SSH vào server → git pull → docker exec <app> nginx -s reload
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1/ >/dev/null 2>&1 || exit 1
CMD ["nginx", "-g", "daemon off;"]
