import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { baseRoutes, createdAt, deferred, json, mockApi, submitLogin } from "./test/helpers";

const id = "11111111-1111-4111-8111-111111111111";
const row = (status = "open") => ({ id, status, createdAt, clarificationDeadline: status === "open" ? createdAt : null, ticketId: status === "escalated" ? "ticket-1" : null });
const messages = [
  { id: "m1", senderRole: "customer", text: "Where is my transfer?", createdAt },
  { id: "m2", senderRole: "agent", text: "Which transfer date?", createdAt },
  { id: "m3", senderRole: "tool", text: "Looked up synthetic transfer status", createdAt },
];
afterEach(() => { cleanup(); window.history.replaceState(null, "", "/"); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
async function enter(routes: Record<string, () => Response | Promise<Response>> = {}, role: "customer" | "support" = "customer") {
  const fetchMock = mockApi({ ...baseRoutes(), "/api/auth/me": () => json({ user: { id: "u1", email: "demo@example.test", role } }), "/api/conversations": () => json({ conversations: role === "support" ? [row("escalated")] : [] }), ...routes });
  render(<App />); submitLogin(); await screen.findByText("demo@example.test"); return fetchMock;
}
const posts = (mock: ReturnType<typeof mockApi>, path: string) => mock.mock.calls.filter(([url, init]) => url === path && init?.method === "POST");

describe("chat-first support", () => {
  it("starts one customer chat and renders answer, clarification and safe tool activity", async () => {
    const fetchMock = await enter({ "POST /api/conversations": () => json({ ...row(), text: "Which transfer date?" }, 201), [`/api/conversations/${id}`]: () => json({ ...row(), messages }) });
    fireEvent.change(screen.getByLabelText("How can we help with your transfer?"), { target: { value: "Where is my transfer?" } });
    fireEvent.click(screen.getByRole("button", { name: "Start chat" }));
    await screen.findByText("Which transfer date?");
    expect(screen.getByText("Looked up synthetic transfer status")).toBeTruthy();
    expect(screen.getByText(/Clarification requested/)).toBeTruthy();
    expect(JSON.parse(String(posts(fetchMock, "/api/conversations")[0][1]?.body))).toMatchObject({ text: "Where is my transfer?", idempotencyKey: expect.any(String) });
    expect(posts(fetchMock, "/api/conversations")).toHaveLength(1);
  });
  it("does not automatically resend an uncertain new chat", async () => {
    const fetchMock = await enter({ "POST /api/conversations": () => Promise.reject(new Error("offline")) });
    fireEvent.change(screen.getByLabelText("How can we help with your transfer?"), { target: { value: "Where is it?" } });
    fireEvent.click(screen.getByRole("button", { name: "Start chat" }));
    await screen.findByText(/Outcome uncertain/);
    fireEvent.click(screen.getByRole("button", { name: "Refresh conversations" }));
    expect(posts(fetchMock, "/api/conversations")).toHaveLength(1);
  });
  it("keeps a reply pending through refresh and settles the in-flight send", async () => {
    const reply = deferred<Response>();
    const fetchMock = await enter({ "/api/conversations": () => json({ conversations: [row()] }), [`/api/conversations/${id}`]: () => json({ ...row(), messages }), [`POST /api/conversations/${id}/messages`]: () => reply.promise });
    fireEvent.click(await screen.findByRole("link", { name: /Conversation/ }));
    await screen.findByText("Which transfer date?");
    fireEvent.change(screen.getByLabelText("Reply to the agent"), { target: { value: "June 1" } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    fireEvent.click(screen.getByRole("button", { name: "Refresh conversation" }));
    reply.resolve(json({ id: "m4" }, 201));
    await waitFor(() => expect(screen.getByRole("button", { name: "Send message" }).hasAttribute("disabled")).toBe(false));
    expect(posts(fetchMock, `/api/conversations/${id}/messages`)).toHaveLength(1);
  });
  it.each([409, 503])("retries uncertain create with identical text and key after %i", async status => {
    let count = 0;
    const fetchMock = await enter({ "POST /api/conversations": () => ++count === 1 ? json({ error: "busy" }, status) : json(row(), 201) });
    fireEvent.change(screen.getByLabelText("How can we help with your transfer?"), { target: { value: "Where is it?" } });
    fireEvent.click(screen.getByRole("button", { name: "Start chat" }));
    fireEvent.click(await screen.findByRole("button", { name: "Retry same request" }));
    await waitFor(() => expect(posts(fetchMock, "/api/conversations")).toHaveLength(2));
    expect(JSON.parse(String(posts(fetchMock, "/api/conversations")[0][1]?.body))).toEqual(JSON.parse(String(posts(fetchMock, "/api/conversations")[1][1]?.body)));
  });
  it("routes support to the escalated inbox and permits human replies without agent resend", async () => {
    const fetchMock = await enter({ [`/api/conversations/${id}`]: () => json({ ...row("escalated"), messages }), [`POST /api/conversations/${id}/messages`]: () => json({ text: "We are looking into it." }, 201) }, "support");
    expect(screen.queryByRole("link", { name: "New ticket" })).toBeNull();
    fireEvent.click(await screen.findByRole("link", { name: /Escalated conversation/ }));
    await screen.findByText("Which transfer date?");
    expect(screen.queryByRole("button", { name: /Contact support/ })).toBeNull();
    fireEvent.change(screen.getByLabelText("Reply as human support"), { target: { value: "We are looking into it." } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    await waitFor(() => expect(posts(fetchMock, `/api/conversations/${id}/messages`)).toHaveLength(1));
  });
  it("offers explicit customer handoff and keeps human conversation available", async () => {
    let status = "open";
    await enter({ "/api/conversations": () => json({ conversations: [row()] }), [`/api/conversations/${id}`]: () => json({ ...row(status), messages }), [`POST /api/conversations/${id}/escalate`]: () => { status = "escalated"; return json(row(status)); } });
    fireEvent.click(await screen.findByRole("link", { name: /Conversation/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Contact support/ }));
    await screen.findByText("Message human support");
    expect(screen.queryByRole("button", { name: /Contact support/ })).toBeNull();
  });
  it("clears a session on conversation 401", async () => {
    await enter({ "/api/conversations": () => json({}, 401) });
    await screen.findByText("Session invalid or expired. Log in again.");
    expect(screen.queryByRole("button", { name: "Log out" })).toBeNull();
  });
  it("does not duplicate a pending message after uncertain outcome and refresh", async () => {
    const reply = deferred<Response>();
    const fetchMock = await enter({ "/api/conversations": () => json({ conversations: [row()] }), [`/api/conversations/${id}`]: () => json({ ...row(), messages }), [`POST /api/conversations/${id}/messages`]: () => reply.promise });
    fireEvent.click(await screen.findByRole("link", { name: /Conversation/ }));
    await screen.findByText("Which transfer date?");
    fireEvent.change(screen.getByLabelText("Reply to the agent"), { target: { value: "I am unsure" } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    reply.resolve(json({ error: "outcome_unknown" }, 409));
    await screen.findByText(/Outcome uncertain/);
    fireEvent.click(screen.getByRole("button", { name: "Refresh conversation" }));
    expect(posts(fetchMock, `/api/conversations/${id}/messages`)).toHaveLength(1);
  });
});
