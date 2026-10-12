import express from "express";
import type { AuditService } from "../../audit/services/audit.service.js";
import { ReportError, type ReportsService } from "../services/reports.service.js";

export function createReportsRouter(service: ReportsService, audit?: AuditService) {
  const router = express.Router();
  function fail(response: express.Response, error: unknown) {
    const kind = error instanceof ReportError ? error.kind : "database";
    response.status(kind === "invalid" ? 400 : kind === "missing" ? 404 : kind === "conflict" ? 409 : 503)
      .json({ error: kind === "invalid" ? "Invalid report request." : kind === "missing" ? "Ticket not found." : kind === "conflict" ? "Report already exists." : "Reports unavailable. Try again." });
  }
  router.post("/:id/analyses/:analysisId/reports", express.json({ limit: "8kb", inflate: false }), async (request, response) => {
    try {
      const ownerId = response.locals.user.id;
      const ticketId = request.params.id as string, analysisId = request.params.analysisId as string;
      const report = await service.create(ownerId, ticketId, analysisId, request.body?.explanation);
      response.status(201).json({ report });
      void audit?.record({ kind: "wrong_answer_reported", ownerId, ticketId, analysisId });
    } catch (error) { fail(response, error); }
  });
  router.get("/:id/reports", async (request, response) => {
    try { response.json({ reports: await service.list(response.locals.user.id, request.params.id as string) }); }
    catch (error) { fail(response, error); }
  });
  return router;
}
