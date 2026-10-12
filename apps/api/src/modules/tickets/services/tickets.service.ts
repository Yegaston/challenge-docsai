import { randomUUID } from "node:crypto";
import type { TicketRecord, Tickets } from "../repositories/tickets.repository.js";

export class TicketError extends Error {
  constructor(public readonly kind: "invalid" | "missing" | "conflict") {
    super(kind);
  }
}

function publicTicket(row: TicketRecord) {
  return { id: row.id, text: row.text, createdAt: row.created_at.toISOString() };
}

function validateId(id: string) {
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id)) {
    throw new TicketError("invalid");
  }
}

type Generators = { id: () => string; now: () => Date };
export type TicketsService = ReturnType<typeof createTicketsService>;

export function createTicketsService(repository: Pick<Tickets, "insert" | "list" | "byId"> & Partial<Pick<Tickets, "delete">>, generators: Generators = { id: randomUUID, now: () => new Date() }) {
  return {
    async create(owner: string, input: unknown) {
      if (typeof input !== "string") throw new TicketError("invalid");
      const text = input.trim();
      if (!text || text.length > 20000 || text.includes("\u0000")) throw new TicketError("invalid");
      return publicTicket(await repository.insert({
        id: generators.id(), owner_id: owner, text, created_at: generators.now(),
      }));
    },
    async list(owner: string) {
      return (await repository.list(owner)).map(publicTicket);
    },
    async delete(owner: string, id: string) {
      validateId(id);
      if (!repository.delete) throw new Error("Deletion unavailable");
      const outcome = await repository.delete(id, owner);
      if (outcome !== "deleted") throw new TicketError(outcome === "conflict" ? "conflict" : "missing");
    },
    async detail(owner: string, id: string) {
      validateId(id);
      const row = await repository.byId(id, owner);
      if (!row) throw new TicketError("missing");
      return publicTicket(row);
    },
  };
}
