-- 0079_workflow_template_origin.sql
-- Workflow template gallery: them cot source_template_id de track workflow
-- duoc clone tu template nao (workflow-templates.ts). null = tao tay.
-- Dung de hien nguon goc + ho tro "cap nhat theo template moi" ve sau.

ALTER TABLE "workflows" ADD COLUMN IF NOT EXISTS "source_template_id" text;
