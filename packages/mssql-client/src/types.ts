/* ==========================================================
   types.ts — Kiểu dữ liệu chung cho MSSQL client.
   Đại diện schema introspection + kết quả phân tích procedure
   để bên CLI/migration sinh manifest YAML.
   ========================================================== */

export interface ColumnInfo {
  name: string;
  /** Kiểu raw từ INFORMATION_SCHEMA.COLUMNS.DATA_TYPE — vd "nvarchar", "int". */
  dataType: string;
  /** Độ dài cho text (-1 = MAX); null nếu không áp dụng. */
  maxLength: number | null;
  numericPrecision: number | null;
  numericScale: number | null;
  isNullable: boolean;
  /** Có default expression không (gợi ý PK auto-increment / GETDATE() …). */
  hasDefault: boolean;
  defaultExpr: string | null;
}

export interface TableInfo {
  schema: string; // vd "dbo"
  name: string; // tên bảng
  columns: ColumnInfo[];
  primaryKey: string[]; // có thể composite
  /** FK declared (nếu DB có khai báo) — proc-parse sẽ bổ sung quan hệ ẩn. */
  foreignKeys: ForeignKey[];
}

export interface ForeignKey {
  /** Cột bên bảng hiện tại. */
  column: string;
  /** Bảng đích "schema.table". */
  refTable: string;
  /** Cột đích. */
  refColumn: string;
}

export interface ProcInfo {
  schema: string;
  name: string;
  /** Tham số khai báo (parse từ thân hoặc sys.parameters). */
  parameters: ProcParameter[];
  /** Body T-SQL đầy đủ. */
  body: string;
}

export interface ProcParameter {
  name: string; // có dấu @ ở đầu
  dataType: string;
  isOutput: boolean;
  hasDefault: boolean;
}

/** Kết quả phân tích heuristic 1 proc — input cho generator. */
export interface ProcAnalysis {
  /** Bảng được đọc (FROM/JOIN/subquery). Lưu "schema.table" lowercase. */
  readsTables: string[];
  /** Bảng được ghi (INSERT/UPDATE/DELETE/MERGE). */
  writesTables: string[];
  /** Cặp cột nối phát hiện qua ON A.x = B.y — suy ra relation ẩn. */
  joinPairs: JoinPair[];
  /** Proc khác được EXEC. */
  callsProcs: string[];
  /** Flag để classifier chọn tier B/C/D. */
  flags: ProcFlag[];
  /** Tier đề xuất ban đầu — user override trong manifest. */
  suggestedTier: "B" | "C" | "D";
}

export interface JoinPair {
  leftTable: string; // alias resolved về tên bảng nếu có thể; nếu không lưu alias
  leftColumn: string;
  rightTable: string;
  rightColumn: string;
  /** Nếu có: quan hệ được suy luận qua bảng trung gian.
   *  Format: "cte:<name>" hoặc "tmp:<#name>". Undefined = direct JOIN. */
  via?: string;
}

/** Thống kê hoạt động proc đọc từ sys.dm_exec_procedure_stats.
 *  Phase Q1 — dùng để detect proc còn dùng vs đã chết.
 *  Lưu ý: data chỉ có từ lần restart MSSQL gần nhất + plan còn trong cache. */
export interface ProcStats {
  schema: string;
  name: string;
  /** ISO timestamp lần gọi cuối, hoặc null nếu chưa từng gọi. */
  lastExecAt: string | null;
  /** Tổng số lần gọi kể từ lần MSSQL restart. */
  execCount: number;
}

export type ProcFlag =
  | "has-transaction"
  | "has-try-catch"
  | "has-cursor"
  | "has-while"
  | "has-cte"
  | "has-group-by"
  | "has-window"
  | "has-merge"
  | "has-temp-table"
  | "calls-other-proc"
  | "writes-multi-table"
  | "dynamic-sql";
