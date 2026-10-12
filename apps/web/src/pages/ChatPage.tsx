import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { callApi } from "@/lib/api";
import { sessionInvalidMessage, useSession } from "@/session";
import type { Conversation } from "@/pages/ConversationPage";

export default function ChatPage() {
  const { session, clear } = useSession();
  const token = session?.token;
  const navigate = useNavigate();
  const [list, setList] = useState<Conversation[] | null>(null);
  const [error, setError] = useState("");
  const [text, setText] = useState("");
  const [pending, setPending] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const attempt = useRef<{ text: string; key: string } | null>(null);
  const loadActive = useRef<AbortController | null>(null);
  const sendActive = useRef<AbortController | null>(null);
  const load = useCallback(async (signal: AbortSignal) => {
    if (!token) return;
    const result = await callApi({ token }, "/api/conversations", { signal });
    if (signal.aborted) return;
    if (result.status === 401) clear(sessionInvalidMessage);
    else if (result.status === 200 && Array.isArray(result.body?.conversations)) { setList(result.body.conversations as Conversation[]); setError(previous => previous.startsWith("Outcome uncertain") ? previous : ""); }
    else setError("Could not load conversations. Refresh to try again.");
  }, [token, clear]);
  useEffect(() => { const controller = new AbortController(); loadActive.current = controller; void load(controller.signal); return () => { controller.abort(); sendActive.current?.abort(); }; }, [load]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!token || !text.trim() || pending || uncertain) return;
    const current = { text: text.trim(), key: crypto.randomUUID() }; attempt.current = current;
    await create(current);
  }
  async function create(current: { text: string; key: string }) {
    if (!token || pending) return;
    setPending(true); setError("");
    const controller = new AbortController(); sendActive.current = controller;
    const result = await callApi({ token }, "/api/conversations", { method: "POST", body: { text: current.text, idempotencyKey: current.key }, signal: controller.signal });
    if (controller.signal.aborted) return;
    setPending(false);
    if (result.status === 401) { clear(sessionInvalidMessage); return; }
    if (result.body?.id && typeof result.body.id === "string") { attempt.current = null; navigate(`/chat/${result.body.id}`); return; }
    if (result.status === 0 || result.status === 503 || result.status === 409) { setUncertain(true); setError("Outcome uncertain. Refresh the list to reconcile or retry the same request. Do not resend automatically."); }
    else { attempt.current = null; setError("Could not start chat. Check your question and try again."); }
  }
  return <section className="space-y-5"><h2 className="text-2xl font-semibold">Your conversations</h2>
    <form onSubmit={submit} className="space-y-2"><label htmlFor="question">How can we help with your transfer?</label><textarea id="question" className="w-full rounded border p-3" maxLength={2000} value={text} onChange={e => setText(e.target.value)} disabled={pending || uncertain} required /><button className="rounded border px-3 py-2" disabled={pending || uncertain}>{pending ? "Starting…" : "Start chat"}</button></form>
    {error && <p role="alert">{error}</p>}
    {uncertain && <><button className="rounded border px-3 py-2" onClick={() => { const controller = new AbortController(); loadActive.current?.abort(); loadActive.current = controller; void load(controller.signal); }}>Refresh conversations</button> <button className="rounded border px-3 py-2" disabled={pending} onClick={() => { if (attempt.current) void create(attempt.current); }}>Retry same request</button> <button className="rounded border px-3 py-2" onClick={() => { attempt.current = null; setUncertain(false); setError(""); }}>Start a new action (previous outcome may have succeeded)</button></>}
    {list === null ? <p role="status">Loading conversations…</p> : list.length === 0 ? <p>No conversations yet. Ask a question above to begin.</p> : <ul className="space-y-2">{list.map(row => <li key={row.id}><Link className="underline" to={`/chat/${row.id}`}>Conversation {new Date(row.createdAt).toLocaleString()} — {row.status}</Link></li>)}</ul>}
  </section>;
}
