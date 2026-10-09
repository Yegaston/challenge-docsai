import express, { type ErrorRequestHandler, type Response } from "express";
import { requireUser } from "../../auth/http/controller.js";
import type { AuthService } from "../../auth/services/auth.service.js";
import { TicketError, type TicketsService } from "../services/tickets.service.js";

function sendError(response: Response, error: unknown) {
  if (error instanceof TicketError) {
    response.status(error.kind === "missing" ? 404 : 400).json({
      error: error.kind === "missing" ? "Ticket not found." : "Invalid ticket request.",
    });
  } else {
    response.status(503).json({ error: "Tickets unavailable. Try again." });
  }
}

export function createTicketsRouter(service: TicketsService, auth: AuthService) {
  const router = express.Router();
  router.use((_request, response, next) => {
    response.set("Cache-Control", "no-store");
    next();
  });
  router.use(requireUser(auth));
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
  router.get("/:id", async (request, response) => {
    try {
      response.json({ ticket: await service.detail(response.locals.user.id, request.params.id as string) });
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
