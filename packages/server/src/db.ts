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

/* Multi-tenant DB sharding (v5):
   DATABASE_URL_SHARDS env = JSON object { "<shard_key>": "<postgres url>" }.
   getDbForCompany(companyId) hash company_id → pick shard từ keys (sort).
   Fallback: nếu env vắng hoặc parse lỗi, dùng primary db (single shard).
   v1: caller refactor dùng getDbForCompany thay vì db trực tiếp ở các route
   write-heavy nếu cần shard; mặc định mọi router giữ db để không phá compat. */
import { createHash } from "node:crypto";

let shardConns: Map<string, DB> | null = null;
let shardKeys: string[] = [];

try {
  const cfg = process.env.DATABASE_URL_SHARDS;
  if (cfg) {
    const obj = JSON.parse(cfg) as Record<string, string>;
    shardConns = new Map();
    for (const [k, u] of Object.entries(obj)) {
      const c = postgres(u, { max: 10 });
      shardConns.set(k, drizzle(c, { schema }));
    }
    shardKeys = [...shardConns.keys()].sort();
    console.log(`[db] sharding enabled (${shardKeys.length} shards):`, shardKeys.join(", "));
  }
} catch (e) {
  console.error("[db] DATABASE_URL_SHARDS parse lỗi, dùng single-shard:", (e as Error).message);
  shardConns = null;
}

/** Lấy DB client cho 1 company. Fallback xuống primary db nếu chưa
 *  setup sharding. Hash sha256 (company_id) → modulo shardKeys.length. */
export function getDbForCompany(companyId: string): DB {
  if (!shardConns || shardKeys.length === 0) return db;
  const h = parseInt(createHash("sha256").update(companyId).digest("hex").slice(0, 8), 16);
  const idx = h % shardKeys.length;
  const key = shardKeys[idx]!;
  return shardConns.get(key) ?? db;
}
