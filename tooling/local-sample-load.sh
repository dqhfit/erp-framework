#!/usr/bin/env bash
# =============================================================
# local-sample-load.sh — Nap file sample (tu prod-sample-dump.sh) vao
# DB Postgres LOCAL (container docker dev) de test offline.
#
# Chay tren MAY DEV:
#   bash tooling/local-sample-load.sh ./erp-sample.sql.gz [erp_sample] [erp-framework-db-1]
#
# Sau khi nap, tro local .env sang DB dich de test:
#   packages/server/.env  + packages/db/.env:
#   DATABASE_URL=postgres://erp:erp@localhost:5433/<TARGET>
# (giu DB erp_framework cu de quay lai de dang.)
# =============================================================
set -euo pipefail

FILE="${1:?Thieu duong dan file .sql.gz}"
TARGET="${2:-erp_sample}"
PGC="${3:-erp-framework-db-1}"
[ -f "$FILE" ] || { echo "✗ Khong thay file: $FILE"; exit 1; }

psqlc() { docker exec -e PGPASSWORD=erp "$PGC" psql -U erp -h 127.0.0.1 "$@"; }

echo "== refresh collation (tranh mismatch khi CREATE DATABASE) =="
psqlc -d postgres -c "ALTER DATABASE template1 REFRESH COLLATION VERSION" >/dev/null 2>&1 || true

echo "== tao lai DB $TARGET =="
psqlc -d postgres -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='$TARGET'" >/dev/null 2>&1 || true
psqlc -d postgres -c "DROP DATABASE IF EXISTS \"$TARGET\""
psqlc -d postgres -c "CREATE DATABASE \"$TARGET\""

echo "== nap dump (ON_ERROR_STOP=0 — bang loi le te van tiep tuc) =="
gunzip -c "$FILE" | docker exec -i -e PGPASSWORD=erp "$PGC" \
  psql -U erp -h 127.0.0.1 -d "$TARGET" -v ON_ERROR_STOP=0 -q 2>&1 \
  | grep -iE 'error' | head -40 || true

echo "== kiem tra =="
psqlc -d "$TARGET" -At -c "SELECT 'entities=' || count(*) FROM entities" 2>/dev/null || echo "(entities?)"
psqlc -d "$TARGET" -At -c "SELECT 'pages=' || count(*) FROM pages" 2>/dev/null || echo "(pages?)"
psqlc -d "$TARGET" -At -c "SELECT 'public_tables=' || count(*) FROM information_schema.tables WHERE table_schema='public'" 2>/dev/null || true
echo ""
echo "✓ Xong. Tro local .env sang DB nay roi pnpm dev:"
echo "  DATABASE_URL=postgres://erp:erp@localhost:5433/$TARGET"
