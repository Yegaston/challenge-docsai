import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

export type Session = { token: string; expiresAt: number; user?: { id: string; email: string; role: "customer" | "support" } };
export const sessionInvalidMessage = "Session invalid or expired. Log in again.";
export const sessionExpiredMessage = "Session expired. Log in again.";
type Credentials = { email: string; password: string };
type SessionContext = {
  session: Session | null; pending: boolean; error: string;
  login: (credentials: Credentials) => Promise<void>; logout: () => void; clear: (message?: string) => void;
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

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const active = useRef<AbortController | null>(null);
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
  const clear = useCallback((message = "") => {
    active.current?.abort(); active.current = null;
    pendingAnalyses.current.clear(); setAnalysisRevision((value) => value + 1);
    setSession(null); setPending(false); setError(message);
  }, []);
  useEffect(() => () => { active.current?.abort(); }, []);
  const expiresAt = session?.expiresAt;
  useEffect(() => {
    if (!expiresAt) return;
    const timer = setTimeout(() => clear(sessionExpiredMessage), Math.max(0, expiresAt - Date.now()));
    return () => clearTimeout(timer);
  }, [expiresAt, clear]);

  const login = useCallback(async (credentials: Credentials) => {
    active.current?.abort();
    const controller = new AbortController(); active.current = controller;
    const live = () => active.current === controller && !controller.signal.aborted;
    const timeout = setTimeout(() => {
      if (!live()) return;
      controller.abort(); setPending(false); setError("Authentication request timed out. Try again.");
    }, 10_000);
    setPending(true); setError("");
    let identityDeadline: ReturnType<typeof setTimeout> | undefined;
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(credentials),
        signal: controller.signal, credentials: "omit", cache: "no-store",
      });
      if (!live()) return;
      if (!response.ok) {
        setError(response.status === 401 ? "Invalid email or password." : "Authentication unavailable. Try again.");
        return;
      }
      const body = await response.json();
      if (!live()) return;
      if (typeof body?.token !== "string" || !body.token || !Number.isFinite(body.expiresAt)
        || body.expiresAt <= Date.now() || body.expiresAt > Date.now() + 900_000) throw new Error("Invalid login response");
      const next: Session = { token: body.token, expiresAt: body.expiresAt };
      identityDeadline = setTimeout(() => { if (live()) clear(sessionExpiredMessage); }, Math.max(0, next.expiresAt - Date.now()));
      const identity = await fetch("/api/auth/me", {
        headers: { Authorization: `Bearer ${next.token}` }, signal: controller.signal, credentials: "omit", cache: "no-store",
      });
      if (!live()) return;
      if (identity.status === 401) { clear(sessionInvalidMessage); return; }
      if (!identity.ok) { setError("Authentication unavailable. Try again."); return; }
      const user = await identity.json();
      if (!live()) return;
      if (next.expiresAt <= Date.now()) { clear(sessionExpiredMessage); return; }
      if (typeof user?.user?.id !== "string" || typeof user?.user?.email !== "string" || !["customer", "support"].includes(user?.user?.role)) throw new Error("Invalid identity response");
      setSession({ ...next, user: { id: user.user.id, email: user.user.email, role: user.user.role } });
    } catch {
      if (live()) setError("Unable to reach authentication service. Try again.");
    } finally {
      clearTimeout(timeout);
      clearTimeout(identityDeadline);
      if (live()) setPending(false);
    }
  }, [clear]);
  return <Context.Provider value={{ session, pending, error, login, logout: () => clear(), clear, beginAnalysis, clearAnalysis, pendingAnalysis }}>{children}</Context.Provider>;
}
