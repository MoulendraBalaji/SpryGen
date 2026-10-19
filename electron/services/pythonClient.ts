/**
 * Typed client for the local Python FastAPI backend.
 *
 * The backend binds loopback on a random per-launch port and requires a
 * per-launch bearer token on every request. Only the Electron main process may
 * talk to it; the URL/token are injected here at startup (see `main.ts`).
 *
 * Every call resolves to an explicit result — there is no silent `null`.
 */

export type ProxyResult<T> =
  | { ok: true; data: T }
  | { ok: false; code: string; message: string };

let baseUrl = "";
let token = "";

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Inject the loopback URL and per-launch token the backend is listening for. */
export function configurePythonBackend(opts: { baseUrl: string; token: string }): void {
  baseUrl = opts.baseUrl.replace(/\/+$/, "");
  token = opts.token;
}

export function getPythonBaseUrl(): string {
  return baseUrl;
}

export function isPythonConfigured(): boolean {
  return baseUrl.length > 0;
}

/**
 * Proxy a JSON call to the local Python backend.
 *
 * Resolves to an explicit result: `{ ok: true, data }` on success, otherwise
 * `{ ok: false, code, message }` (not configured, unreachable, timeout, non-2xx,
 * or a malformed body). Callers never receive a silent `null`.
 */
export async function proxyToPython<T = unknown>(
  endpoint: string,
  options: RequestInit = {},
  timeoutMs = 30_000
): Promise<ProxyResult<T>> {
  if (!baseUrl) {
    return { ok: false, code: "NOT_CONFIGURED", message: "Python backend has not started yet" };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const resp = await fetch(`${baseUrl}${endpoint}`, {
      ...options,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        ...(options.headers ?? {}),
      },
    });

    if (!resp.ok) {
      let code = `HTTP_${resp.status}`;
      let message = `Python backend returned ${resp.status}`;
      try {
        const body: any = await resp.json();
        if (body && typeof body.code === "string") code = body.code;
        if (body && typeof body.message === "string") message = body.message;
      } catch {
        /* non-JSON error body — keep the defaults */
      }
      return { ok: false, code, message };
    }

    try {
      return { ok: true, data: (await resp.json()) as T };
    } catch (err) {
      return { ok: false, code: "BAD_RESPONSE", message: `Malformed JSON from Python backend: ${messageOf(err)}` };
    }
  } catch (err) {
    const aborted = err instanceof Error && err.name === "AbortError";
    return {
      ok: false,
      code: aborted ? "TIMEOUT" : "UNREACHABLE",
      message: aborted
        ? `Python backend timed out after ${timeoutMs}ms`
        : `Python backend unreachable: ${messageOf(err)}`,
    };
  } finally {
    clearTimeout(timer);
  }
}

/** GET /health — used for readiness polling and the health monitor. */
export function probePythonHealth(
  timeoutMs = 1500
): Promise<ProxyResult<{ status?: string; agents?: string[] }>> {
  return proxyToPython<{ status?: string; agents?: string[] }>("/health", {}, timeoutMs);
}
