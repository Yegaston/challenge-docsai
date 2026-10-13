import { describe, expect, it, vi } from "vitest";
import { createRefreshSessions } from "../src/modules/auth/repositories/refresh-sessions.repository.js";

const created = new Date("2026-01-01T00:00:00Z");
const expires = new Date("2026-01-08T00:00:00Z");

describe("refresh session creation", () => {
  it("locks the owner and caps sessions on one connection before commit", async () => {
    const statements: string[] = [];
    const client = { query: vi.fn(async (sql: string, _values?: unknown[]) => { statements.push(sql); return { rows: [] }; }), release: vi.fn() };
    const database = { query: vi.fn(async () => ({ rows: [] })), connect: vi.fn(async () => client) };
    await createRefreshSessions(database).create("hash", "owner", created, expires);
    expect(statements).toHaveLength(5);
    expect(statements[0]).toBe("BEGIN");
    expect(statements[1]).toMatch(/SELECT .* FROM users WHERE id = \$1 FOR UPDATE/);
    expect(statements[2]).toMatch(/^INSERT INTO refresh_sessions/);
    expect(statements[3]).toMatch(/owner_id = \$1[\s\S]*ORDER BY created_at DESC, secret_hash DESC OFFSET 10/);
    expect(statements[4]).toBe("COMMIT");
    expect(client.query.mock.calls[1][1]).toEqual(["owner"]);
    expect(client.query.mock.calls[2][1]).toEqual(["hash", "owner", created, expires]);
    expect(client.query.mock.calls[3][1]).toEqual(["owner"]);
    expect(database.query).not.toHaveBeenCalled();
    expect(client.release).toHaveBeenCalledOnce();
  });

  it.each(["BEGIN", "lock", "insert", "cleanup", "COMMIT"])("rolls back and releases on %s failure", async (phase) => {
    const labels = ["BEGIN", "lock", "insert", "cleanup", "COMMIT"];
    const statements: string[] = [];
    const client = { query: vi.fn(async (sql: string, _values?: unknown[]) => {
      statements.push(sql);
      if (statements.length === labels.indexOf(phase) + 1) throw new Error(phase);
      return { rows: [] };
    }), release: vi.fn() };
    const database = { query: vi.fn(async () => ({ rows: [] })), connect: vi.fn(async () => client) };
    await expect(createRefreshSessions(database).create("hash", "owner", created, expires)).rejects.toThrow(phase);
    expect(statements.at(-1)).toBe("ROLLBACK");
    if (phase !== "COMMIT") expect(statements).not.toContain("COMMIT");
    expect(client.release).toHaveBeenCalledOnce();
    expect(database.query).not.toHaveBeenCalled();
  });
});
