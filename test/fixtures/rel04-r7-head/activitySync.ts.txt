/**
 * AURA-ANDROID-REL-04 IR-01 (R2) -- every activity-log write goes through here:
 * Home's direct POST /api/habit-logs and the offline queue replay.
 *
 * - Bound to the account the user acted under (AccountBinding captured at
 *   the action); refused if that account is no longer current or an auth
 *   transition is running (lib/accountSession.ts).
 * - Every request states that account (X-Aura-Expected-Account); the server
 *   refuses it (409) under any other session, before anything is written.
 * - OUTBOX: a direct write is stored in its account's queue BEFORE it is
 *   sent, under its own clientRequestId. A definitive server answer removes
 *   it; anything unresolved (no response, aborted by a transition, account
 *   changed mid-flight) stays queued for its account and is later replayed
 *   with the SAME clientRequestId, which the server de-duplicates. Aborting a
 *   request is never treated as proof that the server did not commit it.
 * - R4: the queue is IndexedDB (lib/offlineHabitQueue.ts). A record is sent
 *   only under a CLAIM taken atomically with the check that it still exists
 *   and that no other context is sending it (the direct write claims its own
 *   record when storing it). The claim is the replay/discard handoff: a
 *   discard never removes a record a context is sending, and a replay never
 *   sends a record that was settled or discarded. No await separates the
 *   final account/transition check from the send. Settlement removes exactly
 *   the settled records in one transaction; an unresolved send releases its
 *   claim and the record stays queued.
 * - Replay is one flight per tab and account (plus a Web Lock across tabs
 *   where available, an optimisation only: correctness comes from the claims).
 */
import { AccountUnavailableError, captureAccountBinding, getTabId, getVerifiedAccount, isTransitionActive, isTransitionActiveNow, lockManager, reportUpgradeRequired, runActivityOperation, type AccountBinding, type AccountLease } from './accountSession';
import { classifyHabitLogSyncOutcome } from './habitLogSyncPolicy';
import { claimForDispatch, enqueueOwned, readOwnedQueue, releaseClaim, settleRecords, type QueuedHabitLog } from './offlineHabitQueue';

export type HabitLogPayload = Omit<QueuedHabitLog, 'tempId'>;

export const UPGRADE_REQUIRED_CODE = 'client_upgrade_required';
export const UPGRADE_MESSAGE = 'Aura was updated. Reload the app to continue; this activity is kept on this device and will sync after you reload.';

export type ActivityWriteResult =
  | { kind: 'confirmed'; serverLog: Record<string, unknown> }
  /** No definitive answer (no response, 5xx incl. 502, aborted); kept in the account's queue. */
  | { kind: 'queued' }
  /** Definitive refusal (4xx other than account holds); nothing kept. */
  | { kind: 'rejected'; status: number }
  /** The bound account stopped being current, or the session belongs to someone else; kept for its account if stored. */
  | { kind: 'account-changed'; keptForAccount: boolean }
  /** Unresolved and could not be stored on this device. */
  | { kind: 'not-stored' }
  /** The server says this bundle is out of date; the entry is kept. */
  | { kind: 'upgrade-required' };

/** Statuses meaning "this session can't write this entry now" -- keep it for its account. */
const ACCOUNT_HOLD = new Set([401, 403, 409, 428]);

function post(lease: AccountLease, fetchImpl: typeof fetch, payload: HabitLogPayload) {
  return fetchImpl('/api/habit-logs', {
    method: 'POST',
    headers: lease.headers({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload),
    credentials: 'same-origin',
    signal: lease.signal,
  });
}

async function isUpgradeRefusal(res: Response): Promise<boolean> {
  if (res.status !== 503) return false;
  try {
    const body = await res.clone().json();
    return body?.code === UPGRADE_REQUIRED_CODE;
  } catch {
    return false;
  }
}

/**
 * One direct activity write for `binding` (capture it when the user acts).
 * OUTBOX: stored in its account's queue BEFORE sending; only a definitive
 * answer (2xx, or a 4xx refusal) settles that exact record. No response, an
 * abort, any 5xx (incl. 502: the commit may have happened) or an upgrade
 * refusal keeps it, to be replayed later with the same clientRequestId.
 */
export async function submitActivityLog(payload: HabitLogPayload, tempId: string, fetchImpl: typeof fetch = (i, n) => fetch(i, n), binding?: AccountBinding): Promise<ActivityWriteResult> {
  return runActivityOperation(async (lease) => {
    const tab = getTabId();
    const stored = await enqueueOwned({ ...payload, tempId, ownerUserId: lease.account }, { claimFor: tab });
    if (stored.status === 'conflict') return { kind: 'not-stored' }; // never send a second payload under one identity
    // The identical request is already queued and another attempt is sending it: never send it twice at once.
    if (stored.status === 'stored' && !stored.claim) return lease.isCurrent() ? { kind: 'queued' } : { kind: 'account-changed', keptForAccount: true };
    const outbox = stored.status === 'stored' ? stored.recordId : null;
    const token = stored.status === 'stored' ? stored.claim : null;
    // R5: release and settlement are fenced by THIS attempt's token.
    const settle = async () => { if (outbox) await settleRecords([outbox], token ?? undefined, { owner: lease.account }); };
    const release = async () => { if (token) await releaseClaim(token); };
    // Final checks with no await before the send.
    if (!lease.isCurrent() || isTransitionActive()) {
      await release();
      return outbox ? { kind: 'account-changed', keptForAccount: true } : { kind: 'not-stored' };
    }
    let res: Response;
    try {
      res = await post(lease, fetchImpl, payload);
    } catch {
      await release();
      if (!outbox) return { kind: 'not-stored' };
      return lease.isCurrent() ? { kind: 'queued' } : { kind: 'account-changed', keptForAccount: true };
    }
    if (await isUpgradeRefusal(res)) { await release(); reportUpgradeRequired(); return outbox ? { kind: 'upgrade-required' } : { kind: 'not-stored' }; }
    if (ACCOUNT_HOLD.has(res.status)) { await release(); return { kind: 'account-changed', keptForAccount: Boolean(outbox) }; }
    if (res.status >= 500) { await release(); return outbox ? { kind: 'queued' } : { kind: 'not-stored' }; }
    if (!res.ok) { await settle(); return { kind: 'rejected', status: res.status }; }
    const serverLog = await res.json().catch(() => ({}));
    await settle();
    if (!lease.isCurrent()) return { kind: 'account-changed', keptForAccount: false };
    return { kind: 'confirmed', serverLog };
  }, binding);
}

export interface ReplayResult {
  attempted: number;
  confirmed: number;
  removed: number;
  removeFailed: number;
  /** Identities with conflicting payloads, quarantined (never sent). */
  conflicts: number;
  /** R7: identities held because their ownership could not be established (kept, never sent automatically). */
  held: number;
  stoppedBecause: null | 'account-changed' | 'account-hold' | 'unreadable' | 'busy' | 'unavailable' | 'upgrade-required' | 'transition';
}
const EMPTY = (stoppedBecause: ReplayResult['stoppedBecause']): ReplayResult => ({ attempted: 0, confirmed: 0, removed: 0, removeFailed: 0, conflicts: 0, held: 0, stoppedBecause });

const replaysInFlight = new Map<string, Promise<ReplayResult>>();

/** Replays the verified account's queue. Never throws. */
export function replayOfflineQueue(fetchImpl: typeof fetch = (i, n) => fetch(i, n)): Promise<ReplayResult> {
  const account = getVerifiedAccount();
  if (!account || isTransitionActive()) return Promise.resolve(EMPTY('unavailable'));
  const existing = replaysInFlight.get(account);
  if (existing) return existing;
  let binding: AccountBinding;
  try { binding = captureAccountBinding(); } catch { return Promise.resolve(EMPTY('unavailable')); }
  const run = async (): Promise<ReplayResult> => {
    const locks = lockManager();
    if (!locks) return replayLocked(fetchImpl, binding);
    return locks.request(`aura-habit-replay:${account}`, { ifAvailable: true }, async (lock) => (lock ? replayLocked(fetchImpl, binding) : EMPTY('busy')));
  };
  const p = run()
    .catch((err) => (err instanceof AccountUnavailableError ? EMPTY(err.reason === 'transition' ? 'transition' : 'unavailable') : EMPTY('account-changed')))
    .finally(() => replaysInFlight.delete(account));
  replaysInFlight.set(account, p);
  return p;
}

async function replayLocked(fetchImpl: typeof fetch, binding: AccountBinding): Promise<ReplayResult> {
  return runActivityOperation(async (lease) => {
    const tab = getTabId();
    const result = EMPTY(null);
    const read = await readOwnedQueue(lease.account);
    if (!read.ok) return { ...result, stoppedBecause: 'unreadable' as const };
    result.conflicts = read.conflicts.length;
    result.held = read.held.length;
    for (const group of read.groups) {
      const head = group[0];
      if (!lease.isCurrent()) { result.stoppedBecause = 'account-changed'; break; }
      if (head.inFlight) continue; // another context (or this one) is sending it
      if (await isTransitionActiveNow()) { result.stoppedBecause = 'transition'; break; }
      // The handoff: atomically confirm the request is still queued and not being sent, and claim it.
      const claim = await claimForDispatch(head.recordId, tab);
      if (claim.status === 'failed') { result.stoppedBecause = 'unreadable'; break; }
      if (claim.status !== 'claimed') continue; // settled/discarded meanwhile, or another attempt is sending it
      const token = claim.claim;
      // Final checks with no await before the send.
      if (!lease.isCurrent() || isTransitionActive()) {
        await releaseClaim(token);
        result.stoppedBecause = lease.isCurrent() ? 'transition' : 'account-changed';
        break;
      }
      const { tempId: _t, ownerUserId: _o, queuedAt: _q, recordId: _r, ...payload } = head.item;
      result.attempted++;
      let status: number | 'network-error';
      let res: Response | null = null;
      try {
        res = await post(lease, fetchImpl, payload);
        status = res.status;
      } catch {
        status = 'network-error';
      }
      if (res && (await isUpgradeRefusal(res))) { await releaseClaim(token); reportUpgradeRequired(); result.stoppedBecause = 'upgrade-required'; break; }
      if (typeof status === 'number' && ACCOUNT_HOLD.has(status)) { await releaseClaim(token); result.stoppedBecause = 'account-hold'; break; }
      const outcome = classifyHabitLogSyncOutcome(status);
      if (outcome === 'retry') { await releaseClaim(token); continue; } // no response or 5xx: ambiguous, keep
      if (outcome === 'confirmed') result.confirmed++;
      // Settled: remove exactly the records of this identity that were read (claim cleared only if still ours).
      const r = await settleRecords(group.map((g) => g.recordId), token, { owner: lease.account });
      result.removed += r.removed;
      result.removeFailed += r.failed;
    }
    return result;
  }, binding);
}

/** Test-only. */
export function __resetActivitySyncForTests() {
  replaysInFlight.clear();
}
