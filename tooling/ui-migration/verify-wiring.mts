/* ==========================================================
   verify-wiring.mts — Verify các DataSource đã wire (batch hướng B) resolve
   ĐÚNG: preview thật qua datasource_preview, báo cột null nhiều (join gãy /
   thiếu data). Đọc wiring-proposal.json để biết DS + setFields đã áp.

   Cờ cột: nullRatio > 0.8 trên mẫu → CẢNH BÁO (cột join có thể không khớp).
   Chạy (cwd packages/server):
     MIGRATION_MCP_KEY=... npx tsx ../../tooling/ui-migration/verify-wiring.mts
   ========================================================== */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ERP_ROOT = "D:/code/cowok/Apps/erp-framework";
const MCP_URL = process.env.MIGRATION_MCP_URL ?? "https://erp.vfmgroup.vn/mcp/migration";
const KEY = process.env.MIGRATION_MCP_KEY ?? "";
if (!KEY) {
  console.error("Thiếu MIGRATION_MCP_KEY");
  process.exit(1);
}

let rpc = 0;
async function mcp<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const res = await fetch(MCP_URL, {
    method: "POST",
    headers: { "X-API-Key": KEY, "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: ++rpc,
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

interface Prop {
  dataSource: string;
  matchType: string;
  setFields: string[];
}

async function main() {
  const { proposal } = JSON.parse(
    readFileSync(join(ERP_ROOT, "migration-plan/ui/wiring-proposal.json"), "utf8"),
  ) as { proposal: Prop[] };

  // Gom field theo DataSource (union setFields của các page đã áp, ngưỡng >=6).
  const fieldsByDs = new Map<string, Set<string>>();
  for (const p of proposal) {
    if (p.matchType !== "title" || p.setFields.length < 6) continue;
    const s = fieldsByDs.get(p.dataSource) ?? new Set<string>();
    for (const f of p.setFields) s.add(f);
    fieldsByDs.set(p.dataSource, s);
  }

  console.log(`Verify ${fieldsByDs.size} DataSource đã wire:\n`);
  const warnings: string[] = [];
  for (const [dsName, fields] of fieldsByDs) {
    try {
      const fieldList = [...fields];
      const o = await mcp<{
        total: number;
        sampled: number;
        nullCount: Record<string, number>;
      }>("datasource_preview", { dataSourceName: dsName, limit: 10, fields: fieldList });
      if (o.sampled === 0) {
        console.log(`  ${dsName}: total=0 (KHÔNG có dòng — không verify được)`);
        continue;
      }
      const heavy = fieldList.filter((f) => (o.nullCount[f] ?? 0) / o.sampled > 0.8);
      const flag = heavy.length ? ` ⚠ null>80%: [${heavy.join(", ")}]` : " ✓";
      console.log(`  ${dsName}: total=${o.total} mẫu=${o.sampled}${flag}`);
      if (heavy.length) warnings.push(`${dsName}: ${heavy.join(", ")}`);
    } catch (e) {
      console.log(`  ✗ ${dsName}: ${(e as Error).message}`);
      warnings.push(`${dsName}: LỖI ${(e as Error).message}`);
    }
  }
  console.log(`\n=== ${warnings.length} cảnh báo cột join null nhiều ===`);
  for (const w of warnings) console.log(`  ${w}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
