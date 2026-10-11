import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { hashPassword } from "../modules/auth/utils/password.js";
import { createUsers } from "../modules/users/repositories/users.repository.js";
import { seedDemoUser, validateSeed } from "../modules/users/services/users.service.js";

type Database = Parameters<typeof createUsers>[0];

export async function initializeUsers(database: Database, email: unknown, password: unknown) {
  validateSeed(email, password);
  // Anchor at the original root module location: src/../migrations and dist/../migrations.
  // Run on every startup, not only PostgreSQL's first-volume initialization.
  const root = new URL("../", import.meta.url);
  for (const migration of ["001-users.sql", "002-tickets.sql", "003-analyses.sql"]) {
    const schema = await readFile(new URL(`../migrations/${migration}`, root), "utf8");
    await database.query(schema);
  }
  await seedDemoUser(createUsers(database), email, password, { hash: hashPassword, id: randomUUID });
}
