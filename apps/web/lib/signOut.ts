/**
 * AURA-ANDROID-REL-04 IR-03 (R2) -- the sign-out transition, shared by every
 * surface that signs out.
 *
 * Sequence (every network stage is bounded; nothing can hang):
 *  1. One flight per tab; ONE auth transition per browser (withAuthLock:
 *     Web Locks, or the storage-marker fallback). Another tab already
 *     signing in or out -> 'busy'.
 *  2. beginTransition(): bound writes and replays are refused here and in
 *     other tabs; running ones are aborted.
 *  3. Wait (bounded) until no bound operation is in flight. Unresolved
 *     activity writes are already in their account's queue (outbox), so the
 *     count in step 4 includes them. Still busy -> nothing was sent: 'busy'.
 *  4. SNAPSHOT this account's queue keys plus the quarantined legacy entries.
 *     Unreadable storage counts as "unknown". If anything (or unknown), ask;
 *     Cancel -> 'cancelled', account unchanged (nothing reached the server).
 *  5. POST /api/auth/logout bound to the account (X-Aura-Expected-Account),
 *     redirect:'error', no-store, within LOGOUT_TIMEOUT_MS including the body.
 *     Acknowledged ONLY by: status 200, not redirected, media type exactly
 *     application/json, body exactly an object with `loggedOut === true`.
 *       acknowledged -> discard EXACTLY the confirmed snapshot (never entries
 *                       added later), verify each removal, end signed out.
 *                       Removal that failed is reported ('signed-out' with
 *                       discardFailed > 0), never claimed as removed.
 *       anything else (network error, timeout, any HTTP status, malformed or
 *       unexpected answer) is AMBIGUOUS -- a 4xx/5xx from an intermediary is
 *       not proof the session is unchanged -- and is reconciled with a fresh,
 *       strictly-parsed, bounded GET /api/auth/session:
 *            same account  -> 'failed', resumed only on that fresh answer;
 *            signed out    -> 'signed-out-unconfirmed', queue KEPT;
 *            other account -> 'account-changed';
 *            unavailable   -> 'unverified': account UNVERIFIED, all bound
 *                             work refused, queue kept, UI offers Retry.
 *
 * Server-side revocation is out of scope here (AURA-AUTH-01).
 */
import {
  DEADLINE,
  EXPECTED_ACCOUNT_HEADER,
  beginTransition,
  boundedExchange,
  getVerifiedAccount,
  isJsonMediaType,
  readSessionAnswer,
  settleActivityOperations,
  withAuthLock,
} from './accountSession';
import { clearLegacyQueue, legacyQueueCount, readOwnedQueue, removeKeys } from './offlineHabitQueue';

export type SignOutOutcome =
  | 'signed-out'
  | 'signed-out-unconfirmed'
  | 'account-changed'
  | 'cancelled'
  | 'failed'
  | 'busy'
  | 'unverified';

export interface SignOutResult {
  outcome: SignOutOutcome;
  /** Confirmed-discard entries that could not be removed from this device (still queued for the signed-out account). */
  discardFailed: number;
}

export interface SignOutDeps {
  fetch: typeof fetch;
  confirm: (message: string) => boolean;
  settleTimeoutMs?: number;
  logoutTimeoutMs?: number;
  reconcileTimeoutMs?: number;
}

export const LOGOUT_TIMEOUT_MS = 10_000;
export const RECONCILE_TIMEOUT_MS = 10_000;
export const SIGN_OUT_FAILED_MESSAGE = "Couldn't sign out. Check your connection and try again.";
export const SIGN_OUT_BUSY_MESSAGE = 'Something is still being saved, or another window is signing in or out. Try again in a moment.';
export const SIGN_OUT_UNVERIFIED_MESSAGE = "Aura couldn't confirm whether you're signed out. Your unsynced activity is kept. Check your connection and tap Retry.";
export function discardFailedMessage(n: number): string {
  return `You're signed out, but ${n === 1 ? '1 unsynced activity log' : `${n} unsynced activity logs`} couldn't be removed from this device. ${n === 1 ? 'It' : 'They'} will only sync if you sign in to the same account again.`;
}

export interface PendingWork {
  owned: number | null; // null = unreadable
  legacy: number | null;
}

export function describePendingWork(p: PendingWork): string | null {
  const parts: string[] = [];
  if (p.owned === null || p.legacy === null) {
    return "Aura couldn't check this device for activity logs that haven't synced yet. If there are any, signing out will remove them. Sign out anyway?";
  }
  if (p.owned > 0) parts.push(p.owned === 1 ? '1 activity log that has not synced yet' : `${p.owned} activity logs that have not synced yet`);
  if (p.legacy > 0) parts.push(p.legacy === 1 ? '1 older unsynced log saved before an update, which cannot be synced safely' : `${p.legacy} older unsynced logs saved before an update, which cannot be synced safely`);
  if (parts.length === 0) return null;
  const total = p.owned + p.legacy;
  return `You have ${parts.join(' and ')} (some may already have been saved). Signing out will remove ${total === 1 ? 'it' : 'them'} from this device. Sign out anyway?`;
}

type Ack = 'acknowledged' | 'ambiguous';

export async function readLogoutAck(res: Response): Promise<boolean> {
  if (res.status !== 200 || res.redirected || res.type === 'opaqueredirect') return false;
  if (!isJsonMediaType(res.headers?.get?.('content-type'))) return false;
  let body: unknown;
  try { body = await res.json(); } catch { return false; }
  return Boolean(body && typeof body === 'object' && !Array.isArray(body) && (body as { loggedOut?: unknown }).loggedOut === true);
}

async function requestLogout(fetchImpl: typeof fetch, owner: string, ms: number): Promise<Ack> {
  try {
    const r = await boundedExchange(fetchImpl, '/api/auth/logout', {
      method: 'POST',
      redirect: 'error',
      cache: 'no-store',
      credentials: 'same-origin',
      headers: { Accept: 'application/json', [EXPECTED_ACCOUNT_HEADER]: owner },
    }, ms, readLogoutAck);
    return r === true ? 'acknowledged' : 'ambiguous';
  } catch {
    return 'ambiguous';
  }
}

async function reconcile(fetchImpl: typeof fetch, owner: string, ms: number): Promise<'same' | 'signed-out' | { other: string } | 'unknown'> {
  try {
    const r = await boundedExchange(fetchImpl, '/api/auth/session', { cache: 'no-store', credentials: 'same-origin', redirect: 'error' }, ms, readSessionAnswer);
    if (r === DEADLINE || r === null) return 'unknown';
    if (r.kind === 'none') return 'signed-out';
    return r.id === owner ? 'same' : { other: r.id };
  } catch {
    return 'unknown';
  }
}

let inFlight: Promise<SignOutResult> | null = null;

export function performSignOut(deps: SignOutDeps): Promise<SignOutResult> {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    const r = await withAuthLock(() => run(deps));
    return r ?? { outcome: 'busy' as const, discardFailed: 0 };
  })().finally(() => { inFlight = null; });
  return inFlight;
}

async function run(deps: SignOutDeps): Promise<SignOutResult> {
  const done = (outcome: SignOutOutcome, discardFailed = 0): SignOutResult => ({ outcome, discardFailed });
  const owner = getVerifiedAccount();
  if (typeof owner !== 'string') return done(owner === undefined ? 'unverified' : 'failed');
  const transition = beginTransition('signing-out');
  if (!transition) return done('busy');

  const idle = await settleActivityOperations(deps.settleTimeoutMs ?? 8000);
  if (!idle) { transition.end('resumed'); return done('busy'); }

  const snapshot = readOwnedQueue(owner);
  const legacy = legacyQueueCount();
  const pending: PendingWork = { owned: snapshot.ok ? snapshot.items.length : null, legacy };
  const question = describePendingWork(pending);
  if (question && !deps.confirm(question)) { transition.end('resumed'); return done('cancelled'); }

  const ack = await requestLogout(deps.fetch, owner, deps.logoutTimeoutMs ?? LOGOUT_TIMEOUT_MS);
  if (ack === 'acknowledged') {
    let failed = 0;
    if (snapshot.ok) failed += removeKeys(snapshot.keys).failed;
    if (question && pending.legacy !== 0 && !clearLegacyQueue()) failed += Math.max(1, pending.legacy ?? 1);
    transition.end('signed-out');
    return done('signed-out', failed);
  }

  const r = await reconcile(deps.fetch, owner, deps.reconcileTimeoutMs ?? RECONCILE_TIMEOUT_MS);
  if (r === 'same') { transition.end('resumed-verified'); return done('failed'); }
  if (r === 'signed-out') { transition.end('signed-out'); return done('signed-out-unconfirmed'); }
  if (r === 'unknown') { transition.end('unknown'); return done('unverified'); }
  transition.end({ switchedTo: r.other });
  return done('account-changed');
}

/** Test-only. */
export function __resetSignOutForTests() { inFlight = null; }
