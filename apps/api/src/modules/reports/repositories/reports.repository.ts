import { randomUUID } from "node:crypto";
import type { Pool } from "pg";

export type Report = { id: string; ticket_id: string; analysis_id: string; explanation: string; status: "open"; created_at: Date };
type Database = Pick<Pool, "query">;
export function createReportsRepository(database: Database) {
  return {
    async create(owner: string, ticket: string, analysis: string, explanation: string): Promise<Report | undefined> {
      const result = await database.query<Report>(`
        INSERT INTO wrong_answer_reports (id, owner_id, ticket_id, analysis_id, explanation)
        SELECT $1, $2, $3, $4, $5 FROM analyses a JOIN tickets t ON t.id = a.ticket_id
        WHERE a.id = $4 AND a.owner_id = $2 AND a.ticket_id = $3
          AND a.status = 'succeeded' AND t.owner_id = $2
          AND t.created_at > CURRENT_TIMESTAMP - INTERVAL '90 days'
        RETURNING id, ticket_id, analysis_id, explanation, status, created_at`,
      [randomUUID(), owner, ticket, analysis, explanation]);
      return result.rows[0];
    },
    async list(owner: string, ticket: string): Promise<Report[] | undefined> {
      const result = await database.query<Report>(`
        SELECT r.id, r.ticket_id, r.analysis_id, r.explanation, r.status, r.created_at
        FROM tickets t LEFT JOIN wrong_answer_reports r ON r.ticket_id = t.id AND r.owner_id = t.owner_id
        WHERE t.owner_id = $1 AND t.id = $2 AND t.created_at > CURRENT_TIMESTAMP - INTERVAL '90 days'
        ORDER BY r.created_at, r.id`, [owner, ticket]);
      if (!result.rows.length) return undefined;
      return result.rows.filter((row) => row.id !== null);
    },
  };
}
