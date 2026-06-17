# backup-pull — Sao lưu OFFSITE toàn bộ dữ liệu ERP theo lịch

Kéo backup **toàn bộ dữ liệu** từ server prod về **một máy khác** (offsite) theo
lịch — độc lập với backup push-lên-Google-Drive sẵn có. Gồm:

- **DB**: `pg_dump` custom-format **toàn bộ database** (mọi tenant) → `erp-db-<ts>.dump`
- **Files**: `tar.gz` thư mục upload → `erp-uploads-<ts>.tar.gz`

Máy offsite **chỉ cần `curl`** (Linux/macOS) hoặc **PowerShell** (Windows) —
KHÔNG cần Node, psql, hay quyền truy cập DB. Mọi thứ đi qua MCP `/mcp/backup`
trên server, xác thực bằng `X-API-Key`.

> ⚠️ Thứ tự: tính năng này phải **đã deploy lên server** (Coolify redeploy) thì
> endpoint `/mcp/backup` mới tồn tại. Là path mới nên cần **nginx redeploy/reload**
> để route qua (xem CLAUDE.md mục 11).

---

## 1. Tạo API key (trên server)

Cài đặt → **API Keys** → tạo key mới, thêm quyền loại **"Sao lưu (MCP)"**, mức:

| Mức | Cho phép |
|---|---|
| `backup:read` | xem dung lượng DB/uploads (`backup_info`) |
| `backup:run`  | kích hoạt backup push-Drive ngay |
| `backup:full` | **TẢI dump DB + uploads toàn hệ thống** ← cần cho script này |

Chọn **full** (bao luôn read). Copy key `sk_...` (chỉ hiện 1 lần).

> Dump là **toàn bộ DB đa tenant** → chỉ cấp `backup:full` cho key sao lưu riêng
> của operator, tuyệt đối không đưa cho tenant thường.

## 2. Cấu hình trên máy offsite

```bash
cp .env.example .env
# sửa SERVER_URL, API_KEY, OUT_DIR, KEEP
```

## 3. Chạy thử

Linux/macOS:
```bash
chmod +x backup-pull.sh
./backup-pull.sh
```

Windows (PowerShell):
```powershell
# Lần đầu nếu bị chặn policy:
#   Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
.\backup-pull.ps1
```

Thành công sẽ thấy `HOAN TAT OK.` và file trong `OUT_DIR`. Exit code != 0 nếu lỗi
(để scheduler/giám sát bắt được).

## 4. Đặt lịch

### Linux — cron (vd 02:00 hằng ngày)
```cron
0 2 * * * /opt/erp/backup-pull/backup-pull.sh >> /var/log/erp-backup.log 2>&1
```

### Linux — systemd timer (khuyến nghị: có log + trạng thái)
`/etc/systemd/system/erp-backup.service`:
```ini
[Unit]
Description=ERP offsite backup pull
[Service]
Type=oneshot
ExecStart=/opt/erp/backup-pull/backup-pull.sh
```
`/etc/systemd/system/erp-backup.timer`:
```ini
[Unit]
Description=ERP backup hằng ngày 02:00
[Timer]
OnCalendar=*-*-* 02:00:00
Persistent=true
[Install]
WantedBy=timers.target
```
```bash
sudo systemctl enable --now erp-backup.timer
systemctl list-timers erp-backup.timer   # kiểm tra lịch
```

### Windows — Task Scheduler
```powershell
$action  = New-ScheduledTaskAction -Execute 'powershell.exe' `
  -Argument '-NoProfile -ExecutionPolicy Bypass -File "D:\erp\backup-pull\backup-pull.ps1"'
$trigger = New-ScheduledTaskTrigger -Daily -At 2:00am
Register-ScheduledTask -TaskName 'ERP Backup' -Action $action -Trigger $trigger `
  -RunLevel Highest -Description 'Keo backup ERP offsite'
```

## 5. Khôi phục (restore)

DB (custom-format → cần `pg_restore`):
```bash
# Tao DB rong roi restore (--clean de drop object cu neu restore de):
pg_restore --no-owner --no-acl -d "postgresql://user:pass@host:5432/erp_restore" \
  erp-db-<ts>.dump
```

Files:
```bash
mkdir -p /data/uploads && tar -xzf erp-uploads-<ts>.tar.gz -C /data/uploads
```

## 6. Kiểm tra / khắc phục

- Test endpoint thủ công:
  ```bash
  curl -fsS -H "X-API-Key: sk_..." -H 'Content-Type: application/json' \
    -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"backup_info","arguments":{}}}' \
    https://erp.vfmgroup.vn/mcp/backup
  ```
  Trả `sizeBytes`, `tableCount`, `uploads.fileCount` → so với kích thước file tải về.
- `401 Invalid API key` → sai/key bị tắt. `403 Thiếu scope backup:full` → key chưa có `backup:full`.
- `404` → server chưa deploy bản có `/mcp/backup`, hoặc nginx chưa reload path mới.
- DB dump rất nhỏ/0 byte → `pg_dump` lỗi trên server (xem log container server: `[mcp/backup] pg_dump ...`).

## Cơ chế

- Tải vào file `.part` rồi đổi tên (atomic) → không giữ bản tải dở.
- Xoay vòng: giữ `KEEP` bản mới nhất **mỗi loại**, xoá phần cũ hơn.
- `uploads` trả **HTTP 204** khi chưa có file nào → script bỏ qua, không coi là lỗi.
