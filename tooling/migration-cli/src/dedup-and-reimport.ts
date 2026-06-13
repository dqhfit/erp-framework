/* ==========================================================
   dedup-and-reimport.ts — Bước chữa sau khi vá bug import trùng:
   1. migration_dedup_rows cho các bảng dính dup (dryRun đếm → xoá thật),
      danh sách đọc từ migration-plan/ui/dup-rows.json.
   2. Dựng items cho TOÀN BỘ entity tier=table khớp tên bảng MSSQL dbo
      (lower(cột), loại binary, PK 1-3 cột) → migration_start_full_import.
      Upsert refresh lấp giá trị bị vứt bởi lớp lỗi "import lúc entity
      fields cũ" (GVA mất dongia, tr_dinhmuc_lock mất islock) + kéo data
      mới. Script START job rồi THOÁT — theo dõi job bằng poll riêng.

   Chạy: MIGRATION_MCP_KEY=... node --env-file=packages/server/.env \
     --import tsx tooling/migration-cli/src/dedup-and-reimport.ts
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

async function main() {
  /* ── 1. Dedup (tuần tự — chạy song song lock nhau) ── */
  const dupFile = JSON.parse(
    readFileSync(resolve(process.cwd(), "migration-plan/ui/dup-rows.json"), "utf8"),
  ) as { dups: Array<{ entity: string }> };
  for (const d of dupFile.dups) {
    const dry = await mcp<{ duplicates: number }>("migration_dedup_rows", {
      entityName: d.entity,
      dryRun: true,
    });
    if (dry.duplicates === 0) {
      console.log(`dedup ${d.entity}: 0 bản sao — bỏ qua`);
      continue;
    }
    const del = await mcp<{ deleted: number; locatorsRemoved: number }>("migration_dedup_rows", {
      entityName: d.entity,
      dryRun: false,
    });
    console.log(
      `dedup ${d.entity}: dryRun=${dry.duplicates} → xoá ${del.deleted} row + ${del.locatorsRemoved} locator`,
    );
  }

  /* ── 2. Items toàn bộ entity tier=table khớp bảng nguồn ── */
  const ents = await mcp<Array<{ name: string }>>("entity_list", { storageTier: "table" });
  const mssql = MssqlClient.fromEnv();
  await mssql.connect();
  let items: Array<{
    tableName: string;
    entityName: string;
    label: string;
    fields: Array<{ name: string; label: string; type: string }>;
  }>;
  const skipped: string[] = [];
  try {
    const tables = await mssql.listTables("dbo");
    const byLower = new Map(tables.map((t) => [t.name.toLowerCase(), t.name]));
    items = [];
    for (const e of ents) {
      const real = byLower.get(e.name.toLowerCase());
      if (!real) continue; // entity không map 1-1 bảng nguồn
      const info = await mssql.getTable("dbo", real);
      if (!info || info.primaryKey.length < 1 || info.primaryKey.length > 3) {
        skipped.push(`${e.name} (PK)`);
        continue;
      }
      const usable = info.columns.filter(
        (c) => !/^(varbinary|image|timestamp|rowversion)$/i.test(c.dataType),
      );
      items.push({
        tableName: `dbo.${real}`,
        entityName: e.name.toLowerCase(),
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
  console.log(`items: ${items.length} bảng | bỏ qua: ${skipped.join(", ") || "-"}`);
  if (items.length === 0) return;

  /* ── 3. Start jobs theo CHUNK 40 bảng — payload 200 bảng vượt body limit
     nginx (trả HTML thay JSON). pg-boss xử lý tuần tự nên enqueue hết một
     lượt vẫn an toàn. KHÔNG poll ở đây — job chạy dài, theo dõi riêng. ── */
  const conns = await mcp<Array<{ id: string }>>("migration_list_connections", {});
  if (!conns[0]) throw new Error("Không có connection MSSQL");
  const CHUNK = 40;
  for (let i = 0; i < items.length; i += CHUNK) {
    const chunk = items.slice(i, i + CHUNK);
    const { jobId } = await mcp<{ jobId: string }>("migration_start_full_import", {
      connectionId: conns[0].id,
      items: chunk,
      targetTier: "table",
    });
    console.log(
      `JOB_STARTED ${jobId} (${chunk.length} bảng: ${chunk[0]?.entityName} … ${chunk[chunk.length - 1]?.entityName})`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
