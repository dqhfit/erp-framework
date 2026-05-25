ALTER TABLE "company_members" ADD COLUMN IF NOT EXISTS "disabled" boolean NOT NULL DEFAULT false;
