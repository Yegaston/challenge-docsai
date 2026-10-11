import { expect, it, vi } from "vitest";
import { createAnalysisProvider, ProviderFailure } from "../src/modules/analyses/utils/provider.js";

const output = { summary: "Fact", category: "other", uncertaintyNote: null };
function completion(content = JSON.stringify(output)) {
  return new Response(JSON.stringify({ id: "mock", model: "test/model", created: 1,
    choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
    usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
  }), { headers: { "Content-Type": "application/json" } });
}
it("uses real SDK JSON encoding/parsing, bounded generation and disabled fallbacks", async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(completion());
  const provider = createAnalysisProvider({ apiKey: "test-only", model: "test/model", fetch: fetcher });
  expect(await provider.generate("original", "current")).toEqual(output);
  const body = JSON.parse(fetcher.mock.calls[0][1]!.body as string);
  expect(body.model).toBe("test/model");
  expect(body.messages.map((message: { role: string }) => message.role)).toEqual(["system", "user"]);
  expect(JSON.parse(body.messages[1].content)).toEqual({ ticket: "original", instruction: "current" });
  expect(body.response_format.type).toBe("json_schema");
  expect(body.max_tokens).toBe(1800);
  expect(body.provider.allow_fallbacks).toBe(false);
  expect(body.tools).toBeUndefined();
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it.each(["not json", JSON.stringify({ ...output, extra: "untrusted" }), JSON.stringify({ ...output, summary: "\u0000" })])(
  "rejects real SDK invalid output without retaining raw response", async (content) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(completion(content));
    await expect(createAnalysisProvider({ apiKey: "test-only", fetch: fetcher }).generate("original", null))
      .rejects.toMatchObject({ code: "invalid_output", message: "invalid_output" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
it("does not retry provider failures", async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response("private provider failure", { status: 503 }));
  await expect(createAnalysisProvider({ apiKey: "test-only", fetch: fetcher }).generate("original", null))
    .rejects.toMatchObject({ code: "provider", message: "provider" });
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it("hides network rejection and never retries it", async () => {
  const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error("private transport failure"));
  await expect(createAnalysisProvider({ apiKey: "test-only", fetch: fetcher }).generate("original", null))
    .rejects.toMatchObject({ code: "provider", message: "provider" });
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it("aborts actual SDK fetch and returns safe timeout with no retry", async () => {
  let aborted = false;
  const fetcher = vi.fn<typeof fetch>().mockImplementation((_url, options) => new Promise((_resolve, reject) => {
    options!.signal!.addEventListener("abort", () => { aborted = true; reject(new Error("raw secret error")); });
  }));
  await expect(createAnalysisProvider({ apiKey: "test-only", fetch: fetcher, timeoutMs: 20 }).generate("original", null))
    .rejects.toMatchObject({ code: "timeout" });
  expect(aborted).toBe(true);
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it("missing key is lazy, safe and never uses a fake result", async () => {
  const fetcher = vi.fn<typeof fetch>();
  const provider = createAnalysisProvider({ fetch: fetcher });
  expect(provider.model).toBe("z-ai/glm-5.3-flash");
  await expect(provider.generate("ticket", null)).rejects.toEqual(new ProviderFailure("unconfigured"));
  expect(fetcher).not.toHaveBeenCalled();
});
