-- 0092_chat_attachments.sql - Dinh kem file cho tin nhan chat.
-- attachments: jsonb mang [{url, name, mime, size}]. Tai dung endpoint
-- /upload/file (luu UPLOAD_DIR/doc/<companyId>, URL ky HMAC dang /f/<token>).
-- Tin nhan co the chi co dinh kem (body rong).

ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS attachments jsonb;
