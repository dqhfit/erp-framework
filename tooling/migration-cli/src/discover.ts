/* ==========================================================
   discover.ts — BFS từ seed-tables qua proc → ra manifest YAML.

   Bước:
     1. Connect MSSQL (env MSSQL_CONNECTION_STRING).
     2. Lấy schema của mỗi seed-table → push vào module set.
     3. Lặp: với mỗi bảng trong set, tìm mỗi proc dùng đến nó.
        Với mỗi proc, parse body → reads/writes/joinPairs/exec.
        Cặp bảng mới gặp qua reads/writes/joinPairs → thêm vào set
        (nếu chưa excluded và chưa vượt max-tables).
     4. Sinh manifest YAML, ghi vào migration-plan/modules/<name>.yaml.
   ========================================================== */

import { MssqlClient, analyzeProc, type TableInfo } from "@erp-framework/mssql-client";
import {
  type Manifest,
  type ManifestTable,
  type ManifestProc,
  type ManifestCrossModuleEdge,
  toManifestProc,
  applyJoinPairs,
  readManifest,
  writeManifest,
} from "./manifest.js";

export interface DiscoverOptions {
  name: string; // tên module
  seedTables: string[]; // "schema.table" — nếu thiếu schema, gán dbo
  excludeTables: string[]; // bảng không được BFS lan vào
  maxTables: number; // ngừng BFS khi vượt
  out?: string; // override đường dẫn output
  /** Inject client từ worker. Nếu thiếu, dùng fromEnv() (CLI standalone). */
  mssqlClient?: MssqlClient;
  /** Merge mode: load manifest hiện có + giữ enrichment fields
   *  (label, suggestedKind, mapTo, targetProcName…) khi re-discover.
   *  Đồng thời compute diff (table/proc/column added/removed) và lưu
   *  vào manifest.lastRefresh. */
  merge?: boolean;
  /** PROC-CENTRIC mode (cockpit "Port mục này"): module = ĐÚNG các proc form
   *  gọi + bảng chúng đọc/ghi (+ FK lookup 1-hop). KHÔNG gom mọi proc tham
   *  chiếu bảng (table-BFS). Khi set, seedTables chỉ là bảng nền (vẫn nạp). */
  seedProcs?: string[];
}

export async function runDiscover(opts: DiscoverOptions): Promise<void> {
  console.log(`▸ Discover module "${opts.name}"`);
  console.log(`  Seed: ${opts.seedTables.join(", ")}`);
  if (opts.excludeTables.length) {
    console.log(`  Exclude: ${opts.excludeTables.join(", ")}`);
  }

  const ownedClient = !opts.mssqlClient;
  const client = opts.mssqlClient ?? MssqlClient.fromEnv();
  if (ownedClient) await client.connect();

  try {
    const moduleTables = new Set<string>();
    const excluded = new Set(opts.excludeTables.map(qualifyName));
    const procsSeen = new Set<string>();
    const tableInfoCache = new Map<string, TableInfo>();
    const manifestProcs: ManifestProc[] = [];
    const crossEdges: ManifestCrossModuleEdge[] = [];

    // Seed.
    const queue: string[] = [];
    for (const raw of opts.seedTables) {
      const q = qualifyName(raw);
      moduleTables.add(q);
      queue.push(q);
    }

    const procCentric = !!(opts.seedProcs && opts.seedProcs.length > 0);

    // ── PROC-CENTRIC (cockpit): module = đúng proc form gọi + bảng chúng
    // đọc/ghi (+ FK lookup 1-hop). KHÔNG findProcsReferencing → không kéo proc
    // của chức năng khác chỉ vì dùng chung bảng. Bảng thiếu chỉ cần migrate bảng.
    if (procCentric) {
      console.log(
        `  Mode: proc-centric — ${opts.seedProcs!.length} proc theo form (không gom proc theo bảng)`,
      );
      for (const rawProc of opts.seedProcs!) {
        const procFull = qualifyName(rawProc);
        if (procsSeen.has(procFull)) continue;
        procsSeen.add(procFull);
        const [sch, nm] = procFull.split(".");
        const proc = sch && nm ? await client.getProc(sch, nm) : null;
        if (!proc) {
          console.warn(`! Proc không tồn tại: ${procFull} (bỏ qua)`);
          continue;
        }
        const analysis = analyzeProc(proc.body);
        // Bảng proc đọc/ghi → vào module (excluded → cross-edge).
        for (const t of [...analysis.readsTables, ...analysis.writesTables]) {
          const qt = qualifyName(t);
          if (excluded.has(qt)) {
            crossEdges.push({
              proc: procFull,
              externalTable: qt,
              kind: analysis.writesTables.includes(t) ? "write" : "read",
              suggestedContract: analysis.writesTables.includes(t)
                ? `tRPC <module>.<action>({ ... })  // contract gọi module sở hữu`
                : `query qua plugin mssql-bridge trong giai đoạn quá độ`,
            });
            continue;
          }
          if (!moduleTables.has(qt) && moduleTables.size < opts.maxTables) {
            moduleTables.add(qt);
          }
        }
        manifestProcs.push(toManifestProc(procFull, analysis));
        (
          manifestProcs[manifestProcs.length - 1] as ManifestProc & {
            _joinPairs?: typeof analysis.joinPairs;
          }
        )._joinPairs = analysis.joinPairs;
      }
      // FK lookup 1-hop: thêm bảng được FK trỏ tới (để entity có relationEntity),
      // KHÔNG kéo thêm proc.
      for (const tname of [...moduleTables]) {
        if (moduleTables.size >= opts.maxTables) break;
        const info = await getTableCached(client, tname, tableInfoCache);
        for (const fk of info?.foreignKeys ?? []) {
          const qt = qualifyName(fk.refTable);
          if (!excluded.has(qt) && !moduleTables.has(qt) && moduleTables.size < opts.maxTables) {
            moduleTables.add(qt);
          }
        }
      }
      // FETCH info cho MỌI bảng trong module (gồm bảng proc reads/writes + FK
      // vừa thêm) → nếu không, manifest build (dùng tableInfoCache.get) sẽ SKIP
      // bảng chưa cache → bảng biến mất khỏi manifest.
      for (const tname of [...moduleTables]) {
        if (!tableInfoCache.has(tname)) {
          await getTableCached(client, tname, tableInfoCache);
        }
      }
    }

    // BFS (table-centric) — chỉ dùng cho CLI seed-tables, KHÔNG cho proc-centric.
    while (!procCentric && queue.length > 0) {
      if (moduleTables.size > opts.maxTables) {
        console.warn(
          `! Đã đạt max-tables=${opts.maxTables}; dừng BFS sớm. ` +
            `Có thể bỏ qua proc/bảng cuối. Tăng --max-tables nếu cần.`,
        );
        break;
      }
      const table = queue.shift()!;
      const tInfo = await getTableCached(client, table, tableInfoCache);
      if (!tInfo) {
        console.warn(`! Không tìm thấy table: ${table} (bỏ qua)`);
        continue;
      }

      // Tìm proc dùng đến bảng này.
      const refs = await client.findProcsReferencing(table);
      for (const ref of refs) {
        const procFull = `${ref.schema}.${ref.name}`.toLowerCase();
        if (procsSeen.has(procFull)) continue;
        procsSeen.add(procFull);

        const proc = await client.getProc(ref.schema, ref.name);
        if (!proc) continue;
        const analysis = analyzeProc(proc.body);

        // BFS lan ra: các bảng mới gặp qua reads/writes.
        for (const t of [...analysis.readsTables, ...analysis.writesTables]) {
          const qt = qualifyName(t);
          if (excluded.has(qt)) {
            crossEdges.push({
              proc: procFull,
              externalTable: qt,
              kind: analysis.writesTables.includes(t) ? "write" : "read",
              suggestedContract: analysis.writesTables.includes(t)
                ? `tRPC <module>.<action>({ ... })  // contract gọi module sở hữu`
                : `query qua plugin mssql-bridge trong giai đoạn quá độ`,
            });
            continue;
          }
          if (!moduleTables.has(qt) && moduleTables.size < opts.maxTables) {
            moduleTables.add(qt);
            queue.push(qt);
          }
        }

        manifestProcs.push(toManifestProc(procFull, analysis));
        // Lưu join pairs tạm — gộp sau khi tạo manifestTables.
        (
          manifestProcs[manifestProcs.length - 1] as ManifestProc & {
            _joinPairs?: typeof analysis.joinPairs;
          }
        )._joinPairs = analysis.joinPairs;
      }
    }

    // Build manifest tables từ cache.
    const tables: ManifestTable[] = [];
    for (const tname of [...moduleTables].sort()) {
      const info = tableInfoCache.get(tname);
      if (!info) continue;
      tables.push(toManifestTable(info));
    }

    // Gộp join pairs vào inferredRelations.
    for (const p of manifestProcs) {
      const _jp = (p as ManifestProc & { _joinPairs?: ReturnType<typeof analyzeProc>["joinPairs"] })
        ._joinPairs;
      if (_jp) applyJoinPairs(tables, p.name, _jp);
      delete (p as { _joinPairs?: unknown })._joinPairs;
    }

    let manifest: Manifest = {
      module: opts.name,
      tables,
      procs: manifestProcs.sort((a, b) => a.name.localeCompare(b.name)),
      crossModuleEdges: dedupCrossEdges(crossEdges),
      status: {
        phase: "discovered",
        capturedGoldenAt: null,
        scaffoldedAt: null,
        cutoverAt: null,
        retiredAt: null,
      },
      discoverParams: {
        seedTables: opts.seedTables,
        excludeTables: opts.excludeTables,
        maxTables: opts.maxTables,
        // Lưu seedProcs để refresh giữ đúng chế độ proc-centric.
        ...(opts.seedProcs && opts.seedProcs.length > 0 ? { seedProcs: opts.seedProcs } : {}),
        lastRunAt: new Date().toISOString(),
      },
    };

    // Merge mode: load manifest cũ → giữ enrichment, compute diff.
    if (opts.merge) {
      const merged = mergeWithExisting(manifest, opts.name);
      if (merged) manifest = merged;
    }

    const outPath = writeManifest(manifest, opts.out);

    // Tóm tắt.
    const tierCount = { B: 0, C: 0, D: 0 };
    for (const p of manifestProcs) tierCount[p.suggestedTier]++;
    console.log(`✓ Sinh manifest: ${outPath}`);
    console.log(`  Bảng module: ${tables.length}`);
    console.log(
      `  Proc:        ${manifestProcs.length}  (B=${tierCount.B}, C=${tierCount.C}, D=${tierCount.D})`,
    );
    console.log(`  Cross-edge:  ${manifest.crossModuleEdges.length}`);
    console.log(``);
    console.log(`▸ Bước tiếp: mở file, sửa mapTo/relationEntity/suggestedTier,`);
    console.log(`  sau đó 'pnpm migrate capture-golden --module ${opts.name}'`);
  } finally {
    if (ownedClient) await client.close();
  }
}

function qualifyName(t: string): string {
  const parts = t.split(".").filter(Boolean);
  if (parts.length === 1) return `dbo.${parts[0]!.toLowerCase()}`;
  return parts
    .slice(-2)
    .map((s) => s.toLowerCase())
    .join(".");
}

async function getTableCached(
  client: MssqlClient,
  qname: string,
  cache: Map<string, TableInfo>,
): Promise<TableInfo | null> {
  if (cache.has(qname)) return cache.get(qname)!;
  const [schema, name] = qname.split(".");
  if (!schema || !name) return null;
  const info = await client.getTable(schema, name);
  if (info) cache.set(qname, info);
  return info;
}

function toManifestTable(info: TableInfo): ManifestTable {
  return {
    name: `${info.schema}.${info.name}`.toLowerCase(),
    suggestedEntityName: snakeCase(info.name),
    primaryKey: info.primaryKey,
    columns: info.columns.map((c) => ({
      name: c.name,
      type: c.dataType,
      isNullable: c.isNullable,
      mapTo: suggestMap(c, info),
    })),
    inferredRelations:
      info.foreignKeys.length > 0
        ? info.foreignKeys.map((fk) => ({
            column: fk.column,
            refTable: fk.refTable,
            refColumn: fk.refColumn,
            sourceProc: "(declared FK)",
          }))
        : undefined,
  };
}

function snakeCase(s: string): string {
  return s
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[\s\-]+/g, "_")
    .toLowerCase();
}

function suggestMap(c: TableInfo["columns"][number], info: TableInfo): ManifestColumnMap {
  const dt = c.dataType.toLowerCase();
  // Number family.
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
    ].includes(dt)
  ) {
    return { field: snakeCase(c.name), entityType: "number" };
  }
  if (dt === "bit") return { field: snakeCase(c.name), entityType: "boolean" };
  if (dt === "date") return { field: snakeCase(c.name), entityType: "date" };
  if (["datetime", "datetime2", "smalldatetime", "datetimeoffset"].includes(dt)) {
    return { field: snakeCase(c.name), entityType: "datetime" };
  }
  if (["uniqueidentifier"].includes(dt)) {
    // PK uniqueidentifier → bỏ qua, framework auto sinh UUID.
    if (info.primaryKey.includes(c.name)) {
      return { field: "id", entityType: "text" };
    }
    return { field: snakeCase(c.name), entityType: "text" };
  }
  if (["xml"].includes(dt)) {
    return { field: snakeCase(c.name), entityType: "json" };
  }
  // FK declared → suggest relation.
  const fk = info.foreignKeys.find((f) => f.column === c.name);
  if (fk) {
    return {
      field: snakeCase(c.name),
      entityType: "relation",
      relationEntity: snakeCase(fk.refTable.split(".").pop() ?? "?"),
    };
  }
  // Default text.
  return { field: snakeCase(c.name), entityType: "text" };
}

type ManifestColumnMap = NonNullable<ManifestTable["columns"][number]["mapTo"]>;

function dedupCrossEdges(edges: ManifestCrossModuleEdge[]): ManifestCrossModuleEdge[] {
  const seen = new Map<string, ManifestCrossModuleEdge>();
  for (const e of edges) {
    const key = `${e.proc}|${e.externalTable}|${e.kind}`;
    if (!seen.has(key)) seen.set(key, e);
  }
  return [...seen.values()].sort(
    (a, b) => a.proc.localeCompare(b.proc) || a.externalTable.localeCompare(b.externalTable),
  );
}

/** Merge manifest mới (từ MSSQL re-scan) với manifest cũ — giữ enrichment
 *  user/AI đã làm (label, suggestedKind, mapTo, targetProcName, etc.). Trả
 *  manifest đã merge + lưu diff vào lastRefresh. */
function mergeWithExisting(fresh: Manifest, moduleName: string): Manifest | null {
  let old: Manifest;
  try {
    old = readManifest(moduleName);
  } catch {
    return null; // chưa có manifest cũ → fresh là first run, không merge.
  }

  const oldTables = new Map(old.tables.map((t) => [t.name.toLowerCase(), t]));
  const oldProcs = new Map(old.procs.map((p) => [p.name.toLowerCase(), p]));

  const tablesAdded: string[] = [];
  const tablesRemoved: string[] = [];
  const columnsAdded: Array<{ table: string; column: string }> = [];
  const columnsRemoved: Array<{ table: string; column: string }> = [];

  // Merge từng table.
  const mergedTables = fresh.tables.map((freshT) => {
    const oldT = oldTables.get(freshT.name.toLowerCase());
    if (!oldT) {
      tablesAdded.push(freshT.name);
      return freshT; // table mới — giữ nguyên.
    }
    // Giữ enrichment fields từ oldT, update metadata từ freshT.
    const oldColMap = new Map(oldT.columns.map((c) => [c.name.toLowerCase(), c]));
    const freshColNames = new Set(freshT.columns.map((c) => c.name.toLowerCase()));
    for (const fc of freshT.columns) {
      if (!oldColMap.has(fc.name.toLowerCase())) {
        columnsAdded.push({ table: freshT.name, column: fc.name });
      }
    }
    for (const oc of oldT.columns) {
      if (!freshColNames.has(oc.name.toLowerCase())) {
        columnsRemoved.push({ table: freshT.name, column: oc.name });
      }
    }
    const mergedCols = freshT.columns.map((fc) => {
      const oc = oldColMap.get(fc.name.toLowerCase());
      if (!oc) return fc;
      return {
        name: fc.name, // canonical
        type: fc.type, // update từ MSSQL
        isNullable: fc.isNullable,
        mapTo: oc.mapTo ?? fc.mapTo, // giữ mapTo user/AI đã set
      };
    });
    return {
      ...freshT,
      // Giữ enrichment.
      suggestedEntityName: oldT.suggestedEntityName || freshT.suggestedEntityName,
      suggestedKind: oldT.suggestedKind ?? freshT.suggestedKind,
      enumOptions: oldT.enumOptions ?? freshT.enumOptions,
      label: oldT.label ?? freshT.label,
      description: oldT.description ?? freshT.description,
      // Merge primary key (fresh có thẩm quyền — DB là nguồn sự thật).
      primaryKey: freshT.primaryKey,
      columns: mergedCols,
      // Inferred relations: gộp cả 2 (proc cũ có thể đã miss).
      inferredRelations: dedupRelations([
        ...(oldT.inferredRelations ?? []),
        ...(freshT.inferredRelations ?? []),
      ]),
    };
  });
  for (const ot of old.tables) {
    if (!fresh.tables.some((ft) => ft.name.toLowerCase() === ot.name.toLowerCase())) {
      tablesRemoved.push(ot.name);
    }
  }

  // Merge procs.
  const procsAdded: string[] = [];
  const procsRemoved: string[] = [];
  const freshProcNames = new Set(fresh.procs.map((p) => p.name.toLowerCase()));
  for (const op of old.procs) {
    if (!freshProcNames.has(op.name.toLowerCase())) procsRemoved.push(op.name);
  }
  const mergedProcs = fresh.procs.map((fp) => {
    const op = oldProcs.get(fp.name.toLowerCase());
    if (!op) {
      procsAdded.push(fp.name);
      return fp;
    }
    return {
      ...fp,
      // Giữ enrichment AI/user.
      suggestedTier: op.suggestedTier ?? fp.suggestedTier,
      targetProcName: op.targetProcName ?? fp.targetProcName,
      targetFile: op.targetFile ?? fp.targetFile,
      schedule: op.schedule ?? fp.schedule,
      label: op.label ?? fp.label,
      description: op.description ?? fp.description,
    };
  });

  return {
    ...fresh,
    tables: mergedTables,
    procs: mergedProcs,
    // Giữ status từ old (phase, capturedGoldenAt, ...).
    status: old.status,
    lastRefresh: {
      at: new Date().toISOString(),
      tablesAdded,
      tablesRemoved,
      procsAdded,
      procsRemoved,
      columnsAdded,
      columnsRemoved,
    },
  };
}

function dedupRelations<T extends { column: string; refTable: string; refColumn: string }>(
  rels: T[],
): T[] {
  const seen = new Map<string, T>();
  for (const r of rels) {
    const key = `${r.column.toLowerCase()}|${r.refTable.toLowerCase()}|${r.refColumn.toLowerCase()}`;
    if (!seen.has(key)) seen.set(key, r);
  }
  return [...seen.values()];
}
