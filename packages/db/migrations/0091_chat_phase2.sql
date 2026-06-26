-- 0091_chat_phase2.sql - Chat noi bo Phase 2: sua tin + reaction.
-- edited_at: moc sua tin nhan (null = chua sua). Xoa mem dung deleted_at (da co).
-- chat_message_reactions: tha cam xuc emoji len tin nhan (toggle theo user+emoji).

ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS edited_at timestamptz;

CREATE TABLE IF NOT EXISTS chat_message_reactions (
  message_id uuid NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji      text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, user_id, emoji)
);

CREATE INDEX IF NOT EXISTS chat_message_reactions_msg_idx
  ON chat_message_reactions(message_id);
