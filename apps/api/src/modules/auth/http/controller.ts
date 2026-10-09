import express, { type ErrorRequestHandler, type RequestHandler, type Response } from "express";
import { normalizeEmail } from "../../users/services/users.service.js";
import { validPassword } from "../utils/password.js";
import { AuthError, type AuthService } from "../services/auth.service.js";

function sendError(response: Response, error: unknown) {
  if (error instanceof AuthError && error.kind !== "unavailable") {
    response.status(401).json({ error: error.kind === "invalid-credentials"
      ? "Invalid email or password." : "Session invalid or expired. Log in again." });
  } else {
    response.status(503).json({ error: "Authentication unavailable. Try again." });
  }
}

export function requireUser(service: AuthService): RequestHandler {
  return async (request, response, next) => {
    const token = /^Bearer ([^\s]+)$/i.exec(request.get("Authorization") ?? "")?.[1] ?? "";
    try {
      response.locals.user = await service.identity(token);
      next();
    } catch (error) {
      sendError(response, error);
    }
  };
}

export function createAuthRouter(service: AuthService) {
  const router = express.Router();
  router.use((_request, response, next) => {
    response.set("Cache-Control", "no-store");
    next();
  });
  router.post("/login", express.json({ limit: "4kb", inflate: false }), async (request, response) => {
    const email = normalizeEmail(request.body?.email);
    const password: unknown = request.body?.password;
    if (!email || !validPassword(password)) {
      response.status(400).json({ error: "Invalid login request." });
      return;
    }
    try {
      response.json(await service.login(email, password));
    } catch (error) {
      sendError(response, error);
    }
  });
  router.get("/me", requireUser(service), (_request, response) => {
    response.json({ user: response.locals.user });
  });
  const safeError: ErrorRequestHandler = (error, _request, response, _next) => {
    response.status(error?.type === "entity.too.large" ? 413 : 400).json({ error: "Invalid login request." });
  };
  router.use(safeError);
  return router;
}
