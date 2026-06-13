/* ==========================================================
   migration-full-import.ts — Phase U: full data import qua queue
   + auto-resume + sync.

   1 job = N table (do user chọn ở QuickMigratePanel). Mỗi table:
   - Detect PK column từ MSSQL info (single col).
   - Loop streamReadByPk theo batchSize cho đến hết.
   - Update lastPk + rowsImported sau mỗi batch (atomic UPDATE).
   - Catch network error → set status='paused' + error.
     Boot scan resume jobs status='running' → re-enqueue (worker tự re-pickup
     từ lastPk hiện tại — không mất data).

   Sync mode (kind='sync'): rerun job với cùng config nhưng giữ lastPk hiện
   tại — chỉ lấy data mới (pk > lastPk).
   ========================================================== */

import { createHash, randomUUID } from "node:crypto";
import {
  entities,
  entityRecords,
  migrationFullJobs,
  migrationFullJobTables,
  mssqlConnections,
  recordLocator,
} from "@erp-framework/db";
import { MssqlClient } from "@erp-framework/mssql-client";
import { and, eq, inArray, type SQL, sql } from "drizzle-orm";
import { decryptSecret } from "./crypto";
import { type DB, db } from "./db";
import { promoteEntityToTable } from "./entity-promote";
import { type EntityStorage, importPkIndexDDL, splitDataForStorage } from "./entity-table-ddl";
import { findMigratedEntityBySourceTable } from "./migration-migrated-set";
import { isHybridTablesEnabled } from "./record-store";
import { publish as publishWs } from "./ws-hub";

/* ─── Ghi batch vào BẢNG THẬT (targetTier='table') ─── */

/** Đối tượng chạy SQL thô — db hoặc transaction tx đều thoả (cùng .execute). */
export type SqlExecutor = { execute: (query: SQL) => Promise<unknown> };

/** Lease worker bị worker khác chiếm (rolling deploy: 2 container cùng chạy
 *  1 job → insert trùng hàng loạt). Worker mất lease phải DỪNG NGAY và KHÔNG
 *  đụng vào status job/table — worker đang giữ lease sở hữu chúng. */
export class LeaseLostError extends Error {
  constructor(jobId: string) {
    super(`Mất lease full-import job ${jobId} — worker khác đã claim.`);
    this.name = "LeaseLostError";
  }
}

/** Heartbeat coi là STALE sau ngần này — worker sống heartbeat mỗi batch
 *  (giây-phút), nên 3 phút im lặng nghĩa là worker đã chết. */
export const LEASE_STALE_MS = 3 * 60_000;

/** Tìm id record đã có trong bảng thật theo giá trị PK nguồn (gom trùng khi
 *  re-run/sync). pkField map sang cột typed (storage.columns) hoặc ext jsonb. */
export async function findExistingInTable(
  storage: EntityStorage,
  companyId: string,
  pkField: string,
  pkValues: string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (pkValues.length === 0) return map;
  const tbl = sql.raw(`"${storage.tableName}"`);
  const colMap = storage.columns[pkField];
  // COALESCE(...,'') BẮT BUỘC cho cột typed: coerceColumnValue đổi '' → NULL
  // khi ghi, nên khoá nguồn '' (PK rỗng hợp lệ ở MSSQL) so IN ('') với cột
  // NULL không bao giờ match → sync/import re-INSERT row đó MỖI chu kỳ
  // (đã dính: tr_khachhang_giantiep nhân 158 bản, tr_sanpham/tr_dondathang
  // +156 mỗi bảng).
  const pkExpr = colMap
    ? sql.raw(`COALESCE("${colMap.col}"::text, '')`)
    : sql`COALESCE(ext->>${pkField}, '')`;
  const inList = sql.join(
    pkValues.map((v) => sql`${v}`),
    sql`, `,
  );
  const res = (await db.execute(
    sql`SELECT id, ${pkExpr} AS pk FROM ${tbl} WHERE company_id = ${companyId}::uuid AND ${pkExpr} IN (${inList})`,
  )) as unknown as
    | Array<{ id: string; pk: string | null }>
    | { rows: Array<{ id: string; pk: string | null }> };
  const list = Array.isArray(res) ? res : (res.rows ?? []);
  for (const r of list) if (r.pk != null) map.set(String(r.pk), r.id);
  return map;
}

/** Separator ghép khoá composite — control char không xuất hiện trong data. */
export const COMPOSITE_KEY_SEP = "\u0001";

/** Token đại diện NULL trong khoá ghép. CHÚ Ý: KHÔNG dùng NUL (u0000) —
 *  PostgreSQL text TỪ CHỐI NUL byte trong bind param (query dedupe
 *  chết/treo — đã dính ở job composite đầu tiên). Cột PK vốn NOT NULL
 *  nên token gần như không bao giờ dùng — chuỗi rỗng là đủ. */
const COMPOSITE_NULL = "";

/** Khoá ghép của 1 row data theo danh sách pkFields. */
export function compositeKeyOf(data: Record<string, unknown>, pkFields: string[]): string {
  return pkFields
    .map((f) => {
      const v = data[f];
      return v == null ? COMPOSITE_NULL : String(v);
    })
    .join(COMPOSITE_KEY_SEP);
}

/** Bản PK GHÉP của findExistingInTable: khớp theo CONCAT các biểu thức
 *  text của từng pkField (cột typed hoặc ext) với cùng separator. */
export async function findExistingInTableComposite(
  storage: EntityStorage,
  companyId: string,
  pkFields: string[],
  keys: string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (keys.length === 0) return map;
  const tbl = sql.raw(`"${storage.tableName}"`);
  const parts = pkFields.map((f) => {
    const colMap = storage.columns[f];
    const e = colMap ? sql.raw(`"${colMap.col}"::text`) : sql`(ext->>${f})`;
    return sql`COALESCE(${e}, ${COMPOSITE_NULL}::text)`;
  });
  const pkExpr = sql.join(parts, sql` || ${COMPOSITE_KEY_SEP} || `);
  const inList = sql.join(
    keys.map((v) => sql`${v}`),
    sql`, `,
  );
  const res = (await db.execute(
    sql`SELECT id, ${pkExpr} AS pk FROM ${tbl} WHERE company_id = ${companyId}::uuid AND ${pkExpr} IN (${inList})`,
  )) as unknown as
    | Array<{ id: string; pk: string | null }>
    | { rows: Array<{ id: string; pk: string | null }> };
  const list = Array.isArray(res) ? res : (res.rows ?? []);
  for (const r of list) if (r.pk != null) map.set(String(r.pk), r.id);
  return map;
}

/** tsvector từ field searchable (giữ FTS khi import vào bảng thật). */
function tsvFor(storage: EntityStorage, data: Record<string, unknown>) {
  const tsv = (storage.searchable ?? [])
    .map((f) => (data[f] == null ? "" : String(data[f])))
    .filter(Boolean)
    .join(" ");
  return tsv;
}

/** Hash ổn định của 1 row nguồn (key sort + Date→ISO) — lưu vào
 *  ext.__sync_hash để rescan SKIP row không đổi (tránh rewrite toàn bảng
 *  mỗi chu kỳ). So hash thay vì so giá trị → né hẳn khác biệt format
 *  date/numeric giữa driver MSSQL và PG. */
export function stableRowHash(data: Record<string, unknown>): string {
  const keys = Object.keys(data).sort();
  const parts: string[] = [];
  for (const k of keys) {
    const v = data[k];
    if (v === undefined) continue;
    const s = v instanceof Date ? v.toISOString() : v === null ? "~null~" : JSON.stringify(v);
    parts.push(`${k}=${s}`);
  }
  return createHash("md5").update(parts.join("|")).digest("hex");
}

/** INSERT 1 row mới vào bảng thật (id uuidv7 mặc định, version 0, now).
 *  Trả id row mới — caller PHẢI ghi record_locator (id-only op mới định
 *  tuyến được về bảng thật, đồng nhất với promote/record-store). */
export async function insertRowToTable(
  tx: SqlExecutor,
  storage: EntityStorage,
  companyId: string,
  userId: string,
  data: Record<string, unknown>,
): Promise<string | null> {
  const tbl = sql.raw(`"${storage.tableName}"`);
  const { cols, ext } = splitDataForStorage(storage, data);
  (ext as Record<string, unknown>).__sync_hash = stableRowHash(data);
  const colList = ["company_id", "created_by", ...cols.map((c) => `"${c.col}"`), "ext"];
  const vals = [
    sql`${companyId}::uuid`,
    sql`${userId}::uuid`,
    ...cols.map((c) => sql`${c.value}`),
    sql`${JSON.stringify(ext)}::jsonb`,
  ];
  const tsv = tsvFor(storage, data);
  if (tsv) {
    colList.push("search_tsv");
    vals.push(sql`to_tsvector('simple', ${tsv})`);
  }
  const res = await tx.execute(
    sql`INSERT INTO ${tbl} (${sql.raw(colList.join(", "))}) VALUES (${sql.join(vals, sql`, `)}) RETURNING id`,
  );
  const list = Array.isArray(res)
    ? (res as Array<{ id?: string }>)
    : ((res as { rows?: Array<{ id?: string }> }).rows ?? []);
  return list[0]?.id ?? null;
}

/** UPDATE row có sẵn theo id (cập nhật cột + ext + tsv + updated_at). */
export async function updateRowInTable(
  tx: SqlExecutor,
  storage: EntityStorage,
  id: string,
  data: Record<string, unknown>,
): Promise<void> {
  const tbl = sql.raw(`"${storage.tableName}"`);
  const { cols, ext } = splitDataForStorage(storage, data);
  (ext as Record<string, unknown>).__sync_hash = stableRowHash(data);
  const sets = [
    ...cols.map((c) => sql`${sql.raw(`"${c.col}"`)} = ${c.value}`),
    sql`ext = ${JSON.stringify(ext)}::jsonb`,
  ];
  const tsv = tsvFor(storage, data);
  if (tsv) sets.push(sql`search_tsv = to_tsvector('simple', ${tsv})`);
  sets.push(sql`updated_at = now()`);
  await tx.execute(sql`UPDATE ${tbl} SET ${sql.join(sets, sql`, `)} WHERE id = ${id}::uuid`);
}

/* ─── Types ─── */

export interface FullJobItem {
  tableName: string;
  entityName: string;
  label: string;
  fields: Array<{ name: string; label: string; type: string }>;
}

export interface FullJobConfig {
  items: FullJobItem[];
  batchSize?: number;
  writeManifest?: boolean;
  /** 'eav' (mặc định): ghi vào entity_records. 'table': promote entity sang
   *  BẢNG THẬT (tên DB cũ) rồi ghi thẳng vào đó. Cần ERP_HYBRID_TABLES=1. */
  targetTier?: "eav" | "table";
}

export interface FullJobData {
  jobId: string;
  userId: string;
}

/* ─── Pre-flight helper: prep tables (run khi tạo job lần đầu) ─── */

export interface StartFullImportInput {
  connectionId: string;
  items: FullJobItem[];
  batchSize?: number;
  writeManifest?: boolean;
  targetTier?: "eav" | "table";
}

/** Tạo job full-import: insert migration_full_jobs + prepare per-table
 *  (detect PK, tạo entity, promote nếu targetTier=table). KHÔNG enqueue —
 *  caller tự gọi enqueueMigrationJob (tránh vòng import với migration-worker).
 *  Dùng chung cho tRPC migration.startFullImport và MCP /mcp/migration. */
export async function createFullImportJob(
  db: DB,
  companyId: string,
  userId: string,
  input: StartFullImportInput,
): Promise<{ jobId: string }> {
  const batchSize = input.batchSize ?? 5_000;
  const targetTier = input.targetTier ?? "eav";
  const [job] = await db
    .insert(migrationFullJobs)
    .values({
      companyId,
      connectionId: input.connectionId,
      kind: "full",
      status: "queued",
      config: {
        items: input.items,
        batchSize,
        writeManifest: input.writeManifest ?? true,
        targetTier,
      },
      totalTables: input.items.length,
      createdBy: userId,
    })
    .returning({ id: migrationFullJobs.id });
  if (!job) throw new Error("Insert job fail.");

  try {
    await prepareFullJobTables(
      job.id,
      companyId,
      userId,
      input.connectionId,
      input.items,
      batchSize,
      targetTier,
    );
  } catch (e) {
    await db
      .update(migrationFullJobs)
      .set({ status: "failed", error: (e as Error).message, updatedAt: new Date() })
      .where(eq(migrationFullJobs.id, job.id));
    throw e;
  }
  return { jobId: job.id };
}

/** Chuẩn bị migration_full_job_tables records cho 1 job mới. Detect PK
 *  từ MSSQL info, tạo entity nếu chưa có, insert vào job_tables. */
export async function prepareFullJobTables(
  jobId: string,
  companyId: string,
  userId: string,
  connectionId: string,
  items: FullJobItem[],
  batchSize: number,
  targetTier: "eav" | "table" = "eav",
): Promise<void> {
  const client = await loadConn(companyId, connectionId);
  try {
    for (const it of items) {
      const [schema, name] = it.tableName.includes(".")
        ? it.tableName.split(".")
        : ["dbo", it.tableName];
      const info = await client.getTable(schema ?? "dbo", name ?? it.tableName);
      // PK đơn hoặc GHÉP (tối đa 3 cột — streamReadByPk keyset tuple).
      // CHÚ Ý: trước đây lấy primaryKey[0] kể cả khi PK ghép → stream theo
      // 1 cột KHÔNG unique = keyset nhảy cóc mất dữ liệu im lặng.
      const pkCols = info?.primaryKey ?? [];
      const pkColumn = pkCols.length >= 1 && pkCols.length <= 3 ? pkCols.join(",") : null;

      // Resolve/tạo entity với guard meta.source.kind=migration.
      let entityId: string | null = null;
      let resolvedEntityName = it.entityName;
      // DEDUP theo BẢNG NGUỒN trước: nếu bảng MSSQL này đã có entity migration
      // (dù tên khác do module khác enrich) → tái dùng, tránh tạo 2 entity trùng.
      const bySource = await findMigratedEntityBySourceTable(db, companyId, it.tableName);
      const [existing] = bySource
        ? [{ id: bySource.id, meta: { source: { kind: "migration" } } }]
        : await db
            .select({ id: entities.id, meta: entities.meta })
            .from(entities)
            .where(and(eq(entities.companyId, companyId), eq(entities.name, it.entityName)))
            .limit(1);
      if (bySource) resolvedEntityName = bySource.name;
      if (existing) {
        const srcKind = (existing.meta as { source?: { kind?: string } } | null)?.source?.kind;
        if (srcKind && srcKind !== "migration") {
          // Manual entity — không đè, record table với error.
          await db.insert(migrationFullJobTables).values({
            jobId,
            tableName: it.tableName,
            entityName: it.entityName,
            pkColumn,
            batchSize,
            status: "failed",
            error: `Entity "${it.entityName}" đã có do user tạo tay (kind=${srcKind}) — skip.`,
          });
          continue;
        }
        entityId = existing.id;
      } else {
        const moduleName = `_quick-${connectionId}`;
        const [inserted] = await db
          .insert(entities)
          .values({
            companyId,
            name: it.entityName,
            label: it.label,
            fields: it.fields,
            meta: {
              source: {
                kind: "migration",
                connectionId,
                module: moduleName,
                mssqlTable: it.tableName,
                importedAt: new Date().toISOString(),
                importedBy: userId,
                rowsLastImported: 0,
              },
            },
          })
          .returning({ id: entities.id });
        if (inserted) entityId = inserted.id;
      }

      // targetTier='table': promote entity sang BẢNG THẬT (tên DB cũ) NGAY ở
      // bước prepare, để worker ghi thẳng vào bảng thật. Cần HYBRID bật.
      if (targetTier === "table" && entityId) {
        if (!isHybridTablesEnabled()) {
          await db.insert(migrationFullJobTables).values({
            jobId,
            tableName: it.tableName,
            entityId,
            entityName: resolvedEntityName,
            pkColumn,
            batchSize,
            status: "failed",
            error: "Import vào bảng thật cần bật ERP_HYBRID_TABLES=1.",
          });
          continue;
        }
        try {
          await promoteEntityToTable(db, companyId, entityId);
        } catch (e) {
          await db.insert(migrationFullJobTables).values({
            jobId,
            tableName: it.tableName,
            entityId,
            entityName: resolvedEntityName,
            pkColumn,
            batchSize,
            status: "failed",
            error: `Promote bảng thật lỗi: ${(e as Error).message}`,
          });
          continue;
        }
      }

      await db.insert(migrationFullJobTables).values({
        jobId,
        tableName: it.tableName,
        entityId,
        entityName: resolvedEntityName,
        pkColumn,
        batchSize,
        // "skipped" = lỗi VĨNH VIỄN (không có PK đơn cột) → không retry khi
        // resume, KHÔNG chặn job hoàn thành. Khác "failed" (lỗi tạm — retry được).
        status: pkColumn ? "pending" : "skipped",
        error: pkColumn
          ? null
          : "Không tìm thấy primary key (hoặc PK > 3 cột) — full stream cần PK 1-3 cột. Dùng Quick migrate thường (limit) thay vì Full.",
      });
    }

    // Cập nhật total_tables.
    await db
      .update(migrationFullJobs)
      .set({ totalTables: items.length, updatedAt: new Date() })
      .where(eq(migrationFullJobs.id, jobId));
  } finally {
    await client.close().catch(() => undefined);
  }
}

/* ─── Worker chính ─── */

/** Handler cho action="full-import" trong migration-worker. Chạy stream
 *  từng table → batch insert. Resume tự khi job được re-enqueue (đọc
 *  lastPk hiện tại từ DB). */
export async function runFullImportJob(data: FullJobData): Promise<{
  succeededTables: number;
  failedTables: number;
  skippedTables: number;
  totalRows: number;
}> {
  const [job] = await db
    .select()
    .from(migrationFullJobs)
    .where(eq(migrationFullJobs.id, data.jobId))
    .limit(1);
  if (!job) throw new Error(`Job ${data.jobId} không tồn tại.`);
  if (job.status === "canceled" || job.status === "completed") {
    return { succeededTables: 0, failedTables: 0, skippedTables: 0, totalRows: 0 };
  }
  // Đích ghi: 'table' = ghi thẳng vào bảng thật (entity đã promote ở prepare).
  const targetTier =
    (job.config as { targetTier?: string } | null)?.targetTier === "table" ? "table" : "eav";

  // CLAIM LEASE + đánh dấu running. Điều kiện: chưa ai giữ token HOẶC
  // heartbeat của worker giữ token đã stale (worker chết). Nếu worker khác
  // còn sống đang chạy job này (rolling deploy: container cũ chưa bị giết) →
  // claim trượt → thoát êm, KHÔNG chạy song song (gây insert trùng hàng loạt
  // — đã dính +170k row ngày 11/06).
  const workerToken = randomUUID();
  const claimed = (await db
    .update(migrationFullJobs)
    .set({
      status: "running",
      startedAt: job.startedAt ?? new Date(),
      lastHeartbeat: new Date(),
      workerToken,
      error: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(migrationFullJobs.id, data.jobId),
        sql`(${migrationFullJobs.workerToken} IS NULL
             OR ${migrationFullJobs.lastHeartbeat} < now() - interval '3 minutes')`,
      ),
    )
    .returning({ id: migrationFullJobs.id })) as Array<{ id: string }>;
  if (claimed.length === 0) {
    console.warn(
      `[migration-full-import] Job ${data.jobId}: worker khác đang giữ lease (heartbeat tươi) — bỏ qua run này.`,
    );
    return { succeededTables: 0, failedTables: 0, skippedTables: 0, totalRows: 0 };
  }

  const client = await loadConn(job.companyId, job.connectionId);
  let succeededTables = 0;
  let failedTables = 0;
  let skippedTables = 0;
  let totalRowsThisRun = 0;
  let canceledMidRun = false;

  // Cooperative cancel: đọc lại status để dừng GIỮA CHỪNG khi user Huỷ. Gọi ở
  // ranh giới mỗi bảng + mỗi batch (checkpoint đã lưu nên resume an toàn).
  const isCanceled = async (): Promise<boolean> => {
    try {
      const [j] = await db
        .select({ status: migrationFullJobs.status })
        .from(migrationFullJobs)
        .where(eq(migrationFullJobs.id, data.jobId))
        .limit(1);
      return j?.status === "canceled";
    } catch {
      return false; // lỗi đọc thoáng qua → coi như chưa cancel, không vỡ job
    }
  };

  try {
    // Resume: lấy table còn cần xử lý — pending/running (dở dang) + failed (lỗi
    // TẠM, retry từ lastPk đã lưu). Loại 'done' (xong) và 'skipped' (lỗi vĩnh
    // viễn no-PK — retry vô ích). Trước đây loại luôn 'failed' khiến bảng lỗi
    // mạng giữa chừng KẸT mãi, không bao giờ resume được.
    const tables = await db
      .select()
      .from(migrationFullJobTables)
      .where(
        and(
          eq(migrationFullJobTables.jobId, data.jobId),
          sql`${migrationFullJobTables.status} IN ('pending', 'running', 'failed')`,
        ),
      );

    for (const t of tables) {
      if (await isCanceled()) {
        canceledMidRun = true;
        break;
      }
      if (!t.pkColumn || !t.entityId) {
        // Thiếu PK/entity → lỗi vĩnh viễn: mark skipped (không retry, không
        // chặn job hoàn thành) thay vì failed.
        await db
          .update(migrationFullJobTables)
          .set({
            status: "skipped",
            error: t.error ?? "Thiếu pkColumn hoặc entityId.",
            updatedAt: new Date(),
          })
          .where(eq(migrationFullJobTables.id, t.id));
        skippedTables++;
        continue;
      }

      await db
        .update(migrationFullJobTables)
        .set({ status: "running", updatedAt: new Date() })
        .where(eq(migrationFullJobTables.id, t.id));

      const fieldsSet = new Set<string>();
      // Đọc entity fields + meta hiện tại để filter row data + biết storage.
      const [ent] = await db
        .select({ fields: entities.fields, meta: entities.meta })
        .from(entities)
        .where(eq(entities.id, t.entityId))
        .limit(1);
      const entFields = (ent?.fields as Array<{ name: string }>) ?? [];
      for (const f of entFields) fieldsSet.add(f.name.toLowerCase());
      // Ghi vào BẢNG THẬT khi targetTier='table'. SELF-HEAL khi chạy lại: nếu
      // entity chưa promote (vd lần đầu prepare lúc HYBRID còn tắt) → promote
      // NGAY tại đây (idempotent: đã table thì no-op) rồi đọc lại storage. Nhờ
      // vậy resume/sync ĐỒNG NHẤT với lần chạy đầu, không kẹt.
      let storage = (ent?.meta as { storage?: EntityStorage } | null)?.storage;
      if (targetTier === "table" && storage?.tier !== "table") {
        if (!isHybridTablesEnabled()) {
          throw new Error("Import vào bảng thật cần bật ERP_HYBRID_TABLES=1.");
        }
        await promoteEntityToTable(db, job.companyId, t.entityId);
        const [re] = await db
          .select({ meta: entities.meta })
          .from(entities)
          .where(eq(entities.id, t.entityId))
          .limit(1);
        storage = (re?.meta as { storage?: EntityStorage } | null)?.storage;
      }
      const useTable = targetTier === "table" && storage?.tier === "table";
      if (targetTier === "table" && !useTable) {
        throw new Error("targetTier=table nhưng không promote được entity sang bảng thật.");
      }
      // Index dedup cho chạy lại nhanh (khớp findExistingInTable). Idempotent →
      // áp cho cả lần đầu, resume lẫn self-heal. Best-effort: lỗi không chặn.
      if (useTable && storage && t.pkColumn) {
        const ixDdl = importPkIndexDDL(storage, t.pkColumn.toLowerCase());
        if (ixDdl) await db.execute(sql.raw(ixDdl)).catch(() => undefined);
      }

      try {
        let lastPk: string | null = t.lastPk;
        let rowsImported = t.rowsImported;
        const tableEntityId = t.entityId;
        while (true) {
          const batch = await client.streamReadByPk<Record<string, unknown>>({
            schemaTable: t.tableName,
            pkColumn: t.pkColumn,
            lastPk,
            batchSize: t.batchSize,
          });
          if (batch.rows.length > 0) {
            // Map row → entity_records.data filter theo fields.
            const mapped: Array<Record<string, unknown>> = batch.rows.map(
              (r: Record<string, unknown>) => {
                const dataObj: Record<string, unknown> = {};
                for (const [k, v] of Object.entries(r)) {
                  const key = k.toLowerCase();
                  if (fieldsSet.size === 0 || fieldsSet.has(key)) {
                    dataObj[key] = v;
                  }
                }
                return dataObj;
              },
            );

            // UPSERT theo PK chống duplicate khi user tạo job lại (vd cancel
            // rồi start cùng bảng). PK đơn: pkField = pkColumn lower-case;
            // PK GHÉP ("a,b"): khoá = compositeKeyOf (concat giá trị các cột).
            const pkFields = t.pkColumn
              .toLowerCase()
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean);
            const isComposite = pkFields.length > 1;
            const pkField = pkFields[0] ?? t.pkColumn.toLowerCase();
            const keyOf = (d: Record<string, unknown>): string | null => {
              if (isComposite) {
                // Mọi thành phần null → coi như không có khoá (insert thẳng).
                return pkFields.every((f) => d[f] == null) ? null : compositeKeyOf(d, pkFields);
              }
              const v = d[pkField];
              return v == null ? null : String(v);
            };
            const pkValues: string[] = [];
            for (const d of mapped) {
              const k = keyOf(d);
              if (k != null) pkValues.push(k);
            }
            let existingMap: Map<string, string>; // khoá → record.id
            if (useTable && storage) {
              existingMap = isComposite
                ? await findExistingInTableComposite(storage, job.companyId, pkFields, pkValues)
                : await findExistingInTable(storage, job.companyId, pkField, pkValues);
            } else {
              // EAV: PK đơn khớp data->>field; PK ghép concat cùng separator.
              const keyExpr = isComposite
                ? sql.join(
                    pkFields.map(
                      (f) => sql`COALESCE((${entityRecords.data}->>${f}), ${COMPOSITE_NULL}::text)`,
                    ),
                    sql` || ${COMPOSITE_KEY_SEP}::text || `,
                  )
                : sql`(${entityRecords.data}->>${pkField})`;
              const existingRows =
                pkValues.length > 0
                  ? await db
                      .select({ id: entityRecords.id, data: entityRecords.data })
                      .from(entityRecords)
                      .where(
                        and(
                          eq(entityRecords.companyId, job.companyId),
                          eq(entityRecords.entityId, tableEntityId),
                          inArray(keyExpr, pkValues),
                        ),
                      )
                  : [];
              existingMap = new Map<string, string>();
              for (const r of existingRows) {
                const k = keyOf(r.data as Record<string, unknown>);
                if (k != null) existingMap.set(k, r.id);
              }
            }

            const toInsert: Array<Record<string, unknown>> = [];
            const toUpdate: Array<{ id: string; data: Record<string, unknown> }> = [];
            for (const d of mapped) {
              const k = keyOf(d);
              if (k == null) {
                toInsert.push(d);
                continue;
              }
              const existingId = existingMap.get(k);
              if (existingId) toUpdate.push({ id: existingId, data: d });
              else toInsert.push(d);
            }

            const prevPk = lastPk;
            const nextPk = batch.nextLastPk;

            // Chống loop vô hạn: có rows nhưng PK KHÔNG tiến (null hoặc không
            // đổi). streamReadByPk với lastPk=null sẽ bỏ WHERE → đọc LẠI từ đầu
            // bảng; nếu batch đầy (isEnd=false) thì lặp mãi. Abort TRƯỚC khi ghi
            // (batch này không checkpoint được, resume sẽ đọc lại từ prevPk).
            if (!batch.isEnd && (nextPk == null || nextPk === prevPk)) {
              throw new Error(
                `PK "${t.pkColumn}" không tiến (giá trị cuối: ${nextPk ?? "null"}) — ` +
                  `không stream tiếp an toàn được. Bảng cần single-column PK tăng dần, không null.`,
              );
            }

            rowsImported += batch.rows.length;
            lastPk = nextPk;
            const checkpointRows = rowsImported;
            const checkpointPk = lastPk;

            // ATOMIC: data-write (insert + update) + checkpoint (lastPk +
            // rowsImported) trong 1 transaction. Crash giữa chừng KHÔNG để
            // checkpoint lệch với data đã ghi → resume không over-count.
            await db.transaction(async (tx) => {
              if (useTable && storage) {
                // Ghi thẳng vào BẢNG THẬT (per-row — cột động + tsv).
                const newIds: string[] = [];
                for (const d of toInsert) {
                  const newId = await insertRowToTable(tx, storage, job.companyId, data.userId, d);
                  if (newId) newIds.push(newId);
                }
                for (const u of toUpdate) {
                  await updateRowInTable(tx, storage, u.id, u.data);
                }
                // Locator cho row mới — id-only op (get/update theo recordId)
                // mới định tuyến được về bảng thật (đồng nhất với promote).
                if (newIds.length > 0) {
                  await tx
                    .insert(recordLocator)
                    .values(
                      newIds.map((id) => ({
                        id,
                        companyId: job.companyId,
                        entityId: tableEntityId,
                      })),
                    )
                    .onConflictDoNothing();
                }
              } else {
                if (toInsert.length > 0) {
                  await tx.insert(entityRecords).values(
                    toInsert.map((d) => ({
                      companyId: job.companyId,
                      entityId: tableEntityId,
                      data: d,
                      createdBy: data.userId,
                    })),
                  );
                }
                for (const u of toUpdate) {
                  await tx
                    .update(entityRecords)
                    .set({ data: u.data, updatedAt: new Date() })
                    .where(eq(entityRecords.id, u.id));
                }
              }
              await tx
                .update(migrationFullJobTables)
                .set({
                  lastPk: checkpointPk,
                  rowsImported: checkpointRows,
                  updatedAt: new Date(),
                })
                .where(eq(migrationFullJobTables.id, t.id));
            });

            // Heartbeat CÓ ĐIỀU KIỆN token (ngoài tx — liveness). 0 row =
            // worker khác đã claim lease (mình bị coi là chết/treo) → DỪNG
            // NGAY, không ghi gì thêm. Batch vừa ghi vẫn an toàn: checkpoint
            // atomic + worker mới dedup theo PK sẽ update chứ không insert.
            const hb = (await db
              .update(migrationFullJobs)
              .set({ lastHeartbeat: new Date(), updatedAt: new Date() })
              .where(
                and(
                  eq(migrationFullJobs.id, data.jobId),
                  eq(migrationFullJobs.workerToken, workerToken),
                ),
              )
              .returning({ id: migrationFullJobs.id })) as Array<{ id: string }>;
            if (hb.length === 0) throw new LeaseLostError(data.jobId);

            // Publish WS progress.
            publishWs(`migration:${data.userId}`, {
              kind: "full-progress",
              jobId: data.jobId,
              tableId: t.id,
              tableName: t.tableName,
              rowsImported,
              lastPk,
            });
            totalRowsThisRun += batch.rows.length;
          }
          if (batch.isEnd) break;
          // Cooperative cancel giữa batch — checkpoint (lastPk/rowsImported) đã
          // lưu trong transaction nên dừng đây resume tiếp được.
          if (await isCanceled()) {
            canceledMidRun = true;
            break;
          }
        }
        if (canceledMidRun) break;

        // Cập nhật meta.source.importedAt + rowsLastImported. MERGE jsonb (||)
        // chứ KHÔNG ghi đè cả meta — ghi đè sẽ xoá mất meta.storage vừa
        // promote (entity mất marker bảng thật, reads rơi về EAV rỗng).
        await db
          .update(entities)
          .set({
            meta: sql`coalesce(${entities.meta}, '{}'::jsonb) || ${JSON.stringify({
              source: {
                kind: "migration",
                connectionId: job.connectionId,
                module: `_quick-${job.connectionId}`,
                mssqlTable: t.tableName,
                importedAt: new Date().toISOString(),
                importedBy: data.userId,
                rowsLastImported: rowsImported,
              },
            })}::jsonb`,
            updatedAt: new Date(),
          })
          .where(eq(entities.id, tableEntityId));

        // Reconciliation: so COUNT nguồn (MSSQL) vs SỐ DÒNG BẢNG NÀY đã import
        // (rowsImported), KHÔNG đếm count(*) toàn entity — vì nhiều bảng nguồn
        // có thể dùng CHUNG 1 entity (dedup) → count(*) gồm cả bảng khác → drift
        // GIẢ → job kẹt paused mãi. rowsImported là per-bảng nên chuẩn xác.
        let reconcile: "ok" | "drift" | "skip" = "skip";
        let srcCount: number | null = null;
        const tgtCount: number | null = rowsImported;
        try {
          srcCount = await client.countRows(t.tableName);
          reconcile = srcCount === rowsImported ? "ok" : "drift";
        } catch {
          // Không đếm được nguồn (vd view, quyền) → skip, không chặn.
          reconcile = "skip";
        }

        await db
          .update(migrationFullJobTables)
          .set({ status: "done", srcCount, tgtCount, reconcile, updatedAt: new Date() })
          .where(eq(migrationFullJobTables.id, t.id));
        succeededTables++;
      } catch (e) {
        // Mất lease → worker khác sở hữu job/table status — thoát ngay,
        // KHÔNG mark failed (sẽ đè lên tiến độ của worker đang chạy).
        if (e instanceof LeaseLostError) throw e;
        // Lỗi mạng / MSSQL — set table failed nhưng KHÔNG cancel job.
        // Boot resume sẽ pickup lại nếu user trigger resume.
        await db
          .update(migrationFullJobTables)
          .set({
            status: "failed",
            error: (e as Error).message,
            updatedAt: new Date(),
          })
          .where(eq(migrationFullJobTables.id, t.id));
        failedTables++;
      }
    }

    // User Huỷ giữa chừng → giữ nguyên status='canceled', KHÔNG ghi đè
    // completed/paused. Bảng dở đã có checkpoint (resume/sync chạy tiếp được nếu
    // user đổi ý — nhưng job canceled sẽ không tự resume).
    if (canceledMidRun) {
      const [c] = await db
        .select({
          rows: sql<number>`COALESCE(sum(rows_imported), 0)::bigint`,
          done: sql<number>`count(*) FILTER (WHERE status = 'done')::int`,
        })
        .from(migrationFullJobTables)
        .where(eq(migrationFullJobTables.jobId, data.jobId));
      await db
        .update(migrationFullJobs)
        .set({
          completedTables: c?.done ?? 0,
          totalRowsImported: Number(c?.rows ?? 0),
          lastHeartbeat: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(migrationFullJobs.id, data.jobId));
      publishWs(`migration:${data.userId}`, {
        kind: "full-job-done",
        jobId: data.jobId,
        status: "canceled",
        totalRows: Number(c?.rows ?? 0),
      });
      return { succeededTables, failedTables, skippedTables, totalRows: totalRowsThisRun };
    }

    // Đếm lại trạng thái cuối loop. Phân biệt:
    //  - done    : import xong
    //  - skipped : lỗi vĩnh viễn (no-PK) — KHÔNG chặn hoàn thành
    //  - failed  : lỗi tạm — còn retry được (resume sẽ pickup)
    //  - pending : còn dở (vd vượt giới hạn run, chưa tới lượt)
    const [stats] = await db
      .select({
        completed: sql<number>`count(*) FILTER (WHERE status = 'done')::int`,
        skipped: sql<number>`count(*) FILTER (WHERE status = 'skipped')::int`,
        failed: sql<number>`count(*) FILTER (WHERE status = 'failed')::int`,
        pending: sql<number>`count(*) FILTER (WHERE status IN ('pending', 'running'))::int`,
        // Bảng đã 'done' nhưng reconcile lệch nguồn≠đích — coi như CHƯA xong.
        drift: sql<number>`count(*) FILTER (WHERE status = 'done' AND reconcile = 'drift')::int`,
        totalRows: sql<number>`COALESCE(sum(rows_imported), 0)::bigint`,
      })
      .from(migrationFullJobTables)
      .where(eq(migrationFullJobTables.jobId, data.jobId));

    const totalRowsAll = Number(stats?.totalRows ?? 0);
    // Còn việc cần làm = failed (retry được) + pending/running + drift (đếm
    // lệch → cần re-import/điều tra). skipped & done-ok coi như đã giải quyết.
    const unresolved = (stats?.failed ?? 0) + (stats?.pending ?? 0) + (stats?.drift ?? 0);
    const allDone = unresolved === 0;
    // Còn việc nhưng đã có tiến triển → paused để user/boot resume. Chưa làm
    // được gì (toàn lỗi) → failed.
    const hasProgress = (stats?.completed ?? 0) > 0 || (stats?.skipped ?? 0) > 0;
    const finalStatus = allDone ? "completed" : hasProgress ? "paused" : "failed";

    await db
      .update(migrationFullJobs)
      .set({
        status: finalStatus,
        completedTables: stats?.completed ?? 0,
        totalRowsImported: totalRowsAll,
        completedAt: allDone ? new Date() : null,
        lastHeartbeat: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(migrationFullJobs.id, data.jobId));

    publishWs(`migration:${data.userId}`, {
      kind: "full-job-done",
      jobId: data.jobId,
      status: finalStatus,
      completedTables: stats?.completed ?? 0,
      skippedTables: stats?.skipped ?? 0,
      failedTables: stats?.failed ?? 0,
      totalRows: totalRowsAll,
    });
  } catch (e) {
    // Mất lease: worker khác đang chạy job — thoát êm, TUYỆT ĐỐI không đổi
    // status (đổi sang paused sẽ giết job của worker đang giữ lease).
    if (e instanceof LeaseLostError) {
      console.warn(`[migration-full-import] ${e.message}`);
      return { succeededTables, failedTables, skippedTables, totalRows: totalRowsThisRun };
    }
    // Job-level error (vd MSSQL connection failure).
    await db
      .update(migrationFullJobs)
      .set({
        status: "paused", // paused để user retry/resume
        error: (e as Error).message,
        lastHeartbeat: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(migrationFullJobs.id, data.jobId));
    throw e;
  } finally {
    await client.close().catch(() => undefined);
  }

  return { succeededTables, failedTables, skippedTables, totalRows: totalRowsThisRun };
}

/* ─── Resume on boot ─── */

/** Khi server boot, scan jobs kẹt 'running'/'queued' (server crash giữa chừng)
 *  → re-enqueue. KHÔNG tự resume 'paused' — paused là trạng thái user chủ động
 *  dừng hoặc partial-fail cần user quyết định; auto-resume mỗi lần boot sẽ chạy
 *  import ngoài ý muốn. User resume thủ công qua endpoint resumeFullJob. */
export async function resumeStaleFullJobs(
  enqueue: (jobId: string, userId: string) => Promise<void>,
): Promise<{ count: number; jobIds: string[] }> {
  // CHỈ resume khi heartbeat STALE — job 'running' với heartbeat tươi nghĩa
  // là worker container CŨ còn sống đang chạy (rolling deploy); re-enqueue
  // lúc đó = 2 worker song song cùng job → insert trùng hàng loạt. Job bị
  // bỏ qua ở boot sẽ được sweeper định kỳ (sweepStaleFullJobs) vớt khi
  // worker cũ chết hẳn.
  const stale = await db
    .select({ id: migrationFullJobs.id, createdBy: migrationFullJobs.createdBy })
    .from(migrationFullJobs)
    .where(
      sql`${migrationFullJobs.status} IN ('running', 'queued')
          AND ${migrationFullJobs.lastHeartbeat} < now() - interval '3 minutes'`,
    );
  for (const s of stale) {
    if (!s.createdBy) continue;
    await enqueue(s.id, s.createdBy);
  }
  if (stale.length > 0) {
    console.log(`[migration-full-import] Resume ${stale.length} stale job(s).`);
  }
  return { count: stale.length, jobIds: stale.map((s) => s.id) };
}

/* ─── Helper ─── */

export async function loadConn(companyId: string, connectionId: string): Promise<MssqlClient> {
  const [row] = await db
    .select()
    .from(mssqlConnections)
    .where(and(eq(mssqlConnections.companyId, companyId), eq(mssqlConnections.id, connectionId)))
    .limit(1);
  if (!row) throw new Error(`Connection MSSQL ${connectionId} không tồn tại.`);
  const client = MssqlClient.fromConfig({
    host: row.host,
    port: row.port,
    database: row.database,
    username: row.username,
    password: decryptSecret(row.passwordEnc),
    encrypt: row.encrypt,
    trustServerCert: row.trustServerCert,
    allowWrite: row.allowWrite,
    requestTimeoutMs: 120_000, // full import có thể chạy lâu — tăng timeout per request
  });
  await client.connect();
  return client;
}
