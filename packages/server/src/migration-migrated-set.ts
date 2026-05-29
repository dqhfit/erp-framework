/* ==========================================================
   migration-migrated-set.ts — Helper trả Set bảng MSSQL đã
   được migrate sang hệ thống mới (cross-module).

   "Đã migrate" gồm 2 nguồn:
   1. YAML manifest: manifest.tables[name].migratedAt có giá trị
      HOẶC suggestedKind === "enum" (enum không cần ETL).
   2. DB entities: entities.meta.source.kind === "migration"
      → cover các bảng migrate qua "Migrate nhanh" KHÔNG ghi YAML
      (chỉ insert entity trực tiếp).

   Dùng bởi:
   - migration-codegen-batch.ts (skip proc dirty khi batch codegen)
   - migration-router.ts listProcsToMigrate / listAllProcsToMigrate
   ========================================================== */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import YAML from "yaml";
import { eq } from "drizzle-orm";
import { entities } from "@erp-framework/db";
import type { DB } from "./db";

export interface MigratedSet {
  /** Set tableName.toLowerCase() đã migrate. */
  tables: Set<string>;
  /** Map từ tableName.toLowerCase() → module YAML chứa nó (debug). */
  source: Map<string, string>;
}

const MODULES_DIR = (): string => resolve(process.cwd(), "migration-plan", "modules");

/** Build set bảng đã migrate từ TẤT CẢ manifest YAML trong migration-plan/modules.
 *  Quét cả _quick-* (Phase S quick-migrate). */
export function buildMigratedSet(modulesDir?: string): MigratedSet {
  const tables = new Set<string>();
  const source = new Map<string, string>();
  const dir = modulesDir ?? MODULES_DIR();
  if (!existsSync(dir)) return { tables, source };

  const files = readdirSync(dir).filter(
    (f) => f.endsWith(".yaml") && !f.startsWith("_example") && !f.endsWith(".enriched.yaml"),
  );

  for (const f of files) {
    try {
      const raw = readFileSync(resolve(dir, f), "utf8");
      const m = YAML.parse(raw) as {
        tables?: Array<{
          name: string;
          migratedAt?: string;
          suggestedKind?: "entity" | "enum";
        }>;
      };
      for (const t of m.tables ?? []) {
        const key = t.name.toLowerCase();
        if (t.migratedAt || t.suggestedKind === "enum") {
          tables.add(key);
          if (!source.has(key)) source.set(key, f);
        }
      }
    } catch {
      /* skip yaml hỏng */
    }
  }
  return { tables, source };
}

/** Convenience: chỉ lấy Set, bỏ source map. */
export function buildMigratedTableSet(modulesDir?: string): Set<string> {
  return buildMigratedSet(modulesDir).tables;
}

/** Lấy Set bảng MSSQL đã migrate từ DB entities (qua meta.source.mssqlTable).
 *  Cover bảng từ Migrate nhanh không có manifest YAML.
 *  Per-company isolation: chỉ trả entity thuộc companyId. */
export async function fetchMigratedTablesFromDb(
  db: DB,
  companyId: string,
): Promise<{ tables: Set<string>; source: Map<string, string> }> {
  const tables = new Set<string>();
  const source = new Map<string, string>();
  const rows = await db
    .select({ id: entities.id, name: entities.name, meta: entities.meta })
    .from(entities)
    .where(eq(entities.companyId, companyId));
  for (const r of rows) {
    const meta = (r.meta ?? {}) as { source?: { kind?: string; mssqlTable?: string } };
    const src = meta.source;
    if (src?.kind !== "migration") continue;
    if (!src.mssqlTable) continue;
    const key = src.mssqlTable.toLowerCase();
    tables.add(key);
    if (!source.has(key)) source.set(key, `entity:${r.name}`);
  }
  return { tables, source };
}

/** Combined: YAML manifest + DB entities. Pattern recommend cho mọi caller
 *  cần biết "bảng nào đã migrate" — không miss bảng từ Migrate nhanh. */
export async function buildCombinedMigratedSet(
  db: DB,
  companyId: string,
  modulesDir?: string,
): Promise<MigratedSet> {
  const fromYaml = buildMigratedSet(modulesDir);
  const fromDb = await fetchMigratedTablesFromDb(db, companyId);

  const tables = new Set<string>([...fromYaml.tables, ...fromDb.tables]);
  const source = new Map<string, string>();
  // YAML source ưu tiên (vì có module name rõ ràng).
  for (const [k, v] of fromYaml.source) source.set(k, v);
  for (const [k, v] of fromDb.source) {
    if (!source.has(k)) source.set(k, v);
  }
  return { tables, source };
}

/** Convenience async chỉ lấy Set. */
export async function buildCombinedMigratedTableSet(
  db: DB,
  companyId: string,
  modulesDir?: string,
): Promise<Set<string>> {
  return (await buildCombinedMigratedSet(db, companyId, modulesDir)).tables;
}
