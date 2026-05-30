-- Migration 0053: luu lich su tro chuyen voi Agent (per-user, co the xoa)
-- agent_conversations: 1 cuoc tro chuyen cua 1 user (kem agent dang gan).
-- agent_messages: cac tin nhan (role user/assistant) thuoc cuoc tro chuyen.
-- Xoa conversation -> cascade xoa messages. Xoa user/company -> cascade.

CREATE TABLE IF NOT EXISTS agent_conversations (
  id          uuid PRIMARY KEY DEFAULT uuidv7(),
  company_id  uuid NOT NULL,
  user_id     uuid NOT NULL,
  agent_id    uuid,
  title       text NOT NULL DEFAULT 'Cuoc tro chuyen',
  created_at  timestamp NOT NULL DEFAULT now(),
  updated_at  timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agent_messages (
  id               uuid PRIMARY KEY DEFAULT uuidv7(),
  conversation_id  uuid NOT NULL,
  role             text NOT NULL,
  content          text NOT NULL,
  created_at       timestamp NOT NULL DEFAULT now()
);

-- FK idempotent.
DO $$ BEGIN
  ALTER TABLE agent_conversations
    ADD CONSTRAINT agent_conversations_company_id_companies_id_fk
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE agent_conversations
    ADD CONSTRAINT agent_conversations_user_id_users_id_fk
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE agent_conversations
    ADD CONSTRAINT agent_conversations_agent_id_agents_id_fk
    FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE agent_messages
    ADD CONSTRAINT agent_messages_conversation_id_agent_conversations_id_fk
    FOREIGN KEY (conversation_id) REFERENCES agent_conversations(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS agent_conversations_user_idx
  ON agent_conversations (company_id, user_id, updated_at);
CREATE INDEX IF NOT EXISTS agent_messages_conv_idx
  ON agent_messages (conversation_id, created_at);
