import type { Pool } from "pg";

export type AuditEvent =
  | { kind: "ticket_list"; ownerId: string }
  | { kind: "ticket_detail" | "ticket_deleted"; ownerId: string; ticketId: string }
  | { kind: "analysis_started" | "analysis_succeeded" | "wrong_answer_reported"; ownerId: string; ticketId: string; analysisId: string }
  | { kind: "analysis_failed"; ownerId: string; ticketId: string; analysisId: string; failureCode: "timeout" | "provider" | "invalid_output" | "unconfigured" };

export type AuditRepository = { insert(event: AuditEvent): Promise<void> };

export function createAuditRepository(database: Pick<Pool, "query">): AuditRepository {
  return {
    async insert(event) {
      await database.query(
        "INSERT INTO audit_events (owner_id, ticket_id, kind, analysis_id, failure_code) VALUES ($1, $2, $3, $4, $5)",
        [event.ownerId, "ticketId" in event ? event.ticketId : null, event.kind,
          "analysisId" in event ? event.analysisId : null, "failureCode" in event ? event.failureCode : null],
      );
    },
  };
}
