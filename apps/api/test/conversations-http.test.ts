import { expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { streamConversation } from "../src/modules/conversations/http/stream.js";
import request from "supertest";
import { createApp } from "../src/app.js";
import { createConversationsRouter } from "../src/modules/conversations/http/controller.js";
import { AuthError } from "../src/modules/auth/services/auth.service.js";
import { ConversationError, createConversationsService } from "../src/modules/conversations/services/conversations.service.js";

const id = "00000000-0000-4000-8000-000000000001";
const key = "00000000-0000-4000-8000-000000000002";
const auth = { identity: vi.fn(async (token: string) => {
  if (token === "customer") return { id, role: "customer" };
  if (token === "support") return { id, role: "support" };
  throw new AuthError("invalid-session");
}) };
const appFor = (service: object) => createApp(async () => {}, undefined, undefined, createConversationsRouter(service as any, auth as any));
const events = (body: string) => body.trim().split("\n\n").map(block => {
  const lines = block.split("\n");
  return { event: lines[0].slice(7), data: JSON.parse(lines[1].slice(6)) };
});

it("streams checking before service and Unicode graphemes only after persistence, then structured completion", async () => {
  let resolve!: (value: any) => void;
  const create = vi.fn(() => new Promise<any>(done => { resolve = done; }));
  const app = appFor({ create });
  const pending = request(app).post("/api/conversations/stream").auth("customer", { type: "bearer" }).send({ text: "hi", idempotencyKey: key });
  const result = new Promise<{ status: number; text: string }>((done, reject) => {
    pending.buffer(false).parse((response, callback) => {
      let text = "";
      response.on("data", chunk => {
        text += chunk.toString();
        if (text.includes("event: status")) {
          expect(create).toHaveBeenCalledWith({ id, role: "customer" }, { text: "hi", idempotencyKey: key });
          resolve({ id, status: "open", text: "👩🏽‍💻é", options: [{ kind: "handoff", label: "Help" }], clarificationDeadline: null });
        }
      });
      response.on("end", () => { done({ status: response.statusCode!, text }); callback(null, text); });
      response.on("error", reject);
    }).end();
  });
  const response = await result;
  const frames = events(response.text);
  expect(response.status).toBe(200);
  expect(frames[0]).toEqual({ event: "status", data: { state: "checking" } });
  expect(frames.filter(frame => frame.event === "delta").map(frame => frame.data.text)).toEqual(["👩🏽‍💻", "é"]);
  expect(frames.at(-1)).toEqual({ event: "done", data: { id, status: "open", options: [{ kind: "handoff", label: "Help" }], clarificationDeadline: null } });
});

it("reports service failures safely after checking without a success frame", async () => {
  const app = appFor({ create: vi.fn(async () => { throw Error("private tool payload"); }) });
  const response = await request(app).post("/api/conversations/stream").auth("customer", { type: "bearer" }).send({ text: "hi", idempotencyKey: key });
  expect(events(response.text).map(frame => frame.event)).toEqual(["status", "error"]);
  expect(response.text).not.toContain("private tool payload");
});

it("rejects unauthenticated, support and malformed requests before opening SSE", async () => {
  const create = vi.fn();
  const app = appFor({ create });
  expect((await request(app).post("/api/conversations/stream").send({ text: "hi", idempotencyKey: key })).status).toBe(401);
  expect((await request(app).post("/api/conversations/stream").auth("support", { type: "bearer" }).send({ text: "hi", idempotencyKey: key })).status).toBe(403);
  expect((await request(app).post("/api/conversations/stream").auth("customer", { type: "bearer" }).send({ text: "hi", idempotencyKey: "bad" })).status).toBe(400);
  expect((await request(app).post("/api/conversations/stream").auth("customer", { type: "bearer" }).send({ text: "x".repeat(25000), idempotencyKey: key })).status).toBe(413);
  expect(create).not.toHaveBeenCalled();
});

it("replays a completed key through the service without another generation", async () => {
  const run = vi.fn();
  const row = { id, owner_id: id, status: "open" as const, created_at: new Date() };
  const repository = { byId: vi.fn(async () => row), messages: vi.fn(async () => []), admit: vi.fn(async () => "duplicate"), completed: vi.fn(async () => ({ state: "done", response: { text: "Saved", id, status: "open", clarificationDeadline: null } })) };
  const service = createConversationsService(repository as any, { run } as any);
  const app = appFor(service);
  const response = await request(app).post(`/api/conversations/${id}/messages/stream`).auth("customer", { type: "bearer" }).send({ text: "hi", idempotencyKey: key });
  expect(events(response.text).filter(frame => frame.event === "delta").map(frame => frame.data.text).join("")).toBe("Saved");
  expect(run).not.toHaveBeenCalled();
  expect(repository.admit).toHaveBeenCalledWith(id, id, key, "hi", undefined);
});

it("rejects foreign or missing replies before SSE headers and never admits work", async () => {
  for (const error of ["missing", "forbidden"] as const) {
    const reply = vi.fn();
    const app = appFor({ detail: vi.fn(async () => { throw new (await import("../src/modules/conversations/services/conversations.service.js")).ConversationError(error); }), reply });
    const response = await request(app).post(`/api/conversations/${id}/messages/stream`).auth("customer", { type: "bearer" }).send({ text: "hi", idempotencyKey: key });
    expect(response.status).toBe(error === "missing" ? 404 : 403);
    expect(response.headers["content-type"]).not.toContain("text/event-stream");
    expect(reply).not.toHaveBeenCalled();
  }
});

it("rejects escalated human messages before SSE admission with JSON-route guidance", async () => {
  const reply = vi.fn();
  const app = appFor({ detail: vi.fn(async () => ({ id, status: "escalated" })), replayHandoff: vi.fn(async () => { throw new ConversationError("human_mode"); }), reply });
  const response = await request(app).post(`/api/conversations/${id}/messages/stream`).auth("customer", { type: "bearer" }).send({ text: "hello", idempotencyKey: key });
  expect(response.status).toBe(409);
  expect(response.body).toEqual({ error: "human_mode", instruction: "Use the JSON messages route for human support." });
  expect(response.headers["content-type"]).not.toContain("text/event-stream");
  expect(reply).not.toHaveBeenCalled();
});

it("never routes an open-preflight stream race into human messages", async () => {
  const row = { id, owner_id: id, status: "escalated" as const, created_at: new Date() };
  const repository = { byId: vi.fn(async () => row), humanMessage: vi.fn(), admit: vi.fn() };
  const service = createConversationsService(repository as any, { run: vi.fn() } as any);
  const app = appFor({ ...service, detail: vi.fn(async () => ({ status: "open" })) });
  const response = await request(app).post(`/api/conversations/${id}/messages/stream`).auth("customer", { type: "bearer" }).send({ text: "hello", idempotencyKey: key });
  expect(events(response.text).map(frame => frame.event)).toEqual(["status", "error"]);
  expect(events(response.text).at(-1)?.data).toMatchObject({ code: "human_mode" });
  expect(repository.humanMessage).not.toHaveBeenCalled();
  expect(repository.admit).not.toHaveBeenCalled();
});

it("streams a durable handoff snapshot including linked ticket", async () => {
  const row = { id, owner_id: id, status: "open" as const, created_at: new Date() };
  const escalated = { ...row, status: "escalated" as const, ticket_id: key };
  const repository = { byId: vi.fn().mockResolvedValueOnce(row).mockResolvedValueOnce(row).mockResolvedValue(escalated), admit: vi.fn(async () => "new"), finish: vi.fn(async () => {}), messages: vi.fn(async () => []) };
  const service = createConversationsService(repository as any, { run: vi.fn() } as any, { handoff: vi.fn(async () => escalated) });
  const response = await request(appFor(service)).post(`/api/conversations/${id}/messages/stream`).auth("customer", { type: "bearer" }).send({ text: "contact support", idempotencyKey: key });
  expect(events(response.text).at(-1)).toEqual({ event: "done", data: { id, status: "escalated", clarificationDeadline: null, ticketId: key } });
  expect(repository.finish).toHaveBeenCalledWith(id, id, key, { text: "Connected to human support." });
});

it("returns the same durable handoff snapshot in JSON and SSE when handoff wins after stream preflight", async () => {
  const open = { id, owner_id: id, status: "open" as const, created_at: new Date(), clarification_deadline: new Date("2025-01-01") };
  const escalated = { ...open, status: "escalated" as const, clarification_deadline: null, ticket_id: key };
  let reads = 0;
  const repository = {
    byId: vi.fn(async () => ++reads === 1 ? open : escalated),
    messages: vi.fn(async () => []), admit: vi.fn(async () => "duplicate"),
    completed: vi.fn(async () => ({ state: "done", response: { text: "Connected to human support." } })),
  };
  const service = createConversationsService(repository as any, { run: vi.fn() } as any);
  const app = appFor(service);
  const path = `/api/conversations/${id}/messages`;
  const stream = await request(app).post(`${path}/stream`).auth("customer", { type: "bearer" }).send({ text: "contact support", idempotencyKey: key });
  expect(events(stream.text).at(-1)).toEqual({ event: "done", data: { id, status: "escalated", clarificationDeadline: null, ticketId: key } });
  const json = await request(app).post(path).auth("customer", { type: "bearer" }).send({ text: "contact support", idempotencyKey: key });
  expect(json.body).toMatchObject({ id, status: "escalated", clarificationDeadline: null, ticketId: key, text: "Connected to human support." });
  expect(repository.admit).toHaveBeenCalledTimes(2);
});

it("preflight replays only a validated same-key handoff and rejects other keys and prose", async () => {
  const row = { id, owner_id: id, status: "escalated" as const, created_at: new Date(), ticket_id: key };
  const repository = { byId: vi.fn(async () => row), messages: vi.fn(async () => []), admit: vi.fn(async (_owner, _id, claimKey) => claimKey === key ? "duplicate" : "forbidden"), completed: vi.fn(async () => ({ state: "done", response: { text: "Connected to human support." } })), humanMessage: vi.fn() };
  const service = createConversationsService(repository as any, { run: vi.fn() } as any);
  const app = appFor(service);
  const path = `/api/conversations/${id}/messages/stream`;
  const replay = await request(app).post(path).auth("customer", { type: "bearer" }).send({ text: "contact support", idempotencyKey: key });
  expect(events(replay.text).at(-1)?.data).toMatchObject({ id, status: "escalated", ticketId: key });
  for (const body of [{ text: "hello", idempotencyKey: key }, { text: "contact support", idempotencyKey: id }]) {
    const denied = await request(app).post(path).auth("customer", { type: "bearer" }).send(body);
    expect(denied.status).toBe(body.text === "hello" ? 409 : 403);
    expect(denied.body.error).toBe(body.text === "hello" ? "human_mode" : "forbidden");
  }
  expect(repository.humanMessage).not.toHaveBeenCalled();
});

it("maps escalated replay failures without concealing outages as human mode", async () => {
  for (const [failure, status, code] of [
    [new ConversationError("invalid"), 400, "invalid"],
    [new ConversationError("busy"), 409, "busy"],
    [new ConversationError("outcome_unknown"), 409, "outcome_unknown"],
    [new ConversationError("missing"), 404, "missing"],
    [new ConversationError("forbidden"), 403, "forbidden"],
    [new ConversationError("human_mode"), 409, "human_mode"],
    [new Error("database offline"), 503, "unavailable"],
  ] as const) {
    const app = appFor({ detail: vi.fn(async () => ({ status: "escalated" })), replayHandoff: vi.fn(async () => { throw failure; }) });
    const response = await request(app).post(`/api/conversations/${id}/messages/stream`).auth("customer", { type: "bearer" }).send({ text: "contact support", idempotencyKey: key });
    expect(response.status).toBe(status);
    expect(response.body.error).toBe(code);
    expect(response.text).not.toContain("database offline");
    expect(response.headers["content-type"]).not.toContain("text/event-stream");
  }
});

it("keeps admitted work alive on disconnect without invoking another service call", async () => {
  let finish!: (value: any) => void;
  const create = vi.fn(() => new Promise<any>(resolve => { finish = resolve; }));
  const response = new EventEmitter() as any;
  response.locals = { user: { id, role: "customer" } };
  response.status = vi.fn(() => response);
  response.set = vi.fn(() => response);
  response.write = vi.fn(() => true);
  response.end = vi.fn();
  const work = streamConversation({ create } as any, "create")({ body: { text: "hi", idempotencyKey: key } } as any, response, vi.fn());
  await vi.waitFor(() => expect(create).toHaveBeenCalledTimes(1));
  response.emit("close");
  finish({ id, status: "open", text: "Saved", clarificationDeadline: null });
  await work;
  expect(create).toHaveBeenCalledTimes(1);
  expect(response.write).toHaveBeenCalledTimes(1);
});

it("stops deltas on disconnect and does not replay service work", async () => {
  const create = vi.fn(async () => ({ id, status: "open", text: "abcdef", clarificationDeadline: null }));
  const response = new EventEmitter() as any;
  response.locals = { user: { id, role: "customer" } };
  response.status = vi.fn(() => response);
  response.set = vi.fn(() => response);
  response.write = vi.fn((frame: string) => { if (frame.startsWith("event: delta")) response.emit("close"); return true; });
  response.end = vi.fn();
  await streamConversation({ create } as any, "create")({ body: { text: "hi", idempotencyKey: key } } as any, response, vi.fn());
  expect(create).toHaveBeenCalledTimes(1);
  expect(response.write).toHaveBeenCalledTimes(2);
});

it("waits for drain before continuing after a full socket buffer", async () => {
  const create = vi.fn(async () => ({ id, status: "open", text: "a", clarificationDeadline: null }));
  const response = new EventEmitter() as any;
  response.locals = { user: { id, role: "customer" } };
  response.status = vi.fn(() => response);
  response.set = vi.fn(() => response);
  response.write = vi.fn().mockReturnValueOnce(false).mockReturnValue(true);
  response.end = vi.fn();
  const work = streamConversation({ create } as any, "create")({ body: { text: "hi", idempotencyKey: key } } as any, response, vi.fn());
  await vi.waitFor(() => expect(response.write).toHaveBeenCalledTimes(1));
  expect(create).not.toHaveBeenCalled();
  response.emit("drain");
  await work;
  expect(create).toHaveBeenCalledTimes(1);
  expect(response.write.mock.calls.map(([frame]: [string]) => frame.match(/^event: (\w+)/)?.[1])).toEqual(["status", "delta", "done"]);
});

it("times out a blocked writer without queueing more frames or admitting work", async () => {
  const create = vi.fn();
  const response = new EventEmitter() as any;
  response.locals = { user: { id, role: "customer" } };
  response.status = vi.fn(() => response);
  response.set = vi.fn(() => response);
  response.write = vi.fn(() => false);
  response.end = vi.fn();
  await streamConversation({ create } as any, "create")({ body: { text: "hi", idempotencyKey: key } } as any, response, vi.fn());
  expect(response.write).toHaveBeenCalledTimes(1);
  expect(response.end).toHaveBeenCalledTimes(1);
  expect(create).not.toHaveBeenCalled();
}, 3000);

it("replies with same supplied key and returns conversation metadata", async () => {
  const reply = vi.fn(async () => ({ text: "OK", id, status: "open", clarificationDeadline: "2026-01-01T00:00:00.000Z" }));
  const detail = vi.fn(async () => ({ id, status: "open", clarificationDeadline: null }));
  const app = appFor({ streamReply: reply, detail });
  const response = await request(app).post(`/api/conversations/${id}/messages/stream`).auth("customer", { type: "bearer" }).send({ text: "hi", idempotencyKey: key });
  expect(reply).toHaveBeenCalledWith({ id, role: "customer" }, id, "hi", key);
  expect(detail).toHaveBeenCalledTimes(1);
  expect(events(response.text).at(-1)).toEqual({ event: "done", data: { id, status: "open", clarificationDeadline: "2026-01-01T00:00:00.000Z" } });
});
