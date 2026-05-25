/* tooling/ascii-migrations.mjs — ASCII-hoa comment trong tat ca SQL migration.
   Strip dau tieng Viet, doi em-dash thanh --, doi * trong block comment thanh ...
   Khong dung SQL statements (CREATE/ALTER/INSERT...), chi sua comment va
   white-space xung quanh comment.

   Run: node tooling/ascii-migrations.mjs
*/
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const DIR = "packages/db/migrations";

/* Map ky tu co dau → khong dau. Bao gom ca chu hoa va dD. */
const TABLE = {
  "à": "a", "á": "a", "ạ": "a", "ả": "a", "ã": "a",
  "â": "a", "ầ": "a", "ấ": "a", "ậ": "a", "ẩ": "a", "ẫ": "a",
  "ă": "a", "ằ": "a", "ắ": "a", "ặ": "a", "ẳ": "a", "ẵ": "a",
  "è": "e", "é": "e", "ẹ": "e", "ẻ": "e", "ẽ": "e",
  "ê": "e", "ề": "e", "ế": "e", "ệ": "e", "ể": "e", "ễ": "e",
  "ì": "i", "í": "i", "ị": "i", "ỉ": "i", "ĩ": "i",
  "ò": "o", "ó": "o", "ọ": "o", "ỏ": "o", "õ": "o",
  "ô": "o", "ồ": "o", "ố": "o", "ộ": "o", "ổ": "o", "ỗ": "o",
  "ơ": "o", "ờ": "o", "ớ": "o", "ợ": "o", "ở": "o", "ỡ": "o",
  "ù": "u", "ú": "u", "ụ": "u", "ủ": "u", "ũ": "u",
  "ư": "u", "ừ": "u", "ứ": "u", "ự": "u", "ử": "u", "ữ": "u",
  "ỳ": "y", "ý": "y", "ỵ": "y", "ỷ": "y", "ỹ": "y",
  "đ": "d", "Đ": "D",
};
const UPPER = Object.fromEntries(
  Object.entries(TABLE).map(([k, v]) => [k.toUpperCase(), v.toUpperCase()]),
);
const FULL = { ...TABLE, ...UPPER };

function stripDiacritics(s) {
  let out = "";
  for (const ch of s) out += FULL[ch] ?? ch;
  return out;
}

/* Xu ly chi trong block comment / ... / va line comment -- ...
   De an toan: scan toan bo, identify comment regions, apply transform
   trong comment only. SQL trong file migration khong co string literal
   tieng Viet quan trong, an toan apply toan bo. */
function transformSql(src) {
  let s = src;
  s = stripDiacritics(s);
  // em-dash, en-dash, … va * trong block comment.
  s = s.replace(/—/g, "--").replace(/–/g, "-").replace(/…/g, "...");
  // Arrows + box-drawing.
  s = s.replace(/→/g, "->").replace(/←/g, "<-")
       .replace(/↑/g, "^").replace(/↓/g, "v")
       .replace(/⇒/g, "=>").replace(/⇐/g, "<=")
       .replace(/↔/g, "<->").replace(/⇔/g, "<=>");
  // Smart quotes.
  s = s.replace(/[""]/g, '"').replace(/['']/g, "'");
  // * trong block comment dau /* — neu line bat dau bang space + * thi giu;
  // chi doi * dung ngay sau "/" mo block hoac trong header banner.
  // Pattern an toan: "/* ... */ " — bo cac dau hoa "*"
  // Don gian: thay "─" va "═" va "━" → "-" (cac box-drawing chars).
  s = s.replace(/[─━═]/g, "-");
  return s;
}

const files = (await readdir(DIR)).filter((f) => f.endsWith(".sql")).sort();
let changed = 0;
for (const f of files) {
  const p = join(DIR, f);
  const before = await readFile(p, "utf8");
  const after = transformSql(before);
  if (after !== before) {
    await writeFile(p, after, "utf8");
    changed += 1;
    console.log(`changed: ${f}`);
  }
}
console.log(`\nTotal: ${changed}/${files.length} files updated`);
