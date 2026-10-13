import assert from "node:assert/strict";
import { test, expect, vi } from "vitest";
import { createFixtureRepository, validateFixture } from "../src/modules/transfers/fixtures.js";

test("fixture validation rejects invalid calendar dates, amounts, statuses and extra fields", () => {
  const base = { amount: "25.00", date: "2026-10-12", status: "pending", idempotencyKey: "a1111111-1111-4111-8111-111111111111" };
  const now = new Date("2026-10-12T12:00:00Z");
  assert.deepEqual(validateFixture(base, now), base);
  for (const patch of [{ date: "2026-02-30" }, { date: "2025-01-01" }, { amount: "0.00" }, { amount: "1.001" }, { status: "sent" }, { status: ["pending"] }, { ownerId: "other" }, { idempotencyKey: "bad" }]) {
    assert.equal(validateFixture({ ...base, ...patch }, now), undefined);
  }
});

test("expired retry cannot reveal the old record, and admission remains owner-serialized", async () => {
  const queries: string[] = [];
  const old = { id: "old", amount: "25.00", date: "2026-10-12", status: "pending", createdAt: new Date("2020-01-01"), idempotencyKey: "a1111111-1111-4111-8111-111111111111" };
  const client = { query: vi.fn(async (sql: string) => {
    queries.push(sql);
    if (sql.includes("FROM synthetic_transfers WHERE owner_id=$1 AND idempotency_key=$2")) return { rows: [old] };
    return { rows: [] };
  }), release: vi.fn() };
  const repo = createFixtureRepository({ connect: async () => client } as any);
  await expect(repo.create("owner", { amount: old.amount, date: old.date, status: "pending", idempotencyKey: old.idempotencyKey })).rejects.toThrow();
  expect(queries[0]).toBe("BEGIN");
  expect(queries[1]).toContain("FOR UPDATE");
  expect(queries[2]).toContain("idempotency_key=$2");
  expect(queries).not.toContain("INSERT INTO synthetic_transfers");
});

test("same-key replay precedes cap and changed payload conflicts without insertion", async () => {
  const statements: string[] = [];
  const input = { amount: "25.00", date: "2026-10-12", status: "pending" as const, idempotencyKey: "a1111111-1111-4111-8111-111111111111" };
  const row = { id: "generated", ...input, createdAt: new Date() };
  const client = { query: vi.fn(async (sql: string) => {
    statements.push(sql);
    if (sql.includes("idempotency_key=$2")) return { rows: [row] };
    if (sql.includes("count(*)")) throw new Error("replay queried cap");
    return { rows: [] };
  }), release: vi.fn() };
  const repo = createFixtureRepository({ connect: async () => client } as any);
  expect(await repo.create("owner", input)).toMatchObject({ replay: true, record: { id: "generated" } });
  await expect(repo.create("owner", { ...input, amount: "26.00" })).rejects.toBeInstanceOf(Error);
  expect(statements.filter((sql) => sql.includes("INSERT"))).toEqual([]);
  expect(client.release).toHaveBeenCalledTimes(2);
});

test("owner admission cap and SQL failure release transactions", async () => {
  for (const failure of ["cap", "sql"]) {
    const statements: string[] = [];
    const client = { query: vi.fn(async (sql: string) => {
      statements.push(sql);
      if (sql.includes("count(*)")) {
        if (failure === "sql") throw new Error("database down");
        return { rows: [{ count: "100" }] };
      }
      return { rows: [] };
    }), release: vi.fn() };
    const repo = createFixtureRepository({ connect: async () => client } as any);
    await expect(repo.create("owner", { amount: "25.00", date: "2026-10-12", status: "pending", idempotencyKey: "a1111111-1111-4111-8111-111111111111" })).rejects.toBeInstanceOf(Error);
    expect(statements.slice(0, 3)).toEqual(["BEGIN", "SELECT id FROM users WHERE id=$1 FOR UPDATE", expect.stringContaining("idempotency_key=$2")]);
    expect(statements).toContain("ROLLBACK"); expect(statements.some((sql) => sql.includes("INSERT"))).toBe(false);
    expect(client.release).toHaveBeenCalledOnce();
  }
});

test("list filters by owner and age with stable newest-first ordering", async () => {
  const query = vi.fn(async (_sql: string, _params?: unknown[]) => ({ rows: [{ id: "new", amount: "25.00", date: "2026-10-12", status: "pending", createdAt: new Date(), idempotencyKey: "private" }] }));
  const records = await createFixtureRepository({ query } as any).list("owner");
  expect(records[0]).not.toHaveProperty("idempotencyKey");
  expect(query.mock.calls[0][0]).toContain("owner_id=$1 AND created_at >= now() - interval '90 days' ORDER BY created_at DESC, id DESC LIMIT 100");
  expect(query.mock.calls[0][1]).toEqual(["owner"]);
});

test("purge batches every expired transfer including seeded IDs", async () => {
  const query = vi.fn(async (_sql: string) => ({ rows: [] }));
  await createFixtureRepository({ query } as any).purge();
  expect(query).toHaveBeenCalledOnce();
  expect(query.mock.calls[0][0]).toContain("LIMIT 100 FOR UPDATE SKIP LOCKED");
  expect(query.mock.calls[0][0]).not.toContain("NOT IN");
});
