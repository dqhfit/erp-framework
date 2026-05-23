/* 0011_user_agent_membership.sql — Gán user ↔ agent (N:M).

   Bổ sung:
   - users.primary_agent_id: agent "chính" cá nhân của mỗi user (1:1, optional).
     AgentPanel/Topbar dùng cột này để bind nhanh khi user mở app.
   - agent_members(agent_id, user_id, role): pivot N:M phân quyền per cặp.
     role = owner | operator | observer. Owner mới được toggle isPrivate +
     thêm/xoá member.
   - agents.created_by: tracking ai tạo agent (backfill NULL — không phá data cũ).
   - agents.config sẽ chứa thêm khoá tự do "isPrivate" (boolean) — không cần
     ALTER, vì cột config đã là jsonb.

   Hybrid privacy model: agent_members ưu tiên khi agent.config.isPrivate=true;
   ngược lại fallback về company-RBAC như cũ. Logic ở agent-acl.ts. */

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "primary_agent_id" uuid;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "users" ADD CONSTRAINT "users_primary_agent_id_agents_id_fk"
   FOREIGN KEY ("primary_agent_id") REFERENCES "public"."agents"("id")
   ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "agent_member_role" AS ENUM ('owner', 'operator', 'observer');
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent_members" (
  "agent_id" uuid NOT NULL,
  "user_id"  uuid NOT NULL,
  "role"     "agent_member_role" NOT NULL DEFAULT 'operator',
  "added_by" uuid,
  "added_at" timestamp NOT NULL DEFAULT now(),
  PRIMARY KEY ("agent_id", "user_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_members" ADD CONSTRAINT "agent_members_agent_id_agents_id_fk"
   FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id")
   ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_members" ADD CONSTRAINT "agent_members_user_id_users_id_fk"
   FOREIGN KEY ("user_id") REFERENCES "public"."users"("id")
   ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_members" ADD CONSTRAINT "agent_members_added_by_users_id_fk"
   FOREIGN KEY ("added_by") REFERENCES "public"."users"("id")
   ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_members_user_idx"
  ON "agent_members" USING btree ("user_id");
--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "created_by" uuid;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agents" ADD CONSTRAINT "agents_created_by_users_id_fk"
   FOREIGN KEY ("created_by") REFERENCES "public"."users"("id")
   ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
