import { fireEvent, screen } from "@testing-library/react";
import { vi } from "vitest";

export const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
export const healthy = () => json({ status: "ok", database: "reachable" });
export const sessionResponse = (offset = 900_000) => json({ token: "synthetic-token", expiresAt: Date.now() + offset });
export const identity = () => json({ user: { id: "persistent-id", email: "demo@example.test", role: "customer" } });

export type Responder = () => Response | Promise<Response>;
export type Routes = Record<string, Responder | Responder[]>;

export function mockApi(routes: Routes = {}) {
  const fetchMock = vi.fn(async (input: unknown, init?: RequestInit) => {
    const path = typeof input === "string" ? input : input instanceof URL ? input.pathname : String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    const queue = routes[`${method} ${path}`] ?? routes[path] ?? [];
    const next = Array.isArray(queue) ? queue.shift() : queue;
    if (next) return await next();
    return json({ error: "Unexpected request." }, 500);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

export const createdAt = "2026-01-01T00:00:00.000Z";
export const ticketSummary = (id: string, text = `Ticket ${id}`) => ({ id, text, createdAt });
export const ticketsResponse = (tickets: Array<ReturnType<typeof ticketSummary>>) => json({ tickets });
export const succeededAnalysis = (over: Record<string, unknown> = {}) => ({
  id: "analysis-id", status: "succeeded", model: "mock-model", promptVersion: "v1", instruction: null,
  createdAt, completedAt: "2026-01-01T00:01:00.000Z", summary: "Summary text", category: "billing",
  uncertaintyNote: null, failureCode: null, ...over,
});
export const failedAnalysis = (failureCode = "timeout", over: Record<string, unknown> = {}) => ({
  id: "analysis-id", status: "failed", model: "mock-model", promptVersion: "v1", instruction: null,
  createdAt, completedAt: "2026-01-01T00:01:00.000Z", summary: null, category: null, uncertaintyNote: null,
  failureCode, ...over,
});
export const detailResponse = (id: string, analyses: unknown[] = []) =>
  json({ ticket: { ...ticketSummary(id), analyses } });

export function submitLogin(email = "demo@example.test", password = "synthetic-password") {
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: email } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: password } });
  fireEvent.click(screen.getByRole("button", { name: "Log in" }));
}

export const baseRoutes = (): Routes => ({
  "/api/health": healthy,
  "/api/auth/login": sessionResponse,
  "/api/auth/me": identity,
});

export const emptyTickets = () => json({ tickets: [] });
