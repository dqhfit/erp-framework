import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./auth";
import { companies } from "./tenant";

/* ─── Backup — sao lưu lên Google Drive (UI/cron) ───────── */
/* Mỗi công ty 1 cấu hình. gdriveKeyEnc = JSON service account key đã
   mã hoá AES-256-GCM. scheduleCron NULL = chỉ chạy thủ công. */
export const backupConfig = pgTable(
  "backup_config",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    gdriveKeyEnc: text("gdrive_key_enc").notNull(),
    gdriveFolderId: text("gdrive_folder_id").notNull(),
    scheduleCron: text("schedule_cron"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => ({
    companyUidx: uniqueIndex("backup_config_company_uidx").on(t.companyId),
  }),
);

/* Lịch sử các lần backup. status: running → done | error. */
export const backupRuns = pgTable(
  "backup_runs",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("running"),
    trigger: text("trigger").notNull().default("manual"),
    dbDriveFileId: text("db_drive_file_id"),
    dbBytes: integer("db_bytes"),
    uploadsSynced: integer("uploads_synced").notNull().default(0),
    uploadsSkipped: integer("uploads_skipped").notNull().default(0),
    uploadsBytes: integer("uploads_bytes").notNull().default(0),
    error: text("error"),
    startedAt: timestamp("started_at").defaultNow().notNull(),
    finishedAt: timestamp("finished_at"),
  },
  (t) => ({
    companyStartedIdx: index("backup_runs_company_started_idx").on(t.companyId, t.startedAt),
  }),
);

/* API keys per company — auth cho REST /api/v1/* endpoints. key_hash =
   sha256 của plaintext (sk_...); plaintext chỉ trả 1 lần lúc tạo. scopes
   JSONB array vd ["entity:customer:read"]; empty = full access.
   client_id (v4 OAuth): cho client_credentials flow — POST /oauth/token. */
export const apiKeys = pgTable(
  "api_keys",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    keyHash: text("key_hash").notNull(),
    prefix: text("prefix").notNull(),
    scopes: jsonb("scopes").notNull().default(sql`'[]'::jsonb`),
    clientId: text("client_id"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    lastUsedAt: timestamp("last_used_at"),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    hashIdx: uniqueIndex("api_keys_hash_idx").on(t.keyHash),
    clientIdx: uniqueIndex("api_keys_client_id_idx").on(t.clientId),
    companyIdx: index("api_keys_company_idx").on(t.companyId),
  }),
);

/* Materialized views per company — pre-computed heavy aggregation cho
   dashboard/report. Query SQL custom (admin viết); refresh cron schedule
   ghi data JSONB. Render từ data field — nhanh hơn re-execute query. */

/* Write-once audit log cho compliance — trigger BEFORE UPDATE OR DELETE
   ném exception. Mirror activity_log nhưng cho event critical (auth,
   record write, RBAC change). Ai cũng không sửa/xoá được sau INSERT. */
export const auditLogImmutable = pgTable(
  "audit_log_immutable",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    companyId: uuid("company_id"),
    kind: text("kind").notNull(),
    objectType: text("object_type"),
    target: text("target"),
    targetId: uuid("target_id"),
    actorUserId: uuid("actor_user_id"),
    detail: text("detail").notNull(),
    diff: jsonb("diff"),
    ip: text("ip"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    companyKindIdx: index("ali_company_kind_idx").on(t.companyId, t.kind, t.createdAt),
    targetIdx: index("ali_target_idx").on(t.targetId),
  }),
);

/* OAuth refresh tokens — long-lived; rotate khi dùng (issue new + revoke cũ).
   Token plaintext "rt_<hex>" → sha256 → token_hash. */
export const oauthRefreshTokens = pgTable(
  "oauth_refresh_tokens",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    apiKeyId: uuid("api_key_id")
      .notNull()
      .references(() => apiKeys.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    revokedAt: timestamp("revoked_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    tokenHashIdx: uniqueIndex("ort_token_hash_idx").on(t.tokenHash),
  }),
);

/* OAuth authorization codes — short-lived (10 phút), PKCE bắt buộc.
   code_challenge = sha256(verifier) base64url. Method "S256" only. */
export const oauthAuthCodes = pgTable(
  "oauth_auth_codes",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    codeHash: text("code_hash").notNull(),
    clientId: text("client_id").notNull(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    apiKeyId: uuid("api_key_id")
      .notNull()
      .references(() => apiKeys.id, { onDelete: "cascade" }),
    redirectUri: text("redirect_uri").notNull(),
    codeChallenge: text("code_challenge").notNull(),
    codeChallengeMethod: text("code_challenge_method").notNull().default("S256"),
    expiresAt: timestamp("expires_at").notNull(),
    usedAt: timestamp("used_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    codeHashIdx: uniqueIndex("oac_code_hash_idx").on(t.codeHash),
  }),
);
