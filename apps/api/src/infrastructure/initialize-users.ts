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
  for (const migration of ["001-users.sql", "002-tickets.sql", "003-analyses.sql", "004-ticket-deletion.sql", "005-ticket-retention-index.sql", "006-audit-events.sql", "007-audit-retention.sql", "008-wrong-answer-reports.sql", "009-report-corrections.sql", "010-support-conversations.sql", "011-transfer-agent.sql", "012-chat-idempotency.sql", "013-chat-claim-retention.sql", "014-chat-claim-state.sql", "015-conversation-handoff.sql", "016-conversation-handoff-integrity.sql", "017-chat-clarification-options.sql", "018-synthetic-transfer-fixtures.sql"])  {
    const schema = await readFile(new URL(`../migrations/${migration}`, root), "utf8");
    await database.query(schema);
  }
  await seedDemoUser(createUsers(database), email, password, { hash: hashPassword, id: randomUUID });
  const demo = await createUsers(database).byEmail(customer.email);
  if (demo) await database.query(`INSERT INTO synthetic_transfers (id, owner_id, amount, transfer_date, status)
    SELECT id, $1, amount, transfer_date, status FROM (VALUES
      ('a1111111-1111-4111-8111-111111111111'::uuid, 25.00, '2026-01-01'::date, 'pending'),
      ('a2222222-2222-4222-8222-222222222222'::uuid, 42.50, '2026-01-02'::date, 'completed')
    ) AS seeds(id, amount, transfer_date, status)
    WHERE transfer_date >= now() - interval '90 days'
    ON CONFLICT (id) DO NOTHING`, [demo.id]);
  // Rolling synthetic fixture only for this configured customer; replace its date rather than
  // accumulating historical records. No bank connection or transaction identity is inferred.
  if (demo) await database.query(`INSERT INTO synthetic_transfers (id, owner_id, amount, transfer_date, status)
    VALUES ('a3333333-3333-4333-8333-333333333333', $1, 37.25, $2, 'pending')
    ON CONFLICT (id) DO UPDATE SET transfer_date=$2, created_at=now() WHERE synthetic_transfers.owner_id=$1`, [demo.id, new Date().toISOString().slice(0, 10)]);
  await seedSupportUser(createUsers(database), supportEmail, supportPassword, { hash: hashPassword, id: randomUUID });
}
