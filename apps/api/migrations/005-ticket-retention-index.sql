CREATE INDEX IF NOT EXISTS tickets_retention_cursor_idx ON tickets (created_at, id);
