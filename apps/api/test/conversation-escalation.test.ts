import { expect, it, vi } from "vitest";
import { createConversations } from "../src/modules/conversations/repositories/conversations.repository.js";
import { createConversationsService } from "../src/modules/conversations/services/conversations.service.js";
import { createConversationEscalation } from "../src/infrastructure/conversation-escalation.js";

const id = "00000000-0000-4000-8000-000000000001";
const customer = { id, role: "customer" as const };
const support = { id: "00000000-0000-4000-8000-000000000002", role: "support" as const };

it("orders invocation and handoff advisory locks before status or row access and releases on failure", async () => {
  const statements: string[] = [];
  const client = { query: vi.fn(async (sql: string) => { statements.push(sql); if (sql.startsWith("SELECT status")) return { rows: [{ status: "open" }] }; return { rows: [] }; }), release: vi.fn() };
  const database = { connect: vi.fn(async () => client), query: vi.fn() };
  const repository = createConversations(database as any);
  await expect(repository.withInvocation!(id, id, async () => { statements.push("PROVIDER"); throw Error("provider failed"); })).rejects.toThrow("provider failed");
  expect(statements.findIndex(s => s.includes("pg_advisory_xact_lock"))).toBeLessThan(statements.findIndex(s => s.startsWith("SELECT status")));
  expect(statements.indexOf("PROVIDER")).toBeGreaterThan(statements.findIndex(s => s.startsWith("SELECT status")));
  expect(statements).toContain("ROLLBACK");
  expect(client.release).toHaveBeenCalledOnce();
  statements.length = 0;
  await createConversationEscalation(database as any).handoff(id);
  expect(statements.findIndex(s => s.includes("pg_advisory_xact_lock"))).toBeLessThan(statements.findIndex(s => s.startsWith("SELECT id, owner_id")));
  statements.length = 0;
  await repository.resolve!(id, id);
  expect(statements.findIndex(s => s.includes("pg_advisory_xact_lock"))).toBeLessThan(statements.findIndex(s => s.startsWith("UPDATE conversations")));
});

it("schedules only persisted clarification and cancels on reply before model work", async () => {
  const sql: string[] = [];
  const client = { query: vi.fn(async (statement: string) => {
    sql.push(statement);
    if (statement.startsWith("SELECT status")) return { rows: [{ status: "open" }] };
    if (statement.startsWith("SELECT state")) return { rows: [{ state: "pending" }] };
    return { rows: [] };
  }), release: vi.fn() };
  const repository = createConversations({ query: vi.fn(), connect: vi.fn(async () => client) } as any);
  await repository.complete!(id, id, support.id, [], { text: "clarify", needsClarification: true });
  expect(sql.find(s => s.includes("clarification_deadline"))).toContain("interval '4 hours'");
  expect(sql.indexOf("COMMIT")).toBeGreaterThan(sql.findIndex(s => s.includes("clarification_deadline")));
});

it("does not call AI for human mode, and keeps support outside open conversations", async () => {
  const row = { id, owner_id: id, status: "escalated" as const, created_at: new Date(), clarification_deadline: null, ticket_id: support.id };
  const repository = { byId: vi.fn(async (_id: string, owner: string, role: string) => role === "support" || owner === id ? row : undefined), humanMessage: vi.fn(async () => true), list: vi.fn(async () => [row]) };
  const agent = { run: vi.fn() };
  const service = createConversationsService(repository as any, agent as any);
  await service.reply(customer, id, "hello", support.id);
  await service.reply(support, id, "hi", support.id);
  expect(repository.humanMessage).toHaveBeenCalledTimes(2);
  expect(agent.run).not.toHaveBeenCalled();
  row.status = "open" as never;
  await expect(service.reply(support, id, "hi", support.id)).rejects.toThrow();
});

it("checks due deadlines against database time in both selection and locked recheck", async () => {
  const queries: string[] = [];
  const client = { query: vi.fn(async (sql: string) => { queries.push(sql); return { rows: [] }; }), release: vi.fn() };
  const worker = createConversationEscalation({ connect: vi.fn(async () => client) } as any);
  await worker.handoff(id);
  await worker.sweep();
  expect(queries.find(sql => sql.startsWith("SELECT id, owner_id"))).toContain("clarification_deadline <= clock_timestamp()");
  expect(queries.find(sql => sql.startsWith("SELECT id FROM conversations"))).toContain("clarification_deadline <= clock_timestamp()");
});

it("uses locked, bounded due claims and an idempotent linked ticket", async () => {
  const queries: string[] = [];
  const client = { query: vi.fn(async (sql: string) => { queries.push(sql); return { rows: [] }; }), release: vi.fn() };
  const sweep = createConversationEscalation({ connect: vi.fn(async () => client) } as any);
  await sweep.sweep();
  expect(queries.join(" ")).toMatch(/FOR UPDATE SKIP LOCKED/);
  expect(queries.join(" ")).toMatch(/LIMIT 100/);
  expect(queries.join(" ")).toMatch(/clarification_deadline <=/);
});
