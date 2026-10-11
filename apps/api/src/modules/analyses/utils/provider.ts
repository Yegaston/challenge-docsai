import { generateText, NoObjectGeneratedError, Output } from "ai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { buildPrompt } from "./prompt.js";
import { outputSchema } from "./output.js";

export type FailureCode = "timeout" | "provider" | "invalid_output" | "unconfigured";
export class ProviderFailure extends Error {
  constructor(public readonly code: FailureCode) { super(code); }
}
export type AnalysisProvider = ReturnType<typeof createAnalysisProvider>;
export function createAnalysisProvider(options: { apiKey?: string; model?: string; fetch?: typeof fetch; timeoutMs?: number }) {
  const model = options.model?.trim() || "z-ai/glm-5.3-flash";
  return {
    model,
    async generate(ticket: string, instruction: string | null) {
      if (!options.apiKey?.trim()) throw new ProviderFailure("unconfigured");
      const signal = AbortSignal.timeout(options.timeoutMs ?? 60000);
      try {
        const router = createOpenRouter({ apiKey: options.apiKey, fetch: options.fetch });
        const result = await generateText({
          model: router.chat(model, { provider: { allow_fallbacks: false, require_parameters: true } }),
          ...buildPrompt(ticket, instruction),
          output: Output.object({ schema: outputSchema }),
          maxRetries: 0, maxOutputTokens: 1800, abortSignal: signal,
        });
        const parsed = outputSchema.safeParse(result.output);
        if (!parsed.success) throw new ProviderFailure("invalid_output");
        return parsed.data;
      } catch (error) {
        // Never retain raw provider payloads, request headers or SDK errors.
        if (signal.aborted) throw new ProviderFailure("timeout");
        if (error instanceof ProviderFailure) throw error;
        throw new ProviderFailure(NoObjectGeneratedError.isInstance(error) ? "invalid_output" : "provider");
      }
    },
  };
}
