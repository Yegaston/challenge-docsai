import { randomBytes } from "node:crypto";
import express, { type ErrorRequestHandler, type RequestHandler } from "express";
import { jwtVerify, SignJWT } from "jose";
import { hashPassword, normalizeEmail, validPassword, verifyPassword, type Users } from "./demo-user.js";

const issuer = "support-ticket-api";
const audience = "support-ticket-web";
const lifetime = 900;
const unavailable = { error: "Authentication unavailable. Try again." };
const invalidSession = { error: "Session invalid or expired. Log in again." };

type AuthOptions = { users: Users; secret: string | undefined; now?: () => Date };

export async function createAuth({ users, secret, now = () => new Date() }: AuthOptions) {
  if (!secret || Buffer.byteLength(secret, "utf8") < 32) {
    throw new Error("JWT_SECRET must contain at least 32 bytes. See README.md.");
  }
  const key = new TextEncoder().encode(secret);
  const dummyHash = await hashPassword(randomBytes(32).toString("hex"));
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
      const user = await users.byEmail(email);
      // Perform the same expensive verification even when no account exists.
      const matches = await verifyPassword(password, user?.password_hash ?? dummyHash);
      if (!user || !matches) {
        response.status(401).json({ error: "Invalid email or password." });
        return;
      }
      const issuedAt = Math.floor(now().getTime() / 1000);
      const token = await new SignJWT({})
        .setProtectedHeader({ alg: "HS256", typ: "JWT" })
        .setIssuer(issuer).setAudience(audience).setSubject(user.id)
        .setIssuedAt(issuedAt).setExpirationTime(issuedAt + lifetime).sign(key);
      response.json({ token, expiresAt: (issuedAt + lifetime) * 1000 });
    } catch {
      response.status(503).json(unavailable);
    }
  });

  const requireUser: RequestHandler = async (request, response, next) => {
    const bearer = /^Bearer ([^\s]+)$/i.exec(request.get("Authorization") ?? "")?.[1];
    let subject: string;
    try {
      if (!bearer || bearer.length > 2048) throw new Error("Invalid bearer");
      const { payload } = await jwtVerify(bearer, key, {
        algorithms: ["HS256"], issuer, audience, currentDate: now(),
        requiredClaims: ["sub", "iat", "exp"], maxTokenAge: lifetime,
      });
      if (!payload.sub || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(payload.sub)) {
        throw new Error("Invalid subject");
      }
      subject = payload.sub;
    } catch {
      response.status(401).json(invalidSession);
      return;
    }
    try {
      const user = await users.byId(subject);
      if (!user) {
        response.status(401).json(invalidSession);
        return;
      }
      response.locals.user = { id: user.id, email: user.email };
      next();
    } catch {
      response.status(503).json(unavailable);
    }
  };
  router.get("/me", requireUser, (_request, response) => {
    response.json({ user: response.locals.user });
  });

  const safeError: ErrorRequestHandler = (error, _request, response, _next) => {
    response.status(error?.type === "entity.too.large" ? 413 : 400).json({ error: "Invalid login request." });
  };
  router.use(safeError);
  return router;
}
