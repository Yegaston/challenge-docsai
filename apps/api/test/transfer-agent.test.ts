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
  expect(foreign.text).toContain("not found in your synthetic transfers");
  expect(status).toHaveBeenCalledWith("owner-b", row.id);
  expect(JSON.stringify(foreign)).not.toContain("pending");
});

it("bounds SDK recent-transfer tool to today and the authenticated owner", async () => {
  const today = new Date().toISOString().slice(0, 10);
  const recent = vi.fn(async () => [row]);
  const model = new MockLanguageModelV3({ doGenerate: [response({ type: "tool-call", toolCallId: "recent", toolName: "recent_transfers", input: JSON.stringify({ date: today }) }), response({ type: "text", text: "paid" })] });
  const result = await createTransferAgent({ model }, { find: vi.fn(), status: vi.fn(), recent }).run("owner-a", "Transferencia enviada hoy", []);
  expect(recent).toHaveBeenCalledOnce();
  expect(recent).toHaveBeenCalledWith("owner-a", today);
  expect(result.text).not.toContain("pending");
  expect(result.options?.[0]).toMatchObject({ kind: "transfer", id: row.id });
});

it("keeps no-fact English clarification and only confirms the requested owner transfer ID", async () => {
  const recent = vi.fn(async () => []);
  const status = vi.fn(async (owner: string) => owner === "owner-a" ? row : undefined);
  const model = new MockLanguageModelV3({ doGenerate: [response({ type: "text", text: "completed" }), response(toolCall("one")), response({ type: "text", text: "completed" }), response(toolCall("two")), response({ type: "text", text: "completed" })] });
  const agent = createTransferAgent({ model }, { find: vi.fn(), status, recent });
  const empty = await agent.run("owner-a", "My transfer sent today is missing", []);
  expect(empty.options).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "details" })]));
  expect(empty.text).toContain("provide its amount");
  expect(JSON.stringify(empty)).not.toContain("completed");
  const confirmed = await agent.run("owner-a", `Check ${row.id}`, []);
  expect(confirmed.text).toContain("pending");
  const foreign = await agent.run("owner-b", `Check ${row.id}`, []);
  expect(foreign.text).not.toContain("pending");
  expect(status).toHaveBeenCalledWith("owner-b", row.id);
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

it("all owner-scoped agent lookups exclude records older than the creation cutoff", async () => {
  const query = vi.fn(async (_config: { text: string }) => ({ rows: [] }));
  const lookup = createTransfers({ query } as any);
  await lookup.find("owner", "25.00", "2026-01-01");
  await lookup.recent!("owner", "2026-01-01");
  await lookup.status("owner", row.id);
  expect(query).toHaveBeenCalledTimes(3);
  for (const [config] of query.mock.calls) {
    expect(config.text).toContain("owner_id = $1");
    expect(config.text).toContain("created_at >= now() - interval '90 days'");
  }
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

it("offers owner-scoped synthetic candidates without asserting a status for Spanish today", async () => {
  const recent = vi.fn(async () => [row, { ...row, id: "a2222222-2222-4222-8222-222222222222" }]);
  const model = new MockLanguageModelV3({ doGenerate: response({ type: "text", text: "Your transfer is completed" }) });
  const agent = createTransferAgent({ model }, { find: vi.fn(), status: vi.fn(), recent });
  const result = await agent.run("owner-a", "no me acreditaron una trasnferiancia q me enviaron hoy", []);
  expect(recent).toHaveBeenCalledWith("owner-a", expect.any(String));
  expect(result.text).toMatch(/transferencia/i);
  expect(result.text).not.toMatch(/completed|pending/);
  expect(result.options?.filter(option => option.kind === "transfer")).toHaveLength(2);
  expect(result.options?.length).toBeLessThanOrEqual(5);
  expect(result.options).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "handoff" })]));
  expect(result.needsClarification).toBe(true);
});

it("falls back to owner-scoped recent lookup when model supplies the wrong day", async () => {
  const recent = vi.fn(async () => [row]);
  const model = new MockLanguageModelV3({ doGenerate: [response({ type: "tool-call", toolCallId: "wrong", toolName: "recent_transfers", input: JSON.stringify({ date: "2020-01-01" }) }), response({ type: "text", text: "done" })] });
  const result = await createTransferAgent({ model }, { find: vi.fn(), status: vi.fn(), recent }).run("owner-a", "Transferencia enviada hoy", []);
  expect(recent).toHaveBeenCalledWith("owner-a", new Date().toISOString().slice(0, 10));
  expect(result.options?.[0]).toMatchObject({ kind: "transfer", id: row.id });
});

it("grounds Spanish explicit ID status and does not classify English me as Spanish", async () => {
  const status = vi.fn(async () => row);
  const model = new MockLanguageModelV3({ doGenerate: [response(toolCall("one")), response({ type: "text", text: "done" }), response(toolCall("two")), response({ type: "text", text: "done" })] });
  const agent = createTransferAgent({ model }, { find: vi.fn(), status });
  expect((await agent.run("owner-a", `Estado de transferencia ${row.id}`, [])).text).toMatch(/transferencia sintética.*pendiente/i);
  expect((await agent.run("owner-a", "Help me find a transfer", [])).text).toMatch(/synthetic transfers|Please provide/i);
});

it("checks one exact seeded UUID without any model call, including Spanish and unavailable provider", async () => {
  const seeded = { ...row, id: "a3333333-3333-4333-8333-333333333333" };
  const status = vi.fn(async (owner: string, id: string) => owner === "owner-a" && id === seeded.id ? seeded : undefined);
  const doGenerate = vi.fn(async () => response({ type: "text", text: "unverified" }));
  const model = new MockLanguageModelV3({ doGenerate });
  const lookup = { find: vi.fn(), status };
  const agent = createTransferAgent({ model }, lookup);
  const result = await agent.run("owner-a", `Estado de transferencia ${seeded.id}`, []);
  expect(result).toMatchObject({ needsClarification: false });
  expect(result.text).toMatch(/transferencia sintética.*pendiente/i);
  expect(JSON.stringify(result.activity)).not.toMatch(/a3333333|25\.00|pending/);
  expect((await createTransferAgent({ model: undefined as never }, lookup).run("owner-a", `Check ${seeded.id}`, [])).text).toContain("pending");
  for (const [owner, id] of [["owner-b", seeded.id], ["owner-a", "a4444444-4444-4444-8444-444444444444"]]) {
    const missing = await agent.run(owner, `Check ${id}`, []);
    expect(missing.text).toContain("not found in your synthetic transfers");
    expect(missing.text).not.toMatch(/provide.*ID|pending|25\.00/i);
    expect(missing).toMatchObject({ needsClarification: true });
    expect(missing.options).toEqual(expect.arrayContaining([{ kind: "details", label: "Provide amount and date" }, { kind: "handoff", label: "Contact support" }]));
  }
  const spanishMissing = await agent.run("owner-b", `Estado de transferencia ${seeded.id}`, []);
  expect(spanishMissing.options).toEqual(expect.arrayContaining([{ kind: "details", label: "Indicar importe y fecha" }, { kind: "handoff", label: "Hablar con soporte" }]));
  expect(status).toHaveBeenCalledWith("owner-a", seeded.id);
  expect(status).toHaveBeenCalledWith("owner-b", seeded.id);
  expect(doGenerate).not.toHaveBeenCalled();
  await expect(createTransferAgent({ model: undefined as never }, lookup).run("owner-a", "where?", [])).rejects.toThrow("agent_unavailable");
});

it("asks which of two distinct UUIDs without a lookup or model invocation", async () => {
  const status = vi.fn();
  const doGenerate = vi.fn();
  const agent = createTransferAgent({ model: new MockLanguageModelV3({ doGenerate }) }, { find: vi.fn(), status });
  const result = await agent.run("owner-a", `Check ${row.id} and a3333333-3333-4333-8333-333333333333`, []);
  expect(result.text).toMatch(/choose one/i);
  expect(result.needsClarification).toBe(true);
  expect(result.options).toEqual(expect.arrayContaining([{ kind: "details", label: "Choose one transfer ID" }, { kind: "handoff", label: "Contact support" }]));
  const spanish = await agent.run("owner-a", `Estado de transferencia ${row.id} y a3333333-3333-4333-8333-333333333333`, []);
  expect(spanish.options).toEqual(expect.arrayContaining([{ kind: "details", label: "Elegir un ID de transferencia" }, { kind: "handoff", label: "Hablar con soporte" }]));
  expect(status).not.toHaveBeenCalled();
  expect(doGenerate).not.toHaveBeenCalled();
});

const row = { id: "a1111111-1111-4111-8111-111111111111", amount: "25.00", date: "2026-01-01", status: "pending" };
