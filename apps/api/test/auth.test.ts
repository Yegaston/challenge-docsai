import request from "supertest";
import { jwtVerify, SignJWT, UnsecuredJWT } from "jose";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import { createAuth } from "../src/auth.js";
import * as passwords from "../src/modules/auth/utils/password.js";

const secret = "synthetic-test-key-".repeat(4);
const key = new TextEncoder().encode(secret);
const now = new Date("2026-01-01T00:00:00Z");
const id = "00000000-0000-4000-8000-000000000001";
let user: { id: string; email: string; password_hash: string; role?: "customer" | "support" };
let app: ReturnType<typeof createApp>;
const rows = new Map<string, { ownerId: string; expiresAt: Date }>();
const sessions = {
  create: vi.fn(async (hash: string, ownerId: string, _created: Date, expiresAt: Date) => { rows.set(hash, { ownerId, expiresAt }); }),
  byHash: vi.fn(async (hash: string) => rows.get(hash)),
  revoke: vi.fn(async (hash: string) => { rows.delete(hash); }),
  purge: vi.fn(async () => {}),
};
const users = { byEmail: vi.fn(), byId: vi.fn() };

beforeAll(async () => {
  user = { id, email: "demo@example.test", password_hash: await passwords.hashPassword("synthetic-password") };
  app = createApp(async () => {}, await createAuth({ users, sessions, secret, now: () => now }));
});
beforeEach(() => {
  vi.restoreAllMocks();
  rows.clear();
  sessions.byHash.mockClear();
  users.byEmail.mockReset().mockImplementation(async (email) => email === user.email ? user : undefined);
  users.byId.mockReset().mockImplementation(async (value) => value === id ? user : undefined);
});

async function token(overrides = {}, algorithm = "HS256", signingKey = key) {
  return new SignJWT({ sub: id, iss: "support-ticket-api", aud: "support-ticket-web", iat: now.getTime() / 1000, exp: now.getTime() / 1000 + 900, ...overrides })
    .setProtectedHeader({ alg: algorithm }).sign(signingKey);
}

describe("demo login", () => {
  it("signs a 15-minute token and resolves the persistent identity without exposing the hash", async () => {
    const response = await request(app).post("/api/auth/login").send({ email: " DEMO@example.test ", password: "synthetic-password" });
    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.body.expiresAt).toBe(now.getTime() + 900_000);
    const verified = await jwtVerify(response.body.token, key, { algorithms: ["HS256"], issuer: "support-ticket-api", audience: "support-ticket-web", currentDate: now });
    expect(verified.payload.sub).toBe(id);
    expect(verified.payload.exp! - verified.payload.iat!).toBe(900);
    const me = await request(app).get("/api/auth/me").auth(response.body.token, { type: "bearer" });
    expect(me.status).toBe(200);
    expect(me.headers["cache-control"]).toBe("no-store");
    expect(me.body).toEqual({ user: { id, email: user.email, role: "customer" } });
    expect(JSON.stringify(response.body).includes(user.password_hash)).toBe(false);
  });

  it("derives support role from persistence, not the login request", async () => {
    user = { ...user, role: "support" };
    const login = await request(app).post("/api/auth/login").send({ email: user.email, password: "synthetic-password", role: "customer" });
    expect(login.status).toBe(200);
    const me = await request(app).get("/api/auth/me").auth(login.body.token, { type: "bearer" });
    expect(me.body.user.role).toBe("support");
  });

  it.each(["demo@example.test", "unknown@example.test"])("uses generic failures and password verification for %s", async (email) => {
    const verify = vi.spyOn(passwords, "verifyPassword");
    const response = await request(app).post("/api/auth/login").send({ email, password: "wrong-password" });
    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: "Invalid email or password." });
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(verify).toHaveBeenCalledOnce();
    expect(typeof verify.mock.calls[0][1]).toBe("string");
  });

  it.each([{}, null, [], { email: 1, password: "x" }, { email: "invalid", password: "x" }, { email: "demo@example.test", password: "" }, { email: "demo@example.test", password: "x".repeat(257) }, { email: "x".repeat(255), password: "x" }])("rejects malformed credential shape %# before lookup", async (body) => {
    const response = await request(app).post("/api/auth/login").set("Content-Type", "application/json").send(JSON.stringify(body));
    expect(response.status).toBe(400);
    expect(users.byEmail).not.toHaveBeenCalled();
  });

  it.each(["{", JSON.stringify({ data: "x".repeat(5000) })])("bounds and safely rejects invalid JSON %#", async (body) => {
    const response = await request(app).post("/api/auth/login").set("Content-Type", "application/json").send(body);
    expect([400, 413]).toContain(response.status);
    expect(response.body).toEqual({ error: "Invalid login request." });
    expect(response.headers["cache-control"]).toBe("no-store");
  });

  it("rejects non-JSON credentials", async () => {
    expect((await request(app).post("/api/auth/login").type("form").send({ email: user.email, password: "synthetic-password" })).status).toBe(400);
  });

  it("hides database errors on login and protected lookup", async () => {
    users.byEmail.mockRejectedValue(new Error("private connection details"));
    users.byId.mockRejectedValue(new Error("private connection details"));
    const responses = [
      await request(app).post("/api/auth/login").send({ email: user.email, password: "synthetic-password" }),
      await request(app).get("/api/auth/me").auth(await token(), { type: "bearer" }),
    ];
    for (const response of responses) {
      expect(response.status).toBe(503);
      expect(response.body).toEqual({ error: "Authentication unavailable. Try again." });
      expect(response.headers["cache-control"]).toBe("no-store");
    }
  });

  it.each([undefined, "short", "é".repeat(15)])("requires at least 32 bytes of signing secret %#", async (value) => {
    await expect(createAuth({ users, secret: value })).rejects.toThrow("JWT_SECRET");
  });
});

describe("refresh cookie", () => {
  it("sets scoped cookie without exposing secret in JSON and revokes on logout", async () => {
    const login = await request(app).post("/api/auth/login").send({ email: user.email, password: "synthetic-password" });
    const cookie = login.headers["set-cookie"][0] as string;
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Path=/api/auth");
    expect(cookie).toContain("Max-Age=604800");
    expect(Object.keys(login.body).sort()).toEqual(["expiresAt", "token"]);
    const refreshed = await request(app).post("/api/auth/refresh").set("Cookie", cookie);
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.expiresAt).toBe(now.getTime() + 900000);
    expect(refreshed.headers["set-cookie"]).toBeUndefined();
    expect((await request(app).get("/api/auth/me").set("Cookie", cookie)).status).toBe(401);
    expect((await request(app).post("/api/auth/logout").set("Cookie", cookie)).status).toBe(204);
    const revoked = await request(app).post("/api/auth/refresh").set("Cookie", cookie);
    expect(revoked.status).toBe(401);
    expect(revoked.headers["set-cookie"][0]).toContain("Expires=Thu, 01 Jan 1970");
  });
  it("keeps the cookie on revoke failure so logout can be retried", async () => {
    const login = await request(app).post("/api/auth/login").send({ email: user.email, password: "synthetic-password" });
    const cookie = login.headers["set-cookie"][0] as string;
    sessions.revoke.mockRejectedValueOnce(new Error("database down"));
    const failed = await request(app).post("/api/auth/logout").set("Cookie", cookie);
    expect(failed.status).toBe(503);
    expect(failed.headers["set-cookie"]).toBeUndefined();
    expect((await request(app).post("/api/auth/refresh").set("Cookie", cookie)).status).toBe(200);
    const retried = await request(app).post("/api/auth/logout").set("Cookie", cookie);
    expect(retried.status).toBe(204);
    expect(retried.headers["set-cookie"][0]).toContain("Expires=Thu, 01 Jan 1970");
  });
  it("rejects foreign origins and malformed or duplicated cookies", async () => {
    expect((await request(app).post("/api/auth/login").set("Origin", "https://evil.test").send({ email: user.email, password: "synthetic-password" })).status).toBe(403);
    expect((await request(app).post("/api/auth/refresh").set("Sec-Fetch-Site", "cross-site")).status).toBe(403);
    for (const cookie of ["refresh=x", "refresh=x; refresh=y", "other=x"]) {
      expect((await request(app).post("/api/auth/refresh").set("Cookie", cookie)).status).toBe(401);
    }
  });
});

describe("bearer protection", () => {
  it.each(["missing", "invalid", "expired", "forged", "wrong-algorithm", "unsigned", "issuer", "audience", "missing-expiry", "missing-subject", "invalid-subject", "future", "deleted-user"])("rejects %s tokens", async (kind) => {
    let bearer = "not-a-token";
    if (kind === "expired") bearer = await token({ exp: now.getTime() / 1000 });
    if (kind === "forged") bearer = await token({}, "HS256", new TextEncoder().encode("different-synthetic-key".repeat(4)));
    if (kind === "wrong-algorithm") bearer = await token({}, "HS384");
    if (kind === "unsigned") bearer = new UnsecuredJWT({ sub: id }).encode();
    if (kind === "issuer") bearer = await token({ iss: "other" });
    if (kind === "audience") bearer = await token({ aud: "other" });
    if (kind === "missing-expiry") bearer = await token({ exp: undefined });
    if (kind === "missing-subject") bearer = await token({ sub: undefined });
    if (kind === "invalid-subject") bearer = await token({ sub: "not-a-uuid" });
    if (kind === "future") bearer = await token({ nbf: now.getTime() / 1000 + 60 });
    if (kind === "deleted-user") { bearer = await token(); users.byId.mockResolvedValue(undefined); }
    const call = request(app).get("/api/auth/me");
    if (kind !== "missing") call.auth(bearer, { type: "bearer" });
    const response = await call;
    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: "Session invalid or expired. Log in again." });
    expect(response.headers["cache-control"]).toBe("no-store");
    if (kind !== "deleted-user") expect(users.byId).not.toHaveBeenCalled();
  });
});
