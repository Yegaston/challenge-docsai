import type { Pool } from "pg";

export function createConversationRetention(database: Pick<Pool, "query">) {
  return {
    async sweep() {
      // The message FK cascades, so a deleted thread cannot leave message content behind.
      const deleted = await database.query(`WITH batch AS (
        SELECT id FROM conversations WHERE created_at < clock_timestamp() - interval '90 days'
        ORDER BY created_at, id LIMIT 100 FOR UPDATE SKIP LOCKED
      ), removed AS (DELETE FROM conversations WHERE id IN (SELECT id FROM batch) RETURNING id)
      SELECT count(*)::text AS count FROM removed`);
      await database.query("DELETE FROM chat_send_limits WHERE owner_id IN (SELECT owner_id FROM chat_send_limits WHERE last_at < clock_timestamp() - interval '90 days' ORDER BY last_at LIMIT 100 FOR UPDATE SKIP LOCKED)");
      const backlog = await database.query(`SELECT count(*)::text AS count FROM conversations
        WHERE created_at < clock_timestamp() - interval '90 days'`);
      return { deleted: Number(deleted.rows[0].count), backlog: Number(backlog.rows[0].count) };
    },
  };
}

type Timer = { setInterval(callback: () => void, ms: number): ReturnType<typeof setInterval>;
  clearInterval(id: ReturnType<typeof setInterval>): void };
export function startConversationRetention(
  service: { sweep(): Promise<{ deleted: number; backlog: number }> },
  timer: Timer = { setInterval, clearInterval },
  report: (message: string) => void = (message) => console.warn(message),
) {
  let stopped = false;
  let inFlight: Promise<void> | undefined;
  const run = () => {
    if (stopped || inFlight) return;
    inFlight = service.sweep().then(({ deleted, backlog }) => {
      if (deleted || backlog) report(`Conversation retention deleted: ${deleted}; backlog: ${backlog}`);
    }).catch(() => { report("Conversation retention sweep failed; will retry."); })
      .finally(() => { inFlight = undefined; });
  };
  run();
  const interval = timer.setInterval(run, 15 * 60 * 1000);
  return async () => { stopped = true; timer.clearInterval(interval); await inFlight; };
}
