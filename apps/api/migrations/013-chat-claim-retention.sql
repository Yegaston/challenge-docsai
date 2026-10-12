ALTER TABLE chat_send_claims ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT clock_timestamp();
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chat_send_claims_conversation_fk') THEN
    ALTER TABLE chat_send_claims ADD CONSTRAINT chat_send_claims_conversation_fk
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS chat_send_limits_last_at_idx ON chat_send_limits(last_at);
