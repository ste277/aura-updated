/**
 * AURA-ANDROID-REL-04 IR-01 / IR-03 (R2) -- account binding for HTTP calls.
 *
 * 1. boundFetch(binding, url, init): a write bound to the account the user
 *    acted under. Refused if that binding is no longer current; sends
 *    X-Aura-Expected-Account; carries the lease's abort signal into the real
 *    request (and any caller signal); a completion that arrives after the
 *    account changed is reported as StaleAccountCompletionError so no screen
 *    shows the old action's result in the new account's context.
 *
 * 2. installAccountBoundFetch(): wraps window.fetch ONCE so that every other
 *    same-origin /api request made by the app
 *      - states the verified account (reads and writes), so the server
 *        (middleware.ts) refuses a request whose session belongs to someone
 *        else -- including account-sensitive dashboard reads sent after an
 *        unrecognized cookie change;
 *      - for mutations (POST/PATCH/PUT/DELETE): is refused during an auth
 *        transition and tracked, so sign-out waits for it (suspension and
 *        settling for existing plan and activity mutations);
 *      - on a 409 account_mismatch answer, invalidates the verified account so
 *        the UI re-verifies instead of showing data for the wrong account.
 *    Auth, guest, public and telemetry endpoints are left untouched, and an
 *    explicit expected-account header set by a caller always wins.
 */
import { EXPECTED_ACCOUNT_HEADER, captureAccountBinding, getVerifiedAccount, invalidateAccount, runActivityOperation, type AccountBinding } from './accountSession';

export class StaleAccountCompletionError extends Error {
  constructor() {
    super('Your account changed while this was saving. Check the original account for the result.');
    this.name = 'StaleAccountCompletionError';
  }
}

export { captureAccountBinding };
export type { AccountBinding };

function combine(a: AbortSignal, b?: AbortSignal | null): AbortSignal {
  if (!b) return a;
  const c = new AbortController();
  const abort = () => c.abort();
  if (a.aborted || b.aborted) c.abort();
  a.addEventListener('abort', abort, { once: true });
  b.addEventListener('abort', abort, { once: true });
  return c.signal;
}

/** A write bound to `binding` (captured when the user acted). */
export async function boundFetch(binding: AccountBinding, input: string, init: RequestInit = {}, fetchImpl: typeof fetch = (i, n) => fetch(i, n)): Promise<Response> {
  return runActivityOperation(async (lease) => {
    const headers = new Headers(init.headers ?? {});
    headers.set(EXPECTED_ACCOUNT_HEADER, lease.account);
    const res = await fetchImpl(input, { ...init, headers, credentials: 'same-origin', signal: combine(lease.signal, init.signal) });
    if (!lease.isCurrent()) throw new StaleAccountCompletionError();
    return res;
  }, binding);
}

// ------------------------------------------------------------------ global wrapper

// Sign-in/out, guest discovery, telemetry, location lookup, health/internal and MCP
// endpoints are not account-bound by this wrapper.
const UNBOUND_PREFIXES = ['/api/auth/', '/api/guest/', '/api/product-events', '/api/location/', '/api/health', '/api/internal/', '/api/mcp'];

export function isAccountScopedApiPath(pathname: string): boolean {
  if (!pathname.startsWith('/api/')) return false;
  return !UNBOUND_PREFIXES.some((p) => pathname === p.replace(/\/$/, '') || pathname.startsWith(p));
}

function pathOf(input: RequestInfo | URL): string | null {
  try {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
    const base = typeof window !== 'undefined' && window.location ? window.location.href : 'http://localhost/';
    const u = new URL(raw, base);
    if (typeof window !== 'undefined' && window.location && u.origin !== window.location.origin) return null;
    return u.pathname;
  } catch {
    return null;
  }
}

let installed = false;

export function installAccountBoundFetch(): void {
  if (installed || typeof window === 'undefined' || typeof window.fetch !== 'function') return;
  installed = true;
  const original = window.fetch.bind(window);
  const wrapped = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    const path = pathOf(input);
    if (!path || !isAccountScopedApiPath(path)) return original(input, init);
    const method = String(init.method ?? (typeof input === 'object' && 'method' in (input as Request) ? (input as Request).method : 'GET')).toUpperCase();
    const headers = new Headers(init.headers ?? (typeof input === 'object' && 'headers' in (input as Request) ? (input as Request).headers : undefined));
    const explicit = headers.has(EXPECTED_ACCOUNT_HEADER);
    const account = getVerifiedAccount();

    const send = async (signal?: AbortSignal | null, accountForHeader?: string) => {
      if (accountForHeader && !explicit) headers.set(EXPECTED_ACCOUNT_HEADER, accountForHeader);
      const res = await original(input, { ...init, headers, signal: signal ?? init.signal });
      if (res.status === 409) {
        const body = await res.clone().json().catch(() => null);
        if (body?.code === 'account_mismatch') invalidateAccount();
      }
      return res;
    };

    if (method === 'GET' || method === 'HEAD') {
      return send(undefined, typeof account === 'string' ? account : undefined);
    }
    if (explicit) return send(); // a bound caller (boundFetch / activitySync) already tracks it
    if (typeof account !== 'string') return send(); // signed out / unverified: server decides (401/428/503)
    // Refused (AccountUnavailableError) during an auth transition.
    const binding = captureAccountBinding();
    return runActivityOperation((lease) => send(combine(lease.signal, init.signal), lease.account), binding);
  };
  window.fetch = wrapped as typeof window.fetch;
  try { (globalThis as { fetch?: typeof fetch }).fetch = wrapped as typeof fetch; } catch { /* read-only global */ }
}

/** Test-only. */
export function __resetAccountBoundFetchForTests() {
  installed = false;
}
