/* ==========================================================
   db.ts — Drizzle connection riêng cho migration-cli.

   KHÔNG import @erp-framework/server vì sẽ gây circular dep
   (server import migration-cli/discover để chạy worker, nếu
   migration-cli import server/db thì vòng tròn).

   Pool nhẹ (max 3) — chỉ dùng cho CLI/worker, không serve
   request HTTP.
   ========================================================== */

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@erp-framework/db";

const url = process.env.DATABASE_URL ?? "postgres://localhost:5432/erp_framework";

const queryClient = postgres(url, { max: 3 });
export const db = drizzle(queryClient, { schema });
export type DB = typeof db;

/** Đóng pool PG để CLI standalone thoát sạch (postgres-js giữ event loop
 *  sống nếu còn connection mở → process treo sau khi xong việc). */
export async function closeDb(): Promise<void> {
  await queryClient.end({ timeout: 5 });
}
