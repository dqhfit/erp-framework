/* ==========================================================
   mcp-backup.ts — MCP server (JSON-RPC over HTTP) + endpoint STREAM tải
   sao lưu OFFSITE cho operator.

   Mục tiêu: cho 1 máy KHÁC (offsite) kéo backup TOÀN BỘ dữ liệu theo lịch
   — độc lập với backup push-lên-Google-Drive (backup.ts). Script cài ở máy
   khác (tooling/backup-pull) chỉ cần curl/PowerShell + X-API-Key.

   Endpoint:
   - POST /mcp/backup            (JSON-RPC 2.0): backup_info (kích thước DB +
     uploads để verify), backup_list (lịch sử Drive runs), backup_run (kích
     hoạt Drive backup ngay).
   - GET  /mcp/backup/db         : STREAM pg_dump -Fc TOÀN BỘ database (mọi
     tenant) — restore bằng pg_restore.
   - GET  /mcp/backup/uploads    : STREAM tar.gz thư mục UPLOAD_DIR (file tải lên).

   Auth: header X-API-Key (api_keys), scope (deny-by-default):
   - backup:read  → backup_info, backup_list
   - backup:run   → kích hoạt Drive backup
   - backup:full  → TẢI dump DB + uploads (toàn hệ thống, đa tenant) — bao read
   - "*" / "backup:*" → toàn quyền
   Dump là TOÀN BỘ DB (đa tenant) nên CHỈ cấp backup:full cho key sao lưu
   riêng của operator, KHÔNG cấp cho key tenant thường.
   ========================================================== */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { backupRuns } from "@erp-framework/db";
import { desc, eq, sql } from "drizzle-orm";
import type { FastifyInstance, FastifyReply } from "fastify";
import { authApiKey } from "./api-key-auth";
import type { DB } from "./db";
import { enqueueBackupRun } from "./jobs";

const UPLOAD_DIR = process.env.UPLOAD_DIR ?? "/data/uploads";

/* ── Scope helper ───────────────────────────────────────────── */
export function hasBackupScope(scopes: string[], level: "read" | "run" | "full" = "read"): boolean {
  if (scopes.includes("*") || scopes.includes("backup:*")) return true;
  if (level === "full") return scopes.includes("backup:full");
  if (level === "run") return scopes.includes("backup:run");
  // read: full bao luôn read (operator có key full thì xem info được).
  return scopes.includes("backup:read") || scopes.includes("backup:full");
}

/* ── Lỗi tool ───────────────────────────────────────────────── */
class McpError extends Error {
  code: number;
  constructor(message: string, code = -32602) {
    super(message);
    this.code = code;
  }
}

function asObj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
}

/* ── Tool definitions ───────────────────────────────────────── */
interface ToolDef {
  name: string;
  description: string;
  level: "read" | "run";
  inputSchema: Record<string, unknown>;
}

const TOOLS: ToolDef[] = [
  {
    name: "backup_info",
    description:
      "Trạng thái nguồn sao lưu để VERIFY trước/sau khi kéo backup. Trả: database, " +
      "sizeBytes + sizePretty (pg_database_size), tableCount, uploads {dir, fileCount, " +
      "bytes}, pgVersion, serverTime. Dùng để kiểm tra kết nối + ước lượng dung lượng " +
      "sẽ tải về (so với kích thước file đã tải để phát hiện thiếu).",
    level: "read",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "backup_list",
    description:
      "Lịch sử các lần backup push-lên-Google-Drive (backup_runs) của công ty gắn với " +
      "API key. Trả: id, trigger, status, startedAt, finishedAt, dbBytes, uploadsSynced, " +
      "error. Dùng để xem backup Drive gần nhất chạy khi nào, có lỗi không.",
    level: "read",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", minimum: 1, maximum: 50, description: "Số dòng (mặc định 10)" },
      },
    },
  },
  {
    name: "backup_run",
    description:
      "Kích hoạt NGAY 1 lần backup push-lên-Google-Drive cho công ty (giống nút 'Sao lưu " +
      "ngay'). Trả runId để theo dõi qua backup_list. Cần scope backup:run.",
    level: "run",
    inputSchema: { type: "object", properties: {} },
  },
];

/* ── Uploads dir stat (đệ quy) ──────────────────────────────── */
async function dirStat(dir: string): Promise<{ fileCount: number; bytes: number }> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return { fileCount: 0, bytes: 0 };
  }
  let fileCount = 0;
  let bytes = 0;
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      const sub = await dirStat(p);
      fileCount += sub.fileCount;
      bytes += sub.bytes;
    } else if (e.isFile()) {
      try {
        const st = await stat(p);
        fileCount += 1;
        bytes += st.size;
      } catch {
        /* file biến mất giữa chừng — bỏ qua */
      }
    }
  }
  return { fileCount, bytes };
}

/* ── Tool dispatch ──────────────────────────────────────────── */
async function callBackupTool(
  db: DB,
  companyId: string,
  scopes: string[],
  name: string,
  rawArgs: unknown,
): Promise<unknown> {
  const args = asObj(rawArgs);
  switch (name) {
    case "backup_info": {
      if (!hasBackupScope(scopes, "read")) throw new McpError("Thiếu scope backup:read", -32604);
      const rows = (await db.execute(sql`
        SELECT current_database() AS database,
          pg_database_size(current_database()) AS size_bytes,
          pg_size_pretty(pg_database_size(current_database())) AS size_pretty,
          (SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public') AS table_count,
          version() AS pg_version,
          now() AS server_time
      `)) as unknown as Array<Record<string, unknown>>;
      const meta = rows[0] ?? {};
      const up = await dirStat(UPLOAD_DIR);
      return {
        database: meta.database,
        sizeBytes: Number(meta.size_bytes ?? 0),
        sizePretty: meta.size_pretty,
        tableCount: Number(meta.table_count ?? 0),
        uploads: { dir: UPLOAD_DIR, fileCount: up.fileCount, bytes: up.bytes },
        pgVersion: meta.pg_version,
        serverTime: meta.server_time,
        downloads: { db: "GET /mcp/backup/db", uploads: "GET /mcp/backup/uploads" },
      };
    }
    case "backup_list": {
      if (!hasBackupScope(scopes, "read")) throw new McpError("Thiếu scope backup:read", -32604);
      const limit = Math.min(50, Math.max(1, Number(args.limit ?? 10)));
      return db
        .select()
        .from(backupRuns)
        .where(eq(backupRuns.companyId, companyId))
        .orderBy(desc(backupRuns.startedAt))
        .limit(limit);
    }
    case "backup_run": {
      if (!hasBackupScope(scopes, "run")) throw new McpError("Thiếu scope backup:run", -32604);
      const runId = await enqueueBackupRun(companyId, "manual");
      return { runId, queued: true };
    }
    default:
      throw new McpError(`Tool không tồn tại: ${name}`, -32601);
  }
}

/* ── Stream 1 child-process stdout xuống reply ──────────────── */
function streamProcess(
  reply: FastifyReply,
  cmd: string,
  args: string[],
  contentType: string,
  filename: string,
  tag: string,
): void {
  const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
  let errBuf = "";
  child.stderr.on("data", (c) => {
    if (errBuf.length < 4000) errBuf += c.toString();
  });
  child.on("error", (e) => {
    // Binary thiếu (vd pg_dump/tar) — huỷ kết nối, log.
    console.error(`[mcp/backup] ${tag} spawn lỗi:`, (e as Error).message);
    reply.raw.destroy(e as Error);
  });
  child.on("close", (code) => {
    if (code !== 0) console.error(`[mcp/backup] ${tag} exit ${code}: ${errBuf}`);
  });
  reply.header("Content-Type", contentType);
  reply.header("Content-Disposition", `attachment; filename="${filename}"`);
  reply.header("Cache-Control", "no-store");
  // Client huỷ giữa chừng → kill child để không treo pg_dump/tar.
  reply.raw.on("close", () => {
    if (!child.killed) child.kill("SIGTERM");
  });
  void reply.send(child.stdout);
}

/* ── JSON-RPC + download routes ─────────────────────────────── */
interface JsonRpcReq {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: unknown;
}

export function registerBackupMcp(app: FastifyInstance, db: DB): void {
  // POST /mcp/backup — JSON-RPC 2.0.
  app.post("/mcp/backup", async (req, reply) => {
    const auth = await authApiKey(db, req);
    if (!auth) return reply.code(401).send({ error: "Invalid API key" });
    if (!hasBackupScope(auth.scopes, "read")) {
      return reply.code(403).send({ error: "Thiếu scope backup:read" });
    }
    const body = (req.body ?? {}) as JsonRpcReq;
    const id = body.id ?? null;
    const method = body.method;
    const ok = (result: unknown) => reply.send({ jsonrpc: "2.0", id, result });
    const fail = (code: number, message: string) =>
      reply.send({ jsonrpc: "2.0", id, error: { code, message } });

    try {
      switch (method) {
        case "initialize":
          return ok({
            protocolVersion: "2024-11-05",
            capabilities: { tools: {} },
            serverInfo: { name: "erp-backup", version: "1.0.0" },
          });
        case "notifications/initialized":
          return reply.code(204).send();
        case "ping":
          return ok({});
        case "tools/list":
          return ok({
            tools: TOOLS.map((t) => ({
              name: t.name,
              description: t.description,
              inputSchema: t.inputSchema,
            })),
          });
        case "tools/call": {
          const p = asObj(body.params);
          const data = await callBackupTool(
            db,
            auth.companyId,
            auth.scopes,
            String(p.name ?? ""),
            p.arguments,
          );
          return ok({ content: [{ type: "text", text: JSON.stringify(data, null, 2) }] });
        }
        default:
          return fail(-32601, `Method không hỗ trợ: ${method ?? "?"}`);
      }
    } catch (e) {
      if (e instanceof McpError) return fail(e.code, e.message);
      console.error("[mcp/backup] lỗi:", e);
      return fail(-32603, (e as Error).message || "Lỗi nội bộ");
    }
  });

  // GET /mcp/backup/db — STREAM pg_dump custom-format TOÀN BỘ database.
  app.get("/mcp/backup/db", async (req, reply) => {
    const auth = await authApiKey(db, req);
    if (!auth) return reply.code(401).send({ error: "Invalid API key" });
    if (!hasBackupScope(auth.scopes, "full")) {
      return reply.code(403).send({ error: "Thiếu scope backup:full" });
    }
    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) return reply.code(500).send({ error: "DATABASE_URL chưa đặt" });
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    // -Fc: custom format (nén sẵn) — restore bằng pg_restore. --no-owner/--no-acl
    // để restore sang DB/role khác không vướng quyền.
    streamProcess(
      reply,
      "pg_dump",
      ["-Fc", "--no-owner", "--no-acl", dbUrl],
      "application/octet-stream",
      `erp-db-${ts}.dump`,
      "pg_dump",
    );
    return reply;
  });

  // GET /mcp/backup/uploads — STREAM tar.gz thư mục UPLOAD_DIR (mọi company).
  app.get("/mcp/backup/uploads", async (req, reply) => {
    const auth = await authApiKey(db, req);
    if (!auth) return reply.code(401).send({ error: "Invalid API key" });
    if (!hasBackupScope(auth.scopes, "full")) {
      return reply.code(403).send({ error: "Thiếu scope backup:full" });
    }
    if (!existsSync(UPLOAD_DIR)) {
      // Chưa có file tải lên nào — 204 để script bỏ qua, không coi là lỗi.
      return reply.code(204).send();
    }
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    // -C UPLOAD_DIR . : đóng gói NỘI DUNG thư mục (path tương đối) cho dễ giải nén.
    streamProcess(
      reply,
      "tar",
      ["-czf", "-", "-C", UPLOAD_DIR, "."],
      "application/gzip",
      `erp-uploads-${ts}.tar.gz`,
      "tar",
    );
    return reply;
  });
}
