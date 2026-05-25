#!/usr/bin/env node
/* =============================================================
   check-journal.mjs — Kiểm tra tính hợp lệ của _journal.json.
   Chạy trong CI (pnpm check:journal) và local trước khi push.

   Các lỗi được phát hiện:
     - Duplicate idx (2 migration cùng số thứ tự)
     - Duplicate when (2 migration cùng timestamp → Drizzle skip im lặng)
     - idx không liên tục (0,1,2,... không được có khoảng trống)
     - when không tăng dần (migration mới phải có timestamp lớn hơn)
   ============================================================= */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const JOURNAL_PATH = resolve(ROOT, "packages/db/migrations/meta/_journal.json");

let journal;
try {
  journal = JSON.parse(readFileSync(JOURNAL_PATH, "utf-8"));
} catch (e) {
  console.error(`✗ Không đọc được ${JOURNAL_PATH}: ${e.message}`);
  process.exit(1);
}

const entries = journal.entries ?? [];
let errors = 0;

function fail(msg) {
  console.error(`✗ ${msg}`);
  errors++;
}

const idxMap = new Map();
const whenMap = new Map();

for (const entry of entries) {
  // Duplicate idx
  if (idxMap.has(entry.idx)) {
    fail(`Duplicate idx=${entry.idx}: "${entry.tag}" và "${idxMap.get(entry.idx)}"`);
  }
  idxMap.set(entry.idx, entry.tag);

  // Duplicate when
  if (whenMap.has(entry.when)) {
    fail(`Duplicate when=${entry.when}: "${entry.tag}" và "${whenMap.get(entry.when)}" — Drizzle sẽ skip migration mới im lặng!`);
  }
  whenMap.set(entry.when, entry.tag);
}

// Sắp xếp theo idx rồi kiểm tra liên tục + tăng dần
const sorted = [...entries].sort((a, b) => a.idx - b.idx);
for (let i = 0; i < sorted.length; i++) {
  if (sorted[i].idx !== i) {
    fail(`idx không liên tục tại vị trí ${i}: expect ${i}, got ${sorted[i].idx} ("${sorted[i].tag}")`);
  }
  if (i > 0 && sorted[i].when <= sorted[i - 1].when) {
    fail(
      `when không tăng dần: entry[${i - 1}].when=${sorted[i - 1].when} ("${sorted[i - 1].tag}") >= entry[${i}].when=${sorted[i].when} ("${sorted[i].tag}")`,
    );
  }
}

if (errors > 0) {
  console.error(`\n✗ _journal.json có ${errors} lỗi — sửa trước khi merge.`);
  console.error(`  Xem CONTRIBUTING.md#migration để biết cách tạo migration đúng.`);
  process.exit(1);
}

console.log(`✓ _journal.json hợp lệ — ${entries.length} migration, không có duplicate.`);
