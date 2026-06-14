/* ==========================================================
   legacy-login.ts — Bridge đăng nhập user DQHF cũ bằng mật khẩu MD5.
   sys_user lưu mật khẩu dạng MD5 32-hex (CHỮ HOA). Login framework dùng
   scrypt; khi verify scrypt fail, thử khớp MD5 ở sys_user theo username/
   email → trả thông tin để lazy-tạo/nâng-cấp user framework (rehash scrypt).
   Đa số user cũ KHÔNG có email → định danh theo username (email tổng hợp).
   ========================================================== */
import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import type { DB } from "./db";

const MD5_RE = /^[0-9a-fA-F]{32}$/;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** MD5(password) viết HOA, thử cả UTF-8 lẫn UTF-16LE — .NET (DQHF) có thể
 *  băm theo Encoding.UTF8 hoặc Encoding.Unicode (UTF-16LE). Khớp 1 trong 2
 *  là đủ. Nếu DQHF có salt/prefix thì không khớp → caller fail an toàn. */
function md5VariantsUpper(pw: string): string[] {
  return [
    createHash("md5").update(Buffer.from(pw, "utf8")).digest("hex"),
    createHash("md5").update(Buffer.from(pw, "utf16le")).digest("hex"),
  ].map((h) => h.toUpperCase());
}

/** Email tổng hợp định danh theo username (user cũ thường không có email).
 *  Local-part chỉ giữ ký tự hợp lệ; ổn định theo username để login lặp lại. */
export function legacyEmail(username: string): string {
  const local =
    username
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]/g, "_") || "user";
  return `${local}@dqhf.local`;
}

export interface LegacyMatch {
  /** Email framework dùng để định danh user (luôn tổng hợp theo username). */
  email: string;
  name: string;
  companyId: string;
  username: string;
}

interface SysUserRow {
  company_id: string;
  username: string;
  pw: string | null;
  email: string | null;
  fullname: string | null;
}

/** Thử khớp mật khẩu MD5 của user DQHF cũ theo username (hoặc email) trong
 *  bảng sys_user. Trả LegacyMatch nếu khớp, null nếu không (KHÔNG phân biệt
 *  lý do — chống dò tài khoản). Bảng sys_user có thể chưa tồn tại (chưa
 *  migrate) → bắt lỗi trả null. */
export async function tryLegacyMd5Login(
  db: DB,
  identifier: string,
  password: string,
): Promise<LegacyMatch | null> {
  const id = identifier.trim();
  if (!id || !password) return null;
  let rows: SysUserRow[];
  try {
    const res = (await db.execute(sql`
      SELECT company_id, f_username AS username, f_password AS pw,
             ext->>'email' AS email, f_fullname AS fullname
      FROM sys_user
      WHERE deleted_at IS NULL
        AND (lower(f_username) = lower(${id}) OR lower(ext->>'email') = lower(${id}))
      LIMIT 1
    `)) as unknown as SysUserRow[] | { rows: SysUserRow[] };
    rows = Array.isArray(res) ? res : (res.rows ?? []);
  } catch {
    return null; // bảng sys_user chưa migrate / lỗi đọc → coi như không khớp
  }
  const r = rows[0];
  if (!r || !r.pw || !MD5_RE.test(r.pw)) return null;
  if (!md5VariantsUpper(password).includes(r.pw.toUpperCase())) return null;
  return {
    email: legacyEmail(r.username),
    name: (r.fullname || "").trim() || r.username,
    companyId: r.company_id,
    username: r.username,
  };
}

/** Email thật của sys_user (nếu hợp lệ) — để hiển thị, KHÔNG dùng định danh. */
export function realEmailOf(email: string | null): string | null {
  return email && EMAIL_RE.test(email) ? email : null;
}
