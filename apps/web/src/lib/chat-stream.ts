export type ChatEvent =
  | { event: "status"; state: "checking" }
  | { event: "delta"; text: string }
  | { event: "done"; id: string; status: "open" | "escalated" | "resolved"; clarificationDeadline: string | null; ticketId?: string | null; options?: { kind: "transfer" | "details" | "handoff"; id?: string; label: string }[] }
  | { event: "error"; code: string; instruction: string };
export type StreamResult = { kind: "done"; data: Extract<ChatEvent, { event: "done" }> } | { kind: "uncertain"; instruction: string } | { kind: "unauthorized" } | { kind: "rejected"; instruction: string };
const uncertain = (): StreamResult => ({ kind: "uncertain", instruction: "Outcome uncertain. Refresh to reconcile or retry the same request; do not resend automatically." });
const maxBuffer = 65536;
const uuid = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const valid = (event: string, value: unknown): ChatEvent | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (event === "status" && v.state === "checking") return { event, state: "checking" };
  if (event === "delta" && typeof v.text === "string" && v.text.length <= 8192) return { event, text: v.text };
  if (event === "error" && typeof v.code === "string" && typeof v.instruction === "string") return { event, code: v.code, instruction: "Refresh before retrying with the same idempotency key." };
  if (event === "done" && uuid(v.id) && ["open", "escalated", "resolved"].includes(String(v.status)) && (v.clarificationDeadline === null || typeof v.clarificationDeadline === "string") && (v.ticketId === undefined || v.ticketId === null || uuid(v.ticketId)) && (v.options === undefined || (Array.isArray(v.options) && v.options.length <= 20 && v.options.every((o: unknown) => !!o && typeof o === "object" && ["transfer", "details", "handoff"].includes(String((o as Record<string, unknown>).kind)) && typeof (o as Record<string, unknown>).label === "string" && ((o as Record<string, unknown>).id === undefined || uuid((o as Record<string, unknown>).id)))))) return { event, id: v.id, status: v.status as "open" | "escalated" | "resolved", clarificationDeadline: v.clarificationDeadline as string | null, ...(v.ticketId !== undefined ? { ticketId: v.ticketId as string | null } : {}), ...(v.options !== undefined ? { options: v.options as { kind: "transfer" | "details" | "handoff"; id?: string; label: string }[] } : {}) };
  return null;
};
export async function postChatStream(token: string, path: string, body: { text: string; idempotencyKey: string }, signal: AbortSignal, onEvent: (event: ChatEvent) => void): Promise<StreamResult> {
  try {
    const response = await fetch(path, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "text/event-stream" }, body: JSON.stringify(body), signal, credentials: "omit", cache: "no-store" });
    if (response.status === 401) return { kind: "unauthorized" };
    if (!response.ok) return [409, 503].includes(response.status) ? uncertain() : { kind: "rejected", instruction: "Request rejected. Check the conversation and try again." };
    if (!response.headers.get("content-type")?.toLowerCase().includes("text/event-stream") || !response.body) return uncertain();
    const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = ""; let result: StreamResult | null = null;
    try {
      while (true) {
        const chunk = await reader.read();
        buffer += decoder.decode(chunk.value ?? new Uint8Array(), { stream: !chunk.done });
        buffer = buffer.replace(/\r\n/g, "\n");
        if (new TextEncoder().encode(buffer).length > maxBuffer) return uncertain();
        let boundary: number;
        while ((boundary = buffer.indexOf("\n\n")) !== -1) {
          const frame = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2);
          const lines = frame.split("\n"); const name = lines.find(line => line.startsWith("event: "))?.slice(7);
          const payload = lines.filter(line => line.startsWith("data: ")).map(line => line.slice(6)).join("\n");
          let parsed: unknown; try { parsed = JSON.parse(payload); } catch { return uncertain(); }
          const event = valid(name ?? "", parsed); if (!event || result) return uncertain();
          onEvent(event);
          if (event.event === "done") result = { kind: "done", data: event };
          if (event.event === "error") result = uncertain();
        }
        if (result) return result;
        if (chunk.done) return uncertain();
      }
    } finally { reader.releaseLock(); }
  } catch { return uncertain(); }
}
