import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "./App";

const healthy = () => Promise.resolve(new Response(JSON.stringify({ status: "ok", database: "reachable" })));

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("workspace health", () => {
  it("shows the pending state until the API responds", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    render(<App />);
    expect(screen.getByRole("status").textContent).toContain("Checking API");
    expect((screen.getByRole("button") as HTMLButtonElement).disabled).toBe(true);
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
    await waitFor(() => expect((screen.getByRole("button") as HTMLButtonElement).disabled).toBe(false));
  });
});
