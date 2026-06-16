#!/usr/bin/env bash
# =============================================================
# local-sample-load-host.sh — Nap file sample (tu prod-sample-dump.sh)
# vao Postgres chay TRUC TIEP TREN HOST (KHONG Docker). Dung cho may dev
# theo che do no-Docker (xem CLAUDE.md): Postgres 18 + pgvector cai san
# tren host, KHONG co container `erp-framework-db-1`.
#
# Khac local-sample-load.sh (ban Docker): script nay goi `psql` host
# truc tiep qua DATABASE_URL, KHONG `docker exec`.
#
# Chay tren MAY DEV:
#   bash tooling/local-sample-load-host.sh ./erp-sample.sql.gz [erp_sample]
#
# Tham so 2 = ten DB dich (mac dinh erp_sample). Giu DB erp_framework cu
# de quay lai de dang. Sau khi nap, tro local .env sang DB dich:
#   packages/server/.env  + packages/db/.env:
#   DATABASE_URL=postgres://<user>:<pass>@127.0.0.1:5432/<TARGET>
# =============================================================
set -euo pipefail

FILE="${1:?Thieu duong dan file .sql.gz}"
TARGET="${2:-erp_sample}"
[ -f "$FILE" ] || { echo "✗ Khong thay file: $FILE"; exit 1; }

# Lay DATABASE_URL local de muon host/port/user/pass (nap vao DB 'postgres'
# de tao DB dich, roi nap dump vao DB dich). Doc tu packages/server/.env.
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC_URL="$(grep -E '^DATABASE_URL=' "$ROOT/packages/server/.env" | head -1 | cut -d= -f2-)"
[ -n "$SRC_URL" ] || { echo "✗ Khong doc duoc DATABASE_URL o packages/server/.env"; exit 1; }

# Tach phan truoc ten DB → dung de noi toi DB 'postgres' va DB dich.
# postgres://user:pass@host:port/dbname?query  →  base=postgres://user:pass@host:port
BASE="${SRC_URL%%\?*}"          # bo query string (?sslmode=...)
QS=""; case "$SRC_URL" in *\?*) QS="?${SRC_URL#*\?}";; esac
BASE_NOPATH="${BASE%/*}"        # bo /dbname cuoi
ADMIN_URL="${BASE_NOPATH}/postgres${QS}"
TARGET_URL="${BASE_NOPATH}/${TARGET}${QS}"

echo "== tao lai DB $TARGET (host psql) =="
psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -c \
  "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='$TARGET'" >/dev/null 2>&1 || true
psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS \"$TARGET\""
psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -c "CREATE DATABASE \"$TARGET\""

echo "== nap dump (ON_ERROR_STOP=0 — bang loi le te van tiep tuc) =="
gunzip -c "$FILE" | psql "$TARGET_URL" -v ON_ERROR_STOP=0 -q 2>&1 \
  | grep -iE 'error' | head -40 || true

echo "== reset sequence __drizzle_migrations (dump COPY id nhung khong day seq) =="
# Neu khong reset → migration moi (server boot) insert id trung → duplicate key
# pkey → server CRASH luc runMigrations. Day seq len max(id).
psql "$TARGET_URL" -v ON_ERROR_STOP=0 -q -c \
  "SELECT setval('drizzle.__drizzle_migrations_id_seq', (SELECT coalesce(max(id),1) FROM drizzle.__drizzle_migrations));" >/dev/null 2>&1 || true

echo "== bu record_locator tu cac bang hybrid (dump SAMPLE locator → thieu) =="
# record_locator map recordId→entity cho op chi-co-recordId (get/update/delete).
# Dump lay mau bang nay (rat lon) nen thieu → Sua/Xoa/get theo id hong. Dung lai
# tu chinh cac bang hybrid (id + company_id co san), idempotent.
psql "$TARGET_URL" -v ON_ERROR_STOP=0 -q <<'SQL' 2>&1 | grep -iE 'notice|error' | head
DO $$
DECLARE r record; n bigint; total bigint := 0;
BEGIN
  FOR r IN SELECT id AS entity_id, meta->'storage'->>'tableName' AS tbl
           FROM entities WHERE meta->'storage'->>'tier'='table'
             AND coalesce(meta->'storage'->>'tableName','') <> '' LOOP
    IF to_regclass('public.'||quote_ident(r.tbl)) IS NULL THEN CONTINUE; END IF;
    EXECUTE format('INSERT INTO record_locator (id, company_id, entity_id) '
      'SELECT id, company_id, %L::uuid FROM public.%I ON CONFLICT (id) DO NOTHING',
      r.entity_id, r.tbl);
    GET DIAGNOSTICS n = ROW_COUNT; total := total + n;
  END LOOP;
  RAISE NOTICE 'locator backfill: % dong', total;
END $$;
SQL

echo "== kiem tra =="
psql "$TARGET_URL" -At -c "SELECT 'entities=' || count(*) FROM entities" 2>/dev/null || echo "(entities?)"
psql "$TARGET_URL" -At -c "SELECT 'pages='    || count(*) FROM pages"    2>/dev/null || echo "(pages?)"
psql "$TARGET_URL" -At -c "SELECT 'tr_hehang records=' || count(*) FROM entity_records r JOIN entities e ON e.id=r.entity_id WHERE e.name='tr_hehang'" 2>/dev/null || true
echo ""
echo "✓ Xong. Tro local .env (server + db) sang DB nay roi pnpm dev:"
echo "  DATABASE_URL=${BASE_NOPATH}/${TARGET}${QS}"
