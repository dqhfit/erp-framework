/* ==========================================================
   audit-field-gaps.ts — Quét lệch FIELD giữa entity prod và cột nguồn
   MSSQL: prepare full-import TÁI DÙNG entity cũ (dedup theo bảng nguồn)
   mà KHÔNG bổ sung field mới → import lọc data theo fieldsSet cũ → cột
   nguồn không có field bị VỨT im lặng (vd tr_dongia_nguyenlieu_gva mất
   dongia/gianhap → mọi tính giá = 0).

   Với mỗi entity tier=table có meta.sync/source bảng nguồn cùng tên:
   getTable MSSQL → cột usable (loại binary/rowversion) → so với
   entities.fields (lowercase) → liệt kê cột THIẾU.

   Chạy: MIGRATION_MCP_KEY=... node --env-file=packages/server/.env \
     --import tsx tooling/migration-cli/src/audit-field-gaps.ts
   Output: migration-plan/ui/field-gaps.json + stdout.
   ========================================================== */

import { writeFileSync } from "node:fs";
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

async function main() {
  const ents = await mcp<Array<{ name: string }>>("entity_list", { storageTier: "table" });
  const c = MssqlClient.fromEnv();
  await c.connect();
  const gaps: Array<{
    entity: string;
    missing: Array<{ name: string; label: string; type: string }>;
    schemaGap?: string[];
    rowsInMssql: number;
  }> = [];
  try {
    const tables = await c.listTables("dbo");
    const byLower = new Map(tables.map((t) => [t.name.toLowerCase(), t.name]));
    for (const e of ents) {
      const src = byLower.get(e.name.toLowerCase());
      if (!src) continue; // entity không map 1-1 bảng nguồn (er_, đặt tên khác)
      const info = await c.getTable("dbo", src);
      if (!info) continue;
      const detail = await mcp<{
        fields: Array<{ name: string; type: string }>;
        storageColumns: Record<string, { col: string }> | null;
      }>("entity_get", { name: e.name });
      const have = new Set(detail.fields.map((f) => f.name.toLowerCase()));
      const usable = info.columns.filter(
        (col) => !/^(varbinary|image|timestamp|rowversion)$/i.test(col.dataType),
      );
      const missing = usable
        .filter((col) => !have.has(col.name.toLowerCase()))
        .map((col) => ({
          name: col.name.toLowerCase(),
          label: col.name,
          type: mapType(col.dataType),
        }));

      // GAP loại 2 (ca tr_dongia_nguyenlieu_gva): field CÓ trong entities.fields
      // nhưng THIẾU trong storage.columns (fields update sau promote, không
      // sync schema) → import vứt giá trị, không vào cả ext.
      const COLUMN_TYPES = new Set([
        "text",
        "number",
        "boolean",
        "date",
        "datetime",
        "select",
        "enum",
        "sequence",
        "relation",
        "lookup",
      ]);
      const colKeys = new Set(Object.keys(detail.storageColumns ?? {}));
      const schemaGap = detail.fields
        .filter((f) => COLUMN_TYPES.has(f.type) && !colKeys.has(f.name))
        .map((f) => f.name);

      if (missing.length > 0 || schemaGap.length > 0) {
        const n = await c.query<{ n: number }>(`SELECT COUNT(*) AS n FROM dbo.[${src}]`);
        gaps.push({
          entity: e.name,
          missing,
          schemaGap,
          rowsInMssql: Number(n[0]?.n ?? 0),
        } as (typeof gaps)[number] & { schemaGap: string[] });
        console.log(
          `${e.name}: thiếu-field=${missing.map((m) => m.name).join(",") || "-"} | thiếu-cột(schema)=${schemaGap.join(",") || "-"}`,
        );
      }
    }
  } finally {
    await c.close();
  }
  writeFileSync(
    resolve(process.cwd(), "migration-plan/ui/field-gaps.json"),
    JSON.stringify({ count: gaps.length, gaps }, null, 1),
    "utf8",
  );
  console.log(`\n=== ${gaps.length} entity thiếu field (chi tiết field-gaps.json) ===`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
