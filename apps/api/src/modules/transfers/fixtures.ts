import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import express from "express";
import { requireUser } from "../auth/http/controller.js";
import type { AuthService } from "../auth/services/auth.service.js";

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
type Input = { amount: string; date: string; status: "pending" | "completed" | "failed"; idempotencyKey: string };
export function validateFixture(value: unknown, now = new Date()): Input | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const body = value as Record<string, unknown>;
  if (Object.keys(body).sort().join(",") !== "amount,date,idempotencyKey,status" ||
      typeof body.amount !== "string" || !/^(?:0|[1-9]\d{0,9})\.\d{2}$/.test(body.amount) || Number(body.amount) <= 0 ||
      typeof body.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(body.date) ||
      typeof body.idempotencyKey !== "string" || !uuid.test(body.idempotencyKey) ||
      (typeof body.status !== "string" || !["pending", "completed", "failed"].includes(body.status))) return;
  const date = new Date(`${body.date}T00:00:00Z`);
  const today = now.toISOString().slice(0, 10);
  const cutoff = new Date(`${today}T00:00:00Z`);
  cutoff.setUTCDate(cutoff.getUTCDate() - 90);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== body.date ||
      body.date < cutoff.toISOString().slice(0, 10) || body.date > today) return;
  return body as Input;
}

type Row = { id: string; amount: string; date: string; status: string; createdAt: Date; idempotencyKey: string | null };
const columns = "id, amount::text, transfer_date::text AS date, status, created_at AS \"createdAt\", idempotency_key AS \"idempotencyKey\"";
const publicRow = (row: Row) => ({ id: row.id, amount: row.amount, date: row.date, status: row.status, createdAt: row.createdAt });
export function createFixtureRepository(pool: Pick<Pool, "connect" | "query">) {
  return {
    async list(owner: string) {
      const result = await pool.query<Row>(`SELECT ${columns} FROM synthetic_transfers WHERE owner_id=$1 AND created_at >= now() - interval '90 days' ORDER BY created_at DESC, id DESC LIMIT 100`, [owner]);
      return result.rows.map(publicRow);
    },
    async create(owner: string, input: Input): Promise<{ record: ReturnType<typeof publicRow>; replay: boolean }> {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        // Serializes admission and same-key retries for this owner, across processes.
        await client.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [owner]);
        const existing = await client.query<Row>(`SELECT ${columns} FROM synthetic_transfers WHERE owner_id=$1 AND idempotency_key=$2`, [owner, input.idempotencyKey]);
        if (existing.rows[0]) {
          const row = existing.rows[0];
          // A retained unique key may outlive its visible record until the bounded sweep runs.
          // Do not disclose or recycle it before physical deletion.
          if (row.createdAt.getTime() < Date.now() - 90 * 24 * 60 * 60 * 1000) {
            await client.query("COMMIT");
            throw new FixtureConflict();
          }
          await client.query("COMMIT");
          if (row.amount !== input.amount || row.date !== input.date || row.status !== input.status) throw new FixtureConflict();
          return { record: publicRow(row), replay: true };
        }
        const count = await client.query<{ count: string }>("SELECT count(*)::text AS count FROM synthetic_transfers WHERE owner_id=$1 AND created_at >= now() - interval '90 days'", [owner]);
        if (Number(count.rows[0].count) >= 100) { await client.query("COMMIT"); throw new FixtureLimit(); }
        const inserted = await client.query<Row>(`INSERT INTO synthetic_transfers (id, owner_id, amount, transfer_date, status, idempotency_key) VALUES ($1,$2,$3,$4,$5,$6) RETURNING ${columns}`, [randomUUID(), owner, input.amount, input.date, input.status, input.idempotencyKey]);
        await client.query("COMMIT");
        return { record: publicRow(inserted.rows[0]), replay: false };
      } catch (error) {
        try { await client.query("ROLLBACK"); } catch { /* preserve original failure */ }
        throw error;
      } finally { client.release(); }
    },
    async purge() {
      await pool.query(`WITH batch AS (SELECT id FROM synthetic_transfers WHERE created_at < now() - interval '90 days' ORDER BY created_at, id LIMIT 100 FOR UPDATE SKIP LOCKED) DELETE FROM synthetic_transfers WHERE id IN (SELECT id FROM batch)`);
    },
  };
}
class FixtureConflict extends Error {}
class FixtureLimit extends Error {}
export function createFixtureRouter(repo: ReturnType<typeof createFixtureRepository>, auth: AuthService) {
  const router = express.Router();
  router.use((_request, response, next) => { response.set("Cache-Control", "no-store"); next(); });
  router.use(requireUser(auth));
  router.use((_request, response, next) => { if (response.locals.user.role !== "customer") response.status(403).json({ error: "Forbidden." }); else next(); });
  router.get("/", async (_request, response) => {
    try { response.json({ transfers: await repo.list(response.locals.user.id) }); }
    catch { response.status(503).json({ error: "Fixtures unavailable." }); }
  });
  router.post("/", express.json({ limit: "4kb", inflate: false }), async (request, response) => {
    const input = validateFixture(request.body);
    if (!input) { response.status(400).json({ error: "Invalid fixture." }); return; }
    try {
      const { record, replay } = await repo.create(response.locals.user.id, input);
      response.status(replay ? 200 : 201).json({ transfer: record });
    } catch (error) {
      response.status(error instanceof FixtureConflict ? 409 : error instanceof FixtureLimit ? 429 : 503).json({ error: error instanceof FixtureConflict ? "Idempotency conflict." : error instanceof FixtureLimit ? "Fixture limit reached." : "Fixtures unavailable." });
    }
  });
  router.use(((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
    response.status(error && typeof error === "object" && "type" in error && error.type === "entity.too.large" ? 413 : 400).json({ error: "Invalid fixture." });
  }) as express.ErrorRequestHandler);
  return router;
}
