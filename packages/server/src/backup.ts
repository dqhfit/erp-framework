/* ==========================================================
   backup.ts — Engine sao lưu chạy server-side cho mỗi company.
   - DB: pg_dump custom-format (Buffer trong RAM) → upload Drive
     subfolder db/ với tên erp-db-<ISO>.dump.
   - Uploads: walk /data/uploads/<companyId>/, sync 1-1 vào
     subfolder uploads/. State cache trong upload_sync_state để
     bỏ qua file không đổi (so size + mtime).
   Trả về kết quả tổng kết — ghi vào backup_runs ở caller.
   ========================================================== */
import { spawn } from "node:child_process";
import { readdir, stat, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { and, eq } from "drizzle-orm";
import { backupConfig, uploadSyncState } from "@erp-framework/db";
import { db } from "./db";
import { decryptSecret } from "./crypto";
import {
  getAccessToken, getFolder, ensureFolder,
  uploadNewFile, updateFileContent,
} from "./backup-gdrive";

const UPLOAD_DIR = process.env.UPLOAD_DIR ?? "/data/uploads";

export interface BackupResult {
  dbDriveFileId: string;
  dbBytes: number;
  uploadsSynced: number;
  uploadsSkipped: number;
  uploadsBytes: number;
}

/** Chạy pg_dump → Buffer. Yêu cầu binary `pg_dump` trong PATH. */
function pgDumpBuffer(databaseUrl: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    // -Fc: custom format (nén sẵn). Đọc kết nối từ URL — pg_dump hỗ trợ
    // postgres://… ở vị trí argument đầu.
    const child = spawn("pg_dump", ["-Fc", "--no-owner", "--no-acl", databaseUrl], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    const chunks: Buffer[] = [];
    const errs: Buffer[] = [];
    child.stdout.on("data", (c) => chunks.push(c));
    child.stderr.on("data", (c) => errs.push(c));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        return reject(new Error(
          `pg_dump exit ${code}: ${Buffer.concat(errs).toString("utf8")}`,
        ));
      }
      resolve(Buffer.concat(chunks));
    });
  });
}

/** Walk thư mục đệ quy → mảng đường dẫn file (tuyệt đối). */
async function walkFiles(dir: string): Promise<string[]> {
  let entries: import("node:fs").Dirent[];
  try { entries = await readdir(dir, { withFileTypes: true }); }
  catch { return []; }
  const out: string[] = [];
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walkFiles(p)));
    else if (e.isFile()) out.push(p);
  }
  return out;
}

/** Sync /data/uploads/<companyId>/ vào subfolder Drive. */
async function syncUploads(
  token: string, uploadsFolderId: string, companyId: string,
): Promise<{ synced: number; skipped: number; bytes: number }> {
  const local = join(UPLOAD_DIR, companyId);
  const files = await walkFiles(local);
  let synced = 0, skipped = 0, bytes = 0;

  for (const abs of files) {
    const rel = relative(local, abs).replace(/\\/g, "/");
    const st = await stat(abs);
    const size = st.size;
    const mtime = st.mtime;
    // Tra cache state — đã sync và size/mtime khớp → bỏ qua.
    const [existing] = await db.select().from(uploadSyncState).where(and(
      eq(uploadSyncState.companyId, companyId),
      eq(uploadSyncState.relPath, rel),
    ));
    if (existing
      && existing.size === size
      && existing.mtime.getTime() === mtime.getTime()) {
      skipped++;
      continue;
    }
    const content = await readFile(abs);
    if (existing) {
      // File đổi → ghi đè content giữ nguyên fileId.
      await updateFileContent(token, existing.driveFileId, content,
        "application/octet-stream");
      await db.update(uploadSyncState).set({
        size, mtime, syncedAt: new Date(),
      }).where(eq(uploadSyncState.id, existing.id));
    } else {
      // File mới — flat layout: tên = rel path encoded; Drive không có
      // thư mục lồng nhau ở đây để giữ đơn giản. Dùng "/" trong tên
      // (Drive chấp nhận) hoặc thay bằng "__".
      const name = rel.replace(/\//g, "__");
      const fileId = await uploadNewFile(token, uploadsFolderId, name,
        "application/octet-stream", content);
      await db.insert(uploadSyncState).values({
        companyId, relPath: rel, driveFileId: fileId, size, mtime,
      });
    }
    synced++;
    bytes += size;
  }
  return { synced, skipped, bytes };
}

/** Chạy backup đầy đủ cho company. Throw nếu cấu hình thiếu/lỗi. */
export async function runBackup(companyId: string): Promise<BackupResult> {
  const [cfg] = await db.select().from(backupConfig)
    .where(eq(backupConfig.companyId, companyId));
  if (!cfg) throw new Error("Chưa có cấu hình backup cho công ty này.");

  const keyJson = decryptSecret(cfg.gdriveKeyEnc);
  const token = await getAccessToken(keyJson);
  // Đảm bảo folder gốc tồn tại + có quyền.
  await getFolder(token, cfg.gdriveFolderId);
  // Tạo subfolder db/ và uploads/.
  const dbFolder = await ensureFolder(token, cfg.gdriveFolderId, "db");
  const upFolder = await ensureFolder(token, cfg.gdriveFolderId, "uploads");

  // pg_dump → upload mới (mỗi lần backup = 1 file mới timestamp).
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL chưa đặt.");
  const dump = await pgDumpBuffer(databaseUrl);
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const dbName = `erp-db-${ts}.dump`;
  const dbFileId = await uploadNewFile(token, dbFolder, dbName,
    "application/octet-stream", dump);

  // Sync uploads incremental.
  const up = await syncUploads(token, upFolder, companyId);

  return {
    dbDriveFileId: dbFileId, dbBytes: dump.length,
    uploadsSynced: up.synced, uploadsSkipped: up.skipped,
    uploadsBytes: up.bytes,
  };
}

/** Test cấu hình — gọi từ tRPC backup.config.test. */
export async function testBackupConfig(keyJson: string, folderId: string)
: Promise<{ ok: true; folderName: string }> {
  const token = await getAccessToken(keyJson);
  const f = await getFolder(token, folderId);
  return { ok: true, folderName: f.name };
}
