-- Deleting a ticket removes its linked conversation and messages; never retain a dangling handoff.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'conversations'::regclass AND conname = 'conversations_ticket_id_fkey') THEN
    ALTER TABLE conversations ADD CONSTRAINT conversations_ticket_id_fkey
      FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE;
  END IF;
END $$;
ALTER TABLE conversation_messages ADD COLUMN IF NOT EXISTS actor_id uuid;
ALTER TABLE conversation_messages ADD COLUMN IF NOT EXISTS idempotency_key uuid;
CREATE UNIQUE INDEX IF NOT EXISTS conversation_human_message_key
  ON conversation_messages(conversation_id, actor_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
