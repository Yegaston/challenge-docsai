import { describe, expect, it, vi } from "vitest";
import { createUsers, hashPassword, seedDemoUser, verifyPassword } from "../src/demo-user.js";

describe("password hashing", () => {
  it("uses versioned random salts and verifies only the correct password", async () => {
    const first = await hashPassword("synthetic-password");
    const second = await hashPassword("synthetic-password");
    expect(first.startsWith("scrypt-v1$")).toBe(true);
    expect(first !== second).toBe(true);
    expect(first.includes("synthetic-password")).toBe(false);
    expect(await verifyPassword("synthetic-password", first)).toBe(true);
    expect(await verifyPassword("incorrect-password", first)).toBe(false);
  });

  it.each(["", "scrypt-v2$00$00", "scrypt-v1$00$00", "scrypt-v1$zz$zz"])("rejects malformed stored hash %s", async (hash) => {
    expect(await verifyPassword("synthetic-password", hash)).toBe(false);
  });
});

describe("demo persistence", () => {
  it("runs schema before a parameterized conflict-safe seed, preserving the first identity/hash", async () => {
    let stored: { id: string; email: string; password_hash: string } | undefined;
    const query = vi.fn(async (sql: string, values?: unknown[]) => {
      if (sql.startsWith("INSERT")) {
        expect(sql).toContain("ON CONFLICT (email) DO NOTHING");
        expect(sql).not.toContain("demo@example.test");
        if (!stored) stored = { id: values![0] as string, email: values![1] as string, password_hash: values![2] as string };
      }
      return { rows: stored ? [stored] : [] };
    });
    await seedDemoUser({ query }, " DEMO@example.test ", "synthetic-password");
    const original = stored!;
    await seedDemoUser({ query }, "demo@example.test", "changed-password");
    expect(query.mock.calls[0][0]).toContain("CREATE TABLE IF NOT EXISTS users");
    expect(stored === original).toBe(true);
    expect(await verifyPassword("synthetic-password", stored!.password_hash)).toBe(true);
    expect(await verifyPassword("changed-password", stored!.password_hash)).toBe(false);
    expect(stored!.id).toMatch(/^[a-f0-9-]{36}$/);
    expect(stored!.email).toBe("demo@example.test");
  });

  it.each([["invalid", "synthetic-password"], ["demo@example.test", "short"], ["demo@example.test", "x".repeat(257)]])("rejects invalid seed configuration before database work", async (email, password) => {
    const query = vi.fn();
    await expect(seedDemoUser({ query }, email, password)).rejects.toThrow("DEMO_EMAIL and DEMO_PASSWORD");
    expect(query).not.toHaveBeenCalled();
  });

  it("looks up users through parameterized queries", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const users = createUsers({ query });
    expect(await users.byEmail("demo@example.test")).toBeUndefined();
    expect(await users.byId("00000000-0000-4000-8000-000000000001")).toBeUndefined();
    expect(query.mock.calls[0]).toEqual([expect.stringContaining("email = $1"), ["demo@example.test"]]);
    expect(query.mock.calls[1]).toEqual([expect.stringContaining("id = $1"), ["00000000-0000-4000-8000-000000000001"]]);
  });
});
