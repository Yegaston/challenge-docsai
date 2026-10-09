import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

type Health = "checking" | "healthy" | "database-unavailable" | "error";
const messages: Record<Health, string> = {
  checking: "Checking API and database…",
  healthy: "API online · PostgreSQL reachable",
  "database-unavailable": "API online, but PostgreSQL is unavailable. Check the database service and retry.",
  error: "Unable to check system health. Check the API service and retry.",
};

type Session = { token: string; expiresAt: number; user?: { id: string; email: string } };

function DemoLogin() {
  const [session, setSession] = useState<Session | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const activeRequest = useRef<AbortController | null>(null);

  function clearSession(message = "") {
    activeRequest.current?.abort();
    activeRequest.current = null;
    setSession(null);
    setPending(false);
    setError(message);
  }

  useEffect(() => () => { activeRequest.current?.abort(); }, []);
  const expiresAt = session?.expiresAt;
  useEffect(() => {
    if (!expiresAt) return;
    const timeout = setTimeout(() => clearSession("Session expired. Log in again."), Math.max(0, expiresAt - Date.now()));
    return () => clearTimeout(timeout);
  }, [expiresAt]);

  async function authenticate(credentials?: { email: string; password: string }) {
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    const live = () => activeRequest.current === controller && !controller.signal.aborted;
    const timeout = setTimeout(() => {
      if (!live()) return;
      controller.abort();
      setPending(false);
      setError("Authentication request timed out. Try again.");
    }, 10_000);
    setPending(true);
    setError("");
    try {
      let next = session;
      if (credentials) {
        const response = await fetch("/api/auth/login", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify(credentials), signal: controller.signal, credentials: "omit", cache: "no-store",
        });
        if (!live()) return;
        if (!response.ok) {
          setError(response.status === 401 ? "Invalid email or password." : "Authentication unavailable. Try again.");
          return;
        }
        const body = await response.json();
        if (!live()) return;
        if (typeof body?.token !== "string" || !body.token || !Number.isFinite(body.expiresAt) || body.expiresAt <= Date.now() || body.expiresAt > Date.now() + 900_000) {
          throw new Error("Invalid login response");
        }
        next = { token: body.token, expiresAt: body.expiresAt };
        setSession(next);
      }
      if (!next) return;
      const response = await fetch("/api/auth/me", {
        headers: { Authorization: `Bearer ${next.token}` }, signal: controller.signal, credentials: "omit", cache: "no-store",
      });
      if (!live()) return;
      if (response.status === 401) {
        clearSession("Session invalid or expired. Log in again.");
        return;
      }
      if (!response.ok) {
        setError("Authentication unavailable. Try again.");
        return;
      }
      const body = await response.json();
      if (!live()) return;
      if (next.expiresAt <= Date.now()) {
        clearSession("Session expired. Log in again.");
        return;
      }
      if (typeof body?.user?.id !== "string" || typeof body?.user?.email !== "string") throw new Error("Invalid identity response");
      setSession({ ...next, user: { id: body.user.id, email: body.user.email } });
    } catch {
      if (live()) setError("Unable to reach authentication service. Try again.");
    } finally {
      clearTimeout(timeout);
      if (live()) setPending(false);
    }
  }

  return (
    <section className="space-y-4 border-t pt-6" aria-labelledby="account-title">
      <h2 id="account-title" className="text-xl font-semibold">{session ? "Demo account" : "Log in"}</h2>
      {session ? (
        <div className="space-y-3">
          {session.user && <p>{session.user.email}</p>}
          {pending && <p role="status">Checking session…</p>}
          <div className="flex gap-3">
            <Button disabled={pending} onClick={() => void authenticate()}>Verify session</Button>
            <Button variant="outline" onClick={() => clearSession()}>Log out</Button>
          </div>
          <p className="text-sm text-muted-foreground">Reload or expiry requires login again. Tickets and AI analysis are not implemented yet.</p>
        </div>
      ) : (
        <form className="space-y-3" aria-busy={pending} onSubmit={(event) => {
          event.preventDefault();
          const form = event.currentTarget;
          const data = new FormData(form);
          void authenticate({ email: String(data.get("email")), password: String(data.get("password")) });
          form.reset();
        }}>
          <label className="block" htmlFor="email">Email</label>
          <input className="w-full rounded border p-2" id="email" name="email" type="email" autoComplete="username" maxLength={254} required disabled={pending} />
          <label className="block" htmlFor="password">Password</label>
          <input className="w-full rounded border p-2" id="password" name="password" type="password" autoComplete="current-password" maxLength={256} required disabled={pending} />
          <Button type="submit" disabled={pending}>{pending ? "Logging in…" : "Log in"}</Button>
        </form>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}

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
          <p className="text-muted-foreground">Log in with your locally configured demo account to verify protected API access.</p>
        </div>
        <p role="status" aria-live="polite">{messages[health]}</p>
        <Button variant="outline" disabled={health === "checking"} onClick={() => setAttempt((value) => value + 1)}>
          Check again
        </Button>
        <DemoLogin />
      </section>
    </main>
  );
}
