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
 *  4. SNAPSHOT this account's queued records (IndexedDB). Unreadable storage
 *     counts as "unknown". If anything (or unknown), ask; Cancel ->
 *     'cancelled', account unchanged (nothing reached the server). Legacy
 *     (unowned, pre-update) entries are NOT part of the discard (R4): they
 *     are counted and reported separately, and kept.
 *  5. POST /api/auth/logout bound to the account (X-Aura-Expected-Account),
 *     redirect:'error', no-store, within LOGOUT_TIMEOUT_MS including the body.
 *     Acknowledged ONLY by: status 200, not redirected, media type exactly
 *     application/json, body exactly an object with `loggedOut === true`.
 *       acknowledged -> discard EXACTLY the confirmed records in one
 *                       transaction (never entries added later; never one a
 *                       context is sending at that moment -- kept and
 *                       reported); records already sent are removed but
 *                       reported as possibly saved (a local discard never
 *                       undoes what the server accepted). Every count is
 *                       what the transaction observed.
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
  getTabId,
  getVerifiedAccount,
  isJsonMediaType,
  readSessionAnswer,
  settleActivityOperations,
  withAuthLock,
} from './accountSession';
import { discardOwned, readLegacySnapshot, readOwnedQueue } from './offlineHabitQueue';

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
  /** OWNED entries of the signed-out account (only set for 'signed-out'). */
  owned?: OwnedDiscardReport;
  /** LEGACY (unowned, pre-update) entries: never removed by sign-out; count kept on this device (null = unreadable). */
  legacyKept?: number | null;
}

export interface OwnedDiscardReport {
  /** The owned queue could not be read: nothing was confirmed or removed; whatever is stored stays for that account. */
  unknown: boolean;
  removed: number;
  /** Of `removed`: already handed to the network, so they may have been sent (and saved). */
  removedPossiblySent: number;
  /** Being sent by another window at that moment: kept for that account. */
  keptInFlight: number;
  /** Could not be removed (storage failure): still stored for that account. */
  failed: number;
  /** R9: discarded (will never be sent) but a copy could not be deleted from this device's storage. */
  cleanupPending?: number;
  /** R10: of `cleanupPending`: already handed to the network (may have been sent and saved). */
  cleanupPendingPossiblySent?: number;
  /** R10: NOT discarded because its identity could not be established safely; kept (paused, never sent by Aura). */
  unidentified?: number;
  /** R11: the discard's outcome could not be established. */
  uncertain?: number;
  /** R13: discarded (never sent again) but whether a copy remains on this device could not be checked. */
  discardedUnverified?: number;
  /** R13: of `discardedUnverified`: it had been handed to the network. */
  discardedUnverifiedPossiblySent?: number;
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
export const SIGN_OUT_UNCONFIRMED_MESSAGE = "You're signed out on this device. Aura couldn't get the server's confirmation, so this account's unsynced activity was kept on this device; it will only sync if you sign in to the same account again.";
export const SIGN_OUT_ACCOUNT_CHANGED_MESSAGE = "A different account is now signed in on this device (from another window). Aura is showing that account; nothing was removed.";

/**
 * R4 -- the ONE user-facing statement of what sign-out did, for every outcome
 * (null only for 'cancelled', and for a clean 'signed-out' with nothing to report).
 */
export function signOutOutcomeMessage(r: SignOutResult): string | null {
  switch (r.outcome) {
    case 'signed-out': return discardOutcomeMessage(r);
    case 'signed-out-unconfirmed': return SIGN_OUT_UNCONFIRMED_MESSAGE;
    case 'account-changed': return SIGN_OUT_ACCOUNT_CHANGED_MESSAGE;
    case 'failed': return SIGN_OUT_FAILED_MESSAGE;
    case 'busy': return SIGN_OUT_BUSY_MESSAGE;
    case 'unverified': return SIGN_OUT_UNVERIFIED_MESSAGE;
    case 'cancelled': return null;
  }
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many.replace('#', String(n)));

/**
 * R5 -- what happened to this device's unsynced activity, from the counts the
 * discard transaction actually OBSERVED, in separate statements: entries
 * removed; entries possibly sent (may be saved); entries retained (still being
 * sent elsewhere, or a storage error); unreadable/uncertain entries; observed
 * unowned legacy entries. null = nothing to report.
 */
export function discardOutcomeMessage(r: SignOutResult): string | null {
  if (r.outcome !== 'signed-out') return null;
  const parts: string[] = [];
  const o = r.owned;
  if (o) {
    if (o.unknown) {
      parts.push("Aura couldn't read this account's unsynced activity on this device, so none of it was removed. Whatever is stored is kept on this device and syncs only if you sign in to the same account again.");
    } else {
      if (o.removed > 0) parts.push(`${plural(o.removed, '1 unsynced activity log was', '# unsynced activity logs were')} removed from this device.`);
      // R10: "possibly sent" is stated only for the activities of THIS category.
      if (o.removed > 0 && o.removedPossiblySent > 0) parts.push(`${o.removedPossiblySent === o.removed ? (o.removed === 1 ? 'It' : 'They') : `${o.removedPossiblySent} of them`} may already have been sent, so ${o.removedPossiblySent === 1 ? 'it' : 'they'} may be saved to your account; removing ${o.removedPossiblySent === 1 ? 'it' : 'them'} here doesn't undo that.`);
      const kept = o.keptInFlight + o.failed;
      if (kept > 0) {
        const why: string[] = [];
        // R12: a claim may be taken before the network call starts -- never claim it is already on its way.
        if (o.keptInFlight > 0) why.push(`${o.keptInFlight} still being sent, or about to be sent, from another window`);
        if (o.failed > 0) why.push(`${o.failed} couldn't be discarded because of a storage error`);
        // R11: no claim about later syncing -- a kept log may be paused; nothing about it was decided here.
        parts.push(`${plural(kept, '1 activity log was', '# activity logs were')} kept on this device for this account (${why.join('; ')}); nothing about ${kept === 1 ? 'it' : 'them'} was changed, and Aura will ask again the next time you sign out of this account.`);
      }
      const du = o.discardedUnverified ?? 0;
      if (du > 0) parts.push(`${plural(du, '1 activity log was', '# activity logs were')} discarded and will never be sent; Aura couldn't check whether ${du === 1 ? 'a copy of it remains' : 'copies of them remain'} on this device.`);
      const dus = o.discardedUnverifiedPossiblySent ?? 0;
      if (du > 0 && dus > 0) parts.push(`${dus === du ? (du === 1 ? 'It' : 'They') : `${dus} of those`} may already have been sent, so ${dus === 1 ? 'it' : 'they'} may be saved to your account; discarding ${dus === 1 ? 'it' : 'them'} here doesn't undo that.`);
      const unc = o.uncertain ?? 0;
      if (unc > 0) parts.push(`Aura couldn't confirm whether ${plural(unc, '1 activity log was', '# activity logs were')} discarded; ${unc === 1 ? 'it' : 'they'} may still be on this device for this account.`);
      const cp = o.cleanupPending ?? 0;
      if (cp > 0) parts.push(`${plural(cp, '1 activity log was', '# activity logs were')} discarded and will never be sent, but Aura couldn't delete ${cp === 1 ? 'its copy' : 'their copies'} from this device's storage.`);
      const cps = o.cleanupPendingPossiblySent ?? 0;
      if (cp > 0 && cps > 0) parts.push(`${cps === cp ? (cp === 1 ? 'It' : 'They') : `${cps} of those`} may already have been sent, so ${cps === 1 ? 'it' : 'they'} may be saved to your account; discarding ${cps === 1 ? 'it' : 'them'} here doesn't undo that.`);
      const un = o.unidentified ?? 0;
      if (un > 0) parts.push(`${plural(un, '1 activity log', '# activity logs')} from an earlier test version of Aura couldn't be identified safely, so ${un === 1 ? 'it was' : 'they were'} kept on this device (paused; Aura won't send ${un === 1 ? 'it' : 'them'}).`);
    }
  }
  if (r.legacyKept === null) parts.push("Aura couldn't check this device for activity logs from an earlier version; any there were left in place.");
  else if (r.legacyKept && r.legacyKept > 0) parts.push(`${plural(r.legacyKept, '1 activity log', '# activity logs')} from an earlier version of Aura (not linked to any account) ${r.legacyKept === 1 ? 'was' : 'were'} seen on this device and left in place.`);
  return parts.length ? `You're signed out. ${parts.join(' ')}` : null;
}

export interface PendingWork {
  owned: number | null; // null = unreadable
  /** Of `owned`: already sent at least once (may have been saved). */
  ownedSent?: number;
  /** R8: of `owned`: paused -- kept on this device, never synced automatically. */
  paused?: number;
}

/**
 * R5 -- the confirmation question for OWNED entries. It never promises an
 * outcome the discard has not established: unreadable entries are KEPT (that
 * is what happens), and readable ones are removed only as far as the discard
 * succeeds (entries another window is sending are kept) -- the result is
 * reported afterwards. Legacy entries are not removed by sign-out, so not asked about.
 */
export function describePendingWork(p: PendingWork): string | null {
  if (p.owned === null) {
    return "Aura couldn't read this device's unsynced activity for this account. If you sign out, anything stored will be kept on this device (not removed) and will sync only if you sign in to this account again. Sign out?";
  }
  if (p.owned === 0) return null;
  const sent = p.ownedSent ?? 0;
  const what = p.owned === 1 ? '1 activity log that has not synced yet' : `${p.owned} activity logs that have not synced yet`;
  const paused = p.paused ?? 0;
  const notes: string[] = [];
  if (sent > 0) notes.push(`${sent === p.owned ? (p.owned === 1 ? 'it' : 'they') : `${sent} of them`} may already have been sent, so removing ${sent === 1 ? 'it' : 'them'} here won't undo that`);
  if (paused > 0) notes.push(`${paused === p.owned ? (p.owned === 1 ? 'it is' : 'they are') : `${paused} of them ${paused === 1 ? 'is' : 'are'}`} paused legacy activity that won't sync automatically`);
  const note = notes.length ? ` (${notes.join('; ')})` : '';
  return `You have ${what}${note}. If you sign out, Aura will remove ${p.owned === 1 ? 'it' : 'them'} from this device where it can and tell you the result; anything another window is still sending is kept. Sign out?`;
}

type Ack = 'acknowledged' | 'ambiguous' | 'unsettled';

const UNSETTLED = Symbol('unsettled');
export async function readLogoutAck(res: Response): Promise<boolean | typeof UNSETTLED> {
  if (res.status === 503 && isJsonMediaType(res.headers?.get?.('content-type'))) {
    // R5: the service worker did not send this sign-out behind an unsettled auth request.
    try { if ((await res.clone().json())?.code === 'auth_transition_unsettled') return UNSETTLED; } catch { /* fall through */ }
  }
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
    if (r === UNSETTLED) return 'unsettled';
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
    return r ?? { outcome: 'busy' as const };
  })().finally(() => { inFlight = null; });
  return inFlight;
}

async function run(deps: SignOutDeps): Promise<SignOutResult> {
  const done = (outcome: SignOutOutcome): SignOutResult => ({ outcome });
  const owner = getVerifiedAccount();
  if (typeof owner !== 'string') return done(owner === undefined ? 'unverified' : 'failed');
  const transition = beginTransition('signing-out');
  if (!transition) return done('busy');

  const idle = await settleActivityOperations(deps.settleTimeoutMs ?? 8000);
  if (!idle) { transition.end('resumed'); return done('busy'); }

  // The exact snapshot the question is about (owned records only).
  const snapshot = await readOwnedQueue(owner);
  const pending: PendingWork = snapshot.ok
    ? {
        // R9: LOGICAL activities (account + request id), the same classification Home shows -- never physical copies.
        owned: snapshot.total,
        ownedSent: snapshot.dispatched,
        paused: snapshot.paused,
      }
    : { owned: null };
  const question = describePendingWork(pending);
  if (question && !deps.confirm(question)) { transition.end('resumed'); return done('cancelled'); }

  const ack = await requestLogout(deps.fetch, owner, deps.logoutTimeoutMs ?? LOGOUT_TIMEOUT_MS);
  if (ack === 'acknowledged') {
    // Only now, after the confirmation and the server's acknowledgement, and
    // only EXACTLY the confirmed records (never anything added later).
    let owned: OwnedDiscardReport = { unknown: true, removed: 0, removedPossiblySent: 0, keptInFlight: 0, failed: 0, cleanupPending: 0 };
    if (snapshot.ok) {
      // R9: one logical discard -- the decisions and every IndexedDB copy in one transaction, retired
      // localStorage entries removed only after it committed (a failure keeps everything as it was).
      const d = await discardOwned(owner, snapshot, { tab: getTabId() });
      owned = { unknown: false, removed: d.removed, removedPossiblySent: d.removedPossiblySent, keptInFlight: d.keptInFlight, failed: d.failed, cleanupPending: d.cleanupPending, cleanupPendingPossiblySent: d.cleanupPendingPossiblySent, unidentified: d.unidentified, uncertain: d.uncertain, discardedUnverified: d.discardedUnverified, discardedUnverifiedPossiblySent: d.discardedUnverifiedPossiblySent };
    }
    const legacy = readLegacySnapshot();
    transition.end('signed-out');
    return { outcome: 'signed-out', owned, legacyKept: legacy.ok ? legacy.count : null };
  }

  // Not acknowledged (incl. 'unsettled': not even sent): reconcile with a fresh session read.
  const r = await reconcile(deps.fetch, owner, deps.reconcileTimeoutMs ?? RECONCILE_TIMEOUT_MS);
  if (r === 'same') { transition.end('resumed-verified'); return done(ack === 'unsettled' ? 'busy' : 'failed'); }
  if (r === 'signed-out') { transition.end('signed-out'); return done('signed-out-unconfirmed'); }
  if (r === 'unknown') { transition.end('unknown'); return done('unverified'); }
  transition.end({ switchedTo: r.other });
  return done('account-changed');
}

/** Test-only. */
export function __resetSignOutForTests() { inFlight = null; }
