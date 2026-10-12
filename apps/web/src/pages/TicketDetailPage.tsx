import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { callApi } from "@/lib/api";
import { analysisErrorText, analysisFailureMessage, ticketLoadErrorText } from "@/lib/messages";
import { sessionInvalidMessage, useSession } from "@/session";

type Analysis = {
  id: string; status: "running" | "succeeded" | "failed"; model: string; promptVersion: string;
  instruction: string | null; createdAt: string; completedAt: string | null;
  summary: string | null; category: string | null; uncertaintyNote: string | null; failureCode: string | null;
};
type Ticket = { id: string; text: string; createdAt: string; analyses: Analysis[] };
const categories: Record<string, string> = {
  billing: "Billing", account_access: "Account access", technical_issue: "Technical issue", other: "Other",
};
function AnalysisCard({ analysis, attempt, total }: { analysis: Analysis; attempt: number; total: number }) {
  return <div className="space-y-2 rounded-md border p-4">
    <p className="text-sm text-muted-foreground">Attempt {attempt} of {total} · {analysis.model} · prompt {analysis.promptVersion} · {new Date(analysis.createdAt).toLocaleString()}</p>
    {analysis.instruction && <p>Instruction: {analysis.instruction}</p>}
    {analysis.status === "succeeded" && <>
      <p className="whitespace-pre-wrap">{analysis.summary}</p>
      <p className="text-sm">Category: {categories[analysis.category ?? ""] ?? analysis.category}</p>
      {analysis.uncertaintyNote && <p className="text-sm"><span className="font-medium">Uncertainty:</span> {analysis.uncertaintyNote}</p>}
    </>}
    {analysis.status === "failed" && <p role="alert">Attempt failed: {analysisFailureMessage(analysis.failureCode)}</p>}
    {analysis.status === "running" && <p role="status">Analyzing…</p>}
  </div>;
}
export default function TicketDetailPage() {
  const { id = "" } = useParams();
  const { session, clear, beginAnalysis, clearAnalysis, pendingAnalysis } = useSession();
  const token = session?.token;
  const [detail, setDetail] = useState<Ticket | null>(null);
  const [error, setError] = useState<{ id: string; text: string; retriable: boolean } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [analysisError, setAnalysisError] = useState("");
  const [instruction, setInstruction] = useState("");
  const [recoverable, setRecoverable] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const loadController = useRef<AbortController | null>(null);
  const analysisController = useRef<AbortController | null>(null);
  useEffect(() => () => { loadController.current?.abort(); analysisController.current?.abort(); }, []);
  const load = useCallback(async () => {
    loadController.current?.abort();
    setRecoverable(false); setAcknowledged(false);
    const local = new AbortController(); loadController.current = local;
    const requestGuard = pendingAnalysis(id);
    const requestStartedAt = Date.now();
    const result = await callApi({ token: token! }, `/api/tickets/${id}`, { signal: local.signal });
    if (local.signal.aborted) return;
    if (result.status === 401) { clear(sessionInvalidMessage); return; }
    const ticket = result.body?.ticket as Ticket | undefined;
    if (result.status === 200 && ticket && typeof ticket.text === "string" && Array.isArray(ticket.analyses)) {
      const guard = pendingAnalysis(id);
      const latest = ticket.analyses.at(-1);
      if (guard.pending && latest && latest.id !== guard.priorId && (latest.status === "succeeded" || latest.status === "failed")) {
        clearAnalysis(id);
      } else if (guard.pending && guard.startedAt !== null && requestGuard.pending
        && guard.priorId === requestGuard.priorId && guard.startedAt === requestGuard.startedAt
        && requestStartedAt >= guard.startedAt + 75_000
        && ((!latest && guard.priorId === null) || (latest?.id === guard.priorId && latest.status !== "running"))) {
        setRecoverable(true);
      }
      setDetail(ticket); setError(null); return;
    }
    setDetail(null);
    setError({ id, text: ticketLoadErrorText(result), retriable: result.status !== 404 && result.status !== 400 });
  }, [id, token, clear, pendingAnalysis, clearAnalysis]);
  useEffect(() => {
    void load();
    return () => { loadController.current?.abort(); analysisController.current?.abort(); };
  }, [load, attempt]);
  async function analyze(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || pendingAnalysis(id).pending || detail?.id !== id || detail.analyses.at(-1)?.status === "running") return;
    const value = instruction.trim();
    if (value.length > 2000) { setAnalysisError("Keep the instruction within 2000 characters."); return; }
    const local = new AbortController(); analysisController.current = local;
    beginAnalysis(id, detail.analyses.at(-1)?.id ?? null);
    setRecoverable(false); setAcknowledged(false);
    setBusy(true); setAnalysisError("");
    const result = await callApi({ token: token! }, `/api/tickets/${id}/analyses`, {
      method: "POST", body: value ? { instruction: value } : {}, signal: local.signal,
    });
    if (local.signal.aborted) return;
    setBusy(false);
    if (result.status === 401) { clear(sessionInvalidMessage); return; }
    if (result.status === 201) {
      if ((result.body?.analysis as { id?: string; status?: string } | undefined)?.status === "succeeded"
        && (result.body?.analysis as { id?: string }).id !== detail.analyses.at(-1)?.id) clearAnalysis(id);
      setInstruction(""); await load(); return;
    }
    const definite = [400, 404, 429].includes(result.status);
    if (definite) clearAnalysis(id);
    setAnalysisError(definite || result.body?.analysis
      ? analysisErrorText(result)
      : `${analysisErrorText(result)} Unable to confirm whether analysis started. Check ticket status before retrying.`);
    // Provider failures persist an attempt; refresh confirms its new terminal ID before releasing the guard.
    if (result.body?.analysis) await load();
  }
  function cancel() {
    analysisController.current?.abort(); setBusy(false);
    setAnalysisError("Stopped waiting. The server may still be processing this analysis. Check ticket status before retrying.");
  }
  const visibleDetail = detail?.id === id ? detail : null;
  const visibleError = error?.id === id ? error : null;
  const versions = visibleDetail ? [...visibleDetail.analyses].reverse() : [];
  const [latest, ...earlier] = versions;
  const waitingForStatus = pendingAnalysis(id).pending || latest?.status === "running";
  const canRecover = recoverable && pendingAnalysis(id).pending && !busy && visibleDetail?.id === id
    && ((!latest && pendingAnalysis(id).priorId === null)
      || (latest?.id === pendingAnalysis(id).priorId && latest.status !== "running"));
  return <section className="space-y-6" aria-labelledby="ticket-title">
    <div className="flex items-center justify-between">
      <h2 id="ticket-title" className="text-2xl font-semibold">Ticket</h2>
      <Button asChild variant="outline" size="sm"><Link to="/tickets">Back to tickets</Link></Button>
    </div>
    {!visibleDetail && !visibleError && <p role="status">Loading ticket…</p>}
    {visibleError && <div className="space-y-3"><p role="alert">{visibleError.text}</p>
      {visibleError.retriable && <Button onClick={() => setAttempt((value) => value + 1)}>Try again</Button>}
    </div>}
    {visibleDetail && <>
      <p className="text-sm text-muted-foreground">{new Date(visibleDetail.createdAt).toLocaleString()}</p>
      <div className="whitespace-pre-wrap rounded-md border bg-muted/40 p-4">{visibleDetail.text}</div>
      <div className="space-y-3">
        <h3 className="text-lg font-semibold">Latest analysis</h3>
        {latest ? <AnalysisCard analysis={latest} attempt={versions.length} total={versions.length} /> : <p>No analysis yet.</p>}
      </div>
      {earlier.length > 0 && <div className="space-y-3"><h3 className="text-lg font-semibold">Earlier versions</h3>
        <ul className="space-y-3">{earlier.map((analysis, index) => <li key={analysis.id}>
          <AnalysisCard analysis={analysis} attempt={earlier.length - index} total={versions.length} />
        </li>)}</ul>
      </div>}
      <form className="space-y-3 border-t pt-6" aria-busy={busy} onSubmit={(event) => void analyze(event)}>
        <label className="block" htmlFor="instruction">Refinement instruction (optional)</label>
        <Textarea id="instruction" value={instruction} onChange={(event) => setInstruction(event.target.value)} maxLength={2000} rows={4} disabled={busy} />
        <p className="text-sm text-muted-foreground">{instruction.length}/2000</p>
        {analysisError && <p role="alert">{analysisError}</p>}
        {busy ? <div className="space-y-2"><p role="status">Analyzing… this can take up to a minute.</p>
          <Button type="button" variant="outline" onClick={cancel}>Stop waiting</Button></div>
          : waitingForStatus ? <div className="space-y-2">
            <p role="status">The server may still be processing this analysis. Refresh status before retrying.</p>
            <Button type="button" variant="outline" onClick={() => void load()}>Refresh status</Button>
            {canRecover && <div className="space-y-2">
              <label className="flex items-center gap-2"><input type="checkbox" checked={acknowledged}
                onChange={(event) => setAcknowledged(event.target.checked)} />
                I understand this may create a duplicate paid attempt; the server has not been cancelled.</label>
              <Button type="button" variant="outline" disabled={!acknowledged} onClick={() => {
                setRecoverable(false); setAcknowledged(false); clearAnalysis(id);
              }}>Discard uncertain wait</Button>
            </div>}
          </div>
          : <Button type="submit">{visibleDetail.analyses.length ? "Refine analysis" : "Run analysis"}</Button>}
      </form>
    </>}
  </section>;
}
