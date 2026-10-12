ALTER TABLE conversations ADD COLUMN IF NOT EXISTS clarification_deadline timestamptz;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS ticket_id uuid;
CREATE UNIQUE INDEX IF NOT EXISTS conversations_ticket_unique ON conversations(ticket_id) WHERE ticket_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS conversations_due_clarification ON conversations(clarification_deadline, id) WHERE status = 'open' AND clarification_deadline IS NOT NULL;
