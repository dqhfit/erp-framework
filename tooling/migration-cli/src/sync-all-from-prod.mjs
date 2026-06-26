/* sync-all-from-prod.mjs — Gộp 3 bước sync cấu hình prod→dev theo ĐÚNG thứ tự:
     1) sync-pages-from-prod        — pages + datasources (PROD WINS)
     2) sync-menu-structure-from-prod — node tuỳ chỉnh CUST-* + cờ active
     3) sync-menu-links-from-prod    — gán page_id cho node menu
   Thứ tự bắt buộc: pages TRƯỚC (để structure/links trỏ tới trang tồn tại local),
   structure TRƯỚC links (node CUST mới phải có thì mới gán page_id được).

   Mỗi bước là 1 process node riêng (tự mở/đóng kết nối). Lỗi 1 bước → dừng.
   Args truyền thẳng cho bước 1 (vd --no-deps để bỏ sync datasource).
   Chạy: node tooling/migration-cli/src/sync-all-from-prod.mjs [--no-deps]
*/
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const passArgs = process.argv.slice(2); // chỉ áp cho bước 1 (sync-pages)

/** [nhãn, file, args] */
const steps = [
  ["1/3 · Pages + DataSources", "sync-pages-from-prod.mjs", passArgs],
  ["2/3 · Cấu trúc menu (node CUST-* + cờ active)", "sync-menu-structure-from-prod.mjs", []],
  ["3/3 · Gán page_id cho menu", "sync-menu-links-from-prod.mjs", []],
];

for (const [label, file, args] of steps) {
  console.log(`\n========== ${label} ==========`);
  try {
    execFileSync(process.execPath, [join(here, file), ...args], { stdio: "inherit" });
  } catch (e) {
    console.error(`\n✗ Bước "${label}" lỗi → DỪNG (các bước trước đã ghi, an toàn chạy lại).`);
    console.error(`  ${e.message}`);
    process.exit(1);
  }
}

console.log(
  "\n✓✓ XONG cả 3 bước. Hard-refresh portal dev (Ctrl+Shift+R) để thấy menu đầy đủ như prod.",
);
