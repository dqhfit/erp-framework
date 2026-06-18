-- Đảm bảo chỉ 1 ngân hàng mặc định mỗi công ty.
-- isdefault lưu trong ext JSONB: khi set true → clear các row khác cùng company.
CREATE OR REPLACE FUNCTION fn_nganhang_isdefault_unique()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.ext->>'isdefault') = 'true' THEN
    UPDATE tr_nganhang
    SET ext = ext || '{"isdefault": false}'::jsonb
    WHERE company_id = NEW.company_id
      AND id != NEW.id
      AND (ext->>'isdefault') = 'true';
  END IF;
  RETURN NEW;
END;
$$;

DO $$ BEGIN
  CREATE TRIGGER tg_nganhang_isdefault_unique
    AFTER INSERT OR UPDATE ON tr_nganhang
    FOR EACH ROW EXECUTE FUNCTION fn_nganhang_isdefault_unique();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
