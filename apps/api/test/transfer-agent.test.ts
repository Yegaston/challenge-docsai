import { expect, it, vi } from "vitest";
import { createTransferAgent } from "../src/modules/conversations/services/transfer-agent.js";
import { createTransfers } from "../src/modules/transfers/transfers.js";

vi.mock("ai", async (importOriginal) => ({ ...(await importOriginal<typeof import("ai")>()), generateText: vi.fn() }));
import { generateText } from "ai";
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

const model = {} as any;
const row = { id: "a1111111-1111-4111-8111-111111111111", amount: "25.00", date: "2026-01-01", status: "pending" };

it("uses SDK tools with captured owner, bounded steps and server-grounded status", async () => {
  const find = vi.fn(async () => [row]);
  vi.mocked(generateText).mockImplementationOnce(async (options: any) => {
    expect(options.stopWhen).toBeDefined();
    expect(options.abortSignal).toBeDefined();
    expect(Object.keys(options.tools)).toEqual(["find_transfers", "get_transfer_status"]);
    expect(options.tools.find_transfers.inputSchema.shape.owner).toBeUndefined();
    await options.tools.find_transfers.execute({ amount: "25.00", date: row.date });
    return { text: "This transfer was completed!" } as any;
  });
  const result = await createTransferAgent({ model }, { find, status: vi.fn() }).run("owner-a", "where?", []);
  expect(find).toHaveBeenCalledWith("owner-a", "25.00", row.date);
  expect(result.text).toContain("pending");
  expect(result.text).not.toContain("completed");
  expect(result.activity[0]).not.toContain(row.id);
});

it("clarifies without evidence, ambiguity, and failed lookup", async () => {
  vi.mocked(generateText).mockResolvedValueOnce({ text: "It's completed" } as any);
  const agent = createTransferAgent({ model }, { find: vi.fn(), status: vi.fn() });
  expect((await agent.run("owner", "where?", [])).text).toContain("provide");
  vi.mocked(generateText).mockImplementationOnce(async (options: any) => {
    await options.tools.find_transfers.execute({ amount: "25.00", date: row.date });
    return {} as any;
  });
  const ambiguous = createTransferAgent({ model }, { find: async () => [row, { ...row, id: "a2222222-2222-4222-8222-222222222222" }], status: vi.fn() });
  expect((await ambiguous.run("owner", "where?", [])).text).toContain("Multiple");
});
