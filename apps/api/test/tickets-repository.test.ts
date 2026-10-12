import { readFile } from "node:fs/promises";
import { expect, it, vi } from "vitest";
import { createTickets } from "../src/modules/tickets/repositories/tickets.repository.js";
import { createTicketsService } from "../src/modules/tickets/services/tickets.service.js";

it("parameterizes every value, scopes reads, and orders newest-first with a stable ID tie-break", async () => {
  const row = { id: "id'", owner_id: "owner'", text: "text'", created_at: new Date() };
  const query = vi.fn().mockResolvedValue({ rows: [row] });
  const tickets = createTickets({ query });
  expect(await tickets.insert(row)).toEqual(row);
  expect(query.mock.calls[0]).toEqual([
    expect.stringContaining("VALUES ($1, $2, $3, $4)"), [row.id, row.owner_id, row.text, row.created_at],
  ]);
  expect(query.mock.calls[0][0]).toContain("RETURNING id, text, created_at");
  expect(await tickets.list(row.owner_id)).toEqual([row]);
  expect(query.mock.calls[1]).toEqual([
    expect.stringContaining("WHERE owner_id = $1 AND created_at > clock_timestamp() - interval '90 days' ORDER BY created_at DESC, id DESC"), [row.owner_id],
  ]);
  expect(await tickets.byId(row.id, row.owner_id)).toEqual(row);
  expect(query.mock.calls[2]).toEqual([
    expect.stringContaining("WHERE id = $1 AND owner_id = $2"), [row.id, row.owner_id],
  ]);
  for (const [sql] of query.mock.calls) {
    expect(sql).not.toContain("SELECT *");
  }
  query.mockResolvedValueOnce({ rows: [] });
  expect(await tickets.byId("missing", row.owner_id)).toBeUndefined();
});

it("uses the database clock and strict 90-day ticket cutoff for both owner reads, not deletion", async () => {
  const query = vi.fn().mockResolvedValue({ rows: [] });
  const tickets = createTickets({ query });
  await tickets.list("owner");
  await tickets.byId("ticket", "owner");
  for (const [sql] of query.mock.calls) {
    expect(sql).toContain("created_at > clock_timestamp() - interval '90 days'");
    expect(sql).not.toContain("new Date");
  }
  expect(query.mock.calls[0][1]).toEqual(["owner"]);
  expect(query.mock.calls[1][1]).toEqual(["ticket", "owner"]);
});

it("deletes under a transaction-scoped owner lock and destroys uncertain clients", async () => {
  const release = vi.fn();
  const query = vi.fn().mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ locked: true }] })
    .mockResolvedValueOnce({ rows: [{ id: "ticket" }] }).mockResolvedValueOnce({ rows: [] });
  const client = { query, release, on: vi.fn(), removeListener: vi.fn() };
  const tickets = createTickets({ query: vi.fn(), connect: vi.fn().mockResolvedValue(client) });
  expect(await tickets.delete("ticket", "owner")).toBe("deleted");
  expect(query.mock.calls.map(([sql]) => sql)).toEqual([
    "BEGIN", expect.stringContaining("pg_try_advisory_xact_lock(hashtextextended($1, 0))"),
    expect.stringContaining("DELETE FROM tickets WHERE id=$1 AND owner_id=$2 RETURNING id"), "COMMIT",
  ]);
  expect(query.mock.calls[2][1]).toEqual(["ticket", "owner"]);
  expect(release).toHaveBeenCalledWith();
  query.mockReset().mockResolvedValueOnce({ rows: [] }).mockRejectedValueOnce(new Error("timeout"));
  await expect(tickets.delete("ticket", "owner")).rejects.toThrow();
  expect(release).toHaveBeenCalledWith(true);
  query.mockReset().mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ locked: false }] })
    .mockResolvedValueOnce({ rows: [] });
  expect(await tickets.delete("ticket", "owner")).toBe("conflict");
  expect(query.mock.calls.map(([sql]) => sql)).toEqual([
    "BEGIN", expect.stringContaining("pg_try_advisory_xact_lock"), "ROLLBACK",
  ]);
  query.mockReset().mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ locked: true }] })
    .mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] });
  expect(await tickets.delete("ticket", "owner")).toBe("missing");
  expect(query.mock.calls[3][0]).toBe("COMMIT");
});

it("selects bounded expired keys with a strict database-clock boundary and stable cursor, and counts backlog", async () => {
  const query = vi.fn().mockResolvedValue({ rows: [{ count: "3" }] });
  const tickets = createTickets({ query });
  const exact = "2025-01-01 00:00:00.123456+00";
  await tickets.selectExpired({ cursor_created_at: exact, id: "a" }, 25);
  expect(query.mock.calls[0]).toEqual([
    expect.stringContaining("created_at <= clock_timestamp() - interval '90 days'"), [exact, "a", 25],
  ]);
  expect(query.mock.calls[0][0]).toContain("created_at::text AS cursor_created_at");
  expect(query.mock.calls[0][0]).toContain("ORDER BY created_at, id LIMIT $3");
  expect(query.mock.calls[0][0]).toContain("(created_at, id) > ($1::timestamptz, $2)");
  expect(query.mock.calls[0][0]).not.toMatch(/\btext\s*(,|FROM)\b/);
  expect(await tickets.expiredCount()).toBe(3);
  expect(query.mock.calls[1][0]).toContain("created_at <= clock_timestamp() - interval '90 days'");
  await tickets.selectExpired(undefined, 25);
  expect(query.mock.calls[2][1]).toEqual([null, null, 25]);
  const sql = await readFile(new URL("../migrations/005-ticket-retention-index.sql", import.meta.url), "utf8");
  const loader = await readFile(new URL("../src/infrastructure/initialize-users.ts", import.meta.url), "utf8");
  expect(sql).toContain("CREATE INDEX IF NOT EXISTS tickets_retention_cursor_idx ON tickets (created_at, id)");
  expect(loader).toContain('"005-ticket-retention-index.sql"');
});

it("generates UUID/time on the server and maps only public fields", async () => {
  const insert = vi.fn(async (row) => ({ ...row, unexpected: "private" }));
  const service = createTicketsService({ insert, list: vi.fn(), byId: vi.fn() });
  const ticket = await service.create("owner", " help ");
  expect(ticket.id).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
  expect(ticket.createdAt).toBe(new Date(ticket.createdAt).toISOString());
  expect(Object.keys(ticket).sort()).toEqual(["createdAt", "id", "text"]);
  expect(insert.mock.calls[0][0].owner_id).toBe("owner");
});

it("migrates the existing composite foreign key to cascade on every startup", async () => {
  const sql = await readFile(new URL("../migrations/004-ticket-deletion.sql", import.meta.url), "utf8");
  const loader = await readFile(new URL("../src/infrastructure/initialize-users.ts", import.meta.url), "utf8");
  expect(sql).toContain("DROP CONSTRAINT analyses_ticket_id_owner_id_fkey");
  expect(sql).toContain("FOREIGN KEY (ticket_id, owner_id) REFERENCES tickets(id, owner_id) ON DELETE CASCADE");
  expect(sql).toContain("IF NOT EXISTS");
  expect(loader).toContain('"004-ticket-deletion.sql"');
});

it("defines an idempotent owner-linked schema with database bounds and matching index", async () => {
  const sql = await readFile(new URL("../migrations/002-tickets.sql", import.meta.url), "utf8");
  expect(sql).toContain("CREATE TABLE IF NOT EXISTS tickets");
  expect(sql).toContain("REFERENCES users(id)");
  expect(sql).toContain("char_length(text) BETWEEN 1 AND 20000");
  expect(sql).toContain("CREATE INDEX IF NOT EXISTS");
  expect(sql).toContain("(owner_id, created_at DESC, id DESC)");
});
