import { randomBytes, scrypt } from "node:crypto";
import { promisify } from "node:util";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";

const scryptAsync = promisify(scrypt);
const KEYLEN = 64;

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derived = (await scryptAsync(password, salt, KEYLEN)) as Buffer;
  return `${salt}:${derived.toString("hex")}`;
}

// Simple env loader
function loadEnv() {
  const paths = [
    join(process.cwd(), "packages", "server", ".env"),
    join(process.cwd(), "packages", "db", ".env"),
    join(process.cwd(), ".env"),
    join(process.cwd(), "..", "..", "packages", "server", ".env"),
    join(process.cwd(), "..", "..", "packages", "db", ".env"),
    join(process.cwd(), "..", "..", ".env"),
  ];
  for (const p of paths) {
    try {
      const content = readFileSync(p, "utf8");
      for (const line of content.split("\n")) {
        const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
        if (m) {
          const k = m[1];
          const rawValue = m[2];
          if (!k || rawValue === undefined) continue;
          const v = rawValue.trim().replace(/^["']|["']$/g, "");
          if (!process.env[k]) {
            process.env[k] = v;
          }
        }
      }
    } catch {
      // ignore
    }
  }
}

async function main() {
  loadEnv();
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error("Lỗi: Không tìm thấy DATABASE_URL trong môi trường hoặc các file .env");
    process.exit(1);
  }

  console.log("Đang kết nối database để tạo tài khoản Admin...");
  const sql = postgres(dbUrl);

  try {
    const email = "admin@local.test";
    const name = "Admin Local";
    const password = "12341234";

    // 1) Check if user already exists
    const [existing] = await sql`SELECT id FROM users WHERE email = ${email}`;
    let userId: string;

    if (existing) {
      console.log(`Tài khoản ${email} đã tồn tại. Đang cập nhật mật khẩu...`);
      const passwordHash = await hashPassword(password);
      await sql`UPDATE users SET name = ${name}, password_hash = ${passwordHash}, role = 'admin' WHERE id = ${existing.id}`;
      userId = existing.id;
      console.log("Cập nhật tài khoản admin thành công!");
    } else {
      console.log(`Đang tạo tài khoản admin mới (${email})...`);
      const passwordHash = await hashPassword(password);
      // generate a uuid
      const [user] = await sql`
        INSERT INTO users (email, name, password_hash, role)
        VALUES (${email}, ${name}, ${passwordHash}, 'admin')
        RETURNING id
      `;
      if (!user) throw new Error("Không nhận được ID tài khoản vừa tạo");
      userId = user.id;
      console.log("Tạo tài khoản admin thành công!");
    }

    // 2) Get or create default company
    let companyId: string;
    const [existingCompany] = await sql`SELECT id FROM companies WHERE slug = 'default'`;
    if (existingCompany) {
      companyId = existingCompany.id;
      console.log("Đã tìm thấy công ty mặc định.");
    } else {
      console.log("Đang tạo công ty mặc định (default)...");
      const [co] = await sql`
        INSERT INTO companies (name, slug)
        VALUES ('Công ty mặc định', 'default')
        RETURNING id
      `;
      if (!co) throw new Error("Không nhận được ID công ty vừa tạo");
      companyId = co.id;
    }

    // 3) Add user to company as admin
    const [existingMember] = await sql`
      SELECT id FROM company_members
      WHERE company_id = ${companyId} AND user_id = ${userId}
    `;
    if (!existingMember) {
      console.log("Đang gán quyền admin của công ty cho tài khoản...");
      await sql`
        INSERT INTO company_members (company_id, user_id, role, approved, disabled)
        VALUES (${companyId}, ${userId}, 'admin', true, false)
      `;
      console.log("Gán quyền thành công!");
    } else {
      console.log("Tài khoản đã là thành viên công ty.");
      await sql`
        UPDATE company_members
        SET role = 'admin', approved = true, disabled = false
        WHERE id = ${existingMember.id}
      `;
    }

    console.log("\n==================================================");
    console.log("THÔNG TIN ĐĂNG NHẬP LOCAL:");
    console.log(`Email: ${email}`);
    console.log(`Mật khẩu: ${password}`);
    console.log("==================================================");
  } catch (error) {
    console.error("Lỗi khi tạo tài khoản:", error);
    process.exit(1);
  } finally {
    await sql.end();
  }
}

main();
