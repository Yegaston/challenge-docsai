import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import {
  baseRoutes, deferred, emptyTickets, healthy, identity, json, mockApi, sessionResponse, submitLogin,
  type Routes,
} from "./test/helpers";

afterEach(() => { cleanup(); window.history.replaceState(null, "", "/"); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function call(fetchMock: ReturnType<typeof mockApi>, url: string) {
  return fetchMock.mock.calls.find(([candidate]) => candidate === url);
}

describe("persistent session", () => {
  it.each(["customer", "support"] as const)("does not flash login while restoring %s at /login", async (role) => {
    window.history.replaceState(null, "", "/login");
    const restore = deferred<Response>();
    mockApi({ ...baseRoutes(), "POST /api/auth/refresh": () => restore.promise,
      "/api/auth/me": () => json({ user: { id: "restored", email: "restored@example.test", role } }),
      "/api/conversations": () => json({ conversations: [] }), "/api/support/tickets": () => json({ tickets: [] }) });
    render(<App />);
    expect(screen.getByText("Restoring session…")).toBeTruthy();
    expect(screen.queryByLabelText("Email")).toBeNull();
    await act(async () => restore.resolve(sessionResponse()));
    await screen.findByText("restored@example.test");
    expect(window.location.pathname).toBe(role === "support" ? "/support" : "/chat");
  });

  it("retries a transient proactive failure before expiry and retains the refreshed identity", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const fetchMock = mockApi({ ...baseRoutes(), "POST /api/auth/refresh": [
      () => json({}, 401), () => json({}, 503), () => sessionResponse(),
    ], "/api/conversations": () => json({ conversations: [] }) });
    render(<App />); await submitLogin(); await act(async () => {});
    await act(async () => { vi.advanceTimersByTime(840_000); });
    expect(screen.getByText("demo@example.test")).toBeTruthy();
    await act(async () => { vi.advanceTimersByTime(15_000); });
    expect(fetchMock.mock.calls.filter(([url]) => url === "/api/auth/refresh")).toHaveLength(3);
    await act(async () => { vi.advanceTimersByTime(45_001); });
    expect(screen.getByText("demo@example.test")).toBeTruthy();
  });

  it("hides an expired session immediately on focus before deferred cookie restore", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const restore = deferred<Response>();
    mockApi({ ...baseRoutes(), "POST /api/auth/refresh": [() => json({}, 401), () => restore.promise],
      "/api/conversations": () => json({ conversations: [] }) });
    render(<App />); await submitLogin(); await act(async () => {});
    vi.setSystemTime(new Date("2026-01-01T00:15:01Z"));
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    expect(screen.queryByText("demo@example.test")).toBeNull();
    expect(screen.getByText("Restoring session…")).toBeTruthy();
    await act(async () => restore.resolve(sessionResponse()));
    expect(screen.getByText("demo@example.test")).toBeTruthy();
  });

  it("retries a timed-out proactive refresh and rejects its late response", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const late = deferred<Response>();
    const fetchMock = mockApi({ ...baseRoutes(), "POST /api/auth/refresh": [() => json({}, 401), () => late.promise, () => sessionResponse()],
      "/api/conversations": () => json({ conversations: [] }) });
    render(<App />); await submitLogin(); await act(async () => {});
    await act(async () => { vi.advanceTimersByTime(840_000); });
    await act(async () => { vi.advanceTimersByTime(10_000); });
    await act(async () => { vi.advanceTimersByTime(15_000); });
    expect(fetchMock.mock.calls.filter(([url]) => url === "/api/auth/refresh")).toHaveLength(3);
    await act(async () => late.resolve(json({}, 401)));
    expect(screen.getByText("demo@example.test")).toBeTruthy();
    await act(async () => { vi.advanceTimersByTime(35_001); });
    expect(screen.getByText("demo@example.test")).toBeTruthy();
  });

  it("bounds retries at the deadline after repeated transient failures", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const fetchMock = mockApi({ ...baseRoutes(), "POST /api/auth/refresh": [() => json({}, 401), ...Array.from({ length: 12 }, () => () => json({}, 503))] });
    render(<App />); await submitLogin(); await act(async () => {});
    for (let i = 0; i < 10; i++) await act(async () => { vi.advanceTimersByTime(100_000); });
    expect(fetchMock.mock.calls.filter(([url]) => url === "/api/auth/refresh").length).toBeLessThanOrEqual(6);
    expect(screen.getByRole("button", { name: "Retry restore" })).toBeTruthy();
  });

  it("ignores a late proactive refresh response after logout", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const late = deferred<Response>();
    mockApi({ ...baseRoutes(), "POST /api/auth/refresh": [() => json({}, 401), () => late.promise] });
    render(<App />); await submitLogin(); await act(async () => {});
    await act(async () => { vi.advanceTimersByTime(840_000); });
    fireEvent.click(screen.getByRole("button", { name: "Log out" }));
    await act(async () => {});
    await act(async () => late.resolve(sessionResponse()));
    expect(screen.queryByText("demo@example.test")).toBeNull();
    expect(screen.getByRole("button", { name: "Log in" })).toBeTruthy();
  });
  it("restores a support session without showing login or storing tokens", async () => {
    window.history.replaceState(null, "", "/support");
    const storage = vi.spyOn(Storage.prototype, "setItem");
    const restore = deferred<Response>();
    const fetchMock = mockApi({ ...baseRoutes(), "POST /api/auth/refresh": () => restore.promise,
      "/api/auth/me": () => json({ user: { id: "agent", email: "agent@example.test", role: "support" } }),
      "/api/support/tickets": () => json({ tickets: [] }) });
    render(<App />);
    expect(screen.queryByRole("button", { name: "Log in" })).toBeNull();
    await act(async () => restore.resolve(sessionResponse()));
    await screen.findByText("agent@example.test");
    expect(call(fetchMock, "/api/auth/refresh")?.[1]).toMatchObject({ credentials: "include", method: "POST" });
    expect(storage).not.toHaveBeenCalled();
  });
});

describe("restore and logout failures", () => {
  it("keeps the login form available after transient restore failure and retries successfully", async () => {
    window.history.replaceState(null, "", "/login");
    const fetchMock = mockApi({ ...baseRoutes(), "POST /api/auth/refresh": [
      () => Promise.reject(new Error("offline")), sessionResponse,
    ], "/api/conversations": () => json({ conversations: [] }) });
    render(<App />);
    await screen.findByLabelText("Email");
    expect(screen.getByRole("button", { name: "Retry restore" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry restore" }));
    await screen.findByText("demo@example.test");
    expect(fetchMock.mock.calls.filter(([url]) => url === "/api/auth/refresh")).toHaveLength(2);
  });

  it("retains the authenticated session when logout fails, then revokes on retry", async () => {
    const fetchMock = mockApi({ ...baseRoutes(), "POST /api/auth/logout": [
      () => json({}, 503), () => new Response(null, { status: 204 }),
    ] });
    render(<App />);
    await submitLogin();
    await screen.findByText("demo@example.test");
    fireEvent.click(screen.getByRole("button", { name: "Log out" }));
    await screen.findByText("Unable to log out. Try again.");
    expect(screen.getByText("demo@example.test")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Log out" }));
    await screen.findByRole("button", { name: "Log in" });
    expect(fetchMock.mock.calls.filter(([url]) => url === "/api/auth/logout")).toHaveLength(2);
  });
});

describe("login page", () => {
  it("logs in, sends a bearer protected request, keeps storage empty, and logs out", async () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const getItem = vi.spyOn(Storage.prototype, "getItem");
    const fetchMock = mockApi({ ...baseRoutes(), "/api/tickets": emptyTickets });
    render(<App />);
    await submitLogin();
    await screen.findByText("demo@example.test");
    const me = call(fetchMock, "/api/auth/me");
    expect((me?.[1]?.headers as Record<string, string>)?.Authorization).toBe("Bearer synthetic-token");
    expect(setItem).not.toHaveBeenCalled();
    expect(getItem).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Log out" }));
    await screen.findByRole("button", { name: "Log in" });
    expect(screen.queryByText("demo@example.test")).toBeNull();
    expect((screen.getByLabelText("Password") as HTMLInputElement).value).toBe("");
  });

  it("shows pending feedback and generic bad-credential errors", async () => {
    const loginResponse = deferred<Response>();
    mockApi({ ...baseRoutes(), "/api/auth/login": () => loginResponse.promise });
    render(<App />);
    await submitLogin();
    expect(screen.getByText("Logging in…")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Logging in…" }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => loginResponse.resolve(json({}, 401)));
    expect(screen.getByRole("alert").textContent).toBe("Invalid email or password.");
  });

  it.each(["network", "server", "malformed"])("handles %s login failures without entering a session", async (kind) => {
    let reject!: (error: unknown) => void;
    const failing = new Promise<Response>((_resolve, rej) => { reject = rej; });
    const routes: Routes = {
      ...baseRoutes(),
      "/api/auth/login": () => kind === "network" ? failing : kind === "server" ? json({}, 503) : json({}),
    };
    mockApi(routes);
    render(<App />);
    await submitLogin();
    if (kind === "network") await act(async () => { reject(new Error("offline")); });
    await screen.findByRole("alert");
    expect(screen.queryByRole("button", { name: "Log out" })).toBeNull();
    expect((screen.getByRole("button", { name: "Log in" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it.each(["server", "malformed"])('keeps protected routes closed when identity is %s', async (kind) => {
    const fetchMock = mockApi({ ...baseRoutes(), "/api/auth/me": () => kind === "server" ? json({}, 503) : json({ user: {} }), "/api/tickets": emptyTickets });
    render(<App />);
    await submitLogin();
    await screen.findByRole("alert");
    expect(screen.getByRole("alert").textContent).toMatch(/Try again/);
    expect(screen.getByRole("button", { name: "Log in" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Log out" })).toBeNull();
    expect(call(fetchMock, "/api/tickets")).toBeUndefined();
  });

  it("resets a session rejected by the protected API", async () => {
    mockApi({ ...baseRoutes(), "/api/auth/me": () => json({}, 401), "/api/tickets": emptyTickets });
    render(<App />);
    await submitLogin();
    await screen.findByText("Session invalid or expired. Log in again.");
    expect(screen.getByRole("button", { name: "Log in" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Log out" })).toBeNull();
  });

  it("expires locally at the server deadline without sleeping", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    mockApi({ ...baseRoutes(), "/api/tickets": emptyTickets });
    render(<App />);
    await submitLogin();
    await act(async () => {});
    expect(screen.getByText("demo@example.test")).toBeTruthy();
    await act(async () => { vi.advanceTimersByTime(900_000); });
    expect(screen.getByText("Unable to restore session. Try again.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry restore" })).toBeTruthy();
  });

  it("times out login and ignores a late successful response", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const loginResponse = deferred<Response>();
    const fetchMock = mockApi({ ...baseRoutes(), "/api/auth/login": () => loginResponse.promise });
    render(<App />);
    await submitLogin();
    await act(async () => { vi.advanceTimersByTime(10_000); });
    const login = call(fetchMock, "/api/auth/login");
    expect(((login?.[1] as RequestInit).signal as AbortSignal).aborted).toBe(true);
    await act(async () => loginResponse.resolve(sessionResponse()));
    expect(screen.getByText("Authentication request timed out. Try again.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Log out" })).toBeNull();
  });

  it("aborts an in-flight login on unmount", async () => {
    const loginResponse = deferred<Response>();
    const fetchMock = mockApi({ ...baseRoutes(), "/api/auth/login": () => loginResponse.promise });
    const view = render(<App />);
    await submitLogin();
    const login = call(fetchMock, "/api/auth/login");
    view.unmount();
    expect(((login?.[1] as RequestInit).signal as AbortSignal).aborted).toBe(true);
  });

  it("ignores an old identity response after a new login succeeds", async () => {
    const firstMe = deferred<Response>();
    const fetchMock = mockApi({
      "/api/health": healthy,
      "POST /api/auth/refresh": () => json({}, 401),
      "/api/auth/login": [sessionResponse, sessionResponse],
      "/api/auth/me": [() => firstMe.promise, () => json({ user: { id: "new-id", email: "new@example.test", role: "customer" } })],
      "/api/tickets": emptyTickets,
    });
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    render(<App />);
    await submitLogin();
    await act(async () => {});
    expect(screen.queryByRole("button", { name: "Log out" })).toBeNull();
    const me = call(fetchMock, "/api/auth/me");
    await act(async () => { vi.advanceTimersByTime(10_000); });
    expect(((me?.[1] as RequestInit).signal as AbortSignal).aborted).toBe(true);
    await submitLogin();
    await act(async () => {});
    expect(screen.getByText("new@example.test")).toBeTruthy();
    await act(async () => firstMe.resolve(identity()));
    expect(screen.queryByText("demo@example.test")).toBeNull();
    expect(screen.getByText("new@example.test")).toBeTruthy();
  });

  it("expires and ignores a delayed identity response", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const meResponse = deferred<Response>();
    const fetchMock = mockApi({
      "/api/health": healthy,
      "POST /api/auth/refresh": () => json({}, 401),
      "/api/auth/login": () => sessionResponse(1000),
      "/api/auth/me": () => meResponse.promise,
      "/api/tickets": emptyTickets,
    });
    render(<App />);
    await submitLogin();
    await act(async () => {});
    expect(screen.queryByRole("button", { name: "Log out" })).toBeNull();
    await act(async () => { vi.advanceTimersByTime(1000); });
    const me = call(fetchMock, "/api/auth/me");
    expect(((me?.[1] as RequestInit).signal as AbortSignal).aborted).toBe(true);
    await act(async () => meResponse.resolve(identity()));
    expect(screen.getByText("Session expired. Log in again.")).toBeTruthy();
    expect(screen.queryByText("demo@example.test")).toBeNull();
  });
});

describe("login page health", () => {
  it("shows the pending state until the API responds", async () => {
    mockApi({ ...baseRoutes(), "/api/health": () => new Promise(() => {}) });
    render(<App />);
    await screen.findByText(/Checking API/);
    expect(screen.getByRole("status").textContent).toContain("Checking API");
    expect((screen.getByRole("button", { name: "Check again" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("renders the shell and a reachable database", async () => {
    const fetchMock = mockApi(baseRoutes());
    render(<App />);
    expect(await screen.findByRole("heading", { name: "Support Ticket AI" })).toBeTruthy();
    await screen.findByText("API online · PostgreSQL reachable");
    expect(fetchMock).toHaveBeenCalledWith("/api/health", expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  it("distinguishes database failure and allows retry", async () => {
    mockApi({ ...baseRoutes(), "/api/health": [() => json({ status: "degraded", database: "unreachable" }, 503), healthy] });
    render(<App />);
    await screen.findByText(/PostgreSQL is unavailable/);
    fireEvent.click(screen.getByRole("button", { name: "Check again" }));
    await screen.findByText("API online · PostgreSQL reachable");
  });

  it.each(["network", "invalid-json", "unexpected-body"])("handles %s failures safely", async (failure) => {
    mockApi({ ...baseRoutes(), "/api/health": () => failure === "network"
      ? Promise.reject(new Error("offline")) : new Response(failure === "invalid-json" ? "not json" : "{}") });
    render(<App />);
    await screen.findByText(/Unable to check system health/);
    await waitFor(() => expect((screen.getByRole("button", { name: "Check again" }) as HTMLButtonElement).disabled).toBe(false));
  });
});
