import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import App from "./App";
import { baseRoutes, deferred, json, mockApi, submitLogin, type Routes } from "./test/helpers";
const id = "11111111-1111-4111-8111-111111111111";
afterEach(() => { cleanup(); window.history.replaceState(null, "", "/"); vi.unstubAllGlobals(); });
async function open(role: "customer" | "support" = "customer", routes: Routes = {}) {
  window.history.replaceState(null, "", "/transfers");
  const mock = mockApi({ ...baseRoutes(), "/api/auth/me": () => json({ user: { id: "u1", email: "demo@example.test", role } }), "/api/synthetic-transfers": () => json({ transfers: [] }), ...routes });
  render(<App />); await submitLogin(); await screen.findByText("demo@example.test");
  if (role === "customer") fireEvent.click(screen.getByRole("link", { name: "Demo transfers" }));
  return mock;
}
it("denies support access without loading fixtures", async () => {
  const mock = await open("support");
  expect(screen.queryByRole("heading", { name: /synthetic transfers/i })).toBeNull();
  expect(mock.mock.calls.some(([path]) => path === "/api/synthetic-transfers")).toBe(false);
});
it("shows empty and list errors", async () => {
  await open(); expect(await screen.findByText(/No synthetic transfers yet/)).toBeTruthy();
  cleanup(); window.history.replaceState(null, "", "/");
  await open("customer", { "/api/synthetic-transfers": () => json({}, 503) });
  expect(await screen.findByRole("alert")).toHaveProperty("textContent", expect.stringMatching(/load/i));
});
it("validates, creates once, refreshes and links to draft", async () => {
  let rows: object[] = [];
  const mock = await open("customer", { "/api/synthetic-transfers": () => json({ transfers: rows }), "POST /api/synthetic-transfers": () => { rows = [{ id, amount: "12.34", date: new Date().toISOString().slice(0, 10), status: "pending" }]; return json({ transfer: rows[0] }, 201); } });
  fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "invalid" } });
  fireEvent.click(screen.getByRole("button", { name: "Add synthetic transfer" }));
  expect(mock.mock.calls.filter(([path, init]) => path === "/api/synthetic-transfers" && init?.method === "POST")).toHaveLength(0);
  fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "12.34" } });
  fireEvent.click(screen.getByRole("button", { name: "Add synthetic transfer" }));
  expect(await screen.findByRole("link", { name: "Ask agent about this" })).toHaveProperty("href", expect.stringContaining(`/chat?transfer=${id}`));
  expect(screen.getByRole("status").textContent).toContain(id);
});
it("opens a synthetic transfer as an unsent chat draft", async () => {
  const mock = await open("customer", { "/api/synthetic-transfers": () => json({ transfers: [{ id, amount: "12.34", date: "2026-01-01", status: "pending" }] }) });
  fireEvent.click(await screen.findByRole("link", { name: "Ask agent about this" }));
  expect(window.location.pathname + window.location.search).toBe(`/chat?transfer=${id}`);
  expect(await screen.findByRole("heading", { name: "New chat" })).toBeTruthy();
  expect((screen.getByLabelText("How can we help with your transfer?") as HTMLTextAreaElement).value).toContain(id);
  expect(mock.mock.calls.filter(([path, init]) => typeof path === "string" && path.startsWith("/api/conversations") && init?.method === "POST")).toHaveLength(0);
});
it("ignores an older list response after a successful create refresh", async () => {
  const old = deferred<Response>();
  const newer = deferred<Response>();
  const mock = await open("customer", { "/api/synthetic-transfers": [() => old.promise, () => newer.promise], "POST /api/synthetic-transfers": () => json({ transfer: { id } }, 201) });
  fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "12.34" } });
  fireEvent.click(screen.getByRole("button", { name: "Add synthetic transfer" }));
  await waitFor(() => expect(mock.mock.calls.filter(([path, init]) => path === "/api/synthetic-transfers" && init?.method !== "POST")).toHaveLength(2));
  newer.resolve(json({ transfers: [{ id, amount: "12.34", date: "2026-01-01", status: "pending" }] }));
  expect(await screen.findByText(/12\.34.*ID:/)).toBeTruthy();
  await act(async () => { old.resolve(json({}, 401)); await old.promise; });
  expect(screen.getByText(/12\.34.*ID:/)).toBeTruthy();
  expect(screen.getByText("demo@example.test")).toBeTruthy();
  const loads = mock.mock.calls.filter(([path, init]) => path === "/api/synthetic-transfers" && init?.method !== "POST");
  expect(loads[0][1]?.signal?.aborted).toBe(true);
});
it("ignores a late create 401 after unmount", async () => {
  const post = deferred<Response>();
  const mock = await open("customer", { "POST /api/synthetic-transfers": () => post.promise });
  fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "12.34" } });
  fireEvent.click(screen.getByRole("button", { name: "Add synthetic transfer" }));
  await waitFor(() => expect(mock.mock.calls.some(([path, init]) => path === "/api/synthetic-transfers" && init?.method === "POST")).toBe(true));
  fireEvent.click(screen.getByRole("link", { name: /tickets/i }));
  await act(async () => { post.resolve(json({}, 401)); await post.promise; });
  expect(screen.getByText("demo@example.test")).toBeTruthy();
  const request = mock.mock.calls.find(([path, init]) => path === "/api/synthetic-transfers" && init?.method === "POST");
  expect(request?.[1]?.signal?.aborted).toBe(true);
});
it("keeps exact request on uncertain retry", async () => {
  let count = 0;
  const mock = await open("customer", { "POST /api/synthetic-transfers": () => ++count === 1 ? json({}, 503) : json({ transfer: { id } }, 201) });
  fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "12.34" } });
  fireEvent.click(screen.getByRole("button", { name: "Add synthetic transfer" }));
  fireEvent.click(await screen.findByRole("button", { name: "Retry same request" }));
  await waitFor(() => expect(count).toBe(2));
  const posts = mock.mock.calls.filter(([path, init]) => path === "/api/synthetic-transfers" && init?.method === "POST");
  expect(posts[0][1]?.body).toBe(posts[1][1]?.body);
});
