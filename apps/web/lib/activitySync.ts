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
import type { OperationStatus } from './pendingReplayReconciliation';
import { decodeHabitLogList, decodeHabitLogResponse, HABIT_LOGS_PATH, type BoundServerRow, type DecodedHabitLogResponse } from './habitLogSyncPolicy';
import { acceptedReceipt, canonicalPayload, claimForDispatch, enqueueOwned, readOperationState, readOwnedQueue, recordVerifiedReceipt, rejectedReceipt, releaseClaim, settleRecords, transmissionCheck, type ClaimToken, type EnqueueResult, type QueuedHabitLog } from './offlineHabitQueue';

export type HabitLogPayload = Omit<QueuedHabitLog, 'tempId'>;

export const UPGRADE_REQUIRED_CODE = 'client_upgrade_required';
export const UPGRADE_MESSAGE = 'Aura was updated. Reload the app to continue; this activity is kept on this device and will sync after you reload.';

export type ActivityWriteResult =
  /** R15: the shared decoder validated the server row for exactly this operation (the receipt is persisted). */
  | { kind: 'confirmed'; serverLog: BoundServerRow }
  /** No definitive answer (no response, 5xx incl. 502, aborted); kept in the account's queue. */
  | { kind: 'queued' }
  /** Definitive refusal (4xx other than account holds); nothing kept. */
  | { kind: 'rejected'; status: number }
  /** The bound account stopped being current, or the session belongs to someone else; kept for its account if stored. */
  | { kind: 'account-changed'; keptForAccount: boolean }
  /** Unresolved and could not be stored on this device. R14: `reason: 'discarded'` = this exact request was durably
   *  discarded on this device (it will not be sent; never a success, never a storage failure). */
  | { kind: 'not-stored'; reason?: 'discarded' | 'not-committed' }
  /**
   * R9: this device's activity storage could not be read reliably, so the activity's eligibility could not be
   * established: NOTHING was stored or sent. Recoverable -- the user can try again.
   */
  | { kind: 'storage-unavailable' }
  /**
   * R13: the queue write's commit could not be confirmed and could not be reconciled. The activity MAY be queued on
   * this device (it would then sync under this same request id); it must not be re-entered as a new activity.
   */
  | { kind: 'outcome-unknown'; reason?: 'unverified-response' | 'unverified-marker' | 'refused-after-possible-send' | 'evidence-unavailable' }
  /** R14/R15: this exact request (account + request id + payload) was already accepted by the server -- proven by a
   *  validated receipt or validated server evidence, never by a bare marker. */
  | { kind: 'already-recorded'; serverLog?: BoundServerRow }

  /** The server says this bundle is out of date; the entry is kept. */
  | { kind: 'upgrade-required' };

/**
 * R15 -- the ONE mapping from VALIDATED durable evidence to a submission outcome (decisionAuthority):
 *   success (valid accepted receipt) -> already-recorded  (the server holds this exact operation)
 *   failed  (valid rejected receipt) -> rejected          (the route's definitive refusal, with its status)
 *   discarded                        -> not-stored, reason 'discarded'  (never a success; it will not be sent)
 * A marker that proves nothing is never one of these: it is 'unverified' -> outcome-unknown.
 */
function outcomeOfSettled(r: Extract<EnqueueResult, { status: 'settled' }>): ActivityWriteResult {
  if (r.outcome === 'success' && r.receipt) return { kind: 'already-recorded', serverLog: r.receipt.row };
  if (r.outcome === 'failed' && typeof r.httpStatus === 'number') return { kind: 'rejected', status: r.httpStatus };
  if (r.outcome === 'discarded') return { kind: 'not-stored', reason: 'discarded' };
  return { kind: 'outcome-unknown', reason: 'unverified-marker' };
}

/**
 * R15 -- the shared outcome model every consumer projects (Home, Timeline, Calendar, Past Activity):
 *   pending     durably queued, no terminal evidence yet (it syncs under its own request id)
 *   unresolved  it may have been saved; the evidence is missing, contradictory or unreadable. The identity is kept;
 *               only positive evidence, a definitive failure or a durable discard resolves it. Never re-entered
 *               under a new id.
 *   confirmed   a validated server receipt
 *   failed      definitive failure (nothing was saved: proven pre-dispatch, or the route's refusal of this exact
 *               request with no possible earlier send)
 *   discarded   durably discarded on this device
 */
export type { OperationStatus };
export function operationStatusOf(r: ActivityWriteResult): OperationStatus {
  switch (r.kind) {
    case 'confirmed': case 'already-recorded': return 'confirmed';
    case 'queued': case 'upgrade-required': return 'pending';
    case 'account-changed': return r.keptForAccount ? 'pending' : 'unresolved';
    case 'outcome-unknown': return 'unresolved';
    case 'rejected': case 'storage-unavailable': return 'failed';
    case 'not-stored': return r.reason === 'discarded' ? 'discarded' : 'failed';
  }
}

/**
 * R15 -- one activity OPERATION: minted once for an explicit new action, then immutable. Retry, Check again,
 * replay and recovery all carry this exact account, request id and canonical dispatch body (incl. its original
 * timestamp); a separate operation gets a new id only after this one is resolved.
 */
export interface ActivityOperation { readonly account: string; readonly clientRequestId: string; readonly body: Readonly<HabitLogPayload> }

/** R12: the body sent is the CLAIMED item (the immutable claim representation), never an earlier cached copy. */
function claimedBody(token: ClaimToken, fallback: HabitLogPayload): HabitLogPayload {
  if (!token.item) return fallback;
  const { tempId: _t, ownerUserId: _o, queuedAt: _q, recordId: _r, ...body } = token.item as QueuedHabitLog & { ownerUserId?: string; queuedAt?: number; recordId?: string };
  return body;
}

function post(lease: AccountLease, fetchImpl: typeof fetch, payload: HabitLogPayload) {
  return fetchImpl(HABIT_LOGS_PATH, {
    method: 'POST',
    headers: lease.headers({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload),
    credentials: 'same-origin',
    redirect: 'error', // R15: a redirected answer never reaches the decoder as an answer
    signal: lease.signal,
  });
}

/** R15: the operation a claim stands for, as the decoder must find it in the server's answer. */
function expectationOf(token: ClaimToken, account: string, body: HabitLogPayload) {
  return { account, clientRequestId: token.crid ?? body.clientRequestId, body: body as unknown as Record<string, unknown> };
}

/**
 * R16 -- THE settlement rule both send paths use: the receipt a decoded answer justifies, or null (keep the copy,
 * nothing settled). Accepted: the validated row. Rejected: only the route's DEFINITIVE refusal of this exact body
 * with no possible earlier send (a later refusal cannot disprove an earlier commit).
 */
function settlementReceipt(decoded: Extract<DecodedHabitLogResponse, { kind: 'accepted' | 'rejected' }>, token: ClaimToken, account: string) {
  if (decoded.kind === 'accepted') return acceptedReceipt(account, token.crid!, token.payload!, decoded.row);
  if ((token.priorAttempts ?? 0) > 0) return null;
  return rejectedReceipt(account, token.crid!, token.payload!, decoded.status, decoded.reason);
}

/** Test seam (negative controls): THE decoder both send paths use. */
export const __decoder = { decode: decodeHabitLogResponse };

/**
 * One direct activity write for `binding` (capture it when the user acts).
 * OUTBOX: stored in its account's queue BEFORE sending. R15: only the shared decoder's VALIDATED answer settles that
 * exact record (an accepted receipt, or the route's own refusal); no response, an abort, any 5xx, an upgrade refusal
 * or an answer that proves nothing keeps it, to be replayed later with the same clientRequestId.
 * `explicitRetry`: the user's Retry of THIS operation (same id, same canonical body): it may send again past a marker
 * that proves nothing -- never past a valid decision.
 */
export async function submitActivityLog(payload: HabitLogPayload, tempId: string, fetchImpl: typeof fetch = (i, n) => fetch(i, n), binding?: AccountBinding, { explicitRetry = false }: { explicitRetry?: boolean } = {}): Promise<ActivityWriteResult> {
  return runActivityOperation(async (lease) => {
    const tab = getTabId();
    // R9 -- THE transmission boundary: an activity is sent only after enqueueOwned stored it AND, in the same
    // transaction, established its eligibility (no decision, no quarantined copy, readable retired sources) and
    // claimed it. There is no direct-network fallback: if storage cannot be read, nothing is sent.
    const stored = await enqueueOwned({ ...payload, tempId, ownerUserId: lease.account }, { claimFor: tab, explicitRetry });
    if (stored.status === 'failed' || stored.status === 'unavailable') return { kind: 'storage-unavailable' }; // confirmed not queued
    if (stored.status === 'unknown') return { kind: 'outcome-unknown' }; // R13: possibly queued, never reported as not saved
    if (stored.status === 'unverified') return { kind: 'outcome-unknown', reason: 'unverified-marker' }; // R15: a marker that proves nothing
    if (stored.status === 'conflict') return { kind: 'not-stored' }; // never send a second payload under one identity
    // R14/R15: a VALIDATED durable decision for this exact request decides the outcome (same evidence, same answer).
    if (stored.status === 'settled') return outcomeOfSettled(stored);
    if (stored.status === 'paused') return { kind: 'not-stored' }; // a quarantined copy exists: never sent
    // The identical request is already queued and another attempt is sending it: never send it twice at once.
    if (!stored.claim) return lease.isCurrent() ? { kind: 'queued' } : { kind: 'account-changed', keptForAccount: true };
    const outbox: string | null = stored.recordId;
    const token = stored.claim;
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
    const body = claimedBody(token, payload);
    let res: Response | 'network-error';
    try {
      res = await post(lease, fetchImpl, body);
    } catch {
      res = 'network-error';
    }
    const decoded = await __decoder.decode(res, expectationOf(token, lease.account, body), () => lease.isCurrent(), UPGRADE_REQUIRED_CODE);
    return applyDirectAnswer(decoded, token, lease, outbox, release);
  }, binding);
}

async function applyDirectAnswer(decoded: DecodedHabitLogResponse, token: ClaimToken, lease: AccountLease, outbox: string | null, release: () => Promise<void>): Promise<ActivityWriteResult> {
  const settleTo = async (receipt: ReturnType<typeof acceptedReceipt> | ReturnType<typeof rejectedReceipt>) => { if (outbox) await settleRecords([outbox], token, { owner: lease.account, receipt }); };
  switch (decoded.kind) {
    case 'upgrade': await release(); reportUpgradeRequired(); return outbox ? { kind: 'upgrade-required' } : { kind: 'not-stored' };
    case 'hold': await release(); return { kind: 'account-changed', keptForAccount: Boolean(outbox) };
    case 'retry': await release(); if (!outbox) return { kind: 'not-stored' }; return lease.isCurrent() ? { kind: 'queued' } : { kind: 'account-changed', keptForAccount: true };
    case 'unverified': await release(); return { kind: 'outcome-unknown', reason: 'unverified-response' }; // kept: replays under the same id
    case 'rejected': {
      const receipt = settlementReceipt(decoded, token, lease.account);
      // R16: a later refusal cannot disprove an earlier send that may have committed -- kept, unresolved, not settled.
      if (!receipt) { await release(); return { kind: 'outcome-unknown', reason: 'refused-after-possible-send' }; }
      await settleTo(receipt);
      return { kind: 'rejected', status: decoded.status };
    }
    case 'accepted': {
      // The server fact is established by the validated row; the receipt and the matching-copy removal are one
      // transaction. If that local write fails, the copy replays under the same id and converges on this row.
      await settleTo(acceptedReceipt(lease.account, token.crid!, token.payload!, decoded.row));
      if (!lease.isCurrent()) return { kind: 'account-changed', keptForAccount: false };
      return { kind: 'confirmed', serverLog: decoded.row };
    }
  }
}

/**
 * R15 -- "Check again": re-establishes ONE operation's outcome from evidence, never from absence or titles.
 *   1. durable storage (requestState, the same authority as the gate): a validated receipt / refusal / discard
 *      decides; a live copy means pending (replay resolves it); "absent" (no copy AND no decision) proves the
 *      operation was never committed -- unless this tab knows it was dispatched
 *   2. otherwise the authenticated GET, bound by the same row rules: a matching row upgrades the operation (the
 *      receipt is persisted); a mismatching row or absence leaves it unresolved
 */
export async function checkActivityOperation(op: ActivityOperation, fetchImpl: typeof fetch = (i, n) => fetch(i, n), binding?: AccountBinding, { dispatched = false }: { dispatched?: boolean } = {}): Promise<ActivityWriteResult> {
  return runActivityOperation(async (lease) => {
    if (lease.account !== op.account) return { kind: 'account-changed', keptForAccount: true };
    const payload = canonicalPayload({ ...(op.body as HabitLogPayload), tempId: '' } as QueuedHabitLog);
    const state = await readOperationState(op.account, op.clientRequestId, payload);
    if (state?.kind === 'success') return { kind: 'already-recorded', serverLog: state.receipt.row };
    if (state?.kind === 'failed') return { kind: 'rejected', status: state.status };
    if (state?.kind === 'discarded') return { kind: 'not-stored', reason: 'discarded' };
    if (state?.kind === 'live') return { kind: 'queued' };
    if (state?.kind === 'absent' && !dispatched) return { kind: 'not-stored', reason: 'not-committed' };
    // Unverified marker, conflicting/paused evidence, unreadable storage, or absent after a dispatch: ask the server.
    let res: Response | 'network-error';
    try {
      res = await fetchImpl(HABIT_LOGS_PATH, { method: 'GET', headers: lease.headers(), credentials: 'same-origin', redirect: 'error', signal: lease.signal });
    } catch {
      res = 'network-error';
    }
    const found = await decodeHabitLogList(res, { account: op.account, clientRequestId: op.clientRequestId, body: op.body as unknown as Record<string, unknown> }, () => lease.isCurrent());
    if (found.kind !== 'match') return { kind: 'outcome-unknown', reason: 'evidence-unavailable' };
    await recordVerifiedReceipt(acceptedReceipt(op.account, op.clientRequestId, payload, found.row));
    return { kind: 'already-recorded', serverLog: found.row };
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
  /** R15: answers that proved nothing about the operation (kept under the same id, never settled). */
  unverified?: number;
}
const EMPTY = (stoppedBecause: ReplayResult['stoppedBecause']): ReplayResult => ({ attempted: 0, confirmed: 0, removed: 0, removeFailed: 0, conflicts: 0, paused: 0, stoppedBecause, unverified: 0 });

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
      const body = claimedBody(token, cached);
      let res: Response | 'network-error';
      try {
        res = await post(lease, fetchImpl, body);
      } catch {
        res = 'network-error';
      }
      // R15: THE same decoder as direct submission -- transport status alone never settles anything.
      const decoded = await __decoder.decode(res, expectationOf(token, lease.account, body), () => lease.isCurrent(), UPGRADE_REQUIRED_CODE);
      if (decoded.kind === 'upgrade') { await releaseClaim(token); reportUpgradeRequired(); result.stoppedBecause = 'upgrade-required'; break; }
      if (decoded.kind === 'hold') { await releaseClaim(token); result.stoppedBecause = 'account-hold'; break; }
      if (decoded.kind === 'retry') { await releaseClaim(token); continue; } // no response or 5xx: ambiguous, keep
      if (decoded.kind === 'unverified') { await releaseClaim(token); result.unverified = (result.unverified ?? 0) + 1; continue; } // proves nothing: keep
      const receipt = settlementReceipt(decoded, token, lease.account);
      if (!receipt) { await releaseClaim(token); result.unverified = (result.unverified ?? 0) + 1; continue; } // R16: refusal after a possible send: kept
      if (decoded.kind === 'accepted') result.confirmed++;
      // Settled: R12 -- bound to the claim: only copies still carrying the claimed identity and payload are removed.
      const r = await settleRecords([token.recordId ?? head.recordId], token, { owner: lease.account, receipt });
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
