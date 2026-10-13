import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useSession } from "@/session";

type Health = "checking" | "healthy" | "database-unavailable" | "error";
const messages: Record<Health, string> = {
  checking: "Checking API and database…",
  healthy: "API online · PostgreSQL reachable",
  "database-unavailable": "API online, but PostgreSQL is unavailable. Check the database service and retry.",
  error: "Unable to check system health. Check the API service and retry.",
};
export default function LoginPage() {
  const { session, pending, restoring, error, login, retry } = useSession();
  const navigate = useNavigate();
  const [health, setHealth] = useState<Health>("checking");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => { if (session) navigate(session.user?.role === "support" ? "/support" : "/chat", { replace: true }); }, [session, navigate]);
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
        if (response.ok && body?.status === "ok" && body?.database === "reachable") setHealth("healthy");
        else if (response.status === 503 && body?.database === "unreachable") setHealth("database-unavailable");
        else setHealth("error");
      } catch { if (active) setHealth("error"); }
      finally { clearTimeout(timeout); }
    })();
    return () => { active = false; clearTimeout(timeout); controller.abort(); };
  }, [attempt]);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    void login({ email: String(data.get("email")), password: String(data.get("password")) });
    form.reset();
  }

  if (restoring || session) return <main role="status">Restoring session…</main>;

  return <main className="mx-auto flex min-h-screen max-w-2xl items-center px-6 py-12">
    <Card className="w-full space-y-6 p-8" aria-labelledby="title">
      {restoring && <p role="status">Restoring session…</p>}
      {error.includes("restore") && <p role="alert">{error} <Button onClick={retry}>Retry restore</Button></p>}
      <div className="space-y-2">
        <h1 id="title" className="text-3xl font-semibold tracking-tight">Support Ticket AI</h1>
        <p className="text-muted-foreground">Log in with your locally configured demo account to verify protected API access.</p>
      </div>
      <p role="status" aria-live="polite">{messages[health]}</p>
      <Button variant="outline" disabled={health === "checking"} onClick={() => setAttempt((value) => value + 1)}>Check again</Button>
      <section className="space-y-4 border-t pt-6" aria-labelledby="account-title">
        <h2 id="account-title" className="text-xl font-semibold">Log in</h2>
        <form className="space-y-3" aria-busy={pending} onSubmit={submit}>
          <label className="block" htmlFor="email">Email</label>
          <Input id="email" name="email" type="email" autoComplete="username" maxLength={254} required disabled={pending} />
          <label className="block" htmlFor="password">Password</label>
          <Input id="password" name="password" type="password" autoComplete="current-password" maxLength={256} required disabled={pending} />
          <Button type="submit" disabled={pending}>{pending ? "Logging in…" : "Log in"}</Button>
        </form>
        {error && !error.includes("restore") && <p role="alert">{error}</p>}
      </section>
    </Card>
  </main>;
}
