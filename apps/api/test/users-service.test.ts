import { expect, it, vi } from "vitest";
import { seedDemoUser, seedSupportUser } from "../src/modules/users/services/users.service.js";

it("normalizes seed input and orchestrates plain persistence and password dependencies", async () => {
  const insert = vi.fn();
  const hash = vi.fn().mockResolvedValue("hashed-password");
  await seedDemoUser({ insert }, " DEMO@example.test ", "synthetic-password", { hash, id: () => "stable-id" });
  expect(hash).toHaveBeenCalledWith("synthetic-password");
  expect(insert).toHaveBeenCalledWith({ id: "stable-id", email: "demo@example.test", password_hash: "hashed-password" });
  await expect(seedDemoUser({ insert }, "invalid", "short", { hash, id: () => "unused" })).rejects.toThrow("DEMO_EMAIL");
  expect(insert).toHaveBeenCalledTimes(1);
  expect(hash).toHaveBeenCalledTimes(1);
});

it.each([[undefined, undefined], ["", ""], ["  ", " \t "]])("skips an unconfigured support seed without hashing or inserting (%s, %s)", async (email, password) => {
  const insert = vi.fn();
  const hash = vi.fn();
  await seedSupportUser({ insert }, email, password, { hash, id: () => "support-id" });
  expect(hash).not.toHaveBeenCalled();
  expect(insert).not.toHaveBeenCalled();
});

it.each([["support@example.test", ""], ["", "synthetic-password"], [undefined, "synthetic-password"], ["support@example.test", undefined]])("rejects a partial support seed (%s, %s)", async (email, password) => {
  const insert = vi.fn();
  const hash = vi.fn();
  await expect(seedSupportUser({ insert }, email, password, { hash, id: () => "support-id" })).rejects.toThrow("SUPPORT_EMAIL and SUPPORT_PASSWORD");
  expect(hash).not.toHaveBeenCalled();
  expect(insert).not.toHaveBeenCalled();
});

it("persists a configured support seed with the support role", async () => {
  const insert = vi.fn();
  const hash = vi.fn().mockResolvedValue("hashed");
  await seedSupportUser({ insert }, " SUPPORT@example.test ", "synthetic-password", { hash, id: () => "support-id" });
  expect(insert).toHaveBeenCalledWith({ id: "support-id", email: "support@example.test", password_hash: "hashed", role: "support" });
});
