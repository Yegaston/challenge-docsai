CREATE UNIQUE INDEX IF NOT EXISTS wrong_answer_reports_id_owner_idx ON wrong_answer_reports (id, owner_id);
CREATE TABLE IF NOT EXISTS report_corrections (
  id uuid PRIMARY KEY,
  report_id uuid NOT NULL,
  owner_id uuid NOT NULL,
  correction text NOT NULL CHECK (char_length(btrim(correction)) BETWEEN 1 AND 2000),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (report_id, owner_id) REFERENCES wrong_answer_reports(id, owner_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS report_corrections_history_idx ON report_corrections (report_id, owner_id, created_at, id);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'report_review_status_shape' AND conrelid = 'wrong_answer_reports'::regclass) THEN
    ALTER TABLE wrong_answer_reports DROP CONSTRAINT wrong_answer_reports_status_check;
    ALTER TABLE wrong_answer_reports ADD CONSTRAINT report_review_status_shape CHECK (status IN ('open', 'reviewed'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'audit_review_shape' AND conrelid = 'audit_events'::regclass) THEN
    ALTER TABLE audit_events DROP CONSTRAINT audit_ticket_shape;
    ALTER TABLE audit_events ADD CONSTRAINT audit_ticket_shape CHECK (
      (kind = 'ticket_list' AND ticket_id IS NULL AND analysis_id IS NULL AND failure_code IS NULL) OR
      (kind IN ('ticket_detail', 'ticket_deleted') AND ticket_id IS NOT NULL AND analysis_id IS NULL AND failure_code IS NULL) OR
      (kind IN ('analysis_started', 'analysis_succeeded', 'wrong_answer_reported', 'wrong_answer_reviewed') AND ticket_id IS NOT NULL AND analysis_id IS NOT NULL AND failure_code IS NULL) OR
      (kind = 'analysis_failed' AND ticket_id IS NOT NULL AND analysis_id IS NOT NULL AND failure_code IN ('timeout', 'provider', 'invalid_output', 'unconfigured'))
    );
    ALTER TABLE audit_events DROP CONSTRAINT audit_report_shape;
    ALTER TABLE audit_events ADD CONSTRAINT audit_report_shape CHECK (kind IN (
      'ticket_list', 'ticket_detail', 'ticket_deleted', 'analysis_started', 'analysis_succeeded', 'analysis_failed', 'wrong_answer_reported', 'wrong_answer_reviewed'));
    ALTER TABLE audit_events ADD CONSTRAINT audit_review_shape CHECK (kind IN (
      'ticket_list', 'ticket_detail', 'ticket_deleted', 'analysis_started', 'analysis_succeeded', 'analysis_failed', 'wrong_answer_reported', 'wrong_answer_reviewed'));
  END IF;
END $$;
