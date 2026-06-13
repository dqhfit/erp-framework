/* ==========================================================
   fix-ds-joins.mts — Sửa DataSource codegen lỗi hệ thống:
   1. Relation trỏ bảng CHI TIẾT (target *_chitiet/_chi_tiet/_detail/_dtail)
      = join 1-nhiều → NỔ cartesian (vd ds_dondathang 10.9M dòng cùng 1 maddh).
      DataSource list phải many-to-one → BỎ các relation đó + field nguồn từ
      chúng. Chi tiết hiển thị qua collection widget riêng, không flatten.
   2. Field key/sourceField CHỮ HOA (vd IsLock — stale trước normalize) →
      resolver SQL-join reject identifier. BỎ field (bản lowercase đã có).

   dryRun mặc định. --apply để ghi (qua datasource_create_draft overwrite).
   Chạy (cwd packages/server):
     MIGRATION_MCP_KEY=... npx tsx ../../tooling/ui-migration/fix-ds-joins.mts [--apply]
   ========================================================== */
const MCP_URL = process.env.MIGRATION_MCP_URL ?? "https://erp.vfmgroup.vn/mcp/migration";
const KEY = process.env.MIGRATION_MCP_KEY ?? "";
if (!KEY) {
  console.error("Thiếu MIGRATION_MCP_KEY");
  process.exit(1);
}
const APPLY = process.argv.includes("--apply");
const DETAIL_RE = /(_chitiet|_chi_tiet|_detail|_dtail)$/i;

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

interface Relation {
  id?: string;
  targetEntityId: string;
  [k: string]: unknown;
}
interface Field {
  key?: string;
  sourceField?: string;
  sourceRelationId?: string;
  [k: string]: unknown;
}
interface DsConfig {
  baseEntityId?: string;
  relations?: Relation[];
  fields?: Field[];
  [k: string]: unknown;
}

async function main() {
  // entity id → name (xác định target là bảng chi tiết).
  const ents = await query<{ id: string; name: string }>(`SELECT id, name FROM entities`);
  const nameById = new Map(ents.map((e) => [e.id, e.name]));

  // Tên DS có relation (query nhỏ). Config lấy TỪNG DS (query_readonly cắt
  // >150KB — config nhiều field gộp lại vượt ngưỡng → phải fetch lẻ).
  const dsNames = await query<{ name: string }>(
    `SELECT name FROM datasources WHERE COALESCE(jsonb_array_length(config->'relations'),0) > 0 ORDER BY name`,
  );

  let fixed = 0;
  for (const { name } of dsNames) {
    const [meta] = await query<{ label: string; icon: string | null; config: string }>(
      `SELECT label, icon, config::text AS config FROM datasources WHERE name = '${name.replace(/'/g, "''")}'`,
    );
    if (!meta?.config) {
      console.log(`${name}: BỎ QUA (config quá lớn >150KB, không đọc được qua query_readonly)`);
      continue;
    }
    const d = { name, label: meta.label, icon: meta.icon };
    const cfg = JSON.parse(meta.config) as DsConfig;
    const rels = cfg.relations ?? [];
    const dropRelIds = new Set<string>();
    const dropRelLabels: string[] = [];
    for (const r of rels) {
      const tname = nameById.get(r.targetEntityId) ?? "";
      if (DETAIL_RE.test(tname)) {
        if (r.id) dropRelIds.add(r.id);
        dropRelLabels.push(tname);
      }
    }
    // Relation enrichment phải LEFT — INNER lọc rớt base row khi join key
    // không khớp (codegen dùng inner → list rỗng sạch). Chuyển inner→left.
    let innerToLeft = 0;
    const newRels = rels
      .filter((r) => !(r.id && dropRelIds.has(r.id)))
      .map((r) => {
        if (r.joinKind === "inner") {
          innerToLeft++;
          return { ...r, joinKind: "left" };
        }
        return r;
      });
    // Field: bỏ field nguồn từ relation đã drop + field key/sourceField CHỮ HOA.
    const fields = cfg.fields ?? [];
    const upper: string[] = [];
    const newFields = fields.filter((f) => {
      if (f.sourceRelationId && dropRelIds.has(f.sourceRelationId)) return false;
      const hasUpper = /[A-Z]/.test(String(f.key ?? "")) || /[A-Z]/.test(String(f.sourceField ?? ""));
      if (hasUpper) {
        upper.push(String(f.key));
        return false;
      }
      return true;
    });

    if (dropRelIds.size === 0 && upper.length === 0 && innerToLeft === 0) continue;
    fixed++;
    console.log(
      `${d.name}: bỏ ${dropRelIds.size} relation chi-tiết [${dropRelLabels.join(", ")}]${upper.length ? `, bỏ ${upper.length} field hoa [${upper.join(", ")}]` : ""}${innerToLeft ? `, inner→left ${innerToLeft}` : ""} | rel ${rels.length}→${newRels.length}, field ${fields.length}→${newFields.length}`,
    );

    if (APPLY) {
      const nextCfg = { ...cfg, relations: newRels, fields: newFields };
      const r = await mcp<{ status: string }>("datasource_create_draft", {
        name: d.name,
        label: d.label,
        ...(d.icon ? { icon: d.icon } : {}),
        config: nextCfg,
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
