-- Replace the original composite FK on existing volumes as well as fresh databases.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'analyses'::regclass AND conname = 'analyses_ticket_id_owner_id_fkey'
      AND confdeltype <> 'c'
  ) THEN
    ALTER TABLE analyses DROP CONSTRAINT analyses_ticket_id_owner_id_fkey;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'analyses'::regclass AND conname = 'analyses_ticket_id_owner_id_fkey'
  ) THEN
    ALTER TABLE analyses ADD CONSTRAINT analyses_ticket_id_owner_id_fkey
      FOREIGN KEY (ticket_id, owner_id) REFERENCES tickets(id, owner_id) ON DELETE CASCADE;
  END IF;
END $$;
