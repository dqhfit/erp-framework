/* 0032_pgcrypto.sql — Native column encryption qua pgcrypto.
   Bổ sung cho app-layer encryption (S8 crypto.ts) — caller có thể chọn
   layer nào tuỳ workload. pgcrypto: tốc độ cao hơn cho large data,
   không cần round-trip qua Node. App-layer: portable hơn (không cần
   extension), key mgmt linh hoạt hơn. */

CREATE EXTENSION IF NOT EXISTS pgcrypto;
--> statement-breakpoint

/* Helper function — wrap pgp_sym_encrypt với key derived từ
   pgsetting hoặc tham số. Caller pass key qua second arg.
   Trả NULL khi input rỗng. */
CREATE OR REPLACE FUNCTION erp_encrypt(plain text, encryption_key text)
RETURNS text AS $$
BEGIN
  IF plain IS NULL OR plain = '' THEN RETURN NULL; END IF;
  RETURN encode(pgp_sym_encrypt(plain, encryption_key), 'base64');
END;
$$ LANGUAGE plpgsql IMMUTABLE;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION erp_decrypt(cipher text, encryption_key text)
RETURNS text AS $$
BEGIN
  IF cipher IS NULL OR cipher = '' THEN RETURN NULL; END IF;
  RETURN pgp_sym_decrypt(decode(cipher, 'base64'), encryption_key);
EXCEPTION WHEN OTHERS THEN
  -- Sai key hoặc data corrupted → trả NULL để không leak info.
  RETURN NULL;
END;
$$ LANGUAGE plpgsql IMMUTABLE;
