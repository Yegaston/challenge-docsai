import type express from "express";
import { ConversationError, type ConversationsService } from "../services/conversations.service.js";

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const pause = () => new Promise<void>(resolve => setTimeout(resolve, 2));
const maxGraphemes = 4000;
const maxStreamMs = 15000;
const drainMs = 1000;

export function streamConversation(service: ConversationsService, kind: "create" | "reply"): express.RequestHandler {
  return async (request, response) => {
    const body = request.body;
    const valid = body && typeof body === "object" && !Array.isArray(body)
      && Object.keys(body).every(key => key === "text" || key === "idempotencyKey")
      && typeof body.text === "string" && !!body.text.trim() && body.text.length <= 2000
      && !body.text.includes("\u0000") && typeof body.idempotencyKey === "string" && uuid.test(body.idempotencyKey)
      && (kind === "create" || uuid.test(request.params.id as string));
    if (!valid) { response.status(400).json({ error: "invalid" }); return; }
    if (response.locals.user.role !== "customer") { response.status(403).json({ error: "forbidden" }); return; }
    if (kind === "reply") {
      try {
        const detail = await service.detail(response.locals.user, request.params.id as string);
        if (detail.status === "escalated") {
          try {
            const replay = await service.replayHandoff(response.locals.user, request.params.id as string, body.text, body.idempotencyKey);
            response.locals.handoffReplay = replay;
          } catch (error) {
            const code = error instanceof ConversationError ? error.kind : "unavailable";
            const status = code === "invalid" ? 400 : code === "missing" ? 404 : code === "forbidden" ? 403 : code === "unavailable" ? 503 : 409;
            response.status(status).json({ error: code, instruction: code === "human_mode"
              ? "Use the JSON messages route for human support."
              : "Refresh the conversation before retrying with the same idempotency key; do not send a new key until the outcome is known." });
            return;
          }
        }
      }
      catch (error) {
        const code = error instanceof ConversationError ? error.kind : "unavailable";
        response.status(code === "missing" ? 404 : code === "forbidden" ? 403 : 503).json({ error: code });
        return;
      }
    }
    response.status(200).set({ "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" });
    let closed = false;
    response.on("close", () => { closed = true; });
    const emit = async (event: string, data: unknown): Promise<boolean> => {
      if (closed) return false;
      if (response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)) return true;
      // A slow reader must not accumulate an unbounded socket write queue.
      const drained = await new Promise<boolean>(resolve => {
        const finish = (ok: boolean) => { clearTimeout(timer); response.off("drain", onDrain); response.off("close", onClose); resolve(ok); };
        const onDrain = () => finish(true);
        const onClose = () => finish(false);
        const timer = setTimeout(() => finish(false), drainMs);
        response.once("drain", onDrain);
        response.once("close", onClose);
      });
      if (!drained && !closed) { closed = true; response.end(); }
      return drained && !closed;
    };
    if (!await emit("status", { state: "checking" })) { if (!closed) response.end(); return; }
    try {
      // Admitted work is independent of the transport lifecycle.
      const result = kind === "create"
        ? await service.create(response.locals.user, body)
        : response.locals.handoffReplay ?? await service.streamReply(response.locals.user, request.params.id as string, body.text, body.idempotencyKey);
      if (closed) return;
      if (!("text" in result) || typeof result.text !== "string") throw new ConversationError("unavailable");
      if (!("id" in result) || !("status" in result) || !("clarificationDeadline" in result)) throw new ConversationError("unavailable");
      const segments = [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(result.text)];
      if (segments.length > maxGraphemes) throw new ConversationError("unavailable");
      const deadline = Date.now() + maxStreamMs;
      for (const character of segments) {
        if (closed) return;
        if (Date.now() >= deadline) throw new ConversationError("unavailable");
        if (!await emit("delta", { text: character.segment })) return;
        await pause();
      }
      await emit("done", { id: result.id, status: result.status, ...("ticketId" in result ? { ticketId: result.ticketId } : {}), ...( "options" in result && result.options !== undefined ? { options: result.options } : {}), clarificationDeadline: result.clarificationDeadline });
    } catch (error) {
      const code = error instanceof ConversationError ? error.kind : "unavailable";
      await emit("error", { code, instruction: "Refresh the conversation before retrying with the same idempotency key; do not send a new key until the outcome is known." });
    } finally {
      if (!closed) response.end();
    }
  };
}
