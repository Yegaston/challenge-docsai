export type TicketRecord = { id: string; text: string; created_at: Date };
export type TicketRow = TicketRecord & { owner_id: string };
export type Tickets = {
  insert(ticket: TicketRow): Promise<TicketRecord>;
  list(owner: string): Promise<TicketRecord[]>;
  byId(id: string, owner: string): Promise<TicketRecord | undefined>;
};
type Database = { query(sql: string, values?: unknown[]): Promise<{ rows: TicketRecord[] }> };

export function createTickets(database: Database): Tickets {
  return {
    async insert(ticket) {
      const result = await database.query(
        "INSERT INTO tickets (id, owner_id, text, created_at) VALUES ($1, $2, $3, $4) RETURNING id, text, created_at",
        [ticket.id, ticket.owner_id, ticket.text, ticket.created_at],
      );
      return result.rows[0];
    },
    async list(owner) {
      return (await database.query(
        "SELECT id, text, created_at FROM tickets WHERE owner_id = $1 ORDER BY created_at DESC, id DESC", [owner],
      )).rows;
    },
    async byId(id, owner) {
      return (await database.query(
        "SELECT id, text, created_at FROM tickets WHERE id = $1 AND owner_id = $2", [id, owner],
      )).rows[0];
    },
  };
}
