import type { Pool } from "pg";
import { createHash } from "node:crypto";

export type Conversation = { id: string; owner_id: string; status: "open" | "escalated" | "resolved"; created_at: Date; clarification_deadline?: Date | null; ticket_id?: string | null };
export type Message = { id: string; sender_role: string; text: string; created_at: Date };
export type Role = "customer" | "support";
export type Conversations = {
  insert(row: Conversation, text: string): Promise<Conversation>;
  list(owner: string, role: Role): Promise<Conversation[]>;
  byId(id: string, owner: string, role: Role): Promise<Conversation | undefined>;
  messages(id: string): Promise<Message[]>;
  append(id: string, role: "customer" | "agent" | "system", text: string): Promise<void>;
  admit?(owner: string, id: string, key: string, text: string, opening?: Conversation): Promise<"new" | "duplicate" | "conflict" | "busy" | "missing" | "forbidden">;
  completed?(owner: string, id: string, key: string): Promise<{ state: string; response: { text: string } | null }>;
  withInvocation?<T>(owner: string, id: string, run: () => Promise<T>): Promise<T>;
  finish?(owner: string, id: string, key: string, response?: { text: string }): Promise<void>;
  complete?(owner: string, id: string, key: string, activity: string[], response: { text: string; needsClarification?: boolean }): Promise<void>;
  humanMessage?(id: string, owner: string, role: Role, key: string, text: string): Promise<"new" | "duplicate" | "conflict" | false>;
  resolve?(id: string, owner: string): Promise<boolean>;
  throttle?(owner: string): Promise<boolean>;
};

export function createConversations(database: Pick<Pool, "query" | "connect">): Conversations {
  return {
    async withInvocation(owner, id, run) {
      const client = await database.connect();
      try {
        await client.query("BEGIN");
        // Acquire before reading status. No row lock is held during provider work;
        // complete() uses another pool connection and must be free to update the row.
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [id]);
        const result = await client.query("SELECT status FROM conversations WHERE id=$1 AND owner_id=$2 AND created_at > clock_timestamp() - interval '90 days'", [id, owner]);
        if (result.rows[0]?.status !== "open") throw Error("Conversation no longer open");
        const value = await run();
        await client.query("COMMIT");
        return value;
      } catch (error) { await client.query("ROLLBACK"); throw error; }
      finally { client.release(); }
    },
    async admit(owner, id, key, text, opening) {
      const client = await database.connect();
      const hash = createHash("sha256").update(text).digest("hex");
      try {
        await client.query("BEGIN");
        // A row lock serializes different keys for the same owner, including a first-time sender.
        await client.query("INSERT INTO chat_send_limits (owner_id,last_at) VALUES ($1, '-infinity') ON CONFLICT (owner_id) DO NOTHING", [owner]);
        await client.query("SELECT owner_id FROM chat_send_limits WHERE owner_id=$1 FOR UPDATE", [owner]);
        const existing = await client.query("SELECT request_hash FROM chat_send_claims WHERE owner_id=$1 AND conversation_id=$2 AND request_key=$3", [owner, id, key]);
        if (existing.rows.length) {
          await client.query("COMMIT");
          return existing.rows[0].request_hash === hash ? "duplicate" : "conflict";
        }
        if (!opening) {
          const conversation = await client.query("SELECT status FROM conversations WHERE id=$1 AND owner_id=$2 AND created_at > clock_timestamp() - interval '90 days' FOR UPDATE", [id, owner]);
          if (!conversation.rows.length) { await client.query("COMMIT"); return "missing"; }
          if (conversation.rows[0].status !== "open") { await client.query("COMMIT"); return "forbidden"; }
        }
        if (!opening) await client.query("UPDATE conversations SET clarification_deadline=NULL WHERE id=$1 AND owner_id=$2", [id, owner]);
        const allowed = await client.query("UPDATE chat_send_limits SET last_at=clock_timestamp() WHERE owner_id=$1 AND last_at < clock_timestamp() - interval '3 seconds' RETURNING owner_id", [owner]);
        if (!allowed.rows.length) { await client.query("ROLLBACK"); return "busy"; }
        if (opening) {
          await client.query("INSERT INTO conversations (id, owner_id, status, created_at) VALUES ($1,$2,$3,$4)", [opening.id, owner, opening.status, opening.created_at]);
        }
        await client.query("INSERT INTO chat_send_claims (owner_id, conversation_id, request_key, request_hash, state) VALUES ($1,$2,$3,$4,'pending')", [owner, id, key, hash]);
        await client.query("INSERT INTO conversation_messages (id, conversation_id, sender_role, text, created_at) VALUES ($1,$2,'customer',$3,clock_timestamp())", [crypto.randomUUID(), id, text]);
        await client.query("COMMIT");
        return "new";
      } catch (error) { await client.query("ROLLBACK"); throw error; }
      finally { client.release(); }
    },
    async completed(owner, id, key) {
      await database.query("UPDATE chat_send_claims SET state='outcome_unknown' WHERE owner_id=$1 AND conversation_id=$2 AND request_key=$3 AND state='pending' AND created_at < clock_timestamp() - interval '2 minutes'", [owner, id, key]);
      return (await database.query("SELECT state, response FROM chat_send_claims WHERE owner_id=$1 AND conversation_id=$2 AND request_key=$3", [owner, id, key])).rows[0];
    },
    async finish(owner, id, key, response) {
      await database.query("UPDATE chat_send_claims SET state=$4, response=$5 WHERE owner_id=$1 AND conversation_id=$2 AND request_key=$3", [owner, id, key, response ? "done" : "failed", response ? JSON.stringify(response) : null]);
    },
    async complete(owner, id, key, activity, response) {
      const client = await database.connect();
      try {
        await client.query("BEGIN");
        const conversation = await client.query("SELECT status FROM conversations WHERE id=$1 AND owner_id=$2 FOR UPDATE", [id, owner]);
        if (conversation.rows[0]?.status !== "open") throw Error("Conversation no longer open");
        const locked = await client.query("SELECT state FROM chat_send_claims WHERE owner_id=$1 AND conversation_id=$2 AND request_key=$3 FOR UPDATE", [owner, id, key]);
        if (locked.rows[0]?.state !== "pending") throw Error("Claim no longer pending");
        const newer = await client.query("SELECT 1 FROM chat_send_claims WHERE owner_id=$1 AND conversation_id=$2 AND created_at > (SELECT created_at FROM chat_send_claims WHERE owner_id=$1 AND conversation_id=$2 AND request_key=$3) LIMIT 1", [owner, id, key]);
        if (newer.rows.length) throw Error("A newer customer reply superseded this response");
        for (const [role, text] of [...activity.map((event): [string, string] => ["system", event]), ["agent", response.text] as [string, string]]) {
          await client.query("INSERT INTO conversation_messages (id, conversation_id, sender_role, text, created_at) VALUES ($1,$2,$3,$4,clock_timestamp())", [crypto.randomUUID(), id, role, text]);
        }
        await client.query("UPDATE conversations SET clarification_deadline=CASE WHEN $3 THEN clock_timestamp() + interval '4 hours' ELSE NULL END WHERE id=$1 AND owner_id=$2", [id, owner, response.needsClarification === true]);
        await client.query("UPDATE chat_send_claims SET state='done', response=$4 WHERE owner_id=$1 AND conversation_id=$2 AND request_key=$3", [owner, id, key, JSON.stringify(response)]);
        await client.query("COMMIT");
      } catch (error) { await client.query("ROLLBACK"); throw error; }
      finally { client.release(); }
    },
    async throttle(owner) {
      const result = await database.query("INSERT INTO chat_send_limits (owner_id,last_at) VALUES ($1,clock_timestamp()) ON CONFLICT (owner_id) DO UPDATE SET last_at=clock_timestamp() WHERE chat_send_limits.last_at < clock_timestamp() - interval '3 seconds' RETURNING owner_id", [owner]);
      return result.rows.length > 0;
    },
    async insert(row, text) {
      const client = await database.connect();
      try {
        await client.query("BEGIN");
        const inserted = await client.query("INSERT INTO conversations (id, owner_id, status, created_at) VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO NOTHING RETURNING id", [row.id, row.owner_id, row.status, row.created_at]);
        if (!inserted.rows.length) { await client.query("COMMIT"); return row; }
        await client.query("INSERT INTO conversation_messages (id, conversation_id, sender_role, text, created_at) VALUES ($1, $2, 'customer', $3, $4)", [crypto.randomUUID(), row.id, text, row.created_at]);
        await client.query("COMMIT");
        return row;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally { client.release(); }
    },
    async list(owner, role) {
      const filter = role === "support" ? "status = 'escalated'" : "owner_id = $1";
      return (await database.query(`SELECT id, owner_id, status, created_at, clarification_deadline, ticket_id FROM conversations WHERE ${filter} AND created_at > clock_timestamp() - interval '90 days' ORDER BY created_at DESC, id DESC`, role === "support" ? [] : [owner])).rows as Conversation[];
    },
    async byId(id, owner, role) {
      const filter = role === "support" ? "status = 'escalated'" : "owner_id = $2";
      return (await database.query(`SELECT id, owner_id, status, created_at, clarification_deadline, ticket_id FROM conversations WHERE id = $1 AND ${filter} AND created_at > clock_timestamp() - interval '90 days'`, role === "support" ? [id] : [id, owner])).rows[0] as Conversation | undefined;
    },
    async humanMessage(id, owner, role, key, text) {
      const client = await database.connect();
      try {
        await client.query("BEGIN");
        const rows = await client.query("SELECT status FROM conversations WHERE id=$1 AND ($2='support' OR owner_id=$3) AND created_at > clock_timestamp() - interval '90 days' FOR UPDATE", [id, role, owner]);
        if (rows.rows[0]?.status !== "escalated") { await client.query("COMMIT"); return false; }
        const previous = await client.query("SELECT text FROM conversation_messages WHERE conversation_id=$1 AND sender_role=$2 AND actor_id=$3 AND idempotency_key=$4", [id, role, owner, key]);
        if (previous.rows.length) { await client.query("COMMIT"); return previous.rows[0].text === text ? "duplicate" : "conflict"; }
        await client.query("INSERT INTO conversation_messages (id, conversation_id, sender_role, text, created_at, actor_id, idempotency_key) VALUES ($1,$2,$3,$4,clock_timestamp(),$5,$6)", [crypto.randomUUID(), id, role, text, owner, key]);
        await client.query("COMMIT"); return "new";
      } catch (error) { await client.query("ROLLBACK"); throw error; }
      finally { client.release(); }
    },
    async resolve(id, owner) {
      const client = await database.connect();
      try {
        await client.query("BEGIN");
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [id]);
        const result = await client.query("UPDATE conversations SET status='resolved', clarification_deadline=NULL WHERE id=$1 AND owner_id=$2 AND status='open' RETURNING id", [id, owner]);
        await client.query("COMMIT");
        return result.rows.length > 0;
      } catch (error) { await client.query("ROLLBACK"); throw error; }
      finally { client.release(); }
    },
    async append(id, role, text) {
      await database.query("INSERT INTO conversation_messages (id, conversation_id, sender_role, text, created_at) VALUES ($1, $2, $3, $4, now())", [crypto.randomUUID(), id, role, text]);
    },
    async messages(id) {
      return (await database.query("SELECT id, sender_role, text, created_at FROM conversation_messages WHERE conversation_id = $1 ORDER BY created_at, id", [id])).rows as Message[];
    },
  };
}
