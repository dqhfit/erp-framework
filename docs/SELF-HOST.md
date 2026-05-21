# Tự host (self-host) ERP Framework

Triển khai đầy đủ 3 service bằng `docker compose`: PostgreSQL 18, backend
(`@erp-framework/server`) và app SPA (nginx).

## Yêu cầu
- Docker + Docker Compose v2
- 1 máy chủ (single-tenant) — không cần Kubernetes

## Các bước

1. Chuẩn bị khoá mã hoá:

   ```sh
   cp docker/.env.example docker/.env
   # Sửa ENCRYPTION_KEY thành một chuỗi ngẫu nhiên dài (mã hoá API key LLM).
   ```

2. Build và chạy:

   ```sh
   docker compose -f docker/docker-compose.yml up -d --build
   ```

3. Mở trình duyệt: <http://localhost:3000>

## Kiến trúc compose

| Service  | Ảnh / build            | Vai trò                                            |
|----------|------------------------|----------------------------------------------------|
| `db`     | `postgres:18`          | CSDL — volume `erp-pgdata`, có `uuidv7()` sẵn       |
| `server` | `docker/Dockerfile.server` | Fastify + tRPC + Drizzle + pg-boss; tự migrate khi khởi động |
| `app`    | `docker/Dockerfile.app`    | nginx phục vụ SPA; proxy `/trpc` → `server:8910`   |
| `bridge` | `docker/Dockerfile.bridge` | Claude Code CLI bridge (LLM qua auth Pro/Max), cổng 8909 |

`server` **không** mở cổng ra ngoài — `app` (nginx) proxy nội bộ qua
`/trpc` nên trình duyệt chỉ gọi cùng một origin (cookie-session hoạt động,
không vướng CORS/SameSite). Cần debug trực tiếp server thì bỏ comment khối
`ports` của service `server` trong `docker-compose.yml`.

## Claude Code CLI Bridge (tùy chọn)

Service `bridge` chạy `claude` CLI trong container và expose HTTP cổng
`8909`, cho phép app dùng claude CLI làm nguồn LLM (tận dụng gói Pro/Max
thay vì API key). Đây là thành phần **tùy chọn** — bỏ qua nếu chỉ dùng
API key thật cho LLM.

Đăng nhập **một lần** sau khi stack chạy (credentials lưu vào volume
`bridge-data`, không mất khi restart):

```sh
docker compose -f docker/docker-compose.yml exec -it bridge claude
```

Làm theo luồng đăng nhập (mở URL hiện ra bằng trình duyệt, dán mã trở
lại), hoàn tất rồi gõ `/exit`. Sau đó trong app vào **Cài đặt → LLM**,
đặt **Bridge URL** = `http://localhost:8909` và bấm **Test** — phải
hiện "Bridge online".

Kiểm tra nhanh: `curl http://localhost:8909/health`

## Vận hành

- Xem log:        `docker compose -f docker/docker-compose.yml logs -f`
- Dừng:           `docker compose -f docker/docker-compose.yml down`
- Dừng + xoá DB:  `docker compose -f docker/docker-compose.yml down -v`
- Migration tự áp khi `server` khởi động (`pnpm --filter @erp-framework/db migrate`).

## Sao lưu

```sh
docker compose -f docker/docker-compose.yml exec db \
  pg_dump -U erp erp_framework > backup.sql
```

## Tài khoản quản trị

Lần khởi động đầu, `server` chạy seed tạo admin mặc định (xem
`packages/server/src/seed.ts`). Đổi mật khẩu ngay sau khi đăng nhập.
