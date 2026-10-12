import { randomUUID } from "node:crypto";
import type { Pool } from "pg";

// All handoff paths lock the conversation first; a customer response and a sweep cannot both win.
export function createConversationEscalation(database: Pick<Pool, "connect">) {
  async function handoff(id: string, owner?: string) {
    const client = await database.connect();
    try {
      await client.query("BEGIN");
      // Same ordering as invocation and resolution: advisory lock before row lock.
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [id]);
      const selected = await client.query(`SELECT id, owner_id, status, ticket_id, created_at, clarification_deadline, (clarification_deadline <= clock_timestamp()) AS deadline_due FROM conversations
        WHERE id=$1 AND created_at > clock_timestamp() - interval '90 days' FOR UPDATE`, [id]);
      const row = selected.rows[0];
      if (!row || (owner && row.owner_id !== owner)) { await client.query("COMMIT"); return undefined; }
      if (row.status === "open" && (owner || row.deadline_due)) {
        const ticketId = row.ticket_id ?? randomUUID();
        await client.query("INSERT INTO tickets (id, owner_id, text, created_at) VALUES ($1,$2,$3,$4) ON CONFLICT (id) DO NOTHING", [ticketId, row.owner_id, "Customer requested human transfer support. See linked conversation for context.", new Date()]);
        await client.query("UPDATE conversations SET status='escalated', clarification_deadline=NULL, ticket_id=$2 WHERE id=$1", [id, ticketId]);
        await client.query("INSERT INTO conversation_messages (id, conversation_id, sender_role, text, created_at) VALUES ($1,$2,'system',$3,clock_timestamp())", [randomUUID(), id, owner ? "Connected to human support." : "Conversation handed to human support."]);
        row.ticket_id = ticketId;
        row.status = "escalated";
        row.clarification_deadline = null;
      }
      await client.query("COMMIT");
      return row;
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }
  return {
    handoff,
    async sweep() {
      // A bounded candidate read; each candidate is rechecked under its row lock in handoff.
      const client = await database.connect();
      let ids: string[];
      try {
        await client.query("BEGIN");
        const result = await client.query(`SELECT id FROM conversations WHERE status='open' AND clarification_deadline <= clock_timestamp()
          AND created_at > clock_timestamp() - interval '90 days' ORDER BY clarification_deadline, id LIMIT 100 FOR UPDATE SKIP LOCKED`);
        ids = result.rows.map(row => row.id);
        await client.query("COMMIT");
      } catch (error) { await client.query("ROLLBACK"); throw error; }
      finally { client.release(); }
      for (const id of ids) await handoff(id);
      return ids.length;
    },
  };
}

export function startConversationEscalation(service: { sweep(): Promise<number> }) {
  let stopped = false;
  let running: Promise<unknown> | undefined;
  const run = () => {
    if (stopped || running) return;
    running = service.sweep().catch(() => { console.warn("Conversation escalation sweep failed; will retry."); }).finally(() => { running = undefined; });
  };
  run();
  const timer = setInterval(run, 60_000);
  return async () => { stopped = true; clearInterval(timer); await running; };
}
