import type { Pool, QueryConfig } from "pg";
const timed = (text: string, values: string[]): QueryConfig => ({ text, values, statement_timeout: 12000 } as QueryConfig);
export type Transfer = { id: string; amount: string; date: string; status: string };
export type TransferLookup = { find(owner: string, amount: string, date: string): Promise<Transfer[]>; status(owner: string, id: string): Promise<Transfer | undefined>; recent?(owner: string, date: string): Promise<Transfer[]> };
export function createTransfers(pool: Pick<Pool, "query">): TransferLookup {
  return {
    async find(owner, amount, date) {
      return (await pool.query<Transfer>(timed("SELECT id, amount::text, transfer_date::text AS date, status FROM synthetic_transfers WHERE owner_id = $1 AND amount = $2 AND transfer_date = $3 ORDER BY id LIMIT 5", [owner, amount, date]))).rows;
    },
    async recent(owner, date) {
      return (await pool.query<Transfer>(timed("SELECT id, amount::text, transfer_date::text AS date, status FROM synthetic_transfers WHERE owner_id = $1 AND transfer_date = $2 ORDER BY id LIMIT 4", [owner, date]))).rows;
    },
    async status(owner, id) {
      return (await pool.query<Transfer>(timed("SELECT id, amount::text, transfer_date::text AS date, status FROM synthetic_transfers WHERE owner_id = $1 AND id = $2", [owner, id]))).rows[0];
    },
  };
}
