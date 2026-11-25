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
import { AccountUnavailableError, EXPECTED_ACCOUNT_HEADER, captureAccountBinding, ensureVerifiedAccount, getVerifiedAccount, invalidateAccount, isTransitionActiveNow, reportUpgradeRequired, runActivityOperation, type AccountBinding } from './accountSession';
import { classifyApiRoute, SIGNED_OUT_ACCOUNT } from './accountRoutePolicy';

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

// ------------------------------------------------------------------ global wrapper (R3)

/** Same policy as the server (lib/accountRoutePolicy.ts): true for account-scoped or optional routes. */
export function isAccountScopedApiPath(pathname: string, method = 'GET'): boolean {
  return classifyApiRoute(pathname, method) !== 'exempt';
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

/**
 * Installs the client half of the shared account boundary ONCE per page
 * (from the root layout, so every surface -- Home, Goals, Captures, Connected
 * Apps, plan-day, /find -- is covered without depending on which page is
 * mounted). For every same-origin request to an ACCOUNT-SCOPED route:
 *   - during an auth transition (this tab or another -- the held Web Lock is
 *     consulted, not only the storage marker) it is refused
 *     (AccountUnavailableError 'transition');
 *   - while the account is unknown, it is held until one shared session
 *     verification completes; if that fails it is refused ('unverified')
 *     and NOT forwarded;
 *   - it states the verified account, or "signed out", so the server refuses
 *     it if the session belongs to anyone else;
 *   - mutations are tracked, so sign-out aborts them and waits for them;
 *   - a 409 account_mismatch invalidates the account (the UI re-verifies);
 *     a 503 client_upgrade_required raises the reload prompt.
 * OPTIONAL routes (telemetry) state the account when known and are never held.
 * EXEMPT routes and other origins pass unchanged. An explicit
 * X-Aura-Expected-Account set by a bound caller always wins.
 */
export function installAccountBoundFetch(): void {
  if (installed || typeof window === 'undefined' || typeof window.fetch !== 'function') return;
  installed = true;
  const original = window.fetch.bind(window);
  const wrapped = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    const path = pathOf(input);
    const method = String(init.method ?? (typeof input === 'object' && 'method' in (input as Request) ? (input as Request).method : 'GET')).toUpperCase();
    const cls = path ? classifyApiRoute(path, method) : 'exempt';
    if (!path || cls === 'exempt') return original(input, init);
    const headers = new Headers(init.headers ?? (typeof input === 'object' && 'headers' in (input as Request) ? (input as Request).headers : undefined));
    const explicit = headers.has(EXPECTED_ACCOUNT_HEADER);

    const after = async (res: Response) => {
      if (res.status === 409 || res.status === 503) {
        const body = await res.clone().json().catch(() => null);
        if (body?.code === 'account_mismatch') invalidateAccount();
        if (body?.code === 'client_upgrade_required') reportUpgradeRequired();
      }
      return res;
    };
    const send = async (account: string | null | undefined, signal?: AbortSignal | null) => {
      if (!explicit && account !== undefined) headers.set(EXPECTED_ACCOUNT_HEADER, account === null ? SIGNED_OUT_ACCOUNT : account);
      return after(await original(input, { ...init, headers, signal: signal ?? init.signal }));
    };

    if (explicit) return send(undefined); // a bound caller (boundFetch / activitySync) already tracks it

    if (cls === 'optional') {
      const a = getVerifiedAccount();
      return send(a === undefined ? undefined : a);
    }

    if (await isTransitionActiveNow()) throw new AccountUnavailableError('transition');
    const account = await ensureVerifiedAccount((i, n) => original(i, n));
    if (account === undefined) throw new AccountUnavailableError('unverified');
    if (await isTransitionActiveNow()) throw new AccountUnavailableError('transition');

    const isMutation = method !== 'GET' && method !== 'HEAD';
    if (isMutation && typeof account === 'string') {
      const binding = captureAccountBinding();
      return runActivityOperation((lease) => send(lease.account, combine(lease.signal, init.signal)), binding);
    }
    return send(account);
  };
  window.fetch = wrapped as typeof window.fetch;
  try { (globalThis as { fetch?: typeof fetch }).fetch = wrapped as typeof fetch; } catch { /* read-only global */ }
}

/** Test-only. */
export function __resetAccountBoundFetchForTests() {
  installed = false;
}
