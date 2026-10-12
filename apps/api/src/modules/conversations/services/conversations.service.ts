import { randomUUID, createHash } from "node:crypto";
import type { Conversations, Conversation, Role } from "../repositories/conversations.repository.js";
import type { TransferAgent } from "./transfer-agent.js";

export class ConversationError extends Error {
  constructor(public readonly kind: "invalid" | "missing" | "forbidden" | "busy" | "unavailable" | "outcome_unknown" | "human_mode") { super(kind); }
}

type Identity = { id: string; role: Role };
const publicConversation = (row: Conversation) => ({ id: row.id, status: row.status, createdAt: row.created_at.toISOString(), clarificationDeadline: row.clarification_deadline?.toISOString() ?? null, ticketId: row.ticket_id ?? null });
const validId = (id: string) => /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id);

export function createConversationsService(repository: Conversations, agent?: TransferAgent, escalation?: { handoff(id: string, owner: string): Promise<Conversation | undefined> }) {
  async function answer(user: Identity, id: string, text: string, key: string, opening?: Conversation, agentOnly = false) {
    if (!validId(id) || typeof text !== "string" || !text.trim() || text.length > 2000 || text.includes("\u0000")) throw new ConversationError("invalid");
    if (!validId(key)) throw new ConversationError("invalid");
    const current = await repository.byId(id, user.id, user.role);
    const handoffPhrase = user.role === "customer" && /^(?:i don't know|contact support)$/i.test(text.trim());
    if (handoffPhrase && current?.status === "escalated") {
      // Match the original claim's payload before replaying a persisted handoff.
      const claim = await repository.admit!(user.id, id, key, text.trim());
      if (claim === "conflict") throw new ConversationError("invalid");
      if (claim !== "duplicate") throw new ConversationError(claim === "busy" ? "busy" : claim === "missing" ? "missing" : "forbidden");
      const prior = await repository.completed!(user.id, id, key);
      if (prior?.state !== "done") throw new ConversationError(prior?.state === "outcome_unknown" ? "outcome_unknown" : prior?.state === "failed" ? "unavailable" : "busy");
      if (prior.response?.text !== "Connected to human support.") throw new ConversationError("invalid");
      return { ...publicConversation(current), text: prior.response.text };
    }
    if (current?.status === "resolved") throw new ConversationError("forbidden");
    if (current?.status === "escalated") {
      if (agentOnly) throw new ConversationError("human_mode");
      const result = await repository.humanMessage?.(id, user.id, user.role, key, text.trim());
      if (result === "conflict") throw new ConversationError("invalid");
      if (!result) throw new ConversationError("missing");
      return { text: text.trim() };
    }
    if (user.role !== "customer") throw new ConversationError("forbidden");
    if (!agent) throw new ConversationError("unavailable");
    const claim = await repository.admit!(user.id, id, key, text.trim(), opening);
    if (claim === "conflict") throw new ConversationError("invalid");
    if (claim === "busy" || claim === "missing" || claim === "forbidden") throw new ConversationError(agentOnly && claim === "forbidden" ? "human_mode" : claim);
    if (claim === "duplicate") {
      const prior = await repository.completed!(user.id, id, key);
      if (prior.state === "done" && prior.response) {
        const row = await repository.byId(id, user.id, "customer");
        if (!row) throw new ConversationError("missing");
        return { ...publicConversation(row), ...prior.response };
      }
      throw new ConversationError(prior.state === "outcome_unknown" ? "outcome_unknown" : prior.state === "failed" ? "unavailable" : "busy");
    }
    try {
      if (handoffPhrase) {
        if (!escalation) throw new ConversationError("unavailable");
        const row = await escalation.handoff(id, user.id);
        if (!row) throw new ConversationError("missing");
        await repository.finish!(user.id, id, key, { text: "Connected to human support." });
        return { ...publicConversation(row), text: "Connected to human support." };
      }
      const history = (await repository.messages(id)).map(m => `${m.sender_role}: ${m.text}`).slice(-8);
      if (!repository.withInvocation) throw new ConversationError("unavailable");
      return await repository.withInvocation(user.id, id, async () => {
        const result = await agent.run(user.id, text.trim(), history);
        const response = { text: result.text, needsClarification: result.needsClarification, options: result.options };
        const saved = (await repository.complete!(user.id, id, key, result.activity, response)) ?? response;
        const row = await repository.byId(id, user.id, "customer");
        if (!row) throw new ConversationError("missing");
        return { ...publicConversation(row), ...saved };
      });
    } catch (error) {
      throw error instanceof ConversationError ? error : new ConversationError("outcome_unknown");
    }
  }
  return {
    async create(user: Identity, input: unknown) {
      if (user.role !== "customer") throw new ConversationError("forbidden");
      const text = typeof input === "object" && input !== null && "text" in input ? input.text : undefined;
      if (typeof text !== "string" || !text.trim() || text.length > 20000 || text.includes("\u0000")) throw new ConversationError("invalid");
      if (!agent) return publicConversation(await repository.insert({ id: randomUUID(), owner_id: user.id, status: "open", created_at: new Date() }, text.trim()));
      const key = typeof input === "object" && input !== null && "idempotencyKey" in input ? input.idempotencyKey : undefined;
      if (typeof key !== "string" || !validId(key)) throw new ConversationError("invalid");
      const digest = createHash("sha256").update(`${user.id}:${key}`).digest("hex");
      const id = `${digest.slice(0,8)}-${digest.slice(8,12)}-4${digest.slice(13,16)}-8${digest.slice(17,20)}-${digest.slice(20,32)}`;
      const row = { id, owner_id: user.id, status: "open" as const, created_at: new Date() };
      const response = await answer(user, id, text.trim(), key, row);
      return { ...publicConversation((await repository.byId(id, user.id, "customer")) ?? row), ...response };
    },
    reply: answer,
    streamReply(user: Identity, id: string, text: string, key: string) { return answer(user, id, text, key, undefined, true); },
    replayHandoff(user: Identity, id: string, text: string, key: string) {
      if (!/^(?:i don't know|contact support)$/i.test(text.trim())) throw new ConversationError("human_mode");
      return answer(user, id, text, key, undefined, true);
    },
    async escalate(user: Identity, id: string) {
      if (user.role !== "customer") throw new ConversationError("forbidden");
      if (!validId(id)) throw new ConversationError("invalid");
      if (!escalation) throw new ConversationError("unavailable");
      const row = await escalation.handoff(id, user.id);
      if (!row) throw new ConversationError("missing");
      return publicConversation(row);
    },
    async resolve(user: Identity, id: string) {
      if (user.role !== "customer") throw new ConversationError("forbidden");
      if (!validId(id)) throw new ConversationError("invalid");
      if (!await repository.resolve?.(id, user.id)) throw new ConversationError("missing");
      return { status: "resolved" };
    },
    async list(user: Identity) { return (await repository.list(user.id, user.role)).map(publicConversation); },
    async detail(user: Identity, id: string) {
      if (!validId(id)) throw new ConversationError("invalid");
      const row = await repository.byId(id, user.id, user.role);
      if (!row) throw new ConversationError("missing");
      return { ...publicConversation(row), messages: (await repository.messages(id)).map((message) => ({
        id: message.id, senderRole: message.sender_role, text: message.text, createdAt: message.created_at.toISOString(), ...(message.options ? { options: message.options } : {}),
      })) };
    },
  };
}
export type ConversationsService = ReturnType<typeof createConversationsService>;
