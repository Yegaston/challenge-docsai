import express from "express";
import { requireUser } from "../../auth/http/controller.js";
import type { AuthService } from "../../auth/services/auth.service.js";
import { ConversationError, type ConversationsService } from "../services/conversations.service.js";

export function createConversationsRouter(service: ConversationsService, auth: AuthService) {
  const router = express.Router();
  router.use((_request, response, next) => { response.set("Cache-Control", "no-store"); next(); });
  router.use(requireUser(auth));
  router.post("/", express.json({ limit: "24kb", inflate: false }), async (request, response) => {
    try { response.status(201).json(await service.create(response.locals.user, request.body)); }
    catch (error) { sendError(response, error); }
  });
  router.get("/", async (_request, response) => {
    try { response.json({ conversations: await service.list(response.locals.user) }); }
    catch (error) { sendError(response, error); }
  });
  router.get("/:id", async (request, response) => {
    try { response.json(await service.detail(response.locals.user, request.params.id as string)); }
    catch (error) { sendError(response, error); }
  });
  router.use(((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
    response.status(400).json({ error: "Invalid conversation request." });
  }) as express.ErrorRequestHandler);
  return router;
}

function sendError(response: express.Response, error: unknown) {
  if (error instanceof ConversationError) {
    response.status(error.kind === "invalid" ? 400 : error.kind === "forbidden" ? 403 : 404).json({ error: error.kind });
  } else response.status(503).json({ error: "Conversation unavailable." });
}
