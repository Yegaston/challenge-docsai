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
    expect.stringContaining("WHERE owner_id = $1 ORDER BY created_at DESC, id DESC"), [row.owner_id],
  ]);
  expect(await tickets.byId(row.id, row.owner_id)).toEqual(row);
  expect(query.mock.calls[2]).toEqual([
    expect.stringContaining("WHERE id = $1 AND owner_id = $2"), [row.id, row.owner_id],
  ]);
  for (const [sql] of query.mock.calls) {
    expect(sql).not.toContain("'");
    expect(sql).not.toContain("SELECT *");
  }
  query.mockResolvedValueOnce({ rows: [] });
  expect(await tickets.byId("missing", row.owner_id)).toBeUndefined();
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

it("defines an idempotent owner-linked schema with database bounds and matching index", async () => {
  const sql = await readFile(new URL("../migrations/002-tickets.sql", import.meta.url), "utf8");
  expect(sql).toContain("CREATE TABLE IF NOT EXISTS tickets");
  expect(sql).toContain("REFERENCES users(id)");
  expect(sql).toContain("char_length(text) BETWEEN 1 AND 20000");
  expect(sql).toContain("CREATE INDEX IF NOT EXISTS");
  expect(sql).toContain("(owner_id, created_at DESC, id DESC)");
});
