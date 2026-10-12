import express, { type ErrorRequestHandler } from "express";
import { AnalysisError, type AnalysesService } from "../services/analyses.service.js";
import { TicketError } from "../../tickets/services/tickets.service.js";

const failures = {
  invalid: [400, "Invalid analysis request."], missing: [404, "Ticket not found."], limit: [429, "Analysis limit reached. Try later."],
  database: [503, "Analysis storage unavailable. Reload before retrying."],
  timeout: [504, "Analysis timed out."], provider: [502, "Analysis provider failed."],
  invalid_output: [502, "Analysis output was invalid."], unconfigured: [502, "Analysis provider is not configured."],
} as const;
// Mounted only after the tickets router's verified-user middleware.
export function createAnalysesRouter(service: AnalysesService) {
  const router = express.Router();
  router.post("/:id/analyses", express.json({ limit: "16kb", inflate: false }), async (request, response) => {
    try {
      if (request.body !== undefined && (!request.body || Array.isArray(request.body) || typeof request.body !== "object")) {
        throw new AnalysisError("invalid");
      }
      if (request.body === undefined && request.headers["content-length"] && request.headers["content-length"] !== "0") {
        throw new AnalysisError("invalid");
      }
      response.status(201).json({ analysis: await service.analyze(response.locals.user.id, request.params.id as string, request.body?.instruction) });
    } catch (error) {
      if (error instanceof TicketError) {
        const missing = error.kind === "missing";
        response.status(missing ? 404 : 400).json({ code: missing ? "missing" : "invalid", error: missing ? "Ticket not found." : "Invalid analysis request." });
      } else {
        const failure = error instanceof AnalysisError ? error : new AnalysisError("database");
        const [status, message] = failures[failure.kind];
        response.status(status).json({ error: message, code: failure.kind, ...(failure.analysis ? { analysis: failure.analysis } : {}) });
      }
    }
  });
  const safeError: ErrorRequestHandler = (_error, _request, response, _next) => {
    response.status(400).json({ error: failures.invalid[1], code: "invalid" });
  };
  router.use("/:id/analyses", safeError);
  return router;
}
