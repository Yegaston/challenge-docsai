import { randomUUID } from "node:crypto";
import type { Analyses, AnalysisRecord } from "../repositories/analyses.repository.js";
import type { TicketsService } from "../../tickets/services/tickets.service.js";
import { AnalysisError } from "../utils/errors.js";
import { ProviderFailure, type AnalysisProvider } from "../utils/provider.js";
import { PROMPT_VERSION } from "../utils/prompt.js";
import { outputSchema } from "../utils/output.js";
export { AnalysisError } from "../utils/errors.js";

export function publicAnalysis(row: AnalysisRecord) {
  return {
    id: row.id, status: row.status, model: row.model, promptVersion: row.prompt_version,
    instruction: row.instruction, createdAt: row.created_at.toISOString(),
    completedAt: row.completed_at?.toISOString() ?? null,
    summary: row.summary, category: row.category, uncertaintyNote: row.uncertainty_note,
    failureCode: row.failure_code,
  };
}
export type AnalysesService = ReturnType<typeof createAnalysesService>;
export function createAnalysesService(repository: Analyses, tickets: Pick<TicketsService, "detail">, provider: AnalysisProvider) {
  return {
    async history(owner: string, ticket: string) {
      return (await repository.history(owner, ticket)).map(publicAnalysis);
    },
    async analyze(owner: string, ticketId: string, input: unknown) {
      let instruction: string | null = null;
      if (input !== undefined) {
        if (typeof input !== "string") throw new AnalysisError("invalid");
        instruction = input.trim();
        if (!instruction || instruction.length > 2000 || instruction.includes("\u0000")) throw new AnalysisError("invalid");
      }
      const ticket = await tickets.detail(owner, ticketId);
      let row: AnalysisRecord = {
        id: randomUUID(), ticket_id: ticketId, owner_id: owner, status: "running",
        model: provider.model, prompt_version: PROMPT_VERSION, instruction,
        created_at: new Date(), completed_at: null, failure_code: null,
        summary: null, category: null, uncertainty_note: null,
      };
      let lease;
      try { lease = await repository.start(row); }
      catch (error) { throw error instanceof AnalysisError ? error : new AnalysisError("database"); }
      try {
        try {
          const output = outputSchema.safeParse(await provider.generate(ticket.text, instruction));
          if (!output.success) throw new ProviderFailure("invalid_output");
          row = { ...row, status: "succeeded", summary: output.data.summary, category: output.data.category,
            uncertainty_note: output.data.uncertaintyNote, completed_at: new Date() };
        } catch (error) {
          row = { ...row, status: "failed", completed_at: new Date(),
            failure_code: error instanceof ProviderFailure ? error.code : "provider" };
        }
        try { row = await lease.finish(row); }
        catch { throw new AnalysisError("database"); }
        const analysis = publicAnalysis(row);
        if (row.failure_code) throw new AnalysisError(row.failure_code, analysis);
        return analysis;
      } finally {
        try { await lease.release(); } catch { throw new AnalysisError("database"); }
      }
    },
  };
}
