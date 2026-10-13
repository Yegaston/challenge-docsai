import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { callApi } from "@/lib/api";
import { sessionInvalidMessage, useSession } from "@/session";

type Transfer = { id: string; amount: string; date: string; status: string; createdAt?: string };
type Input = { amount: string; date: string; status: string; idempotencyKey: string };
const today = () => new Date().toISOString().slice(0, 10);
const validDate = (date: string) => {
  const parsed = new Date(`${date}T00:00:00Z`);
  const cutoff = new Date(`${today()}T00:00:00Z`);
  cutoff.setUTCDate(cutoff.getUTCDate() - 90);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date && date >= cutoff.toISOString().slice(0, 10) && date <= today();
};
export default function TransfersPage() {
  const { session, clear } = useSession();
  const token = session?.token;
  const [rows, setRows] = useState<Transfer[] | null>(null);
  const [listError, setListError] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(today);
  const [status, setStatus] = useState("pending");
  const [pending, setPending] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const attempt = useRef<Input | null>(null);
  const busy = useRef(false);
  const loadActive = useRef<AbortController | null>(null);
  const createActive = useRef<AbortController | null>(null);
  const load = useCallback(async () => {
    loadActive.current?.abort();
    if (!token) return;
    const controller = new AbortController(); loadActive.current = controller;
    const result = await callApi({ token }, "/api/synthetic-transfers", { signal: controller.signal });
    if (controller.signal.aborted || loadActive.current !== controller) return;
    if (result.status === 401) { clear(sessionInvalidMessage); return; }
    if (result.status === 200 && Array.isArray(result.body?.transfers)) {
      setRows(result.body.transfers as Transfer[]); setListError("");
    } else setListError(result.status === 403 ? "Access denied to synthetic transfers." : "Could not load synthetic transfers. Refresh to try again.");
  }, [token, clear]);
  useEffect(() => {
    void load();
    return () => { loadActive.current?.abort(); loadActive.current = null; createActive.current?.abort(); createActive.current = null; busy.current = false; };
  }, [load]);
  async function create(input: Input) {
    if (!token || busy.current) return;
    const controller = new AbortController(); createActive.current = controller;
    busy.current = true; setPending(true); setError(""); setSuccess("");
    const result = await callApi({ token }, "/api/synthetic-transfers", { method: "POST", body: input, signal: controller.signal });
    if (controller.signal.aborted || createActive.current !== controller) return;
    createActive.current = null; busy.current = false; setPending(false);
    if (result.status === 401) { clear(sessionInvalidMessage); return; }
    if ((result.status === 200 || result.status === 201) && result.body?.transfer && typeof (result.body.transfer as Transfer).id === "string") {
      attempt.current = null; setUncertain(false);
      setSuccess(`Synthetic transfer created: ${(result.body.transfer as Transfer).id}`);
      setAmount(""); setDate(today()); setStatus("pending");
      await load(); return;
    }
    if (result.status === 0 || result.status === 503) {
      setUncertain(true); setError("Outcome uncertain. The synthetic transfer may have been created. Refresh the list or retry the same request; do not start another action until you acknowledge this uncertainty.");
      return;
    }
    attempt.current = null; setUncertain(false);
    setError(({ 400: "Invalid transfer details. Check amount, date and status.", 403: "Access denied to synthetic transfers.", 409: "Idempotency conflict. This request cannot be reused with different details.", 429: "Synthetic transfer limit reached. Try again after records expire." } as Record<number, string>)[result.status] ?? "Could not create synthetic transfer.");
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    if (busy.current || uncertain) return;
    if (!/^(?:0|[1-9]\d{0,9})\.\d{2}$/.test(amount) || Number(amount) <= 0 || !validDate(date) || !["pending", "completed", "failed"].includes(status)) {
      setError("Enter a positive amount with two decimal places and a valid UTC date within the past 90 days."); return;
    }
    const input = { amount, date, status, idempotencyKey: crypto.randomUUID() };
    attempt.current = input; void create(input);
  }
  return <section className="space-y-6">
    <header><h2 className="text-2xl font-semibold">Synthetic transfers</h2><p className="font-semibold">DEMO ONLY — no money moved. These are synthetic records for testing the agent, not real transactions.</p></header>
    <form onSubmit={submit} noValidate className="transfer-form rounded border p-4">
      <label>Amount <input className="rounded border p-2" inputMode="decimal" value={amount} onChange={event => setAmount(event.target.value)} disabled={pending || uncertain} /></label>
      <label>UTC date <input className="rounded border p-2" type="date" value={date} max={today()} onChange={event => setDate(event.target.value)} disabled={pending || uncertain} /></label>
      <label>Status <select className="rounded border p-2" value={status} onChange={event => setStatus(event.target.value)} disabled={pending || uncertain}><option value="pending">Pending</option><option value="completed">Completed</option><option value="failed">Failed</option></select></label>
      <button className="rounded border px-3 py-2" disabled={pending || uncertain}>{pending ? "Adding…" : "Add synthetic transfer"}</button>
    </form>
    {error && <p role="alert">{error}</p>}{success && <p role="status">{success}</p>}
    {uncertain && <div className="flex flex-wrap gap-2"><button className="rounded border px-3 py-2" disabled={pending} onClick={() => void load()}>Refresh transfers</button><button className="rounded border px-3 py-2" disabled={pending} onClick={() => { if (attempt.current) void create(attempt.current); }}>Retry same request</button><button className="rounded border px-3 py-2" disabled={pending} onClick={() => { if (busy.current) return; attempt.current = null; setUncertain(false); setError(""); }}>Acknowledge uncertain outcome and start new action</button></div>}
    <div><h3 className="text-xl font-semibold">Demo history</h3>{listError && <p role="alert">{listError}</p>}{listError && <button className="rounded border px-3 py-2" onClick={() => void load()}>Refresh transfers</button>}
      {rows === null && !listError ? <p role="status">Loading synthetic transfers…</p> : rows?.length === 0 && !listError ? <p>No synthetic transfers yet.</p> : null}
      {rows && rows.length > 0 && <ul className="space-y-3">{rows.map(row => <li className="rounded border p-3" key={row.id}><strong>DEMO</strong> — {row.amount} · {row.date} UTC · {row.status} · ID: {row.id} <Link className="underline" to={`/chat?transfer=${encodeURIComponent(row.id)}`}>Ask agent about this</Link></li>)}</ul>}
    </div>
  </section>;
}
