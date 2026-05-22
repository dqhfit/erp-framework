/* 0004_agent_heartbeat.sql — Heartbeat: agent tự thức dậy theo
   lịch cron và hành động (khác cron chạy workflow). Bảng mới, không
   cần backfill. */

CREATE TABLE IF NOT EXISTS "agent_heartbeats" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"company_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"cron_expr" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"prompt" text NOT NULL,
	"last_run" timestamp,
	"last_status" "run_status",
	"last_summary" text,
	"run_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_heartbeats" ADD CONSTRAINT "agent_heartbeats_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_heartbeats" ADD CONSTRAINT "agent_heartbeats_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_heartbeats_company_id_idx" ON "agent_heartbeats" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_heartbeats_agent_id_idx" ON "agent_heartbeats" USING btree ("agent_id");
