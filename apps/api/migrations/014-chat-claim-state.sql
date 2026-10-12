-- Replace the original named CHECK on both existing volumes and fresh installs.
ALTER TABLE chat_send_claims DROP CONSTRAINT IF EXISTS chat_send_claims_state_check;
ALTER TABLE chat_send_claims ADD CONSTRAINT chat_send_claims_state_check
  CHECK (state IN ('pending', 'done', 'failed', 'outcome_unknown'));
