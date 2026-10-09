import { expect, it, vi } from "vitest";
import { createAuthService } from "../src/modules/auth/services/auth.service.js";
import { hashPassword } from "../src/modules/auth/utils/password.js";

it("authenticates without HTTP, resolves current identity, and rejects expired sessions", async () => {
  let time = new Date("2026-01-01T00:00:00Z");
  const user = { id: "00000000-0000-4000-8000-000000000001", email: "demo@example.test", password_hash: await hashPassword("synthetic-password") };
  const users = { byEmail: vi.fn().mockResolvedValue(user), byId: vi.fn().mockResolvedValue(user) };
  const auth = await createAuthService({ users, secret: "s".repeat(32), now: () => time });
  const session = await auth.login(user.email, "synthetic-password");
  expect(session.expiresAt).toBe(time.getTime() + 900000);
  expect(await auth.identity(session.token)).toEqual({ id: user.id, email: user.email });
  expect(users.byId).toHaveBeenCalledWith(user.id);
  await expect(auth.login(user.email, "wrong-password")).rejects.toThrow("invalid-credentials");
  users.byId.mockRejectedValue(new Error("driver details"));
  await expect(auth.identity(session.token)).rejects.toThrow("unavailable");
  users.byId.mockResolvedValue(undefined);
  await expect(auth.identity(session.token)).rejects.toThrow("invalid-session");
  users.byId.mockResolvedValue(user);
  time = new Date(time.getTime() + 900000);
  await expect(auth.identity(session.token)).rejects.toThrow("invalid-session");
});

it("distinguishes invalid credentials, invalid sessions and unavailable persistence", async () => {
  const users = { byEmail: vi.fn().mockResolvedValue(undefined), byId: vi.fn() };
  const auth = await createAuthService({ users, secret: "s".repeat(32) });
  await expect(auth.login("missing@example.test", "synthetic-password")).rejects.toThrow("invalid-credentials");
  await expect(auth.identity("not-a-token")).rejects.toThrow("invalid-session");
  expect(users.byId).not.toHaveBeenCalled();
  users.byEmail.mockRejectedValue(new Error("driver details"));
  await expect(auth.login("demo@example.test", "synthetic-password")).rejects.toThrow("unavailable");
});
