-- 0095_tr_bemat_created_by.sql
-- Them cot created_by cho tr_bemat (tracking nguoi tao ban ghi bang mau UV).
--
-- GUARD bang ton tai: tr_bemat la bang NGUON DQHF -- CO tren dev (da full-import)
-- nhung CHUA CHAC co tren prod (chua import/cutover module). "ADD COLUMN IF NOT
-- EXISTS" chi idempotent cho COT, KHONG cho BANG thieu -> ALTER tran nem 42P01
-- "relation tr_bemat does not exist" lam migration do + server khong boot.
-- Boc trong DO + check information_schema -> chi ALTER khi bang co that.
-- An toan re-run + an toan tren prod chua co bang (skip im lang).
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'tr_bemat'
  ) THEN
    ALTER TABLE tr_bemat ADD COLUMN IF NOT EXISTS created_by uuid;
  END IF;
END $$;
