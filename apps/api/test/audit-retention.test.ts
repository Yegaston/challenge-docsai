import { expect, it, vi } from "vitest";
import { createAuditRetention, startAuditRetention } from "../src/infrastructure/audit-retention.js";

it("deletes only a bounded old batch with database clock and reports remaining backlog", async () => {
  const query = vi.fn().mockResolvedValueOnce({ rows: [{ count: "100" }] }).mockResolvedValueOnce({ rows: [{ count: "1" }] });
  expect(await createAuditRetention({ query } as never).sweep()).toEqual({ deleted: 100, backlog: 1 });
  expect(query.mock.calls[0][0]).toMatch(/LIMIT 100/);
  expect(query.mock.calls[0][0]).toMatch(/interval '180 days'/);
  expect(query.mock.calls[0][0]).not.toMatch(/\$1/);
});

it("starts immediately, retries without overlap, and stops its own timer", async () => {
  let tick!: () => void;
  let resolve!: (value: { deleted: number; backlog: number }) => void;
  const sweep = vi.fn().mockImplementationOnce(() => new Promise((done) => { resolve = done; })).mockRejectedValueOnce(new Error("PRIVATE"));
  const clearInterval = vi.fn();
  const report = vi.fn();
  const stop = startAuditRetention({ sweep }, { setInterval: (callback) => { tick = callback; return 1 as never; }, clearInterval }, report);
  tick(); expect(sweep).toHaveBeenCalledTimes(1);
  resolve({ deleted: 100, backlog: 1 });
  await vi.waitFor(() => expect(report).toHaveBeenCalledWith("Audit retention deleted: 100; backlog: 1"));
  tick(); await vi.waitFor(() => expect(sweep).toHaveBeenCalledTimes(2));
  await vi.waitFor(() => expect(report).toHaveBeenCalledWith("Audit retention sweep failed; will retry."));
  expect(JSON.stringify(report.mock.calls)).not.toContain("PRIVATE");
  await stop(); tick(); expect(sweep).toHaveBeenCalledTimes(2); expect(clearInterval).toHaveBeenCalledTimes(1);
});
