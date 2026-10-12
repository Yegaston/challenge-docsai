-- Options are server-authored typed choices; old messages remain valid without choices.
ALTER TABLE conversation_messages ADD COLUMN IF NOT EXISTS options jsonb;
