/* 0031_audit_immutable.sql -- Write-once audit log cho compliance.
   activity_log hien cho phep UPDATE/DELETE (admin co the che giau).
   audit_log_immutable: trigger BEFORE UPDATE OR DELETE -> RAISE EXCEPTION
   -> khong ai (ke ca superuser app role) sua/xoa duoc sau INSERT.
   Production can ket hop PG role grants de siet hon nua. */

CREATE TABLE IF NOT EXISTS "audit_log_immutable" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"company_id" uuid,
	"kind" text NOT NULL,
	"object_type" text,
	"target" text,
	"target_id" uuid,
	"actor_user_id" uuid,
	"detail" text NOT NULL,
	"diff" jsonb,
	"ip" text,
	"user_agent" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint

/* Trigger function -- nem exception neu UPDATE/DELETE. INSERT van OK. */
CREATE OR REPLACE FUNCTION audit_log_immutable_guard()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'audit_log_immutable: UPDATE bi cam (write-once)';
  ELSIF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'audit_log_immutable: DELETE bi cam (write-once)';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

DROP TRIGGER IF EXISTS audit_immutable_guard ON "audit_log_immutable";
--> statement-breakpoint
CREATE TRIGGER audit_immutable_guard
  BEFORE UPDATE OR DELETE ON "audit_log_immutable"
  FOR EACH ROW EXECUTE FUNCTION audit_log_immutable_guard();
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "ali_company_kind_idx" ON "audit_log_immutable" ("company_id", "kind", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ali_target_idx" ON "audit_log_immutable" ("target_id");
