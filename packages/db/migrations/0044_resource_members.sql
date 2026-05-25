-- 0044_resource_members.sql — Generic per-resource membership table.
-- Mục đích: pattern "user là member của resource X" áp dụng cho mọi
-- loại (agent hiện tại, page/record sau này) qua 1 bảng duy nhất thay
-- vì mỗi resource có 1 bảng riêng.
--
-- Schema:
--  resource_type : "agent" | "page" | "record" | ...
--  resource_id   : UUID của resource (KHÔNG FK — vì refer nhiều bảng;
--                  cleanup khi xoá resource: tự app delete)
--  user_id       : FK users(id) ON DELETE CASCADE (user xoá → xoá tất cả)
--  role          : "owner" | "operator" | "observer" (chuỗi tự do để
--                  resource_type khác sau này dùng role khác)
--  added_by      : user thêm
--  added_at      : timestamp
--
-- BACKFILL: copy agent_members hiện có sang resource_members với
-- resource_type='agent'. KHÔNG drop agent_members ở migration này —
-- backward-compat 1 sprint, P2.4 sẽ refactor code đọc/ghi sang đây.

CREATE TABLE IF NOT EXISTS resource_members (
  resource_type text NOT NULL,
  resource_id   uuid NOT NULL,
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role          text NOT NULL,
  added_by      uuid NOT NULL REFERENCES users(id),
  added_at      timestamp NOT NULL DEFAULT now(),
  PRIMARY KEY (resource_type, resource_id, user_id)
);

CREATE INDEX IF NOT EXISTS resource_members_user_idx
  ON resource_members(user_id);
CREATE INDEX IF NOT EXISTS resource_members_resource_idx
  ON resource_members(resource_type, resource_id);

-- Backfill từ agent_members. ON CONFLICT vì migration có thể chạy lại.
INSERT INTO resource_members (
  resource_type, resource_id, user_id, role, added_by, added_at
)
SELECT 'agent', agent_id, user_id, role::text, added_by, added_at
  FROM agent_members
ON CONFLICT DO NOTHING;
