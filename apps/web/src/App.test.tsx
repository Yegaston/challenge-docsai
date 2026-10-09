import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "./App";

const healthy = () => Promise.resolve(new Response(JSON.stringify({ status: "ok", database: "reachable" })));
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const identity = { user: { id: "persistent-id", email: "demo@example.test" } };
const session = () => ({ token: "synthetic-token", expiresAt: Date.now() + 900_000 });

function mockAuth(...responses: Array<Response | Promise<Response>>) {
  const auth = vi.fn();
  responses.forEach((response) => auth.mockResolvedValueOnce(response));
  const fetchMock = vi.fn((url: string, options?: RequestInit) => url === "/api/health" ? healthy() : auth(url, options));
  vi.stubGlobal("fetch", fetchMock);
  return auth;
}

function submitLogin() {
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: "demo@example.test" } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "synthetic-password" } });
  fireEvent.click(screen.getByRole("button", { name: "Log in" }));
}

afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("demo authentication", () => {
  it("logs in, sends a bearer protected request, keeps storage empty, and logs out", async () => {
    const local = vi.spyOn(Storage.prototype, "setItem");
    const auth = mockAuth(json(session()), json(identity));
    render(<App />);
    submitLogin();
    await screen.findByText("demo@example.test");
    expect(auth.mock.calls[1][0]).toBe("/api/auth/me");
    expect(auth.mock.calls[1][1].headers.Authorization === "Bearer synthetic-token").toBe(true);
    expect(local).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Log out" }));
    expect(screen.getByRole("button", { name: "Log in" })).toBeTruthy();
    expect(screen.queryByText("demo@example.test")).toBeNull();
    expect((screen.getByLabelText("Password") as HTMLInputElement).value).toBe("");
  });

  it("shows pending feedback and generic bad-credential errors", async () => {
    let resolve!: (response: Response) => void;
    mockAuth(new Promise((done) => { resolve = done; }));
    render(<App />);
    submitLogin();
    expect(screen.getByText("Logging in…")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Logging in…" }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => resolve(json({}, 401)));
    expect(screen.getByRole("alert").textContent).toBe("Invalid email or password.");
  });

  it.each(["network", "server", "malformed"])("handles %s login failures without entering a session", async (kind) => {
    const auth = mockAuth();
    if (kind === "network") auth.mockRejectedValue(new Error("offline"));
    else auth.mockResolvedValue(kind === "server" ? json({}, 503) : json({}));
    render(<App />);
    submitLogin();
    await screen.findByRole("alert");
    expect(screen.queryByRole("button", { name: "Log out" })).toBeNull();
    expect((screen.getByRole("button", { name: "Log in" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("resets a session rejected by the protected API", async () => {
    mockAuth(json(session()), json({}, 401));
    render(<App />);
    submitLogin();
    await screen.findByText("Session invalid or expired. Log in again.");
    expect(screen.getByRole("button", { name: "Log in" })).toBeTruthy();
  });

  it("expires locally at the server deadline without sleeping", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    mockAuth(json(session()), json(identity));
    render(<App />);
    await act(async () => { submitLogin(); });
    expect(screen.getByText("demo@example.test")).toBeTruthy();
    await act(async () => { vi.advanceTimersByTime(900_000); });
    expect(screen.getByText("Session expired. Log in again.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Log in" })).toBeTruthy();
  });

  it("allows retry after a protected network failure and clears on a later 401", async () => {
    const auth = mockAuth(json(session()), json(identity));
    render(<App />);
    submitLogin();
    await screen.findByText("demo@example.test");
    auth.mockRejectedValueOnce(new Error("offline"));
    fireEvent.click(screen.getByRole("button", { name: "Verify session" }));
    await screen.findByText("Unable to reach authentication service. Try again.");
    auth.mockResolvedValueOnce(json({}, 401));
    fireEvent.click(screen.getByRole("button", { name: "Verify session" }));
    await screen.findByText("Session invalid or expired. Log in again.");
    expect(screen.queryByText("demo@example.test")).toBeNull();
  });

  it("aborts and ignores a stale protected response after logout", async () => {
    let resolve!: (response: Response) => void;
    const auth = mockAuth(json(session()), new Promise((done) => { resolve = done; }));
    render(<App />);
    submitLogin();
    await screen.findByRole("button", { name: "Log out" });
    const signal = auth.mock.calls[1][1].signal as AbortSignal;
    fireEvent.click(screen.getByRole("button", { name: "Log out" }));
    expect(signal.aborted).toBe(true);
    await act(async () => resolve(json(identity)));
    expect(screen.queryByText("demo@example.test")).toBeNull();
    expect(screen.getByRole("button", { name: "Log in" })).toBeTruthy();
  });

  it("ignores an old identity response after a new login succeeds", async () => {
    let resolve!: (response: Response) => void;
    mockAuth(json(session()), new Promise((done) => { resolve = done; }), json(session()), json({ user: { id: "new-id", email: "new@example.test" } }));
    render(<App />);
    submitLogin();
    await screen.findByRole("button", { name: "Log out" });
    fireEvent.click(screen.getByRole("button", { name: "Log out" }));
    submitLogin();
    await screen.findByText("new@example.test");
    await act(async () => resolve(json(identity)));
    expect(screen.queryByText("demo@example.test")).toBeNull();
    expect(screen.getByText("new@example.test")).toBeTruthy();
  });

  it("expires and ignores a delayed identity response", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    let resolve!: (response: Response) => void;
    const auth = mockAuth(json({ ...session(), expiresAt: Date.now() + 1000 }), new Promise((done) => { resolve = done; }));
    render(<App />);
    await act(async () => { submitLogin(); });
    await act(async () => { vi.advanceTimersByTime(1000); });
    expect(auth.mock.calls[1][1].signal.aborted).toBe(true);
    await act(async () => resolve(json(identity)));
    expect(screen.getByText("Session expired. Log in again.")).toBeTruthy();
    expect(screen.queryByText("demo@example.test")).toBeNull();
  });

  it("times out login and ignores a late successful response", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    let resolve!: (response: Response) => void;
    const auth = mockAuth(new Promise((done) => { resolve = done; }));
    render(<App />);
    await act(async () => { submitLogin(); });
    await act(async () => { vi.advanceTimersByTime(10_000); });
    expect(auth.mock.calls[0][1].signal.aborted).toBe(true);
    await act(async () => resolve(json(session())));
    expect(screen.getByText("Authentication request timed out. Try again.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Log out" })).toBeNull();
  });

  it("aborts an in-flight login on unmount", async () => {
    const auth = mockAuth(new Promise(() => {}));
    const view = render(<App />);
    submitLogin();
    const signal = auth.mock.calls[0][1].signal as AbortSignal;
    view.unmount();
    expect(signal.aborted).toBe(true);
  });
});

describe("workspace health", () => {
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
