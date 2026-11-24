/**
 * AURA-ANDROID-REL-04 IR-03 -- the sign-out transition, shared by every
 * surface that signs out (Home today; anything later must use this too).
 *
 * Sequence:
 *  1. Single flight: a second call while one runs gets the same promise.
 *  2. beginTransition(): new activity writes and replays are refused, the
 *     running replay is aborted, other tabs see the marker and suspend.
 *  3. Wait (bounded) until no activity write is in flight, so the count in
 *     step 4 is the real pending work. Still busy -> resume, 'busy'.
 *  4. Count THIS account's unsynced entries plus quarantined legacy entries.
 *     Unreadable storage counts as "unknown" and is asked about too. If there
 *     is anything, ask; Cancel -> resume with everything kept.
 *  5. POST /api/auth/logout and require the exact acknowledgement:
 *     200, not redirected (redirect: 'error'), JSON, `{ loggedOut: true }`.
 *       - acknowledged      -> discard this account's queue (and the legacy
 *                              entries if they were part of the confirmed
 *                              question), end as signed out (new epoch);
 *       - definite failure  -> resume, keep everything ('failed');
 *       - ambiguous (network error, lost or malformed acknowledgement,
 *         unexpected 2xx/redirect) -> reconcile with GET /api/auth/session
 *         BEFORE anything authenticated resumes:
 *            same account  -> resume, keep queue ('failed');
 *            signed out    -> signed out, queue KEPT for its owner (logout
 *                             was never acknowledged) ('signed-out-unconfirmed');
 *            other account -> switch to it ('account-changed');
 *            unknown       -> re-verification required, nothing resumes
 *                             until a session answer arrives ('failed').
 *
 * Server-side revocation is out of scope here (AURA-AUTH-01).
 */
import { beginTransition, getVerifiedAccount, settleActivityOperations } from './accountSession';
import { clearLegacyQueue, clearOwnedQueue, legacyQueueCount, readOwnedQueue } from './offlineHabitQueue';

export type SignOutOutcome = 'signed-out' | 'signed-out-unconfirmed' | 'account-changed' | 'cancelled' | 'failed' | 'busy';

export interface SignOutDeps {
  fetch: typeof fetch;
  confirm: (message: string) => boolean;
  /** How long to wait for in-flight activity writes (ms). */
  settleTimeoutMs?: number;
}

export const SIGN_OUT_FAILED_MESSAGE = "Couldn't sign out. Check your connection and try again.";
export const SIGN_OUT_BUSY_MESSAGE = 'An activity is still being saved. Try signing out again in a moment.';

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
  return `You have ${parts.join(' and ')}. Signing out will remove ${p.owned! + p.legacy! === 1 ? 'it' : 'them'} from this device. Sign out anyway?`;
}

type Ack = 'acknowledged' | 'failed' | 'ambiguous';

async function requestLogout(fetchImpl: typeof fetch): Promise<Ack> {
  let res: Response;
  try {
    res = await fetchImpl('/api/auth/logout', {
      method: 'POST',
      redirect: 'error',
      cache: 'no-store',
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    });
  } catch {
    return 'ambiguous';
  }
  if (res.redirected || res.type === 'opaqueredirect') return 'ambiguous';
  if (res.status >= 400) return 'failed';
  if (res.status !== 200) return 'ambiguous';
  const type = res.headers?.get?.('content-type') ?? '';
  if (!/application\/json/i.test(type)) return 'ambiguous';
  try {
    const body = await res.json();
    return body && typeof body === 'object' && body.loggedOut === true ? 'acknowledged' : 'ambiguous';
  } catch {
    return 'ambiguous';
  }
}

async function reconcile(fetchImpl: typeof fetch, owner: string): Promise<'same' | 'signed-out' | { other: string } | 'unknown'> {
  try {
    const res = await fetchImpl('/api/auth/session', { cache: 'no-store', credentials: 'same-origin', redirect: 'error' });
    if (res.status !== 200) return 'unknown';
    const body = await res.json();
    if (!body || typeof body !== 'object' || !('user' in body)) return 'unknown';
    const id = body.user && typeof body.user === 'object' ? body.user.id : null;
    if (id === null || body.user === null) return 'signed-out';
    if (typeof id !== 'string') return 'unknown';
    return id === owner ? 'same' : { other: id };
  } catch {
    return 'unknown';
  }
}

let inFlight: Promise<SignOutOutcome> | null = null;

export function performSignOut(deps: SignOutDeps): Promise<SignOutOutcome> {
  if (inFlight) return inFlight;
  inFlight = run(deps).finally(() => { inFlight = null; });
  return inFlight;
}

async function run(deps: SignOutDeps): Promise<SignOutOutcome> {
  const owner = getVerifiedAccount();
  if (!owner) return 'failed';
  const transition = beginTransition();
  if (!transition) return 'busy';

  const idle = await settleActivityOperations(deps.settleTimeoutMs ?? 8000);
  if (!idle) { transition.end('resumed'); return 'busy'; }

  const ownedRead = readOwnedQueue(owner);
  const pending: PendingWork = { owned: ownedRead.ok ? ownedRead.items.length : null, legacy: legacyQueueCount() };
  const question = describePendingWork(pending);
  if (question && !deps.confirm(question)) { transition.end('resumed'); return 'cancelled'; }

  const ack = await requestLogout(deps.fetch);
  if (ack === 'acknowledged') {
    // Only now, after the user's confirmation and the server's acknowledgement.
    clearOwnedQueue(owner);
    if (question && pending.legacy !== 0) clearLegacyQueue();
    transition.end('signed-out');
    return 'signed-out';
  }
  if (ack === 'failed') { transition.end('resumed'); return 'failed'; }

  const r = await reconcile(deps.fetch, owner);
  if (r === 'same') { transition.end('resumed'); return 'failed'; }
  if (r === 'signed-out') { transition.end('signed-out'); return 'signed-out-unconfirmed'; }
  if (r === 'unknown') { transition.end('unknown'); return 'failed'; }
  transition.end({ switchedTo: r.other });
  return 'account-changed';
}

/** Test-only. */
export function __resetSignOutForTests() { inFlight = null; }
