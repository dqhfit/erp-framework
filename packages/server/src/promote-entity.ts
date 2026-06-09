/* ==========================================================
   promote-entity.ts — CLI một-lần: nâng entity EAV → bảng thật (HYBRID).
   Chạy (cờ phải bật trong env):
     ERP_HYBRID_TABLES=1 DATABASE_URL=postgres://... \
       pnpm --filter @erp-framework/server exec tsx src/promote-entity.ts <companyId> <entityId>
   Lấy id: psql `SELECT id,slug FROM companies;` + `SELECT id,name FROM entities;`.
   Backup DB TRƯỚC khi chạy. Xem docs/HYBRID-STORAGE.md.
   ========================================================== */
import { db } from "./db";
import { promoteEntityToTable } from "./entity-promote";

const [companyId, entityId] = process.argv.slice(2);
if (!companyId || !entityId) {
  console.error("Usage: tsx src/promote-entity.ts <companyId> <entityId>");
  process.exit(1);
}
promoteEntityToTable(db, companyId, entityId)
  .then((r) => console.log(JSON.stringify(r, null, 2)))
  .catch((e) => {
    console.error((e as Error).message ?? e);
    process.exitCode = 1;
  })
  .finally(() => process.exit(process.exitCode ?? 0));
