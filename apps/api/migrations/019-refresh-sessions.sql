CREATE TABLE IF NOT EXISTS refresh_sessions (
  secret_hash text PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS refresh_sessions_expiry_idx ON refresh_sessions (expires_at);
CREATE INDEX IF NOT EXISTS refresh_sessions_owner_idx ON refresh_sessions (owner_id, created_at);
