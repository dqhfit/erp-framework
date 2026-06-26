/* ==========================================================
   client.ts — MssqlClient: bao quanh driver `mssql`, cung cấp
   API gọn cho CLI migration + plugin bridge.

   Read-only mặc định. Để cho phép write phải set env
   MSSQL_ALLOW_WRITE=1 — chống "framework ghi nhầm MSSQL" trong
   giai đoạn quá độ.
   ========================================================== */

import sql, { type ConnectionPool, type ISqlType, type config as MssqlConfig } from "mssql";
import {
  introspectFindProcsReferencing,
  introspectGetProc,
  introspectGetTable,
  introspectListProcs,
  introspectListTables,
} from "./introspect.js";
import type { ColumnInfo, ProcInfo, ProcStats, TableInfo } from "./types.js";

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

/** Hint đọc bẩn cho SELECT mirror 1 chiều (import/sync/reconcile): KHÔNG lấy
 *  shared lock + KHÔNG chờ exclusive lock của writer. Bảng "nóng" ghi liên tục
 *  (vd tr_muctieu_sanxuat, SYS_USER) nếu đọc theo READ COMMITTED sẽ BLOCK vô hạn
 *  → treo worker. Mirror là 1 chiều + rescan định kỳ tự hội tụ nên dirty read
 *  chấp nhận được. Đặt SAU alias: `FROM t AS x WITH (NOLOCK)`. */
const NOLOCK = "WITH (NOLOCK)";

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
    const r = await pool
      .request()
      .query<T>(`SELECT TOP ${limit} * FROM ${safeName} ${NOLOCK}${where}`);
    return r.recordset as T[];
  }

  /** Đếm số dòng 1 bảng — dùng cho reconciliation sau full-import (so với
   *  count entity_records phía PG). schemaTable validate + bracket-escape. */
  async countRows(schemaTable: string): Promise<number> {
    const safeName = escapeMssqlIdentifier(schemaTable);
    const pool = this.requirePool();
    const r = await pool
      .request()
      .query<{ n: number }>(`SELECT COUNT_BIG(*) AS n FROM ${safeName} ${NOLOCK}`);
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
    /** 1 cột PK, HOẶC PK GHÉP dạng "col1,col2[,col3]" (keyset tuple). */
    schemaTable: string;
    pkColumn: string;
    /** PK đơn: giá trị thô. PK ghép: chuỗi JSON mảng giá trị (do chính
     *  method này trả ở nextLastPk — caller chỉ cần truyền lại nguyên văn). */
    lastPk?: string | number | null;
    batchSize?: number;
    /** CHỈ đọc các cột này (+ luôn kèm cột PK để keyset). Bỏ -> `SELECT *`.
     *  Dùng để KHÔNG kéo cột nặng/không cần (vd ảnh chữ ký image, credential)
     *  qua đường truyền — `SELECT *` 1 ảnh lớn × batch sẽ treo/OOM worker. */
    columns?: string[];
  }): Promise<{ rows: T[]; nextLastPk: string | null; isEnd: boolean }> {
    const batchSize = Math.min(Math.max(opts.batchSize ?? 5_000, 1), 50_000);
    const safeName = escapeMssqlIdentifier(opts.schemaTable);
    // Tách PK ghép "a,b,c" — mỗi cột validate riêng (word + space).
    const pkCols = opts.pkColumn
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (pkCols.length === 0 || pkCols.length > 3) {
      throw new Error(`Invalid pkColumn: "${opts.pkColumn}" (cần 1-3 cột)`);
    }
    for (const c of pkCols) {
      if (!/^[\w\s]+$/.test(c)) throw new Error(`Invalid pkColumn: "${c}"`);
    }
    const safeCols = pkCols.map((c) => `[${c.replace(/]/g, "]]")}]`);
    const orderBy = safeCols.map((c) => `${c} ASC`).join(", ");

    // Projection: chỉ đọc cột cần (luôn kèm PK cho ORDER BY/keyset). Dedup
    // case-insensitive (SQL Server không phân biệt hoa-thường tên cột — chọn
    // trùng case khác nhau = lỗi cột trùng). Bỏ columns -> SELECT *.
    let selectList = "*";
    if (opts.columns && opts.columns.length > 0) {
      const seen = new Set<string>();
      const picked: string[] = [];
      for (const c of [...pkCols, ...opts.columns]) {
        const cc = c.trim();
        if (!cc) continue;
        if (!/^[\w\s]+$/.test(cc)) throw new Error(`Invalid column: "${cc}"`);
        const lc = cc.toLowerCase();
        if (seen.has(lc)) continue;
        seen.add(lc);
        picked.push(`[${cc.replace(/]/g, "]]")}]`);
      }
      if (picked.length > 0) selectList = picked.join(", ");
    }

    const pool = this.requirePool();
    const req = pool.request();
    let where = "";
    if (opts.lastPk !== undefined && opts.lastPk !== null && opts.lastPk !== "") {
      if (pkCols.length === 1) {
        req.input("lastPk", opts.lastPk);
        where = ` WHERE ${safeCols[0]} > @lastPk`;
      } else {
        // PK ghép: lastPk là JSON mảng giá trị theo thứ tự cột. Keyset tuple:
        // (k1 > @p0) OR (k1 = @p0 AND k2 > @p1) [OR (k1=@p0 AND k2=@p1 AND k3 > @p2)]
        let vals: unknown[];
        try {
          vals = JSON.parse(String(opts.lastPk)) as unknown[];
        } catch {
          throw new Error(`lastPk PK ghép phải là JSON mảng, nhận: "${opts.lastPk}"`);
        }
        if (!Array.isArray(vals) || vals.length !== pkCols.length) {
          throw new Error(
            `lastPk PK ghép cần đúng ${pkCols.length} giá trị, nhận ${Array.isArray(vals) ? vals.length : "không phải mảng"}`,
          );
        }
        vals.forEach((v, i) => req.input(`p${i}`, v as string | number));
        const branches: string[] = [];
        for (let i = 0; i < pkCols.length; i++) {
          const eqs = safeCols
            .slice(0, i)
            .map((c, j) => `${c} = @p${j}`)
            .concat(`${safeCols[i]} > @p${i}`);
          branches.push(`(${eqs.join(" AND ")})`);
        }
        where = ` WHERE ${branches.join(" OR ")}`;
      }
    }
    const queryText = `SELECT TOP ${batchSize} ${selectList} FROM ${safeName} ${NOLOCK}${where} ORDER BY ${orderBy}`;
    const r = await req.query<T>(queryText);
    const rows = r.recordset as T[];
    let nextLastPk: string | null = null;
    if (rows.length > 0) {
      const lastRow = rows[rows.length - 1] as Record<string, unknown>;
      // Tìm key match cột case-insensitive (MSSQL có thể trả khác case).
      const valOf = (col: string): unknown => {
        const k = Object.keys(lastRow).find((x) => x.toLowerCase() === col.toLowerCase());
        return k == null ? null : lastRow[k];
      };
      if (pkCols.length === 1) {
        const v = valOf(pkCols[0] ?? "");
        nextLastPk = v == null ? null : String(v);
      } else {
        const vals = pkCols.map((c) => {
          const v = valOf(c);
          return v == null ? null : v instanceof Date ? v.toISOString() : String(v);
        });
        // Bất kỳ thành phần nào null → không checkpoint an toàn được.
        nextLastPk = vals.some((v) => v == null) ? null : JSON.stringify(vals);
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
      LEFT JOIN ${safeName} AS t ${NOLOCK} ON ct.${safePk} = t.${safePk}
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
      `SELECT TOP ${batchSize} ${safePk} FROM ${safeName} ${NOLOCK}${where} ORDER BY ${safePk} ASC`,
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

  /* ── GHI MSSQL — CHỈ cho reverse replica (PG→MSSQL). Mọi method dưới đây
     `requireWrite()` → ném nếu connection KHÔNG allowWrite (fail-closed,
     không bao giờ ghi nhầm connection read-only). ──────────────────────── */

  /** Pool + bắt buộc allowWrite=true. */
  private requireWrite(): ConnectionPool {
    if (!this.opts.allowWrite) {
      throw new Error(
        "MssqlClient ở chế độ read-only — thao tác ghi bị chặn. Connection reverse replica phải allowWrite=true.",
      );
    }
    return this.requirePool();
  }

  /** Validate + bracket-escape 1 tên cột. */
  private static col(c: string): string {
    if (!/^[\w\s]+$/.test(c) || c.trim() === "") throw new Error(`Invalid column: "${c}"`);
    return `[${c.replace(/]/g, "]]")}]`;
  }

  /** ISqlType cho 1 cột theo dataType (bind TYPED → tránh implicit convert lỗi). */
  private static typeOf(col: ColumnInfo): ISqlType {
    const t = col.dataType.toLowerCase();
    switch (t) {
      case "bit":
        return sql.Bit();
      case "tinyint":
        return sql.TinyInt();
      case "smallint":
        return sql.SmallInt();
      case "int":
        return sql.Int();
      case "bigint":
        return sql.BigInt();
      case "decimal":
      case "numeric":
        return sql.Decimal(col.numericPrecision ?? 18, col.numericScale ?? 0);
      case "money":
        return sql.Money();
      case "smallmoney":
        return sql.SmallMoney();
      case "float":
        return sql.Float();
      case "real":
        return sql.Real();
      case "date":
        return sql.Date();
      case "datetime":
        return sql.DateTime();
      case "datetime2":
        return sql.DateTime2();
      case "smalldatetime":
        return sql.SmallDateTime();
      case "datetimeoffset":
        return sql.DateTimeOffset();
      case "time":
        return sql.Time();
      case "uniqueidentifier":
        return sql.UniqueIdentifier();
      case "char":
        return col.maxLength && col.maxLength > 0 ? sql.Char(col.maxLength) : sql.Char();
      case "nchar":
        return col.maxLength && col.maxLength > 0 ? sql.NChar(col.maxLength) : sql.NChar();
      case "varchar":
        return col.maxLength === -1 ? sql.VarChar(sql.MAX) : sql.VarChar(col.maxLength ?? 255);
      case "nvarchar":
        return col.maxLength === -1 ? sql.NVarChar(sql.MAX) : sql.NVarChar(col.maxLength ?? 255);
      case "text":
        return sql.Text();
      case "ntext":
        return sql.NText();
      default:
        return sql.NVarChar(sql.MAX);
    }
  }

  /** Coerce giá trị JS (từ PG) sang dạng hợp cột MSSQL — fail-safe: xấu → null. */
  private static coerce(col: ColumnInfo, v: unknown): unknown {
    if (v == null || v === "") return null;
    const t = col.dataType.toLowerCase();
    if (t === "bit") {
      if (typeof v === "boolean") return v;
      const s = String(v).toLowerCase();
      if (s === "true" || s === "1") return true;
      if (s === "false" || s === "0") return false;
      return null;
    }
    if (
      [
        "tinyint",
        "smallint",
        "int",
        "bigint",
        "decimal",
        "numeric",
        "money",
        "smallmoney",
        "float",
        "real",
      ].includes(t)
    ) {
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    }
    if (["date", "datetime", "datetime2", "smalldatetime", "datetimeoffset"].includes(t)) {
      const d = v instanceof Date ? v : new Date(String(v));
      return Number.isNaN(d.getTime()) ? null : d;
    }
    return typeof v === "string" ? v : String(v);
  }

  private typeFor(columnTypes: Map<string, ColumnInfo>, col: string): ColumnInfo {
    const ci = columnTypes.get(col.toLowerCase());
    if (!ci) throw new Error(`Cột "${col}" không có trong schema MSSQL đích`);
    return ci;
  }

  /** MERGE từng row theo keyColumns (case-insensitive). Bind TYPED. identityInsert
   *  → bọc SET IDENTITY_INSERT ON/OFF trong 1 transaction (giữ scope qua nhiều
   *  statement). Trả {inserted, updated} đếm qua OUTPUT $action. */
  async upsertRows(opts: {
    schemaTable: string;
    keyColumns: string[];
    columns: string[];
    rows: Array<Record<string, unknown>>;
    columnTypes: Map<string, ColumnInfo>;
    identityInsert?: boolean;
  }): Promise<{ inserted: number; updated: number }> {
    this.requireWrite();
    const pool = this.requirePool();
    if (opts.rows.length === 0) return { inserted: 0, updated: 0 };
    const safeTbl = escapeMssqlIdentifier(opts.schemaTable);
    const keyLc = new Set(opts.keyColumns.map((k) => k.toLowerCase()));
    const updateCols = opts.columns.filter((c) => !keyLc.has(c.toLowerCase()));
    const cb = MssqlClient.col;

    const usingSel = opts.columns.map((c, i) => `@c${i} AS ${cb(c)}`).join(", ");
    const onClause = opts.keyColumns.map((k) => `tgt.${cb(k)} = src.${cb(k)}`).join(" AND ");
    const insertCols = opts.columns.map(cb).join(", ");
    const insertVals = opts.columns.map((c) => `src.${cb(c)}`).join(", ");
    const matched = updateCols.length
      ? `WHEN MATCHED THEN UPDATE SET ${updateCols.map((c) => `tgt.${cb(c)} = src.${cb(c)}`).join(", ")}`
      : "";
    const mergeSql = `MERGE ${safeTbl} WITH (HOLDLOCK) AS tgt
      USING (SELECT ${usingSel}) AS src ON ${onClause}
      ${matched}
      WHEN NOT MATCHED THEN INSERT (${insertCols}) VALUES (${insertVals})
      OUTPUT $action AS act;`;

    const tx = new sql.Transaction(pool);
    await tx.begin();
    let inserted = 0;
    let updated = 0;
    try {
      if (opts.identityInsert) {
        await new sql.Request(tx).query(`SET IDENTITY_INSERT ${safeTbl} ON;`);
      }
      for (const row of opts.rows) {
        const req = new sql.Request(tx);
        opts.columns.forEach((c, i) => {
          const ci = this.typeFor(opts.columnTypes, c);
          req.input(`c${i}`, MssqlClient.typeOf(ci), MssqlClient.coerce(ci, row[c]));
        });
        const r = await req.query<{ act: string }>(mergeSql);
        for (const o of r.recordset) {
          if (o.act === "INSERT") inserted++;
          else if (o.act === "UPDATE") updated++;
        }
      }
      if (opts.identityInsert) {
        await new sql.Request(tx).query(`SET IDENTITY_INSERT ${safeTbl} OFF;`);
      }
      await tx.commit();
    } catch (e) {
      await tx.rollback().catch(() => {});
      throw e;
    }
    return { inserted, updated };
  }

  /** Hard DELETE từng row theo keyColumns. */
  async deleteRows(opts: {
    schemaTable: string;
    keyColumns: string[];
    keys: Array<Record<string, unknown>>;
    columnTypes: Map<string, ColumnInfo>;
  }): Promise<number> {
    this.requireWrite();
    const pool = this.requirePool();
    if (opts.keys.length === 0) return 0;
    const safeTbl = escapeMssqlIdentifier(opts.schemaTable);
    const cb = MssqlClient.col;
    const where = opts.keyColumns.map((k, i) => `${cb(k)} = @k${i}`).join(" AND ");
    const delSql = `DELETE FROM ${safeTbl} WHERE ${where};`;
    let n = 0;
    for (const key of opts.keys) {
      const req = pool.request();
      opts.keyColumns.forEach((k, i) => {
        const ci = this.typeFor(opts.columnTypes, k);
        req.input(`k${i}`, MssqlClient.typeOf(ci), MssqlClient.coerce(ci, key[k]));
      });
      const r = await req.query(delSql);
      n += r.rowsAffected[0] ?? 0;
    }
    return n;
  }

  /** Soft-delete = UPDATE set softDeleteCol theo keyColumns (delete_mode='soft'). */
  async softFlagRows(opts: {
    schemaTable: string;
    keyColumns: string[];
    softDeleteCol: string;
    flagValue: unknown;
    keys: Array<Record<string, unknown>>;
    columnTypes: Map<string, ColumnInfo>;
  }): Promise<number> {
    this.requireWrite();
    const pool = this.requirePool();
    if (opts.keys.length === 0) return 0;
    const safeTbl = escapeMssqlIdentifier(opts.schemaTable);
    const cb = MssqlClient.col;
    const softCi = this.typeFor(opts.columnTypes, opts.softDeleteCol);
    const where = opts.keyColumns.map((k, i) => `${cb(k)} = @k${i}`).join(" AND ");
    const updSql = `UPDATE ${safeTbl} SET ${cb(opts.softDeleteCol)} = @flag WHERE ${where};`;
    let n = 0;
    for (const key of opts.keys) {
      const req = pool.request();
      req.input("flag", MssqlClient.typeOf(softCi), MssqlClient.coerce(softCi, opts.flagValue));
      opts.keyColumns.forEach((k, i) => {
        const ci = this.typeFor(opts.columnTypes, k);
        req.input(`k${i}`, MssqlClient.typeOf(ci), MssqlClient.coerce(ci, key[k]));
      });
      const r = await req.query(updSql);
      n += r.rowsAffected[0] ?? 0;
    }
    return n;
  }

  /** Cột PK có phải IDENTITY + max(pk) hiện tại — seed dải id khi ERP tự cấp. */
  async getIdentityInfo(
    schemaTable: string,
    pkColumn: string,
  ): Promise<{ isIdentity: boolean; maxId: number | null }> {
    const safeTbl = escapeMssqlIdentifier(schemaTable);
    const safePk = MssqlClient.col(pkColumn);
    const pool = this.requirePool();
    const r = await pool
      .request()
      .input("col", pkColumn)
      .query<{
        is_identity: number;
        max_id: string | null;
      }>(
        `SELECT COLUMNPROPERTY(OBJECT_ID('${safeTbl}'), @col, 'IsIdentity') AS is_identity,
              CAST((SELECT MAX(${safePk}) FROM ${safeTbl} ${NOLOCK}) AS varchar(40)) AS max_id`,
      );
    const row = r.recordset[0];
    return {
      isIdentity: Number(row?.is_identity ?? 0) === 1,
      maxId: row?.max_id != null ? Number(row.max_id) : null,
    };
  }
}
