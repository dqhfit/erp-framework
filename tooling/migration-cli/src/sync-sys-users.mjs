/**
 * sync-sys-users.mjs
 * Tạo framework user account cho mọi sys_user chưa có tài khoản,
 * gán vào viewer group theo f_group_id.
 *
 * Cách dùng:
 *   node --env-file=packages/server/.env tooling/migration-cli/src/sync-sys-users.mjs
 *   node --env-file=packages/server/.env tooling/migration-cli/src/sync-sys-users.mjs --apply
 *
 * Mặc định: dry-run. Thêm --apply để ghi DB.
 *
 * Logic:
 *  - Tạo users (email=<username>@dqhf.local, legacy_username=f_username)
 *    chỉ khi chưa tồn tại (theo legacy_username + legacy_company_id).
 *  - Thêm company_members (role=viewer, approved=true) nếu chưa có.
 *  - Gán user_viewer_groups theo bảng map f_group_id → viewer group tên.
 *  - Group chưa có trong DB → tự tạo (màu mặc định).
 *  - Idempotent: chạy nhiều lần an toàn.
 */
import postgres from "postgres";

const APPLY = process.argv.includes("--apply");
const sql = postgres(process.env.DATABASE_URL, { max: 1 });

// Ánh xạ f_group_id (MSSQL) → tên viewer group
const GROUP_MAP = {
  sanxuat: "Quản lý sản xuất",
  kythuat: "Kỹ thuật",
  kinhdoanh: "Kinh doanh",
  qaqc: "QA/QC",
  nhansu: "Nhân sự",
  BAOTRI: "Bảo trì",
  warehouse: "Quản lý kho",
  admin: "Hệ thống",
  thumua: "Thu mua",
  kehoach: "Kế hoạch sản xuất",
  ketoan: "Kế toán",
};

// Màu cho group mới tạo thêm (không có trong seed-viewer-groups)
const EXTRA_COLORS = {
  "QA/QC": "#10b981",
  "Nhân sự": "#f43f5e",
  "Bảo trì": "#78716c",
};

try {
  /* ── 1. Lấy công ty ── */
  const [company] = await sql`SELECT id, name FROM companies ORDER BY created_at LIMIT 1`;
  if (!company) throw new Error("Không có công ty");
  console.log(`Công ty: ${company.name} (${company.id})\n`);

  /* ── 2. Tải sys_user ── */
  const sysUsers = await sql`
    SELECT id AS pg_id, company_id, f_username, f_fullname,
           ext->>'email' AS email_ext, f_group_id
    FROM sys_user
    WHERE deleted_at IS NULL AND f_username IS NOT NULL AND f_username <> ''
    ORDER BY f_username
  `;
  console.log(`sys_user: ${sysUsers.length} user active\n`);

  /* ── 3. Tải viewer groups hiện có ── */
  const vgRows = await sql`SELECT id, name FROM viewer_groups WHERE company_id = ${company.id}`;
  const vgByName = new Map(vgRows.map((g) => [g.name, g.id]));

  /* ── 4. Tải framework users hiện có (theo legacy_username) ── */
  const fwUsers = await sql`
    SELECT u.id, u.legacy_username, cm.user_id AS member_user_id
    FROM users u
    LEFT JOIN company_members cm ON cm.user_id = u.id AND cm.company_id = ${company.id}
    WHERE u.legacy_username IS NOT NULL AND u.legacy_company_id = ${company.id}
  `;
  const fwByUsername = new Map(fwUsers.map((u) => [u.legacy_username.toLowerCase(), u]));

  /* ── 5. Tải user_viewer_groups hiện có ── */
  const uvgRows = await sql`
    SELECT uvg.user_id, uvg.group_id
    FROM user_viewer_groups uvg
    JOIN viewer_groups vg ON vg.id = uvg.group_id AND vg.company_id = ${company.id}
  `;
  const uvgSet = new Set(uvgRows.map((r) => `${r.user_id}:${r.group_id}`));

  /* ── 6. Phân tích ── */
  const toCreateUser = [];
  const toAddMember = [];
  const toAssignGroup = [];
  const unknownGroups = new Set();

  for (const su of sysUsers) {
    const username = su.f_username.toLowerCase();
    const existing = fwByUsername.get(username);

    const userId = existing?.id ?? null; // null = cần tạo mới
    const hasMember = !!existing?.member_user_id;

    if (!userId) {
      toCreateUser.push(su);
    } else if (!hasMember) {
      toAddMember.push({ userId, su });
    }

    // Xác định viewer group
    const groupId = su.f_group_id;
    if (!groupId) continue;
    const groupName = GROUP_MAP[groupId];
    if (!groupName) {
      unknownGroups.add(groupId);
      continue;
    }
    const vgId = vgByName.get(groupName);
    const uidForAssign = userId; // null nếu user chưa tồn tại, sẽ được tạo lúc apply
    if (vgId && uidForAssign && !uvgSet.has(`${uidForAssign}:${vgId}`)) {
      toAssignGroup.push({ userId: uidForAssign, groupId: vgId, groupName });
    }
    // group chưa có trong DB → sẽ tạo lúc apply, không track ở đây
  }

  /* ── 7. Nhóm cần tạo viewer group mới ── */
  const newGroupNames = new Set();
  for (const su of sysUsers) {
    if (!su.f_group_id) continue;
    const gname = GROUP_MAP[su.f_group_id];
    if (gname && !vgByName.has(gname)) newGroupNames.add(gname);
  }

  /* ── 8. In báo cáo ── */
  console.log("=== Báo cáo ===\n");
  console.log(`Framework users hiện có (có legacy_username): ${fwUsers.length}`);
  console.log(`Cần tạo user mới:      ${toCreateUser.length}`);
  console.log(`Cần thêm company_member: ${toAddMember.length}`);
  console.log(`Cần gán viewer group:   ${toAssignGroup.length} (user đã có)`);
  if (newGroupNames.size) {
    console.log(`\nViewer groups cần tạo thêm: ${[...newGroupNames].join(", ")}`);
  }
  if (unknownGroups.size) {
    console.log(`\nf_group_id không có mapping: ${[...unknownGroups].join(", ")}`);
  }

  // top groups
  const groupCount = new Map();
  for (const su of sysUsers) {
    const k = su.f_group_id ?? "(null)";
    groupCount.set(k, (groupCount.get(k) ?? 0) + 1);
  }
  console.log("\nPhân bố f_group_id:");
  for (const [k, n] of [...groupCount.entries()].sort((a, b) => b[1] - a[1])) {
    const mapped = GROUP_MAP[k] ? ` → ${GROUP_MAP[k]}` : k === "(null)" ? " (bỏ qua)" : " ⚠ chưa map";
    console.log(`  ${k.padEnd(16)} ${n}${mapped}`);
  }

  if (!APPLY) {
    console.log("\n→ Dry-run. Thêm --apply để ghi DB.");
    process.exit(0);
  }

  /* ── 9. Áp dụng ── */
  console.log("\n=== Đang áp dụng... ===\n");

  // 9a. Tạo viewer group mới nếu thiếu
  for (const gname of newGroupNames) {
    const color = EXTRA_COLORS[gname] ?? "#94a3b8";
    const [row] = await sql`
      INSERT INTO viewer_groups (id, company_id, name, color)
      VALUES (gen_random_uuid(), ${company.id}, ${gname}, ${color})
      ON CONFLICT DO NOTHING
      RETURNING id, name
    `;
    if (row) {
      vgByName.set(row.name, row.id);
      console.log(`Tạo viewer group "${row.name}"`);
    }
  }

  // 9b. Tạo framework users + company_members
  let createdUsers = 0;
  let createdMembers = 0;
  for (const su of sysUsers) {
    const username = su.f_username.toLowerCase();
    let existing = fwByUsername.get(username);

    if (!existing) {
      // Tạo user
      const emailReal = su.email_ext ?? null;
      const emailFw = emailReal || `${su.f_username}@dqhf.local`;
      // Thêm suffix nếu email trùng
      const emailFinal = emailFw;
      const [newUser] = await sql`
        INSERT INTO users (id, email, name, password_hash, role, legacy_username, legacy_company_id)
        VALUES (
          gen_random_uuid(),
          ${emailFinal},
          ${su.f_fullname ?? su.f_username},
          '__legacy__',
          'viewer',
          ${su.f_username},
          ${company.id}
        )
        ON CONFLICT (email) DO UPDATE
          SET legacy_username = EXCLUDED.legacy_username,
              legacy_company_id = EXCLUDED.legacy_company_id
        RETURNING id
      `;
      existing = { id: newUser.id, legacy_username: su.f_username, member_user_id: null };
      fwByUsername.set(username, existing);
      createdUsers++;
    }

    // Thêm company_member
    if (!existing.member_user_id) {
      await sql`
        INSERT INTO company_members (company_id, user_id, role, approved, disabled)
        VALUES (${company.id}, ${existing.id}, 'viewer', true, false)
        ON CONFLICT DO NOTHING
      `;
      createdMembers++;
    }
  }
  console.log(`Tạo ${createdUsers} users mới, ${createdMembers} company_members mới\n`);

  // 9c. Gán viewer groups (batch per group)
  let assignedCount = 0;
  for (const su of sysUsers) {
    if (!su.f_group_id) continue;
    const groupName = GROUP_MAP[su.f_group_id];
    if (!groupName) continue;
    const vgId = vgByName.get(groupName);
    if (!vgId) continue;
    const uid = fwByUsername.get(su.f_username.toLowerCase())?.id;
    if (!uid) continue;
    if (uvgSet.has(`${uid}:${vgId}`)) continue;
    await sql`
      INSERT INTO user_viewer_groups (user_id, group_id)
      VALUES (${uid}, ${vgId})
      ON CONFLICT DO NOTHING
    `;
    uvgSet.add(`${uid}:${vgId}`);
    assignedCount++;
  }
  console.log(`Gán ${assignedCount} user → group\n`);
  console.log("✓ Hoàn thành.");
} finally {
  await sql.end();
}
