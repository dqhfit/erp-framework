-- Thêm cột share_token cho tính năng chia sẻ công khai (link không cần đăng nhập).
-- visibility mở rộng thêm "private" (chỉ người tạo) và "public" (ai có link đều xem).
ALTER TABLE knowledge_sources
  ADD COLUMN IF NOT EXISTS share_token uuid;

CREATE UNIQUE INDEX IF NOT EXISTS knowledge_sources_share_token_idx
  ON knowledge_sources (share_token)
  WHERE share_token IS NOT NULL;
