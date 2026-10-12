import { expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import type { Pool } from "pg";
import { createAnalysesService, AnalysisError } from "../src/modules/analyses/services/analyses.service.js";
import { createAnalysisProvider, ProviderFailure } from "../src/modules/analyses/utils/provider.js";
import { createAnalyses, type AnalysisRecord } from "../src/modules/analyses/repositories/analyses.repository.js";

const id = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const output = { summary: "Original fact", category: "other" as const, uncertaintyNote: null };
function fixture() {
  const rows: AnalysisRecord[] = [];
  const release = vi.fn().mockResolvedValue(undefined);
  const finish = vi.fn(async (attempt: AnalysisRecord) => { rows[rows.length - 1] = attempt; return attempt; });
  const start = vi.fn(async (attempt: AnalysisRecord) => { rows.push(attempt); return { finish, release }; });
  const history = vi.fn(async () => rows);
  const detail = vi.fn().mockResolvedValue({ id, text: "original", createdAt: new Date().toISOString() });
  const generate = vi.fn().mockResolvedValue(output);
  const service = createAnalysesService({ start, history }, { detail }, { model: "test/model", generate });
  return { rows, release, finish, start, history, detail, generate, service };
}
it("audits only durable starts and finishes, without blocking provider or release", async () => {
  const f = fixture(); const record = vi.fn().mockRejectedValue(new Error("PRIVATE"));
  const service = createAnalysesService({ start: f.start, history: f.history }, { detail: f.detail },
    { model: "test", generate: f.generate }, { record });
  await service.analyze("owner", id, undefined);
  expect(record.mock.calls.map(([event]) => event.kind)).toEqual(["analysis_started", "analysis_succeeded"]);
  expect(record.mock.calls[0][0]).toMatchObject({ ownerId: "owner", ticketId: id, analysisId: f.rows[0].id });
  expect(f.generate).toHaveBeenCalledTimes(1); expect(f.release).toHaveBeenCalledTimes(1);
  f.generate.mockRejectedValueOnce(new ProviderFailure("timeout"));
  await expect(service.analyze("owner", id, undefined)).rejects.toMatchObject({ kind: "timeout" });
  expect(record.mock.calls[3][0]).toMatchObject({ kind: "analysis_failed", failureCode: "timeout" });
  expect(JSON.stringify(record.mock.calls)).not.toContain("PRIVATE");
});
it("never waits for pending audit writes before provider or lease release", async () => {
  const f = fixture();
  const record = vi.fn((_event: { kind: string }) => new Promise<void>(() => {}));
  const service = createAnalysesService({ start: f.start, history: f.history }, { detail: f.detail },
    { model: "test", generate: f.generate }, { record });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      service.analyze("owner", id, undefined),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("audit stalled analysis")), 1000); }),
    ]);
    expect(result.status).toBe("succeeded");
    expect(f.generate).toHaveBeenCalledTimes(1);
    expect(f.release).toHaveBeenCalledTimes(1);
    expect(record.mock.calls.map(([event]) => event.kind)).toEqual(["analysis_started", "analysis_succeeded"]);
  } finally { if (timer) clearTimeout(timer); }
});
it("does not claim unpersisted audit states", async () => {
  const f = fixture(); const record = vi.fn();
  const service = createAnalysesService({ start: f.start, history: f.history }, { detail: f.detail },
    { model: "test", generate: f.generate }, { record });
  f.start.mockRejectedValueOnce(new Error("PRIVATE"));
  await expect(service.analyze("owner", id, undefined)).rejects.toMatchObject({ kind: "database" });
  expect(record).not.toHaveBeenCalled();
  f.finish.mockRejectedValueOnce(new Error("PRIVATE"));
  await expect(service.analyze("owner", id, undefined)).rejects.toMatchObject({ kind: "database" });
  expect(record.mock.calls.map(([event]) => event.kind)).toEqual(["analysis_started"]);
});
it("creates immutable versions from original ticket and current trimmed instruction", async () => {
  const f = fixture();
  const first = await f.service.analyze("owner", id, undefined);
  f.generate.mockResolvedValueOnce({ summary: "Refined fact", category: "billing", uncertaintyNote: "Uncertain" });
  const second = await f.service.analyze("owner", id, "  concise  ");
  expect(second).toMatchObject({ summary: "Refined fact", category: "billing", uncertaintyNote: "Uncertain" });
  expect(first.summary).toBe("Original fact");
  expect(first.id).not.toBe(second.id);
  expect(first.status).toBe("succeeded");
  expect(second.instruction).toBe("concise");
  expect(f.generate.mock.calls).toEqual([["original", null], ["original", "concise"]]);
  expect(first).not.toHaveProperty("owner_id");
  expect(first).not.toHaveProperty("ticket_id");
  expect(first.promptVersion).toBe("ticket-analysis-v1");
  expect(first.model).toBe("test/model");
  expect(f.start.mock.calls[0][0]).toMatchObject({ status: "running", summary: null, category: null, uncertainty_note: null });
  expect(f.release).toHaveBeenCalledTimes(2);
});
it.each([null, 1, "", "  ", "x".repeat(2001), "bad\u0000text"])("rejects instruction %j before DB/provider", async (instruction) => {
  const f = fixture();
  await expect(f.service.analyze("owner", id, instruction)).rejects.toMatchObject({ kind: "invalid" });
  expect(f.start).not.toHaveBeenCalled(); expect(f.generate).not.toHaveBeenCalled();
});
it("accepts 2000 UTF16 units and does not count codepoints instead", async () => {
  const f = fixture();
  await f.service.analyze("owner", id, "😀".repeat(1000));
  await expect(f.service.analyze("owner", id, "😀".repeat(1001))).rejects.toMatchObject({ kind: "invalid" });
});
it("propagates owner-scoped invalid/missing tickets before start or model", async () => {
  const f = fixture();
  f.detail.mockRejectedValue(new Error("missing"));
  await expect(f.service.analyze("other", id, undefined)).rejects.toThrow("missing");
  expect(f.detail).toHaveBeenCalledWith("other", id);
  expect(f.start).not.toHaveBeenCalled(); expect(f.generate).not.toHaveBeenCalled();
});
it.each(["timeout", "provider", "invalid_output", "unconfigured"] as const)("persists safe %s failure and allows new retry", async (code) => {
  const f = fixture();
  await f.service.analyze("owner", id, undefined);
  f.generate.mockRejectedValueOnce(new ProviderFailure(code));
  await expect(f.service.analyze("owner", id, "retry")).rejects.toMatchObject({ kind: code,
    analysis: { status: "failed", failureCode: code, summary: null, category: null, uncertaintyNote: null } });
  await f.service.analyze("owner", id, "again");
  expect(f.rows.map((row) => row.status)).toEqual(["succeeded", "failed", "succeeded"]);
  expect(f.release).toHaveBeenCalledTimes(3);
});
it("independently rejects malformed adapter output and hides raw thrown errors", async () => {
  const f = fixture();
  f.generate.mockResolvedValueOnce({ ...output, extra: "private" });
  await expect(f.service.analyze("owner", id, undefined)).rejects.toMatchObject({ kind: "invalid_output" });
  f.generate.mockRejectedValueOnce(new Error("secret credential"));
  await expect(f.service.analyze("owner", id, undefined)).rejects.toMatchObject({ kind: "provider", message: "provider" });
});
it("no paid call after DB start failure; final save fails honestly and releases", async () => {
  const f = fixture();
  f.start.mockRejectedValueOnce(new Error("driver details"));
  await expect(f.service.analyze("owner", id, undefined)).rejects.toMatchObject({ kind: "database" });
  expect(f.generate).not.toHaveBeenCalled();
  f.finish.mockRejectedValueOnce(new Error("driver details"));
  await expect(f.service.analyze("owner", id, undefined)).rejects.toMatchObject({ kind: "database", analysis: undefined });
  expect(f.generate).toHaveBeenCalledTimes(1); expect(f.release).toHaveBeenCalledTimes(1);
  expect(f.rows[0].status).toBe("running");
});
it("failed-attempt final write failure never claims failure persistence and releases", async () => {
  const f = fixture(); f.generate.mockRejectedValueOnce(new ProviderFailure("timeout"));
  f.finish.mockRejectedValueOnce(new Error("private SQL failure"));
  await expect(f.service.analyze("owner", id, undefined)).rejects.toMatchObject({ kind: "database", analysis: undefined });
  expect(f.rows[0].status).toBe("running"); expect(f.release).toHaveBeenCalledTimes(1);
});
it("release failure maps safely without claiming confirmed completion", async () => {
  const f = fixture(); f.release.mockRejectedValueOnce(new Error("private unlock failure"));
  await expect(f.service.analyze("owner", id, undefined)).rejects.toMatchObject({ kind: "database", analysis: undefined });
});
it("real SDK timeout releases concurrency before retry, even on rejected cancellation", async () => {
  const f = fixture();
  const fetcher = vi.fn<typeof fetch>().mockImplementation((_url, options) => new Promise((_resolve, reject) => {
    options!.signal!.addEventListener("abort", () => reject(new Error("private cancellation")));
  }));
  const provider = createAnalysisProvider({ apiKey: "test-only", fetch: fetcher, timeoutMs: 10 });
  const service = createAnalysesService({ start: f.start, history: f.history }, { detail: f.detail }, provider);
  await expect(service.analyze("owner", id, undefined)).rejects.toMatchObject({ kind: "timeout" });
  expect(f.rows[0]).toMatchObject({ status: "failed", failure_code: "timeout" });
  expect(f.release).toHaveBeenCalledTimes(1);
  await f.service.analyze("owner", id, undefined);
  expect(f.rows[1].status).toBe("succeeded");
});
it.each(["success", "timeout"])("connection loss during pending provider %s resumes as safe storage failure", async (outcome) => {
  const f = fixture();
  const query = vi.fn().mockResolvedValue({ rows: [{ created_at: new Date() }] });
  query.mockResolvedValueOnce({ rows: [{ locked: true }] }).mockResolvedValueOnce({ rows: [{ count: "0" }] });
  const release = vi.fn();
  const client = Object.assign(new EventEmitter(), { query, release });
  const pool = { connect: vi.fn().mockResolvedValue(client), query: vi.fn() };
  let entered!: () => void, complete!: () => void;
  const started = new Promise<void>((resolve) => { entered = resolve; });
  const generate = vi.fn(() => {
    entered();
    return new Promise<typeof output>((resolve, reject) => {
      complete = () => outcome === "success" ? resolve(output) : reject(new ProviderFailure("timeout"));
    });
  });
  const service = createAnalysesService(createAnalyses(pool as unknown as Pool), { detail: f.detail }, { model: "test", generate });
  const operation = service.analyze("owner", id, undefined);
  await started;
  expect(() => client.emit("error", new Error("private lost backend"))).not.toThrow();
  complete();
  await expect(operation).rejects.toMatchObject({ kind: "database", message: "database", analysis: undefined });
  expect(query).toHaveBeenCalledTimes(3); // Neither final write nor unlock on a dead client.
  expect(release).toHaveBeenCalledExactlyOnceWith(true);
  expect(generate).toHaveBeenCalledTimes(1);
});
it("limit is safe and prevents provider invocation", async () => {
  const f = fixture(); f.start.mockRejectedValueOnce(new AnalysisError("limit"));
  await expect(f.service.analyze("owner", id, undefined)).rejects.toMatchObject({ kind: "limit" });
  expect(f.generate).not.toHaveBeenCalled();
});
