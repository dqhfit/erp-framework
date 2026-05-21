/* db.ts — Kết nối Drizzle tới PostgreSQL. Pool ứng dụng giới hạn
   max=10 để chừa connection cho pg-boss (xem UPGRADE-PLAN 3.2.1). */
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@erp-framework/db";

const url = process.env.DATABASE_URL
  ?? "postgres://localhost:5432/erp_framework";

const queryClient = postgres(url, { max: 10 });

export const db = drizzle(queryClient, { schema });
export type DB = typeof db;
