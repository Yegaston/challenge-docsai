import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { callApi } from "@/lib/api";
import { analysisErrorText, ticketCreationErrorText } from "@/lib/messages";
import { sessionInvalidMessage, useSession } from "@/session";

type Phase = "editing" | "creating" | "analyzing" | "failed" | "stopped";
export default function NewTicketPage() {
  const navigate = useNavigate();
  const { session, clear, beginAnalysis, clearAnalysis } = useSession();
  const token = session?.token;
  const [text, setText] = useState("");
  const [phase, setPhase] = useState<Phase>("editing");
  const [error, setError] = useState("");
  const [createdId, setCreatedId] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => { controller.current?.abort(); }, []);

  async function analyze(id: string) {
    const local = new AbortController(); controller.current = local;
    beginAnalysis(id, null);
    setCreatedId(id); setPhase("analyzing"); setError("");
    const result = await callApi({ token: token! }, `/api/tickets/${id}/analyses`, { method: "POST", body: {}, signal: local.signal });
    if (local.signal.aborted) return;
    if (result.status === 401) { clear(sessionInvalidMessage); return; }
    if (result.status === 201 && (result.body?.analysis as { status?: string } | undefined)?.status === "succeeded") { clearAnalysis(id); navigate(`/tickets/${id}`); return; }
    if (result.status === 201) { navigate(`/tickets/${id}`); return; }
    const analysis = result.body?.analysis as { status?: string } | undefined;
    const definite = [400, 404, 429].includes(result.status) || analysis?.status === "failed";
    if (definite) clearAnalysis(id);
    setPhase(definite ? "failed" : "stopped");
    setError(definite ? analysisErrorText(result) : `${analysisErrorText(result)} Unable to confirm whether analysis started. Check ticket status before retrying.`);
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = text.trim();
    if (!value) { setError("Enter the ticket text."); return; }
    setError(""); setPhase("creating");
    void (async () => {
      const local = new AbortController(); controller.current = local;
      const result = await callApi({ token: token! }, "/api/tickets", { method: "POST", body: { text: value }, signal: local.signal });
      if (local.signal.aborted) return;
      if (result.status === 401) { clear(sessionInvalidMessage); return; }
      const ticket = result.body?.ticket as { id?: unknown } | undefined;
      if (result.status === 201 && typeof ticket?.id === "string") { void analyze(ticket.id); return; }
      setPhase("editing"); setError(ticketCreationErrorText(result));
    })();
  }
  function cancel() {
    controller.current?.abort();
    setPhase("stopped"); setError("Stopped waiting. The server may still be processing this analysis. Check ticket status before retrying.");
  }
  return <section className="space-y-6" aria-labelledby="new-ticket-title">
    <h2 id="new-ticket-title" className="text-2xl font-semibold">New ticket</h2>
    {phase === "failed" || phase === "stopped" ? <div className="space-y-3">
      <p role="alert">{error}</p>
      <div className="flex gap-3">
        {phase === "failed" && <Button onClick={() => { if (createdId) void analyze(createdId); }}>Try analysis again</Button>}
        <Button asChild variant="outline"><Link to={`/tickets/${createdId}`}>View ticket</Link></Button>
      </div>
    </div> : <form className="space-y-3" aria-busy={phase !== "editing"} onSubmit={submit}>
      <label className="block" htmlFor="ticket-text">Ticket text</label>
      <Textarea id="ticket-text" value={text} onChange={(event) => setText(event.target.value)} maxLength={20000} rows={8} disabled={phase !== "editing"} />
      <p className="text-sm text-muted-foreground">{text.length}/20000</p>
      {error && <p role="alert">{error}</p>}
      {phase === "creating" && <p role="status">Creating ticket…</p>}
      {phase === "analyzing" && <div className="space-y-2">
        <p role="status">Analyzing… this can take up to a minute.</p>
        <Button type="button" variant="outline" onClick={cancel}>Stop waiting</Button>
      </div>}
      <Button type="submit" disabled={phase !== "editing"}>Create ticket</Button>
    </form>}
  </section>;
}
