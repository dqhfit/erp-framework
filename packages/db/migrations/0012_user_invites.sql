/* 0012_user_invites.sql -- Invite flow.
   Admin tao user truoc voi password_hash="" (placeholder), sinh
   invite token random 32 byte base64url. Gui link /invite?token=...
   cho user. User mo link -> dat mat khau lan dau -> backend hash + luu
   vao users.password_hash, mark accepted_at + tu cap session (auto-login).

   Token KHONG hash trong DB (giong session token) -- du entropy 256-bit
   + co expires_at + dung 1 lan (accepted_at). Khi admin "resend" se
   xoa invite cu pending + tao invite moi. */

CREATE TABLE IF NOT EXISTS "user_invites" (
  "id" uuid PRIMARY KEY DEFAULT uuidv7(),
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "token" text NOT NULL,
  /* Role ap vao company_members khi user accept. */
  "role" "user_role" NOT NULL DEFAULT 'viewer',
  "invited_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "expires_at" timestamp NOT NULL,
  /* NULL = chua accept (pending). Da set = khong dung lai duoc. */
  "accepted_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "user_invites_token_idx" ON "user_invites"("token");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_invites_user_idx" ON "user_invites"("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_invites_company_idx" ON "user_invites"("company_id");
