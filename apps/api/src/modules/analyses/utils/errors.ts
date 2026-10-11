import type { FailureCode } from "./provider.js";

export class AnalysisError extends Error {
  constructor(public readonly kind: FailureCode | "invalid" | "limit" | "database", public readonly analysis?: unknown) {
    super(kind);
  }
}
