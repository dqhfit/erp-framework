# Tự host (self-host) ERP Framework

Triển khai bằng `docker compose`: PostgreSQL 18 (pgvector), Apache Tika,
backend (`@erp-framework/server`), app SPA (nginx) — và 2 service tuỳ chọn
(`bridge`, `ollama`).

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
| `db`     | `pgvector/pgvector:pg18` | CSDL — PostgreSQL 18 + pgvector (Knowledge Base), volume `erp-pgdata` |
| `tika`   | `apache/tika:3.2.1.0-full` | Trích văn bản từ file cho Knowledge Base (PDF/DOCX/OCR…) |
| `server` | `docker/Dockerfile.server` | Fastify + tRPC + Drizzle + pg-boss; tự migrate khi khởi động |
| `app`    | `docker/Dockerfile.app`    | nginx phục vụ SPA; proxy `/trpc` → `server:8910`   |
| `bridge` | `docker/Dockerfile.bridge` | (Tuỳ chọn) Claude Code CLI bridge — LLM qua auth Pro/Max, cổng 8909 |
| `ollama` | `ollama/ollama`        | Sinh embedding cục bộ cho Knowledge Base, cổng 11434 |
| `ollama-pull` | `ollama/ollama`   | One-shot: tự kéo model `nomic-embed-text` rồi thoát |

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

## Knowledge Base — cấu hình Embedding

Knowledge Base (RAG) cần một **embedding profile** để sinh vector tra cứu.
Service `ollama` chạy sẵn cùng stack; `ollama-pull` tự kéo model
`nomic-embed-text` về sau khi `ollama` lên — không cần thao tác thủ công.

Sau khi stack chạy, vào app → **Cài đặt → Embedding**, chọn một trong hai:

- **Ollama (mặc định, cục bộ, miễn phí).** Adapter **Ollama**, model
  `nomic-embed-text`, endpoint `http://ollama:11434`. Model nhẹ (~275MB),
  chạy CPU — không cần GPU. Lần deploy đầu chờ vài phút cho `ollama-pull`
  tải xong model:
  `docker compose -f docker/docker-compose.yml logs ollama-pull`.
- **OpenAI-compatible (cloud).** Adapter **OpenAI**, model
  `text-embedding-3-small`, dán API key; endpoint để trống (hoặc URL
  Gemini OpenAI-compat).

Vector cố định **768 chiều**. File tải lên được service `tika` trích văn
bản; bản thân file lưu ở volume `erp-uploads`.

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
