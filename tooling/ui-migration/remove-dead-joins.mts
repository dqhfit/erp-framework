/* ==========================================================
   remove-dead-joins.mts — Bỏ relation DataSource KHỚP 0% (join key sai /
   target rỗng), đọc từ join-key-report.json (flag RED). Hầu hết là
   <người tạo> → sys_user.username — SYS_USER bị skip khi migrate nên
   join người-tạo DQHF không khớp gì. Page đã wire dùng field base raw
   (create_by...) nên relation này là dead weight → bỏ + field nguồn từ nó.

   dryRun mặc định. --apply để ghi (datasource_create_draft overwrite).
   Chạy (cwd packages/server):
     MIGRATION_MCP_KEY=... npx tsx ../../tooling/ui-migration/remove-dead-joins.mts [--apply]
   ========================================================== */
import { readFileSync } from "node:fs";
import { join as pjoin } from "node:path";

const ERP_ROOT = "D:/code/cowok/Apps/erp-framework";
const MCP_URL = process.env.MIGRATION_MCP_URL ?? "https://erp.vfmgroup.vn/mcp/migration";
const KEY = process.env.MIGRATION_MCP_KEY ?? "";
if (!KEY) {
  console.error("Thiếu MIGRATION_MCP_KEY");
  process.exit(1);
}
const APPLY = process.argv.includes("--apply");

let rpc = 0;
async function mcp<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const res = await fetch(MCP_URL, {
    method: "POST",
    headers: { "X-API-Key": KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpc, method: "tools/call", params: { name, arguments: args } }),
  });
  const j = (await res.json()) as {
    error?: { message: string };
    result?: { content?: Array<{ text?: string }>; isError?: boolean };
  };
  if (j.error || j.result?.isError) throw new Error(j.error?.message ?? j.result?.content?.[0]?.text ?? "mcp error");
  return JSON.parse(j.result?.content?.[0]?.text ?? "null") as T;
}
async function query<T = Record<string, unknown>>(sql: string): Promise<T[]> {
  return (await mcp<{ rows: T[] }>("migration_query_readonly", { sql })).rows ?? [];
}

interface RedRel {
  ds: string;
  fromField: string;
  targetId: string;
  toField: string;
  flag: string;
}

async function main() {
  const { report } = JSON.parse(
    readFileSync(pjoin(ERP_ROOT, "migration-plan/ui/join-key-report.json"), "utf8"),
  ) as { report: RedRel[] };
  const red = report.filter((r) => r.flag === "RED");
  // Gom theo DS: tập (fromField|targetId) cần bỏ.
  const byDs = new Map<string, Set<string>>();
  for (const r of red) {
    const s = byDs.get(r.ds) ?? new Set<string>();
    s.add(`${r.fromField}|${r.targetId}`);
    byDs.set(r.ds, s);
  }

  let fixed = 0;
  for (const [dsName, keys] of byDs) {
    const [meta] = await query<{ label: string; icon: string | null; config: string }>(
      `SELECT label, icon, config::text AS config FROM datasources WHERE name='${dsName.replace(/'/g, "''")}'`,
    );
    if (!meta?.config) {
      console.log(`${dsName}: BỎ QUA (config >150KB)`);
      continue;
    }
    const cfg = JSON.parse(meta.config) as {
      relations?: Array<{ id?: string; fromField?: string; targetEntityId?: string }>;
      fields?: Array<{ sourceRelationId?: string }>;
      [k: string]: unknown;
    };
    const rels = cfg.relations ?? [];
    const dropIds = new Set<string>();
    const dropLabels: string[] = [];
    for (const r of rels) {
      if (keys.has(`${r.fromField}|${r.targetEntityId}`)) {
        if (r.id) dropIds.add(r.id);
        dropLabels.push(`${r.fromField}→${(r.targetEntityId ?? "").slice(0, 8)}`);
      }
    }
    const newRels = rels.filter((r) => !(r.id && dropIds.has(r.id)));
    const fields = cfg.fields ?? [];
    const newFields = fields.filter((f) => !(f.sourceRelationId && dropIds.has(f.sourceRelationId)));
    if (dropIds.size === 0) {
      console.log(`${dsName}: không khớp relation nào (đã bỏ trước?)`);
      continue;
    }
    fixed++;
    console.log(`${dsName}: bỏ ${dropIds.size} relation dead [${dropLabels.join(", ")}] | rel ${rels.length}→${newRels.length}, field ${fields.length}→${newFields.length}`);
    if (APPLY) {
      const r = await mcp<{ status: string }>("datasource_create_draft", {
        name: dsName,
        label: meta.label,
        ...(meta.icon ? { icon: meta.icon } : {}),
        config: { ...cfg, relations: newRels, fields: newFields },
        overwrite: true,
      });
      console.log(`    → ${r.status}`);
    }
  }
  console.log(`\n${APPLY ? "Đã sửa" : "Sẽ sửa"}: ${fixed} DataSource`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
