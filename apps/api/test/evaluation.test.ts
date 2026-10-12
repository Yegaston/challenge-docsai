import { describe, expect, it } from "vitest";
import { evaluate } from "../src/evaluation/evaluate.js";

const dataset = { version: "v1", fixtures: [
  { id: "a", ticket: "Invoice question", language: "en", category: "billing", allowedCategories: ["billing"], uncertainty: "absent" },
  { id: "b", ticket: "Maybe login or server", language: "en", category: "account_access", allowedCategories: ["account_access", "technical_issue"], uncertainty: "present" },
] };
const output = (category: string, uncertaintyNote: string | null = null) => ({ summary: "Synthetic summary", category, uncertaintyNote });
const sample = (id: string, result: unknown) => ({ id, output: result });
const run = (samples: unknown[]) => ({ datasetVersion: "v1", promptVersion: "ticket-analysis-v1", model: "offline-example", samples });

describe("offline evaluation", () => {
  it("matches fixture IDs regardless of order and reports regressions", () => {
    const report = evaluate(dataset, run([sample("b", output("technical_issue", "Unclear")), sample("a", output("billing"))]),
      run([sample("a", output("other")), sample("b", output("account_access"))]));
    expect(report.baseline.categoryAccuracy).toBe(2 / 2);
    expect(report.candidate.categoryAccuracy).toBe(1 / 2);
    expect(report.delta.categoryAccuracy).toBe(-1 / 2);
    expect(report.candidate.perCategoryFailures.billing).toEqual(["a"]);
    expect(report.candidate.fixtures.find((item) => item.id === "b")?.uncertainty).toBe("fail");
    expect(report.decision.status).toBe("undecided");
    expect(report.humanReviewRequired).toContain("grounding");
  });

  it("rejects malformed output without guessing missing or extra fields", () => {
    const report = evaluate(dataset, run([sample("a", { summary: "ok", category: "billing" }), sample("b", output("account_access", "Maybe"))]),
      run([sample("a", { ...output("billing"), extra: true }), sample("b", { ...output("account_access"), summary: " " })]));
    expect(report.baseline.fixtures[0].status).toBe("invalid_output");
    expect(report.candidate.fixtures.every((item) => item.status === "invalid_output")).toBe(true);
  });

  it("rejects duplicate, missing, unknown and mismatched fixture IDs or versions", () => {
    const valid = run([sample("a", output("billing")), sample("b", output("account_access", "Maybe"))]);
    for (const samples of [[valid.samples[0]], [valid.samples[0], valid.samples[0]], [...valid.samples, sample("c", output("other"))]]) {
      expect(() => evaluate(dataset, run(samples), valid)).toThrow();
    }
    expect(() => evaluate(dataset, { ...valid, datasetVersion: "v2" }, valid)).toThrow();
    expect(() => evaluate({ ...dataset, fixtures: [dataset.fixtures[0], dataset.fixtures[0]] }, valid, valid)).toThrow();
  });
});
