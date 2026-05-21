# ==========================================================
# ERP Framework — multi-stage build cho Coolify
#   Stage 1: build SPA bằng Node + pnpm
#   Stage 2: serve dist/ bằng nginx (có SPA fallback)
# ==========================================================

# ---------- Stage 1: build ----------
FROM node:22-alpine AS build
WORKDIR /app

# Bật corepack để dùng pnpm theo packageManager trong package.json
RUN corepack enable

# Cài deps trước (tận dụng layer cache)
COPY package.json pnpm-lock.yaml* ./
RUN pnpm install --frozen-lockfile || pnpm install

# Copy source + build
COPY . .
RUN pnpm build

# ---------- Stage 2: serve ----------
FROM nginx:1.27-alpine AS serve

# Cấu hình nginx có SPA fallback
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy build output
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

# Healthcheck cho Coolify
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://localhost/ >/dev/null 2>&1 || exit 1

CMD ["nginx", "-g", "daemon off;"]
