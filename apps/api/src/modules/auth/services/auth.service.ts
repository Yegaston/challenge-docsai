import { createHash, randomBytes } from "node:crypto";
import type { RefreshSessions } from "../repositories/refresh-sessions.repository.js";
import { jwtVerify, SignJWT } from "jose";
import type { Users } from "../../users/repositories/users.repository.js";
import { hashPassword, verifyPassword } from "../utils/password.js";

const issuer = "support-ticket-api";
const audience = "support-ticket-web";
const lifetime = 900;
export class AuthError extends Error {
  constructor(public readonly kind: "invalid-credentials" | "invalid-session" | "unavailable") {
    super(kind);
  }
}

type AuthOptions = { users: Users; sessions?: RefreshSessions; secret: string | undefined; now?: () => Date };
const hashSecret = (secret: string) => createHash("sha256").update(secret).digest("hex");
export type AuthService = Awaited<ReturnType<typeof createAuthService>>;

export async function createAuthService({ users, sessions, secret, now = () => new Date() }: AuthOptions) {
  if (!secret || Buffer.byteLength(secret, "utf8") < 32) {
    throw new Error("JWT_SECRET must contain at least 32 bytes. See README.md.");
  }
  const key = new TextEncoder().encode(secret);
  const dummyHash = await hashPassword(randomBytes(32).toString("hex"));
  async function issue(ownerId: string) {
    const issuedAt = Math.floor(now().getTime() / 1000);
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setIssuer(issuer).setAudience(audience).setSubject(ownerId)
      .setIssuedAt(issuedAt).setExpirationTime(issuedAt + lifetime).sign(key);
    return { token, expiresAt: (issuedAt + lifetime) * 1000 };
  }
  return {
    async login(email: string, password: string) {
      try {
        const user = await users.byEmail(email);
        // Perform the same expensive verification even when no account exists.
        const matches = await verifyPassword(password, user?.password_hash ?? dummyHash);
        if (!user || !matches) throw new AuthError("invalid-credentials");
        const access = await issue(user.id);
        if (!sessions) return { ...access, refreshSecret: undefined as string | undefined };
        const refreshSecret = randomBytes(32).toString("base64url");
        const createdAt = now();
        await sessions.create(hashSecret(refreshSecret), user.id, createdAt, new Date(createdAt.getTime() + 604800000));
        return { ...access, refreshSecret };
      } catch (error) {
        if (error instanceof AuthError) throw error;
        throw new AuthError("unavailable");
      }
    },
    async refresh(refreshSecret: string) {
      if (!sessions || !/^[A-Za-z0-9_-]{43}$/.test(refreshSecret)) throw new AuthError("invalid-session");
      try {
        const session = await sessions.byHash(hashSecret(refreshSecret));
        if (!session || session.expiresAt.getTime() <= now().getTime()) throw new AuthError("invalid-session");
        const user = await users.byId(session.ownerId);
        if (!user) throw new AuthError("invalid-session");
        return await issue(user.id);
      } catch (error) {
        if (error instanceof AuthError) throw error;
        throw new AuthError("unavailable");
      }
    },
    async logout(refreshSecret: string) {
      if (!sessions || !/^[A-Za-z0-9_-]{43}$/.test(refreshSecret)) return;
      try { await sessions.revoke(hashSecret(refreshSecret)); }
      catch { throw new AuthError("unavailable"); }
    },
    async identity(token: string) {
      let subject: string;
      try {
        if (!token || token.length > 2048) throw new Error("Invalid token");
        const { payload } = await jwtVerify(token, key, {
          algorithms: ["HS256"], issuer, audience, currentDate: now(),
          requiredClaims: ["sub", "iat", "exp"], maxTokenAge: lifetime,
        });
        if (!payload.sub || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(payload.sub)) {
          throw new Error("Invalid subject");
        }
        subject = payload.sub;
      } catch {
        throw new AuthError("invalid-session");
      }
      try {
        const user = await users.byId(subject);
        if (!user) throw new AuthError("invalid-session");
        return { id: user.id, email: user.email, role: user.role === "support" ? "support" as const : "customer" as const };
      } catch (error) {
        if (error instanceof AuthError) throw error;
        throw new AuthError("unavailable");
      }
    },
  };
}
