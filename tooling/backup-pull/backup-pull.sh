#!/usr/bin/env bash
# ==========================================================
# backup-pull.sh — Kéo backup TOÀN BỘ dữ liệu ERP về máy OFFSITE.
# Chỉ cần `curl` (không cần Node, psql, hay quyền vào DB). Gọi MCP backup
# trên server prod qua X-API-Key:
#   - GET /mcp/backup/db      -> pg_dump custom-format (mọi tenant)
#   - GET /mcp/backup/uploads -> tar.gz thư mục file tải lên
# Lưu vào OUT_DIR theo timestamp + xoay vòng giữ KEEP bản mới nhất mỗi loại.
# Dùng với cron/systemd timer (xem README.md). Exit != 0 nếu lỗi (cho cron báo).
# ==========================================================
set -euo pipefail

# Nạp cấu hình: .env cạnh script (nếu có) rồi tới biến môi trường.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -f "${BACKUP_ENV:-$SCRIPT_DIR/.env}" ]; then
  # shellcheck disable=SC1090
  set -a; . "${BACKUP_ENV:-$SCRIPT_DIR/.env}"; set +a
fi

SERVER_URL="${SERVER_URL:?Thieu SERVER_URL (vd https://erp.vfmgroup.vn)}"
API_KEY="${API_KEY:?Thieu API_KEY (sk_... scope backup:full)}"
OUT_DIR="${OUT_DIR:-$SCRIPT_DIR/backups}"
KEEP="${KEEP:-14}"            # so ban moi nhat giu lai moi loai
TIMEOUT="${TIMEOUT:-1800}"    # giay, toi da cho 1 lan tai (DB lon -> tang)

SERVER_URL="${SERVER_URL%/}"  # bo dau / cuoi
mkdir -p "$OUT_DIR"
TS="$(date -u +%Y%m%dT%H%M%SZ)"
log() { printf '%s %s\n' "$(date -u +%FT%TZ)" "$*"; }

# curl chung: fail tren HTTP>=400, theo redirect, retry mang.
curl_dl() {
  curl -fSL --retry 3 --retry-delay 5 --max-time "$TIMEOUT" \
    -H "X-API-Key: $API_KEY" "$@"
}

# --- 0) Verify ket noi + log dung luong du kien (best-effort) ---
if info="$(curl -fsS --max-time 60 -H "X-API-Key: $API_KEY" \
    -H 'Content-Type: application/json' \
    -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"backup_info","arguments":{}}}' \
    "$SERVER_URL/mcp/backup" 2>/dev/null)"; then
  log "backup_info: $(printf '%s' "$info" | tr -d '\n' | cut -c1-400)"
else
  log "WARN: backup_info that bai (van tiep tuc tai)."
fi

fail=0

# --- 1) DB dump (pg_dump -Fc) ---
db_tmp="$OUT_DIR/.erp-db-$TS.dump.part"
db_out="$OUT_DIR/erp-db-$TS.dump"
log "Tai DB dump -> $db_out"
if curl_dl "$SERVER_URL/mcp/backup/db" -o "$db_tmp"; then
  # pg_dump custom-format luon > 100 byte; 0/qua nho = hong.
  sz=$(wc -c < "$db_tmp" | tr -d ' ')
  if [ "$sz" -gt 100 ]; then
    mv -f "$db_tmp" "$db_out"
    log "OK DB dump: ${sz} byte"
  else
    log "ERROR: DB dump qua nho (${sz} byte) — bo."
    rm -f "$db_tmp"; fail=1
  fi
else
  log "ERROR: tai DB dump that bai."
  rm -f "$db_tmp"; fail=1
fi

# --- 2) Uploads (tar.gz). HTTP 204 = khong co file -> bo qua, khong loi ---
up_tmp="$OUT_DIR/.erp-uploads-$TS.tar.gz.part"
up_out="$OUT_DIR/erp-uploads-$TS.tar.gz"
log "Tai uploads -> $up_out"
code="$(curl -sL --retry 3 --retry-delay 5 --max-time "$TIMEOUT" \
  -H "X-API-Key: $API_KEY" -o "$up_tmp" -w '%{http_code}' \
  "$SERVER_URL/mcp/backup/uploads" || echo 000)"
case "$code" in
  200)
    sz=$(wc -c < "$up_tmp" | tr -d ' ')
    if [ "$sz" -gt 20 ]; then mv -f "$up_tmp" "$up_out"; log "OK uploads: ${sz} byte";
    else log "ERROR: uploads qua nho (${sz} byte)."; rm -f "$up_tmp"; fail=1; fi ;;
  204) log "uploads: khong co file (204) — bo qua."; rm -f "$up_tmp" ;;
  *)   log "ERROR: uploads HTTP $code."; rm -f "$up_tmp"; fail=1 ;;
esac

# --- 3) Xoay vong: giu KEEP ban moi nhat moi loai ---
rotate() {
  local pat="$1" n=0
  # Liet ke moi->cu theo mtime; xoa tu ban thu KEEP+1.
  ls -1t "$OUT_DIR"/$pat 2>/dev/null | while IFS= read -r f; do
    n=$((n+1)); [ "$n" -gt "$KEEP" ] && { rm -f "$f"; log "Xoay vong: xoa $f"; }
  done
}
rotate 'erp-db-*.dump'
rotate 'erp-uploads-*.tar.gz'

if [ "$fail" -ne 0 ]; then log "HOAN TAT VOI LOI."; exit 1; fi
log "HOAN TAT OK."
