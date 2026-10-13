import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { callApi } from "@/lib/api";
import { sessionInvalidMessage, useSession } from "@/session";
import { postChatStream } from "@/lib/chat-stream";
import ChatComposer from "@/components/ChatComposer";
import ChatHistory from "@/components/ChatHistory";

export type Conversation = { id: string; status: "open" | "escalated" | "resolved"; createdAt: string; clarificationDeadline: string | null; ticketId: string | null; messages?: { id: string; senderRole: string; text: string; createdAt: string; options?: { kind: "transfer" | "details" | "handoff"; id?: string; label: string }[] }[] };
export function Thread({ support = false }: { support?: boolean }) {
  const { id } = useParams();
  const { session, clear } = useSession(); const token = session?.token;
  const [thread, setThread] = useState<Conversation | null>(null);
  const [history, setHistory] = useState<Conversation[] | null>(null);
  const [historyError, setHistoryError] = useState(false);
  const [text, setText] = useState(""); const [error, setError] = useState("");
  const [loading, setLoading] = useState(true); const [pending, setPending] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [activity, setActivity] = useState(""); const [provisional, setProvisional] = useState("");
  const composer = useRef<HTMLTextAreaElement | null>(null);
  const [handoffUncertain, setHandoffUncertain] = useState(false);
  const attempt = useRef<{ text: string; key: string } | null>(null);
  const loadActive = useRef<AbortController | null>(null);
  const sendActive = useRef<AbortController | null>(null);
  const sending = useRef(false);
  const load = useCallback(async (signal: AbortSignal) => {
    if (!token || !id) return;
    setLoading(true);
    setThread(null);
    setActivity("");
    setProvisional("");
    const result = await callApi({ token }, `/api/conversations/${id}`, { signal });
    if (signal.aborted) return;
    setLoading(false);
    if (result.status === 401) clear(sessionInvalidMessage);
    else if (result.status === 200 && Array.isArray(result.body?.messages)) { setThread(result.body as Conversation); if (result.body.status !== "open") setHandoffUncertain(false); setError(""); }
    else setError("Could not load this conversation. Refresh to try again.");
  }, [token, id, clear]);
  useEffect(() => { const controller = new AbortController(); loadActive.current = controller; void load(controller.signal); return () => { controller.abort(); sendActive.current?.abort(); }; }, [load]);
  useEffect(() => { const controller = new AbortController(); void (async () => { if (!token) return; const result = await callApi({ token }, "/api/conversations", { signal: controller.signal }); if (controller.signal.aborted) return; if (result.status === 401) clear(sessionInvalidMessage); else if (result.status === 200 && Array.isArray(result.body?.conversations)) { setHistory((result.body.conversations as Conversation[]).filter(row => !support || row.status === "escalated")); setHistoryError(false); } else setHistoryError(true); })(); return () => controller.abort(); }, [token, clear, support]);
  function refresh() { if (sending.current) return; loadActive.current?.abort(); const controller = new AbortController(); loadActive.current = controller; void load(controller.signal); }
  async function send(event: FormEvent) {
    event.preventDefault(); if (!token || !id || sending.current || pending || uncertain || !text.trim()) return;
    const current = { text: text.trim(), key: crypto.randomUUID() }; attempt.current = current;
    await sendAttempt(current);
  }
  async function sendAttempt(current: { text: string; key: string }) {
    if (!token || !id || sending.current || pending || !thread) return;
    attempt.current = current;
    sending.current = true;
    setPending(true); setError(""); setActivity(""); setProvisional(""); const controller = new AbortController(); sendActive.current = controller;
    if (!support && thread.status === "open") setActivity("Preparing a response…");
    const agent = !support && thread.status === "open";
    const result = agent ? await postChatStream(token, `/api/conversations/${id}/messages/stream`, { text: current.text, idempotencyKey: current.key }, controller.signal, event => {
      if (event.event === "delta") { setActivity(""); setProvisional(previous => previous + event.text); }
    }) : await callApi({ token }, `/api/conversations/${id}/messages`, { method: "POST", body: { text: current.text, idempotencyKey: current.key }, signal: controller.signal });
    if (controller.signal.aborted) return;
    sending.current = false;
    setPending(false); setActivity(agent && 'kind' in result && result.kind === "done" ? "Response ready." : "");
    if (agent) {
      if ('kind' in result && result.kind === "unauthorized") { clear(sessionInvalidMessage); return; }
      if ('kind' in result && result.kind === "done") { attempt.current = null; setUncertain(false); setText(""); setProvisional(""); refresh(); return; }
      if ('kind' in result && result.kind === "uncertain") { setUncertain(true); setError(result.instruction); return; }
      attempt.current = null; setError("Message rejected. Refresh before another action."); refresh(); return;
    }
    if ('status' in result && result.status === 401) { clear(sessionInvalidMessage); return; }
    if ('status' in result && result.status === 201) { attempt.current = null; setText(""); refresh(); return; }
    if ('status' in result && [0, 409, 503].includes(result.status)) { setUncertain(true); setError("Outcome uncertain. Refresh to reconcile; do not resend automatically. You may retry this same action with its original key or explicitly start a new action."); }
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
  async function retry() { if (attempt.current) await sendAttempt(attempt.current); }
  return <section className="chat-layout"><ChatHistory><nav aria-label="Conversation navigation" className="space-y-3"><Link className="block underline" to={support ? "/support" : "/chat"}>← {support ? "Inbox" : "Conversations"}</Link>{!support && <Link className="block underline" to="/chat">New chat and history</Link>}</nav>{historyError && <p role="alert">Could not load history.</p>}{history === null && !historyError && <p role="status">Loading history…</p>}{history && <ul className="space-y-2">{history.map(row => <li key={row.id}><Link aria-current={row.id === id ? "page" : undefined} className="underline" to={`${support ? "/support" : "/chat"}/${row.id}`}>Conversation {new Date(row.createdAt).toLocaleString()} — {row.status}</Link></li>)}</ul>}</ChatHistory><div className="chat-main"><div className="chat-messages"><h2 className="text-2xl font-semibold">Conversation</h2>
    <button className="rounded border px-3 py-2" disabled={pending} onClick={refresh}>Refresh conversation</button>
    {loading && <p role="status">Loading conversation…</p>}{error && <p role="alert">{error}</p>}
    {thread && <><p>Status: {thread.status}</p>{thread.clarificationDeadline && thread.status === "open" && <p>Clarification requested. Reply before {new Date(thread.clarificationDeadline).toLocaleString()} or this chat will be handed to support.</p>}
      {thread.ticketId && !support && <p>Support ticket: <Link className="underline" to={`/tickets/${thread.ticketId}`}>{thread.ticketId}</Link></p>}
      <ol className="space-y-3" aria-label="Messages">{thread.messages?.length ? thread.messages.map(message => <li key={message.id} className={`chat-bubble ${message.senderRole === "customer" ? "customer" : message.senderRole === "tool" ? "tool" : "agent"}`}><strong>{message.senderRole === "tool" ? "Tool activity" : message.senderRole}</strong><p className="whitespace-pre-wrap">{message.text}</p><small>{new Date(message.createdAt).toLocaleString()}</small>{!support && thread.status === "open" && message.senderRole === "agent" && message.id === [...(thread.messages ?? [])].reverse().find(item => item.senderRole === "agent")?.id && message.options?.map((option, index) => <button key={`${option.kind}-${index}`} type="button" className="rounded border px-3 py-2 m-1" disabled={pending || uncertain} onClick={() => { if (option.kind === "handoff") void escalate(); else if (option.kind === "details") { composer.current?.focus(); } else if (option.kind === "transfer" && option.id) { void sendAttempt({ text: option.id, key: crypto.randomUUID() }); } }}>{option.label}</button>)}</li>) : <li>No messages yet.</li>}</ol>
      {pending && attempt.current && <div className="chat-bubble customer">{attempt.current.text}</div>}
      {activity && <p role="status" aria-live="polite" className="chat-activity">{activity === "Preparing a response…" && <span className="chat-dots" aria-hidden="true"><i /><i /><i /></span>}{activity}</p>}{provisional && <div className="chat-bubble agent" aria-live="off">{provisional}</div>}
      {handoffUncertain && thread.status === "open" && <button className="rounded border px-3 py-2" onClick={() => { setHandoffUncertain(false); setError(""); }}>Request support again (previous handoff may have succeeded)</button>}
      {!support && thread.status === "open" && <button className="rounded border px-3 py-2" disabled={pending || handoffUncertain} onClick={escalate}>I don't know / Contact support</button>}
      {uncertain && <div className="space-x-2"><button className="rounded border px-3 py-2" disabled={pending} onClick={() => void retry()}>Retry same action</button><button className="rounded border px-3 py-2" disabled={pending} onClick={() => { if (sending.current) return; attempt.current = null; setUncertain(false); setError(""); }}>Start a new action (previous may have succeeded)</button></div>}
    </>}
  </div>{thread && thread.status !== "resolved" && (!support || thread.status === "escalated") && <ChatComposer id="reply" label={support ? "Reply as human support" : thread.status === "escalated" ? "Message human support" : "Reply to the agent"} value={text} onChange={setText} onSubmit={send} disabled={pending || uncertain} pending={pending} inputRef={composer} />}</div></section>;
}
export default function ConversationPage() { return <Thread />; }
