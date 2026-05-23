# Sao lưu & khôi phục lên Google Drive

Có **2 đường** sao lưu, dùng song song:

| Cách | Dùng khi | Định dạng |
|---|---|---|
| **UI** `/settings/backup` (khuyến nghị) | Hằng ngày — chạy server-side, có lịch cron, không treo máy host. | DB dump (file mới mỗi lần) + uploads sync **incremental** (1-1 vào Drive). |
| **CLI** `pnpm backup` | Ad-hoc / cron host / DR ở máy ngoài. | Tarball đầy đủ DB + uploads. |

**Sync incremental (UI)**: chỉ upload file MỚI hoặc đã ĐỔI (so size +
mtime). Hàng nghìn file không đổi → bỏ qua, không tốn băng thông.

**Tarball (CLI)**: nén toàn bộ uploads mỗi lần. Phù hợp DR (1 file = 1
bản chụp đầy đủ) nhưng tốn băng thông nếu uploads lớn.

## Phạm vi sao lưu

| Thành phần | Có trong gói? | Ghi chú |
|---|---|---|
| Toàn bộ DB PostgreSQL (`pg_dump -Fc`) | ✅ | Bao gồm entities, records, KB chunks (vector 768d), LLM profile (đã mã hoá), MCP config, plugin registrations, IoT devices/telemetry… |
| Thư mục `/data/uploads` | ✅ | File tải lên Knowledge Base + các file khác. |
| Cấu hình hệ thống | ✅ | Có trong DB dump nên không cần JSON riêng. |

## Tiền đề

- Docker stack đang chạy (`docker compose -f docker/docker-compose.yml ps`).
- Có thể chạy `docker exec` ở host.
- Node 22+ (đã có sẵn cho `pnpm dev`).

## Cách 1: UI `/settings/backup` (khuyến nghị)

Sau khi setup service account (mục Setup bên dưới):

1. Mở **Settings → Sao lưu** trong app.
2. Dán toàn bộ nội dung file JSON service account vào ô **Service
   account JSON key**.
3. Dán **Folder ID** Google Drive (lấy từ URL thư mục đã share).
4. Bấm **Test kết nối** — phải hiện ✓ "Kết nối được — thư mục …".
5. (Tuỳ chọn) chọn lịch cron — preset "Mỗi ngày 3h sáng" / "Mỗi 6 giờ"…
6. Bấm **Lưu cấu hình**.
7. Bấm **Backup ngay** — job chạy server-side, vài giây sau xuất hiện
   trong "Lịch sử sao lưu". Trạng thái: running → done.

Sau đó cron tự chạy theo lịch — không cần can thiệp.

**Cấu trúc trong Drive folder của bạn:**
```
<your-folder>/
  db/
    erp-db-2026-05-23T08-30-00-000Z.dump   (file mới mỗi lần backup)
    erp-db-2026-05-22T03-00-00-000Z.dump
    ...
  uploads/
    <companyId>__<filename>                 (mirror, sync incremental)
    ...
```

**Đa công ty**: mỗi công ty một cấu hình riêng (`backup_config` được
multi-tenant). Mỗi công ty backup vào folder của riêng nó.

## Cách 2: CLI `pnpm backup` (tarball đầy đủ)

Cần Docker stack đang chạy ở host. Đóng gói tất cả thành 1 tarball.

## Setup Google Drive (một-lần)

1. Vào [Google Cloud Console](https://console.cloud.google.com/) → tạo
   project mới (hoặc dùng project hiện có).
2. **APIs & Services → Library** → bật **Google Drive API**.
3. **IAM & Admin → Service Accounts** → *Create service account*. Đặt
   tên (vd `erp-backup`). Bỏ qua các bước phân quyền optional.
4. Mở service account vừa tạo → tab **Keys** → *Add Key → Create new
   key → JSON*. Lưu file vào máy (vd `./gdrive-key.json`).
5. Mở [Google Drive](https://drive.google.com/) trên trình duyệt → tạo
   thư mục đích (vd "ERP Backups") → **Share** với email service account
   (dạng `erp-backup@<project>.iam.gserviceaccount.com`) với quyền
   **Editor**. Copy `folderId` từ URL (đoạn sau `/folders/`).

## Cấu hình env

Tạo file `.env.backup` ở repo root (đã có trong `.gitignore` qua `.env*`):

```bash
GDRIVE_SERVICE_ACCOUNT_KEY_FILE=./gdrive-key.json
GDRIVE_FOLDER_ID=1AbCdEfGhIjKlMnOpQrStUvWxYz_example
# (Tuỳ chọn) đổi service / compose file nếu khác mặc định:
# BACKUP_COMPOSE_FILE=docker/docker-compose.yml
# BACKUP_DB_SERVICE=db
# BACKUP_SERVER_SERVICE=server
```

Nạp env trước khi chạy lệnh:

**PowerShell:**
```powershell
Get-Content .env.backup | ForEach-Object {
  if ($_ -match '^([^=]+)=(.*)$') { [Environment]::SetEnvironmentVariable($matches[1], $matches[2]) }
}
pnpm backup
```

**bash:**
```bash
export $(grep -v '^#' .env.backup | xargs)
pnpm backup
```

## Sao lưu

```bash
pnpm backup
```

Kết quả:
```
• pg_dump → db.dump
• docker cp /data/uploads
• tar czf
  → ./backups/erp-backup-2026-05-23T08-30-00-000Z.tar.gz (12.4 MB)
• Xin access token Google…
• Upload Drive…
✓ Đã upload — fileId 1XyZ...
  https://drive.google.com/file/d/1XyZ.../view
```

**Bỏ qua upload** (chỉ tạo tarball local — kiểm tra nhanh hoặc backup
offline):
```bash
BACKUP_LOCAL_ONLY=1 pnpm backup
```

## Khôi phục

> ⚠ Lệnh khôi phục **GHI ĐÈ** DB và thư mục uploads hiện tại. Hỏi xác
> nhận trước khi chạy.

Tải tarball về máy (từ Google Drive hoặc thư mục `./backups/`), rồi:

```bash
pnpm restore ./backups/erp-backup-2026-05-23T08-30-00-000Z.tar.gz
```

Bỏ qua confirm (script tự động hoá):
```bash
RESTORE_YES=1 pnpm restore <tarball>
```

Sau khi khôi phục, khuyến nghị restart server để xoá cache:
```bash
docker compose -f docker/docker-compose.yml restart server
```

## Khôi phục ở máy mới (disaster recovery)

```bash
git clone <repo> erp && cd erp
docker compose -f docker/docker-compose.yml up -d
# Đợi db healthy, server chạy migrate xong.
pnpm restore ./erp-backup-2026-05-23T08-30-00-000Z.tar.gz
docker compose -f docker/docker-compose.yml restart server
```

## Lịch trình tự động (cron)

Linux host:
```cron
0 3 * * * cd /path/to/erp && pnpm backup >> /var/log/erp-backup.log 2>&1
```

Windows Task Scheduler:
- Program: `pnpm`
- Arguments: `backup`
- Start in: `D:\code\cowok\Apps\erp-framework`
- Set env trong UI hoặc dùng wrapper script.

## Khắc phục sự cố

| Lỗi | Nguyên nhân & Xử lý |
|---|---|
| `GDRIVE_SERVICE_ACCOUNT_KEY_FILE chưa đặt` | Chưa nạp `.env.backup`. Hoặc bật `BACKUP_LOCAL_ONLY=1`. |
| `auth 400: invalid_grant` | Đồng hồ máy lệch quá nhiều. Đồng bộ NTP. |
| `upload 403: storageQuotaExceeded` | Service account ổ riêng đầy (không phải Drive của bạn). Đảm bảo `GDRIVE_FOLDER_ID` là thư mục **của bạn** đã share cho service account. |
| `service "db" is not running` | Stack chưa lên — `docker compose -f docker/docker-compose.yml up -d` rồi chạy lại. Nếu dùng compose file khác, đặt `BACKUP_COMPOSE_FILE`. |
| `pg_restore: error: relation "..." already exists` | Bỏ qua được — `-c --if-exists` đã xử lý phần lớn; tham số `\|\| true` trong script không chặn flow. |
