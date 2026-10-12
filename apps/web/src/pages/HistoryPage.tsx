import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { callApi } from "@/lib/api";
import { historyLoadErrorText } from "@/lib/messages";
import { sessionInvalidMessage, useSession } from "@/session";

type Ticket = { id: string; text: string; createdAt: string };
function latestStatus(analyses: unknown) {
  const records = Array.isArray(analyses) ? analyses as Array<{ status?: string }> : [];
  const status = records[records.length - 1]?.status;
  if (!status) return "No analysis yet.";
  if (status === "running") return "Analyzing…";
  if (status === "succeeded") return "Analysis ready";
  return "Analysis failed";
}
export default function HistoryPage() {
  const { session, clear } = useSession();
  const token = session?.token;
  const [tickets, setTickets] = useState<Ticket[] | null>(null);
  const [statuses, setStatuses] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    setTickets(null); setError(""); setStatuses({});
    void (async () => {
      const list = await callApi({ token }, "/api/tickets", { signal: controller.signal });
      if (controller.signal.aborted) return;
      if (list.status === 401) { clear(sessionInvalidMessage); return; }
      const rows = list.body?.tickets;
      if (list.status !== 200 || !Array.isArray(rows)) { setError(historyLoadErrorText(list)); return; }
      const next = rows as Ticket[];
      setTickets(next);
      await Promise.all(next.map(async (ticket) => {
        const detail = await callApi({ token }, `/api/tickets/${ticket.id}`, { signal: controller.signal });
        if (controller.signal.aborted) return;
        if (detail.status === 401) { clear(sessionInvalidMessage); return; }
        const ticketBody = detail.body?.ticket as { analyses?: unknown } | undefined;
        setStatuses((previous) => ({ ...previous, [ticket.id]: detail.status === 200 ? latestStatus(ticketBody?.analyses) : "Status unavailable" }));
      }));
    })();
    return () => controller.abort();
  }, [token, attempt, clear]);
  return <section className="space-y-6" aria-labelledby="tickets-title">
    <div className="flex items-center justify-between">
      <h2 id="tickets-title" className="text-2xl font-semibold">Tickets</h2>
      <Button asChild size="sm"><Link to="/tickets/new">New ticket</Link></Button>
    </div>
    {error && <div className="space-y-3"><p role="alert">{error}</p><Button onClick={() => setAttempt((value) => value + 1)}>Try again</Button></div>}
    {!error && tickets === null && <p role="status">Loading tickets…</p>}
    {tickets?.length === 0 && <><p>No tickets yet.</p><Button asChild variant="outline"><Link to="/tickets/new">Create a ticket</Link></Button></>}
    {tickets && tickets.length > 0 && <ul className="space-y-3">{tickets.map((ticket) => <li key={ticket.id} className="rounded-md border p-4">
      <Link to={`/tickets/${ticket.id}`} className="block space-y-1">
        <p className="truncate font-medium">{ticket.text}</p>
        <p className="text-sm text-muted-foreground">{statuses[ticket.id] ?? "Loading status…"} · {new Date(ticket.createdAt).toLocaleString()}</p>
      </Link>
    </li>)}</ul>}
  </section>;
}
