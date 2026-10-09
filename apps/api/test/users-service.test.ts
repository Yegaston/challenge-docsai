import { expect, it, vi } from "vitest";
import { seedDemoUser } from "../src/modules/users/service.js";

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
