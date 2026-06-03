/* ==========================================================
   SqlHighlight.tsx — Syntax highlight cho T-SQL bằng regex
   tokenizer. Không thêm dep (vd highlight.js, prismjs) để giữ
   bundle nhẹ — chỉ highlight thô đủ cho user đọc:
     - keywords (SELECT/FROM/...): text-accent
     - strings ('...'): text-success
     - numbers (123, 1.5): text-warning
     - comments (line dash-dash, block slash-star): text-muted italic
     - variables (@x): text-danger
     - bracketed/quoted identifiers ([x] "x"): text-text bold
   ========================================================== */

import { Fragment, type ReactNode } from "react";

const KEYWORDS = new Set([
  // DML / DQL
  "SELECT",
  "FROM",
  "WHERE",
  "INSERT",
  "INTO",
  "VALUES",
  "UPDATE",
  "DELETE",
  "MERGE",
  "USING",
  "MATCHED",
  "TARGET",
  "SOURCE",
  "OUTPUT",
  // joins
  "INNER",
  "OUTER",
  "LEFT",
  "RIGHT",
  "FULL",
  "CROSS",
  "JOIN",
  "ON",
  // logical
  "AND",
  "OR",
  "NOT",
  "NULL",
  "IS",
  "IN",
  "EXISTS",
  "BETWEEN",
  "LIKE",
  "AS",
  "ANY",
  "SOME",
  // grouping
  "GROUP",
  "ORDER",
  "BY",
  "HAVING",
  "UNION",
  "INTERSECT",
  "EXCEPT",
  "ALL",
  "DISTINCT",
  "TOP",
  "OFFSET",
  "FETCH",
  "NEXT",
  "ROWS",
  "ONLY",
  // control flow
  "BEGIN",
  "END",
  "IF",
  "ELSE",
  "WHILE",
  "CASE",
  "WHEN",
  "THEN",
  "BREAK",
  "CONTINUE",
  "GOTO",
  "RETURN",
  "GO",
  // DDL
  "CREATE",
  "ALTER",
  "DROP",
  "TABLE",
  "VIEW",
  "INDEX",
  "PROCEDURE",
  "PROC",
  "FUNCTION",
  "TRIGGER",
  "DATABASE",
  "SCHEMA",
  "SEQUENCE",
  // declarations
  "DECLARE",
  "SET",
  "EXEC",
  "EXECUTE",
  "WITH",
  "OVER",
  "PARTITION",
  "CURSOR",
  "OPEN",
  "FETCH",
  "CLOSE",
  "DEALLOCATE",
  // transactions
  "TRY",
  "CATCH",
  "THROW",
  "RAISERROR",
  "COMMIT",
  "ROLLBACK",
  "TRANSACTION",
  "TRAN",
  "SAVE",
  "SAVEPOINT",
  // permissions / config
  "USE",
  "GRANT",
  "REVOKE",
  "DENY",
  "PRINT",
  // types
  "INT",
  "BIGINT",
  "SMALLINT",
  "TINYINT",
  "BIT",
  "VARCHAR",
  "NVARCHAR",
  "CHAR",
  "NCHAR",
  "TEXT",
  "NTEXT",
  "VARBINARY",
  "DATETIME",
  "DATETIME2",
  "DATETIMEOFFSET",
  "SMALLDATETIME",
  "DATE",
  "TIME",
  "DECIMAL",
  "NUMERIC",
  "MONEY",
  "SMALLMONEY",
  "FLOAT",
  "REAL",
  "UNIQUEIDENTIFIER",
  "XML",
  "IMAGE",
  "TIMESTAMP",
  // common modifiers
  "PRIMARY",
  "KEY",
  "FOREIGN",
  "REFERENCES",
  "CONSTRAINT",
  "DEFAULT",
  "IDENTITY",
  "NOT",
  "UNIQUE",
  "CHECK",
  "CASCADE",
  "RESTRICT",
  "READONLY",
  "OUT",
  "NOCOUNT",
  "NOEXEC",
  "XACT_ABORT",
]);

type TokenType = "keyword" | "string" | "number" | "comment" | "var" | "ident" | "text";
interface Token {
  type: TokenType;
  text: string;
}

function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  const len = src.length;
  while (i < len) {
    const ch = src[i]!;
    const next = src[i + 1];

    // Line comment --
    if (ch === "-" && next === "-") {
      const nl = src.indexOf("\n", i);
      const end = nl < 0 ? len : nl;
      out.push({ type: "comment", text: src.slice(i, end) });
      i = end;
      continue;
    }
    // Block comment /* */
    if (ch === "/" && next === "*") {
      const end = src.indexOf("*/", i + 2);
      const stop = end < 0 ? len : end + 2;
      out.push({ type: "comment", text: src.slice(i, stop) });
      i = stop;
      continue;
    }
    // String '...' (escape '')
    if (ch === "'") {
      let j = i + 1;
      while (j < len) {
        if (src[j] === "'" && src[j + 1] === "'") {
          j += 2;
          continue;
        }
        if (src[j] === "'") {
          j++;
          break;
        }
        j++;
      }
      out.push({ type: "string", text: src.slice(i, j) });
      i = j;
      continue;
    }
    // Variable / param @name
    if (ch === "@") {
      let j = i + 1;
      // T-SQL: @@servervar, @@trancount …
      if (src[j] === "@") j++;
      while (j < len && /[A-Za-z0-9_]/.test(src[j]!)) j++;
      out.push({ type: "var", text: src.slice(i, j) });
      i = j;
      continue;
    }
    // Bracketed identifier [name]
    if (ch === "[") {
      const end = src.indexOf("]", i + 1);
      const stop = end < 0 ? len : end + 1;
      out.push({ type: "ident", text: src.slice(i, stop) });
      i = stop;
      continue;
    }
    // Quoted identifier "name"
    if (ch === '"') {
      const end = src.indexOf('"', i + 1);
      const stop = end < 0 ? len : end + 1;
      out.push({ type: "ident", text: src.slice(i, stop) });
      i = stop;
      continue;
    }
    // Number
    if (/[0-9]/.test(ch) || (ch === "." && next && /[0-9]/.test(next))) {
      let j = i + 1;
      while (j < len && /[0-9.eE+-]/.test(src[j]!)) {
        // Stop trên +/- nếu không nằm sau e/E (mantissa).
        const c = src[j]!;
        if ((c === "+" || c === "-") && src[j - 1] !== "e" && src[j - 1] !== "E") break;
        j++;
      }
      out.push({ type: "number", text: src.slice(i, j) });
      i = j;
      continue;
    }
    // Identifier / keyword
    if (/[A-Za-z_]/.test(ch)) {
      let j = i + 1;
      while (j < len && /[A-Za-z0-9_]/.test(src[j]!)) j++;
      const word = src.slice(i, j);
      out.push({
        type: KEYWORDS.has(word.toUpperCase()) ? "keyword" : "text",
        text: word,
      });
      i = j;
      continue;
    }
    // Other (whitespace, punctuation) — gom vào "text" để giảm số node.
    let j = i + 1;
    while (j < len) {
      const c = src[j]!;
      if (/[A-Za-z0-9_@[\]"'.]/.test(c)) break;
      if (c === "-" && src[j + 1] === "-") break;
      if (c === "/" && src[j + 1] === "*") break;
      j++;
    }
    out.push({ type: "text", text: src.slice(i, j) });
    i = j;
  }
  return out;
}

const CLASS_BY_TYPE: Record<TokenType, string> = {
  keyword: "text-accent font-semibold",
  string: "text-success",
  number: "text-warning",
  comment: "text-muted italic",
  var: "text-danger",
  ident: "text-text font-medium",
  text: "",
};

export interface SqlBlockProps {
  text: string;
  className?: string;
}

/** Render block T-SQL với syntax highlight. Wrapper `<pre>` để giữ whitespace. */
export function SqlBlock({ text, className }: SqlBlockProps) {
  const tokens = tokenize(text);
  return (
    <pre
      className={[
        "bg-bg p-2 rounded border border-border overflow-auto text-[11px] leading-relaxed",
        "font-mono whitespace-pre",
        className ?? "",
      ].join(" ")}
    >
      {tokens.map((t, i) => renderToken(t, i))}
    </pre>
  );
}

function renderToken(t: Token, i: number): ReactNode {
  const cls = CLASS_BY_TYPE[t.type];
  if (!cls) return <Fragment key={i}>{t.text}</Fragment>;
  return (
    <span key={i} className={cls}>
      {t.text}
    </span>
  );
}
