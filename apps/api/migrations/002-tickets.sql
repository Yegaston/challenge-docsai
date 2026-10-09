CREATE TABLE IF NOT EXISTS tickets (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES users(id),
  text text NOT NULL CHECK (char_length(text) BETWEEN 1 AND 20000),
  created_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS tickets_owner_created_id_idx
  ON tickets (owner_id, created_at DESC, id DESC);
