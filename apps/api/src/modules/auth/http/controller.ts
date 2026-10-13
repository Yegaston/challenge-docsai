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

const cookieName = "refresh";
function cookieValue(request: express.Request): string {
  const raw = request.get("Cookie") ?? "";
  if (raw.length > 4096) return "";
  const matches = raw.split(";").map((part) => part.trim()).filter((part) => part.startsWith(`${cookieName}=`));
  if (matches.length !== 1) return "";
  const value = matches[0].slice(cookieName.length + 1);
  return /^[A-Za-z0-9_-]{43}$/.test(value) ? value : "";
}
function originAllowed(request: express.Request, externalOrigin?: string): boolean {
  const origin = request.get("Origin");
  const site = request.get("Sec-Fetch-Site");
  if (site && !["same-origin", "none"].includes(site)) return false;
  if (!origin) return true;
  try {
    const url = new URL(origin);
    return url.origin === origin && (origin === `${request.protocol}://${request.get("host")}` || origin === externalOrigin);
  } catch { return false; }
}
export function createAuthRouter(service: AuthService, options: { externalOrigin?: string; production?: boolean } = {}) {
  const router = express.Router();
  router.use((_request, response, next) => {
    response.set("Cache-Control", "no-store");
    next();
  });
  router.use((request, response, next) => {
    if (request.method === "POST" && !originAllowed(request, options.externalOrigin)) {
      response.status(403).json({ error: "Origin not allowed." });
      return;
    }
    next();
  });
  const secure = options.production ?? process.env.NODE_ENV === "production";
  const cookieOptions = (request: express.Request) => ({ httpOnly: true, sameSite: "lax" as const, path: "/api/auth", secure: secure || request.secure });
  const clear = (request: express.Request, response: Response) => response.clearCookie(cookieName, cookieOptions(request));
  router.post("/login", express.json({ limit: "4kb", inflate: false }), async (request, response) => {
    const email = normalizeEmail(request.body?.email);
    const password: unknown = request.body?.password;
    if (!email || !validPassword(password)) {
      response.status(400).json({ error: "Invalid login request." });
      return;
    }
    try {
      const { refreshSecret, ...access } = await service.login(email, password);
      if (refreshSecret) response.cookie(cookieName, refreshSecret, { ...cookieOptions(request), maxAge: 604800000 });
      response.json(access);
    } catch (error) {
      sendError(response, error);
    }
  });
  router.post("/refresh", async (request, response) => {
    try {
      const access = await service.refresh(cookieValue(request));
      response.json(access);
    } catch (error) {
      if (error instanceof AuthError && error.kind === "invalid-session") clear(request, response);
      sendError(response, error);
    }
  });
  router.post("/logout", async (request, response) => {
    const secret = cookieValue(request);
    try { await service.logout(secret); clear(request, response); response.status(204).end(); }
    catch (error) { sendError(response, error); }
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
