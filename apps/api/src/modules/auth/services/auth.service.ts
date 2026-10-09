import { randomBytes } from "node:crypto";
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

type AuthOptions = { users: Users; secret: string | undefined; now?: () => Date };
export type AuthService = Awaited<ReturnType<typeof createAuthService>>;

export async function createAuthService({ users, secret, now = () => new Date() }: AuthOptions) {
  if (!secret || Buffer.byteLength(secret, "utf8") < 32) {
    throw new Error("JWT_SECRET must contain at least 32 bytes. See README.md.");
  }
  const key = new TextEncoder().encode(secret);
  const dummyHash = await hashPassword(randomBytes(32).toString("hex"));
  return {
    async login(email: string, password: string) {
      try {
        const user = await users.byEmail(email);
        // Perform the same expensive verification even when no account exists.
        const matches = await verifyPassword(password, user?.password_hash ?? dummyHash);
        if (!user || !matches) throw new AuthError("invalid-credentials");
        const issuedAt = Math.floor(now().getTime() / 1000);
        const token = await new SignJWT({})
          .setProtectedHeader({ alg: "HS256", typ: "JWT" })
          .setIssuer(issuer).setAudience(audience).setSubject(user.id)
          .setIssuedAt(issuedAt).setExpirationTime(issuedAt + lifetime).sign(key);
        return { token, expiresAt: (issuedAt + lifetime) * 1000 };
      } catch (error) {
        if (error instanceof AuthError) throw error;
        throw new AuthError("unavailable");
      }
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
        return { id: user.id, email: user.email };
      } catch (error) {
        if (error instanceof AuthError) throw error;
        throw new AuthError("unavailable");
      }
    },
  };
}
