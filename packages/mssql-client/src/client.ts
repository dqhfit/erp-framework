/* ==========================================================
   client.ts — MssqlClient: bao quanh driver `mssql`, cung cấp
   API gọn cho CLI migration + plugin bridge.

   Read-only mặc định. Để cho phép write phải set env
   MSSQL_ALLOW_WRITE=1 — chống "framework ghi nhầm MSSQL" trong
   giai đoạn quá độ.
   ========================================================== */

import sql, { type ConnectionPool, type config as MssqlConfig } from "mssql";
import {
  introspectFindProcsReferencing,
  introspectGetProc,
  introspectGetTable,
  introspectListProcs,
  introspectListTables,
} from "./introspect.js";
import type { ProcInfo, ProcStats, TableInfo } from "./types.js";

export interface MssqlClientOptions {
  /** Connection string dạng "Server=...;Database=...;User Id=...;Password=...;". */
  connectionString?: string;
  /** Cấu hình driver gốc (override connectionString). */
  config?: MssqlConfig;
  /** Cho phép thao tác write (query/exec có thể mutate). Mặc định false. */
  allowWrite?: boolean;
}

const WRITE_KEYWORDS = /\b(insert|update|delete|merge|drop|truncate|alter|create)\b/i;

/** Validate và bracket-escape schema.table hoặc table để dùng an toàn trong SQL.
 *  Chỉ chấp nhận tên gồm chữ cái, số, underscore, space (tên tiếng Việt hợp lệ).
 *  Ném Error nếu format không hợp lệ. */
function escapeMssqlIdentifier(schemaTable: string): string {
  // Bỏ bracket bên ngoài nếu đã có (vd [dbo].[MyTable])
  const bare = schemaTable.replace(/\[([^\]]*)\]/g, "$1");
  const parts = bare.split(".");
  if (parts.length < 1 || parts.length > 2) {
    throw new Error(`Invalid schemaTable format: "${schemaTable}"`);
  }
  for (const part of parts) {
    if (!/^[\w\s]+$/.test(part) || part.trim() === "") {
      throw new Error(`Invalid identifier in schemaTable: "${part}"`);
    }
  }
  return parts.map((p) => `[${p.replace(/]/g, "]]")}]`).join(".");
}

export class MssqlClient {
  private pool: ConnectionPool | null = null;
  private readonly opts: MssqlClientOptions;

  constructor(opts: MssqlClientOptions = {}) {
    this.opts = opts;
  }

  /** Khởi tạo từ env MSSQL_CONNECTION_STRING + MSSQL_ALLOW_WRITE. */
  static fromEnv(): MssqlClient {
    const cs = process.env.MSSQL_CONNECTION_STRING;
    if (!cs) {
      throw new Error("MSSQL_CONNECTION_STRING chưa được đặt trong env");
    }
    return new MssqlClient({
      connectionString: cs,
      allowWrite: process.env.MSSQL_ALLOW_WRITE === "1",
    });
  }

  /** Khởi tạo từ config object (UI / DB connection record). */
  static fromConfig(cfg: {
    host: string;
    port?: number;
    database: string;
    username: string;
    password: string;
    encrypt?: boolean;
    trustServerCert?: boolean;
    allowWrite?: boolean;
    requestTimeoutMs?: number;
  }): MssqlClient {
    return new MssqlClient({
      config: {
        server: cfg.host,
        port: cfg.port ?? 1433,
        database: cfg.database,
        user: cfg.username,
        password: cfg.password,
        options: {
          encrypt: cfg.encrypt ?? true,
          trustServerCertificate: cfg.trustServerCert ?? false,
        },
        requestTimeout: cfg.requestTimeoutMs ?? 30_000,
      },
      allowWrite: cfg.allowWrite ?? false,
    });
  }

  async connect(): Promise<void> {
    if (this.pool?.connected) return;
    if (this.opts.config) {
      this.pool = await new sql.ConnectionPool(this.opts.config).connect();
    } else if (this.opts.connectionString) {
      this.pool = await new sql.ConnectionPool(this.opts.connectionString).connect();
    } else {
      throw new Error("MssqlClient: phải cung cấp connectionString hoặc config");
    }
  }

  async close(): Promise<void> {
    if (this.pool) {
      await this.pool.close();
      this.pool = null;
    }
  }

  private requirePool(): ConnectionPool {
    if (!this.pool?.connected) {
      throw new Error("MssqlClient chưa connect() — gọi await client.connect() trước.");
    }
    return this.pool;
  }

  /** Query tự do. Read-only mặc định — chặn SQL có keyword write. */
  async query<T = unknown>(text: string, params: Record<string, unknown> = {}): Promise<T[]> {
    const pool = this.requirePool();
    if (!this.opts.allowWrite && WRITE_KEYWORDS.test(text)) {
      throw new Error(
        `query() ở chế độ read-only nhưng SQL có từ khóa write. ` +
          `Bật MSSQL_ALLOW_WRITE=1 nếu thực sự cần. SQL: ${text.slice(0, 80)}...`,
      );
    }
    const req = pool.request();
    for (const [k, v] of Object.entries(params)) req.input(k, v);
    const r = await req.query<T>(text);
    return r.recordset as T[];
  }

  /** Gọi stored procedure. Bị chặn ở read-only mode trừ khi tắt. */
  async execProc<T = unknown>(name: string, params: Record<string, unknown> = {}): Promise<T[]> {
    const pool = this.requirePool();
    if (!this.opts.allowWrite) {
      // Proc có thể read-only (sp_Get*), nhưng không phân biệt được từ tên —
      // cho phép nhưng warn caller capture golden từ read-only proc.
      // Để đơn giản, chặn luôn — caller set MSSQL_ALLOW_WRITE=1 khi capture.
      throw new Error(
        `execProc("${name}") bị chặn ở read-only mode. Bật MSSQL_ALLOW_WRITE=1 để capture golden.`,
      );
    }
    const req = pool.request();
    for (const [k, v] of Object.entries(params)) req.input(k, v);
    const r = await req.execute<T>(name);
    return r.recordset as T[];
  }

  /** Dump 1 bảng ra mảng. limit mặc định 10000, cắp 100000.
   *  SECURITY: schemaTable được validate + bracket-escape trước khi đưa vào SQL.
   *  where là raw SQL — caller có trách nhiệm đảm bảo an toàn (chỉ dùng nội bộ). */
  async bulkRead<T = unknown>(
    schemaTable: string,
    options: { where?: string; limit?: number } = {},
  ): Promise<T[]> {
    const limit = Math.min(Math.max(options.limit ?? 10_000, 1), 100_000);
    const where = options.where ? ` WHERE ${options.where}` : "";
    const safeName = escapeMssqlIdentifier(schemaTable);
    const pool = this.requirePool();
    const r = await pool.request().query<T>(`SELECT TOP ${limit} * FROM ${safeName}${where}`);
    return r.recordset as T[];
  }

  /** Đếm số dòng 1 bảng — dùng cho reconciliation sau full-import (so với
   *  count entity_records phía PG). schemaTable validate + bracket-escape. */
  async countRows(schemaTable: string): Promise<number> {
    const safeName = escapeMssqlIdentifier(schemaTable);
    const pool = this.requirePool();
    const r = await pool
      .request()
      .query<{ n: number }>(`SELECT COUNT_BIG(*) AS n FROM ${safeName}`);
    return Number(r.recordset[0]?.n ?? 0);
  }

  /** Phase U — Streaming read theo PK. Trả batch + nextLastPk để caller
   *  resume lần sau. Dùng cho Full import: lặp gọi method này cho đến khi
   *  rows.length < batchSize (hết data).
   *
   *  SECURITY: schemaTable + pkColumn validate qua MSSQL identifier rules
   *  (chỉ a-z, 0-9, _, space). Bracket-escape trước khi đưa vào SQL.
   *  lastPk parameterized — chống injection. */
  async streamReadByPk<T = Record<string, unknown>>(opts: {
    schemaTable: string;
    pkColumn: string;
    lastPk?: string | number | null;
    batchSize?: number;
  }): Promise<{ rows: T[]; nextLastPk: string | null; isEnd: boolean }> {
    const batchSize = Math.min(Math.max(opts.batchSize ?? 5_000, 1), 50_000);
    const safeName = escapeMssqlIdentifier(opts.schemaTable);
    // Validate pkColumn: chỉ word + space chars.
    if (!/^[\w\s]+$/.test(opts.pkColumn) || opts.pkColumn.trim() === "") {
      throw new Error(`Invalid pkColumn: "${opts.pkColumn}"`);
    }
    const safePk = `[${opts.pkColumn.replace(/]/g, "]]")}]`;

    const pool = this.requirePool();
    const req = pool.request();
    let where = "";
    if (opts.lastPk !== undefined && opts.lastPk !== null && opts.lastPk !== "") {
      req.input("lastPk", opts.lastPk);
      where = ` WHERE ${safePk} > @lastPk`;
    }
    const queryText = `SELECT TOP ${batchSize} * FROM ${safeName}${where} ORDER BY ${safePk} ASC`;
    const r = await req.query<T>(queryText);
    const rows = r.recordset as T[];
    let nextLastPk: string | null = null;
    if (rows.length > 0) {
      const lastRow = rows[rows.length - 1] as Record<string, unknown>;
      // Tìm key match pkColumn case-insensitive (MSSQL có thể trả khác case).
      const pkKey = Object.keys(lastRow).find(
        (k) => k.toLowerCase() === opts.pkColumn.toLowerCase(),
      );
      if (pkKey) {
        const v = lastRow[pkKey];
        nextLastPk = v == null ? null : String(v);
      }
    }
    return {
      rows,
      nextLastPk,
      isEnd: rows.length < batchSize,
    };
  }

  /* ── Introspection — ủy thác sang module introspect.ts ──── */

  listTables(schema?: string): Promise<Array<{ schema: string; name: string }>> {
    return introspectListTables(this.requirePool(), schema);
  }

  getTable(schema: string, name: string): Promise<TableInfo | null> {
    return introspectGetTable(this.requirePool(), schema, name);
  }

  listProcs(filter?: string): Promise<Array<{ schema: string; name: string }>> {
    return introspectListProcs(this.requirePool(), filter);
  }

  getProc(schema: string, name: string): Promise<ProcInfo | null> {
    return introspectGetProc(this.requirePool(), schema, name);
  }

  findProcsReferencing(table: string): Promise<Array<{ schema: string; name: string }>> {
    return introspectFindProcsReferencing(this.requirePool(), table);
  }

  /* ── Change Tracking — đọc delta thay đổi (INSERT/UPDATE/DELETE) ──
     Tất cả đều SELECT-only → không vướng read-only guard.
     DBA DQHF phải bật CT trên DB + từng bảng trước khi dùng. */

  /** Kiểm tra trạng thái Change Tracking cấp DB + từng bảng.
   *  Nếu schemaTables truyền vào thì chỉ trả những bảng đó; ngược lại
   *  trả toàn bộ bảng có CT. */
  async getCtStatus(schemaTables?: string[]): Promise<{
    dbEnabled: boolean;
    retentionDays: number | null;
    tables: Array<{
      schema: string;
      name: string;
      schemaTable: string;
      enabled: boolean;
      minValidVersion: number | null;
    }>;
  }> {
    const pool = this.requirePool();
    // DB-level
    const dbRows = await pool.request().query<{
      retention_period: number;
      retention_period_units_desc: string;
    }>(`
      SELECT retention_period, retention_period_units_desc
      FROM sys.change_tracking_databases
      WHERE database_id = DB_ID()
    `);
    const dbEnabled = dbRows.recordset.length > 0;
    let retentionDays: number | null = null;
    if (dbEnabled) {
      const r = dbRows.recordset[0];
      const units = (r?.retention_period_units_desc ?? "").toUpperCase();
      const period = r?.retention_period ?? 0;
      retentionDays =
        units === "DAYS" ? period : units === "HOURS" ? Math.ceil(period / 24) : period;
    }
    // Table-level
    const tblRows = await pool.request().query<{
      schema: string;
      name: string;
      min_valid_version: string | null;
    }>(`
      SELECT
        OBJECT_SCHEMA_NAME(object_id) AS [schema],
        OBJECT_NAME(object_id)        AS [name],
        CAST(min_valid_version AS varchar(20)) AS min_valid_version
      FROM sys.change_tracking_tables
    `);
    let tables = tblRows.recordset.map((r) => ({
      schema: r.schema,
      name: r.name,
      schemaTable: `${r.schema}.${r.name}`,
      enabled: true,
      minValidVersion: r.min_valid_version != null ? Number(r.min_valid_version) : null,
    }));
    if (schemaTables && schemaTables.length > 0) {
      const set = new Set(schemaTables.map((s) => s.toLowerCase()));
      tables = tables.filter(
        (t) => set.has(`${t.schema}.${t.name}`.toLowerCase()) || set.has(t.name.toLowerCase()),
      );
    }
    return { dbEnabled, retentionDays, tables };
  }

  /** Version CT hiện tại của database. Dùng làm baseline khi seed bảng mới.
   *  Trả null nếu CT chưa bật (CHANGE_TRACKING_CURRENT_VERSION() trả NULL). */
  async getCtCurrentVersion(): Promise<number | null> {
    const pool = this.requirePool();
    const r = await pool
      .request()
      .query<{ version: string | null }>(
        `SELECT CAST(CHANGE_TRACKING_CURRENT_VERSION() AS varchar(20)) AS version`,
      );
    const v = r.recordset[0]?.version;
    return v != null ? Number(v) : null;
  }

  /** Version CT nhỏ nhất còn hợp lệ cho 1 bảng (cửa sổ retention).
   *  Nếu watermark hiện tại < min valid → phải reseed từ đầu. */
  async getCtMinValidVersion(schemaTable: string): Promise<number | null> {
    const safeName = escapeMssqlIdentifier(schemaTable);
    const pool = this.requirePool();
    const r = await pool
      .request()
      .query<{ min_version: string | null }>(
        `SELECT CAST(CHANGE_TRACKING_MIN_VALID_VERSION(OBJECT_ID('${safeName}')) AS varchar(20)) AS min_version`,
      );
    const v = r.recordset[0]?.min_version;
    return v != null ? Number(v) : null;
  }

  /** Đọc các thay đổi CT cho 1 bảng kể từ lastVersion.
   *  Trả rows gồm _ct_operation ('I'|'U'|'D') + _ct_version + tất cả cột bảng
   *  (NULL cho cột data khi D).
   *
   *  PHÂN TRANG KEYSET (version, pk) — KHÔNG chỉ theo version: mọi row đổi
   *  trong CÙNG 1 transaction MSSQL mang CÙNG SYS_CHANGE_VERSION; nếu TOP cắt
   *  giữa nhóm version mà vòng sau lọc "> version" thì phần còn lại của nhóm
   *  MẤT VĨNH VIỄN. Caller giữ cursor (cursorVersion, cursorPk) trong-run;
   *  anchor lastVersion giữ nguyên suốt run (watermark đã persist).
   *
   *  nextVersion = max SYS_CHANGE_VERSION trong batch (batch đã ORDER nên là
   *  version của row cuối). nextCursorPk = PK RAW của row cuối (giữ nguyên
   *  kiểu để so sánh đúng với cột PK ở vòng sau).
   *  SECURITY: schemaTable + pkColumn validated + bracket-escaped. */
  async readCtChanges<T = Record<string, unknown>>(opts: {
    schemaTable: string;
    pkColumn: string;
    lastVersion: number;
    /** Cursor trong-run: version của row cuối batch trước. Default = lastVersion. */
    cursorVersion?: number;
    /** Cursor trong-run: PK raw của row cuối batch trước (cùng cursorVersion). */
    cursorPk?: unknown;
    batchSize?: number;
  }): Promise<{
    rows: Array<T & { _ct_operation: string; _ct_version: number }>;
    nextVersion: number;
    nextCursorPk: unknown;
    isEnd: boolean;
  }> {
    const batchSize = Math.min(Math.max(opts.batchSize ?? 500, 1), 5_000);
    const safeName = escapeMssqlIdentifier(opts.schemaTable);
    if (!/^[\w\s]+$/.test(opts.pkColumn) || opts.pkColumn.trim() === "") {
      throw new Error(`Invalid pkColumn: "${opts.pkColumn}"`);
    }
    const safePk = `[${opts.pkColumn.replace(/]/g, "]]")}]`;
    const pool = this.requirePool();
    const req = pool.request();
    req.input("lastVersion", opts.lastVersion);
    const cursorVersion = opts.cursorVersion ?? opts.lastVersion;
    req.input("cursorVersion", cursorVersion);
    let where = `ct.SYS_CHANGE_VERSION > @cursorVersion`;
    if (opts.cursorPk !== undefined && opts.cursorPk !== null) {
      req.input("cursorPk", opts.cursorPk);
      where = `(ct.SYS_CHANGE_VERSION > @cursorVersion
        OR (ct.SYS_CHANGE_VERSION = @cursorVersion AND ct.${safePk} > @cursorPk))`;
    }
    // CHANGETABLE LEFT JOIN bảng gốc → D rows có PK nhưng cột data = NULL.
    const queryText = `
      SELECT TOP ${batchSize}
        ct.SYS_CHANGE_OPERATION AS _ct_operation,
        CAST(ct.SYS_CHANGE_VERSION AS bigint) AS _ct_version,
        ct.${safePk},
        t.*
      FROM CHANGETABLE(CHANGES ${safeName}, @lastVersion) AS ct
      LEFT JOIN ${safeName} AS t ON ct.${safePk} = t.${safePk}
      WHERE ${where}
      ORDER BY ct.SYS_CHANGE_VERSION ASC, ct.${safePk} ASC
    `;
    const r = await req.query<T & { _ct_operation: string; _ct_version: number }>(queryText);
    const rows = r.recordset as Array<T & { _ct_operation: string; _ct_version: number }>;
    let nextVersion = cursorVersion;
    for (const row of rows) {
      const v = Number(row._ct_version);
      if (v > nextVersion) nextVersion = v;
    }
    const lastRow = rows.length > 0 ? (rows[rows.length - 1] as Record<string, unknown>) : null;
    const pkKeys = lastRow ? Object.keys(lastRow) : [];
    const realPkKey =
      pkKeys.find((k) => k.toLowerCase() === opts.pkColumn.toLowerCase()) ?? opts.pkColumn;
    const nextCursorPk = lastRow ? lastRow[realPkKey] : null;
    return { rows, nextVersion, nextCursorPk, isEnd: rows.length < batchSize };
  }

  /** Đọc toàn bộ PK còn tồn tại trong bảng (cho delete-detect trong rescan).
   *  Trả pks string[], nextLastPk, isEnd. Paginated theo batchSize. */
  async streamPkOnly(opts: {
    schemaTable: string;
    pkColumn: string;
    lastPk?: string | number | null;
    batchSize?: number;
  }): Promise<{ pks: string[]; nextLastPk: string | null; isEnd: boolean }> {
    const batchSize = Math.min(Math.max(opts.batchSize ?? 5_000, 1), 50_000);
    const safeName = escapeMssqlIdentifier(opts.schemaTable);
    if (!/^[\w\s]+$/.test(opts.pkColumn) || opts.pkColumn.trim() === "") {
      throw new Error(`Invalid pkColumn: "${opts.pkColumn}"`);
    }
    const safePk = `[${opts.pkColumn.replace(/]/g, "]]")}]`;
    const pool = this.requirePool();
    const req = pool.request();
    let where = "";
    if (opts.lastPk !== undefined && opts.lastPk !== null && opts.lastPk !== "") {
      req.input("lastPk", opts.lastPk);
      where = ` WHERE ${safePk} > @lastPk`;
    }
    const r = await req.query<Record<string, unknown>>(
      `SELECT TOP ${batchSize} ${safePk} FROM ${safeName}${where} ORDER BY ${safePk} ASC`,
    );
    const rows = r.recordset;
    const pkKey = rows.length > 0 ? Object.keys(rows[0]!) : [];
    const realPkKey =
      pkKey.find((k) => k.toLowerCase() === opts.pkColumn.toLowerCase()) ?? pkKey[0];
    const pks = rows.map((row) => (realPkKey ? String(row[realPkKey]) : ""));
    const nextLastPk = pks.length > 0 ? (pks[pks.length - 1] ?? null) : null;
    return { pks, nextLastPk, isEnd: rows.length < batchSize };
  }

  /** Đọc thống kê hoạt động proc từ sys.dm_exec_procedure_stats.
   *  Phase Q1: dùng để detect proc còn được gọi vs đã chết.
   *
   *  Caveat: chỉ trả proc còn trong plan cache + có execute kể từ MSSQL restart.
   *  Proc chưa từng được gọi (hoặc plan bị evict) sẽ KHÔNG xuất hiện ở đây
   *  — caller phải LEFT JOIN với danh sách proc tổng để phân biệt "chưa gọi"
   *  vs "không tồn tại". */
  async getProcStats(): Promise<ProcStats[]> {
    const pool = this.requirePool();
    const r = await pool.request().query<{
      schema: string;
      name: string;
      last_execution_time: Date | null;
      execution_count: number;
    }>(`
      SELECT
        OBJECT_SCHEMA_NAME(ps.object_id) AS [schema],
        OBJECT_NAME(ps.object_id)        AS [name],
        ps.last_execution_time,
        ps.execution_count
      FROM sys.dm_exec_procedure_stats ps
      WHERE ps.database_id = DB_ID()
      ORDER BY ps.last_execution_time DESC
    `);
    return r.recordset.map((row) => ({
      schema: row.schema,
      name: row.name,
      lastExecAt: row.last_execution_time ? row.last_execution_time.toISOString() : null,
      execCount: row.execution_count,
    }));
  }
}
