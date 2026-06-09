# Lưu trữ HYBRID (bảng thật + JSONB) — kiến trúc & checklist bật cờ

> Trạng thái: Phase 0–4b XONG, **verify trên Postgres thật** qua integration test
> `hybrid-storage.db.test.ts` (7/7: CRUD bảng thật, promote EAV→table, JOIN SQL gỡ
> giới hạn v1, scanBackRefs/cascade, tree CTE, search_tsv full-text, demote rollback).
> Mọi vùng cross-entity/peripheral đã table-aware (§4). Vận hành: script
> `promote-entity.ts`/`demote-entity.ts` + endpoint `entities.promoteToTable`/
> `demoteToEav` + nút "Bảng thật" trong Entity Designer. Còn 1 giới hạn: migration
> re-import SAU promote. **Mặc định TẮT** (`ERP_HYBRID_TABLES` không set/≠`1`) → chạy
> EAV như cũ. ⚠️ Trước bật cờ production: kiểm UI + bảo mật (§5).

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
- **REST API** (`rest-api.ts`), **GraphQL** (`graphql.ts`), **Procedure runner**
  (`procedure-runner.ts`: queryRecords/findById/insert/update/delete) — list/get/
  create/update/delete record route qua `RecordStore` (dispatch EAV/bảng thật);
  get/update/delete kiểm `entityId` scope qua row trả về. (q full-text trên bảng thật
  bỏ qua; containment filter của procedure → equality, đủ cho scalar.) Mock test bổ
  sung `.limit().offset()` để test store-based list. 322 unit test xanh.

- **Tree** (`record-tree.ts`) — descendants/ancestors: EAV CTE trên `entity_records`;
  table → CTE trên `er_<id>` (cột FK/ext) lấy id+level + reconstruct `data` qua store.
  `records-router` gọi `recordTree`. Integration test 5/5.
- **Duplicate detection** (`duplicate-detection.ts`) — entity table-backed: full-scan
  cap 2000 qua store (reconstruct data) + Levenshtein JS (không trigram); EAV giữ trigram.
- **Transfer** (`transfer.ts`) — CHỈ bundle metadata (entities/pages/workflows/agents),
  KHÔNG gồm record data → không bị ảnh hưởng (no-op).
- **search_tsv cho `er_*`** — `meta.storage.searchable` (field searchable=true);
  `TableRecordStore` set `search_tsv = to_tsvector` lúc insert/replace + recompute khi
  merge chạm field searchable; `list(q)` dùng `search_tsv @@ websearch_to_tsquery`;
  index GIN; promote copy cũng set tsv. Full-text q chạy trên bảng thật. Integration 7/7.
- **Demote / rollback** (`entity-promote.ts:demoteEntityToEav`) — copy `er_<id>` ngược
  vào `entity_records` (upsert giữ id/version/ts), xoá `meta.storage` + locator + DROP
  `er_`. Endpoint `entities.demoteToEav` + script `demote-entity.ts`.

### ⚠️ Giới hạn đã biết (không chặn bật cờ, nhưng cần biết)
- **Migration full-import** (`migration-full-import.ts`) — tạo entity qua insert trực
  tiếp (KHÔNG set `meta.storage`) → entity import luôn EAV → thao tác `entity_records`
  ĐÚNG. Giới hạn: promote entity đó lên bảng thật rồi re-import → cần route qua store
  (chưa làm; hiếm).
- `resolveGet` (1 record, write-back) vẫn batch-stitch (giữ `__ids`) — không ảnh hưởng.

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
