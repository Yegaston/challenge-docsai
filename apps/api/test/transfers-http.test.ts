import request from "supertest";
import { SignJWT } from "jose";
import { expect, test, vi } from "vitest";
import { createApp } from "../src/app.js";
import { createAuthService } from "../src/modules/auth/services/auth.service.js";
import { createFixtureRouter, createFixtureRepository } from "../src/modules/transfers/fixtures.js";

const secret = "test-only-secret-".repeat(4);
const owner = "00000000-0000-4000-8000-000000000001";
const other = "00000000-0000-4000-8000-000000000002";
const support = "00000000-0000-4000-8000-000000000003";
const key = "a1111111-1111-4111-8111-111111111111";
const payload = () => ({ amount: "25.00", date: new Date().toISOString().slice(0, 10), status: "pending", idempotencyKey: key });
async function setup() {
  const rows: { owner: string; record: any }[] = [];
  const list = vi.fn(async (id: string) => rows.filter((row) => row.owner === id).map((row) => row.record));
  const create = vi.fn(async (id: string, input: any) => {
    const record = { id: `generated-${rows.length}`, amount: input.amount, date: input.date, status: input.status, createdAt: new Date().toISOString() };
    rows.push({ owner: id, record }); return { record, replay: false };
  });
  const auth = await createAuthService({ secret, users: { byEmail: vi.fn(), byId: vi.fn(async (id: string) => ({ id, email: "test@example.test", role: id === support ? "support" as const : "customer" as const, password_hash: "unused" })) } });
  const token = (id: string, expired = false) => new SignJWT({}).setProtectedHeader({ alg: "HS256" }).setIssuer("support-ticket-api").setAudience("support-ticket-web").setSubject(id).setIssuedAt(expired ? 1 : Math.floor(Date.now() / 1000)).setExpirationTime(expired ? 2 : Math.floor(Date.now() / 1000) + 900).sign(new TextEncoder().encode(secret));
  const app = createApp(async () => {}, undefined, undefined, undefined, createFixtureRouter({ list, create } as unknown as ReturnType<typeof createFixtureRepository>, auth));
  return { app, list, create, ownerToken: await token(owner), otherToken: await token(other), supportToken: await token(support), expiredToken: await token(owner, true) };
}
test("HTTP scopes history and creation to authenticated customers", async () => {
  const f = await setup();
  expect((await request(f.app).post("/api/synthetic-transfers").auth(f.otherToken, { type: "bearer" }).send(payload())).status).toBe(201);
  const history = await request(f.app).get("/api/synthetic-transfers").auth(f.ownerToken, { type: "bearer" });
  expect(history.status).toBe(200); expect(history.body.transfers).toEqual([]);
  expect(f.list).toHaveBeenCalledWith(owner);
  for (const token of [f.ownerToken, f.otherToken]) {
    expect((await request(f.app).post("/api/synthetic-transfers").auth(token, { type: "bearer" }).send({ ...payload(), ownerId: other })).status).toBe(400);
    expect((await request(f.app).post("/api/synthetic-transfers").auth(token, { type: "bearer" }).send({ ...payload(), id: "chosen" })).status).toBe(400);
  }
  expect(f.create).toHaveBeenCalledTimes(1); expect(f.create).toHaveBeenCalledWith(other, payload());
  for (const method of ["get", "post"] as const) {
    const denied = await request(f.app)[method]("/api/synthetic-transfers").auth(f.supportToken, { type: "bearer" }).send(method === "post" ? payload() : undefined);
    expect(denied.status).toBe(403);
    for (const token of [undefined, f.expiredToken]) {
      const call = request(f.app)[method]("/api/synthetic-transfers");
      if (token) call.auth(token, { type: "bearer" });
      expect((await call.send(method === "post" ? payload() : undefined)).status).toBe(401);
    }
  }
  expect(f.create).toHaveBeenCalledTimes(1);
});
test("HTTP rejects arrays, malformed JSON and oversized payloads before persistence", async () => {
  const f = await setup();
  for (const body of [{ ...payload(), status: ["pending"] }, "{"]) {
    const call = request(f.app).post("/api/synthetic-transfers").auth(f.ownerToken, { type: "bearer" });
    const result = typeof body === "string" ? await call.set("Content-Type", "application/json").send(body) : await call.send(body);
    expect(result.status).toBe(400);
  }
  expect((await request(f.app).post("/api/synthetic-transfers").auth(f.ownerToken, { type: "bearer" }).send({ ...payload(), extra: "x".repeat(5000) })).status).toBe(413);
  expect(f.create).not.toHaveBeenCalled();
});
