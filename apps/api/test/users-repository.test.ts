import { expect, it, vi } from "vitest";
import { createUsers } from "../src/modules/users/repository.js";

it("parameterizes every persisted field and preserves conflict-safe inserts", async () => {
  const query = vi.fn().mockResolvedValue({ rows: [] });
  const users = createUsers({ query });
  const user = { id: "id'", email: "email'", password_hash: "hash'" };
  await users.insert(user);
  expect(query).toHaveBeenCalledWith(
    "INSERT INTO users (id, email, password_hash) VALUES ($1, $2, $3) ON CONFLICT (email) DO NOTHING",
    [user.id, user.email, user.password_hash],
  );
  await users.byEmail(user.email);
  await users.byId(user.id);
  expect(query.mock.calls[1]).toEqual([expect.stringContaining("email = $1"), [user.email]]);
  expect(query.mock.calls[2]).toEqual([expect.stringContaining("id = $1"), [user.id]]);
});
