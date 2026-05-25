/* 0030_tools.sql — Tool system tables.
   `tools` = artifact ngoài monorepo (web-app/mcp-server/cli/plugin)
   discover qua TOOLS_DIR auto-scan hoặc register-remote.
   `company_tools` = per-tenant enable + config (multi-tenant pattern).
   Cả hai dùng IF NOT EXISTS để an toàn khi journal & DB lệch nhau. */

CREATE TABLE IF NOT EXISTS "tools" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"display_name" text,
	"kind" text NOT NULL,
	"runtime" text NOT NULL,
	"manifest" jsonb NOT NULL,
	"source" jsonb NOT NULL,
	"enabled_global" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "tools_slug_uidx" ON "tools" ("slug");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "company_tools" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"company_id" uuid NOT NULL,
	"tool_id" uuid NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "company_tools" ADD CONSTRAINT "company_tools_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "company_tools" ADD CONSTRAINT "company_tools_tool_id_fk" FOREIGN KEY ("tool_id") REFERENCES "public"."tools"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "company_tools_company_tool_uidx" ON "company_tools" ("company_id", "tool_id");
