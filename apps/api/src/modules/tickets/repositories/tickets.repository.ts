import type { Pool, QueryResultRow } from "pg";

export type TicketRecord = { id: string; text: string; created_at: Date };
export type TicketRow = TicketRecord & { owner_id: string };
export type ExpiredTicket = Pick<TicketRow, "id" | "owner_id"> & { cursor_created_at: string };
export type RetentionCursor = Pick<ExpiredTicket, "id" | "cursor_created_at">;
export type Tickets = {
  selectExpired(cursor: RetentionCursor | undefined, limit: number): Promise<ExpiredTicket[]>;
  expiredCount(): Promise<number>;
  insert(ticket: TicketRow): Promise<TicketRecord>;
  list(owner: string): Promise<TicketRecord[]>;
  byId(id: string, owner: string): Promise<TicketRecord | undefined>;
  delete(id: string, owner: string): Promise<"deleted" | "missing" | "conflict">;
};
type Database = Pick<Pool, "query"> & Partial<Pick<Pool, "connect">>;

export function createTickets(database: Database): Tickets {
  return {
    async selectExpired(cursor, limit) {
      return (await database.query(
        "SELECT id, owner_id, created_at::text AS cursor_created_at FROM tickets WHERE created_at <= clock_timestamp() - interval '90 days' AND ($1::timestamptz IS NULL OR (created_at, id) > ($1::timestamptz, $2)) ORDER BY created_at, id LIMIT $3",
        [cursor?.cursor_created_at ?? null, cursor?.id ?? null, limit],
      )).rows;
    },
    async expiredCount() {
      const result = await database.query("SELECT count(*) AS count FROM tickets WHERE created_at <= clock_timestamp() - interval '90 days'");
      return Number(result.rows[0].count);
    },
    async delete(id, owner) {
      if (!database.connect) throw new Error("Database connection unavailable");
      const client = await database.connect();
      let broken = false;
      let started = false;
      const onError = () => { broken = true; };
      client.on("error", onError);
      const query = async <T extends QueryResultRow>(sql: string, values: unknown[] = []) => {
        if (broken) throw new Error("Database unavailable");
        try {
          const result = await client.query<T>(sql, values);
          if (broken) throw new Error("Database unavailable");
          return result;
        } catch (error) { broken = true; throw error; }
      };
      try {
        await query("BEGIN");
        started = true;
        const lock = await query<{ locked: boolean }>(
          "SELECT pg_try_advisory_xact_lock(hashtextextended($1, 0)) AS locked", [owner]);
        if (!lock.rows[0]?.locked) {
          await query("ROLLBACK");
          started = false;
          return "conflict";
        }
        const deleted = await query<{ id: string }>(
          "DELETE FROM tickets WHERE id=$1 AND owner_id=$2 RETURNING id", [id, owner]);
        await query("COMMIT");
        started = false;
        return deleted.rows.length ? "deleted" : "missing";
      } catch (error) {
        if (started && !broken) {
          try { await query("ROLLBACK"); } catch { broken = true; }
        }
        throw error;
      } finally {
        try { if (broken) client.release(true); else client.release(); }
        catch { broken = true; throw new Error("Database unavailable"); }
        if (!broken) client.removeListener("error", onError);
      }
    },
    async insert(ticket) {
      const result = await database.query(
        "INSERT INTO tickets (id, owner_id, text, created_at) VALUES ($1, $2, $3, $4) RETURNING id, text, created_at",
        [ticket.id, ticket.owner_id, ticket.text, ticket.created_at],
      );
      return result.rows[0];
    },
    async list(owner) {
      return (await database.query(
        "SELECT id, text, created_at FROM tickets WHERE owner_id = $1 AND created_at > clock_timestamp() - interval '90 days' ORDER BY created_at DESC, id DESC", [owner],
      )).rows;
    },
    async byId(id, owner) {
      return (await database.query(
        "SELECT id, text, created_at FROM tickets WHERE id = $1 AND owner_id = $2 AND created_at > clock_timestamp() - interval '90 days'", [id, owner],
      )).rows[0];
    },
  };
}
