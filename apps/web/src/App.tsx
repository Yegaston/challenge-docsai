import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

type Health = "checking" | "healthy" | "database-unavailable" | "error";
const messages: Record<Health, string> = {
  checking: "Checking API and database…",
  healthy: "API online · PostgreSQL reachable",
  "database-unavailable": "API online, but PostgreSQL is unavailable. Check the database service and retry.",
  error: "Unable to check system health. Check the API service and retry.",
};

export default function App() {
  const [health, setHealth] = useState<Health>("checking");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    const timeout = setTimeout(() => controller.abort(), 5000);
    setHealth("checking");
    void (async () => {
      try {
        const response = await fetch("/api/health", { signal: controller.signal });
        const body = await response.json();
        if (!active) return;
        if (response.ok && body?.status === "ok" && body?.database === "reachable") {
          setHealth("healthy");
        } else if (response.status === 503 && body?.database === "unreachable") {
          setHealth("database-unavailable");
        } else {
          setHealth("error");
        }
      } catch {
        if (active) setHealth("error");
      } finally {
        clearTimeout(timeout);
      }
    })();
    return () => {
      active = false;
      clearTimeout(timeout);
      controller.abort();
    };
  }, [attempt]);

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl items-center px-6 py-12">
      <section className="w-full space-y-6 rounded-xl border bg-card p-8 text-card-foreground shadow-sm" aria-labelledby="title">
        <div className="space-y-2">
          <p className="text-sm font-medium text-muted-foreground">Development scaffold</p>
          <h1 id="title" className="text-3xl font-semibold tracking-tight">Support Ticket AI</h1>
          <p className="text-muted-foreground">The workspace is ready. Authentication, tickets, and AI analysis are not implemented yet.</p>
        </div>
        <p role="status" aria-live="polite">{messages[health]}</p>
        <Button variant="outline" disabled={health === "checking"} onClick={() => setAttempt((value) => value + 1)}>
          Check again
        </Button>
      </section>
    </main>
  );
}
