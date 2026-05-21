/* ==========================================================
   auth.ts — Băm mật khẩu (scrypt, dùng crypto lõi của Node —
   không cần thư viện ngoài) + tiện ích phiên đăng nhập.
   ========================================================== */
import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt);
const KEYLEN = 64;

/** Băm mật khẩu → chuỗi "salt:hash" (hex). */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derived = (await scryptAsync(password, salt, KEYLEN)) as Buffer;
  return `${salt}:${derived.toString("hex")}`;
}

/** Kiểm mật khẩu — so sánh hằng-thời-gian chống timing attack. */
export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const derived = (await scryptAsync(password, salt, KEYLEN)) as Buffer;
  const want = Buffer.from(hash, "hex");
  return want.length === derived.length && timingSafeEqual(want, derived);
}

/** Sinh token phiên ngẫu nhiên (an toàn). */
export function newSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Phiên sống 7 ngày. */
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const SESSION_COOKIE = "sid";
