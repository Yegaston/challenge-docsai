import request from "supertest";
import { SignJWT } from "jose";
import { expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import { createAuthService } from "../src/modules/auth/services/auth.service.js";
import { createTicketsService } from "../src/modules/tickets/services/tickets.service.js";
import { createTicketsRouter } from "../src/modules/tickets/http/controller.js";
import { createAnalysesService, AnalysisError } from "../src/modules/analyses/services/analyses.service.js";
import { ProviderFailure } from "../src/modules/analyses/utils/provider.js";
import type { AnalysisRecord } from "../src/modules/analyses/repositories/analyses.repository.js";

const owner = "00000000-0000-4000-8000-000000000001", other = "00000000-0000-4000-8000-000000000002";
const id = "00000000-0000-4000-8000-000000000003";
async function fixture() {
  const rows: AnalysisRecord[] = [];
  const auth = await createAuthService({ secret: "test-only-secret-".repeat(4), users: {
    byEmail: vi.fn(), byId: vi.fn(async (user: string) => ({ id: user, email: "test@example.test", password_hash: "unused-test-hash" })),
  } });
  const token = (user: string) => new SignJWT({}).setProtectedHeader({ alg: "HS256" })
    .setIssuer("support-ticket-api").setAudience("support-ticket-web").setSubject(user)
    .setIssuedAt().setExpirationTime("15m").sign(new TextEncoder().encode("test-only-secret-".repeat(4)));
  const bearer = await token(owner), foreign = await token(other);
  const tickets = createTicketsService({ insert: vi.fn(), list: vi.fn(),
    byId: vi.fn(async (ticket, user) => ticket === id && user === owner ? { id, owner_id: owner, text: "original", created_at: new Date() } : undefined),
  });
  const generate = vi.fn().mockResolvedValue({ summary: "Fact", category: "other", uncertaintyNote: null });
  const finish = vi.fn(async (row: AnalysisRecord) => { rows[rows.length - 1] = row; return row; });
  const release = vi.fn().mockResolvedValue(undefined);
  const start = vi.fn(async (row: AnalysisRecord) => { rows.push(row); return { finish, release }; });
  const history = vi.fn(async (user, ticket) => rows.filter((row) => row.owner_id === user && row.ticket_id === ticket));
  const service = createAnalysesService({ start, history }, tickets, { model: "mock", generate });
  return { app: createApp(async () => {}, undefined, createTicketsRouter(tickets, auth, service)), bearer, foreign, generate, start, finish, history, release };
}
it("owner can create/refine and reload history without private fields", async () => {
  const f = await fixture();
  const first = await request(f.app).post(`/api/tickets/${id}/analyses`).auth(f.bearer, { type: "bearer" }).send({});
  expect(first.status).toBe(201); expect(first.body.analysis.status).toBe("succeeded");
  await request(f.app).post(`/api/tickets/${id}/analyses`).auth(f.bearer, { type: "bearer" }).send({ instruction: "  concise  ", owner_id: other });
  const detail = await request(f.app).get(`/api/tickets/${id}`).auth(f.bearer, { type: "bearer" });
  expect(detail.body.ticket.analyses).toHaveLength(2);
  expect(detail.body.ticket.analyses[1].instruction).toBe("concise");
  expect(JSON.stringify(detail.body)).not.toContain("owner_id");
  expect(f.generate.mock.calls).toEqual([["original", null], ["original", "concise"]]);
});
it.each([[undefined, 401], ["foreign", 404], ["malformed", 400], ["missing", 404]])("rejects %s before cost", async (kind, status) => {
  const f = await fixture(); const ticket = kind === "malformed" ? "bad" : kind === "missing" ? other : id;
  const call = request(f.app).post(`/api/tickets/${ticket}/analyses`);
  if (kind) call.auth(kind === "foreign" ? f.foreign : f.bearer, { type: "bearer" });
  const result = await call.send({}); expect(result.status).toBe(status);
  expect(f.start).not.toHaveBeenCalled(); expect(f.generate).not.toHaveBeenCalled();
  expect(result.headers["cache-control"]).toBe("no-store");
});
it.each(["invalid", "expired"])("rejects %s analysis authentication before operations", async (kind) => {
  const f = await fixture();
  const expired = await new SignJWT({}).setProtectedHeader({ alg: "HS256" }).setIssuer("support-ticket-api")
    .setAudience("support-ticket-web").setSubject(owner).setIssuedAt(1).setExpirationTime(2)
    .sign(new TextEncoder().encode("test-only-secret-".repeat(4)));
  const result = await request(f.app).post(`/api/tickets/${id}/analyses`)
    .auth(kind === "expired" ? expired : "invalid", { type: "bearer" }).send({});
  expect(result.status).toBe(401); expect(f.start).not.toHaveBeenCalled(); expect(f.generate).not.toHaveBeenCalled();
});
it("allows omitted body and prevents foreign history reads", async () => {
  const f = await fixture();
  expect((await request(f.app).post(`/api/tickets/${id}/analyses`).auth(f.bearer, { type: "bearer" })).status).toBe(201);
  const result = await request(f.app).get(`/api/tickets/${id}`).auth(f.foreign, { type: "bearer" });
  expect(result.status).toBe(404); expect(f.history).not.toHaveBeenCalled();
});
it("history database failure returns safe detail 503", async () => {
  const f = await fixture(); f.history.mockRejectedValueOnce(new Error("private driver detail"));
  const result = await request(f.app).get(`/api/tickets/${id}`).auth(f.bearer, { type: "bearer" });
  expect(result.status).toBe(503); expect(result.body).toEqual({ error: "Tickets unavailable. Try again." });
});
it.each([["timeout", 504], ["provider", 502], ["invalid_output", 502], ["unconfigured", 502]] as const)("returns safe %s failure and reloadable failed attempt", async (code, status) => {
  const f = await fixture(); f.generate.mockRejectedValueOnce(new ProviderFailure(code));
  const result = await request(f.app).post(`/api/tickets/${id}/analyses`).auth(f.bearer, { type: "bearer" }).send({});
  expect(result.status).toBe(status); expect(result.body.code).toBe(code);
  expect(result.body.analysis).toMatchObject({ status: "failed", failureCode: code, summary: null, category: null });
  const detail = await request(f.app).get(`/api/tickets/${id}`).auth(f.bearer, { type: "bearer" });
  expect(detail.body.ticket.analyses).toEqual([result.body.analysis]); expect(f.release).toHaveBeenCalledTimes(1);
});
it("maps expiry after detail but before insert to safe missing without provider or failed attempt", async () => {
  const f = await fixture(); f.start.mockRejectedValueOnce(new AnalysisError("missing"));
  const result = await request(f.app).post(`/api/tickets/${id}/analyses`).auth(f.bearer, { type: "bearer" }).send({});
  expect(result.status).toBe(404);
  expect(result.body).toEqual({ code: "missing", error: "Ticket not found." });
  expect(f.generate).not.toHaveBeenCalled(); expect(f.finish).not.toHaveBeenCalled();
  expect(f.release).not.toHaveBeenCalled();
});
it.each([["limit", 429], ["database", 503]] as const)("maps %s safely", async (kind, status) => {
  const f = await fixture(); f.start.mockRejectedValueOnce(new AnalysisError(kind));
  const result = await request(f.app).post(`/api/tickets/${id}/analyses`).auth(f.bearer, { type: "bearer" }).send({});
  expect(result.status).toBe(status); expect(result.body).toMatchObject({ code: kind });
  expect(result.body.analysis).toBeUndefined(); expect(f.generate).not.toHaveBeenCalled();
});
it.each(["{", "null", "[]", JSON.stringify({ instruction: "x".repeat(20001) })])("malformed/oversized body gets 400", async (body) => {
  const f = await fixture();
  const result = await request(f.app).post(`/api/tickets/${id}/analyses`).auth(f.bearer, { type: "bearer" })
    .set("Content-Type", "application/json").send(body);
  expect(result.status).toBe(400); expect(result.body.code).toBe("invalid"); expect(f.start).not.toHaveBeenCalled();
});
