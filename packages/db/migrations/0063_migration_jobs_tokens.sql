-- 0063_migration_jobs_tokens.sql
-- Them cot tokens_in / tokens_out vao migration_jobs de theo doi token LLM
-- tich luy qua cac lan resume cua action job enrich.
--
-- Ly do: truoc day enrich tinh cost tu 0 moi lan chay, nen --max-cost-usd
-- khong phai tran THAT cho ca job — mot job bi stop/resume N lan co the tieu
-- 5 USD x N. Nay enrich doc tokens_in/out lam baseline + cong don, va so voi
-- max-cost theo tong tich luy.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS.

ALTER TABLE migration_jobs
  ADD COLUMN IF NOT EXISTS tokens_in  bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tokens_out bigint NOT NULL DEFAULT 0;
