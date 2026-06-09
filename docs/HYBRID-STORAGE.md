# Lưu trữ HYBRID (bảng thật + JSONB) — kiến trúc & checklist bật cờ

> Trạng thái: Phase 0–3 IMPL XONG + Phase 4 một phần. **Mặc định TẮT**
> (`ERP_HYBRID_TABLES` không set / ≠ `1`) → toàn bộ chạy EAV như cũ.
> ⚠️ **Nhánh bảng thật CHƯA verify trên Postgres** — đọc mục "Kiểm thử e2e"
> trước khi bật cờ ở bất kỳ môi trường nào.

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

## 4. ⚠️ CÒN EAV-ONLY — phải xử lý TRƯỚC khi bật cờ ở production

Khi cờ bật + có entity tier='table', các vùng sau đọc/ghi thẳng `entity_records`
→ **bỏ sót / sai** với record ở bảng thật. Đánh dấu `TODO(hybrid Phase 4)` trong code.

| Vùng | File | Hậu quả khi bật cờ | Hướng sửa |
|---|---|---|---|
| **scanBackRefs / applyCascadeOnDelete** | `router-helpers.ts` | Lookup từ/đến entity table-backed KHÔNG bị phát hiện → xoá nhầm (restrict bỏ qua) / orphan ref (setnull/cascade không chạy). **Integrity.** | Quét cả `er_*` (cột FK / `ext->field @>` cho multilookup); setnull/cascade UPDATE er_*. |
| **descendants / ancestors** (tree CTE) | `records-router.ts` | CTE chạy trên `entity_records` → entity table-backed trả rỗng. | CTE biến thể trên `er_<id>` dùng cột FK. |
| **REST API** | `rest-api.ts` | list/get/create/patch trên `entity_records` → entity table-backed sai/rỗng. | Route qua `RecordStore`. |
| **GraphQL** | `graphql.ts` | Như REST. | Route qua `RecordStore`. |
| **Procedure runner** (`db.queryRecords` isolated-vm) | `procedure-runner.ts` | `data @> filter` trên entity_records → sai cho table. | Dịch filter qua store / column. |
| **Duplicate detection** | `duplicate-detection.ts` | `similarity(data::text,...)` + field lookup trên entity_records → sai. | Ghép `data` từ cột+ext / chạy trên er_*. |
| **Embeddings** | `record-embedding.ts` | `entity_record_embeddings.record_id` FK→`entity_records.id` → record table-backed **vi phạm FK** (best-effort nên nuốt lỗi, embedding không index). | Bỏ FK (cột uuid trơn) hoặc skip cho entity table-backed. |
| **Backup / Transfer** | `backup.ts`, `transfer.ts` | KHÔNG gồm `er_*` → **mất dữ liệu khi restore**. Nguy hiểm nhất. | Liệt kê + dump/restore mọi bảng `er_*` + `record_locator`. |
| **Migration full-import** | `migration-full-import.ts` | `data->>pk` lookup + insert trên entity_records → sai cho table. | Route qua store. |

Ngoài ra: **search_tsv** cho `er_*` chưa dựng (trigger) → full-text `q` trên
table-base bị bỏ qua (resolver fallback). `resolveGet` (1 record, write-back) vẫn
batch-stitch (giữ `__ids`).

## 5. Kiểm thử e2e trên Postgres (BẮT BUỘC trước khi bật cờ)

Toàn bộ nhánh bảng thật mới chỉ qua typecheck + unit test logic thuần (column map,
DDL gen, eligibility, render SQL qua PgDialect). Chưa chạy DDL/CRUD thật. Trước khi
`ERP_HYBRID_TABLES=1`:

1. Lên DB (`pnpm db:up`) + migrate (gồm 0070). `ERP_HYBRID_TABLES=1`.
2. Tạo entity mới → kiểm `er_<id>` được tạo đúng cột (psql `\d`).
3. CRUD record qua tRPC: create/get/list (filter+sort base)/update/soft-delete/restore.
   So với hành vi EAV.
4. `promoteToTable` một entity EAV có sẵn dữ liệu → so `count(*)` `entity_records`
   vs `er_<id>`; so vài record (id/version/data giữ nguyên; encrypted vẫn ở ext).
5. `save` thêm/xoá field; `renameField`; `changeFieldType` (text↔number, column↔ext)
   → kiểm cột ALTER + dữ liệu.
6. DataSource join 2 entity table-backed: filter/sort **field JOIN** trên tập > limit
   → kết quả ĐÚNG (gỡ v1) + so thời gian vs batch-stitch.
7. Bảo mật: viewer bị strip field → không lọt qua cả 2 backend; filter/sort field
   encrypted → fallback (không SQL trên ciphertext).

## 6. Lệnh hữu ích

- Bật: `ERP_HYBRID_TABLES=1` (env server).
- Unit test logic: `pnpm --filter @erp-framework/server test entity-table-ddl datasource-sql-join record-store`.
- Xem bảng động: psql `\dt er_*`.
