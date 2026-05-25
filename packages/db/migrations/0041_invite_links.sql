/* 0041_invite_links.sql -- Generic invite link (khong can biet email truoc).
   Admin tao link voi role, chia se cho bat ky ai. Nguoi nhan mo link,
   tu nhap ten + email + mat khau -> server tao user moi + gan vao cong ty.
   Link dung 1 lan (used_at set sau khi accept). */

CREATE TABLE IF NOT EXISTS "invite_links" (
  "id" uuid PRIMARY KEY DEFAULT uuidv7(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "role" "user_role" NOT NULL DEFAULT 'viewer',
  "token" text NOT NULL,
  "created_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "expires_at" timestamp NOT NULL,
  /* NULL = chua dung. Set = da co nguoi dang ky qua link nay (1 lan). */
  "used_at" timestamp,
  "used_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "invite_links_token_idx" ON "invite_links"("token");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invite_links_company_idx" ON "invite_links"("company_id");
