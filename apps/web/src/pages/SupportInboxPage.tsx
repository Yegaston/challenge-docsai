import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { callApi } from "@/lib/api";
import type { Conversation } from "@/pages/ConversationPage";
import { sessionInvalidMessage, useSession } from "@/session";
export default function SupportInboxPage() {
  const { session, clear } = useSession(); const token = session?.token;
  const [list, setList] = useState<Conversation[] | null>(null); const [error, setError] = useState("");
  const load = useCallback(async (signal: AbortSignal) => {
    if (!token) return;
    const result = await callApi({ token }, "/api/conversations", { signal });
    if (signal.aborted) return;
    if (result.status === 401) clear(sessionInvalidMessage);
    else if (result.status === 200 && Array.isArray(result.body?.conversations)) { setList((result.body.conversations as Conversation[]).filter(row => row.status === "escalated")); setError(""); }
    else setError("Could not load inbox. Refresh to try again.");
  }, [token, clear]);
  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); }, [load]);
  return <section className="space-y-4"><h2 className="text-2xl font-semibold">Human support inbox</h2><button className="rounded border px-3 py-2" onClick={() => { const controller = new AbortController(); void load(controller.signal); }}>Refresh inbox</button>{error && <p role="alert">{error}</p>}{!list ? <p role="status">Loading inbox…</p> : list.length === 0 ? <p>No escalated conversations.</p> : <ul className="space-y-2">{list.map(row => <li key={row.id}><Link className="underline" to={`/support/${row.id}`}>Escalated conversation {new Date(row.createdAt).toLocaleString()}</Link></li>)}</ul>}</section>;
}
