import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { hashPassword } from "../modules/auth/utils/password.js";
import { createUsers } from "../modules/users/repositories/users.repository.js";
import { seedDemoUser, seedSupportUser, validateSeed, validateSupportSeed } from "../modules/users/services/users.service.js";

type Database = Parameters<typeof createUsers>[0];

export async function initializeUsers(database: Database, email: unknown, password: unknown, supportEmail?: unknown, supportPassword?: unknown) {
  const customer = validateSeed(email, password);
  const support = validateSupportSeed(supportEmail, supportPassword);
  if (support && support.email === customer.email) throw new Error("Support and customer seed emails must differ.");
  // Anchor at the original root module location: src/../migrations and dist/../migrations.
  // Run on every startup, not only PostgreSQL's first-volume initialization.
  const root = new URL("../", import.meta.url);
  for (const migration of ["001-users.sql", "002-tickets.sql", "003-analyses.sql", "004-ticket-deletion.sql", "005-ticket-retention-index.sql", "006-audit-events.sql", "007-audit-retention.sql", "008-wrong-answer-reports.sql", "009-report-corrections.sql", "010-support-conversations.sql"]) {
    const schema = await readFile(new URL(`../migrations/${migration}`, root), "utf8");
    await database.query(schema);
  }
  await seedDemoUser(createUsers(database), email, password, { hash: hashPassword, id: randomUUID });
  await seedSupportUser(createUsers(database), supportEmail, supportPassword, { hash: hashPassword, id: randomUUID });
}
