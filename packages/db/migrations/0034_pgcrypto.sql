/* 0032_pgcrypto.sql -- Native column encryption qua pgcrypto.
   Bo sung cho app-layer encryption (S8 crypto.ts) -- caller co the chon
   layer nao tuy workload. pgcrypto: toc do cao hon cho large data,
   khong can round-trip qua Node. App-layer: portable hon (khong can
   extension), key mgmt linh hoat hon. */

CREATE EXTENSION IF NOT EXISTS pgcrypto;
--> statement-breakpoint

/* Helper function -- wrap pgp_sym_encrypt voi key derived tu
   pgsetting hoac tham so. Caller pass key qua second arg.
   Tra NULL khi input rong. */
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
  -- Sai key hoac data corrupted -> tra NULL de khong leak info.
  RETURN NULL;
END;
$$ LANGUAGE plpgsql IMMUTABLE;
