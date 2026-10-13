ALTER TABLE synthetic_transfers ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE synthetic_transfers ADD COLUMN IF NOT EXISTS idempotency_key uuid;
CREATE UNIQUE INDEX IF NOT EXISTS synthetic_transfers_owner_key ON synthetic_transfers(owner_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS synthetic_transfers_owner_recent ON synthetic_transfers(owner_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS synthetic_transfers_purge ON synthetic_transfers(created_at, id);
