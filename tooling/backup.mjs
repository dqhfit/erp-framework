#!/usr/bin/env node
/* ==========================================================
   backup.mjs — Sao lưu đầy đủ ERP Framework bằng 1 lệnh.
   Đóng gói: pg_dump custom-format (toàn DB, gồm KB chunks) +
   thư mục /data/uploads (qua tar stream — không phụ thuộc tên
   container). Upload tar.gz lên Google Drive bằng service
   account JWT RS256.

   Env:
     GDRIVE_SERVICE_ACCOUNT_KEY_FILE   (bắt buộc — JSON key)
     GDRIVE_FOLDER_ID                  (bắt buộc — thư mục đích)
     BACKUP_COMPOSE_FILE               (mặc định docker/docker-compose.yml)
     BACKUP_DB_SERVICE                 (mặc định db)
     BACKUP_SERVER_SERVICE             (mặc định server)
     BACKUP_LOCAL_ONLY=1               (bỏ qua upload — chỉ tạo tarball)

   Output: ./backups/erp-backup-<ISO>.tar.gz
   ========================================================== */
import { execSync } from "node:child_process";
import { mkdirSync, rmSync, readFileSync, statSync } from "node:fs";
import { resolve, join } from "node:path";
import crypto from "node:crypto";

const COMPOSE_ABS = resolve(
  process.cwd(),
  process.env.BACKUP_COMPOSE_FILE ?? "docker/docker-compose.yml",
);
const DB_SVC = process.env.BACKUP_DB_SERVICE ?? "db";
const SRV_SVC = process.env.BACKUP_SERVER_SERVICE ?? "server";
const KEY_FILE = process.env.GDRIVE_SERVICE_ACCOUNT_KEY_FILE;
const FOLDER_ID = process.env.GDRIVE_FOLDER_ID;
const LOCAL_ONLY = !!process.env.BACKUP_LOCAL_ONLY;

const ts = new Date().toISOString().replace(/[:.]/g, "-");
const root = resolve(process.cwd(), "backups");
const workName = `erp-backup-${ts}`;
const tarName = `erp-backup-${ts}.tar.gz`;
const work = join(root, workName);
const tarPath = join(root, tarName);

// GNU tar trên Windows (qua MSYS/git-bash) coi "D:\\..." là host:path
// remote-shell → vỡ. Đẩy CWD vào ./backups/ + dùng path TƯƠNG ĐỐI cho
// tar — không còn drive letter trong tham số → an toàn cả Windows lẫn
// Linux. docker compose -f phải dùng absolute vì chdir đi nơi khác.
const DC = `docker compose -f "${COMPOSE_ABS}"`;

function sh(cmd) { execSync(cmd, { stdio: "inherit", shell: true }); }

function b64u(buf) {
  return Buffer.from(buf).toString("base64")
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function dumpDb() {
  console.log("• pg_dump → db.dump");
  // CWD đang ở ./backups → output là "<workName>/db.dump" (relative).
  sh(`${DC} exec -T ${DB_SVC} pg_dump -U erp -d erp_framework -Fc > "${workName}/db.dump"`);
}

async function copyUploads() {
  console.log("• tar stream /data/uploads");
  try {
    // Cả 2 tar đều thấy path tương đối (cwd = ./backups).
    sh(`${DC} exec -T ${SRV_SVC} tar cf - -C /data uploads | tar xf - -C "${workName}"`);
  } catch {
    mkdirSync(join(work, "uploads"), { recursive: true });
    console.log("  (server không có /data/uploads — đóng gói thư mục trống)");
  }
}

async function makeTar() {
  console.log("• tar czf");
  sh(`tar czf "${tarName}" "${workName}"`);
  const size = statSync(tarPath).size;
  console.log(`  → ${tarPath} (${(size / 1024 / 1024).toFixed(1)} MB)`);
}

async function getAccessToken() {
  const key = JSON.parse(readFileSync(KEY_FILE, "utf8"));
  const now = Math.floor(Date.now() / 1000);
  const header = b64u(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64u(JSON.stringify({
    iss: key.client_email,
    scope: "https://www.googleapis.com/auth/drive.file",
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now,
  }));
  const sig = b64u(crypto.createSign("RSA-SHA256")
    .update(`${header}.${claim}`).sign(key.private_key));
  const assertion = `${header}.${claim}.${sig}`;
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  if (!r.ok) throw new Error(`auth ${r.status}: ${await r.text()}`);
  const j = await r.json();
  return j.access_token;
}

async function uploadToDrive(token) {
  const meta = { name: `erp-backup-${ts}.tar.gz`, parents: [FOLDER_ID] };
  const boundary = `erp${Date.now()}`;
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\n` +
      `content-type: application/json; charset=UTF-8\r\n\r\n` +
      `${JSON.stringify(meta)}\r\n` +
      `--${boundary}\r\n` +
      `content-type: application/gzip\r\n\r\n`,
    ),
    readFileSync(tarPath),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const r = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink",
    {
      method: "POST",
      headers: {
        "authorization": `Bearer ${token}`,
        "content-type": `multipart/related; boundary=${boundary}`,
        "content-length": String(body.length),
      },
      body,
    },
  );
  if (!r.ok) throw new Error(`upload ${r.status}: ${await r.text()}`);
  return r.json();
}

async function main() {
  if (!LOCAL_ONLY) {
    if (!KEY_FILE) {
      throw new Error("GDRIVE_SERVICE_ACCOUNT_KEY_FILE chưa đặt — hoặc bật BACKUP_LOCAL_ONLY=1.");
    }
    if (!FOLDER_ID) throw new Error("GDRIVE_FOLDER_ID chưa đặt.");
  }
  mkdirSync(work, { recursive: true });
  // chdir vào ./backups/ — mọi tar/pipe sau đây dùng path tương đối.
  process.chdir(root);
  await dumpDb();
  await copyUploads();
  await makeTar();

  if (LOCAL_ONLY) {
    console.log(`✓ Backup local: ${tarPath}`);
  } else {
    console.log("• Xin access token Google…");
    const token = await getAccessToken();
    console.log("• Upload Drive…");
    const res = await uploadToDrive(token);
    console.log(`✓ Đã upload — fileId ${res.id}`);
    if (res.webViewLink) console.log(`  ${res.webViewLink}`);
  }
  rmSync(work, { recursive: true, force: true });
}

main().catch((e) => {
  console.error("backup lỗi:", e.message);
  try { rmSync(work, { recursive: true, force: true }); } catch { /* ignore */ }
  process.exit(1);
});
