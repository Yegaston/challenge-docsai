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
it("migration is idempotent, cascades with analysis and extends both guarded audit constraints", async () => {
  const sql = await readFile(new URL("../migrations/008-wrong-answer-reports.sql", import.meta.url), "utf8");
  expect(sql).toContain("CREATE TABLE IF NOT EXISTS wrong_answer_reports");
  expect(sql).toMatch(/REFERENCES analyses\(id\) ON DELETE CASCADE/);
  expect(sql).toMatch(/UNIQUE \(owner_id, analysis_id\)/);
  expect(sql).toMatch(/char_length\(btrim\(explanation\)\) BETWEEN 1 AND 2000/);
  expect(sql).toContain("audit_report_shape");
  expect(sql).toContain("wrong_answer_reported");
});
