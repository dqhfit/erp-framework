/* ==========================================================
   introspect.ts — Truy vấn metadata MSSQL: bảng, cột, PK, FK,
   stored procedure và dependency.

   Dùng INFORMATION_SCHEMA cho phần tiêu chuẩn + sys.* cho các
   info chuyên sâu (sql_modules để lấy body proc; sql_expression
   _dependencies để lấy reference chính xác).
   ========================================================== */

import type { ConnectionPool } from "mssql";
import type { TableInfo, ColumnInfo, ProcInfo, ForeignKey, ProcParameter } from "./types.js";

export async function introspectListTables(
  pool: ConnectionPool,
  schema?: string,
): Promise<Array<{ schema: string; name: string }>> {
  const req = pool.request();
  let sqlText = `
    SELECT TABLE_SCHEMA AS [schema], TABLE_NAME AS [name]
      FROM INFORMATION_SCHEMA.TABLES
     WHERE TABLE_TYPE = 'BASE TABLE'
  `;
  if (schema) {
    req.input("schema", schema);
    sqlText += ` AND TABLE_SCHEMA = @schema`;
  }
  sqlText += ` ORDER BY TABLE_SCHEMA, TABLE_NAME`;
  const r = await req.query<{ schema: string; name: string }>(sqlText);
  return r.recordset;
}

export async function introspectGetTable(
  pool: ConnectionPool,
  schema: string,
  name: string,
): Promise<TableInfo | null> {
  const tbl = await pool
    .request()
    .input("schema", schema)
    .input("name", name)
    .query<{ c: number }>(
      `SELECT COUNT(*) AS c FROM INFORMATION_SCHEMA.TABLES
        WHERE TABLE_SCHEMA = @schema AND TABLE_NAME = @name AND TABLE_TYPE = 'BASE TABLE'`,
    );
  if (!tbl.recordset[0] || tbl.recordset[0].c === 0) return null;

  const colsRes = await pool
    .request()
    .input("schema", schema)
    .input("name", name)
    .query<{
      COLUMN_NAME: string;
      DATA_TYPE: string;
      CHARACTER_MAXIMUM_LENGTH: number | null;
      NUMERIC_PRECISION: number | null;
      NUMERIC_SCALE: number | null;
      IS_NULLABLE: string;
      COLUMN_DEFAULT: string | null;
    }>(`
      SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH,
             NUMERIC_PRECISION, NUMERIC_SCALE, IS_NULLABLE, COLUMN_DEFAULT
        FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = @schema AND TABLE_NAME = @name
       ORDER BY ORDINAL_POSITION
    `);
  const columns: ColumnInfo[] = colsRes.recordset.map((c) => ({
    name: c.COLUMN_NAME,
    dataType: c.DATA_TYPE,
    maxLength: c.CHARACTER_MAXIMUM_LENGTH,
    numericPrecision: c.NUMERIC_PRECISION,
    numericScale: c.NUMERIC_SCALE,
    isNullable: c.IS_NULLABLE === "YES",
    hasDefault: c.COLUMN_DEFAULT != null,
    defaultExpr: c.COLUMN_DEFAULT,
  }));

  const pkRes = await pool
    .request()
    .input("schema", schema)
    .input("name", name)
    .query<{ COLUMN_NAME: string }>(`
      SELECT kcu.COLUMN_NAME
        FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
        JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu
          ON kcu.CONSTRAINT_NAME = tc.CONSTRAINT_NAME
         AND kcu.TABLE_SCHEMA = tc.TABLE_SCHEMA
       WHERE tc.CONSTRAINT_TYPE = 'PRIMARY KEY'
         AND tc.TABLE_SCHEMA = @schema AND tc.TABLE_NAME = @name
       ORDER BY kcu.ORDINAL_POSITION
    `);
  const primaryKey = pkRes.recordset.map((r) => r.COLUMN_NAME);

  const fkRes = await pool
    .request()
    .input("schema", schema)
    .input("name", name)
    .query<{
      COLUMN_NAME: string;
      REF_SCHEMA: string;
      REF_TABLE: string;
      REF_COLUMN: string;
    }>(`
      SELECT fkc.COLUMN_NAME AS COLUMN_NAME,
             refTab.TABLE_SCHEMA AS REF_SCHEMA,
             refTab.TABLE_NAME   AS REF_TABLE,
             refCol.COLUMN_NAME  AS REF_COLUMN
        FROM INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS rc
        JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE fkc
          ON fkc.CONSTRAINT_NAME = rc.CONSTRAINT_NAME
        JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE refCol
          ON refCol.CONSTRAINT_NAME = rc.UNIQUE_CONSTRAINT_NAME
         AND refCol.ORDINAL_POSITION = fkc.ORDINAL_POSITION
        JOIN INFORMATION_SCHEMA.TABLES refTab
          ON refTab.TABLE_NAME = refCol.TABLE_NAME
         AND refTab.TABLE_SCHEMA = refCol.TABLE_SCHEMA
       WHERE fkc.TABLE_SCHEMA = @schema AND fkc.TABLE_NAME = @name
    `);
  const foreignKeys: ForeignKey[] = fkRes.recordset.map((r) => ({
    column: r.COLUMN_NAME,
    refTable: `${r.REF_SCHEMA}.${r.REF_TABLE}`,
    refColumn: r.REF_COLUMN,
  }));

  return { schema, name, columns, primaryKey, foreignKeys };
}

export async function introspectListProcs(
  pool: ConnectionPool,
  filter?: string,
): Promise<Array<{ schema: string; name: string }>> {
  const req = pool.request();
  let sqlText = `
    SELECT s.name AS [schema], o.name AS [name]
      FROM sys.objects o
      JOIN sys.schemas s ON s.schema_id = o.schema_id
     WHERE o.type = 'P'
  `;
  if (filter) {
    req.input("filter", `%${filter}%`);
    sqlText += ` AND o.name LIKE @filter`;
  }
  sqlText += ` ORDER BY s.name, o.name`;
  const r = await req.query<{ schema: string; name: string }>(sqlText);
  return r.recordset;
}

export async function introspectGetProc(
  pool: ConnectionPool,
  schema: string,
  name: string,
): Promise<ProcInfo | null> {
  const bodyRes = await pool
    .request()
    .input("schema", schema)
    .input("name", name)
    .query<{ definition: string }>(`
      SELECT m.definition
        FROM sys.sql_modules m
        JOIN sys.objects o ON o.object_id = m.object_id
        JOIN sys.schemas s ON s.schema_id = o.schema_id
       WHERE o.type = 'P' AND s.name = @schema AND o.name = @name
    `);
  if (!bodyRes.recordset[0]) return null;
  const body = bodyRes.recordset[0].definition;

  const pRes = await pool
    .request()
    .input("schema", schema)
    .input("name", name)
    .query<{
      name: string;
      type_name: string;
      is_output: boolean;
      has_default_value: boolean;
    }>(`
      SELECT p.name, t.name AS type_name, p.is_output, p.has_default_value
        FROM sys.parameters p
        JOIN sys.objects o ON o.object_id = p.object_id
        JOIN sys.schemas s ON s.schema_id = o.schema_id
        JOIN sys.types t   ON t.user_type_id = p.user_type_id
       WHERE o.type = 'P' AND s.name = @schema AND o.name = @name
         AND p.parameter_id > 0
       ORDER BY p.parameter_id
    `);
  const parameters: ProcParameter[] = pRes.recordset.map((p) => ({
    name: p.name,
    dataType: p.type_name,
    isOutput: p.is_output,
    hasDefault: p.has_default_value,
  }));

  return { schema, name, parameters, body };
}

export async function introspectFindProcsReferencing(
  pool: ConnectionPool,
  table: string,
): Promise<Array<{ schema: string; name: string }>> {
  // Tách "schema.table" nếu có; mặc định dbo.
  const dot = table.indexOf(".");
  const sch = dot >= 0 ? table.slice(0, dot) : "dbo";
  const tbl = dot >= 0 ? table.slice(dot + 1) : table;

  // Ưu tiên sys.sql_expression_dependencies (chính xác hơn dm_sql_referenced_entities).
  // Fallback: like body proc (kém chính xác với temp table cùng tên / dynamic SQL).
  const refRes = await pool
    .request()
    .input("schema", sch)
    .input("table", tbl)
    .query<{ schema: string; name: string }>(`
      SELECT DISTINCT s.name AS [schema], o.name AS [name]
        FROM sys.sql_expression_dependencies d
        JOIN sys.objects o ON o.object_id = d.referencing_id
        JOIN sys.schemas s ON s.schema_id = o.schema_id
       WHERE o.type = 'P'
         AND d.referenced_entity_name = @table
         AND (d.referenced_schema_name IS NULL OR d.referenced_schema_name = @schema)
    `);

  if (refRes.recordset.length > 0) return refRes.recordset;

  // Fallback like trong body proc (kém chính xác).
  const fb = await pool
    .request()
    .input("pattern", `%${tbl}%`)
    .query<{ schema: string; name: string }>(`
      SELECT s.name AS [schema], o.name AS [name]
        FROM sys.sql_modules m
        JOIN sys.objects o ON o.object_id = m.object_id
        JOIN sys.schemas s ON s.schema_id = o.schema_id
       WHERE o.type = 'P' AND m.definition LIKE @pattern
       ORDER BY s.name, o.name
    `);
  return fb.recordset;
}
