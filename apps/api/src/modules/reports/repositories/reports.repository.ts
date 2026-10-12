import { randomUUID } from "node:crypto";
import type { Pool } from "pg";

export type Report = { id: string; ticket_id: string; analysis_id: string; explanation: string; status: "open" | "reviewed"; created_at: Date };
export type Correction = { id: string; report_id: string; analysis_id: string; correction: string; created_at: Date };
type Database = Pick<Pool, "query">;
export function createReportsRepository(database: Database) {
  return {
    async appendCorrection(owner: string, ticket: string, report: string, correction: string): Promise<Correction | undefined> {
      const result = await database.query<Correction>(`
        WITH eligible AS (
          SELECT r.id FROM wrong_answer_reports r JOIN tickets t ON t.id = r.ticket_id
          WHERE r.id = $3 AND r.ticket_id = $2 AND r.owner_id = $1 AND t.owner_id = $1
            AND t.created_at > clock_timestamp() - INTERVAL '90 days' FOR UPDATE OF r
        ), inserted AS (
          INSERT INTO report_corrections (id, report_id, owner_id, correction)
          SELECT $4, id, $1, $5 FROM eligible
          RETURNING id, report_id, correction, created_at
        ), reviewed AS (
          UPDATE wrong_answer_reports SET status = 'reviewed' WHERE id IN (SELECT report_id FROM inserted)
        ) SELECT inserted.*, r.analysis_id FROM inserted JOIN wrong_answer_reports r ON r.id = inserted.report_id`, [owner, ticket, report, randomUUID(), correction]);
      return result.rows[0];
    },
    async listCorrections(owner: string, ticket: string, report: string): Promise<Correction[] | undefined> {
      const result = await database.query<Correction & { found: boolean }>(`
        SELECT c.id, c.report_id, r.analysis_id, c.correction, c.created_at
        FROM wrong_answer_reports r JOIN tickets t ON t.id = r.ticket_id
        LEFT JOIN report_corrections c ON c.report_id = r.id AND c.owner_id = $1
        WHERE r.id = $3 AND r.ticket_id = $2 AND r.owner_id = $1 AND t.owner_id = $1
          AND t.created_at > clock_timestamp() - INTERVAL '90 days'
        ORDER BY c.created_at, c.id`, [owner, ticket, report]);
      return result.rows.length ? result.rows.filter(row => row.id !== null) : undefined;
    },
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
