import { describe, it, expect, vi, afterEach } from "vitest";
import { postChatStream, type ChatEvent } from "./lib/chat-stream";
afterEach(() => vi.unstubAllGlobals());
const id = "11111111-1111-4111-8111-111111111111";
const body = { text: "hello", idempotencyKey: id };
function stream(chunks: Uint8Array[]) { let index = 0; return new ReadableStream<Uint8Array>({ pull(controller) { if (index < chunks.length) controller.enqueue(chunks[index++]); else controller.close(); } }); }
describe("POST SSE", () => {
  it("decodes split frames and UTF-8 characters without losing text", async () => {
    const bytes = new TextEncoder().encode(`event: status\ndata: {"state":"checking"}\n\nevent: delta\ndata: {"text":"é🙂"}\n\nevent: done\ndata: {"id":"${id}","status":"open","clarificationDeadline":null}\n\n`);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(stream([...bytes].map(byte => Uint8Array.of(byte))), { headers: { "Content-Type": "text/event-stream" } })));
    const events: ChatEvent[] = []; const result = await postChatStream("token", "/api/conversations/stream", body, new AbortController().signal, e => events.push(e));
    expect(result.kind).toBe("done"); expect(events.map(e => e.event)).toEqual(["status", "delta", "done"]); expect(events[1]).toMatchObject({ text: "é🙂" });
  });
  it.each([{"id":"------------------------------------"}, {"ticketId":"------------------------------------"}, {"options":[{"kind":"transfer","id":"------------------------------------","label":"Bad"}]}])("rejects malformed identifiers in done metadata %j", async patch => {
    const frame = `event: done\ndata: ${JSON.stringify({ id, status: "open", clarificationDeadline: null, ...patch })}\n\n`;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(frame, { headers: { "Content-Type": "text/event-stream" } })));
    const events: ChatEvent[] = [];
    expect((await postChatStream("token", "/stream", body, new AbortController().signal, event => events.push(event))).kind).toBe("uncertain");
    expect(events).toEqual([]);
  });
  it("reports unauthorized without parsing a stream", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 401 })));
    expect((await postChatStream("token", "/stream", body, new AbortController().signal, () => {})).kind).toBe("unauthorized");
  });
  it("treats server error frames and malformed frames as uncertain", async () => {
    for (const frame of ['event: error\ndata: {"code":"failed","instruction":"retry"}\n\n', 'event: delta\ndata: invalid\n\n']) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(stream([new TextEncoder().encode(frame)]), { headers: { "Content-Type": "text/event-stream" } })));
      expect((await postChatStream("token", "/stream", body, new AbortController().signal, () => {})).kind).toBe("uncertain");
    }
  });
  it("treats truncated streams and malformed frames as uncertain", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(stream([new TextEncoder().encode('event: delta\ndata: {"text":"partial"}\n\n')]), { headers: { "Content-Type": "text/event-stream" } })));
    expect((await postChatStream("token", "/stream", body, new AbortController().signal, () => {})).kind).toBe("uncertain");
  });
});
