/* ==========================================================
   data.ts — ETL bulk-read từ MSSQL → upsert vào entity_records.

   Workflow:
     1. Đọc manifest → list bảng + mapTo.
     2. Với mỗi bảng (hoặc --table cụ thể): bulkRead từ MSSQL, chuyển
        mỗi row sang { data: <jsonb> } theo mapTo, upsert vào
        entity_records (resolve entityId từ entity name + companyId).
     3. Track row count + error.

   Hiện tại: scaffold — implement sau khi có package server connect
   PG và schemaVersion convention cuối cùng. Lab đầu cấp mssql-client
   API + manifest parser đầy đủ rồi.
   ========================================================== */

import { MssqlClient } from "@erp-framework/mssql-client";
import { readManifest } from "./manifest.js";

export interface DataOptions {
  module: string;
  /** Chọn nhiều bảng. Nếu rỗng → ETL toàn bộ bảng trong manifest. */
  tables?: string[];
  /** @deprecated dùng tables[] thay; vẫn nhận để tương thích ngược CLI. */
  table?: string;
  limit: number;
  /** Inject client từ worker. CLI standalone sẽ dùng fromEnv(). */
  mssqlClient?: MssqlClient;
}

export async function runData(opts: DataOptions): Promise<void> {
  const m = readManifest(opts.module);
  const filterList =
    opts.tables && opts.tables.length > 0
      ? opts.tables.map((s) => s.toLowerCase())
      : opts.table
        ? [opts.table.toLowerCase()]
        : null;
  const tables = filterList
    ? m.tables.filter((t) => filterList.includes(t.name.toLowerCase()))
    : m.tables;
  if (tables.length === 0) {
    console.error(`✗ Không có bảng nào khớp --tables=${(opts.tables ?? []).join(",")}`);
    process.exit(1);
  }

  console.log(`▸ ETL module "${opts.module}" — ${tables.length} bảng, limit=${opts.limit}`);
  const ownedClient = !opts.mssqlClient;
  const client = opts.mssqlClient ?? MssqlClient.fromEnv();
  if (ownedClient) await client.connect();
  try {
    for (const t of tables) {
      console.log(`  - ${t.name} → entity ${t.suggestedEntityName}`);
      const rows = await client.bulkRead(t.name, { limit: opts.limit });
      console.log(`    Read ${rows.length} rows.`);
      // TODO: connect PG (qua @erp-framework/db), resolve entityId, upsert.
      console.log(
        `    TODO: upsert vào entity_records. Cần: (1) PG connection, ` +
          `(2) chọn company_id target, (3) áp dụng mapTo để transform.`,
      );
    }
  } finally {
    if (ownedClient) await client.close();
  }
}
