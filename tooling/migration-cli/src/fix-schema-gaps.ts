/* ==========================================================
   fix-schema-gaps.ts — Chữa schema-drift một lượt:
   1. Đọc migration-plan/ui/field-gaps.json (output audit-field-gaps.ts)
      → gọi migration_sync_entity_schema bổ sung field thiếu cho từng
      entity (merge fields + ADD cột typed + merge meta.storage).
   2. Dựng items cho các bảng bị ảnh hưởng (+ bảng truyền thêm qua argv,
      vd tr_dongia_nguyenlieu_gva — fields đã đủ nhưng data import cũ bị
      lọc rớt) từ schema MSSQL (lower(cột), loại binary).
   3. migration_start_full_import → poll tới khi job kết thúc.
      Upsert theo PK nguồn nên re-import idempotent — refresh giá trị
      các field trước đây bị fieldsSet cũ vứt.

   Chạy: MIGRATION_MCP_KEY=... node --env-file=packages/server/.env \
     --import tsx tooling/migration-cli/src/fix-schema-gaps.ts [bảng-thêm ...]
   ========================================================== */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { MssqlClient } from "@erp-framework/mssql-client";

const MCP_URL = process.env.MIGRATION_MCP_URL ?? "https://erp.vfmgroup.vn/mcp/migration";
const KEY = process.env.MIGRATION_MCP_KEY ?? "";
if (!KEY) {
  console.error("Thiếu MIGRATION_MCP_KEY");
  process.exit(1);
}

let id = 0;
async function mcp<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const res = await fetch(MCP_URL, {
    method: "POST",
    headers: { "X-API-Key": KEY, "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: ++id,
      method: "tools/call",
      params: { name, arguments: args },
    }),
  });
  const j = (await res.json()) as {
    error?: { message: string };
    result?: { content?: Array<{ text?: string }>; isError?: boolean };
  };
  if (j.error || j.result?.isError) {
    throw new Error(j.error?.message ?? j.result?.content?.[0]?.text ?? "mcp error");
  }
  return JSON.parse(j.result?.content?.[0]?.text ?? "null") as T;
}

function mapType(dt: string): string {
  const d = dt.toLowerCase();
  if (
    [
      "int",
      "bigint",
      "smallint",
      "tinyint",
      "decimal",
      "numeric",
      "money",
      "smallmoney",
      "float",
      "real",
    ].includes(d)
  )
    return "number";
  if (d === "bit") return "boolean";
  if (d === "date") return "date";
  if (["datetime", "datetime2", "smalldatetime", "datetimeoffset"].includes(d)) return "datetime";
  return "text";
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const gapsFile = JSON.parse(
    readFileSync(resolve(process.cwd(), "migration-plan/ui/field-gaps.json"), "utf8"),
  ) as {
    gaps: Array<{ entity: string; missing: Array<{ name: string; label: string; type: string }> }>;
  };

  /* ── 1. sync schema từng entity ── */
  for (const g of gapsFile.gaps) {
    const r = await mcp<{ addedFields: string[]; columnsBefore: number; columnsAfter: number }>(
      "migration_sync_entity_schema",
      { entityName: g.entity, addFields: g.missing },
    );
    console.log(
      `sync ${g.entity}: +field[${r.addedFields.join(",") || "-"}] cột ${r.columnsBefore}→${r.columnsAfter}`,
    );
  }

  /* ── 2. dựng items: bảng audit + bảng thêm từ argv ── */
  const wanted = [
    ...new Set([...gapsFile.gaps.map((g) => g.entity), ...process.argv.slice(2)]),
  ].map((s) => s.toLowerCase());
  const mssql = MssqlClient.fromEnv();
  await mssql.connect();
  let items: Array<{
    tableName: string;
    entityName: string;
    label: string;
    fields: Array<{ name: string; label: string; type: string }>;
  }>;
  try {
    const tables = await mssql.listTables("dbo");
    const byLower = new Map(tables.map((t) => [t.name.toLowerCase(), t.name]));
    items = [];
    for (const want of wanted) {
      const real = byLower.get(want);
      if (!real) {
        console.warn(`BỎ QUA ${want}: không có trong MSSQL`);
        continue;
      }
      const info = await mssql.getTable("dbo", real);
      if (!info || info.primaryKey.length < 1 || info.primaryKey.length > 3) {
        console.warn(`BỎ QUA ${want}: PK không stream được`);
        continue;
      }
      const usable = info.columns.filter(
        (c) => !/^(varbinary|image|timestamp|rowversion)$/i.test(c.dataType),
      );
      items.push({
        tableName: `dbo.${real}`,
        entityName: want,
        label: real,
        fields: usable.map((c) => ({
          name: c.name.toLowerCase(),
          label: c.name,
          type: mapType(c.dataType),
        })),
      });
    }
  } finally {
    await mssql.close();
  }
  if (items.length === 0) {
    console.log("Không có bảng nào để re-import.");
    return;
  }

  /* ── 3. start import + poll ── */
  const conns = await mcp<Array<{ id: string; kind?: string; name?: string }>>(
    "migration_list_connections",
    {},
  );
  const conn = conns[0];
  if (!conn) throw new Error("Không có connection MSSQL trên prod");
  const { jobId } = await mcp<{ jobId: string }>("migration_start_full_import", {
    connectionId: conn.id,
    items,
    targetTier: "table",
  });
  console.log(`Job ${jobId} — ${items.length} bảng: ${items.map((i) => i.entityName).join(", ")}`);

  for (;;) {
    await sleep(15_000);
    const job = await mcp<{
      status: string;
      message?: string | null;
      tables?: Array<{ tableName: string; status: string; rowsImported?: number }>;
    }>("migration_get_full_job", { jobId });
    const done = (job.tables ?? []).filter((t) => t.status === "done").length;
    console.log(`  ${job.status} — ${done}/${items.length} bảng xong`);
    if (["done", "failed", "paused", "partial"].includes(job.status)) {
      for (const t of job.tables ?? []) {
        console.log(`  ${t.tableName}: ${t.status} (${t.rowsImported ?? 0} rows)`);
      }
      if (job.message) console.log(`  message: ${job.message}`);
      break;
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
