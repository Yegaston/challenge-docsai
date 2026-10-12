import type { Pool } from "pg";

export function createAuditRetention(database: Pick<Pool, "query">) {
  return {
    async sweep() {
      const deleted = await database.query(`WITH batch AS (
        SELECT id FROM audit_events WHERE created_at < clock_timestamp() - interval '180 days'
        ORDER BY created_at, id LIMIT 100 FOR UPDATE SKIP LOCKED
      ), removed AS (DELETE FROM audit_events WHERE id IN (SELECT id FROM batch) RETURNING id)
      SELECT count(*)::text AS count FROM removed`);
      const backlog = await database.query(`SELECT count(*)::text AS count FROM audit_events
        WHERE created_at < clock_timestamp() - interval '180 days'`);
      return { deleted: Number(deleted.rows[0].count), backlog: Number(backlog.rows[0].count) };
    },
  };
}

type Timer = { setInterval(callback: () => void, ms: number): ReturnType<typeof setInterval>;
  clearInterval(id: ReturnType<typeof setInterval>): void };
export function startAuditRetention(
  service: { sweep(): Promise<{ deleted: number; backlog: number }> },
  timer: Timer = { setInterval, clearInterval },
  report: (message: string) => void = (message) => console.warn(message),
) {
  let stopped = false;
  let inFlight: Promise<void> | undefined;
  const run = () => {
    if (stopped || inFlight) return;
    inFlight = service.sweep().then(({ deleted, backlog }) => {
      if (deleted || backlog) report(`Audit retention deleted: ${deleted}; backlog: ${backlog}`);
    }).catch(() => { report("Audit retention sweep failed; will retry."); })
      .finally(() => { inFlight = undefined; });
  };
  run();
  const interval = timer.setInterval(run, 15 * 60 * 1000);
  return async () => { stopped = true; timer.clearInterval(interval); await inFlight; };
}
