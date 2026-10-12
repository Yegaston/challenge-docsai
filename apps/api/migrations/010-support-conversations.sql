ALTER TABLE users ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'customer';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_role_check') THEN
    ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('customer', 'support'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS conversations (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES users(id),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'escalated', 'resolved')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS conversations_owner_recent ON conversations(owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS conversations_support_recent ON conversations(created_at DESC) WHERE status = 'escalated';

CREATE TABLE IF NOT EXISTS conversation_messages (
  id uuid PRIMARY KEY,
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_role text NOT NULL CHECK (sender_role IN ('customer', 'support', 'agent', 'system')),
  text text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS conversation_messages_thread ON conversation_messages(conversation_id, created_at, id);
