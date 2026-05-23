#!/usr/bin/env node
/* ==========================================================
   restore.mjs — Khôi phục tarball do tooling/backup.mjs tạo.
   Dùng: `pnpm restore ./backups/erp-backup-<ISO>.tar.gz`
   Yêu cầu Docker stack đang chạy (db + server service).

   Hành vi:
   - Giải nén tarball vào ./backups/restore-<ISO>/.
   - pg_restore -c (drop + recreate object) trên DB chính.
   - tar stream uploads/ vào /data/uploads của server.

   Env:
     RESTORE_COMPOSE_FILE       (mặc định docker/docker-compose.yml)
     RESTORE_DB_SERVICE         (mặc định db)
     RESTORE_SERVER_SERVICE     (mặc định server)
     RESTORE_YES=1              (bỏ qua confirm — dùng trong script)
   ========================================================== */
import { execSync } from "node:child_process";
import { mkdirSync, rmSync, statSync, existsSync, readdirSync } from "node:fs";
import { resolve, join, basename } from "node:path";
import readline from "node:readline";

const COMPOSE_ABS = resolve(
  process.cwd(),
  process.env.RESTORE_COMPOSE_FILE ?? "docker/docker-compose.yml",
);
const DB_SVC = process.env.RESTORE_DB_SERVICE ?? "db";
const SRV_SVC = process.env.RESTORE_SERVER_SERVICE ?? "server";
const YES = !!process.env.RESTORE_YES;

const tarball = process.argv[2];
if (!tarball) {
  console.error("Dùng: pnpm restore <path-to-tarball>");
  process.exit(1);
}
const tarAbs = resolve(tarball);
if (!existsSync(tarAbs)) {
  console.error(`Không tìm thấy file: ${tarAbs}`);
  process.exit(1);
}

const ts = new Date().toISOString().replace(/[:.]/g, "-");
const backupsDir = resolve(process.cwd(), "backups");
const workName = `restore-${ts}`;
const work = join(backupsDir, workName);
const DC = `docker compose -f "${COMPOSE_ABS}"`;

function sh(cmd) { execSync(cmd, { stdio: "inherit", shell: true }); }

async function confirm() {
  if (YES) return;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise((r) => rl.question(
    `⚠ Khôi phục từ ${basename(tarAbs)} sẽ GHI ĐÈ DB hiện tại và /data/uploads.\n` +
    `   Tiếp tục? (gõ "yes" để xác nhận): `, (a) => { rl.close(); r(a.trim()); },
  ));
  if (answer !== "yes") {
    console.log("Đã huỷ.");
    process.exit(0);
  }
}

async function main() {
  await confirm();

  console.log(`• Giải nén ${basename(tarAbs)} → ${work}`);
  mkdirSync(work, { recursive: true });
  // chdir vào ./backups/ + relative paths cho tar (Windows GNU tar không
  // chịu "D:\..."). Copy tarball vào để tar xử lý nó bằng tên thuần.
  process.chdir(backupsDir);
  sh(`tar xzf "${tarAbs.replace(/\\/g, "/")}" -C "${workName}"`);

  // Tarball có dạng erp-backup-<ISO>/ ở root → vào trong.
  const inner = readdirSync(work)
    .filter((n) => statSync(join(work, n)).isDirectory())[0];
  const innerRel = inner ? `${workName}/${inner}` : workName;

  console.log("• pg_restore (drop + recreate)…");
  sh(`${DC} exec -T ${DB_SVC} pg_restore -U erp -d erp_framework -c --if-exists --no-owner --no-acl < "${innerRel}/db.dump" || true`);

  if (existsSync(join(backupsDir, innerRel, "uploads"))) {
    console.log("• tar stream uploads → server…");
    sh(`${DC} exec -T ${SRV_SVC} sh -c "rm -rf /data/uploads && mkdir -p /data"`);
    sh(`tar cf - -C "${innerRel}" uploads | ${DC} exec -T ${SRV_SVC} tar xf - -C /data`);
  }

  console.log("✓ Khôi phục xong.");
  console.log(`  Khuyến nghị restart server: ${DC} restart ${SRV_SVC}`);
  rmSync(work, { recursive: true, force: true });
}

main().catch((e) => {
  console.error("restore lỗi:", e.message);
  try { rmSync(work, { recursive: true, force: true }); } catch { /* ignore */ }
  process.exit(1);
});
