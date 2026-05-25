/* db.ts — Kết nối Drizzle tới PostgreSQL. Pool ứng dụng giới hạn
   max=10 để chừa connection cho pg-boss (xem UPGRADE-PLAN 3.2.1).

   Multi-region read-replica (v4): DATABASE_URL_READ env trỏ tới
   read-replica → dbRead client; nếu vắng, dbRead = db (single node).
   Endpoint read nặng (records.list, analytics) có thể dùng dbRead;
   write vẫn dùng db primary để đảm bảo consistency. */
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@erp-framework/db";

const url = process.env.DATABASE_URL
  ?? "postgres://localhost:5432/erp_framework";

const queryClient = postgres(url, { max: 10 });

export const db = drizzle(queryClient, { schema });
export type DB = typeof db;

/** Read-replica client — fallback xuống primary nếu DATABASE_URL_READ
 *  không set. Caller chọn dùng db vs dbRead tuỳ workload. */
const readUrl = process.env.DATABASE_URL_READ;
const readClient = readUrl ? postgres(readUrl, { max: 10 }) : queryClient;
export const dbRead = readUrl
  ? drizzle(readClient, { schema })
  : db;
