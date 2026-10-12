import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { baseRoutes, createdAt, json, mockApi, submitLogin } from "./test/helpers";

const id = "11111111-1111-4111-8111-111111111111";
const row = (status = "open") => ({ id, status, createdAt, clarificationDeadline: status === "open" ? createdAt : null, ticketId: null });
const options = [{ kind: "transfer", id: "22222222-2222-4222-8222-222222222222", label: "Transfer one" }, { kind: "details", label: "Enter details" }, { kind: "handoff", label: "Ask a human" }];
const messages = [{ id: "m1", senderRole: "customer", text: "Where is my transfer?", createdAt }, { id: "m2", senderRole: "agent", text: "Which transfer date?", createdAt, options }, { id: "m3", senderRole: "tool", text: "Looked up synthetic transfer status", createdAt }];
const createPath = "/api/conversations/stream";
const replyPath = `/api/conversations/${id}/messages/stream`;
const sse = () => new Response(`event: status\ndata: {"state":"checking"}\n\nevent: delta\ndata: {"text":"Which transfer date?"}\n\nevent: done\ndata: ${JSON.stringify({ ...row(), options })}\n\n`, { headers: { "Content-Type": "text/event-stream" } });
const posts = (mock: ReturnType<typeof mockApi>, path: string) => mock.mock.calls.filter(([url, init]) => url === path && init?.method === "POST");
afterEach(() => { cleanup(); window.history.replaceState(null, "", "/"); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
async function enter(routes: Record<string, () => Response | Promise<Response>> = {}, role: "customer" | "support" = "customer") {
  const fetchMock = mockApi({ ...baseRoutes(), "/api/auth/me": () => json({ user: { id: "u1", email: "demo@example.test", role } }), "/api/conversations": () => json({ conversations: role === "support" ? [row("escalated")] : [] }), ...routes });
  render(<App />); submitLogin(); await screen.findByText("demo@example.test"); return fetchMock;
}
async function open(routes: Record<string, () => Response | Promise<Response>> = {}, role: "customer" | "support" = "customer") {
  const mock = await enter({ "/api/conversations": () => json({ conversations: [row()] }), [`/api/conversations/${id}`]: () => json({ ...row(), messages }), ...routes }, role);
  fireEvent.click(await screen.findByRole("link", { name: /Conversation/ }));
  await screen.findByText("Which transfer date?"); return mock;
}
describe("chat-first support", () => {
  it("creates through SSE and shows persisted answer and tool summary", async () => {
    const mock = await enter({ [`POST ${createPath}`]: sse, [`/api/conversations/${id}`]: () => json({ ...row(), messages }) });
    fireEvent.change(screen.getByLabelText("How can we help with your transfer?"), { target: { value: "Where is my transfer?" } });
    fireEvent.click(screen.getByRole("button", { name: "Start chat" }));
    await screen.findByText("Which transfer date?");
    expect(await screen.findByText("Looked up synthetic transfer status")).toBeTruthy();
    expect(JSON.parse(String(posts(mock, createPath)[0][1]?.body))).toMatchObject({ text: "Where is my transfer?", idempotencyKey: expect.any(String) });
    expect(posts(mock, createPath)).toHaveLength(1);
  });
  it.each([409, 503])("retries uncertain create using same key after %i", async status => {
    let count = 0; const mock = await enter({ [`POST ${createPath}`]: () => ++count === 1 ? json({}, status) : sse(), [`/api/conversations/${id}`]: () => json({ ...row(), messages }) });
    fireEvent.change(screen.getByLabelText("How can we help with your transfer?"), { target: { value: "Where is it?" } });
    fireEvent.click(screen.getByRole("button", { name: "Start chat" }));
    fireEvent.click(await screen.findByRole("button", { name: "Retry same request" }));
    await waitFor(() => expect(posts(mock, createPath)).toHaveLength(2));
    expect(posts(mock, createPath).map(([, init]) => init?.body)).toEqual([posts(mock, createPath)[0][1]?.body, posts(mock, createPath)[0][1]?.body]);
  });
  it.each(["create", "reply"])("blocks a new action while an uncertain %s retry is pending", async mode => {
    let release!: (response: Response) => void;
    let count = 0;
    const route = mode === "create" ? createPath : replyPath;
    const handler = () => ++count === 1 ? json({}, 503) : new Promise<Response>(resolve => { release = resolve; });
    const mock = mode === "create" ? await enter({ [`POST ${route}`]: handler }) : await open({ [`POST ${route}`]: handler });
    if (mode === "create") fireEvent.change(screen.getByLabelText("How can we help with your transfer?"), { target: { value: "Where?" } });
    else fireEvent.change(screen.getByLabelText("Reply to the agent"), { target: { value: "Where?" } });
    fireEvent.click(screen.getByRole("button", { name: mode === "create" ? "Start chat" : "Send message" }));
    const retry = await screen.findByRole("button", { name: mode === "create" ? "Retry same request" : "Retry same action" });
    fireEvent.click(retry);
    await waitFor(() => expect(posts(mock, route)).toHaveLength(2));
    const newAction = screen.getByRole("button", { name: /Start a new action/ });
    expect((newAction as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(newAction);
    expect(posts(mock, route)).toHaveLength(2);
    expect(posts(mock, route).map(([, init]) => init?.body)).toEqual([posts(mock, route)[0][1]?.body, posts(mock, route)[0][1]?.body]);
    release(sse());
    await waitFor(() => expect(posts(mock, route)).toHaveLength(2));
  });
  it("uses persisted typed choices, focusing details and sending transfer with same key on retry", async () => {
    let count = 0; const mock = await open({ [`POST ${replyPath}`]: () => ++count === 1 ? Promise.reject(new Error("offline")) : sse() });
    fireEvent.click(screen.getByRole("button", { name: "Enter details" }));
    expect(document.activeElement).toBe(screen.getByLabelText("Reply to the agent"));
    fireEvent.click(screen.getByRole("button", { name: "Transfer one" }));
    fireEvent.click(await screen.findByRole("button", { name: "Retry same action" }));
    await waitFor(() => expect(posts(mock, replyPath)).toHaveLength(2));
    expect(posts(mock, replyPath).map(([, init]) => init?.body)).toEqual([posts(mock, replyPath)[0][1]?.body, posts(mock, replyPath)[0][1]?.body]);
    expect(JSON.parse(String(posts(mock, replyPath)[0][1]?.body)).text).toBe("22222222-2222-4222-8222-222222222222");
  });
  it("guards refresh between streamed deltas without duplicating persisted reply", async () => {
    let stream!: ReadableStreamDefaultController<Uint8Array>;
    let current = messages;
    let loads = 0;
    const encoder = new TextEncoder();
    const mock = await open({ [`/api/conversations/${id}`]: () => { loads++; return json({ ...row(), messages: current }); }, [`POST ${replyPath}`]: () => new Response(new ReadableStream<Uint8Array>({ start(controller) { stream = controller; } }), { headers: { "Content-Type": "text/event-stream" } }) });
    fireEvent.change(screen.getByLabelText("Reply to the agent"), { target: { value: "June 1" } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    await waitFor(() => expect(posts(mock, replyPath)).toHaveLength(1));
    stream.enqueue(encoder.encode('event: delta\ndata: {"text":"Saved "}\n\n'));
    await screen.findByText("Saved", { exact: false });
    current = [...messages, { id: "m4", senderRole: "agent", text: "Saved answer", createdAt }];
    fireEvent.click(screen.getByRole("button", { name: "Refresh conversation" }));
    expect(loads).toBe(1);
    stream.enqueue(encoder.encode(`event: delta\ndata: {"text":"answer"}\n\nevent: done\ndata: ${JSON.stringify(row())}\n\n`));
    stream.close();
    await waitFor(() => expect(screen.getAllByText("Saved answer")).toHaveLength(1));
    await waitFor(() => expect(loads).toBe(2));
    expect(posts(mock, replyPath)).toHaveLength(1);
  });
  it("reconciles uncertain stream refresh without duplicate provisional text", async () => {
    let current = messages; const mock = await open({ [`/api/conversations/${id}`]: () => json({ ...row(), messages: current }), [`POST ${replyPath}`]: () => new Response('event: delta\ndata: {"text":"Saved answer"}\n\n', { headers: { "Content-Type": "text/event-stream" } }) });
    fireEvent.change(screen.getByLabelText("Reply to the agent"), { target: { value: "June 1" } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    await screen.findByText(/Outcome uncertain/);
    current = [...messages, { id: "m4", senderRole: "agent", text: "Saved answer", createdAt }];
    fireEvent.click(screen.getByRole("button", { name: "Refresh conversation" }));
    await waitFor(() => expect(screen.getAllByText("Saved answer")).toHaveLength(1));
    expect(posts(mock, replyPath)).toHaveLength(1);
  });
  it("keeps support human replies on JSON and handoff available", async () => {
    const mock = await enter({ [`/api/conversations/${id}`]: () => json({ ...row("escalated"), messages }), [`POST /api/conversations/${id}/messages`]: () => json({}, 201) }, "support");
    fireEvent.click(await screen.findByRole("link", { name: /Escalated conversation/ }));
    await screen.findByText("Which transfer date?");
    fireEvent.change(screen.getByLabelText("Reply as human support"), { target: { value: "Hello" } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    await waitFor(() => expect(posts(mock, `/api/conversations/${id}/messages`)).toHaveLength(1));
    expect(posts(mock, replyPath)).toHaveLength(0);
  });
  it("uses typed handoff option", async () => {
    let status = "open"; await open({ [`/api/conversations/${id}`]: () => json({ ...row(status), messages }), [`POST /api/conversations/${id}/escalate`]: () => { status = "escalated"; return json(row(status)); } });
    fireEvent.click(screen.getByRole("button", { name: "Ask a human" }));
    await screen.findByText("Message human support");
  });
  it("clears session on 401", async () => {
    await enter({ "/api/conversations": () => json({}, 401) });
    await screen.findByText("Session invalid or expired. Log in again.");
  });
});
