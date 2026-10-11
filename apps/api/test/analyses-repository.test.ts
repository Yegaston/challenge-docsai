import { expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import type { Pool } from "pg";
import { createAnalyses, type AnalysisRecord } from "../src/modules/analyses/repositories/analyses.repository.js";
import { readFile } from "node:fs/promises";

const row: AnalysisRecord = { id: "attempt", owner_id: "owner", ticket_id: "ticket", status: "running", model: "model",
  prompt_version: "v1", instruction: null, created_at: new Date(), completed_at: null,
  summary: null, category: null, uncertainty_note: null, failure_code: null };
function fixture(locked = true, count = "0") {
  const query = vi.fn().mockResolvedValue({ rows: [row] });
  query.mockResolvedValueOnce({ rows: [{ locked }] }).mockResolvedValueOnce({ rows: [{ count }] });
  const release = vi.fn();
  const client = Object.assign(new EventEmitter(), { query, release });
  const pool = { connect: vi.fn().mockResolvedValue(client), query: vi.fn().mockResolvedValue({ rows: [] }) };
  return { client, query, release, pool, repository: createAnalyses(pool as unknown as Pool) };
}
it("holds nonblocking per-user lock through durable start/final save and releases", async () => {
  const f = fixture(true, "4");
  const lease = await f.repository.start({ ...row });
  expect(f.release).not.toHaveBeenCalled();
  expect(f.query.mock.calls[0][0]).toContain("pg_try_advisory_lock");
  expect(f.query.mock.calls[1][0]).toContain("interval '1 minute'");
  expect(f.query.mock.calls[2][0]).toContain("INSERT INTO analyses");
  expect(f.query.mock.calls[2][1]).toEqual(["attempt", "ticket", "owner", "model", "v1", null]);
  await lease.finish({ ...row, status: "failed", failure_code: "timeout" });
  expect(f.query.mock.calls[3][1]).toEqual(["attempt", "owner", "ticket", "failed", null, null, null, "timeout"]);
  await lease.release();
  expect(f.query.mock.calls[4][0]).toContain("pg_advisory_unlock");
  expect(f.release).toHaveBeenCalledTimes(1);
});
it.each([[false, "0"], [true, "5"], [true, "6"]])("blocks lock=%s count=%s without insert and releases", async (locked, count) => {
  const f = fixture(locked as boolean, count as string);
  await expect(f.repository.start({ ...row })).rejects.toMatchObject({ kind: "limit" });
  expect(f.query.mock.calls.some(([sql]) => sql.includes("INSERT"))).toBe(false);
  expect(f.release).toHaveBeenCalledTimes(1);
});
it.each(["lock", "count", "insert"])("destroys client after %s DB error, including uncertain lock acquisition", async (stage) => {
  const f = fixture(); f.query.mockReset();
  if (stage !== "lock") f.query.mockResolvedValueOnce({ rows: [{ locked: true }] });
  if (stage === "insert") f.query.mockResolvedValueOnce({ rows: [{ count: "0" }] });
  f.query.mockRejectedValueOnce(new Error("private DB failure"));
  await expect(f.repository.start({ ...row })).rejects.toThrow();
  expect(f.release).toHaveBeenCalledWith(true);
});
it("destroys client if unlock fails", async () => {
  const g = fixture(); const lease = await g.repository.start({ ...row });
  g.query.mockRejectedValueOnce(new Error("DB unlock failure"));
  await expect(lease.release()).rejects.toMatchObject({ kind: "database" });
  expect(g.release).toHaveBeenCalledWith(true);
});
it("serializes same-user starts, permits other users and counts five durable attempts", async () => {
  const active = new Set<string>(), counts = new Map<string, number>();
  const pool = { query: vi.fn(), connect: vi.fn(async () => Object.assign(new EventEmitter(), { release: vi.fn(),
    query: vi.fn(async (sql: string, values: string[]) => {
      const owner = values[0];
      if (sql.includes("pg_try_advisory_lock")) {
        const locked = !active.has(owner); if (locked) active.add(owner);
        return { rows: [{ locked }] };
      }
      if (sql.includes("pg_advisory_unlock")) { active.delete(owner); return { rows: [] }; }
      if (sql.includes("count(*)")) return { rows: [{ count: String(counts.get(owner) ?? 0) }] };
      if (sql.includes("INSERT")) counts.set(values[2], (counts.get(values[2]) ?? 0) + 1);
      return { rows: [{ ...row, created_at: new Date() }] };
    }),
  })) };
  const repository = createAnalyses(pool as unknown as Pool);
  const first = await repository.start({ ...row });
  await expect(repository.start({ ...row })).rejects.toMatchObject({ kind: "limit" });
  const other = await repository.start({ ...row, owner_id: "another" });
  await other.release(); await first.release();
  for (let index = 1; index < 5; index++) {
    const lease = await repository.start({ ...row }); await lease.release();
  }
  await expect(repository.start({ ...row })).rejects.toMatchObject({ kind: "limit" });
  expect(counts.get("owner")).toBe(5); expect(active.size).toBe(0);
});
it("destroys a client after final-write failure rather than recycling uncertain I/O", async () => {
  const f = fixture(); const lease = await f.repository.start({ ...row });
  f.query.mockRejectedValueOnce(new Error("private final-write failure"));
  await expect(lease.finish({ ...row, status: "failed", failure_code: "timeout" })).rejects.toThrow();
  await expect(lease.release()).rejects.toMatchObject({ kind: "database" });
  expect(f.release).toHaveBeenCalledWith(true);
});
it("handles idle-between-queries connection loss, blocks finish and retains late-error protection", async () => {
  const f = fixture(); const lease = await f.repository.start({ ...row });
  expect(() => f.client.emit("error", new Error("private backend termination"))).not.toThrow();
  await expect(lease.finish({ ...row })).rejects.toMatchObject({ kind: "database", message: "database" });
  expect(f.query).toHaveBeenCalledTimes(3);
  await expect(lease.release()).rejects.toMatchObject({ kind: "database" });
  await expect(lease.release()).rejects.toMatchObject({ kind: "database" });
  expect(f.release).toHaveBeenCalledExactlyOnceWith(true);
  expect(() => f.client.emit("error", new Error("late private error"))).not.toThrow();
});
it.each([0, 1, 2, 3, 4])("classifies connection error during query phase %s without unsafe follow-up", async (phase) => {
  const f = fixture(); f.query.mockReset();
  const results = [{ locked: true }, { count: "0" }, row, row, row];
  f.query.mockImplementation(async () => {
    const index = f.query.mock.calls.length - 1;
    if (index === phase) f.client.emit("error", new Error("private connection loss"));
    return { rows: [results[index]] };
  });
  if (phase < 3) await expect(f.repository.start({ ...row })).rejects.toMatchObject({ kind: "database" });
  else {
    const lease = await f.repository.start({ ...row });
    if (phase === 3) await expect(lease.finish({ ...row })).rejects.toMatchObject({ kind: "database" });
    else await lease.finish({ ...row });
    await expect(lease.release()).rejects.toMatchObject({ kind: "database" });
  }
  expect(f.query).toHaveBeenCalledTimes(phase + 1);
  expect(f.release).toHaveBeenCalledExactlyOnceWith(true);
});
it("healthy concurrent cleanup releases once and transfers listener ownership without a gap", async () => {
  const f = fixture(); const idleError = vi.fn();
  f.release.mockImplementation(() => {
    expect(f.client.listenerCount("error")).toBeGreaterThan(0);
    f.client.on("error", idleError); // pg-pool restores its listener synchronously.
  });
  const lease = await f.repository.start({ ...row });
  await Promise.all([lease.release(), lease.release()]);
  expect(f.release).toHaveBeenCalledTimes(1);
  expect(f.client.listeners("error")).toEqual([idleError]);
  f.client.emit("error", new Error("idle error")); expect(idleError).toHaveBeenCalledTimes(1);
  await expect(lease.finish({ ...row })).rejects.toMatchObject({ kind: "database" });
  expect(f.query).toHaveBeenCalledTimes(4);
});
it("scopes history by ticket AND owner with stable ordering", async () => {
  const f = fixture(); await f.repository.history("owner", "ticket");
  expect(f.pool.query.mock.calls[0][1]).toEqual(["owner", "ticket"]);
  expect(f.pool.query.mock.calls[0][0]).toContain("t.owner_id=a.owner_id");
  expect(f.pool.query.mock.calls[0][0]).toContain("ORDER BY a.created_at, a.id");
});
it("migration preserves existing tables and enforces status/output consistency", async () => {
  const sql = await readFile(new URL("../migrations/003-analyses.sql", import.meta.url), "utf8");
  expect(sql).toContain("CREATE TABLE IF NOT EXISTS analyses");
  expect(sql).toContain("REFERENCES tickets(id, owner_id)");
  expect(sql).toContain("status = 'succeeded'");
  expect(sql).toContain("status = 'failed'");
  expect(sql).not.toMatch(/DROP|DELETE|TRUNCATE/);
});
