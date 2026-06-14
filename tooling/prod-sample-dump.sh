#!/usr/bin/env bash
# =============================================================
# prod-sample-dump.sh — Trich SAMPLE tu PG prod (schema-only + latest-N
# moi bang) -> /tmp/erp-sample.sql.gz de tai ve local test.
#
# CHAY BEN TRONG container Postgres prod (Coolify). Tren server:
#   C=$(docker ps --filter ancestor=pgvector/pgvector:pg18 --format '{{.Names}}' | head -1)
#   docker cp tooling/prod-sample-dump.sh "$C":/tmp/
#   docker exec -e SAMPLE_N=1000 "$C" bash /tmp/prod-sample-dump.sh
#   docker cp "$C":/tmp/erp-sample.sql.gz ./erp-sample.sql.gz
# (Roi tai erp-sample.sql.gz ve may dev, dua cho tool nap.)
#
# Ghi chu:
# - "latest" lay theo ctid DESC (xap xi dong chen sau cung) vi cac bang
#   khong co cot thoi gian chung. Bang nho (<N dong) -> lay het.
# - Bang cau hinh (entities/pages/legacy_menu_map/users/viewer_groups...)
#   thuong < N nen duoc copy DAY DU -> /portal render dung.
# - Load dung session_replication_role=replica -> bo qua FK khi sample
#   thieu cha-con. pgboss bi loai (server tu tao lai).
# - Gom ca drizzle.__drizzle_migrations de local biet migration da apply.
# =============================================================
set -euo pipefail

N="${SAMPLE_N:-1000}"
export PGUSER="${POSTGRES_USER:-erp}"
export PGPASSWORD="${POSTGRES_PASSWORD:-}"
export PGDATABASE="${POSTGRES_DB:-erp_framework}"
export PGHOST=127.0.0.1
OUT=/tmp/erp-sample.sql

echo "== 1/2 schema-only (tru pgboss) =="
pg_dump --schema-only -N pgboss --no-owner --no-privileges -f "$OUT"

echo "== 2/2 data: latest $N moi bang (public + drizzle) =="
{
  echo ""
  echo "-- ===== DATA (latest $N/bang) ====="
  echo "SET session_replication_role = replica;"
} >> "$OUT"

psql -Atq -c "SELECT schemaname||'.'||tablename FROM pg_tables WHERE schemaname IN ('public','drizzle') ORDER BY 1" \
| while read -r rel; do
  [ -z "$rel" ] && continue
  schema="${rel%%.*}"
  tbl="${rel#*.}"
  echo "COPY \"$schema\".\"$tbl\" FROM stdin;" >> "$OUT"
  psql -q -c "\copy (SELECT * FROM \"$schema\".\"$tbl\" ORDER BY ctid DESC LIMIT $N) TO STDOUT" >> "$OUT"
  echo "\\." >> "$OUT"
  echo "  - $rel" >&2
done

echo "SET session_replication_role = origin;" >> "$OUT"
gzip -f "$OUT"
echo "✓ Xong: ${OUT}.gz ($(du -h "${OUT}.gz" | cut -f1))"
