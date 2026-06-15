#!/usr/bin/env bash
# =============================================================
# prod-sample-dump.sh — Trich SAMPLE tu PG prod (schema-only + N% dong
# moi nhat moi bang) -> /tmp/erp-sample.sql.gz de tai ve local test.
#
# CHAY BEN TRONG container Postgres prod (Coolify). Tren server:
#   C=$(docker ps --filter ancestor=pgvector/pgvector:pg18 --format '{{.Names}}' | head -1)
#   docker cp tooling/prod-sample-dump.sh "$C":/tmp/
#   docker exec -e SAMPLE_PCT=10 "$C" bash /tmp/prod-sample-dump.sh   # 10% moi bang
#   docker cp "$C":/tmp/erp-sample.sql.gz ./erp-sample.sql.gz
# (SAMPLE_PCT=% (mac dinh 10); SAMPLE_MIN=san toi thieu (1000);
#  SAMPLE_N=so dong co dinh (de ep thay vi %).)
#
# Ghi chu:
# - "latest" lay theo ctid DESC (xap xi dong chen sau cung) vi cac bang
#   khong co cot thoi gian chung.
# - n moi bang = max(SAMPLE_MIN, ceil(reltuples*PCT/100)) -> bang nho/
#   config lay HET (nho san MIN), bang lon lay PCT%.
# - Bang cau hinh (entities/pages/legacy_menu_map/users/viewer_groups...)
#   thuong < N nen duoc copy DAY DU -> /portal render dung.
# - Load dung session_replication_role=replica -> bo qua FK khi sample
#   thieu cha-con. pgboss bi loai (server tu tao lai).
# - Gom ca drizzle.__drizzle_migrations de local biet migration da apply.
# =============================================================
set -euo pipefail

# Mac dinh: PCT% dong MOI NHAT moi bang, san toi thieu MIN (bang nho/
# config -> lay HET nho san MIN). Dat SAMPLE_N de ep so dong co dinh.
PCT="${SAMPLE_PCT:-10}"
MIN="${SAMPLE_MIN:-1000}"
FIXED="${SAMPLE_N:-}"
export PGUSER="${POSTGRES_USER:-erp}"
export PGPASSWORD="${POSTGRES_PASSWORD:-}"
export PGDATABASE="${POSTGRES_DB:-erp_framework}"
export PGHOST=127.0.0.1
OUT=/tmp/erp-sample.sql

echo "== 1/2 schema-only (tru pgboss) =="
pg_dump --schema-only -N pgboss --no-owner --no-privileges -f "$OUT"

DESC_LABEL=$([ -n "$FIXED" ] && echo "co dinh $FIXED dong" || echo "${PCT}% (san $MIN)")
echo "== 2/2 data: latest $DESC_LABEL moi bang (public + drizzle) =="
{
  echo ""
  echo "-- ===== DATA (latest $DESC_LABEL /bang) ====="
  echo "SET session_replication_role = replica;"
} >> "$OUT"

psql -Atq -c "SELECT schemaname||'.'||tablename FROM pg_tables WHERE schemaname IN ('public','drizzle') ORDER BY 1" \
| while read -r rel; do
  [ -z "$rel" ] && continue
  schema="${rel%%.*}"
  tbl="${rel#*.}"
  if [ -n "$FIXED" ]; then
    n="$FIXED"
  else
    # Uoc luong so dong tu pg_class.reltuples (tuc thoi, KHONG scan) ->
    # n = max(MIN, ceil(reltuples*PCT/100)). Bang nho -> MIN (lay het).
    n=$(psql -Atq -c "SELECT GREATEST($MIN, ceil(GREATEST(c.reltuples,0)*$PCT/100.0)::bigint) FROM pg_class c JOIN pg_namespace nsp ON nsp.oid=c.relnamespace WHERE nsp.nspname='$schema' AND c.relname='$tbl'")
    [ -z "$n" ] && n="$MIN"
  fi
  echo "COPY \"$schema\".\"$tbl\" FROM stdin;" >> "$OUT"
  psql -q -c "\copy (SELECT * FROM \"$schema\".\"$tbl\" ORDER BY ctid DESC LIMIT $n) TO STDOUT" >> "$OUT"
  echo "\\." >> "$OUT"
  echo "  - $rel (n=$n)" >&2
done

echo "SET session_replication_role = origin;" >> "$OUT"
gzip -f "$OUT"
echo "✓ Xong: ${OUT}.gz ($(du -h "${OUT}.gz" | cut -f1))"
