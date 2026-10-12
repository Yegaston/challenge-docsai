CREATE TABLE IF NOT EXISTS synthetic_transfers (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  transfer_date date NOT NULL,
  status text NOT NULL CHECK (status IN ('pending', 'completed', 'failed'))
);
CREATE INDEX IF NOT EXISTS synthetic_transfers_owner_search ON synthetic_transfers(owner_id, transfer_date, amount);
