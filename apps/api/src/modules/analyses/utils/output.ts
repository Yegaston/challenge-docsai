import { z } from "zod";

const boundedText = (maximum: number) => z.string().min(1).max(maximum)
  .refine((value) => Boolean(value.trim()) && !value.includes("\u0000"), "Invalid narrative");
export const outputSchema = z.object({
  summary: boundedText(2000),
  category: z.enum(["billing", "account_access", "technical_issue", "other"]),
  uncertaintyNote: boundedText(1000).nullable(),
}).strict();
export type AnalysisOutput = z.infer<typeof outputSchema>;
