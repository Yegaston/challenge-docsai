import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { callApi } from "@/lib/api";
import { sessionInvalidMessage, useSession } from "@/session";

export type Conversation = { id: string; status: "open" | "escalated" | "resolved"; createdAt: string; clarificationDeadline: string | null; ticketId: string | null; messages?: { id: string; senderRole: string; text: string; createdAt: string }[] };
export function Thread({ support = false }: { support?: boolean }) {
  const { id } = useParams();
  const { session, clear } = useSession(); const token = session?.token;
  const [thread, setThread] = useState<Conversation | null>(null);
  const [text, setText] = useState(""); const [error, setError] = useState("");
  const [loading, setLoading] = useState(true); const [pending, setPending] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [handoffUncertain, setHandoffUncertain] = useState(false);
  const attempt = useRef<{ text: string; key: string } | null>(null);
  const loadActive = useRef<AbortController | null>(null);
  const sendActive = useRef<AbortController | null>(null);
  const load = useCallback(async (signal: AbortSignal) => {
    if (!token || !id) return;
    setLoading(true);
    setThread(null);
    const result = await callApi({ token }, `/api/conversations/${id}`, { signal });
    if (signal.aborted) return;
    setLoading(false);
    if (result.status === 401) clear(sessionInvalidMessage);
    else if (result.status === 200 && Array.isArray(result.body?.messages)) { setThread(result.body as Conversation); if (result.body.status !== "open") setHandoffUncertain(false); setError(""); }
    else setError("Could not load this conversation. Refresh to try again.");
  }, [token, id, clear]);
  useEffect(() => { const controller = new AbortController(); loadActive.current = controller; void load(controller.signal); return () => { controller.abort(); sendActive.current?.abort(); }; }, [load]);
  function refresh() { loadActive.current?.abort(); const controller = new AbortController(); loadActive.current = controller; void load(controller.signal); }
  async function send(event: FormEvent) {
    event.preventDefault(); if (!token || !id || pending || uncertain || !text.trim()) return;
    const current = { text: text.trim(), key: crypto.randomUUID() }; attempt.current = current;
    setPending(true); setError(""); const controller = new AbortController(); sendActive.current = controller;
    const result = await callApi({ token }, `/api/conversations/${id}/messages`, { method: "POST", body: { text: current.text, idempotencyKey: current.key }, signal: controller.signal });
    if (controller.signal.aborted) return;
    setPending(false);
    if (result.status === 401) { clear(sessionInvalidMessage); return; }
    if (result.status === 201) { attempt.current = null; setText(""); refresh(); return; }
    if ([0, 409, 503].includes(result.status)) { setUncertain(true); setError("Outcome uncertain. Refresh to reconcile; do not resend automatically. You may retry this same action with its original key or explicitly start a new action."); }
    else { attempt.current = null; setError("Message not sent. Check the conversation status and try again."); refresh(); }
  }
  async function escalate() {
    if (!token || !id || pending || handoffUncertain) return;
    setPending(true); setError(""); const controller = new AbortController(); sendActive.current = controller;
    const result = await callApi({ token }, `/api/conversations/${id}/escalate`, { method: "POST", signal: controller.signal });
    if (controller.signal.aborted) return;
    setPending(false);
    if (result.status === 401) clear(sessionInvalidMessage);
    else if (result.status === 200) refresh();
    else { setHandoffUncertain(true); setError("Handoff status uncertain. Refresh this conversation before requesting support again."); }
  }
  async function retry() {
    const current = attempt.current; if (!current || !token || !id || pending) return;
    setPending(true); const controller = new AbortController(); sendActive.current = controller;
    const result = await callApi({ token }, `/api/conversations/${id}/messages`, { method: "POST", body: { text: current.text, idempotencyKey: current.key }, signal: controller.signal });
    if (controller.signal.aborted) return;
    setPending(false);
    if (result.status === 401) clear(sessionInvalidMessage);
    else if (result.status === 201) { attempt.current = null; setUncertain(false); setText(""); refresh(); }
    else setError("Still uncertain. Refresh to reconcile before another action.");
  }
  return <section className="space-y-4"><Link className="underline" to={support ? "/support" : "/chat"}>← {support ? "Inbox" : "Conversations"}</Link><h2 className="text-2xl font-semibold">Conversation</h2>
    <button className="rounded border px-3 py-2" onClick={refresh}>Refresh conversation</button>
    {loading && <p role="status">Loading conversation…</p>}{error && <p role="alert">{error}</p>}
    {thread && <><p>Status: {thread.status}</p>{thread.clarificationDeadline && thread.status === "open" && <p>Clarification requested. Reply before {new Date(thread.clarificationDeadline).toLocaleString()} or this chat will be handed to support.</p>}
      {thread.ticketId && !support && <p>Support ticket: <Link className="underline" to={`/tickets/${thread.ticketId}`}>{thread.ticketId}</Link></p>}
      <ol className="space-y-3" aria-label="Messages">{thread.messages?.length ? thread.messages.map(message => <li key={message.id} className="rounded border p-3"><strong>{message.senderRole === "tool" ? "Tool activity" : message.senderRole}</strong><p className="whitespace-pre-wrap">{message.text}</p><small>{new Date(message.createdAt).toLocaleString()}</small></li>) : <li>No messages yet.</li>}</ol>
      {thread.status !== "resolved" && (!support || thread.status === "escalated") && <form className="space-y-2" onSubmit={send}><label htmlFor="reply">{support ? "Reply as human support" : thread.status === "escalated" ? "Message human support" : "Reply to the agent"}</label><textarea id="reply" className="w-full rounded border p-3" maxLength={2000} value={text} onChange={e => setText(e.target.value)} disabled={pending || uncertain} required /><button className="rounded border px-3 py-2" disabled={pending || uncertain}>{pending ? "Sending…" : "Send message"}</button></form>}
      {handoffUncertain && thread.status === "open" && <button className="rounded border px-3 py-2" onClick={() => { setHandoffUncertain(false); setError(""); }}>Request support again (previous handoff may have succeeded)</button>}
      {!support && thread.status === "open" && <button className="rounded border px-3 py-2" disabled={pending || handoffUncertain} onClick={escalate}>I don't know / Contact support</button>}
      {uncertain && <div className="space-x-2"><button className="rounded border px-3 py-2" disabled={pending} onClick={() => void retry()}>Retry same action</button><button className="rounded border px-3 py-2" onClick={() => { attempt.current = null; setUncertain(false); setError(""); }}>Start a new action (previous may have succeeded)</button></div>}
    </>}
  </section>;
}
export default function ConversationPage() { return <Thread />; }
