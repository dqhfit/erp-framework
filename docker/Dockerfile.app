# @erp-framework app (SPA) — self-host trong monorepo pnpm.
#   Stage 1: build dist/ bằng node + pnpm (cần cả workspace package).
#   Stage 2: serve dist/ bằng nginx — SPA fallback + proxy /trpc → server.
FROM node:22-slim AS build
RUN npm install -g pnpm@11
RUN pnpm config set minimum-release-age 0 && pnpm config set verify-deps-before-run false
WORKDIR /app

# Copy toàn bộ monorepo (node_modules đã bị .dockerignore loại trừ).
# App phụ thuộc @erp-framework/core + @erp-framework/client (workspace),
# nên phải có mặt đủ package để build chạy được.
COPY . .

# --ignore-scripts: pnpm 11 chặn build script của dependency mặc định và
# coi đó là LỖI (ERR_PNPM_IGNORED_BUILDS, exit 1) khi chạy không tương tác.
# Cờ này là chỉ thị tường minh "bỏ qua script" → pnpm thoát 0.
# esbuild/@swc/core/biome đời mới nạp binary native qua optionalDependencies
# theo nền tảng (vẫn được cài) nên vite build vẫn chạy; postinstall chỉ là
# bước tối ưu. pnpm rebuild sau đó chạy lại script cho các gói cần (nếu có).
RUN pnpm install --ignore-scripts --config.minimum-release-age=0
RUN pnpm rebuild esbuild @swc/core @biomejs/biome || true

# Chạy thẳng "vite build" thay vì "pnpm build" (tsc && vite build):
# src/routeTree.gen.ts là file tự sinh, bị .dockerignore loại trừ → tsc
# (chạy trước) sẽ lỗi vì thiếu file. Plugin router của TanStack tự sinh
# lại routeTree.gen.ts ở buildStart của vite, nên vite build là đủ để ra
# dist/. Việc typecheck thuộc khâu dev/CI, không cần trong image.
RUN pnpm exec vite build

# ---------- Stage 2: serve ----------
FROM nginx:1.27-alpine AS serve
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1/ >/dev/null 2>&1 || exit 1
CMD ["nginx", "-g", "daemon off;"]
