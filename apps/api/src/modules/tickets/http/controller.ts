import express, { type ErrorRequestHandler, type Response } from "express";
import { createAnalysesRouter } from "../../analyses/http/controller.js";
import type { AnalysesService } from "../../analyses/services/analyses.service.js";
import { requireUser } from "../../auth/http/controller.js";
import type { AuthService } from "../../auth/services/auth.service.js";
import { TicketError, type TicketsService } from "../services/tickets.service.js";

function sendError(response: Response, error: unknown) {
  if (error instanceof TicketError) {
    response.status(error.kind === "missing" ? 404 : error.kind === "conflict" ? 409 : 400).json({
      error: error.kind === "missing" ? "Ticket not found." : error.kind === "conflict" ? "Ticket is being analyzed. Try again." : "Invalid ticket request.",
    });
  } else {
    response.status(503).json({ error: "Tickets unavailable. Try again." });
  }
}

export function createTicketsRouter(service: TicketsService, auth: AuthService, analyses?: AnalysesService) {
  const router = express.Router();
  router.use((_request, response, next) => {
    response.set("Cache-Control", "no-store");
    next();
  });
  router.use(requireUser(auth));
  if (analyses) router.use(createAnalysesRouter(analyses));
  // JSON escaping can expand 20,000 UTF-16 characters to roughly 120 KiB.
  router.post("/", express.json({ limit: "128kb", inflate: false }), async (request, response) => {
    try {
      response.status(201).json({ ticket: await service.create(response.locals.user.id, request.body?.text) });
    } catch (error) {
      sendError(response, error);
    }
  });
  router.get("/", async (_request, response) => {
    try {
      response.json({ tickets: await service.list(response.locals.user.id) });
    } catch (error) {
      sendError(response, error);
    }
  });
  router.delete("/:id", async (request, response) => {
    try {
      await service.delete(response.locals.user.id, request.params.id as string);
      response.status(204).end();
    } catch (error) {
      sendError(response, error);
    }
  });
  router.get("/:id", async (request, response) => {
    try {
      const owner = response.locals.user.id;
      const id = request.params.id as string;
      const ticket = await service.detail(owner, id);
      response.json({ ticket: { ...ticket, analyses: analyses ? await analyses.history(owner, id) : [] } });
    } catch (error) {
      sendError(response, error);
    }
  });
  const safeError: ErrorRequestHandler = (error, _request, response, _next) => {
    response.status(error?.type === "entity.too.large" ? 413 : 400).json({ error: "Invalid ticket request." });
  };
  router.use(safeError);
  return router;
}
