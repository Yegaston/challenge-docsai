CREATE UNIQUE INDEX IF NOT EXISTS tickets_id_owner_idx ON tickets (id, owner_id);
CREATE TABLE IF NOT EXISTS analyses (
  id uuid PRIMARY KEY,
  ticket_id uuid NOT NULL,
  owner_id uuid NOT NULL REFERENCES users(id),
  FOREIGN KEY (ticket_id, owner_id) REFERENCES tickets(id, owner_id),
  status text NOT NULL CHECK (status IN ('running', 'succeeded', 'failed')),
  model text NOT NULL,
  prompt_version text NOT NULL,
  instruction text CHECK (instruction IS NULL OR char_length(instruction) BETWEEN 1 AND 2000),
  created_at timestamptz NOT NULL,
  completed_at timestamptz,
  summary text CHECK (summary IS NULL OR char_length(summary) BETWEEN 1 AND 2000),
  category text CHECK (category IN ('billing', 'account_access', 'technical_issue', 'other')),
  uncertainty_note text CHECK (uncertainty_note IS NULL OR char_length(uncertainty_note) BETWEEN 1 AND 1000),
  failure_code text CHECK (failure_code IN ('timeout', 'provider', 'invalid_output', 'unconfigured')),
  CHECK (
    (status = 'running' AND completed_at IS NULL AND summary IS NULL AND category IS NULL AND uncertainty_note IS NULL AND failure_code IS NULL)
    OR (status = 'succeeded' AND completed_at IS NOT NULL AND summary IS NOT NULL AND category IS NOT NULL AND failure_code IS NULL)
    OR (status = 'failed' AND completed_at IS NOT NULL AND summary IS NULL AND category IS NULL AND uncertainty_note IS NULL AND failure_code IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS analyses_owner_created_idx ON analyses (owner_id, created_at);
CREATE INDEX IF NOT EXISTS analyses_ticket_created_idx ON analyses (ticket_id, created_at, id);
