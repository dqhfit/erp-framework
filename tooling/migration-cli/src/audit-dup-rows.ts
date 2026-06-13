/* ==========================================================
   audit-dup-rows.ts — Quét row TRÙNG theo PK nguồn trên mọi entity
   tier=table (hậu quả import worker bị deploy giết giữa batch rồi
   resume re-đọc: INSERT lại row đã có → trùng f_id).

   Với mỗi entity tier=table: tìm cột PK nguồn (ưu tiên f_id, fallback
   cột f_* đầu) → count(*) vs count(DISTINCT pk) qua migration_query_readonly.

   Chạy: MIGRATION_MCP_KEY=... node --env-file=packages/server/.env \
     --import tsx tooling/migration-cli/src/audit-dup-rows.ts
   Output: migration-plan/ui/dup-rows.json + stdout.
   ========================================================== */

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

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

async function main() {
  const ents = await mcp<Array<{ name: string }>>("entity_list", { storageTier: "table" });
  const dups: Array<{ entity: string; table: string; total: number; distinct: number }> = [];
  for (const e of ents) {
    try {
      const detail = await mcp<{
        storageColumns: Record<string, { col: string }> | null;
        storageTableName?: string;
      }>("entity_get", { name: e.name });
      const cols = detail.storageColumns ?? {};
      const tbl = detail.storageTableName ?? e.name;
      // PK nguồn: field "id" nếu có cột, fallback bỏ qua (composite check riêng)
      const pkCol = cols.id?.col;
      if (!pkCol) continue;
      // COALESCE(...,'') để khớp ngữ nghĩa dedup (PK NULL/'' là 1 nhóm
      // riêng, KHÔNG phải trùng). count(DISTINCT col) trần bỏ qua NULL →
      // 1 row NULL-id báo giả +1 (vd tr_nguyenlieu_gva có 1 row id NULL).
      const r = await mcp<{ rows: Array<{ tong: string; dist: string }> }>(
        "migration_query_readonly",
        {
          sql: `SELECT count(*) AS tong, count(DISTINCT COALESCE("${pkCol}"::text, '')) AS dist FROM "${tbl}" WHERE deleted_at IS NULL`,
        },
      );
      const row = r.rows?.[0];
      if (!row) continue;
      const total = Number(row.tong);
      const dist = Number(row.dist);
      if (total !== dist) {
        dups.push({ entity: e.name, table: tbl, total, distinct: dist });
        console.log(`DUP ${e.name}: ${total} row / ${dist} distinct (+${total - dist})`);
      }
    } catch (err) {
      console.warn(`skip ${e.name}: ${(err as Error).message.slice(0, 120)}`);
    }
  }
  writeFileSync(
    resolve(process.cwd(), "migration-plan/ui/dup-rows.json"),
    JSON.stringify({ count: dups.length, dups }, null, 1),
    "utf8",
  );
  console.log(`\n=== ${dups.length} bảng có row trùng (chi tiết dup-rows.json) ===`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
