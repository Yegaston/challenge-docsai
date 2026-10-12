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

describe("login page", () => {
  it("logs in, sends a bearer protected request, keeps storage empty, and logs out", async () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const getItem = vi.spyOn(Storage.prototype, "getItem");
    const fetchMock = mockApi({ ...baseRoutes(), "/api/tickets": emptyTickets });
    render(<App />);
    submitLogin();
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
    submitLogin();
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
    submitLogin();
    if (kind === "network") await act(async () => { reject(new Error("offline")); });
    await screen.findByRole("alert");
    expect(screen.queryByRole("button", { name: "Log out" })).toBeNull();
    expect((screen.getByRole("button", { name: "Log in" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it.each(["server", "malformed"])('keeps protected routes closed when identity is %s', async (kind) => {
    const fetchMock = mockApi({ ...baseRoutes(), "/api/auth/me": () => kind === "server" ? json({}, 503) : json({ user: {} }), "/api/tickets": emptyTickets });
    render(<App />);
    submitLogin();
    await screen.findByRole("alert");
    expect(screen.getByRole("alert").textContent).toMatch(/Try again/);
    expect(screen.getByRole("button", { name: "Log in" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Log out" })).toBeNull();
    expect(call(fetchMock, "/api/tickets")).toBeUndefined();
  });

  it("resets a session rejected by the protected API", async () => {
    mockApi({ ...baseRoutes(), "/api/auth/me": () => json({}, 401), "/api/tickets": emptyTickets });
    render(<App />);
    submitLogin();
    await screen.findByText("Session invalid or expired. Log in again.");
    expect(screen.getByRole("button", { name: "Log in" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Log out" })).toBeNull();
  });

  it("expires locally at the server deadline without sleeping", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    mockApi({ ...baseRoutes(), "/api/tickets": emptyTickets });
    render(<App />);
    await act(async () => { submitLogin(); });
    expect(screen.getByText("demo@example.test")).toBeTruthy();
    await act(async () => { vi.advanceTimersByTime(900_000); });
    expect(screen.getByText("Session expired. Log in again.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Log in" })).toBeTruthy();
  });

  it("times out login and ignores a late successful response", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const loginResponse = deferred<Response>();
    const fetchMock = mockApi({ ...baseRoutes(), "/api/auth/login": () => loginResponse.promise });
    render(<App />);
    await act(async () => { submitLogin(); });
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
    submitLogin();
    const login = call(fetchMock, "/api/auth/login");
    view.unmount();
    expect(((login?.[1] as RequestInit).signal as AbortSignal).aborted).toBe(true);
  });

  it("ignores an old identity response after a new login succeeds", async () => {
    const firstMe = deferred<Response>();
    const fetchMock = mockApi({
      "/api/health": healthy,
      "/api/auth/login": [sessionResponse, sessionResponse],
      "/api/auth/me": [() => firstMe.promise, () => json({ user: { id: "new-id", email: "new@example.test", role: "customer" } })],
      "/api/tickets": emptyTickets,
    });
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    render(<App />);
    await act(async () => { submitLogin(); });
    expect(screen.queryByRole("button", { name: "Log out" })).toBeNull();
    const me = call(fetchMock, "/api/auth/me");
    await act(async () => { vi.advanceTimersByTime(10_000); });
    expect(((me?.[1] as RequestInit).signal as AbortSignal).aborted).toBe(true);
    await act(async () => { submitLogin(); });
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
      "/api/auth/login": () => sessionResponse(1000),
      "/api/auth/me": () => meResponse.promise,
      "/api/tickets": emptyTickets,
    });
    render(<App />);
    await act(async () => { submitLogin(); });
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
  it("shows the pending state until the API responds", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    render(<App />);
    expect(screen.getByRole("status").textContent).toContain("Checking API");
    expect((screen.getByRole("button", { name: "Check again" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("renders the shell and a reachable database", async () => {
    const fetchMock = vi.fn(healthy);
    vi.stubGlobal("fetch", fetchMock);
    render(<App />);
    expect(screen.getByRole("heading", { name: "Support Ticket AI" })).toBeTruthy();
    await screen.findByText("API online · PostgreSQL reachable");
    expect(fetchMock).toHaveBeenCalledWith("/api/health", expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  it("distinguishes database failure and allows retry", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: "degraded", database: "unreachable" }), { status: 503 }))
      .mockImplementationOnce(healthy));
    render(<App />);
    await screen.findByText(/PostgreSQL is unavailable/);
    fireEvent.click(screen.getByRole("button", { name: "Check again" }));
    await screen.findByText("API online · PostgreSQL reachable");
  });

  it.each(["network", "invalid-json", "unexpected-body"])("handles %s failures safely", async (failure) => {
    const fetchMock = vi.fn();
    if (failure === "network") fetchMock.mockRejectedValue(new Error("offline"));
    else fetchMock.mockResolvedValue(new Response(failure === "invalid-json" ? "not json" : "{}"));
    vi.stubGlobal("fetch", fetchMock);
    render(<App />);
    await screen.findByText(/Unable to check system health/);
    await waitFor(() => expect((screen.getByRole("button", { name: "Check again" }) as HTMLButtonElement).disabled).toBe(false));
  });
});
