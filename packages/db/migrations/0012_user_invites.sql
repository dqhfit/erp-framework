/* 0012_user_invites.sql — Invite flow.
   Admin tạo user trước với password_hash="" (placeholder), sinh
   invite token random 32 byte base64url. Gửi link /invite?token=...
   cho user. User mở link → đặt mật khẩu lần đầu → backend hash + lưu
   vào users.password_hash, mark accepted_at + tự cấp session (auto-login).

   Token KHÔNG hash trong DB (giống session token) — đủ entropy 256-bit
   + có expires_at + dùng 1 lần (accepted_at). Khi admin "resend" sẽ
   xoá invite cũ pending + tạo invite mới. */

CREATE TABLE IF NOT EXISTS "user_invites" (
  "id" uuid PRIMARY KEY DEFAULT uuidv7(),
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "token" text NOT NULL,
  /* Role áp vào company_members khi user accept. */
  "role" "user_role" NOT NULL DEFAULT 'viewer',
  "invited_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "expires_at" timestamp NOT NULL,
  /* NULL = chưa accept (pending). Đã set = không dùng lại được. */
  "accepted_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "user_invites_token_idx" ON "user_invites"("token");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_invites_user_idx" ON "user_invites"("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_invites_company_idx" ON "user_invites"("company_id");
