import { readFile } from "node:fs/promises";
import { expect, it, vi } from "vitest";
import { createReportsRepository } from "../src/modules/reports/repositories/reports.repository.js";

const owner = "00000000-0000-4000-8000-000000000001";
const ticket = "00000000-0000-4000-8000-000000000002";
const analysis = "00000000-0000-4000-8000-000000000003";
it("atomically inserts only a succeeded version of the owner's live ticket", async () => {
  const query = vi.fn(async (_sql: string, _values?: unknown[]) => ({ rows: [{ id: analysis, status: "open", created_at: new Date() }] }));
  await createReportsRepository({ query } as never).create(owner, ticket, analysis, "wrong category");
  expect(query.mock.calls[0][0]).toMatch(/INSERT INTO wrong_answer_reports[\s\S]*SELECT[\s\S]*analyses[\s\S]*tickets/);
  expect(query.mock.calls[0][0]).toMatch(/a\.status = 'succeeded'/);
  expect(query.mock.calls[0][0]).toMatch(/t\.created_at > CURRENT_TIMESTAMP - INTERVAL '90 days'/);
  expect(query.mock.calls[0][1]).toEqual([expect.any(String), owner, ticket, analysis, "wrong category"]);
});
it("returns missing without a match and lists only live owner tickets", async () => {
  const query = vi.fn(async (_sql: string, _values?: unknown[]) => ({ rows: [] }));
  const repo = createReportsRepository({ query } as never);
  expect(await repo.create(owner, ticket, analysis, "wrong")).toBeUndefined();
  expect(await repo.list(owner, ticket)).toBeUndefined();
  expect(query.mock.calls[1][0]).toMatch(/FROM tickets[\s\S]*created_at > CURRENT_TIMESTAMP - INTERVAL '90 days'/);
  expect(query.mock.calls[1][1]).toEqual([owner, ticket]);
});
it("returns an empty report list for a live ticket without reports", async () => {
  const query = vi.fn(async () => ({ rows: [{ id: null }] }));
  expect(await createReportsRepository({ query } as never).list(owner, ticket)).toEqual([]);
});
it("guards append and history by owner, report, ticket and DB expiry while preserving earlier rows", async () => {
  const query = vi.fn(async (_sql: string, _values?: unknown[]) => ({ rows: [{ id: analysis, report_id: analysis, correction: "one", created_at: new Date() }] }));
  const repo = createReportsRepository({ query } as never);
  await repo.appendCorrection(owner, ticket, analysis, "two");
  expect(query.mock.calls[0][0]).toMatch(/INSERT INTO report_corrections[\s\S]*SELECT[\s\S]*eligible/);
  expect(query.mock.calls[0][0]).toContain("SET status = 'reviewed'");
  expect(query.mock.calls[0][0]).toContain("FOR UPDATE OF r");
  expect(query.mock.calls[0][0]).toContain("clock_timestamp() - INTERVAL '90 days'");
  expect(query.mock.calls[0][1]).toEqual([owner, ticket, analysis, expect.any(String), "two"]);
  await repo.listCorrections(owner, ticket, analysis);
  expect(query.mock.calls[1][0]).toContain("ORDER BY c.created_at, c.id");
  expect(query.mock.calls[1][1]).toEqual([owner, ticket, analysis]);
  expect(query.mock.calls[1][0]).not.toMatch(/UPDATE|DELETE/);
});
it("migration guards recognize successor audit shapes on replay", async () => {
  const migration = async (version: string) => readFile(new URL(`../migrations/${version}`, import.meta.url), "utf8");
  const seven = await migration("007-audit-retention.sql");
  const eight = await migration("008-wrong-answer-reports.sql");
  const nine = await migration("009-report-corrections.sql");
  expect(seven).toMatch(/IF NOT EXISTS \(SELECT 1 FROM pg_constraint WHERE conname IN \('audit_analysis_shape', 'audit_report_shape', 'audit_review_shape'\)/);
  expect(eight).toMatch(/IF NOT EXISTS \(SELECT 1 FROM pg_constraint WHERE conname IN \('audit_report_shape', 'audit_review_shape'\)/);
  expect(nine).toMatch(/ADD CONSTRAINT audit_report_shape CHECK \(kind IN \([\s\S]*?'wrong_answer_reviewed'\)\)/);
  expect(nine).toContain("ADD CONSTRAINT audit_review_shape CHECK");
});
it("migration 009 guards review status, correction cascade, bounds and metadata-only audit", async () => {
  const sql = await readFile(new URL("../migrations/009-report-corrections.sql", import.meta.url), "utf8");
  expect(sql).toContain("CREATE TABLE IF NOT EXISTS report_corrections");
  expect(sql).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS \w+ ON wrong_answer_reports \(id, owner_id\)/);
  expect(sql).toMatch(/report_id uuid NOT NULL,[\s\S]*owner_id uuid NOT NULL,[\s\S]*FOREIGN KEY \(report_id, owner_id\) REFERENCES wrong_answer_reports\(id, owner_id\) ON DELETE CASCADE/);
  expect(sql).not.toMatch(/owner_id uuid NOT NULL REFERENCES users\(id\)/);
  expect(sql).toContain("char_length(btrim(correction)) BETWEEN 1 AND 2000");
  expect(sql).toContain("report_review_status_shape");
  expect(sql).toContain("audit_review_shape");
  expect(sql).toContain("wrong_answer_reviewed");
});
it("migration is idempotent, cascades with analysis and extends both guarded audit constraints", async () => {
  const sql = await readFile(new URL("../migrations/008-wrong-answer-reports.sql", import.meta.url), "utf8");
  expect(sql).toContain("CREATE TABLE IF NOT EXISTS wrong_answer_reports");
  expect(sql).toMatch(/REFERENCES analyses\(id\) ON DELETE CASCADE/);
  expect(sql).toMatch(/UNIQUE \(owner_id, analysis_id\)/);
  expect(sql).toMatch(/char_length\(btrim\(explanation\)\) BETWEEN 1 AND 2000/);
  expect(sql).toContain("audit_report_shape");
  expect(sql).toContain("wrong_answer_reported");
});
