import type { DB } from "@erp-framework/server/db";
import { type SQL, sql } from "drizzle-orm";
import { procTable, rows } from "../src/proc-table";

interface QueryInput {
  filters?: Record<string, { op: string; value: unknown }>;
  sort?: { field: string; dir: string };
  limit?: number;
  offset?: number;
  q?: string;
}

interface BOMEntry {
  mavt: string;
  bom: string;
  hehang: string;
}

export async function trMaterialList(
  db: DB,
  companyId: string,
  args: { query?: QueryInput },
): Promise<{ rows: unknown[]; total: number }> {
  const query = args.query ?? {};
  const limit = Math.min(Math.max(query.limit ?? 200, 1), 10_000);
  const offset = Math.max(query.offset ?? 0, 0);

  const tMat = await procTable(db, companyId, "tr_material");
  const entityId = tMat.entityId;

  // Build WHERE conditions
  const conds: SQL[] = [];
  for (const [field, cond] of Object.entries(query.filters ?? {})) {
    const { op, value } = cond;
    switch (op) {
      case "=":
        conds.push(sql`${tMat.text(field)} = ${String(value)}`);
        break;
      case "!=":
        conds.push(sql`${tMat.text(field)} <> ${String(value)}`);
        break;
      case "contains":
        conds.push(sql`${tMat.text(field)} ILIKE ${`%${String(value)}%`}`);
        break;
      case ">":
        conds.push(sql`${tMat.num(field)} > ${Number(value)}`);
        break;
      case ">=":
        conds.push(sql`${tMat.num(field)} >= ${Number(value)}`);
        break;
      case "<":
        conds.push(sql`${tMat.num(field)} < ${Number(value)}`);
        break;
      case "<=":
        conds.push(sql`${tMat.num(field)} <= ${Number(value)}`);
        break;
      case "in": {
        const arr = Array.isArray(value) ? value.map(String) : [];
        conds.push(sql`${tMat.text(field)} = ANY(${arr})`);
        break;
      }
      case "is-not-true":
        conds.push(sql`COALESCE(${tMat.bool(field)}, false) <> true`);
        break;
      default:
        conds.push(sql`${tMat.text(field)} = ${String(value)}`);
    }
  }

  // Full-text search across key fields
  if (query.q?.trim()) {
    const q = query.q.trim();
    conds.push(
      sql`(${tMat.text("mavt")} ILIKE ${`%${q}%`} OR ${tMat.text("tenvt")} ILIKE ${`%${q}%`} OR ${tMat.text("nhom")} ILIKE ${`%${q}%`})`,
    );
  }

  const where = conds.length > 0 ? sql`${sql.join(conds, sql` AND `)}` : sql`1=1`;

  // Count total matching
  const [cnt] = rows<{ n: number }>(
    await db.execute(
      sql`SELECT count(*)::int AS n FROM ${tMat.tbl} WHERE ${tMat.scope} AND (${where})`,
    ),
  );
  const total = cnt?.n ?? 0;

  // Build ORDER BY
  let orderBy: SQL | undefined;
  if (query.sort) {
    const dir = query.sort.dir === "desc" ? sql`DESC` : sql`ASC`;
    orderBy = sql`${tMat.text(query.sort.field)} ${dir}`;
  } else {
    orderBy = sql`${tMat.text("mavt")} ASC`;
  }

  // Query materials with pagination via listWhere (handles column mapping)
  const materialRows = await tMat.listWhere(where, { orderBy, limit, offset });

  const matRows = materialRows.map((row) => {
    const id = row._id as string;
    const data: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(row)) {
      if (k === "_id") continue;
      data[k] = v;
    }
    return {
      id,
      entityId,
      createdAt: (data.create_date as string) ?? null,
      updatedAt: (data.update_date as string) ?? null,
      createdBy: (data.create_by as string) ?? null,
      schemaVersion: "1",
      data,
    };
  });

  if (matRows.length === 0) return { rows: [], total };

  // Collect mavt values for BOM/hehang lookup
  const mavtList = matRows.map((r) => String(r.data.mavt ?? "")).filter(Boolean);
  if (mavtList.length === 0) return { rows: matRows, total };

  // Query BOM + hehang per (material, BOM) — y hệt GetAll5
  const bomEntries = await queryBOMHehangPerBOM(db, companyId, mavtList);

  // Index by mavt
  const bomByMavt = new Map<string, BOMEntry[]>();
  for (const be of bomEntries) {
    const list = bomByMavt.get(be.mavt);
    if (list) list.push(be);
    else bomByMavt.set(be.mavt, [be]);
  }

  // Emit one row per (material, BOM) — matching GetAll5 multi-row output
  const outRows: typeof matRows = [];
  for (const row of matRows) {
    const mavt = String(row.data.mavt ?? "");
    const entries = bomByMavt.get(mavt);

    if (!entries || entries.length === 0) {
      // Material with no BOM → 1 row, BOM/hehang = ""
      const clone = structuredClone(row);
      clone.data.BOM = "";
      clone.data.hehang = "";
      outRows.push(clone);
    } else {
      for (const entry of entries) {
        const clone = structuredClone(row);
        clone.id = `${mavt}::${entry.bom}`;
        clone.data.BOM = entry.bom;
        clone.data.hehang = entry.hehang;
        outRows.push(clone);
      }
    }
  }

  return { rows: outRows, total: outRows.length };
}

async function queryBOMHehangPerBOM(
  db: DB,
  companyId: string,
  mavtList: string[],
): Promise<BOMEntry[]> {
  if (mavtList.length === 0) return [];

  // Get BOM entity table references
  const bomTables: Array<{
    t: Awaited<ReturnType<typeof procTable>>;
    bomLabel: string;
    matField: string;
  }> = [];

  for (const [name, label, matField] of [
    ["tr_dinhmuc_ngukim", "NKI", "mavt"],
    ["tr_dinhmuc_donggoi", "DGO", "madonggoi"],
    ["tr_dinhmuc_son", "SON", "mact"],
  ] as const) {
    try {
      const t = await procTable(db, companyId, name);
      bomTables.push({ t, bomLabel: label, matField });
    } catch {
      // skip if entity not found
    }
  }

  if (bomTables.length === 0) return [];

  const mavtParams = sql.join(
    mavtList.map((v) => sql`${v}`),
    sql`, `,
  );

  // Build UNION ALL: (mavt, bom, masp) — dedup (mavt, hehang) per sub-query
  const parts: SQL[] = [];
  for (const { t, bomLabel, matField } of bomTables) {
    const matExpr = t.text(matField);
    const maspExpr = t.text("masp");
    parts.push(
      sql`SELECT ${matExpr} AS mavt, ${bomLabel} AS bom, ${maspExpr} AS masp
          FROM ${t.tbl}
          WHERE ${t.scope}
            AND ${matExpr} IN (${mavtParams})`,
    );
  }

  const unionSQL = sql.join(parts, sql` UNION ALL `);

  // Fetch (mavt, bom, masp) dedup
  const bomRes = await db.execute(sql`
    SELECT mavt, bom, masp FROM (${unionSQL}) sub
    GROUP BY mavt, bom, masp
    ORDER BY mavt, bom
  `);

  const rawBom = rows<{ mavt: string; bom: string; masp: string | null }>(bomRes).filter(
    (r) => r.mavt,
  );

  if (rawBom.length === 0) return [];

  // Get hehang from tr_sanpham for all masp
  const maspSet = new Set(rawBom.map((r) => r.masp).filter(Boolean));
  const hehangByMasp = new Map<string, string>();
  if (maspSet.size > 0) {
    let tSp: Awaited<ReturnType<typeof procTable>> | null = null;
    try {
      tSp = await procTable(db, companyId, "tr_sanpham");
    } catch {
      // no product entity — skip
    }
    if (tSp) {
      const maspArr = [...maspSet];
      const maspParams = sql.join(
        maspArr.map((v) => sql`${v}`),
        sql`, `,
      );
      const spRes = await db.execute(
        sql`SELECT ${tSp.text("masp")} AS masp, ${tSp.text("hehang")} AS hehang
            FROM ${tSp.tbl}
            WHERE ${tSp.scope}
              AND ${tSp.text("masp")} IN (${maspParams})`,
      );
      for (const r of rows<{ masp: string; hehang: string | null }>(spRes)) {
        if (r.masp) hehangByMasp.set(r.masp, r.hehang ?? "");
      }
    }
  }

  // Group by (mavt, bom) and STRING_AGG hehang — matching GetAll5
  const grouped = new Map<string, { mavt: string; bom: string; hehangs: Set<string> }>();
  for (const r of rawBom) {
    const key = `${r.mavt}::${r.bom}`;
    const g = grouped.get(key);
    const h = r.masp ? (hehangByMasp.get(r.masp) ?? "") : "";
    if (g) {
      if (h) g.hehangs.add(h);
    } else {
      grouped.set(key, { mavt: r.mavt, bom: r.bom, hehangs: new Set(h ? [h] : []) });
    }
  }

  return [...grouped.values()].map((g) => ({
    mavt: g.mavt,
    bom: g.bom,
    hehang: [...g.hehangs].join("; "),
  }));
}
