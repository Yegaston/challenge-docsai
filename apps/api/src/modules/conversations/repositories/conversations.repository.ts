import type { Pool } from "pg";

export type Conversation = { id: string; owner_id: string; status: "open" | "escalated" | "resolved"; created_at: Date };
export type Message = { id: string; sender_role: string; text: string; created_at: Date };
export type Role = "customer" | "support";
export type Conversations = {
  insert(row: Conversation, text: string): Promise<Conversation>;
  list(owner: string, role: Role): Promise<Conversation[]>;
  byId(id: string, owner: string, role: Role): Promise<Conversation | undefined>;
  messages(id: string): Promise<Message[]>;
};

export function createConversations(database: Pick<Pool, "query" | "connect">): Conversations {
  return {
    async insert(row, text) {
      const client = await database.connect();
      try {
        await client.query("BEGIN");
        await client.query("INSERT INTO conversations (id, owner_id, status, created_at) VALUES ($1, $2, $3, $4)", [row.id, row.owner_id, row.status, row.created_at]);
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
      return (await database.query(`SELECT id, owner_id, status, created_at FROM conversations WHERE ${filter} AND created_at > clock_timestamp() - interval '90 days' ORDER BY created_at DESC, id DESC`, role === "support" ? [] : [owner])).rows as Conversation[];
    },
    async byId(id, owner, role) {
      const filter = role === "support" ? "status = 'escalated'" : "owner_id = $2";
      return (await database.query(`SELECT id, owner_id, status, created_at FROM conversations WHERE id = $1 AND ${filter} AND created_at > clock_timestamp() - interval '90 days'`, role === "support" ? [id] : [id, owner])).rows[0] as Conversation | undefined;
    },
    async messages(id) {
      return (await database.query("SELECT id, sender_role, text, created_at FROM conversation_messages WHERE conversation_id = $1 ORDER BY created_at, id", [id])).rows as Message[];
    },
  };
}
