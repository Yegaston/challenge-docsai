import { randomUUID } from "node:crypto";
import type { Conversations, Conversation, Role } from "../repositories/conversations.repository.js";

export class ConversationError extends Error {
  constructor(public readonly kind: "invalid" | "missing" | "forbidden") { super(kind); }
}

type Identity = { id: string; role: Role };
const publicConversation = (row: Conversation) => ({ id: row.id, status: row.status, createdAt: row.created_at.toISOString() });
const validId = (id: string) => /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id);

export function createConversationsService(repository: Conversations) {
  return {
    async create(user: Identity, input: unknown) {
      if (user.role !== "customer") throw new ConversationError("forbidden");
      const text = typeof input === "object" && input !== null && "text" in input ? input.text : undefined;
      if (typeof text !== "string" || !text.trim() || text.length > 20000 || text.includes("\u0000")) throw new ConversationError("invalid");
      return publicConversation(await repository.insert({ id: randomUUID(), owner_id: user.id, status: "open", created_at: new Date() }, text.trim()));
    },
    async list(user: Identity) { return (await repository.list(user.id, user.role)).map(publicConversation); },
    async detail(user: Identity, id: string) {
      if (!validId(id)) throw new ConversationError("invalid");
      const row = await repository.byId(id, user.id, user.role);
      if (!row) throw new ConversationError("missing");
      return { ...publicConversation(row), messages: (await repository.messages(id)).map((message) => ({
        id: message.id, senderRole: message.sender_role, text: message.text, createdAt: message.created_at.toISOString(),
      })) };
    },
  };
}
export type ConversationsService = ReturnType<typeof createConversationsService>;
