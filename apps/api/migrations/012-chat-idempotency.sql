CREATE TABLE IF NOT EXISTS chat_send_claims (
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL,
  request_key uuid NOT NULL,
  request_hash text NOT NULL,
  state text NOT NULL CHECK (state IN ('pending', 'done', 'failed')),
  response jsonb,
  PRIMARY KEY (owner_id, conversation_id, request_key)
);
CREATE TABLE IF NOT EXISTS chat_send_limits (
  owner_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  last_at timestamptz NOT NULL
);
