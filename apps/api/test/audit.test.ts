import { readFile } from "node:fs/promises";
import { expect, it, vi } from "vitest";
import { createAuditRepository } from "../src/modules/audit/repositories/audit.repository.js";
import { createAuditService } from "../src/modules/audit/services/audit.service.js";

it("stores only typed owner-scoped event fields through parameterized SQL", async () => {
  const query = vi.fn(async () => ({ rows: [], rowCount: 1 }));
  const repository = createAuditRepository({ query } as never);
  await repository.insert({ kind: "ticket_deleted", ownerId: "owner-id", ticketId: "ticket-id" });
  expect(query).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO audit_events"),
    ["owner-id", "ticket-id", "ticket_deleted", null, null]);
  expect(JSON.stringify(query.mock.calls)).not.toContain("PRIVATE_TICKET_SENTINEL");
});

it("stores analysis identifiers and bounded failure codes without content", async () => {
  const query = vi.fn();
  await createAuditRepository({ query } as never).insert({ kind: "analysis_failed", ownerId: "owner", ticketId: "ticket", analysisId: "attempt", failureCode: "timeout" });
  expect(query.mock.calls[0][1]).toEqual(["owner", "ticket", "analysis_failed", "attempt", "timeout"]);
});

it("records wrong-answer metadata without the explanation", async () => {
  const query = vi.fn();
  await createAuditRepository({ query } as never).insert({ kind: "wrong_answer_reported", ownerId: "owner", ticketId: "ticket", analysisId: "analysis" });
  expect(query.mock.calls[0][1]).toEqual(["owner", "ticket", "wrong_answer_reported", "analysis", null]);
  expect(JSON.stringify(query.mock.calls)).not.toContain("PRIVATE_SENTINEL");
});

it("upgrades 006 once without revalidating the full audit table at each restart", async () => {
  const sql = await readFile(new URL("../migrations/007-audit-retention.sql", import.meta.url), "utf8");
  expect(sql).toMatch(/IF NOT EXISTS \(SELECT 1 FROM pg_constraint/);
  expect(sql).toMatch(/audit_events_created_at_id_idx.*created_at, id/);
  expect(sql).toContain("analysis_started");
  expect(sql).toContain("analysis_succeeded");
  expect(sql).toContain("analysis_failed");
  expect(sql).not.toMatch(/\bVALIDATE CONSTRAINT\b/);
});

it("swallows synchronous and asynchronous audit failures with content-free diagnostics", async () => {
  const diagnostic = vi.fn();
  const service = createAuditService({ insert: () => { throw new Error("PRIVATE_ERROR_SENTINEL"); } }, diagnostic);
  await expect(service.record({ kind: "ticket_list", ownerId: "owner-id" })).resolves.toBeUndefined();
  expect(diagnostic).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(diagnostic.mock.calls)).not.toContain("PRIVATE_ERROR_SENTINEL");
});

it("defines owner-indexed audit metadata without a ticket FK or content payload", async () => {
  const sql = await readFile(new URL("../migrations/006-audit-events.sql", import.meta.url), "utf8");
  expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS audit_events/i);
  expect(sql).toMatch(/CREATE INDEX IF NOT EXISTS .*owner_id/i);
  expect(sql).not.toMatch(/REFERENCES tickets|\b(jsonb?|text|payload|instruction|output|token|secret)\b/i);
});
