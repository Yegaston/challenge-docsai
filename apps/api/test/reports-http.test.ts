import request from "supertest";
import { SignJWT } from "jose";
import { expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import { createAuthService } from "../src/modules/auth/services/auth.service.js";
import { createTicketsRouter } from "../src/modules/tickets/http/controller.js";
import { createReportsService } from "../src/modules/reports/services/reports.service.js";
const owner = "00000000-0000-4000-8000-000000000001";
const ticket = "00000000-0000-4000-8000-000000000002";
const analysis = "00000000-0000-4000-8000-000000000003";
async function fixture() {
  const auth = await createAuthService({ secret: "test-only-secret-".repeat(4), users: { byEmail: vi.fn(), byId: vi.fn(async (id) => ({ id, email: "test@example.test", password_hash: "unused" })) } });
  const token = async (id: string) => new SignJWT({}).setProtectedHeader({ alg: "HS256" }).setIssuer("support-ticket-api").setAudience("support-ticket-web").setSubject(id).setIssuedAt().setExpirationTime("15m").sign(new TextEncoder().encode("test-only-secret-".repeat(4)));
  const create = vi.fn(async () => ({ id: analysis, analysis_id: analysis, ticket_id: ticket, status: "open" as const, explanation: "wrong", created_at: new Date() }));
  const list = vi.fn(async () => [{ id: analysis, analysis_id: analysis, ticket_id: ticket, status: "open" as const, explanation: "wrong", created_at: new Date() }]);
  const audit = { record: vi.fn(() => new Promise<void>(() => {})) };
  const app = createApp(async () => {}, undefined, createTicketsRouter({} as never, auth, undefined, audit as never, createReportsService({ create, list })));
  return { app, bearer: await token(owner), foreign: await token("00000000-0000-4000-8000-000000000004"), create, list, audit };
}
it("posts owner-bound version without waiting for audit and lists demo status", async () => {
  const f = await fixture();
  const result = await request(f.app).post(`/api/tickets/${ticket}/analyses/${analysis}/reports`).auth(f.bearer, { type: "bearer" }).send({ explanation: "wrong", ownerId: f.foreign });
  expect(result.status).toBe(201);
  expect(result.body.report).toMatchObject({ status: "open", reviewMode: "same_user_demo" });
  expect(f.create).toHaveBeenCalledWith(owner, ticket, analysis, "wrong");
  expect(f.audit.record).toHaveBeenCalledWith({ kind: "wrong_answer_reported", ownerId: owner, ticketId: ticket, analysisId: analysis });
  const listed = await request(f.app).get(`/api/tickets/${ticket}/reports`).auth(f.bearer, { type: "bearer" });
  expect(listed.status).toBe(200); expect(listed.body.reports[0].reviewMode).toBe("same_user_demo");
});
it.each(["", "  ", "x".repeat(2001), "PRIVATE_SENTINEL\u0000", 42])("rejects invalid explanation", async (explanation) => {
  const f = await fixture(); const result = await request(f.app).post(`/api/tickets/${ticket}/analyses/${analysis}/reports`).auth(f.bearer, { type: "bearer" }).send({ explanation });
  expect(result.status).toBe(400); expect(f.create).not.toHaveBeenCalled(); expect(f.audit.record).not.toHaveBeenCalled();
});
it("returns safe 409 for duplicate versions and safe 404 for expired listings", async () => {
  const f = await fixture();
  f.create.mockRejectedValueOnce(Object.assign(new Error("PRIVATE_SENTINEL"), { code: "23505" }));
  const duplicate = await request(f.app).post(`/api/tickets/${ticket}/analyses/${analysis}/reports`)
    .auth(f.bearer, { type: "bearer" }).send({ explanation: "wrong" });
  expect(duplicate.status).toBe(409); expect(JSON.stringify(duplicate.body)).not.toContain("PRIVATE_SENTINEL");
  f.list.mockResolvedValueOnce(undefined as never);
  expect((await request(f.app).get(`/api/tickets/${ticket}/reports`).auth(f.bearer, { type: "bearer" })).status).toBe(404);
  expect(f.audit.record).not.toHaveBeenCalled();
});
it("rejects unauthenticated and malformed IDs without database work", async () => {
  const f = await fixture();
  expect((await request(f.app).get(`/api/tickets/${ticket}/reports`)).status).toBe(401);
  expect((await request(f.app).post(`/api/tickets/${ticket}/analyses/bad/reports`).auth(f.bearer, { type: "bearer" }).send({ explanation: "wrong" })).status).toBe(400);
  expect(f.create).not.toHaveBeenCalled(); expect(f.list).not.toHaveBeenCalled();
});
it("hides foreign/missing versions and database failures safely", async () => {
  const f = await fixture(); f.create.mockResolvedValueOnce(undefined as never).mockRejectedValueOnce(new Error("PRIVATE_SENTINEL"));
  const path = `/api/tickets/${ticket}/analyses/${analysis}/reports`;
  expect((await request(f.app).post(path).auth(f.foreign, { type: "bearer" }).send({ explanation: "wrong" })).status).toBe(404);
  const result = await request(f.app).post(path).auth(f.bearer, { type: "bearer" }).send({ explanation: "wrong" });
  expect(result.status).toBe(503); expect(JSON.stringify(result.body)).not.toContain("PRIVATE_SENTINEL");
});
