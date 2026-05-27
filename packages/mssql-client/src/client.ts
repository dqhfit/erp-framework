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
import type { ProcInfo, TableInfo } from "./types.js";

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
}
