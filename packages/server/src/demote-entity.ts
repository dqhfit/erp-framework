/* ==========================================================
   demote-entity.ts — CLI một-lần: ROLLBACK entity bảng thật → EAV.
   Copy er_<id> ngược vào entity_records, xoá meta.storage + locator + DROP er_.
   Chạy (cờ phải bật trong env):
     ERP_HYBRID_TABLES=1 DATABASE_URL=postgres://... \
       pnpm --filter @erp-framework/server exec tsx src/demote-entity.ts <companyId> <entityId>
   Backup DB TRƯỚC khi chạy. Xem docs/HYBRID-STORAGE.md.
   ========================================================== */
import { db } from "./db";
import { demoteEntityToEav } from "./entity-promote";

const [companyId, entityId] = process.argv.slice(2);
if (!companyId || !entityId) {
  console.error("Usage: tsx src/demote-entity.ts <companyId> <entityId>");
  process.exit(1);
}
demoteEntityToEav(db, companyId, entityId)
  .then((r) => console.log(JSON.stringify(r, null, 2)))
  .catch((e) => {
    console.error((e as Error).message ?? e);
    process.exitCode = 1;
  })
  .finally(() => process.exit(process.exitCode ?? 0));
