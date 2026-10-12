import { z } from "zod";
import { outputSchema } from "../modules/analyses/utils/output.js";

const category = z.enum(["billing", "account_access", "technical_issue", "other"]);
const fixture = z.object({
  id: z.string().min(1), ticket: z.string().min(1), language: z.string().min(1),
  category, allowedCategories: z.array(category).min(1), uncertainty: z.enum(["present", "absent"]),
}).strict();
const datasetSchema = z.object({ version: z.string().min(1), fixtures: z.array(fixture).min(1) }).strict();
const runSchema = z.object({
  datasetVersion: z.string().min(1), promptVersion: z.string().min(1), model: z.string().min(1),
  samples: z.array(z.object({ id: z.string().min(1), output: z.unknown() }).strict()),
}).strict();

type Fixture = z.infer<typeof fixture>;
type Run = z.infer<typeof runSchema>;
function unique(ids: string[]) {
  if (new Set(ids).size !== ids.length) throw new Error("Duplicate fixture ID");
}
function score(fixtures: Fixture[], run: Run) {
  const samples = new Map(run.samples.map((sample) => [sample.id, sample.output]));
  const perCategoryFailures: Record<string, string[]> = Object.fromEntries(category.options.map((key) => [key, []]));
  let correct = 0;
  const results = fixtures.map((item) => {
    const parsed = outputSchema.safeParse(samples.get(item.id));
    if (!parsed.success) {
      perCategoryFailures[item.category].push(item.id);
      return { id: item.id, status: "invalid_output", category: "fail", uncertainty: "not_evaluable", humanReviewRequired: ["grounding", "warranted_uncertainty", "language_adherence"] };
    }
    const categoryStatus = item.allowedCategories.includes(parsed.data.category) ? "pass" : "fail";
    if (categoryStatus === "pass") correct++;
    else perCategoryFailures[item.category].push(item.id);
    return {
      id: item.id, status: categoryStatus === "pass" ? "valid" : "category_failure", category: categoryStatus,
      uncertainty: (parsed.data.uncertaintyNote === null ? "absent" : "present") === item.uncertainty ? "pass" : "fail",
      humanReviewRequired: ["grounding", "warranted_uncertainty", "language_adherence"],
    };
  });
  return { promptVersion: run.promptVersion, model: run.model, categoryAccuracy: correct / fixtures.length,
    perCategoryFailures, fixtures: results };
}

export function evaluate(datasetInput: unknown, baselineInput: unknown, candidateInput: unknown) {
  // Never include parsed input or validation details in errors: fixtures may be sensitive.
  const dataset = datasetSchema.safeParse(datasetInput);
  const baseline = runSchema.safeParse(baselineInput);
  const candidate = runSchema.safeParse(candidateInput);
  if (!dataset.success || !baseline.success || !candidate.success) throw new Error("Invalid evaluation artifact");
  const fixtures = dataset.data.fixtures;
  unique(fixtures.map((item) => item.id));
  for (const item of fixtures) {
    if (!item.allowedCategories.includes(item.category)) throw new Error("Invalid fixture labels");
  }
  const expected = new Set(fixtures.map((item) => item.id));
  for (const run of [baseline.data, candidate.data]) {
    if (run.datasetVersion !== dataset.data.version) throw new Error("Dataset version mismatch");
    const ids = run.samples.map((item) => item.id);
    unique(ids);
    if (ids.length !== expected.size || ids.some((id) => !expected.has(id))) throw new Error("Fixture ID mismatch");
  }
  const before = score(fixtures, baseline.data);
  const after = score(fixtures, candidate.data);
  return { datasetVersion: dataset.data.version, fixtureCount: fixtures.length, baseline: before, candidate: after,
    delta: { categoryAccuracy: after.categoryAccuracy - before.categoryAccuracy },
    humanReviewRequired: ["grounding", "warranted_uncertainty", "language_adherence"],
    decision: { status: "undecided" as const, reviewer: null, date: null, notes: null } };
}
