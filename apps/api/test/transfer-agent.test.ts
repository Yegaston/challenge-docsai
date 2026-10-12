import { expect, it, vi } from "vitest";
import { createTransferAgent } from "../src/modules/conversations/services/transfer-agent.js";
import { createTransfers } from "../src/modules/transfers/transfers.js";

import { MockLanguageModelV3 } from "ai/test";
const toolCall = (id: string, name = "get_transfer_status") => ({ type: "tool-call" as const, toolCallId: id, toolName: name, input: JSON.stringify(name === "find_transfers" ? { amount: "25.00", date: "2026-01-01" } : { id: row.id }) });
const response = (...content: any[]) => ({ content, warnings: [], finishReason: { unified: "tool-calls" as const, raw: "tool_calls" }, usage: { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } } });

it("runs real SDK clarification, ambiguity and owner-scoped tool decisions without raw activity", async () => {
  const find = vi.fn(async () => [row, { ...row, id: "a2222222-2222-4222-8222-222222222222" }]);
  const status = vi.fn(async () => undefined);
  const model = new MockLanguageModelV3({ doGenerate: [response({ type: "text", text: "Please clarify" }), response(toolCall("one", "find_transfers")), response({ type: "text", text: "Done" }), response(toolCall("two")), response({ type: "text", text: "Done" })] });
  const agent = createTransferAgent({ model }, { find, status });
  const missing = await agent.run("owner-a", "where?", []);
  expect(missing.text).toContain("provide");
  expect(find).not.toHaveBeenCalled();
  const ambiguous = await agent.run("owner-a", "25.00 on 2026-01-01", []);
  expect(ambiguous.text).toContain("transfer ID");
  expect(find).toHaveBeenCalledWith("owner-a", "25.00", "2026-01-01");
  expect(JSON.stringify(ambiguous.activity)).not.toMatch(/25\.00|2026-01-01|a1111111|a2222222/);
  const foreign = await agent.run("owner-b", `status ${row.id}`, []);
  expect(foreign.text).toContain("provide");
  expect(status).toHaveBeenCalledWith("owner-b", row.id);
  expect(JSON.stringify(foreign)).not.toContain("pending");
});

it("bounds attempted tool calls and rejects provider failures without claiming success", async () => {
  const find = vi.fn(async () => [row]);
  const status = vi.fn(async () => row);
  const model = new MockLanguageModelV3({ doGenerate: [response(toolCall("one"), toolCall("two"), toolCall("three")), response({ type: "text", text: "success" })] });
  await expect(createTransferAgent({ model }, { find, status }).run("owner", "status", [])).rejects.toThrow("agent_unavailable");
  expect(status).toHaveBeenCalledTimes(2);
  const rejected = new MockLanguageModelV3({ doGenerate: async () => { throw Error("provider rejected"); } });
  await expect(createTransferAgent({ model: rejected }, { find, status }).run("owner", "status", [])).rejects.toThrow("agent_unavailable");
  const timedOut = new MockLanguageModelV3({ doGenerate: async () => { throw new DOMException("deadline exceeded", "TimeoutError"); } });
  await expect(createTransferAgent({ model: timedOut }, { find, status }).run("owner", "status", [])).rejects.toThrow("agent_unavailable");
});

it("bounds both transfer queries with the pool statement timeout", async () => {
  const query = vi.fn(async (_config: unknown) => { throw new Error("statement timeout"); });
  const lookup = createTransfers({ query } as any);
  await expect(lookup.find("owner", "25.00", "2026-01-01")).rejects.toThrow("statement timeout");
  await expect(lookup.status("owner", "transfer-id")).rejects.toThrow("statement timeout");
  expect(query).toHaveBeenCalledTimes(2);
  for (const [configuration] of query.mock.calls) {
    expect(configuration).toEqual(expect.objectContaining({ statement_timeout: 12000 }));
  }
});

const row = { id: "a1111111-1111-4111-8111-111111111111", amount: "25.00", date: "2026-01-01", status: "pending" };
