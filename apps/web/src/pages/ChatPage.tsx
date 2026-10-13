import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { callApi } from "@/lib/api";
import { sessionInvalidMessage, useSession } from "@/session";
import type { Conversation } from "@/pages/ConversationPage";
import { postChatStream } from "@/lib/chat-stream";
import ChatComposer from "@/components/ChatComposer";
import ChatHistory from "@/components/ChatHistory";

export default function ChatPage() {
  const { session, clear } = useSession();
  const token = session?.token;
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const transferId = params.get("transfer");
  const [list, setList] = useState<Conversation[] | null>(null);
  const [error, setError] = useState("");
  const [text, setText] = useState(() => {
    const id = new URLSearchParams(window.location.search).get("transfer");
    return id && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(id) ? `Check synthetic transfer ${id}` : "";
  });
  useEffect(() => {
    if (transferId && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(transferId)) setText(`Check synthetic transfer ${transferId}`);
  }, [transferId]);
  const [pending, setPending] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [activity, setActivity] = useState(""); const [provisional, setProvisional] = useState("");
  const attempt = useRef<{ text: string; key: string } | null>(null);
  const loadActive = useRef<AbortController | null>(null);
  const sendActive = useRef<AbortController | null>(null);
  const sending = useRef(false);
  const load = useCallback(async (signal: AbortSignal) => {
    if (!token) return;
    const result = await callApi({ token }, "/api/conversations", { signal });
    if (signal.aborted) return;
    if (result.status === 401) clear(sessionInvalidMessage);
    else if (result.status === 200 && Array.isArray(result.body?.conversations)) { setProvisional(""); setList(result.body.conversations as Conversation[]); setError(previous => previous.startsWith("Outcome uncertain") ? previous : ""); }
    else setError("Could not load conversations. Refresh to try again.");
  }, [token, clear]);
  useEffect(() => { const controller = new AbortController(); loadActive.current = controller; void load(controller.signal); return () => { controller.abort(); sendActive.current?.abort(); }; }, [load]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!token || !text.trim() || sending.current || pending || uncertain) return;
    const current = { text: text.trim(), key: crypto.randomUUID() }; attempt.current = current;
    setText("");
    await create(current, text);
  }
  async function create(current: { text: string; key: string }, originalDraft?: string) {
    if (!token || sending.current || pending) return;
    sending.current = true;
    setPending(true); setError("");
    const controller = new AbortController(); sendActive.current = controller;
    setActivity("Preparing a response…"); setProvisional("");
    const result = await postChatStream(token, "/api/conversations/stream", { text: current.text, idempotencyKey: current.key }, controller.signal, event => {
      if (event.event === "status") setActivity("Preparing a response…");
      if (event.event === "delta") { setActivity(""); setProvisional(previous => previous + event.text); }
    });
    if (controller.signal.aborted) return;
    sending.current = false;
    setPending(false); setActivity(result.kind === "done" ? "Response ready." : "");
    if (result.kind === "unauthorized") { clear(sessionInvalidMessage); return; }
    if (result.kind === "done") { attempt.current = null; navigate(`/chat/${result.data.id}`); return; }
    if (result.kind === "uncertain") { setUncertain(true); setError(result.instruction); }
    else { attempt.current = null; if (originalDraft !== undefined) setText(previous => previous || originalDraft); setError(result.instruction); }
  }
  return <section className="chat-layout"><ChatHistory><h2 className="text-lg font-semibold">Your conversations</h2><p className="text-sm text-slate-600">Past chats</p>{list === null ? <p role="status">Loading conversations…</p> : list.length === 0 ? <p>No conversations yet. Ask a question to begin.</p> : <ul className="space-y-2">{list.map(row => <li key={row.id}><Link className="underline" to={`/chat/${row.id}`}>Conversation {new Date(row.createdAt).toLocaleString()} — {row.status}</Link></li>)}</ul>}</ChatHistory><div className="chat-main"><div className="chat-messages"><div><h2 className="text-2xl font-semibold">New chat</h2><p className="text-slate-600">Ask about a transfer or another support question.</p>
    </div>
    {attempt.current && <div className="chat-bubble customer">{attempt.current.text}</div>}
    {activity && <p role="status" aria-live="polite" className="chat-activity">{activity === "Preparing a response…" && <span className="chat-dots" aria-hidden="true"><i /><i /><i /></span>}{activity}</p>}
    {provisional && <div className="chat-bubble agent" aria-live="off">{provisional}</div>}
    {error && <p role="alert">{error}</p>}
    {uncertain && <><button className="rounded border px-3 py-2" onClick={() => { const controller = new AbortController(); loadActive.current?.abort(); loadActive.current = controller; void load(controller.signal); }}>Refresh conversations</button> <button className="rounded border px-3 py-2" disabled={pending} onClick={() => { if (attempt.current) void create(attempt.current); }}>Retry same request</button> <button className="rounded border px-3 py-2" disabled={pending} onClick={() => { if (sending.current) return; attempt.current = null; setUncertain(false); setError(""); }}>Start a new action (previous outcome may have succeeded)</button></>}
    </div><ChatComposer id="question" label="How can we help with your transfer?" value={text} onChange={setText} onSubmit={submit} disabled={pending || uncertain} pending={pending} /></div></section>;
}
