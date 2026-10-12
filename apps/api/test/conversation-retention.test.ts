import { expect, it, vi } from "vitest";
import { createConversationRetention, startConversationRetention } from "../src/infrastructure/conversation-retention.js";

it("deletes only bounded expired conversations and counts the remaining backlog", async () => {
  const query = vi.fn().mockResolvedValueOnce({ rows: [{ count: "100" }] }).mockResolvedValueOnce({ rows: [{ count: "2" }] });
  const result = await createConversationRetention({ query } as any).sweep();
  expect(result).toEqual({ deleted: 100, backlog: 2 });
  expect(query.mock.calls[0][0]).toContain("LIMIT 100 FOR UPDATE SKIP LOCKED");
  expect(query.mock.calls[0][0]).toContain("interval '90 days'");
  expect(query.mock.calls[0][0]).toContain("DELETE FROM conversations");
  expect(query.mock.calls[1][0]).toContain("interval '90 days'");
});

it("starts immediately, retries after failure, and stops the timer", async () => {
  const sweep = vi.fn().mockRejectedValueOnce(Error("offline")).mockResolvedValue({ deleted: 0, backlog: 0 });
  let tick = () => {};
  const clearInterval = vi.fn();
  const stop = startConversationRetention({ sweep }, { setInterval: vi.fn((callback) => { tick = callback; return 1 as any; }), clearInterval } as any, vi.fn());
  await vi.waitFor(() => expect(sweep).toHaveBeenCalledTimes(1));
  await new Promise((resolve) => setTimeout(resolve, 0));
  tick();
  await vi.waitFor(() => expect(sweep).toHaveBeenCalledTimes(2));
  await stop();
  expect(clearInterval).toHaveBeenCalledOnce();
});
