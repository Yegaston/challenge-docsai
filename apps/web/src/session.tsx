import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

export type Session = { token: string; expiresAt: number; user?: { id: string; email: string; role: "customer" | "support" } };
export const sessionInvalidMessage = "Session invalid or expired. Log in again.";
export const sessionExpiredMessage = "Session expired. Log in again.";
type Credentials = { email: string; password: string };
type SessionContext = {
  session: Session | null; pending: boolean; restoring: boolean; error: string;
  login: (credentials: Credentials) => Promise<void>; logout: () => Promise<void>; retry: () => void; clear: (message?: string) => void;
  beginAnalysis: (ticketId: string, priorId: string | null) => void;
  clearAnalysis: (ticketId: string) => void;
  pendingAnalysis: (ticketId: string) => { pending: boolean; priorId: string | null; startedAt: number | null };
};
const Context = createContext<SessionContext | null>(null);
export function useSession() {
  const value = useContext(Context);
  if (!value) throw new Error("Session provider missing");
  return value;
}

function envelope(body: { token?: unknown; expiresAt?: unknown }): Session {
  if (typeof body?.token !== "string" || !body.token || typeof body.expiresAt !== "number"
    || !Number.isFinite(body.expiresAt) || body.expiresAt <= Date.now() || body.expiresAt > Date.now() + 900_000)
    throw new Error("Invalid session response");
  return { token: body.token, expiresAt: body.expiresAt };
}
function identity(body: { user?: Partial<NonNullable<Session["user"]>> }): NonNullable<Session["user"]> {
  const user = body?.user;
  if (!user || typeof user.id !== "string" || typeof user.email !== "string" || !["customer", "support"].includes(user.role ?? ""))
    throw new Error("Invalid identity response");
  return user as NonNullable<Session["user"]>;
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const current = useRef<Session | null>(null);
  const [pending, setPending] = useState(false);
  const [restoring, setRestoring] = useState(true);
  const [error, setError] = useState("");
  const active = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryCount = useRef(0);
  const refreshRef = useRef<() => Promise<void>>(async () => {});
  const mounted = useRef(true);
  const pendingAnalyses = useRef(new Map<string, { priorId: string | null; startedAt: number }>());
  const [analysisRevision, setAnalysisRevision] = useState(0);
  const beginAnalysis = useCallback((ticketId: string, priorId: string | null) => {
    pendingAnalyses.current.set(ticketId, { priorId, startedAt: Date.now() }); setAnalysisRevision((value) => value + 1);
  }, []);
  const clearAnalysis = useCallback((ticketId: string) => {
    pendingAnalyses.current.delete(ticketId); setAnalysisRevision((value) => value + 1);
  }, []);
  const pendingAnalysis = useCallback((ticketId: string) => ({
    pending: pendingAnalyses.current.has(ticketId), priorId: pendingAnalyses.current.get(ticketId)?.priorId ?? null,
    startedAt: pendingAnalyses.current.get(ticketId)?.startedAt ?? null,
  }), []);
  void analysisRevision;
  const invalidate = useCallback(() => {
    if (retryTimer.current) clearTimeout(retryTimer.current);
    retryTimer.current = null;
    generation.current++;
    active.current?.abort(); active.current = null;
  }, []);
  const clear = useCallback((message = "") => {
    invalidate(); retryCount.current = 0; current.current = null;
    pendingAnalyses.current.clear(); setAnalysisRevision((value) => value + 1);
    setSession(null); setPending(false); setRestoring(false); setError(message);
  }, [invalidate]);
  const start = useCallback(() => {
    invalidate();
    const controller = new AbortController(); active.current = controller;
    const version = generation.current;
    return { controller, live: () => mounted.current && generation.current === version && !controller.signal.aborted };
  }, [invalidate]);
  const refresh = useCallback(async () => {
    if (active.current || !mounted.current) return;
    const { controller, live } = start();
    const hadSession = current.current;
    const scheduleRetry = () => {
      if (hadSession && hadSession.expiresAt > Date.now() + 25_000 && retryCount.current < 3) {
        retryCount.current++;
        retryTimer.current = setTimeout(() => { retryTimer.current = null; void refreshRef.current(); }, 15_000);
      }
    };
    const timeout = setTimeout(() => { if (active.current === controller && mounted.current) {
      controller.abort(); active.current = null; setPending(false); setRestoring(false);
      if (!current.current || current.current.expiresAt <= Date.now()) { current.current = null; setSession(null); }
      setError("Unable to restore session. Try again."); scheduleRetry();
    } }, 10_000);
    setPending(true); setError("");
    try {
      const response = await fetch("/api/auth/refresh", { method: "POST", credentials: "include", signal: controller.signal, cache: "no-store" });
      if (!live()) return;
      if (response.status === 401) { clear(hadSession ? sessionInvalidMessage : ""); return; }
      if (!response.ok) throw new Error("Refresh unavailable");
      const next = envelope(await response.json());
      if (!live()) return;
      const me = await fetch("/api/auth/me", { headers: { Authorization: `Bearer ${next.token}` }, credentials: "omit", signal: controller.signal, cache: "no-store" });
      if (!live()) return;
      if (me.status === 401) { clear(sessionInvalidMessage); return; }
      if (!me.ok) throw new Error("Identity unavailable");
      const user = identity(await me.json());
      if (!live()) return;
      if (next.expiresAt <= Date.now()) throw new Error("Expired response");
      retryCount.current = 0;
      current.current = { ...next, user }; setSession(current.current); setError("");
    } catch {
      if (live() || (mounted.current && active.current === controller && !hadSession)) {
        if (!hadSession || hadSession.expiresAt <= Date.now()) { current.current = null; setSession(null); }
        setError("Unable to restore session. Try again.");
        scheduleRetry();
      }
    } finally {
      clearTimeout(timeout);
      if (active.current === controller && mounted.current) { active.current = null; setPending(false); setRestoring(false); }
    }
  }, [clear, start]);
  refreshRef.current = refresh;
  useEffect(() => {
    mounted.current = true;
    void refresh();
    return () => { mounted.current = false; invalidate(); };
  }, [refresh, invalidate]);
  const expiresAt = session?.expiresAt;
  useEffect(() => {
    if (!expiresAt) return;
    const remaining = expiresAt - Date.now();
    if (remaining <= 0) { if (current.current?.expiresAt === expiresAt) clear("Unable to restore session. Try again."); return; }
    const deadline = setTimeout(() => {
      if (current.current?.expiresAt === expiresAt) clear("Unable to restore session. Try again.");
    }, remaining);
    const proactive = remaining > 60_000
      ? setTimeout(() => { void refresh(); }, remaining - 60_000) : undefined;
    return () => { clearTimeout(deadline); clearTimeout(proactive); };
  }, [expiresAt, refresh, clear]);
  useEffect(() => {
    const resume = () => {
      if (document.visibilityState !== "visible" || !current.current) return;
      if (current.current.expiresAt <= Date.now()) {
        // Retire the stale deadline without aborting the new cookie-based restoration.
        current.current = null; setSession(null); setRestoring(true);
        if (active.current) invalidate();
        void refresh();
      } else if (current.current.expiresAt - Date.now() < 120_000) void refresh();
    };
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("focus", resume);
    return () => { document.removeEventListener("visibilitychange", resume); window.removeEventListener("focus", resume); };
  }, [refresh, invalidate]);
  const login = useCallback(async (credentials: Credentials) => {
    const { controller, live } = start();
    const timeout = setTimeout(() => { if (live()) { controller.abort(); setPending(false); setError("Authentication request timed out. Try again."); } }, 10_000);
    setPending(true); setError(""); setRestoring(false);
    let identityDeadline: ReturnType<typeof setTimeout> | undefined;
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(credentials),
        signal: controller.signal, credentials: "include", cache: "no-store",
      });
      if (!live()) return;
      if (!response.ok) { setError(response.status === 401 ? "Invalid email or password." : "Authentication unavailable. Try again."); return; }
      const next = envelope(await response.json());
      if (!live()) return;
      identityDeadline = setTimeout(() => { if (live()) clear(sessionExpiredMessage); }, Math.max(0, next.expiresAt - Date.now()));
      const responseMe = await fetch("/api/auth/me", {
        headers: { Authorization: `Bearer ${next.token}` }, signal: controller.signal, credentials: "omit", cache: "no-store",
      });
      if (!live()) return;
      if (responseMe.status === 401) { clear(sessionInvalidMessage); return; }
      if (!responseMe.ok) { setError("Authentication unavailable. Try again."); return; }
      const user = identity(await responseMe.json());
      if (!live()) return;
      if (next.expiresAt <= Date.now()) { clear(sessionExpiredMessage); return; }
      current.current = { ...next, user }; setSession(current.current);
    } catch { if (live()) setError("Unable to reach authentication service. Try again."); }
    finally { clearTimeout(timeout); clearTimeout(identityDeadline); if (active.current === controller && mounted.current) { active.current = null; setPending(false); } }
  }, [clear, start]);
  const logout = useCallback(async () => {
    const { controller, live } = start();
    setPending(true); setError("");
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await fetch("/api/auth/logout", { method: "POST", credentials: "include", signal: controller.signal, cache: "no-store" });
      if (!live()) return;
      if (response.status !== 204) throw new Error("Logout unavailable");
      clear();
    } catch { if (mounted.current && active.current === controller) setError("Unable to log out. Try again."); }
    finally { clearTimeout(timeout); if (active.current === controller && mounted.current) { active.current = null; setPending(false); } }
  }, [clear, start]);
  return <Context.Provider value={{ session, pending, restoring, error, login, logout, retry: () => { void refresh(); }, clear, beginAnalysis, clearAnalysis, pendingAnalysis }}>{children}</Context.Provider>;
}
