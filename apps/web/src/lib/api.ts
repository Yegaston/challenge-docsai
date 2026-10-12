import type { Session } from "@/session";
export type ApiResult = { status: number; body?: Record<string, unknown> };
export async function callApi(session: Pick<Session, "token">, path: string, options: {
  method?: string; body?: Record<string, unknown>; signal?: AbortSignal;
} = {}): Promise<ApiResult> {
  try {
    const response = await fetch(path, {
      method: options.method ?? "GET",
      headers: { Authorization: `Bearer ${session.token}`, ...(options.body === undefined ? {} : { "Content-Type": "application/json" }) },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal, credentials: "omit", cache: "no-store",
    });
    let body: unknown;
    try { body = await response.json(); } catch { body = undefined; }
    return { status: response.status, body: body && typeof body === "object" ? body as Record<string, unknown> : undefined };
  } catch { return { status: 0 }; }
}
