-- 0089_chat.sql - Chat noi bo nhan vien (DM 1-1 + nhom).
-- Da tenant theo company_id. Tin nhan nguoi-nguoi, real-time qua ws-hub.
-- Khac agent_conversations (chat voi AI) va record_comments (binh luan).

CREATE TABLE IF NOT EXISTS chat_conversations (
  id         uuid PRIMARY KEY DEFAULT uuidv7(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  kind       text NOT NULL,            -- 'dm' | 'group'
  title      text,                     -- null cho DM (suy ra tu doi phuong)
  dm_key     text,                     -- khoa cap DM (sort 2 userId), null cho nhom
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS chat_conversations_company_idx
  ON chat_conversations(company_id, updated_at);

-- 1 DM duy nhat / cap / cong ty. dm_key null (nhom) khong bi rang buoc
-- (Postgres coi NULL la phan biet trong unique index).
CREATE UNIQUE INDEX IF NOT EXISTS chat_conversations_dm_uniq
  ON chat_conversations(company_id, dm_key);

CREATE TABLE IF NOT EXISTS chat_members (
  conversation_id uuid NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role            text NOT NULL DEFAULT 'member',  -- 'owner' | 'member'
  last_read_at    timestamptz,
  joined_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, user_id)
);

CREATE INDEX IF NOT EXISTS chat_members_user_idx ON chat_members(user_id);

CREATE TABLE IF NOT EXISTS chat_messages (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  conversation_id uuid NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
  company_id      uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  sender_user_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body            text NOT NULL,
  deleted_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS chat_messages_conv_idx
  ON chat_messages(conversation_id, created_at);
