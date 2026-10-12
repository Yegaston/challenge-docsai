import type { Tickets, RetentionCursor } from "../repositories/tickets.repository.js";

/** Cursor moves past conflicts too; the next pass retries them after wraparound. */
export function createTicketRetentionService(repository: Pick<Tickets, "selectExpired" | "delete" | "expiredCount">, batchSize = 100) {
  let cursor: RetentionCursor | undefined;
  return {
    async sweep(shouldStop: () => boolean = () => false) {
      const rows = await repository.selectExpired(cursor, batchSize);
      let deleted = 0;
      let conflicts = 0;
      let stoppedEarly = false;
      for (const row of rows) {
        if (shouldStop()) { stoppedEarly = true; break; }
        // Only confirmed outcomes advance: a thrown database error must retry this row.
        const outcome = await repository.delete(row.id, row.owner_id);
        cursor = { cursor_created_at: row.cursor_created_at, id: row.id };
        if (outcome === "deleted") deleted++;
        if (outcome === "conflict") conflicts++;
      }
      if (!stoppedEarly && rows.length < batchSize) cursor = undefined;
      return { deleted, conflicts, backlog: await repository.expiredCount() };
    },
  };
}
