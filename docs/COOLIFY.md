# Triển khai lên Coolify (1 dịch vụ)

Triển khai ERP Framework lên một máy chủ Coolify như **một Service** — toàn bộ
stack (PostgreSQL · Tika · server · app nginx · Bridge Claude CLI · Ollama
embedding) được Coolify quản lý dưới một resource duy nhất.

## Tiền đề

- Một máy chủ chạy [Coolify](https://coolify.io/) (`curl -fsSL https://cdn.coollabs.io/coolify/install.sh | bash`).
- Domain (hoặc subdomain wildcard) trỏ về máy chủ Coolify.
- Repo này đã kết nối với Coolify (GitHub App / Source).
- **VPS ≥4GB RAM, ≥15GB ổ đĩa** — đủ chỗ cho Ollama (~2GB image + 275MB
  model + 500MB-1GB RAM khi chạy) cộng PG + server + app + tika + bridge.

## Các bước

1. Trong Coolify → **+ New Resource → Service → Docker Compose Empty**.
2. **Source:** chọn repo này; **Branch:** `main` (hoặc nhánh muốn deploy).
3. **Compose Path:** `docker/docker-compose.coolify.yaml`.
4. Lưu — Coolify đọc compose và **tự sinh các biến**:
   - `SERVICE_PASSWORD_64_DB` — mật khẩu PostgreSQL.
   - `SERVICE_BASE64_64_KEY` — khoá AES-256-GCM mã hoá API key LLM.
   - `SERVICE_FQDN_APP_80` — domain HTTPS công khai cho app.
5. Bấm **Deploy**.

Coolify sẽ: pull repo → build 3 image (server + app + bridge) → khởi động 6
container (db, tika, server, app, bridge, ollama) + 1 one-shot kéo model
(`ollama-pull`) → cấp HTTPS qua Traefik + Let's Encrypt. Lần boot đầu,
`Dockerfile.server` tự chạy `migrate` rồi `seed` ERP mẫu trước khi listen.

## Sau khi deploy

1. Mở FQDN Coolify cấp → đăng ký admin đầu tiên.
2. **(Tùy chọn) Đăng nhập Claude Pro/Max qua Bridge.** Trong Coolify mở
   container `bridge` → tab **Terminal** → gõ:
   ```
   claude
   ```
   CLI in URL OAuth; mở URL đó ở máy bạn để đăng nhập Pro/Max. Token lưu
   vào volume `bridge-data` (persist qua redeploy).
3. **Cài đặt → LLM:**
   - Nếu dùng Bridge: trong card **Claude Code CLI Bridge**, đặt
     **Bridge URL = `/bridge`** (cùng origin, qua nginx) → bấm "Test" rồi
     "+ Tạo profile". Profile mới có adapter `claude-cli`.
   - Hoặc thêm profile OpenAI/Anthropic bằng API key thật.
4. **Cài đặt → Embedding:** chọn `Ollama (local)`, **Endpoint =
   `http://ollama:11434`**, Model `nomic-embed-text`. Không cần API key.
5. Vào **Tri thức** để nạp tài liệu, hoặc dùng trợ lý AI ngay.

## Persistence

Coolify quản lý 4 volume — giữ nguyên qua mọi lần redeploy:
- `erp-pgdata` — dữ liệu PostgreSQL (entity, page, workflow, user, KB chunks…).
- `erp-uploads` — file tải lên Knowledge Base.
- `bridge-data` — token đăng nhập Claude Pro/Max của Bridge CLI.
- `ollama-data` — model Ollama đã pull (nomic-embed-text…).

Sao lưu định kỳ qua **Backups** trong UI Coolify (snapshot Postgres).

## Cập nhật

Push commit lên branch đã chọn → Coolify tự build + deploy lại (nếu bật
auto-deploy), hoặc bấm **Redeploy** thủ công.

## Khắc phục sự cố

| Triệu chứng | Cách xử |
|---|---|
| Migrate fail "could not open extension vector" | Image `db` không phải `pgvector/pgvector:pg18` — sửa lại trong compose. |
| Server fail boot "CORS_ORIGIN bắt buộc ở production" | Coolify chưa cấp `SERVICE_FQDN_APP` — kiểm `SERVICE_FQDN_APP_80` đã có ở service `app`. |
| Upload file → "Tika unavailable" | Container `tika` chưa healthy — chờ ~30s. File > 25MB bị `@fastify/multipart` từ chối. |
| Đăng nhập 401 sau redeploy | `SERVICE_BASE64_64_KEY` đổi → API key LLM đã mã hoá không giải được; KHÔNG đổi key sau khi đã có data. |
| Bridge Test "offline" | Đảm bảo Bridge URL = `/bridge` (KHÔNG phải `http://bridge:8909`). Đã đăng nhập `claude` trong Terminal bridge chưa? |
| Ollama embedding fail "model not found" | Container `ollama-pull` đang kéo model — chờ vài phút lần đầu. Kiểm log của `ollama-pull` trong Coolify. |
| OOM khi ingest KB | Ollama cần ~1GB RAM khi sinh embedding. Nâng VPS hoặc đổi sang OpenAI embedding qua API key. |
