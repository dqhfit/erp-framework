/* ==========================================================
   gen-datasources.ts — Sinh + tạo hàng loạt DataSource trên prod từ
   datasource-clusters.json (pattern pilot ds_tonkho_vattu).

   Mỗi BASE (gộp mọi cụm cùng base):
   - entity base phải tồn tại trên prod (entity_get) — thiếu → skip.
   - mỗi bảng join: parse cạnh ON "X.col1 = Y.col2" → xác định
     fromField (trên base/cha) vs toField (trên đích) bằng cách đối
     chiếu tên field với entities.fields hai phía; bảng join thiếu
     entity → skip riêng bảng đó (warn), DS vẫn tạo.
   - projection: TOÀN BỘ field base (key = tên field) + toàn bộ field
     đích (key = <alias>_<field>, dedupe) — user prune trong designer.
   - tạo qua MCP datasource_create_draft (idempotent — trùng tên skip).

   Chạy (cần key API prod trong env, KHÔNG hardcode):
     MIGRATION_MCP_KEY=... node --import tsx \
       tooling/migration-cli/src/gen-datasources.ts [--dry-run]
   Output: migration-plan/ui/datasources/generated/<name>.json + tóm tắt.
   ========================================================== */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = process.cwd();
const CLUSTERS = resolve(ROOT, "migration-plan", "ui", "datasource-clusters.json");
const OUT_DIR = resolve(ROOT, "migration-plan", "ui", "datasources", "generated");
const MCP_URL = process.env.MIGRATION_MCP_URL ?? "https://erp.vfmgroup.vn/mcp/migration";
const KEY = process.env.MIGRATION_MCP_KEY ?? "";
const DRY = process.argv.includes("--dry-run");

if (!KEY) {
  console.error("Thiếu env MIGRATION_MCP_KEY (API key prod, scope migration:apply).");
  process.exit(1);
}

let rpcId = 0;
async function mcpCall<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const res = await fetch(MCP_URL, {
    method: "POST",
    headers: { "X-API-Key": KEY, "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: ++rpcId,
      method: "tools/call",
      params: { name, arguments: args },
    }),
  });
  const j = (await res.json()) as {
    error?: { message: string };
    result?: { content?: Array<{ text?: string }>; isError?: boolean };
  };
  if (j.error) throw new Error(`${name}: ${j.error.message}`);
  const text = j.result?.content?.[0]?.text ?? "";
  if (j.result?.isError) throw new Error(`${name}: ${text}`);
  return JSON.parse(text) as T;
}

interface EntityInfo {
  id: string;
  name: string;
  label: string;
  fields: Array<{ name: string; type: string; label?: string }>;
}

const entityCache = new Map<string, EntityInfo | null>();
async function getEntity(name: string): Promise<EntityInfo | null> {
  const key = name.toLowerCase();
  if (entityCache.has(key)) return entityCache.get(key) ?? null;
  try {
    const e = await mcpCall<EntityInfo>("entity_get", { name: key });
    entityCache.set(key, e);
    return e;
  } catch {
    entityCache.set(key, null);
    return null;
  }
}

interface ClusterFile {
  clusters: Array<{
    base: string;
    joinTables: string[];
    joinEdges: Record<string, { kind: string; on: string[] }>;
    procs: string[];
  }>;
}

const file = JSON.parse(readFileSync(CLUSTERS, "utf8")) as ClusterFile;

/* Gộp theo base: hợp nhất joinEdges + procs. */
const byBase = new Map<
  string,
  { joinEdges: Map<string, { kind: string; on: string[] }>; procs: Set<string> }
>();
for (const c of file.clusters) {
  let g = byBase.get(c.base);
  if (!g) {
    g = { joinEdges: new Map(), procs: new Set() };
    byBase.set(c.base, g);
  }
  for (const p of c.procs) g.procs.add(p);
  for (const [t, e] of Object.entries(c.joinEdges)) {
    if (!g.joinEdges.has(t)) g.joinEdges.set(t, e);
  }
}

const shortName = (t: string) => t.replace(/^(tr_|dqt_|trtb_|hr_|mes_|sys_)/, "");

/** Parse 1 điều kiện ON "X.col1 = Y.col2" (đã strip string/comment). */
function parseOn(on: string[]): Array<{ left: string; right: string }> {
  const out: Array<{ left: string; right: string }> = [];
  for (const cond of on) {
    const m = cond.replace(/[[\]]/g, "").match(/\w+\.(\w+)\s*=\s*\w+\.(\w+)/);
    if (m?.[1] && m[2]) out.push({ left: m[1].toLowerCase(), right: m[2].toLowerCase() });
  }
  return out;
}

interface DsField {
  key: string;
  sourceRelationId: string;
  sourceField: string;
  label: string;
  type: string;
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const summary: Array<{ name: string; status: string; procs: number; note?: string }> = [];

  for (const [base, g] of byBase) {
    const baseEnt = await getEntity(base);
    if (!baseEnt) {
      summary.push({
        name: `ds_${shortName(base)}`,
        status: "skipped_base_missing",
        procs: g.procs.size,
        note: `entity ${base} chưa migrate`,
      });
      continue;
    }
    const baseFieldSet = new Map(baseEnt.fields.map((f) => [f.name.toLowerCase(), f]));

    const relations: Array<Record<string, unknown>> = [];
    const fields: DsField[] = [];
    const usedKeys = new Set<string>();
    const warns: string[] = [];

    const addField = (
      key: string,
      rid: string,
      f: { name: string; type: string; label?: string },
    ) => {
      let k = key;
      let i = 2;
      while (usedKeys.has(k)) k = `${key}_${i++}`;
      usedKeys.add(k);
      fields.push({
        key: k,
        sourceRelationId: rid,
        sourceField: f.name,
        label: f.label?.trim() || f.name,
        type: f.type,
      });
    };

    for (const f of baseEnt.fields) addField(f.name, "base", f);

    for (const [tbl, edge] of g.joinEdges) {
      const tgt = await getEntity(tbl);
      if (!tgt) {
        warns.push(`bỏ join ${tbl} (entity chưa migrate)`);
        continue;
      }
      const tgtFieldSet = new Map(tgt.fields.map((f) => [f.name.toLowerCase(), f]));
      // Xác định fromField (base/cha) vs toField (đích) từ các cặp ON.
      let fromField: string | null = null;
      let toField: string | null = null;
      let fromRelationId: string | null = null; // null = từ base
      for (const pair of parseOn(edge.on)) {
        const candidates: Array<[string, string]> = [
          [pair.left, pair.right],
          [pair.right, pair.left],
        ];
        for (const [a, b] of candidates) {
          if (!tgtFieldSet.has(b)) continue;
          if (baseFieldSet.has(a)) {
            fromField = baseFieldSet.get(a)?.name ?? a;
            toField = tgtFieldSet.get(b)?.name ?? b;
            fromRelationId = null;
            break;
          }
          // hop lồng: fromField nằm trên 1 bảng join đã thêm trước đó
          for (const r of relations) {
            const rEnt = entityCache.get(String(r._table ?? "")) ?? null;
            if (rEnt?.fields.some((f) => f.name.toLowerCase() === a)) {
              fromField = rEnt.fields.find((f) => f.name.toLowerCase() === a)?.name ?? a;
              toField = tgtFieldSet.get(b)?.name ?? b;
              fromRelationId = String(r.id);
              break;
            }
          }
          if (fromField) break;
        }
        if (fromField) break;
      }
      if (!fromField || !toField) {
        warns.push(`bỏ join ${tbl} (không resolve được ON: ${edge.on.join(" / ")})`);
        continue;
      }
      const alias = shortName(tbl);
      const rid = `r_${alias}`;
      relations.push({
        id: rid,
        alias,
        fromRelationId,
        fromField,
        toField,
        targetEntityId: tgt.id,
        joinKind: edge.kind === "left" ? "left" : "inner",
        _table: tbl.toLowerCase(), // nội bộ — strip trước khi gửi
      });
      for (const f of tgt.fields) addField(`${alias}_${f.name}`, rid, f);
    }

    const name = `ds_${shortName(base)}`;
    const label = `${baseEnt.label || base} (joined)`;
    const config = {
      baseEntityId: baseEnt.id,
      relations: relations.map(({ _table, ...r }) => r),
      fields,
      defaultLimit: 200,
    };

    const artifact = {
      name,
      label,
      icon: "Database",
      _procs: [...g.procs].sort(),
      _warnings: warns,
      config,
    };
    writeFileSync(resolve(OUT_DIR, `${name}.json`), JSON.stringify(artifact, null, 1), "utf8");

    if (DRY) {
      summary.push({ name, status: "dry-run", procs: g.procs.size, note: warns.join("; ") });
      continue;
    }
    try {
      const r = await mcpCall<{ status: string; dataSourceId?: string }>(
        "datasource_create_draft",
        { name, label, icon: "Database", config },
      );
      summary.push({ name, status: r.status, procs: g.procs.size, note: warns.join("; ") });
      console.log(
        `✓ ${name}: ${r.status} (${g.procs.size} proc)${warns.length ? " ⚠" + warns.join("; ") : ""}`,
      );
    } catch (e) {
      summary.push({ name, status: "error", procs: g.procs.size, note: (e as Error).message });
      console.error(`✗ ${name}: ${(e as Error).message}`);
    }
  }

  writeFileSync(resolve(OUT_DIR, "_summary.json"), JSON.stringify(summary, null, 1), "utf8");
  const ok = summary.filter((s) => s.status === "created").length;
  const skip = summary.filter((s) => s.status === "skipped_exists").length;
  const miss = summary.filter((s) => s.status === "skipped_base_missing").length;
  const err = summary.filter((s) => s.status === "error").length;
  console.log(
    `\n=== TỔNG: ${summary.length} base | created ${ok} | đã tồn tại ${skip} | thiếu base ${miss} | lỗi ${err} ===`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
