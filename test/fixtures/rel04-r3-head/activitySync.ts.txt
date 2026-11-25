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
 * - Replay is one flight per tab and account (plus a Web Lock across tabs
 *   where available), skips entries this tab is still sending, stops as soon
 *   as the binding stops being current, and removes only the entries it
 *   settled (one atomic removeItem each).
 */
import { AccountUnavailableError, captureAccountBinding, getVerifiedAccount, isTransitionActive, isTransitionActiveNow, lockManager, reportUpgradeRequired, runActivityOperation, type AccountBinding, type AccountLease } from './accountSession';
import { classifyHabitLogSyncOutcome } from './habitLogSyncPolicy';
import { enqueueOwned, readOwnedQueue, removeRecords, type QueuedHabitLog } from './offlineHabitQueue';

export type HabitLogPayload = Omit<QueuedHabitLog, 'tempId'>;

export const UPGRADE_REQUIRED_CODE = 'client_upgrade_required';
export const UPGRADE_MESSAGE = 'Aura was updated. Reload the app to continue; nothing you logged is lost.';

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
const sendingHere = new Set<string>();

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
    const crid = payload.clientRequestId;
    const stored = enqueueOwned({ ...payload, tempId, ownerUserId: lease.account });
    if (stored.status === 'conflict') return { kind: 'not-stored' }; // never send a second payload under one identity
    const outbox = stored.status === 'stored' ? stored.key : null;
    const settle = () => { if (outbox) removeRecords([{ key: outbox }]); };
    sendingHere.add(crid);
    let res: Response;
    try {
      res = await post(lease, fetchImpl, payload);
    } catch {
      sendingHere.delete(crid);
      if (!outbox) return { kind: 'not-stored' };
      return lease.isCurrent() ? { kind: 'queued' } : { kind: 'account-changed', keptForAccount: true };
    }
    sendingHere.delete(crid);
    if (await isUpgradeRefusal(res)) { reportUpgradeRequired(); return outbox ? { kind: 'upgrade-required' } : { kind: 'not-stored' }; }
    if (ACCOUNT_HOLD.has(res.status)) return { kind: 'account-changed', keptForAccount: Boolean(outbox) };
    if (res.status >= 500) return outbox ? { kind: 'queued' } : { kind: 'not-stored' };
    if (!res.ok) { settle(); return { kind: 'rejected', status: res.status }; }
    const serverLog = await res.json().catch(() => ({}));
    settle();
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
  stoppedBecause: null | 'account-changed' | 'account-hold' | 'unreadable' | 'busy' | 'unavailable' | 'upgrade-required' | 'transition';
}
const EMPTY = (stoppedBecause: ReplayResult['stoppedBecause']): ReplayResult => ({ attempted: 0, confirmed: 0, removed: 0, removeFailed: 0, conflicts: 0, stoppedBecause });

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

function stillQueued(key: string, raw: string): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(key) === raw;
  } catch {
    return false;
  }
}

async function replayLocked(fetchImpl: typeof fetch, binding: AccountBinding): Promise<ReplayResult> {
  return runActivityOperation(async (lease) => {
    const result = EMPTY(null);
    const read = readOwnedQueue(lease.account);
    if (!read.ok) return { ...result, stoppedBecause: 'unreadable' as const };
    result.conflicts = read.conflicts.length;
    for (const group of read.groups) {
      const head = group[0];
      if (!lease.isCurrent()) { result.stoppedBecause = 'account-changed'; break; }
      if (sendingHere.has(head.item.clientRequestId)) continue; // its direct write is still deciding it
      // Never send from a stale snapshot: the exact record must still be queued
      // (not settled or discarded meanwhile) and no auth transition may be running
      // anywhere (held Web Lock or marker).
      if (!stillQueued(head.key, head.raw)) continue;
      if (await isTransitionActiveNow()) { result.stoppedBecause = 'transition'; break; }
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
      if (res && (await isUpgradeRefusal(res))) { reportUpgradeRequired(); result.stoppedBecause = 'upgrade-required'; break; }
      if (typeof status === 'number' && ACCOUNT_HOLD.has(status)) { result.stoppedBecause = 'account-hold'; break; }
      const outcome = classifyHabitLogSyncOutcome(status);
      if (outcome === 'retry') continue; // no response or 5xx: ambiguous, keep
      if (outcome === 'confirmed') result.confirmed++;
      // Settled: remove exactly the records of this identity that were snapshotted.
      const r = removeRecords(group);
      result.removed += r.removed;
      result.removeFailed += r.failed;
    }
    return result;
  }, binding);
}

/** Test-only. */
export function __resetActivitySyncForTests() {
  replaysInFlight.clear();
  sendingHere.clear();
}
