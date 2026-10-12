import { expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { createConversationsRouter } from "../src/modules/conversations/http/controller.js";
import { createConversations } from "../src/modules/conversations/repositories/conversations.repository.js";
import { validateSupportSeed } from "../src/modules/users/services/users.service.js";
import { createConversationsService } from "../src/modules/conversations/services/conversations.service.js";

const customer = { id: "00000000-0000-4000-8000-000000000001", role: "customer" as const };
const other = { id: "00000000-0000-4000-8000-000000000002", role: "customer" as const };
const support = { id: "00000000-0000-4000-8000-000000000003", role: "support" as const };

it("creates customer-owned conversations and hides un-escalated threads from support and other customers", async () => {
  const rows: any[] = [];
  const repository = {
    insert: vi.fn(async (row) => { rows.push(row); return row; }),
    list: vi.fn(async (id, role) => rows.filter((row) => role === "support" ? row.status === "escalated" : row.owner_id === id)),
    byId: vi.fn(async (id, owner, role) => rows.find((row) => row.id === id && (role === "support" ? row.status === "escalated" : row.owner_id === owner))),
    messages: vi.fn(async () => []),
  };
  const service = createConversationsService(repository);
  const created = await service.create(customer, { text: "Where is my transfer?", role: "support" });
  expect(created.status).toBe("open");
  expect(repository.insert).toHaveBeenCalledWith(expect.objectContaining({ owner_id: customer.id, status: "open" }), "Where is my transfer?");
  expect(await service.list(other)).toEqual([]);
  expect(await service.list(support)).toEqual([]);
  await expect(service.detail(other, created.id)).rejects.toThrow("missing");
  await expect(service.detail(support, created.id)).rejects.toThrow("missing");
  await expect(service.create(support, { text: "Hello" })).rejects.toThrow("forbidden");
});

it("authenticates both roles and denies cross-owner and un-escalated support access at the route", async () => {
  const thread: { id: string; owner_id: string; status: "open" | "escalated"; created_at: Date } = { id: customer.id, owner_id: customer.id, status: "open", created_at: new Date() };
  const repository = {
    insert: vi.fn(async (row: typeof thread) => row),
    list: vi.fn(async (owner: string, role: string) => role === "customer" && owner === customer.id ? [thread] : []),
    byId: vi.fn(async (id: string, owner: string, role: string) => id === thread.id && (role === "support" ? thread.status === "escalated" : owner === customer.id) ? thread : undefined),
    messages: vi.fn(async () => []),
  };
  const auth = { identity: vi.fn(async (token: string) => {
    if (token === "customer") return customer;
    if (token === "other") return other;
    if (token === "support") return support;
    throw Error("unauthorized");
  }) };
  const app = createApp(async () => {}, undefined, undefined, createConversationsRouter(createConversationsService(repository), auth as any));
  expect((await request(app).get(`/api/conversations/${thread.id}`).auth("customer", { type: "bearer" })).status).toBe(200);
  expect((await request(app).get(`/api/conversations/${thread.id}`).auth("other", { type: "bearer" })).status).toBe(404);
  expect((await request(app).get(`/api/conversations/${thread.id}`).auth("support", { type: "bearer" })).status).toBe(404);
  expect((await request(app).get("/api/conversations").auth("support", { type: "bearer" })).body.conversations).toEqual([]);
  expect((await request(app).post("/api/conversations").auth("support", { type: "bearer" }).send({ text: "hi", role: "customer" })).status).toBe(403);
  thread.status = "escalated";
  expect((await request(app).get(`/api/conversations/${thread.id}`).auth("support", { type: "bearer" })).status).toBe(200);
  expect(repository.messages).toHaveBeenCalledTimes(2);
});

it("rejects partial support seed configuration and scopes repository reads before retrieving messages", async () => {
  expect(validateSupportSeed(undefined, undefined)).toBeUndefined();
  expect(() => validateSupportSeed("support@example.test", undefined)).toThrow();
  expect(() => validateSupportSeed(undefined, "long-secret-password")).toThrow();
  const query = vi.fn().mockResolvedValue({ rows: [] });
  const repository = createConversations({ query, connect: vi.fn() } as any);
  expect(await repository.byId(customer.id, other.id, "customer")).toBeUndefined();
  expect(query.mock.calls[0][0]).toContain("owner_id = $2");
  expect(query.mock.calls[0][0]).toContain("interval '90 days'");
  expect(query.mock.calls[0][1]).toEqual([customer.id, other.id]);
  await repository.list(support.id, "support");
  expect(query.mock.calls[1][0]).toContain("status = 'escalated'");
});
