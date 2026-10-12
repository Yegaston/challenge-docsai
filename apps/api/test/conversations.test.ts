import { expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import request from "supertest";
import { createApp } from "../src/app.js";
import { createConversationsRouter } from "../src/modules/conversations/http/controller.js";
import { createConversations } from "../src/modules/conversations/repositories/conversations.repository.js";
import { validateSupportSeed } from "../src/modules/users/services/users.service.js";
import { createConversationsService } from "../src/modules/conversations/services/conversations.service.js";

it("replays a claim-state migration that permits outcome_unknown on existing and fresh claims", async () => {
  const migration = await readFile(new URL("../migrations/014-chat-claim-state.sql", import.meta.url), "utf8");
  const initial = await readFile(new URL("../migrations/012-chat-idempotency.sql", import.meta.url), "utf8");
  const startup = await readFile(new URL("../src/infrastructure/initialize-users.ts", import.meta.url), "utf8");
  expect(initial).toContain("'pending', 'done', 'failed'");
  expect(migration).toMatch(/DROP CONSTRAINT IF EXISTS chat_send_claims_state_check/);
  expect(migration).toMatch(/ADD CONSTRAINT chat_send_claims_state_check[\s\S]*'outcome_unknown'/);
  expect(startup).toContain('"014-chat-claim-state.sql"');
});

it("persists typed clarification options on the agent message and returns them on reload", async () => {
  const migration = await readFile(new URL("../migrations/017-chat-clarification-options.sql", import.meta.url), "utf8");
  expect(migration).toContain("ADD COLUMN IF NOT EXISTS options jsonb");
  const statements: [string, unknown[] | undefined][] = [];
  const client = { query: vi.fn(async (sql: string, values?: unknown[]) => {
    statements.push([sql, values]);
    if (sql.startsWith("SELECT status")) return { rows: [{ status: "open" }] };
    if (sql.startsWith("SELECT state")) return { rows: [{ state: "pending" }] };
    return { rows: [] };
  }), release: vi.fn() };
  const repository = createConversations({ query: vi.fn(async () => ({ rows: [{ id: customer.id, sender_role: "agent", text: "Choose", created_at: new Date(), options: [{ kind: "handoff", label: "Support" }] }] })), connect: vi.fn(async () => client) } as any);
  await repository.complete!(customer.id, customer.id, other.id, [], { text: "Choose", needsClarification: true, options: [{ kind: "handoff", label: "Support" }] });
  expect(statements.find(([sql]) => sql.startsWith("INSERT INTO conversation_messages"))?.[1]?.[4]).toBe('[{"kind":"handoff","label":"Support"}]');
  expect((await repository.messages(customer.id))[0].options).toEqual([{ kind: "handoff", label: "Support" }]);
  expect(statements.find(([sql]) => sql.startsWith("UPDATE conversations"))?.[0]).toContain("interval '4 hours'");
});

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
    append: vi.fn(async () => {}),
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
    append: vi.fn(async () => {}),
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

it("returns HTTP 413 for oversized conversation JSON", async () => {
  const auth = { identity: vi.fn(async () => customer) };
  const service = createConversationsService({} as any);
  const app = createApp(async () => {}, undefined, undefined, createConversationsRouter(service, auth as any));
  const response = await request(app).post("/api/conversations").auth("customer", { type: "bearer" }).send({ text: "x".repeat(25000) });
  expect(response.status).toBe(413);
});

it("returns outcome_unknown for stale pending claims without rerunning the agent", async () => {
  const row = { id: customer.id, owner_id: customer.id, status: "open" as const, created_at: new Date() };
  const run = vi.fn();
  const repository = { byId: vi.fn(async () => row), admit: vi.fn(async () => "duplicate" as const), completed: vi.fn(async () => ({ state: "outcome_unknown", response: null })) };
  await expect(createConversationsService(repository as any, { run } as any).reply(customer, row.id, "where?", other.id)).rejects.toThrow("outcome_unknown");
  expect(run).not.toHaveBeenCalled();
});

it("rejects rate-limited creates before writing any conversation", async () => {
  const repository = { admit: vi.fn(async () => "busy"), insert: vi.fn(), byId: vi.fn() };
  await expect(createConversationsService(repository as any, { run: vi.fn() } as any).create(customer, { text: "where?", idempotencyKey: other.id })).rejects.toThrow("busy");
  expect(repository.insert).not.toHaveBeenCalled();
  expect(repository.admit).toHaveBeenCalledOnce();
});

it("replays a completed send without invoking the provider twice and rejects changed payloads", async () => {
  const row = { id: customer.id, owner_id: customer.id, status: "open" as const, created_at: new Date() };
  let state: "new" | "duplicate" | "conflict" = "new";
  const repository = {
    insert: vi.fn(), list: vi.fn(), byId: vi.fn(async () => row), messages: vi.fn(async () => []), append: vi.fn(async () => {}),
    admit: vi.fn(async (_owner: string, _id: string, _key: string, text: string) => state === "duplicate" && text !== "where?" ? "conflict" as const : state),
    completed: vi.fn(async () => ({ state: "done", response: { text: "verified", needsClarification: true, options: [{ kind: "handoff", label: "Support" }] } })),
    finish: vi.fn(async () => {}), complete: vi.fn(async () => {}), throttle: vi.fn(async () => true),
    withInvocation: vi.fn(async (_owner: string, _id: string, run: () => Promise<unknown>) => run()),
  };
  const run = vi.fn(async () => ({ text: "verified", activity: [], needsClarification: true, options: [{ kind: "handoff", label: "Support" }] }));
  const service = createConversationsService(repository as any, { run } as any);
  expect(await service.reply(customer, row.id, "where?", other.id)).toMatchObject({ id: row.id, status: "open", text: "verified", needsClarification: true, options: [{ kind: "handoff", label: "Support" }] });
  state = "duplicate";
  expect(await service.reply(customer, row.id, "where?", other.id)).toMatchObject({ id: row.id, status: "open", text: "verified", needsClarification: true, options: [{ kind: "handoff", label: "Support" }] });
  expect(run).toHaveBeenCalledTimes(1);
  await expect(service.reply(customer, row.id, "different", other.id)).rejects.toThrow("invalid");
});

it("admits under an owner row lock and rolls back a throttled create without a claim or message", async () => {
  const statements: string[] = [];
  const client = { query: vi.fn(async (sql: string) => {
    statements.push(sql);
    return { rows: sql.includes("UPDATE chat_send_limits") ? [] : [] };
  }), release: vi.fn() };
  const repository = createConversations({ query: vi.fn(), connect: vi.fn(async () => client) } as any);
  expect(await repository.admit!(customer.id, customer.id, other.id, "question", { id: customer.id, owner_id: customer.id, status: "open", created_at: new Date() })).toBe("busy");
  expect(statements).toContain("SELECT owner_id FROM chat_send_limits WHERE owner_id=$1 FOR UPDATE");
  expect(statements).toContain("ROLLBACK");
  expect(statements.some(sql => sql.startsWith("INSERT INTO conversations"))).toBe(false);
  expect(statements.some(sql => sql.startsWith("INSERT INTO chat_send_claims"))).toBe(false);
  expect(statements.some(sql => sql.startsWith("INSERT INTO conversation_messages"))).toBe(false);
});

it("reuses a duplicate claim before touching the rate budget", async () => {
  const statements: string[] = [];
  const client = { query: vi.fn(async (sql: string) => {
    statements.push(sql);
    return { rows: sql.startsWith("SELECT request_hash") ? [{ request_hash: (await import("node:crypto")).createHash("sha256").update("question").digest("hex") }] : [] };
  }), release: vi.fn() };
  const repository = createConversations({ query: vi.fn(), connect: vi.fn(async () => client) } as any);
  expect(await repository.admit!(customer.id, customer.id, other.id, "question")).toBe("duplicate");
  expect(statements.some(sql => sql.startsWith("UPDATE chat_send_limits"))).toBe(false);
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

it("routes only exact trimmed handoff phrases without provider invocation", async () => {
  const row = { id: customer.id, owner_id: customer.id, status: "open" as const, created_at: new Date() };
  const repository = { byId: vi.fn(async () => row), admit: vi.fn(async () => "new"), messages: vi.fn(async () => []), complete: vi.fn(), finish: vi.fn(), withInvocation: vi.fn(async (_owner: string, _id: string, run: () => Promise<unknown>) => run()) };
  const agent = { run: vi.fn(async () => ({ text: "answer", activity: [] })) };
  const escalation = { handoff: vi.fn(async () => ({ ...row, status: "escalated" })) };
  const service = createConversationsService(repository as any, agent as any, escalation as any);
  await service.reply(customer, row.id, "  I DON'T KNOW  ", other.id);
  expect(agent.run).not.toHaveBeenCalled();
  expect(escalation.handoff).toHaveBeenCalledOnce();
  await service.reply(customer, row.id, "I don't know where it went", support.id);
  expect(agent.run).toHaveBeenCalledOnce();
});

it("retries exact handoff after escalation without a human message and reports resolved honestly", async () => {
  const row = { id: customer.id, owner_id: customer.id, status: "escalated" as "escalated" | "resolved", created_at: new Date(), ticket_id: support.id };
  const repository = { byId: vi.fn(async () => row), admit: vi.fn(async () => "duplicate"), humanMessage: vi.fn(), completed: vi.fn(async () => ({ state: "done", response: { text: "Connected to human support." } })) };
  const escalation = { handoff: vi.fn(async () => row) };
  const service = createConversationsService(repository as any, { run: vi.fn() } as any, escalation);
  expect(await service.reply(customer, row.id, "I don't know", other.id)).toMatchObject({ id: row.id, status: "escalated", clarificationDeadline: null, text: "Connected to human support.", ticketId: support.id });
  expect(repository.humanMessage).not.toHaveBeenCalled();
  row.status = "resolved";
  await expect(service.reply(customer, row.id, "contact support", other.id)).rejects.toThrow("forbidden");
  expect(repository.humanMessage).not.toHaveBeenCalled();
});

it("does not convert unsafe escalated handoff keys into success", async () => {
  const row = { id: customer.id, owner_id: customer.id, status: "escalated" as const, created_at: new Date(), ticket_id: support.id };
  let claim = "duplicate";
  let state = "pending";
  const repository = { byId: vi.fn(async () => row), admit: vi.fn(async () => claim), completed: vi.fn(async () => ({ state, response: { text: "Connected to human support." } })), humanMessage: vi.fn() };
  const service = createConversationsService(repository as any, { run: vi.fn() } as any);
  await expect(service.reply(customer, row.id, "contact support", other.id)).rejects.toThrow("busy");
  state = "outcome_unknown";
  await expect(service.reply(customer, row.id, "contact support", other.id)).rejects.toThrow("outcome_unknown");
  claim = "conflict";
  await expect(service.reply(customer, row.id, "contact support", other.id)).rejects.toThrow("invalid");
  claim = "forbidden";
  await expect(service.reply(customer, row.id, "contact support", support.id)).rejects.toThrow("forbidden");
  expect(repository.humanMessage).not.toHaveBeenCalled();
});

it("does not invoke after a handoff wins the invocation lock", async () => {
  const row = { id: customer.id, owner_id: customer.id, status: "open", created_at: new Date() };
  const repository = { byId: vi.fn(async () => row), admit: vi.fn(async () => "new"), messages: vi.fn(async () => []),
    withInvocation: vi.fn(async (_owner: string, _id: string, _run: () => Promise<unknown>) => { row.status = "escalated"; throw Error("Conversation no longer open"); }), complete: vi.fn() };
  const agent = { run: vi.fn() };
  await expect(createConversationsService(repository as any, agent as any).reply(customer, row.id, "where?", other.id)).rejects.toThrow("outcome_unknown");
  expect(agent.run).not.toHaveBeenCalled();
});

it("requires UUID keys for escalated messages", async () => {
  const row = { id: customer.id, owner_id: customer.id, status: "escalated" as const, created_at: new Date() };
  const repository = { byId: vi.fn(async () => row), humanMessage: vi.fn(async () => "new") };
  const service = createConversationsService(repository as any);
  await expect(service.reply(customer, row.id, "hi", "bad")).rejects.toThrow("invalid");
  expect(repository.humanMessage).not.toHaveBeenCalled();
});

it("deduplicates human retries under conversation lock and rejects changed text", async () => {
  const statements: string[] = [];
  let previous: string | undefined;
  const client = { query: vi.fn(async (sql: string, args?: unknown[]) => {
    statements.push(sql);
    if (sql.startsWith("SELECT status")) return { rows: [{ status: "escalated" }] };
    if (sql.startsWith("SELECT text")) return { rows: previous === undefined ? [] : [{ text: previous }] };
    if (sql.startsWith("INSERT INTO conversation_messages")) previous = args?.[3] as string;
    return { rows: [] };
  }), release: vi.fn() };
  const repository = createConversations({ query: vi.fn(), connect: vi.fn(async () => client) } as any);
  expect(await repository.humanMessage!(customer.id, customer.id, "customer", other.id, "hi")).toBe("new");
  expect(await repository.humanMessage!(customer.id, customer.id, "customer", other.id, "hi")).toBe("duplicate");
  expect(await repository.humanMessage!(customer.id, customer.id, "customer", other.id, "changed")).toBe("conflict");
  expect(statements.filter(sql => sql.startsWith("INSERT INTO conversation_messages"))).toHaveLength(1);
  expect(statements.find(sql => sql.startsWith("SELECT status"))).toContain("FOR UPDATE");
});

it("migrates ticket deletion cascade and persistent human idempotency", async () => {
  const migration = await readFile(new URL("../migrations/016-conversation-handoff-integrity.sql", import.meta.url), "utf8");
  expect(migration).toMatch(/REFERENCES tickets\(id\) ON DELETE CASCADE/);
  expect(migration).toMatch(/UNIQUE INDEX IF NOT EXISTS conversation_human_message_key/);
  const startup = await readFile(new URL("../src/infrastructure/initialize-users.ts", import.meta.url), "utf8");
  expect(startup).toContain('"016-conversation-handoff-integrity.sql"');
});
