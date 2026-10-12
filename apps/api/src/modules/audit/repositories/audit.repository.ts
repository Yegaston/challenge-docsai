import type { Pool } from "pg";

export type AuditEvent =
  | { kind: "ticket_list"; ownerId: string }
  | { kind: "ticket_detail" | "ticket_deleted"; ownerId: string; ticketId: string };

export type AuditRepository = { insert(event: AuditEvent): Promise<void> };

export function createAuditRepository(database: Pick<Pool, "query">): AuditRepository {
  return {
    async insert(event) {
      await database.query(
        "INSERT INTO audit_events (owner_id, ticket_id, kind) VALUES ($1, $2, $3)",
        [event.ownerId, "ticketId" in event ? event.ticketId : null, event.kind],
      );
    },
  };
}
