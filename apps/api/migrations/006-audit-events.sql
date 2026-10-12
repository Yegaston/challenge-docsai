CREATE TABLE IF NOT EXISTS audit_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES users(id),
  ticket_id uuid,
  kind varchar(32) NOT NULL CHECK (kind IN ('ticket_list', 'ticket_detail', 'ticket_deleted')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT audit_ticket_shape CHECK (
    (kind = 'ticket_list' AND ticket_id IS NULL) OR
    (kind IN ('ticket_detail', 'ticket_deleted') AND ticket_id IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS audit_events_owner_id_created_at_idx ON audit_events (owner_id, created_at DESC, id DESC);
