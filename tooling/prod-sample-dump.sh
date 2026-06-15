#!/usr/bin/env bash
# =============================================================
# prod-sample-dump.sh — Trich SAMPLE tu PG prod (schema-only + bang NHO
# dump HET, bang LON lay N%) -> /tmp/erp-sample.sql.gz de tai ve test.
#
# CHAY BEN TRONG container Postgres prod (Coolify). Tren server:
#   C=$(docker ps --filter ancestor=pgvector/pgvector:pg18 --format '{{.Names}}' | head -1)
#   docker cp tooling/prod-sample-dump.sh "$C":/tmp/
#   docker exec "$C" bash /tmp/prod-sample-dump.sh   # mac dinh: <=50k full, >50k 10%
#   docker cp "$C":/tmp/erp-sample.sql.gz ./erp-sample.sql.gz
# (SAMPLE_FULL_MAX=nguong "nho" (mac dinh 50000); SAMPLE_PCT=% cho bang
#  lon (10); SAMPLE_N=so dong co dinh moi bang (ep thay vi nguong/%).)
#
# Ghi chu:
# - "latest" lay theo ctid DESC (xap xi dong chen sau cung) vi cac bang
#   khong co cot thoi gian chung.
# - n moi bang: reltuples <= FULL_MAX -> HET; lon hon -> ceil(reltuples
#   *PCT/100). => bang nho/config DAY DU, bang lon lay PCT%.
# - Bang cau hinh (entities/pages/legacy_menu_map/users/viewer_groups...)
#   thuong < N nen duoc copy DAY DU -> /portal render dung.
# - Load dung session_replication_role=replica -> bo qua FK khi sample
#   thieu cha-con. pgboss bi loai (server tu tao lai).
# - Gom ca drizzle.__drizzle_migrations de local biet migration da apply.
# - GIOI HAN: COPY text-format hiem khi loi "extra data after last
#   expected column" o vai bang (vd co tsvector/vector hoac text co ky tu
#   dac biet). Bang do se rong sau khi nap. Fix gon bang custom-format:
#     ssh <server> "docker exec <prod-pg> sh -c 'PGPASSWORD=\$POSTGRES_PASSWORD \
#       pg_dump -Fc --data-only --no-owner -t public.<BANG> -h 127.0.0.1 \
#       -U \$POSTGRES_USER \$POSTGRES_DB'" | docker exec -i -e PGPASSWORD=erp \
#       <local-pg> pg_restore --data-only --disable-triggers --no-owner \
#       -h 127.0.0.1 -U erp -d <local-db>
# =============================================================
set -euo pipefail

# Mac dinh: bang NHO (<= FULL_MAX dong) dump HET; bang LON (> FULL_MAX)
# lay PCT% dong MOI NHAT. Dat SAMPLE_N de ep so dong co dinh moi bang.
PCT="${SAMPLE_PCT:-10}"
FULL_MAX="${SAMPLE_FULL_MAX:-50000}"
FIXED="${SAMPLE_N:-}"
export PGUSER="${POSTGRES_USER:-erp}"
export PGPASSWORD="${POSTGRES_PASSWORD:-}"
export PGDATABASE="${POSTGRES_DB:-erp_framework}"
export PGHOST=127.0.0.1
OUT=/tmp/erp-sample.sql

echo "== 1/2 schema-only (tru pgboss) =="
pg_dump --schema-only -N pgboss --no-owner --no-privileges -f "$OUT"

DESC_LABEL=$([ -n "$FIXED" ] && echo "co dinh $FIXED dong" || echo "bang <=$FULL_MAX: FULL; lon hon: ${PCT}%")
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
    # reltuples (uoc luong, KHONG scan): <= FULL_MAX -> lay HET (LIMIT
    # 2e9); lon hon -> ceil(reltuples*PCT/100).
    n=$(psql -Atq -c "SELECT CASE WHEN GREATEST(c.reltuples,0) <= $FULL_MAX THEN 2000000000 ELSE ceil(c.reltuples*$PCT/100.0)::bigint END FROM pg_class c JOIN pg_namespace nsp ON nsp.oid=c.relnamespace WHERE nsp.nspname='$schema' AND c.relname='$tbl'")
    [ -z "$n" ] && n=2000000000
  fi
  echo "COPY \"$schema\".\"$tbl\" FROM stdin;" >> "$OUT"
  psql -q -c "\copy (SELECT * FROM \"$schema\".\"$tbl\" ORDER BY ctid DESC LIMIT $n) TO STDOUT" >> "$OUT"
  echo "\\." >> "$OUT"
  echo "  - $rel (n=$n)" >&2
done

echo "SET session_replication_role = origin;" >> "$OUT"
gzip -f "$OUT"
echo "✓ Xong: ${OUT}.gz ($(du -h "${OUT}.gz" | cut -f1))"
