/**
 * seed-viewer-groups.mjs
 * Tạo viewer groups mặc định theo danh mục menu gốc và gán page tương ứng.
 *
 * Cách dùng:
 *   node --env-file=packages/server/.env tooling/migration-cli/src/seed-viewer-groups.mjs
 *   node --env-file=packages/server/.env tooling/migration-cli/src/seed-viewer-groups.mjs --apply
 *   node --env-file=packages/server/.env tooling/migration-cli/src/seed-viewer-groups.mjs --apply --company <id>
 *
 * Mặc định: dry-run (chỉ in kế hoạch). Thêm --apply để ghi DB.
 */
import postgres from "postgres";

const APPLY = process.argv.includes("--apply");
const _companyIdx = process.argv.indexOf("--company");
const COMPANY_ARG = _companyIdx !== -1 ? (process.argv[_companyIdx + 1] ?? null) : null;

const COLORS = [
  "#6366f1", "#8b5cf6", "#06b6d4", "#f59e0b", "#10b981",
  "#3b82f6", "#ec4899", "#f97316", "#84cc16", "#0ea5e9",
  "#d946ef", "#64748b", "#ef4444",
];

const sql = postgres(process.env.DATABASE_URL, { max: 1 });

try {
  /* ── 1. Chọn công ty ── */
  let company;
  if (COMPANY_ARG) {
    [company] = await sql`SELECT id, name FROM companies WHERE id = ${COMPANY_ARG}`;
    if (!company) throw new Error(`Không tìm thấy công ty ${COMPANY_ARG}`);
  } else {
    const companies = await sql`SELECT id, name FROM companies ORDER BY created_at LIMIT 5`;
    if (!companies.length) throw new Error("Không có công ty nào trong DB");
    if (companies.length > 1) {
      console.log("Nhiều công ty — dùng --company <id> để chọn:");
      for (const c of companies) console.log(`  ${c.id}  ${c.name}`);
      console.log("\nTự động dùng công ty đầu tiên.");
    }
    company = companies[0];
  }
  console.log(`Công ty: ${company.name} (${company.id})\n`);

  /* ── 2. Tải cây menu ── */
  const nodes = await sql`
    SELECT source_code, name, level, parent_code, sort, page_id
    FROM legacy_menu_map
    WHERE company_id = ${company.id} AND active = true
    ORDER BY sort, source_code
  `;
  const byCode = new Map(nodes.map((n) => [n.source_code, n]));

  /* ── 3. Xác định code gốc (top-level) của mỗi node ── */
  function rootOf(code) {
    let cur = byCode.get(code);
    while (cur?.parent_code && byCode.has(cur.parent_code)) {
      cur = byCode.get(cur.parent_code);
    }
    return cur?.source_code ?? null;
  }

  /* ── 4. Gom page theo root ── */
  const rootPageMap = new Map(); // root_code → Set<page_id>
  for (const n of nodes) {
    if (!n.page_id) continue;
    const root = rootOf(n.source_code);
    if (!root) continue;
    if (!rootPageMap.has(root)) rootPageMap.set(root, new Set());
    rootPageMap.get(root).add(n.page_id);
  }

  /* ── 5. Top-level nodes (không có parent hoặc parent không tồn tại) ── */
  const topLevel = nodes.filter(
    (n) => !n.parent_code || !byCode.has(n.parent_code),
  );

  /* ── 6. Existing groups ── */
  const existing = await sql`
    SELECT id, name FROM viewer_groups WHERE company_id = ${company.id}
  `;
  const existingByName = new Map(existing.map((g) => [g.name, g.id]));

  /* ── 7. Kế hoạch ── */
  const plan = [];
  let colorIdx = 0;
  for (const root of topLevel) {
    const pageSet = rootPageMap.get(root.source_code);
    if (!pageSet?.size) continue; // bỏ qua nhánh không có trang nào
    const name = (root.name ?? root.source_code).trim();
    const existingId = existingByName.get(name) ?? null;
    plan.push({
      code: root.source_code,
      name,
      color: COLORS[colorIdx++ % COLORS.length],
      pages: [...pageSet],
      existingId,
    });
  }

  /* ── 8. In báo cáo ── */
  console.log("=== Kế hoạch thiết lập viewer groups ===\n");
  for (const item of plan) {
    const tag = item.existingId ? "[đã có]  " : "[tạo mới]";
    console.log(`${tag} ${item.name.padEnd(24)} ${item.pages.length} trang`);
  }
  console.log(`\nTổng: ${plan.length} group, ${plan.reduce((s, i) => s + i.pages.length, 0)} trang-gán\n`);

  if (!APPLY) {
    console.log("→ Dry-run. Thêm --apply để ghi vào DB.");
    process.exit(0);
  }

  /* ── 9. Áp dụng ── */
  console.log("=== Đang áp dụng... ===\n");
  for (const item of plan) {
    let groupId = item.existingId;

    if (!groupId) {
      const [row] = await sql`
        INSERT INTO viewer_groups (id, company_id, name, color)
        VALUES (gen_random_uuid(), ${company.id}, ${item.name}, ${item.color})
        RETURNING id
      `;
      groupId = row.id;
      console.log(`Tạo "${item.name}" → ${groupId}`);
    } else {
      console.log(`Dùng group hiện có "${item.name}" (${groupId})`);
    }

    // Gán page vào group (upsert, bỏ qua trùng)
    const inserted = await sql`
      INSERT INTO page_viewer_groups (page_id, group_id)
      SELECT unnest(${item.pages}::uuid[]), ${groupId}
      ON CONFLICT DO NOTHING
    `;
    console.log(`  → Gán ${item.pages.length} trang (${inserted.count} mới)\n`);
  }

  console.log("✓ Hoàn thành.");
} finally {
  await sql.end();
}
