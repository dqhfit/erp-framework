/* 0031_audit_immutable.sql — Write-once audit log cho compliance.
   activity_log hiện cho phép UPDATE/DELETE (admin có thể che giấu).
   audit_log_immutable: trigger BEFORE UPDATE OR DELETE → RAISE EXCEPTION
   → không ai (kể cả superuser app role) sửa/xoá được sau INSERT.
   Production cần kết hợp PG role grants để siết hơn nữa. */

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

/* Trigger function — ném exception nếu UPDATE/DELETE. INSERT vẫn OK. */
CREATE OR REPLACE FUNCTION audit_log_immutable_guard()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'audit_log_immutable: UPDATE bị cấm (write-once)';
  ELSIF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'audit_log_immutable: DELETE bị cấm (write-once)';
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
