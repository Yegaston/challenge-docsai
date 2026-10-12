import request from "supertest";
import { SignJWT } from "jose";
import { beforeAll, beforeEach, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import { createAuthRouter } from "../src/modules/auth/http/controller.js";
import { createAuthService } from "../src/modules/auth/services/auth.service.js";
import { createTicketsRouter } from "../src/modules/tickets/http/controller.js";
import { createTicketsService } from "../src/modules/tickets/services/tickets.service.js";
import type { TicketRow } from "../src/modules/tickets/repositories/tickets.repository.js";
import { createAuditService } from "../src/modules/audit/services/audit.service.js";

const owner = "00000000-0000-4000-8000-000000000001";
const other = "00000000-0000-4000-8000-000000000002";
const ticketId = "00000000-0000-4000-8000-000000000003";
const unknownId = "00000000-0000-4000-8000-000000000004";
const now = new Date("2026-01-01T00:00:00Z");
const secret = "synthetic-ticket-test-key-".repeat(4);
let rows: TicketRow[];
let app: ReturnType<typeof createApp>;
let bearer: string;
let otherBearer: string;
let supportBearer: string;
let expired: string;
const users = { byEmail: vi.fn(), byId: vi.fn() };
const auditInsert = vi.fn(async (_event: unknown) => {});
const auditDiagnostic = vi.fn();
const repository = {
  insert: vi.fn(async (row: TicketRow) => { rows.push(row); return row; }),
  list: vi.fn(async (id: string) => rows.filter((row) => row.owner_id === id)),
  byId: vi.fn(async (id: string, user: string) => rows.find((row) => row.id === id && row.owner_id === user)),
  delete: vi.fn(async (id: string, user: string) => {
    const index = rows.findIndex((row) => row.id === id && row.owner_id === user);
    if (index < 0) return "missing" as const;
    rows.splice(index, 1);
    return "deleted" as const;
  }),
};

async function token(id: string, exp = now.getTime() / 1000 + 900) {
  return new SignJWT({ sub: id, iss: "support-ticket-api", aud: "support-ticket-web", iat: now.getTime() / 1000, exp })
    .setProtectedHeader({ alg: "HS256" }).sign(new TextEncoder().encode(secret));
}

beforeAll(async () => {
  const auth = await createAuthService({ users, secret, now: () => now });
  const tickets = createTicketsService(repository, { id: () => ticketId, now: () => now });
  app = createApp(async () => {}, createAuthRouter(auth), createTicketsRouter(tickets, auth, undefined, createAuditService({ insert: auditInsert }, auditDiagnostic)));
  bearer = await token(owner);
  otherBearer = await token(other);
  supportBearer = await token("00000000-0000-4000-8000-000000000005");
  expired = await token(owner, now.getTime() / 1000);
});
beforeEach(() => {
  vi.clearAllMocks();
  rows = [];
  users.byId.mockImplementation(async (id) => [owner, other].includes(id) ? { id, email: "user@example.test", role: "customer" } : id === "00000000-0000-4000-8000-000000000005" ? { id, email: "support@example.test", role: "support" } : undefined);
});

it("rejects support on legacy ticket routes before business operations while customer can use them", async () => {
  rows.push({ id: ticketId, owner_id: owner, text: "private", created_at: now });
  for (const [method, path] of [["get", "/api/tickets"], ["post", "/api/tickets"], ["get", `/api/tickets/${ticketId}`], ["delete", `/api/tickets/${ticketId}`]] as const) {
    const denied = await request(app)[method](path).auth(supportBearer, { type: "bearer" }).send(method === "post" ? { text: "new" } : undefined);
    expect(denied.status).toBe(403);
    expect(denied.headers["cache-control"]).toBe("no-store");
  }
  expect(repository.list).not.toHaveBeenCalled();
  expect(repository.insert).not.toHaveBeenCalled();
  expect(repository.byId).not.toHaveBeenCalled();
  expect(repository.delete).not.toHaveBeenCalled();
  expect(auditInsert).not.toHaveBeenCalled();
  expect((await request(app).get("/api/tickets").auth(bearer, { type: "bearer" })).status).toBe(200);
  expect((await request(app).get(`/api/tickets/${ticketId}`).auth(bearer, { type: "bearer" })).status).toBe(200);
  expect((await request(app).post("/api/tickets").auth(bearer, { type: "bearer" }).send({ text: "new" })).status).toBe(201);
});

it("audits only successful authenticated owner list, detail and deletion without content", async () => {
  rows.push({ id: ticketId, owner_id: owner, text: "PRIVATE_TICKET_SENTINEL", created_at: now });
  await request(app).get("/api/tickets").auth(bearer, { type: "bearer" });
  await request(app).get(`/api/tickets/${ticketId}`).auth(bearer, { type: "bearer" });
  await request(app).get(`/api/tickets/${ticketId}`).auth(otherBearer, { type: "bearer" });
  await request(app).get(`/api/tickets/${unknownId}`).auth(bearer, { type: "bearer" });
  await request(app).get("/api/tickets");
  await request(app).delete(`/api/tickets/${ticketId}`).auth(otherBearer, { type: "bearer" });
  await request(app).delete(`/api/tickets/${ticketId}`).auth(bearer, { type: "bearer" });
  expect(auditInsert.mock.calls.map(([event]) => event)).toEqual([
    { ownerId: owner, kind: "ticket_list" },
    { ownerId: owner, kind: "ticket_detail", ticketId },
    { ownerId: owner, kind: "ticket_deleted", ticketId },
  ]);
  expect(JSON.stringify(auditInsert.mock.calls)).not.toContain("PRIVATE_TICKET_SENTINEL");
});

it("keeps successful reads and owner deletion available when audit storage fails", async () => {
  rows.push({ id: ticketId, owner_id: owner, text: "PRIVATE_TICKET_SENTINEL", created_at: now });
  auditInsert.mockRejectedValue(new Error("PRIVATE_ERROR_SENTINEL"));
  expect((await request(app).get("/api/tickets").auth(bearer, { type: "bearer" })).status).toBe(200);
  expect((await request(app).get(`/api/tickets/${ticketId}`).auth(bearer, { type: "bearer" })).status).toBe(200);
  expect((await request(app).delete(`/api/tickets/${ticketId}`).auth(bearer, { type: "bearer" })).status).toBe(204);
  expect(rows).toHaveLength(0);
  expect(auditDiagnostic).toHaveBeenCalledTimes(3);
  expect(JSON.stringify(auditDiagnostic.mock.calls)).not.toMatch(/PRIVATE_ERROR_SENTINEL|PRIVATE_TICKET_SENTINEL/);
});

it("creates trimmed tickets independently of analysis, ignoring supplied identity and metadata", async () => {
  const response = await request(app).post("/api/tickets").auth(bearer, { type: "bearer" })
    .send({ text: "  Help\nplease  ", owner_id: other, ownerId: other, id: unknownId, createdAt: "forged" });
  expect(response.status).toBe(201);
  expect(response.headers["cache-control"]).toBe("no-store");
  expect(response.body).toEqual({ ticket: { id: ticketId, text: "Help\nplease", createdAt: now.toISOString() } });
  expect(rows[0]).toEqual({ id: ticketId, owner_id: owner, text: "Help\nplease", created_at: now });
  const detail = await request(app).get(`/api/tickets/${ticketId}`).auth(bearer, { type: "bearer" });
  expect(detail.status).toBe(200);
  expect(detail.body).toEqual({ ticket: { ...response.body.ticket, analyses: [] } });
  expect(detail.headers["cache-control"]).toBe("no-store");
});

it("lists only the verified owner's records and hides foreign detail exactly like unknown detail", async () => {
  rows.push({ id: ticketId, owner_id: owner, text: "mine", created_at: now });
  const mine = await request(app).get("/api/tickets").auth(bearer, { type: "bearer" });
  expect(mine.body).toEqual({ tickets: [{ id: ticketId, text: "mine", createdAt: now.toISOString() }] });
  expect(mine.status).toBe(200);
  expect(mine.headers["cache-control"]).toBe("no-store");
  const theirs = await request(app).get("/api/tickets").auth(otherBearer, { type: "bearer" });
  expect(theirs.body).toEqual({ tickets: [] });
  const foreign = await request(app).get(`/api/tickets/${ticketId}`).auth(otherBearer, { type: "bearer" });
  const missing = await request(app).get(`/api/tickets/${unknownId}`).auth(otherBearer, { type: "bearer" });
  expect(foreign.status).toBe(404);
  expect(missing.status).toBe(404);
  expect(foreign.body).toEqual(missing.body);
  expect(foreign.headers["cache-control"]).toBe("no-store");
  expect(auditInsert.mock.calls.map(([event]) => event)).toEqual([
    { kind: "ticket_list", ownerId: owner }, { kind: "ticket_list", ownerId: other },
  ]);
});

it("deletes only owned tickets and hides foreign and absent tickets", async () => {
  rows.push({ id: ticketId, owner_id: owner, text: "private", created_at: now });
  const foreign = await request(app).delete(`/api/tickets/${ticketId}`).auth(otherBearer, { type: "bearer" });
  const absent = await request(app).delete(`/api/tickets/${unknownId}`).auth(otherBearer, { type: "bearer" });
  expect(foreign.status).toBe(404);
  expect(foreign.body).toEqual(absent.body);
  expect(rows).toHaveLength(1);
  const mine = await request(app).delete(`/api/tickets/${ticketId}`).auth(bearer, { type: "bearer" });
  expect(mine.status).toBe(204);
  expect(mine.body).toEqual({});
  expect(mine.headers["cache-control"]).toBe("no-store");
  expect(rows).toHaveLength(0);
  expect(repository.delete).toHaveBeenCalledWith(ticketId, owner);
});

it("rejects malformed deletion and auth before persistence; maps lock and database failures safely", async () => {
  expect((await request(app).delete("/api/tickets/bad").auth(bearer, { type: "bearer" })).status).toBe(400);
  expect(repository.delete).not.toHaveBeenCalled();
  expect((await request(app).delete(`/api/tickets/${ticketId}`)).status).toBe(401);
  expect(repository.delete).not.toHaveBeenCalled();
  repository.delete.mockResolvedValueOnce("conflict" as never);
  const conflict = await request(app).delete(`/api/tickets/${ticketId}`).auth(bearer, { type: "bearer" });
  expect(conflict.status).toBe(409);
  expect(conflict.body).toEqual({ error: "Ticket is being analyzed. Try again." });
  repository.delete.mockRejectedValueOnce(new Error("private database details"));
  const failure = await request(app).delete(`/api/tickets/${ticketId}`).auth(bearer, { type: "bearer" });
  expect(failure.status).toBe(503);
  expect(failure.body).toEqual({ error: "Tickets unavailable. Try again." });
  expect(auditInsert).not.toHaveBeenCalled();
});

it("returns every repository-ordered record without pagination or private fields", async () => {
  const ordered = [unknownId, ticketId].map((id) => ({ id, owner_id: owner, text: id, created_at: now }));
  repository.list.mockResolvedValueOnce(ordered);
  const response = await request(app).get("/api/tickets").auth(bearer, { type: "bearer" });
  expect(response.status).toBe(200);
  expect(response.body.tickets).toEqual(ordered.map(({ id, text, created_at }) => ({ id, text, createdAt: created_at.toISOString() })));
  expect(repository.list).toHaveBeenCalledWith(owner);
});

it.each([{}, { text: "" }, { text: " \n\t " }, { text: "x".repeat(20001) }, { text: 1 }, { text: null }, { text: [] }])
  ("rejects invalid text %# before persistence", async (body) => {
    const response = await request(app).post("/api/tickets").auth(bearer, { type: "bearer" }).send(body);
    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: "Invalid ticket request." });
    expect(repository.insert).not.toHaveBeenCalled();
  });

it("rejects embedded NUL before calling the repository", async () => {
  const response = await request(app).post("/api/tickets").auth(bearer, { type: "bearer" }).send({ text: "help\u0000please" });
  expect(repository.insert).not.toHaveBeenCalled();
  expect(response.status).toBe(400);
  expect(response.body).toEqual({ error: "Invalid ticket request." });
  expect(response.headers["cache-control"]).toBe("no-store");
});

it.each(["x".repeat(20000), "😀".repeat(10000)])("accepts exactly 20000 JS characters after trimming %#", async (text) => {
  const response = await request(app).post("/api/tickets").auth(bearer, { type: "bearer" }).send({ text: ` ${text} ` });
  expect(response.status).toBe(201);
  expect(response.body.ticket.text).toBe(text);
});

it("accepts a maximum-length string even with six-byte JSON escaping", async () => {
  const text = "\u0001".repeat(20000);
  const response = await request(app).post("/api/tickets").auth(bearer, { type: "bearer" }).send({ text });
  expect(response.status).toBe(201);
  expect(response.body.ticket.text).toBe(text);
});

it.each(["{", "null", "[]", JSON.stringify({ text: "x".repeat(140000) })])("safely rejects malformed or over-limit JSON %#", async (body) => {
  const response = await request(app).post("/api/tickets").auth(bearer, { type: "bearer" })
    .set("Content-Type", "application/json").send(body);
  expect(response.status).toBe(body.length > 130000 ? 413 : 400);
  expect(response.body).toEqual({ error: "Invalid ticket request." });
  expect(response.headers["cache-control"]).toBe("no-store");
});

it("rejects non-JSON bodies and malformed UUIDs", async () => {
  expect((await request(app).post("/api/tickets").auth(bearer, { type: "bearer" }).type("form").send({ text: "help" })).status).toBe(400);
  const response = await request(app).get("/api/tickets/not-a-uuid").auth(bearer, { type: "bearer" });
  expect(response.status).toBe(400);
  expect(repository.byId).not.toHaveBeenCalled();
});

for (const [method, path] of [["post", "/api/tickets"], ["get", "/api/tickets"], ["get", `/api/tickets/${ticketId}`]] as const) {
  it.each(["missing", "invalid", "expired"])(`${method} ${path} rejects %s auth before business operations`, async (kind) => {
    const call = request(app)[method](path);
    if (kind !== "missing") call.auth(kind === "expired" ? expired : "invalid", { type: "bearer" });
    const response = await call.send({ text: "help" });
    expect(response.status).toBe(401);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(repository.insert).not.toHaveBeenCalled();
    expect(repository.list).not.toHaveBeenCalled();
    expect(repository.byId).not.toHaveBeenCalled();
    expect(auditInsert).not.toHaveBeenCalled();
  });
  it(`${method} ${path} maps database failures without leaking details`, async () => {
    const operation = method === "post" ? repository.insert : path.endsWith(ticketId) ? repository.byId : repository.list;
    operation.mockRejectedValueOnce(new Error("private SQL connection details"));
    const response = await request(app)[method](path).auth(bearer, { type: "bearer" }).send({ text: "help" });
    expect(response.status).toBe(503);
    expect(response.body).toEqual({ error: "Tickets unavailable. Try again." });
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(auditInsert).not.toHaveBeenCalled();
  });
}

it("fails safely when database-resolved authentication is unavailable", async () => {
  users.byId.mockRejectedValueOnce(new Error("private user lookup"));
  const response = await request(app).get("/api/tickets").auth(bearer, { type: "bearer" });
  expect(response.status).toBe(503);
  expect(response.body).toEqual({ error: "Authentication unavailable. Try again." });
  expect(repository.list).not.toHaveBeenCalled();
});
