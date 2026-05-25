/* ==========================================================
   migrate.ts — Chạy migrations programmatically.
   Dùng ở server bootstrap để tự động migrate khi start —
   hoạt động cho mọi deploy (Docker, native, k8s, PM2…),
   không phụ thuộc shell command bên ngoài.

   Idempotent — drizzle ghi nhật ký schema "drizzle" để theo dõi
   migration đã apply.
   ========================================================== */
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

const here = dirname(fileURLToPath(import.meta.url));
// Thư mục migrations cùng cấp với src/ trong package db.
// Cấu trúc: packages/db/src/migrate.ts → packages/db/migrations/
const MIGRATIONS_FOLDER = resolve(here, "..", "migrations");

export async function runMigrations(
  db: PostgresJsDatabase<Record<string, unknown>>,
): Promise<void> {
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
}

export { MIGRATIONS_FOLDER };
