#!/usr/bin/env node
/**
 * audit-pages.mjs — P0: Kiểm kê route code + page config, phát hiện xung đột slug.
 *
 * Chạy từ gốc repo:
 *   node tooling/page-routes/audit-pages.mjs
 *
 * Output (đặt vào migration-plan/ui/):
 *   route-inventory.json   — toàn bộ route code + page config với suggestedSlug
 *   route-conflicts.md     — báo cáo trùng slug, soft-delete, orphan
 *
 * Không cần DB, không thêm dependency mới — chỉ đọc file JSON + .tsx từ đĩa.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ─── Đường dẫn gốc ──────────────────────────────────────────────────────────
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");

const ROUTES_DIR = path.join(ROOT, "src", "routes");
const PAGES_DIR = path.join(ROOT, "migration-plan", "ui", "pages");
const PAGES_MENU_DIR = path.join(ROOT, "migration-plan", "ui", "pages-menu");
const OLD_PAGES_FILE = path.join(ROOT, "migration-plan", "ui", "old-pages-to-delete.json");
const OUTPUT_DIR = path.join(ROOT, "migration-plan", "ui");

// ─── Helper: bỏ dấu tiếng Việt → kebab-case ────────────────────────────────
/**
 * Chuẩn hoá chuỗi tiếng Việt: bỏ dấu, đ→d, lowercase, slug hóa.
 * Viết inline để không phụ thuộc import từ src/ frontend.
 */
function toSlug(str) {
  if (!str || typeof str !== "string") return "";
  return (
    str
      // đ/Đ không decompose theo NFD → xử lý trước
      .replace(/[đĐ]/g, (c) => (c === "đ" ? "d" : "D"))
      .toLowerCase()
      .normalize("NFD")
      // Bỏ combining diacritical marks (U+0300–U+036F)
      .replace(/[̀-ͯ]/g, "")
      // Chỉ giữ a-z, 0-9, khoảng trắng
      .replace(/[^a-z0-9\s-]/g, " ")
      .trim()
      // Khoảng trắng/gạch ngang nhiều → một gạch ngang
      .replace(/[\s-]+/g, "-")
  );
}

/**
 * Từ tên kỹ thuật (dq_san_pham_sanpham) → slug sạch (san-pham-sanpham).
 * Bỏ prefix dq_, tr_, frm_, mes_, etc.
 */
function slugFromName(name) {
  return toSlug(
    name
      .replace(/^(dq_|tr_|frm_|mes_|dbo_)/, "") // bỏ prefix kỹ thuật
      .replace(/_/g, " "),
  );
}

/**
 * Chọn slug tốt nhất: dùng label nếu trông như tên Việt thật,
 * nếu không dùng name đã bỏ prefix.
 */
function bestSlug(name, label) {
  // Label bắt đầu bằng prefix kỹ thuật → fallback sang name
  if (!label || /^(frm_|dq_|tr_|mes_|dbo_)/i.test(label)) {
    return slugFromName(name);
  }
  const s = toSlug(label);
  // Slug từ label quá ngắn (<3 ký tự) → fallback sang name
  return s.length >= 3 ? s : slugFromName(name);
}

// ─── 1. Thu thập route code (TanStack file-based routes) ────────────────────
/**
 * Ánh xạ tên file TanStack → URL path.
 *
 * Quy tắc:
 *  - __root.tsx       → bỏ qua (root layout, không có path)
 *  - index.tsx        → /
 *  - foo.tsx          → /foo
 *  - foo.bar.tsx      → /foo/bar  (dấu chấm = phân cấp)
 *  - foo.index.tsx    → /foo/
 *  - foo.$id.tsx      → /foo/:id  ($param = dynamic)
 *  - _layout.tsx      → bỏ qua (pathless layout)
 */
function fileToRoute(filename) {
  // Bỏ đuôi .tsx/.ts
  let base = filename.replace(/\.(tsx|ts)$/, "");

  // Bỏ qua root layout và pathless layout (_xxx)
  if (base === "__root" || base.startsWith("_")) return null;

  // index.tsx → /
  if (base === "index") return "/";

  // Chuyển dấu chấm thành /
  let routePath = "/" + base.replace(/\./g, "/");

  // $param → :param (dynamic)
  routePath = routePath.replace(/\$([^/]+)/g, ":$1");

  // foo/index → foo/ (trailing slash)
  routePath = routePath.replace(/\/index$/, "/");

  return routePath;
}

function collectRoutes() {
  const routes = [];
  if (!fs.existsSync(ROUTES_DIR)) {
    console.warn(`[WARN] Thư mục routes không tồn tại: ${ROUTES_DIR}`);
    return routes;
  }

  const files = fs.readdirSync(ROUTES_DIR).filter((f) => /\.(tsx|ts)$/.test(f));
  for (const file of files.sort()) {
    const routePath = fileToRoute(file);
    if (!routePath) continue;

    // Suy loại: trang tĩnh hay dynamic
    const isDynamic = routePath.includes(":");
    const isSettings = routePath.startsWith("/settings");
    const isMes = routePath.startsWith("/mes");
    const isKetoan = routePath.startsWith("/ketoan");

    let group = "app";
    if (isSettings) group = "settings";
    else if (isMes) group = "mes";
    else if (isKetoan) group = "ketoan";

    routes.push({
      kind: "route-code",
      file,
      path: routePath,
      isDynamic,
      group,
    });
  }
  return routes;
}

// ─── 2. Đọc danh sách page cần xoá ─────────────────────────────────────────
function loadOldPagesToDelete() {
  if (!fs.existsSync(OLD_PAGES_FILE)) return new Set();
  try {
    const list = JSON.parse(fs.readFileSync(OLD_PAGES_FILE, "utf-8"));
    return new Set(Array.isArray(list) ? list : []);
  } catch {
    return new Set();
  }
}

// ─── 3. Thu thập page JSON ──────────────────────────────────────────────────
/**
 * Đọc toàn bộ file JSON dưới thư mục dir (2 cấp).
 * Trả về mảng page object với thêm trường module, source, filePath.
 */
function collectPagesFromDir(dir, sourceLabel) {
  const pages = [];
  if (!fs.existsSync(dir)) return pages;

  // Lấy sub-folder = module/group
  const modules = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);

  for (const mod of modules) {
    const modDir = path.join(dir, mod);
    const files = fs
      .readdirSync(modDir)
      .filter((f) => f.endsWith(".json"))
      .sort();

    for (const file of files) {
      const filePath = path.join(modDir, file);
      let data;
      try {
        data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      } catch (e) {
        console.warn(`[WARN] Không parse được ${filePath}: ${e.message}`);
        continue;
      }

      const name = data.name || file.replace(".json", "");
      const label = data.label || "";

      // Phát hiện page "phiên bản" (ver2/ver3/add2/add3 suffix → candidate hợp nhất)
      const versionSuffix = /_(ver\d+|add\d+|add\b|test\b|view\d+|copy\b|htr\b|mau\b)$/.test(name);

      pages.push({
        kind: "page-config",
        source: sourceLabel,
        module: mod,
        name,
        label,
        pageId: data.id ?? null, // Hiện tại các file chưa có id field
        suggestedSlug: bestSlug(name, label),
        versionSuffix, // trang có vẻ là phiên bản cũ/thử nghiệm
        filePath: filePath.replace(ROOT + path.sep, "").replace(/\\/g, "/"),
      });
    }
  }
  return pages;
}

function collectPages(plannedDeleteSet) {
  const fromPages = collectPagesFromDir(PAGES_DIR, "pages");
  const fromMenu = collectPagesFromDir(PAGES_MENU_DIR, "pages-menu");

  // Đánh dấu planned-delete (từ old-pages-to-delete.json)
  const allPages = [...fromPages, ...fromMenu].map((p) => ({
    ...p,
    plannedDelete: plannedDeleteSet.has(p.name),
  }));

  return allPages;
}

// ─── 4. Phát hiện xung đột ──────────────────────────────────────────────────
function detectConflicts(routes, pages) {
  const conflicts = {
    duplicateSlug: [],
    plannedDelete: [],
    portalOnlyPages: [],
    versionVariants: [],
    routeVsPageSlug: [],
  };

  // 4a. Slug trùng giữa các page config (cả pages/ + pages-menu/)
  const slugMap = new Map(); // slug → [page]
  for (const p of pages) {
    const s = p.suggestedSlug;
    if (!slugMap.has(s)) slugMap.set(s, []);
    slugMap.get(s).push(p);
  }
  for (const [slug, list] of slugMap) {
    if (list.length > 1) {
      // Phân loại: cùng nguồn hay khác nguồn?
      const sources = [...new Set(list.map((p) => p.source))];
      const crossSource = sources.length > 1;
      conflicts.duplicateSlug.push({
        slug,
        pages: list.map((p) => p.name),
        crossSource, // true = pages/ vs pages-menu/ → quan trọng hơn
      });
    }
  }

  // 4b. Trang planned-delete (từ old-pages-to-delete.json)
  // Chỉ ghi nhận trang trong pages/ (pages-menu không có trong list này)
  for (const p of pages) {
    if (p.plannedDelete && p.source === "pages") {
      conflicts.plannedDelete.push({ name: p.name, module: p.module });
    }
  }

  // 4c. Portal-only pages: pages-menu/ không có counterpart trong pages/
  // Đây là trang portal (P01-P14, G1020) chưa được map sang ERP module
  const erpPageNames = new Set(pages.filter((p) => p.source === "pages").map((p) => p.name));
  for (const p of pages.filter((x) => x.source === "pages-menu")) {
    // Tên portal thường là dq_P01_xxx; ERP là dq_<module>_xxx — đây luôn khác nhau
    // Phát hiện: có trang ERP có label giống không? (gợi ý hợp nhất)
    const dupInErp = pages.find(
      (x) => x.source === "pages" && x.suggestedSlug === p.suggestedSlug,
    );
    conflicts.portalOnlyPages.push({
      name: p.name,
      label: p.label,
      group: p.module,
      suggestedSlug: p.suggestedSlug,
      hasErpCounterpart: !!dupInErp,
      erpCounterpart: dupInErp?.name ?? null,
    });
  }

  // 4d. Trang "phiên bản" trong pages/ (ver2/ver3/add2/test/copy)
  const versionPages = pages.filter((p) => p.source === "pages" && p.versionSuffix);
  for (const vp of versionPages) {
    // Tìm trang "gốc" có cùng slug
    const sameSlugs = pages.filter(
      (p) => p.suggestedSlug === vp.suggestedSlug && p.name !== vp.name,
    );
    conflicts.versionVariants.push({
      name: vp.name,
      label: vp.label,
      module: vp.module,
      suggestedSlug: vp.suggestedSlug,
      siblings: sameSlugs.map((p) => p.name),
    });
  }

  // 4e. Slug đụng route code (kiểm tra /p/<slug> và /<slug> đụng route hiện có)
  const routePaths = new Set(routes.map((r) => r.path));
  for (const p of pages) {
    // Chỉ kiểm tra trang ERP (pages/), pages-menu sẽ có path riêng
    if (p.source !== "pages") continue;
    // Các đường dẫn cần kiểm tra
    const directPath = `/${p.suggestedSlug}`;
    if (routePaths.has(directPath)) {
      conflicts.routeVsPageSlug.push({
        pageName: p.name,
        suggestedSlug: p.suggestedSlug,
        conflictsWithRoute: directPath,
        note: "Nếu tạo route /<slug> trực tiếp sẽ đụng route code",
      });
    }
  }

  return conflicts;
}

// ─── 5. Sinh báo cáo Markdown ───────────────────────────────────────────────
function buildMarkdown(routes, pages, conflicts) {
  const lines = [];
  const now = new Date().toISOString();

  const nPages = pages.filter((p) => p.source === "pages").length;
  const nMenu = pages.filter((p) => p.source === "pages-menu").length;
  const crossSourceDup = conflicts.duplicateSlug.filter((d) => d.crossSource).length;
  const sameSourceDup = conflicts.duplicateSlug.length - crossSourceDup;

  lines.push(`# Route Conflicts Report`);
  lines.push(`> Sinh tự động bởi \`tooling/page-routes/audit-pages.mjs\``);
  lines.push(`> Ngày: ${now}`);
  lines.push("");

  // Tóm tắt
  lines.push("## Tóm tắt");
  lines.push("");
  lines.push(`| Mục | Số lượng | Ghi chú |`);
  lines.push(`|-----|---------|---------|`);
  lines.push(`| Route code (\`src/routes\`) | ${routes.length} | App routes cứng |`);
  lines.push(`| Page config ERP (\`pages/\`) | ${nPages} | Trang ERP theo domain module |`);
  lines.push(`| Page config Portal (\`pages-menu/\`) | ${nMenu} | Trang portal theo nhóm menu (P01-P14, G1020) |`);
  lines.push(`| Trùng slug (cross-source: ERP + Portal) | ${crossSourceDup} | **Ưu tiên giải quyết P1** |`);
  lines.push(`| Trùng slug (same-source) | ${sameSourceDup} | Trang ver/add variant cùng bộ |`);
  lines.push(
    `| Planned-delete (old-pages-to-delete.json) | ${conflicts.plannedDelete.length} | Trang cũ cần xoá trên prod |`,
  );
  lines.push(
    `| Trang phiên bản (ver2/add2/test/copy) | ${conflicts.versionVariants.length} | Candidate hợp nhất |`,
  );
  lines.push(`| Slug đụng route code | ${conflicts.routeVsPageSlug.length} | Kiểm tra trước P2 |`);
  lines.push("");

  // === Mục 1: Trùng slug ===
  lines.push("## 1. Trùng slug — Cross-source (ERP ↔ Portal)");
  lines.push("");
  lines.push(
    "> Slug từ `pages/` và `pages-menu/` trùng nhau → nếu thêm route `/p/$slug` sẽ cần phân biệt.",
  );
  lines.push("");
  const crossDups = conflicts.duplicateSlug.filter((d) => d.crossSource);
  if (crossDups.length === 0) {
    lines.push("_Không có trùng slug cross-source._");
  } else {
    for (const { slug, pages: names } of crossDups) {
      lines.push(`### \`${slug}\``);
      for (const n of names) {
        const pg = pages.find((p) => p.name === n);
        lines.push(
          `- \`${n}\` — "${pg?.label || ""}" — source: **${pg?.source || ""}** / module: \`${pg?.module || ""}\``,
        );
      }
      lines.push("");
    }
  }

  lines.push("## 2. Trùng slug — Same-source (phiên bản / variant)");
  lines.push("");
  lines.push(
    "> Nhiều trang trong cùng bộ (pages/ hoặc pages-menu/) có label giống nhau → trùng slug. Xem xét hợp nhất hoặc đặt tên phân biệt.",
  );
  lines.push("");
  const sameDups = conflicts.duplicateSlug.filter((d) => !d.crossSource);
  if (sameDups.length === 0) {
    lines.push("_Không có trùng slug same-source._");
  } else {
    for (const { slug, pages: names } of sameDups) {
      lines.push(`### \`${slug}\``);
      for (const n of names) {
        const pg = pages.find((p) => p.name === n);
        lines.push(
          `- \`${n}\` — "${pg?.label || ""}" — module: \`${pg?.module || ""}\``,
        );
      }
      lines.push("");
    }
  }

  // === Mục 3: Trang phiên bản ===
  lines.push("## 3. Trang phiên bản cần hợp nhất (ver2/add2/test/copy)");
  lines.push("");
  lines.push(
    "> Tên page có suffix kỹ thuật gợi ý đây là trang thử nghiệm hoặc phiên bản cũ. Nên hợp nhất vào trang chính hoặc xoá.",
  );
  lines.push("");
  if (conflicts.versionVariants.length === 0) {
    lines.push("_Không có trang phiên bản._");
  } else {
    // Nhóm theo module
    const byModule = new Map();
    for (const v of conflicts.versionVariants) {
      if (!byModule.has(v.module)) byModule.set(v.module, []);
      byModule.get(v.module).push(v);
    }
    for (const [mod, items] of [...byModule.entries()].sort()) {
      lines.push(`### Module \`${mod}\` (${items.length})`);
      for (const v of items) {
        const sibs = v.siblings.length > 0 ? ` ← cùng slug với: ${v.siblings.join(", ")}` : "";
        lines.push(`- \`${v.name}\` — "${v.label}"${sibs}`);
      }
      lines.push("");
    }
  }

  // === Mục 4: Planned-delete ===
  lines.push("## 4. Trang planned-delete (old-pages-to-delete.json)");
  lines.push("");
  lines.push(
    "> Các trang này được đánh dấu xoá trong kế hoạch migration. Kiểm tra `deleted_at IS NULL` trên prod DB trước khi xoá thật.",
  );
  lines.push("> **Lưu ý**: Trang có JSON trong `pages/` có thể đã được thay bằng phiên bản mới — planned-delete chỉ là marker kế hoạch, không phải `deleted_at` DB.");
  lines.push("");
  if (conflicts.plannedDelete.length === 0) {
    lines.push("_Không có trang planned-delete._");
  } else {
    // Nhóm theo module
    const byModule = new Map();
    for (const { name, module: mod } of conflicts.plannedDelete) {
      if (!byModule.has(mod)) byModule.set(mod, []);
      byModule.get(mod).push(name);
    }
    for (const [mod, names] of [...byModule.entries()].sort()) {
      lines.push(`### Module \`${mod}\` (${names.length})`);
      for (const n of names) lines.push(`- \`${n}\``);
      lines.push("");
    }
  }

  // === Mục 5: Slug đụng route code ===
  lines.push("## 5. Slug đụng route code hiện có");
  lines.push("");
  if (conflicts.routeVsPageSlug.length === 0) {
    lines.push("_Không có slug đụng route code._");
    lines.push("");
    lines.push(
      "> An toàn để tạo `/p/$slug` cho mọi trang ERP mà không đụng route hiện tại.",
    );
  } else {
    lines.push(`| Page name | Slug | Route bị đụng | Ghi chú |`);
    lines.push(`|-----------|------|---------------|---------|`);
    for (const c of conflicts.routeVsPageSlug) {
      lines.push(
        `| \`${c.pageName}\` | \`${c.suggestedSlug}\` | \`${c.conflictsWithRoute}\` | ${c.note} |`,
      );
    }
  }
  lines.push("");

  // === Mục 6: Route code inventory ===
  lines.push("## 6. Route code inventory (src/routes)");
  lines.push("");
  lines.push("> App routes cứng trong `src/routes/` — không phải page config.");
  lines.push("");
  lines.push(`| File | Path | Group | Dynamic? |`);
  lines.push(`|------|------|-------|---------|`);
  for (const r of routes) {
    lines.push(
      `| \`${r.file}\` | \`${r.path}\` | \`${r.group}\` | ${r.isDynamic ? "✓" : ""} |`,
    );
  }
  lines.push("");

  // === Mục 7: Portal pages ===
  lines.push("## 7. Portal pages (pages-menu/)");
  lines.push("");
  lines.push(
    "> 145 trang portal chia theo nhóm menu (P01-P14, G1020). Mỗi trang này có thể map sang 1 trang ERP cùng nội dung.",
  );
  lines.push("");
  const hasCounterpart = conflicts.portalOnlyPages.filter((p) => p.hasErpCounterpart);
  const noCounterpart = conflicts.portalOnlyPages.filter((p) => !p.hasErpCounterpart);
  lines.push(`- **${hasCounterpart.length}** trang portal có ERP counterpart (cùng slug) → candidate merge.`);
  lines.push(`- **${noCounterpart.length}** trang portal chưa có ERP counterpart (nội dung riêng biệt hoặc chưa port).`);
  lines.push("");
  if (hasCounterpart.length > 0) {
    lines.push("### Trang portal có ERP counterpart (cùng suggested slug)");
    lines.push("");
    lines.push(`| Portal page | ERP counterpart | Label | Group |`);
    lines.push(`|-------------|----------------|-------|-------|`);
    for (const p of hasCounterpart) {
      lines.push(
        `| \`${p.name}\` | \`${p.erpCounterpart}\` | "${p.label}" | \`${p.group}\` |`,
      );
    }
    lines.push("");
  }

  // === Mục 8: Follow-up ===
  lines.push("## 8. Follow-up cho P1+");
  lines.push("");
  lines.push(
    "- **P1 — Giải quyết trùng slug cross-source** (" +
      crossDups.length +
      " nhóm): chốt 1 trang canonical cho mỗi slug, map portal page → ERP page.",
  );
  lines.push(
    "- **P1 — Hợp nhất trang phiên bản** (" +
      conflicts.versionVariants.length +
      " trang): gộp ver2/add2 vào trang chính, thêm redirect.",
  );
  lines.push("- **P1**: Chốt slug cho module ưu tiên: `san_pham`, `don_hang`, `dinh_muc`, `san_xuat`, `kho_vat_tu`, `ke_toan`, `bao_gia`, `bang_mau_banve`.");
  lines.push("- **P2**: Thêm route `/p/$slug` vào TanStack Router.");
  lines.push("- **P3**: Menu dùng slug + giữ `page_id` làm fallback.");
  lines.push("- **P4**: Redirect legacy URL: `/banve` → `/ban-ve`, `/sanluong` → `/san-luong`.");
  lines.push("- **DB check**: Xác nhận `deleted_at IS NULL` trên prod cho planned-delete trước khi xoá.");
  lines.push("- **Giới hạn P0**: `pageId` (UUID prod) chưa có trong JSON file.");
  lines.push(
    "  Để lấy: `migration_query_readonly` trên MCP hoặc `SELECT id,name FROM pages WHERE deleted_at IS NULL`.",
  );
  lines.push("");

  return lines.join("\n");
}

// ─── Main ────────────────────────────────────────────────────────────────────
async function main() {
  console.log("audit-pages.mjs — P0: Kiểm kê route + page config");
  console.log("─".repeat(60));

  // 1. Route code
  console.log("1. Đọc route code từ src/routes/ ...");
  const routes = collectRoutes();
  console.log(`   → ${routes.length} route`);

  // 2. Danh sách page planned-delete
  console.log("2. Đọc danh sách old-pages-to-delete.json ...");
  const plannedDeleteSet = loadOldPagesToDelete();
  console.log(`   → ${plannedDeleteSet.size} trang đánh dấu planned-delete`);

  // 3. Page config
  console.log("3. Đọc page config từ migration-plan/ui/ ...");
  const pages = collectPages(plannedDeleteSet);
  const fromPages = pages.filter((p) => p.source === "pages").length;
  const fromMenu = pages.filter((p) => p.source === "pages-menu").length;
  console.log(
    `   → ${fromPages} page ERP (pages/) + ${fromMenu} page portal (pages-menu/) = ${pages.length} tổng`,
  );

  // 4. Phát hiện xung đột
  console.log("4. Phát hiện xung đột ...");
  const conflicts = detectConflicts(routes, pages);
  const crossSrc = conflicts.duplicateSlug.filter((d) => d.crossSource).length;
  const sameSrc = conflicts.duplicateSlug.length - crossSrc;
  console.log(`   → Trùng slug cross-source (ERP↔Portal): ${crossSrc} nhóm`);
  console.log(`   → Trùng slug same-source: ${sameSrc} nhóm`);
  console.log(`   → Planned-delete: ${conflicts.plannedDelete.length}`);
  console.log(`   → Trang phiên bản (ver/add/test): ${conflicts.versionVariants.length}`);
  console.log(`   → Slug đụng route code: ${conflicts.routeVsPageSlug.length}`);

  // 5. Sinh output
  console.log("5. Ghi output ...");

  // route-inventory.json
  const inventory = {
    generatedAt: new Date().toISOString(),
    summary: {
      routes: routes.length,
      pagesFromDir: fromPages,
      pagesFromMenu: fromMenu,
      totalPages: pages.length,
      duplicateSlugTotal: conflicts.duplicateSlug.length,
      duplicateSlugCrossSource: crossSrc,
      duplicateSlugSameSource: sameSrc,
      plannedDeleteCount: conflicts.plannedDelete.length,
      versionVariantCount: conflicts.versionVariants.length,
      routeVsPageSlugConflicts: conflicts.routeVsPageSlug.length,
    },
    routes,
    pages,
    conflicts,
  };

  const inventoryPath = path.join(OUTPUT_DIR, "route-inventory.json");
  fs.writeFileSync(inventoryPath, JSON.stringify(inventory, null, 2), "utf-8");
  console.log(`   → Đã ghi: ${inventoryPath.replace(ROOT + path.sep, "").replace(/\\/g, "/")}`);

  // route-conflicts.md
  const md = buildMarkdown(routes, pages, conflicts);
  const mdPath = path.join(OUTPUT_DIR, "route-conflicts.md");
  fs.writeFileSync(mdPath, md, "utf-8");
  console.log(`   → Đã ghi: ${mdPath.replace(ROOT + path.sep, "").replace(/\\/g, "/")}`);

  console.log("");
  console.log("✓ Xong P0 audit.");
  console.log(
    `  Routes: ${routes.length} | Pages: ${pages.length} (${fromPages} ERP + ${fromMenu} Portal)`,
  );
  console.log(
    `  Conflicts: ${crossSrc} cross-slug, ${sameSrc} same-slug, ${conflicts.versionVariants.length} ver-variant, ${conflicts.plannedDelete.length} planned-delete`,
  );
}

main().catch((e) => {
  console.error("Lỗi:", e);
  process.exit(1);
});
