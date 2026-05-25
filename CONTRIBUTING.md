# Hướng dẫn đóng góp — ERP Framework

## Mục lục

1. [Thiết lập môi trường DEV](#1-thiết-lập-môi-trường-dev)
2. [Git workflow](#2-git-workflow)
3. [Migration database](#3-migration-database)
4. [Secrets và biến môi trường](#4-secrets-và-biến-môi-trường)
5. [Coding convention](#5-coding-convention)
6. [Kiểm tra trước khi tạo PR](#6-kiểm-tra-trước-khi-tạo-pr)

---

## 1. Thiết lập môi trường DEV

### Yêu cầu

| Công cụ | Phiên bản tối thiểu |
|---|---|
| Node.js | 22 |
| pnpm | 11 |
| Docker Desktop | 4.x |
| Git | 2.x |

### Chạy lần đầu

```bash
# 1. Clone repo
git clone https://github.com/dqhfit/erp-framework.git
cd erp-framework

# 2. Cài dependency + dựng DB + bật Tika/Ollama
pnpm dev:setup

# 3. Sao chép file env và điền giá trị
cp packages/server/.env.example packages/server/.env
# Mở packages/server/.env và đặt ENCRYPTION_KEY (bắt buộc)
# Sinh key: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# 4. Bật dev server
pnpm dev
# → Frontend: http://localhost:5173
# → Backend:  http://localhost:8910
```

### Lần tiếp theo (DB đã có)

```bash
pnpm dev
```

Nếu DB bị xoá hoặc reset:

```bash
pnpm db:setup    # tạo lại + migrate + seed
pnpm dev
```

---

## 2. Git workflow

Dùng **GitHub Flow** — nhánh ngắn, merge nhanh.

```
main (protected)
 └── feature/<tên-tính-năng>
 └── fix/<tên-bug>
 └── db/<tên-migration>      ← nhánh riêng khi thêm migration
```

### Quy tắc bắt buộc

- `main` được bảo vệ: **bắt buộc 1 reviewer + CI pass** trước khi merge
- Không push thẳng lên `main`
- Không dùng `--force` lên `main`
- Mỗi PR nên nhỏ và tập trung vào 1 việc

### Commit message

Tiếng Việt, prefix theo domain:

```
feat: thêm trường priority cho entity Order
fix: sửa lỗi CORS khi gọi từ subdomain
db: thêm cột priority vào bảng records
sec: vá CVE trong esbuild transitive dep
ux: đổi màu nút primary sang xanh lá
ai: thêm tool knowledge_search cho agent
perf: lazy load chart component theo route
refactor: tách logic auth ra auth-helpers.ts
docs: cập nhật CONTRIBUTING.md
```

---

## 3. Migration database

### Quy tắc quan trọng nhất

Drizzle dùng trường `when` (timestamp ms) để quyết định migration nào đã chạy — **không phải hash file**. Hai migration có cùng `when` → Drizzle silently bỏ qua cái mới.

**Mỗi migration PHẢI có `when` duy nhất và tăng dần.**

### Cách tạo migration đúng

```bash
# 1. Tạo file SQL
# Đặt tên: NNNN_<mô-tả>.sql (NNNN = idx tiếp theo, tăng 1)
# Ví dụ: 0044_add_priority_field.sql

# 2. Dùng timestamp hiện tại cho when (milisecond Unix)
node -e "console.log(Date.now())"
# → 1748879312345

# 3. Thêm vào packages/db/migrations/meta/_journal.json
{
  "idx": 44,
  "version": "7",
  "when": 1748879312345,   ← timestamp vừa sinh, phải > entry trước
  "tag": "0044_add_priority_field",
  "breakpoints": true
}
```

### Template file migration

```sql
-- 0044_add_priority_field.sql
-- Them cot priority vao bang records.
ALTER TABLE "records"
  ADD COLUMN IF NOT EXISTS "priority" integer NOT NULL DEFAULT 0;

DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS "records_priority_idx" ON "records"("priority");
EXCEPTION WHEN duplicate_table THEN NULL;
END $$;
```

> **Lưu ý:** Không dùng ký tự tiếng Việt, em-dash (—), hay dấu đặc biệt trong file `.sql`.
> Postgres parse lỗi encoding trên một số môi trường. Dùng ASCII thuần.

> **Lưu ý:** Không dùng `/*` lồng nhau trong comment SQL.
> Ví dụ `/api/v1/*` trong comment sẽ khiến Postgres báo "unterminated /* comment".
> Thay bằng `/api/v1/...`.

### Kiểm tra trước khi push

```bash
pnpm check:journal
# ✓ _journal.json hợp lệ — 44 migration, không có duplicate.
```

CI sẽ chạy check này tự động — nếu lỗi, PR không thể merge.

### Khi có conflict migration giữa 2 dev

Nếu hai nhánh tạo migration cùng số idx (ví dụ cả hai tạo `0044_*`):

1. Dev merge trước: giữ nguyên
2. Dev merge sau: đổi idx thành số tiếp theo (`0045_*`), sinh `when` mới, cập nhật `_journal.json`

---

## 4. Secrets và biến môi trường

### Nguyên tắc

- **Không bao giờ commit file `.env`** — đã có trong `.gitignore`
- **Không share `ENCRYPTION_KEY` production qua chat/email** — dùng GitHub Secrets hoặc Coolify env
- Mỗi dev dùng `ENCRYPTION_KEY` riêng cho local (data local không cần share với team)
- Staging/Production: key chung lưu trong Coolify environment variables

### Biến bắt buộc để dev local

```bash
DATABASE_URL=postgres://erp:erp@localhost:5432/erp_framework
ENCRYPTION_KEY=<tạo bằng openssl rand -hex 32>
```

Xem đầy đủ các biến và giải thích tại `packages/server/.env.example`.

### Thêm biến env mới

Khi thêm `process.env.MY_NEW_VAR` vào code:

1. Thêm vào `packages/server/.env.example` với comment giải thích
2. Thêm vào `.github/workflows/ci.yml` nếu cần cho e2e-full
3. Document trong PR description

---

## 5. Coding convention

### Ngôn ngữ

- **Code/identifier**: tiếng Anh
- **Comment**: tiếng Việt
- **Commit message / UI label**: tiếng Việt

### Backend (packages/server)

- Mọi tRPC procedure thao tác data dùng `rbacProcedure(action, resource)`
- Chỉ 4 endpoint public (register/login/invitePreview/acceptInvite), rate-limited
- AI failure không được làm vỡ flow chính — luôn fail-safe, trả `null`
- Encryption: dùng `crypto.ts` AES-256-GCM, không tự implement

### Frontend (src/)

- UI primitives từ `src/components/ui/` — không tạo component trùng lặp
- Icon mới: thêm vào `src/components/Icons.tsx`, không import lucide rời
- Form: react-hook-form + zod resolver
- Dialog/toast: `src/lib/dialog.ts`
- Không dùng `loc.pathname + loc.search` (search là object!) — dùng `loc.href`

### Monorepo

- Tái sử dụng logic qua `packages/core` (shared types, permissions, utils)
- Client API cho frontend: `packages/client/src/`
- Không import trực tiếp từ `packages/server` vào frontend

---

## 6. Kiểm tra trước khi tạo PR

```bash
# Type check toàn monorepo
pnpm typecheck

# Test unit
pnpm test

# Lint
pnpm lint

# Kiểm tra migration
pnpm check:journal

# (Tuỳ chọn) E2e smoke
pnpm e2e
```

CI tự động chạy tất cả những bước trên khi tạo PR. PR chỉ được merge khi **tất cả CI jobs pass** và **có ít nhất 1 approval**.

### Pre-commit hook tự động

Husky đã được cấu hình để tự động lint-check các file TypeScript trước mỗi commit. Nếu có lỗi biome, commit sẽ bị chặn — sửa lỗi rồi commit lại.

```bash
# Bỏ qua hook trong trường hợp khẩn cấp (không nên dùng thường xuyên)
git commit --no-verify -m "fix: urgent hotfix"
```
