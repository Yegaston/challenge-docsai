-- 006 remains immutable. Only upgrade the shape constraint once; avoid scanning old rows on restart.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'audit_analysis_shape' AND conrelid = 'audit_events'::regclass) THEN
    ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS analysis_id uuid;
    ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS failure_code varchar(32);
    ALTER TABLE audit_events DROP CONSTRAINT audit_ticket_shape;
    ALTER TABLE audit_events ADD CONSTRAINT audit_ticket_shape CHECK (
      (kind = 'ticket_list' AND ticket_id IS NULL AND analysis_id IS NULL AND failure_code IS NULL) OR
      (kind IN ('ticket_detail', 'ticket_deleted') AND ticket_id IS NOT NULL AND analysis_id IS NULL AND failure_code IS NULL) OR
      (kind IN ('analysis_started', 'analysis_succeeded') AND ticket_id IS NOT NULL AND analysis_id IS NOT NULL AND failure_code IS NULL) OR
      (kind = 'analysis_failed' AND ticket_id IS NOT NULL AND analysis_id IS NOT NULL AND failure_code IN ('timeout', 'provider', 'invalid_output', 'unconfigured'))
    );
    ALTER TABLE audit_events DROP CONSTRAINT audit_events_kind_check;
    ALTER TABLE audit_events ADD CONSTRAINT audit_analysis_shape CHECK (kind IN (
      'ticket_list', 'ticket_detail', 'ticket_deleted', 'analysis_started', 'analysis_succeeded', 'analysis_failed'));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS audit_events_created_at_id_idx ON audit_events (created_at, id);
