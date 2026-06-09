# Lưu trữ HYBRID (bảng thật + JSONB) — kiến trúc & checklist bật cờ

> Trạng thái: Phase 0–3 XONG + đã **verify trên Postgres thật** qua integration
> test `hybrid-storage.db.test.ts` (3/3 pass: CRUD bảng thật, promote EAV→table,
> JOIN SQL gỡ giới hạn v1). Phase 4 một phần (xem §4). **Mặc định TẮT**
> (`ERP_HYBRID_TABLES` không set / ≠ `1`) → toàn bộ chạy EAV như cũ.
> ⚠️ Vẫn cần xử lý §4 (cross-entity/peripheral) + kiểm tra UI/bảo mật (§5)
> trước khi bật cờ ở production.

## 1. Mục tiêu

Chuyển dữ liệu người dùng từ **thuần-EAV** (mọi record mọi entity trong 1 bảng
`entity_records`, field ở cột `data jsonb`) sang **HYBRID**: mỗi entity được
"nâng cấp" có **bảng Postgres thật** `er_<hex(entityId)>` với **cột typed** cho
field cốt lõi + cột **`ext jsonb`** cho field mở rộng.

- **Opt-in**: entity cũ giữ EAV; entity mới (khi cờ bật) hoặc entity được
  `promoteToTable` mới dùng bảng thật. Hai storage chạy song song.
- **Tách cột theo loại field**: vô hướng + quan hệ đơn (`text/number/boolean/
  date/datetime/select/enum/sequence/relation/lookup`) → cột typed; đa-trị +
  tính toán (`multiselect/multienum/multilookup/collection/rollup/formula/json`)
  + field `encrypted` → `ext`; `timeseries` → bảng phụ.
- **Mapping bảo thủ**: chỉ `number→numeric`, `boolean→boolean`; còn lại (gồm
  `date/datetime/relation/lookup`) → `text` (tránh lỗi coerce — xem CLAUDE.md
  bài học #9). Tinh chỉnh range về sau.

## 2. Thành phần

| File | Vai trò |
|---|---|
| `packages/server/src/record-store.ts` | Seam `RecordStore` (đọc/ghi record 1 entity). `EavRecordStore` (entity_records) + `TableRecordStore` (er_*) + `DispatchRecordStore` (route theo `meta.storage` + `record_locator`). `getRecordStore(db)` — cờ tắt → EAV thẳng. |
| `packages/server/src/entity-table-ddl.ts` | DDL động: `buildColumnMap`, `createTableDDL`/`indexDDL`, `ensureEntityTable` (advisory-lock), `syncEntityTableSchema` (ADD/DROP), `applyFieldChange` (type / column↔ext), `renameFieldOnTable`. `assertIdent` chống injection. |
| `packages/server/src/entity-promote.ts` | `promoteEntityToTable` — copy EAV→table (giữ id/version/timestamp/ext), ghi locator, flip `meta.storage`. |
| `packages/server/src/datasource-sql-join.ts` | `tryBuildJoinQuery` — JOIN SQL thật cho DataSource khi đủ điều kiện; `projectJoinRow` (decrypt/RBAC/computed). |
| `record_locator` (migration 0070) | id→entityId cho record tier='table' (định tuyến op chỉ-recordId). |
| `entities.meta.storage` | `{ tier:'table', tableName, columns:{field→{col,pgType}}, version }`. |

## 3. ĐÃ table-aware (an toàn khi bật cờ)

- ✅ Records CRUD/list/get/bulk/export, soft-delete/restore/hardDelete — qua `RecordStore`.
- ✅ DataSource resolver `resolveList` — nhánh JOIN SQL thật (gỡ giới hạn v1: filter/sort
  field JOIN đúng trên toàn tập); fallback batch-stitch khi không đủ điều kiện.
- ✅ `assertUnique` — qua `store.existsWithFieldValue` (dispatch đúng backend).
- ✅ Entity lifecycle: tạo entity mới (tạo bảng), `save` (ADD/DROP cột),
  `renameField`, `changeFieldType` (type / column↔ext), `promoteToTable`.

## 4. Phase 4b — cross-entity/peripheral

### ✅ Đã xử lý + verify
- **scanBackRefs / applyCascadeOnDelete** (`router-helpers.ts`) — detection
  backend-aware (`refRecordIds` quét `er_*`: cột FK / `ext @>` cho multilookup);
  GHI qua `RecordStore` (truyền store vào → tránh import cycle). Delete-protection
  (restrict/setnull/cascade) chạy đúng cho entity bảng thật. Integration test 4/4.
- **Aux-table FK** (migration `0071`) — bỏ FK `record_id → entity_records.id` ở 5 bảng
  (`entity_record_embeddings`, `record_field_ops`, `record_presence`,
  `entity_record_versions`, `entity_record_timeseries`) → record bảng thật ghi được
  (embeddings/version/timeseries/presence/co-edit không còn vi phạm FK); `company_id`
  FK giữ → xoá công ty vẫn cascade dọn. Đánh đổi: hard-delete 1 record không auto-
  cascade bảng phụ (soft-delete không ảnh hưởng; hard-delete là op admin hiếm).
- **Backup** (`backup.ts`) — `pg_dump -Fc` toàn DB → `er_*` + `record_locator` tự gồm.

### ⚠️ CÒN LẠI — xử lý TRƯỚC khi bật cờ ở production
| Vùng | File | Hậu quả khi bật cờ | Hướng sửa |
|---|---|---|---|
| **descendants / ancestors** (tree CTE) | `records-router.ts` | CTE trên `entity_records` → entity table-backed trả rỗng. | CTE biến thể trên `er_<id>` (cột FK) + reconstruct `data` qua store. |
| **REST API** | `rest-api.ts` | list/get/create/patch trên `entity_records` → table-backed sai/rỗng. | Route qua `RecordStore`. |
| **GraphQL** | `graphql.ts` | Như REST. | Route qua `RecordStore`. |
| **Procedure runner** (`db.queryRecords`) | `procedure-runner.ts` | `data @> filter` → sai cho table. | Route qua `store.list`. |
| **Duplicate detection** | `duplicate-detection.ts` | `similarity(data::text,…)` → sai. | Ghép `data` từ cột+ext / chạy `er_*`. |
| **Migration full-import** | `migration-full-import.ts` | `data->>pk` + insert → sai cho table. | Route qua store. |
| **Transfer** | `transfer.ts` | có thể không gồm `er_*`. | Kiểm + gồm `er_*` + `record_locator` nếu cần. |

Ngoài ra: **search_tsv** cho `er_*` chưa dựng (trigger) → full-text `q` trên
table-base bị bỏ qua (resolver fallback). `resolveGet` (1 record, write-back) vẫn
batch-stitch (giữ `__ids`).

## 5. Kiểm thử trên Postgres

**Integration test tự động** `packages/server/src/hybrid-storage.db.test.ts` —
verify core Phase 1–3 (Phase 1 CRUD bảng thật + reconstruct + locator + unique;
Phase 2 promote EAV→table; Phase 3 JOIN SQL filter field-JOIN trên toàn tập). BỎ QUA
mặc định; chạy khi có DB:

```
pnpm db:up && pnpm --filter @erp-framework/db migrate   # hoặc 1 container throwaway
HYBRID_DB=1 ERP_HYBRID_TABLES=1 \
  DATABASE_URL=postgres://erp:erp@localhost:5433/erp_framework \
  pnpm --filter @erp-framework/server exec vitest run hybrid-storage.db
```

✅ Đã chạy 3/3 pass trên pgvector pg18 (2026-06-09). Test tự tạo + dọn sạch
company/entity/record + DROP bảng `er_*` (an toàn chạy trên DB chia sẻ).

**Còn lại — kiểm thủ công trước production** (chưa tự động hoá):
- `renameField` / `changeFieldType` (text↔number, column↔ext) trên bảng thật.
- Bảo mật: viewer bị strip field → không lọt; filter/sort field `encrypted` → fallback
  (không SQL trên ciphertext).
- Các vùng §4 (cross-entity/peripheral) khi đã làm Phase 4b.

## 6. Lệnh hữu ích

- Bật: `ERP_HYBRID_TABLES=1` (env server).
- Unit test logic: `pnpm --filter @erp-framework/server test entity-table-ddl datasource-sql-join record-store`.
- Xem bảng động: psql `\dt er_*`.
