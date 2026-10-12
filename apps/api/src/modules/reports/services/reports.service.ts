import type { createReportsRepository } from "../repositories/reports.repository.js";

export class ReportError extends Error {
  constructor(public readonly kind: "invalid" | "missing" | "conflict") { super(kind); }
}
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
function validateId(id: string) { if (!uuid.test(id)) throw new ReportError("invalid"); }
function publicReport(row: { id: string; ticket_id: string; analysis_id: string; explanation: string; status: "open" | "reviewed"; created_at: Date }) {
  return { id: row.id, ticketId: row.ticket_id, analysisId: row.analysis_id, explanation: row.explanation,
    status: row.status, createdAt: row.created_at.toISOString(), reviewMode: "same_user_demo" as const };
}
function publicCorrection(row: { id: string; report_id: string; analysis_id: string; correction: string; created_at: Date }) {
  return { id: row.id, reportId: row.report_id, analysisId: row.analysis_id, correction: row.correction,
    createdAt: row.created_at.toISOString(), reviewMode: "same_user_demo" as const };
}
export function createReportsService(repository: ReturnType<typeof createReportsRepository>) {
  return {
    async appendCorrection(owner: string, ticket: string, report: string, input: unknown) {
      validateId(ticket); validateId(report);
      if (typeof input !== "string" || !input.trim() || input.length > 2000 || input.includes("\u0000")) throw new ReportError("invalid");
      const row = await repository.appendCorrection(owner, ticket, report, input.trim());
      if (!row) throw new ReportError("missing");
      return publicCorrection(row);
    },
    async listCorrections(owner: string, ticket: string, report: string) {
      validateId(ticket); validateId(report);
      const rows = await repository.listCorrections(owner, ticket, report);
      if (!rows) throw new ReportError("missing");
      return rows.map(publicCorrection);
    },
    async create(owner: string, ticket: string, analysis: string, input: unknown) {
      validateId(ticket); validateId(analysis);
      if (typeof input !== "string" || !input.trim() || input.length > 2000 || input.includes("\u0000")) throw new ReportError("invalid");
      try {
        const row = await repository.create(owner, ticket, analysis, input.trim());
        if (!row) throw new ReportError("missing");
        return publicReport(row);
      } catch (error) {
        if ((error as { code?: string })?.code === "23505") throw new ReportError("conflict");
        throw error;
      }
    },
    async list(owner: string, ticket: string) {
      validateId(ticket);
      const rows = await repository.list(owner, ticket);
      if (!rows) throw new ReportError("missing");
      return rows.map(publicReport);
    },
  };
}
export type ReportsService = ReturnType<typeof createReportsService>;
