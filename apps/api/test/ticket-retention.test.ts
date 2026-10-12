import { expect, it, vi } from "vitest";
import { createTicketRetentionService } from "../src/modules/tickets/services/ticket-retention.service.js";
import { startTicketRetention } from "../src/infrastructure/ticket-retention.js";

it("rotates through busy owners, wraps, and reports backlog without content", async () => {
  const rows = [{ id: "a", owner_id: "busy", cursor_created_at: "2025-01-01 00:00:00.000001+00" }, { id: "b", owner_id: "free", cursor_created_at: "2025-01-01 00:00:00.000002+00" }];
  const selectExpired = vi.fn(async (cursor) => cursor ? [] : rows);
  const deleteTicket = vi.fn(async (_id, owner) => owner === "busy" ? "conflict" as const : "deleted" as const);
  const backlog = vi.fn(async () => 1);
  const service = createTicketRetentionService({ selectExpired, delete: deleteTicket, expiredCount: backlog }, 2);
  expect(await service.sweep()).toEqual({ deleted: 1, conflicts: 1, backlog: 1 });
  expect(await service.sweep()).toEqual({ deleted: 0, conflicts: 0, backlog: 1 });
  expect(await service.sweep()).toEqual({ deleted: 1, conflicts: 1, backlog: 1 });
  expect(selectExpired.mock.calls[1][0]).toEqual({ cursor_created_at: rows[1].cursor_created_at, id: "b" });
  expect(deleteTicket).toHaveBeenCalledWith("b", "free");
});

it("advances beyond a locked microsecond-precision row instead of revisiting it", async () => {
  const first = { id: "a", owner_id: "busy", cursor_created_at: "2025-01-01 00:00:00.123456+00" };
  const next = { id: "b", owner_id: "free", cursor_created_at: "2025-01-01 00:00:00.123457+00" };
  const selectExpired = vi.fn(async (cursor) => cursor ? [next] : [first]);
  const deletion = vi.fn(async (_id, owner) => owner === "busy" ? "conflict" as const : "deleted" as const);
  const service = createTicketRetentionService({ selectExpired, delete: deletion, expiredCount: vi.fn(async () => 1) }, 1);
  await service.sweep();
  await service.sweep();
  expect(selectExpired.mock.calls[1][0]).toEqual({ cursor_created_at: first.cursor_created_at, id: "a" });
  expect(deletion.mock.calls.map(([id]) => id)).toEqual(["a", "b"]);
});

it("retries the same candidate after a thrown delete without advancing the cursor", async () => {
  const rows = [{ id: "a", owner_id: "owner", cursor_created_at: "2025-01-01 00:00:00.000001+00" }, { id: "b", owner_id: "owner", cursor_created_at: "2025-01-01 00:00:00.000002+00" }];
  const selectExpired = vi.fn(async (cursor) => cursor ? rows.filter((row) => row.cursor_created_at > cursor.cursor_created_at) : rows);
  const deleteTicket = vi.fn().mockRejectedValueOnce(new Error("database unavailable")).mockResolvedValue("deleted");
  const service = createTicketRetentionService({ selectExpired, delete: deleteTicket, expiredCount: vi.fn(async () => 0) }, 2);
  await expect(service.sweep()).rejects.toThrow("database unavailable");
  await service.sweep();
  expect(selectExpired.mock.calls[1][0]).toBeUndefined();
  expect(deleteTicket.mock.calls.map(([id]) => id)).toEqual(["a", "a", "b"]);
});

it("stops after the in-flight atomic delete and leaves the next candidate for restart", async () => {
  const rows = [{ id: "a", owner_id: "owner", cursor_created_at: "2025-01-01 00:00:00.000001+00" }, { id: "b", owner_id: "owner", cursor_created_at: "2025-01-01 00:00:00.000002+00" }];
  let finish!: (result: "deleted") => void;
  const deletion = new Promise<"deleted">((resolve) => { finish = resolve; });
  const selectExpired = vi.fn(async (cursor) => cursor ? rows.filter((row) => row.cursor_created_at > cursor.cursor_created_at) : rows);
  const deleteTicket = vi.fn().mockReturnValueOnce(deletion).mockResolvedValue("deleted");
  const service = createTicketRetentionService({ selectExpired, delete: deleteTicket, expiredCount: vi.fn(async () => 1) }, 2);
  let tick!: () => void;
  const stop = startTicketRetention(service, {
    setInterval(callback) { tick = callback; return 1 as unknown as ReturnType<typeof setInterval>; },
    clearInterval: vi.fn(),
  }, vi.fn());
  await vi.waitFor(() => expect(deleteTicket.mock.calls.map(([id]) => id)).toEqual(["a"]));
  const waiting = stop();
  finish("deleted");
  await waiting;
  expect(deleteTicket.mock.calls.map(([id]) => id)).toEqual(["a"]);
  tick();
  expect(deleteTicket).toHaveBeenCalledTimes(1);
  await service.sweep();
  expect(selectExpired.mock.calls[1][0]).toEqual({ cursor_created_at: rows[0].cursor_created_at, id: "a" });
  expect(deleteTicket.mock.calls.map(([id]) => id)).toEqual(["a", "b"]);
});

it("runs startup and interval without overlap, drains on shutdown and suppresses errors", async () => {
  let finish!: () => void;
  const sweep = vi.fn().mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }).then(() => ({ deleted: 0, conflicts: 0, backlog: 0 }))).mockRejectedValueOnce(new Error("private"));
  let tick!: () => void;
  const clear = vi.fn();
  const stop = startTicketRetention({ sweep }, { setInterval: (callback) => { tick = callback; return 1 as unknown as ReturnType<typeof setInterval>; }, clearInterval: clear }, vi.fn());
  expect(sweep).toHaveBeenCalledTimes(1);
  tick();
  expect(sweep).toHaveBeenCalledTimes(1);
  const waiting = stop();
  finish();
  await waiting;
  tick();
  expect(sweep).toHaveBeenCalledTimes(1);
  expect(clear).toHaveBeenCalledWith(1);
});

it("retries after a failed sweep and emits only content-free diagnostics", async () => {
  const report = vi.fn();
  let tick!: () => void;
  const sweep = vi.fn().mockRejectedValueOnce(new Error("secret SQL and ticket text"))
    .mockResolvedValueOnce({ deleted: 0, conflicts: 1, backlog: 2 });
  const stop = startTicketRetention({ sweep }, {
    setInterval(callback) { tick = callback; return 1 as unknown as ReturnType<typeof setInterval>; },
    clearInterval: vi.fn(),
  }, report);
  await vi.waitFor(() => expect(report).toHaveBeenCalledTimes(1));
  tick();
  await vi.waitFor(() => expect(report).toHaveBeenCalledTimes(2));
  expect(report.mock.calls).toEqual([
    ["Ticket retention sweep failed; will retry."], ["Ticket retention backlog: 2"],
  ]);
  await stop();
});
