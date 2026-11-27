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
import { canonicalPayload, claimForDispatch, enqueueOwned, readOwnedQueue, releaseClaim, settleRecords, transmissionCheck, type ClaimToken, type QueuedHabitLog } from './offlineHabitQueue';

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
  /** Unresolved and could not be stored on this device. R14: `reason: 'discarded'` = this exact request was durably
   *  discarded on this device (it will not be sent; never a success, never a storage failure). */
  | { kind: 'not-stored'; reason?: 'discarded' }
  /**
   * R9: this device's activity storage could not be read reliably, so the activity's eligibility could not be
   * established: NOTHING was stored or sent. Recoverable -- the user can try again.
   */
  | { kind: 'storage-unavailable' }
  /**
   * R13: the queue write's commit could not be confirmed and could not be reconciled. The activity MAY be queued on
   * this device (it would then sync under this same request id); it must not be re-entered as a new activity.
   */
  | { kind: 'outcome-unknown' }
  /** R14: this exact request (account + request id + payload) was already accepted by the server (a durable settlement). */
  | { kind: 'already-recorded' }

  /** The server says this bundle is out of date; the entry is kept. */
  | { kind: 'upgrade-required' };

/**
 * R14 -- the ONE mapping from a durable decision to a submission outcome:
 *   settled + accepted  -> already-recorded  (success: the server holds this exact request)
 *   settled + rejected  -> rejected          (the server's definitive refusal)
 *   settled, answer not recorded (decisions written before R14) -> outcome-unknown (unresolved, never "not saved")
 *   discarded           -> not-stored, reason 'discarded'  (never a success; it will not be sent)
 */
function outcomeOfDecision(d: { decision?: 'settled' | 'discarded'; serverOutcome?: 'accepted' | 'rejected' }): ActivityWriteResult {
  if (d.decision === 'discarded') return { kind: 'not-stored', reason: 'discarded' };
  if (d.decision === 'settled' && d.serverOutcome === 'accepted') return { kind: 'already-recorded' };
  if (d.decision === 'settled' && d.serverOutcome === 'rejected') return { kind: 'rejected', status: 0 };
  return { kind: 'outcome-unknown' };
}

/** Statuses meaning "this session can't write this entry now" -- keep it for its account. */
const ACCOUNT_HOLD = new Set([401, 403, 409, 428]);

/** R12: the body sent is the CLAIMED item (the immutable claim representation), never an earlier cached copy. */
function claimedBody(token: ClaimToken, fallback: HabitLogPayload): HabitLogPayload {
  if (!token.item) return fallback;
  const { tempId: _t, ownerUserId: _o, queuedAt: _q, recordId: _r, ...body } = token.item as QueuedHabitLog & { ownerUserId?: string; queuedAt?: number; recordId?: string };
  return body;
}

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
    // R9 -- THE transmission boundary: an activity is sent only after enqueueOwned stored it AND, in the same
    // transaction, established its eligibility (no decision, no quarantined copy, readable retired sources) and
    // claimed it. There is no direct-network fallback: if storage cannot be read, nothing is sent.
    const stored = await enqueueOwned({ ...payload, tempId, ownerUserId: lease.account }, { claimFor: tab });
    if (stored.status === 'failed' || stored.status === 'unavailable') return { kind: 'storage-unavailable' }; // confirmed not queued
    if (stored.status === 'unknown') return { kind: 'outcome-unknown' }; // R13: possibly queued, never reported as not saved
    if (stored.status === 'conflict') return { kind: 'not-stored' }; // never send a second payload under one identity
    // R14: a DURABLE decision for this exact request decides the outcome (same evidence, same answer, every path).
    if (stored.status === 'settled') return outcomeOfDecision(stored);
    if (stored.status === 'paused') return { kind: 'not-stored' }; // a quarantined copy exists: never sent
    // The identical request is already queued and another attempt is sending it: never send it twice at once.
    if (!stored.claim) return lease.isCurrent() ? { kind: 'queued' } : { kind: 'account-changed', keptForAccount: true };
    const outbox: string | null = stored.recordId;
    const token = stored.claim;
    // R5: release and settlement are fenced by THIS attempt's token.
    const settle = async (serverOutcome: 'accepted' | 'rejected') => { if (outbox) await settleRecords([outbox], token, { owner: lease.account, serverOutcome }); };
    const release = async () => { if (token) await releaseClaim(token); };
    // Final checks with no await before the send.
    if (!lease.isCurrent() || isTransitionActive()) {
      await release();
      return outbox ? { kind: 'account-changed', keptForAccount: true } : { kind: 'not-stored' };
    }
    // R13: the claimed account must be the authenticated one.
    if (token.owner !== undefined && token.owner !== lease.account) { await release(); return { kind: 'account-changed', keptForAccount: true }; }
    // R12: the retired-storage state visible when transmission begins (synchronous; the send follows with no await).
    const tc = transmissionCheck(token);
    // R13: the record is already COMMITTED to the queue here -- a refusal at this point means "kept, not sent now",
    // never "not stored": it stays queued (paused or retried later under the same request id).
    if (tc !== 'clear') { await release(); return lease.isCurrent() ? { kind: 'queued' } : { kind: 'account-changed', keptForAccount: true }; }
    let res: Response;
    try {
      res = await post(lease, fetchImpl, claimedBody(token, payload));
    } catch {
      await release();
      if (!outbox) return { kind: 'not-stored' };
      return lease.isCurrent() ? { kind: 'queued' } : { kind: 'account-changed', keptForAccount: true };
    }
    if (await isUpgradeRefusal(res)) { await release(); reportUpgradeRequired(); return outbox ? { kind: 'upgrade-required' } : { kind: 'not-stored' }; }
    if (ACCOUNT_HOLD.has(res.status)) { await release(); return { kind: 'account-changed', keptForAccount: Boolean(outbox) }; }
    if (res.status >= 500) { await release(); return outbox ? { kind: 'queued' } : { kind: 'not-stored' }; }
    if (!res.ok) { await settle('rejected'); return { kind: 'rejected', status: res.status }; }
    const serverLog = await res.json().catch(() => ({}));
    await settle('accepted');
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
  /** R8: activity kept on this device that does not sync automatically (quarantined retired formats, conflicts, unreadable entries). */
  paused: number;
  stoppedBecause: null | 'account-changed' | 'account-hold' | 'unreadable' | 'busy' | 'unavailable' | 'upgrade-required' | 'transition';
}
const EMPTY = (stoppedBecause: ReplayResult['stoppedBecause']): ReplayResult => ({ attempted: 0, confirmed: 0, removed: 0, removeFailed: 0, conflicts: 0, paused: 0, stoppedBecause });

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
    result.paused = read.paused;
    for (const group of read.groups) {
      const head = group[0];
      if (!lease.isCurrent()) { result.stoppedBecause = 'account-changed'; break; }
      if (head.inFlight) continue; // another context (or this one) is sending it
      if (await isTransitionActiveNow()) { result.stoppedBecause = 'transition'; break; }
      // The handoff: atomically confirm the request is still queued and not being sent, and claim it.
      // R12: bound to what was inspected -- a replaced or modified record is refused ('changed'), never claimed.
      // R13: ... including the inspected ACCOUNT (an account-only replacement is refused as well).
      const claim = await claimForDispatch(head.recordId, tab, { ownerUserId: lease.account, clientRequestId: head.item.clientRequestId, payload: canonicalPayload(head.item) });
      if (claim.status === 'failed') { result.stoppedBecause = 'unreadable'; break; }
      if (claim.status !== 'claimed') continue; // settled/discarded/changed meanwhile, or another attempt is sending it
      const token = claim.claim;
      // Final checks with no await before the send.
      if (!lease.isCurrent() || isTransitionActive()) {
        await releaseClaim(token);
        result.stoppedBecause = lease.isCurrent() ? 'transition' : 'account-changed';
        break;
      }
      if (token.owner !== lease.account) { await releaseClaim(token); continue; } // R13: claim/lease account agreement
      const tc = transmissionCheck(token); // R12: synchronous, immediately before the send
      if (tc !== 'clear') { await releaseClaim(token); if (tc === 'unavailable') { result.stoppedBecause = 'unreadable'; break; } continue; }
      const { tempId: _t, ownerUserId: _o, queuedAt: _q, recordId: _r, ...cached } = head.item;
      result.attempted++;
      let status: number | 'network-error';
      let res: Response | null = null;
      try {
        res = await post(lease, fetchImpl, claimedBody(token, cached));
        status = res.status;
      } catch {
        status = 'network-error';
      }
      if (res && (await isUpgradeRefusal(res))) { await releaseClaim(token); reportUpgradeRequired(); result.stoppedBecause = 'upgrade-required'; break; }
      if (typeof status === 'number' && ACCOUNT_HOLD.has(status)) { await releaseClaim(token); result.stoppedBecause = 'account-hold'; break; }
      const outcome = classifyHabitLogSyncOutcome(status);
      if (outcome === 'retry') { await releaseClaim(token); continue; } // no response or 5xx: ambiguous, keep
      if (outcome === 'confirmed') result.confirmed++;
      // Settled: R12 -- bound to the claim: only copies still carrying the claimed identity and payload are removed.
      const r = await settleRecords([token.recordId ?? head.recordId], token, { owner: lease.account, serverOutcome: outcome === 'confirmed' ? 'accepted' : 'rejected' });
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
