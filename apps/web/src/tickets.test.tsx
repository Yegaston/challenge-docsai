import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import {
  baseRoutes, deferred, detailResponse, emptyTickets, failedAnalysis, identity, json, mockApi, succeededAnalysis,
  submitLogin, ticketSummary, ticketsResponse, type Routes,
} from "./test/helpers";

afterEach(() => { cleanup(); window.history.replaceState(null, "", "/"); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

async function login(routes: Routes = {}) {
  const fetchMock = mockApi({ ...baseRoutes(), "/api/tickets": emptyTickets, ...routes });
  render(<App />);
  submitLogin();
  await screen.findByText("demo@example.test");
  await waitFor(() => expect(screen.queryByText("Loading tickets…")).toBeNull());
  return fetchMock;
}

function call(fetchMock: ReturnType<typeof mockApi>, url: string) {
  return fetchMock.mock.calls.find(([candidate]) => candidate === url);
}

function postCall(fetchMock: ReturnType<typeof mockApi>, url: string) {
  return fetchMock.mock.calls.find(([candidate, init]) => candidate === url && init?.method === "POST");
}

function openNewTicket() {
  fireEvent.click(screen.getByRole("link", { name: "Create a ticket" }));
}

function fillAndCreate(text: string) {
  fireEvent.change(screen.getByLabelText("Ticket text"), { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: "Create ticket" }));
}

describe("ticket history", () => {
  it("shows an empty history and links to the new-ticket form", async () => {
    await login();
    expect(screen.getByText("No tickets yet.")).toBeTruthy();
    openNewTicket();
    expect(await screen.findByRole("heading", { name: "New ticket" })).toBeTruthy();
    expect(screen.getByLabelText("Ticket text")).toBeTruthy();
  });

  it("lists tickets with truncated text and the latest analysis status", async () => {
    const fetchMock = await login({
      "/api/tickets": () => ticketsResponse([ticketSummary("t2", "Ticket two"), ticketSummary("t1", "Ticket one")]),
      "/api/tickets/t1": () => detailResponse("t1", [succeededAnalysis()]),
      "/api/tickets/t2": () => detailResponse("t2", []),
    });
    await screen.findByText(/Analysis ready/);
    expect(screen.getByText(/No analysis yet\./)).toBeTruthy();
    expect(screen.getByRole("link", { name: /Ticket one/ })).toBeTruthy();
    expect(screen.getByRole("link", { name: /Ticket two/ })).toBeTruthy();
    expect(call(fetchMock, "/api/tickets/t1")).toBeTruthy();
    expect(call(fetchMock, "/api/tickets/t2")).toBeTruthy();
  });

  it("returns to login when a protected ticket request is rejected", async () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    await login({ "/api/tickets": () => json({}, 401) });
    await screen.findByText("Session invalid or expired. Log in again.");
    expect(screen.getByRole("button", { name: "Log in" })).toBeTruthy();
    expect(setItem).not.toHaveBeenCalled();
  });

  it("expires the session mid-flow and aborts an in-flight request", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const history = deferred<Response>();
    const fetchMock = mockApi({
      "/api/health": () => json({ status: "ok", database: "reachable" }),
      "/api/auth/login": () => json({ token: "synthetic-token", expiresAt: Date.now() + 1000 }),
      "/api/auth/me": identity,
      "/api/tickets": () => history.promise,
    });
    render(<App />);
    await act(async () => { submitLogin(); });
    expect(screen.getByText("demo@example.test")).toBeTruthy();
    const historyCall = call(fetchMock, "/api/tickets");
    await act(async () => { vi.advanceTimersByTime(1000); });
    expect(screen.getByText("Session expired. Log in again.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Log in" })).toBeTruthy();
    expect(((historyCall?.[1] as RequestInit).signal as AbortSignal).aborted).toBe(true);
    await act(async () => history.resolve(emptyTickets()));
    expect(screen.getByText("Session expired. Log in again.")).toBeTruthy();
  });

  it("retries after a history load failure", async () => {
    await login({ "/api/tickets": [() => Promise.reject(new Error("offline")), () => ticketsResponse([ticketSummary("t1")])] });
    await screen.findByText("Unable to reach the server. Try again.");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Ticket t1")).toBeTruthy();
  });
});

describe("new ticket", () => {
  it("requires ticket text before creating", async () => {
    const fetchMock = await login();
    openNewTicket();
    await screen.findByRole("heading", { name: "New ticket" });
    fireEvent.click(screen.getByRole("button", { name: "Create ticket" }));
    expect(screen.getByRole("alert").textContent).toBe("Enter the ticket text.");
    expect(postCall(fetchMock, "/api/tickets")).toBeUndefined();
  });

  it("shows server validation errors without losing the ticket text", async () => {
    await login({ "POST /api/tickets": () => json({ error: "Invalid ticket request." }, 400) });
    openNewTicket();
    await screen.findByRole("heading", { name: "New ticket" });
    fillAndCreate("Valid-looking text");
    expect((await screen.findByRole("alert")).textContent).toBe("Invalid ticket request.");
    expect((screen.getByLabelText("Ticket text") as HTMLTextAreaElement).value).toBe("Valid-looking text");
    expect(screen.getByRole("button", { name: "Create ticket" })).toBeTruthy();
  });

  it("creates a ticket, runs the analysis, and shows the completed detail", async () => {
    const analysis = deferred<Response>();
    const fetchMock = await login({
      "POST /api/tickets": () => json({ ticket: ticketSummary("t1", "Printer is on fire") }, 201),
      "POST /api/tickets/t1/analyses": () => analysis.promise,
      "/api/tickets/t1": () => detailResponse("t1", [succeededAnalysis({ id: "analysis-1" })]),
    });
    openNewTicket();
    await screen.findByRole("heading", { name: "New ticket" });
    fillAndCreate("Printer is on fire");
    expect((postCall(fetchMock, "/api/tickets")?.[1] as RequestInit).body).toBe(JSON.stringify({ text: "Printer is on fire" }));
    await screen.findByText("Analyzing… this can take up to a minute.");
    expect(screen.getByRole("button", { name: "Stop waiting" })).toBeTruthy();
    expect((postCall(fetchMock, "/api/tickets/t1/analyses")?.[1] as RequestInit).body).toBe("{}");
    await act(async () => analysis.resolve(json({ analysis: succeededAnalysis({ id: "analysis-1" }) }, 201)));
    expect(await screen.findByRole("heading", { name: "Latest analysis" })).toBeTruthy();
    expect(screen.getByText("Summary text")).toBeTruthy();
    expect(screen.getByText(/Category: Billing/)).toBeTruthy();
    expect(screen.getByText(/Attempt 1 of 1/)).toBeTruthy();
    expect(screen.getByText(/mock-model/)).toBeTruthy();
  });

  it.each([
    ["timeout", 504, { error: "Analysis timed out.", code: "timeout" }, "The analysis took too long. Try again."],
    ["provider", 502, { error: "Analysis provider failed.", code: "provider" }, "The AI provider failed. Try again."],
    ["invalid_output", 502, { error: "Analysis output was invalid.", code: "invalid_output" }, "The AI returned an unusable result. Try again."],
    ["unconfigured", 502, { error: "Analysis provider is not configured.", code: "unconfigured" }, "The AI provider is not configured on the server. Contact the operator."],
    ["limit", 429, { error: "Analysis limit reached. Try later.", code: "limit" }, "Analysis limit reached. Try later."],
    ["database", 503, { error: "Analysis storage unavailable. Reload before retrying.", code: "database" }, "Analysis storage unavailable. Reload before retrying."],
    ["unknown", 502, { error: "Internal detail not for display.", code: "future_code" }, "The analysis failed. Try again."],
    ["network", 0, null, "Unable to reach the server. Try again."],
  ])("maps analysis failure %s to an understandable message", async (_kind, status, body, expected) => {
    await login({
      "POST /api/tickets": () => json({ ticket: ticketSummary("t1") }, 201),
      "POST /api/tickets/t1/analyses": () => status === 0 ? Promise.reject(new Error("offline")) : json(body, status),
      "/api/tickets/t1": () => detailResponse("t1", []),
    });
    openNewTicket();
    await screen.findByRole("heading", { name: "New ticket" });
    fillAndCreate("Printer is on fire");
    await screen.findByRole("alert");
    expect(screen.getByRole("alert").textContent).toContain(expected);
    if (status === 0 || status === 503 || status === 502 || status === 504) {
      expect(screen.queryByRole("button", { name: "Try analysis again" })).toBeNull();
    } else expect(screen.getByRole("button", { name: "Try analysis again" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "View ticket" })).toBeTruthy();
  });

  it.each([0, 503])("keeps a new ticket guarded after uncertain POST %i across status refresh and remount", async (status) => {
    const fetchMock = await login({
      "/api/tickets": () => ticketsResponse([ticketSummary("t1")]),
      "POST /api/tickets": () => json({ ticket: ticketSummary("t1") }, 201),
      "POST /api/tickets/t1/analyses": () => status === 0 ? Promise.reject(new Error("offline")) : json({ code: "database" }, 503),
      "/api/tickets/t1": () => detailResponse("t1", []),
    });
    fireEvent.click(screen.getAllByRole("link", { name: "New ticket" })[0]);
    fillAndCreate("Printer is on fire");
    expect((await screen.findByRole("alert")).textContent).toMatch(/unable to confirm|check status/i);
    expect(screen.queryByRole("button", { name: "Try analysis again" })).toBeNull();
    fireEvent.click(screen.getByRole("link", { name: "View ticket" }));
    await screen.findByText("No analysis yet.");
    fireEvent.click(screen.getByRole("button", { name: "Refresh status" }));
    fireEvent.click(screen.getByRole("link", { name: "Back to tickets" }));
    fireEvent.click(await screen.findByRole("link", { name: /Ticket t1/ }));
    await screen.findByText("No analysis yet.");
    fireEvent.submit(screen.getByLabelText("Refinement instruction (optional)").closest("form")!);
    expect(screen.queryByRole("button", { name: "Run analysis" })).toBeNull();
    expect(fetchMock.mock.calls.filter(([url, init]) => url === "/api/tickets/t1/analyses" && init?.method === "POST")).toHaveLength(1);
  });

  it("guards a new ticket after Stop waiting and View ticket while the first attempt is uncertain", async () => {
    const analysis = deferred<Response>();
    const fetchMock = await login({
      "POST /api/tickets": () => json({ ticket: ticketSummary("t1") }, 201),
      "POST /api/tickets/t1/analyses": () => analysis.promise,
      "/api/tickets/t1": () => detailResponse("t1", []),
    });
    openNewTicket();
    await screen.findByRole("heading", { name: "New ticket" });
    fillAndCreate("Printer is on fire");
    fireEvent.click(await screen.findByRole("button", { name: "Stop waiting" }));
    fireEvent.click(screen.getByRole("link", { name: "View ticket" }));
    await screen.findByText("No analysis yet.");
    expect(screen.getByRole("button", { name: "Refresh status" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Run analysis" })).toBeNull();
    fireEvent.submit(screen.getByLabelText("Refinement instruction (optional)").closest("form")!);
    expect(fetchMock.mock.calls.filter(([url, init]) => url === "/api/tickets/t1/analyses" && init?.method === "POST")).toHaveLength(1);
  });

  it("stops waiting without implying the server stopped or offering duplicate analysis", async () => {
    const analysis = deferred<Response>();
    const fetchMock = await login({
      "POST /api/tickets": () => json({ ticket: ticketSummary("t1") }, 201),
      "POST /api/tickets/t1/analyses": [() => analysis.promise, () => json({ analysis: succeededAnalysis({ id: "analysis-1" }) }, 201)],
      "/api/tickets/t1": () => detailResponse("t1", [succeededAnalysis({ id: "analysis-1" })]),
    });
    openNewTicket();
    await screen.findByRole("heading", { name: "New ticket" });
    fillAndCreate("Printer is on fire");
    await screen.findByText("Analyzing… this can take up to a minute.");
    const analysisCall = postCall(fetchMock, "/api/tickets/t1/analyses");
    fireEvent.click(screen.getByRole("button", { name: "Stop waiting" }));
    expect(((analysisCall?.[1] as RequestInit).signal as AbortSignal).aborted).toBe(true);
    expect((await screen.findByRole("alert")).textContent).toMatch(/server may still be processing/i);
    expect(screen.queryByRole("button", { name: "Try analysis again" })).toBeNull();
    expect(screen.getByRole("link", { name: "View ticket" })).toBeTruthy();
    await act(async () => analysis.resolve(json({ analysis: succeededAnalysis() }, 201)));
    expect(screen.queryByRole("button", { name: "Try analysis again" })).toBeNull();
  });
});

describe("ticket detail", () => {
  it("does not recover from a GET started before the guard threshold, even when it completes afterward", async () => {
    const now = vi.spyOn(Date, "now"); const start = Date.now(); now.mockImplementation(() => start);
    const stale = deferred<Response>();
    let refreshes = 0;
    const fetchMock = await login({
      "/api/tickets": () => ticketsResponse([ticketSummary("t1")]),
      "/api/tickets/t1": () => ++refreshes === 3 ? stale.promise : detailResponse("t1", []),
      "POST /api/tickets/t1/analyses": () => Promise.reject(new Error("offline")),
    });
    fireEvent.click(screen.getByRole("link", { name: /Ticket t1/ }));
    await screen.findByText("No analysis yet.");
    fireEvent.click(screen.getByRole("button", { name: "Run analysis" }));
    await screen.findByRole("button", { name: "Refresh status" });
    now.mockImplementation(() => start + 74_999);
    fireEvent.click(screen.getByRole("button", { name: "Refresh status" }));
    expect(refreshes).toBe(3);
    now.mockImplementation(() => start + 75_000);
    await act(async () => stale.resolve(detailResponse("t1", [])));
    expect(screen.queryByRole("button", { name: "Discard uncertain wait" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Refresh status" }));
    const discard = await screen.findByRole("button", { name: "Discard uncertain wait" });
    expect(discard.hasAttribute("disabled")).toBe(true);
    expect(screen.getByText(/duplicate.*paid/i)).toBeTruthy();
    expect(fetchMock.mock.calls.filter(([url, init]) => url === "/api/tickets/t1/analyses" && init?.method === "POST")).toHaveLength(1);
  });
  it.each([false, true])("manually recovers an uncertain %s baseline only after a fresh 75s refresh and acknowledgement", async (hasPrior) => {
    const now = vi.spyOn(Date, "now");
    const start = Date.now(); now.mockImplementation(() => start);
    const analyses = hasPrior ? [succeededAnalysis({ id: "old" })] : [];
    const fetchMock = await login({
      "/api/tickets": () => ticketsResponse([ticketSummary("t1")]),
      "/api/tickets/t1": () => detailResponse("t1", analyses),
      "POST /api/tickets/t1/analyses": [() => Promise.reject(new Error("offline")), () => json({ analysis: succeededAnalysis({ id: "new" }) }, 201)],
    });
    fireEvent.click(screen.getByRole("link", { name: /Ticket t1/ }));
    await screen.findByRole("heading", { name: "Latest analysis" });
    fireEvent.click(screen.getByRole("button", { name: hasPrior ? "Refine analysis" : "Run analysis" }));
    await screen.findByRole("button", { name: "Refresh status" });
    fireEvent.click(screen.getByRole("link", { name: "Back to tickets" }));
    fireEvent.click(await screen.findByRole("link", { name: /Ticket t1/ }));
    await screen.findByRole("button", { name: "Refresh status" });
    now.mockImplementation(() => start + 74_999);
    fireEvent.click(screen.getByRole("button", { name: "Refresh status" }));
    expect(screen.queryByRole("button", { name: "Discard uncertain wait" })).toBeNull();
    now.mockImplementation(() => start + 75_000);
    fireEvent.click(screen.getByRole("button", { name: "Refresh status" }));
    const discard = await screen.findByRole("button", { name: "Discard uncertain wait" });
    expect(discard.hasAttribute("disabled")).toBe(true);
    expect(screen.getByText(/duplicate.*paid/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox", { name: /duplicate.*paid/i }));
    fireEvent.click(discard);
    expect(screen.getByRole("button", { name: hasPrior ? "Refine analysis" : "Run analysis" })).toBeTruthy();
    expect(fetchMock.mock.calls.filter(([url, init]) => url === "/api/tickets/t1/analyses" && init?.method === "POST")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: hasPrior ? "Refine analysis" : "Run analysis" }));
    await waitFor(() => expect(fetchMock.mock.calls.filter(([url, init]) => url === "/api/tickets/t1/analyses" && init?.method === "POST")).toHaveLength(2));
  });

  it.each(["running", "new", "failed-get"])('does not offer recovery after 75s when latest is %s', async (state) => {
    const now = vi.spyOn(Date, "now"); const start = Date.now(); now.mockImplementation(() => start);
    let refreshed = false;
    await login({
      "/api/tickets": () => ticketsResponse([ticketSummary("t1")]),
      "/api/tickets/t1": () => refreshed && state === "failed-get" ? Promise.reject(new Error("offline"))
        : detailResponse("t1", [succeededAnalysis({ id: refreshed && state !== "failed-get" ? "new" : "old", status: refreshed && state === "running" ? "running" : "succeeded" })]),
      "POST /api/tickets/t1/analyses": () => Promise.reject(new Error("offline")),
    });
    fireEvent.click(screen.getByRole("link", { name: /Ticket t1/ }));
    await screen.findByText("Summary text");
    fireEvent.click(screen.getByRole("button", { name: "Refine analysis" }));
    await screen.findByRole("button", { name: "Refresh status" });
    refreshed = true; now.mockImplementation(() => start + 75_000);
    fireEvent.click(screen.getByRole("button", { name: "Refresh status" }));
    if (state === "failed-get") await screen.findByRole("alert");
    else await screen.findByText(/Attempt 1 of 1/);
    expect(screen.queryByRole("button", { name: "Discard uncertain wait" })).toBeNull();
  });
  it.each([0, 503])("keeps refinement guarded after uncertain POST %i across refresh and remount", async (status) => {
    const fetchMock = await login({
      "/api/tickets": () => ticketsResponse([ticketSummary("t1")]),
      "/api/tickets/t1": () => detailResponse("t1", [succeededAnalysis({ id: "old" })]),
      "POST /api/tickets/t1/analyses": () => status === 0 ? Promise.reject(new Error("offline")) : json({ code: "database" }, 503),
    });
    fireEvent.click(screen.getByRole("link", { name: /Ticket t1/ }));
    await screen.findByText("Summary text");
    fireEvent.click(screen.getByRole("button", { name: "Refine analysis" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/unable to confirm|check status/i);
    fireEvent.click(screen.getByRole("button", { name: "Refresh status" }));
    fireEvent.click(screen.getByRole("link", { name: "Back to tickets" }));
    fireEvent.click(await screen.findByRole("link", { name: /Ticket t1/ }));
    await screen.findByText("Summary text");
    fireEvent.submit(screen.getByLabelText("Refinement instruction (optional)").closest("form")!);
    expect(screen.queryByRole("button", { name: "Refine analysis" })).toBeNull();
    expect(fetchMock.mock.calls.filter(([url, init]) => url === "/api/tickets/t1/analyses" && init?.method === "POST")).toHaveLength(1);
  });
  it("keeps a stopped refinement guarded across stale refresh and route remount, then clears on a new terminal ID", async () => {
    const refine = deferred<Response>();
    let latest: ReturnType<typeof succeededAnalysis> | ReturnType<typeof failedAnalysis> = succeededAnalysis({ id: "old" });
    const fetchMock = await login({
      "/api/tickets": () => ticketsResponse([ticketSummary("t1")]),
      "/api/tickets/t1": () => detailResponse("t1", [latest]),
      "POST /api/tickets/t1/analyses": () => refine.promise,
    });
    fireEvent.click(screen.getByRole("link", { name: /Ticket t1/ }));
    await screen.findByText("Summary text");
    fireEvent.click(screen.getByRole("button", { name: "Refine analysis" }));
    fireEvent.click(await screen.findByRole("button", { name: "Stop waiting" }));
    fireEvent.click(screen.getByRole("button", { name: "Refresh status" }));
    await waitFor(() => expect(fetchMock.mock.calls.filter(([url]) => url === "/api/tickets/t1").length).toBeGreaterThanOrEqual(3));
    expect(screen.queryByRole("button", { name: "Refine analysis" })).toBeNull();
    fireEvent.submit(screen.getByLabelText("Refinement instruction (optional)").closest("form")!);
    fireEvent.click(screen.getByRole("link", { name: "Back to tickets" }));
    fireEvent.click(await screen.findByRole("link", { name: /Ticket t1/ }));
    await screen.findByText("Summary text");
    expect(screen.queryByRole("button", { name: "Refine analysis" })).toBeNull();
    fireEvent.submit(screen.getByLabelText("Refinement instruction (optional)").closest("form")!);
    expect(fetchMock.mock.calls.filter(([url, init]) => url === "/api/tickets/t1/analyses" && init?.method === "POST")).toHaveLength(1);
    latest = failedAnalysis("provider", { id: "new" });
    fireEvent.click(screen.getByRole("button", { name: "Refresh status" }));
    await screen.findByText(/Attempt failed:/);
    expect(screen.getByRole("button", { name: "Refine analysis" })).toBeTruthy();
  });
  it("re-enables refinement on the same mount after refresh confirms a terminal attempt", async () => {
    const refine = deferred<Response>();
    let terminal = false;
    const fetchMock = await login({
      "/api/tickets": () => ticketsResponse([ticketSummary("t1")]),
      "/api/tickets/t1": () => detailResponse("t1", [
        succeededAnalysis({ id: "old" }),
        terminal ? failedAnalysis("provider", { id: "latest" }) : succeededAnalysis({ id: "old" }),
      ]),
      "POST /api/tickets/t1/analyses": () => refine.promise,
    });
    fireEvent.click(screen.getByRole("link", { name: /Ticket t1/ }));
    await screen.findByText(/Attempt 2 of 2/);
    fireEvent.click(screen.getByRole("button", { name: "Refine analysis" }));
    await screen.findByRole("button", { name: "Stop waiting" });
    fireEvent.click(screen.getByRole("button", { name: "Stop waiting" }));
    expect(screen.queryByRole("button", { name: "Refine analysis" })).toBeNull();
    expect(fetchMock.mock.calls.filter(([url, init]) => url === "/api/tickets/t1/analyses" && init?.method === "POST")).toHaveLength(1);
    terminal = true;
    fireEvent.click(screen.getByRole("button", { name: "Refresh status" }));
    await screen.findByText(/Attempt failed:/);
    expect(screen.getByRole("button", { name: "Refine analysis" })).toBeTruthy();
  });
  it("keeps a remounted running attempt guarded until refresh confirms a terminal attempt", async () => {
    let terminal = false;
    const fetchMock = await login({
      "/api/tickets": () => ticketsResponse([ticketSummary("t1")]),
      "/api/tickets/t1": () => detailResponse("t1", [
        succeededAnalysis({ id: "old" }),
        terminal ? failedAnalysis("provider", { id: "latest" }) : succeededAnalysis({ id: "latest", status: "running" }),
      ]),
      "POST /api/tickets/t1/analyses": () => json({ analysis: succeededAnalysis() }, 201),
    });
    fireEvent.click(screen.getByRole("link", { name: /Ticket t1/ }));
    await screen.findByText(/Attempt 2 of 2/);
    fireEvent.click(screen.getByRole("link", { name: "Back to tickets" }));
    await screen.findByRole("heading", { name: "Tickets" });
    fireEvent.click(screen.getByRole("link", { name: /Ticket t1/ }));
    await screen.findByText(/Attempt 2 of 2/);
    expect(screen.queryByRole("button", { name: "Refine analysis" })).toBeNull();
    fireEvent.submit(screen.getByLabelText("Refinement instruction (optional)").closest("form")!);
    expect(postCall(fetchMock, "/api/tickets/t1/analyses")).toBeUndefined();
    expect(screen.getByText(/server may still be processing/i)).toBeTruthy();
    terminal = true;
    fireEvent.click(screen.getByRole("button", { name: "Refresh status" }));
    await screen.findByText(/Attempt failed:/);
    expect(screen.getByRole("button", { name: "Refine analysis" })).toBeTruthy();
  });
  it("hides old detail and form while a new route id loads, including a missing ticket", async () => {
    const next = deferred<Response>();
    const fetchMock = await login({
      "/api/tickets": () => ticketsResponse([ticketSummary("t1", "Old ticket")]),
      "/api/tickets/t1": () => detailResponse("t1", [succeededAnalysis({ summary: "Old summary" })]),
      "/api/tickets/t2": () => next.promise,
    });
    fireEvent.click(screen.getByRole("link", { name: /Old ticket/ }));
    await screen.findByText("Old summary");
    await act(async () => { window.history.pushState(null, "", "/tickets/t2"); window.dispatchEvent(new PopStateEvent("popstate")); });
    expect(screen.queryByText("Old summary")).toBeNull();
    expect(screen.queryByLabelText("Refinement instruction (optional)")).toBeNull();
    expect(call(fetchMock, "/api/tickets/t2")).toBeTruthy();
    await act(async () => next.resolve(json({ error: "Ticket not found." }, 404)));
    expect(await screen.findByText("Ticket not found.")).toBeTruthy();
  });
  it("shows a clear message when a ticket is missing and navigates back", async () => {
    await login({
      "/api/tickets": () => ticketsResponse([ticketSummary("t1")]),
      "/api/tickets/t1": () => json({ error: "Ticket not found." }, 404),
    });
    fireEvent.click(screen.getByRole("link", { name: /Ticket t1/ }));
    await screen.findByRole("alert");
    expect(screen.getByRole("alert").textContent).toBe("Ticket not found.");
    fireEvent.click(screen.getByRole("link", { name: "Back to tickets" }));
    expect(await screen.findByRole("heading", { name: "Tickets" })).toBeTruthy();
  });

  it("retries after a detail load failure", async () => {
    await login({
      "/api/tickets": () => ticketsResponse([ticketSummary("t1")]),
      "/api/tickets/t1": [() => detailResponse("t1", [succeededAnalysis()]), () => Promise.reject(new Error("offline")), () => detailResponse("t1", [succeededAnalysis()])],
    });
    fireEvent.click(screen.getByRole("link", { name: /Ticket t1/ }));
    await screen.findByRole("alert");
    expect(screen.getByRole("alert").textContent).toBe("Unable to reach the server. Try again.");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Summary text")).toBeTruthy();
  });

  it("runs the first analysis from the ticket detail page", async () => {
    const fetchMock = await login({
      "/api/tickets": () => ticketsResponse([ticketSummary("t1")]),
      "/api/tickets/t1": [() => detailResponse("t1", []), () => detailResponse("t1", []), () => detailResponse("t1", [succeededAnalysis({ id: "analysis-1" })])],
      "POST /api/tickets/t1/analyses": () => json({ analysis: succeededAnalysis({ id: "analysis-1" }) }, 201),
    });
    fireEvent.click(screen.getByRole("link", { name: /Ticket t1/ }));
    await screen.findByText("No analysis yet.");
    fireEvent.click(screen.getByRole("button", { name: "Run analysis" }));
    const runCall = postCall(fetchMock, "/api/tickets/t1/analyses");
    expect((runCall?.[1] as RequestInit).body).toBe("{}");
    expect(await screen.findByText("Summary text")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Latest analysis" })).toBeTruthy();
  });

  it("renders model output as text, never as HTML", async () => {
    await login({
      "/api/tickets": () => ticketsResponse([ticketSummary("t1")]),
      "/api/tickets/t1": () => detailResponse("t1", [succeededAnalysis({ summary: "<b>not markup</b>", uncertaintyNote: "<img src=x onerror=alert(1)>" })]),
    });
    fireEvent.click(screen.getByRole("link", { name: /Ticket t1/ }));
    expect(await screen.findByText("<b>not markup</b>")).toBeTruthy();
    expect(screen.getByText(/<img src=x onerror/)).toBeTruthy();
    expect(document.querySelector("b")).toBeNull();
    expect(document.querySelector("img")).toBeNull();
  });

  it("refines the analysis with an instruction and shows prior versions newest first", async () => {
    const refine = deferred<Response>();
    const fetchMock = await login({
      "/api/tickets": () => ticketsResponse([ticketSummary("t1")]),
      "/api/tickets/t1": [
        () => detailResponse("t1", [succeededAnalysis({ id: "analysis-1", instruction: "First instruction" })]),
        () => detailResponse("t1", [succeededAnalysis({ id: "analysis-1", summary: "First summary", instruction: "First instruction" })]),
        () => detailResponse("t1", [
          succeededAnalysis({ id: "analysis-1", summary: "First summary", instruction: "First instruction" }),
          succeededAnalysis({ id: "analysis-2", summary: "Refined summary", instruction: "Focus on refunds", createdAt: "2026-01-02T00:00:00.000Z" }),
        ]),
      ],
      "POST /api/tickets/t1/analyses": () => refine.promise,
    });
    fireEvent.click(screen.getByRole("link", { name: /Ticket t1/ }));
    await screen.findByText("First summary");
    expect((screen.getByLabelText("Refinement instruction (optional)") as HTMLTextAreaElement).maxLength).toBe(2000);
    fireEvent.change(screen.getByLabelText("Refinement instruction (optional)"), { target: { value: "Focus on refunds" } });
    expect(screen.getByText("16/2000")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Refine analysis" }));
    const refineCall = postCall(fetchMock, "/api/tickets/t1/analyses");
    expect((refineCall?.[1] as RequestInit).body).toBe(JSON.stringify({ instruction: "Focus on refunds" }));
    await screen.findByText("Analyzing… this can take up to a minute.");
    await act(async () => refine.resolve(json({ analysis: succeededAnalysis({ id: "analysis-2" }) }, 201)));
    expect(await screen.findByText("Refined summary")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Latest analysis" }).nextElementSibling?.textContent).toContain("Refined summary");
    expect(screen.getByText(/Attempt 2 of 2/)).toBeTruthy();
    expect(screen.getByText(/Attempt 1 of 2/)).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Earlier versions" })).toBeTruthy();
    expect(screen.getByText(/Instruction: First instruction/)).toBeTruthy();
  });

  it("maps refinement failures and keeps the instruction for retry", async () => {
    const fetchMock = await login({
      "/api/tickets": () => ticketsResponse([ticketSummary("t1")]),
      "/api/tickets/t1": [
        () => detailResponse("t1", [succeededAnalysis({ id: "analysis-1" })]),
        () => detailResponse("t1", [succeededAnalysis({ id: "analysis-1" })]),
        () => detailResponse("t1", [succeededAnalysis({ id: "analysis-1" }), succeededAnalysis({ id: "analysis-2", summary: "Refined summary" })]),
      ],
      "POST /api/tickets/t1/analyses": [
        () => json({ error: "Analysis limit reached. Try later.", code: "limit" }, 429),
        () => json({ analysis: succeededAnalysis({ id: "analysis-2", summary: "Refined summary" }) }, 201),
      ],
    });
    fireEvent.click(screen.getByRole("link", { name: /Ticket t1/ }));
    await screen.findByText("Summary text");
    fireEvent.change(screen.getByLabelText("Refinement instruction (optional)"), { target: { value: "Focus on refunds" } });
    fireEvent.click(screen.getByRole("button", { name: "Refine analysis" }));
    await screen.findByRole("alert");
    expect(screen.getByRole("alert").textContent).toBe("Analysis limit reached. Try later.");
    expect((screen.getByLabelText("Refinement instruction (optional)") as HTMLTextAreaElement).value).toBe("Focus on refunds");
    fireEvent.click(screen.getByRole("button", { name: "Refine analysis" }));
    await act(async () => {});
    expect(await screen.findByText("Refined summary")).toBeTruthy();
  });

  it("shows a persisted failed refinement without hiding earlier versions", async () => {
    await login({
      "/api/tickets": () => ticketsResponse([ticketSummary("t1")]),
      "/api/tickets/t1": [
        () => detailResponse("t1", [succeededAnalysis({ id: "analysis-1" })]),
        () => detailResponse("t1", [succeededAnalysis({ id: "analysis-1" })]),
        () => detailResponse("t1", [succeededAnalysis({ id: "analysis-1" }), failedAnalysis("provider", { id: "analysis-2", createdAt: "2026-01-02T00:00:00.000Z" })]),
      ],
      "POST /api/tickets/t1/analyses": () => json({ error: "Analysis provider failed.", code: "provider", analysis: failedAnalysis("provider") }, 502),
    });
    fireEvent.click(screen.getByRole("link", { name: /Ticket t1/ }));
    await screen.findByText("Summary text");
    fireEvent.click(screen.getByRole("button", { name: "Refine analysis" }));
    await screen.findByRole("heading", { name: "Earlier versions" });
    expect(screen.getByRole("heading", { name: "Latest analysis" }).nextElementSibling?.textContent).toContain("The AI provider failed. Try again.");
    expect(screen.getByText("Summary text")).toBeTruthy();
  });

  it("stops waiting for a refinement without allowing immediate duplicate", async () => {
    const refine = deferred<Response>();
    const fetchMock = await login({
      "/api/tickets": () => ticketsResponse([ticketSummary("t1")]),
      "/api/tickets/t1": () => detailResponse("t1", [succeededAnalysis()]),
      "POST /api/tickets/t1/analyses": () => refine.promise,
    });
    fireEvent.click(screen.getByRole("link", { name: /Ticket t1/ }));
    await screen.findByText("Summary text");
    fireEvent.click(screen.getByRole("button", { name: "Refine analysis" }));
    await screen.findByText("Analyzing… this can take up to a minute.");
    const refineCall = postCall(fetchMock, "/api/tickets/t1/analyses");
    fireEvent.click(screen.getByRole("button", { name: "Stop waiting" }));
    expect(((refineCall?.[1] as RequestInit).signal as AbortSignal).aborted).toBe(true);
    expect((await screen.findByRole("alert")).textContent).toMatch(/server may still be processing/i);
    expect(screen.queryByRole("button", { name: "Refine analysis" })).toBeNull();
    expect(screen.getByRole("link", { name: "Back to tickets" })).toBeTruthy();
  });
});

describe("full flow session safety", () => {
  it("keeps the session token out of storage across the full flow", async () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const getItem = vi.spyOn(Storage.prototype, "getItem");
    const removeItem = vi.spyOn(Storage.prototype, "removeItem");
    await login({
      "POST /api/tickets": () => json({ ticket: ticketSummary("t1") }, 201),
      "POST /api/tickets/t1/analyses": () => json({ analysis: succeededAnalysis({ id: "analysis-1" }) }, 201),
      "/api/tickets/t1": () => detailResponse("t1", [succeededAnalysis({ id: "analysis-1" })]),
    });
    openNewTicket();
    await screen.findByRole("heading", { name: "New ticket" });
    fillAndCreate("Printer is on fire");
    expect(await screen.findByRole("heading", { name: "Latest analysis" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Log out" }));
    await screen.findByRole("button", { name: "Log in" });
    expect(setItem).not.toHaveBeenCalled();
    expect(getItem).not.toHaveBeenCalled();
    expect(removeItem).not.toHaveBeenCalled();
  });

  it("renders the API-provided timestamps without inventing data", async () => {
    await login({
      "/api/tickets": () => ticketsResponse([ticketSummary("t1")]),
      "/api/tickets/t1": () => detailResponse("t1", [failedAnalysis("timeout")]),
    });
    fireEvent.click(screen.getByRole("link", { name: /Ticket t1/ }));
    await screen.findByRole("alert");
    expect(screen.getByRole("alert").textContent).toBe("Attempt failed: The analysis took too long. Try again.");
    expect(screen.getByText(/mock-model/)).toBeTruthy();
  });
});
