CREATE TABLE IF NOT EXISTS wrong_answer_reports (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES users(id),
  ticket_id uuid NOT NULL,
  analysis_id uuid NOT NULL REFERENCES analyses(id) ON DELETE CASCADE,
  explanation text NOT NULL CHECK (char_length(btrim(explanation)) BETWEEN 1 AND 2000),
  status text NOT NULL DEFAULT 'open' CHECK (status = 'open'),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (owner_id, analysis_id)
);
CREATE INDEX IF NOT EXISTS wrong_answer_reports_ticket_idx ON wrong_answer_reports (owner_id, ticket_id, created_at);
-- Upgrade the existing fixed vocabulary and its metadata shape once; never alter 006/007.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'audit_report_shape' AND conrelid = 'audit_events'::regclass) THEN
    ALTER TABLE audit_events DROP CONSTRAINT audit_ticket_shape;
    ALTER TABLE audit_events ADD CONSTRAINT audit_ticket_shape CHECK (
      (kind = 'ticket_list' AND ticket_id IS NULL AND analysis_id IS NULL AND failure_code IS NULL) OR
      (kind IN ('ticket_detail', 'ticket_deleted') AND ticket_id IS NOT NULL AND analysis_id IS NULL AND failure_code IS NULL) OR
      (kind IN ('analysis_started', 'analysis_succeeded', 'wrong_answer_reported') AND ticket_id IS NOT NULL AND analysis_id IS NOT NULL AND failure_code IS NULL) OR
      (kind = 'analysis_failed' AND ticket_id IS NOT NULL AND analysis_id IS NOT NULL AND failure_code IN ('timeout', 'provider', 'invalid_output', 'unconfigured'))
    );
    ALTER TABLE audit_events DROP CONSTRAINT audit_analysis_shape;
    ALTER TABLE audit_events ADD CONSTRAINT audit_report_shape CHECK (kind IN (
      'ticket_list', 'ticket_detail', 'ticket_deleted', 'analysis_started', 'analysis_succeeded', 'analysis_failed', 'wrong_answer_reported'));
  END IF;
END $$;
