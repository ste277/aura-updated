/**
 * AURA-ANDROID-REL-04 IR-01 -- every activity-log write goes through here:
 * the direct POST /api/habit-logs from Home and its offline queue replay.
 *
 * - A write needs a verified account and no auth transition
 *   (lib/accountSession.ts runActivityOperation).
 * - Every request carries X-Aura-Expected-Account = that account; the server
 *   rejects it (409) if the session belongs to someone else, before anything
 *   is written (lib/expectedAccount.ts). So a request that was already on the
 *   wire when the account changed can never be stored under the next account.
 * - A network failure queues the entry for its OWN account only, and only if
 *   that account is still current; after a transition nothing is queued and
 *   the caller is told.
 * - Replay is single-flight per tab and per account (plus a Web Lock across
 *   tabs where available), stops as soon as the account changes, and only
 *   ever removes the ids it settled.
 */
import { AccountUnavailableError, getVerifiedAccount, isTransitionActive, runActivityOperation, type AccountLease } from './accountSession';
import { classifyHabitLogSyncOutcome } from './habitLogSyncPolicy';
import { enqueueOwned, readOwnedQueue, removeOwnedEntries, type OwnedQueuedHabitLog, type QueuedHabitLog } from './offlineHabitQueue';

export type HabitLogPayload = Omit<QueuedHabitLog, 'tempId'>;

export type ActivityWriteResult =
  | { kind: 'confirmed'; serverLog: Record<string, unknown> }
  | { kind: 'queued' }
  | { kind: 'rejected'; status: number }
  | { kind: 'account-changed' }
  | { kind: 'not-stored' };

/** Statuses that say "this session can't write this entry right now"; never a reason to drop it. */
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

/**
 * One direct activity write. Throws AccountUnavailableError when there is no
 * verified account or a transition is running (nothing is sent or queued).
 */
export async function submitActivityLog(payload: HabitLogPayload, tempId: string, fetchImpl: typeof fetch = fetch): Promise<ActivityWriteResult> {
  return runActivityOperation(async (lease) => {
    let res: Response;
    try {
      res = await post(lease, fetchImpl, payload);
    } catch {
      // No response: the outcome is ambiguous. Queue it for THIS account,
      // but only while this account is still current.
      if (!lease.isCurrent()) return { kind: 'account-changed' };
      const stored = enqueueOwned({ ...payload, tempId, ownerUserId: lease.account });
      return stored ? { kind: 'queued' } : { kind: 'not-stored' };
    }
    if (!lease.isCurrent()) {
      // The response belongs to an account that is no longer shown (the
      // server only accepted it if the session was still this account), so
      // it must not touch the next account's screen or queue.
      return { kind: 'account-changed' };
    }
    if (!res.ok) return { kind: 'rejected', status: res.status };
    const serverLog = await res.json().catch(() => ({}));
    if (!lease.isCurrent()) return { kind: 'account-changed' };
    return { kind: 'confirmed', serverLog };
  });
}

export interface ReplayResult {
  attempted: number;
  confirmed: number;
  removed: number;
  stoppedBecause: null | 'account-changed' | 'account-hold' | 'unreadable' | 'busy' | 'unavailable';
}

const replaysInFlight = new Map<string, Promise<ReplayResult>>();

type LockManagerLike = { request: (name: string, opts: { ifAvailable: boolean }, cb: (lock: unknown) => Promise<ReplayResult>) => Promise<ReplayResult> };

function lockManager(): LockManagerLike | null {
  try {
    const nav = (globalThis as { navigator?: { locks?: LockManagerLike } }).navigator;
    return nav?.locks && typeof nav.locks.request === 'function' ? nav.locks : null;
  } catch {
    return null;
  }
}

/** Replays the verified account's queue. Never throws. */
export function replayOfflineQueue(fetchImpl: typeof fetch = fetch): Promise<ReplayResult> {
  const account = getVerifiedAccount();
  if (!account || isTransitionActive()) {
    return Promise.resolve({ attempted: 0, confirmed: 0, removed: 0, stoppedBecause: 'unavailable' });
  }
  const existing = replaysInFlight.get(account);
  if (existing) return existing;
  const run = async (): Promise<ReplayResult> => {
    const locks = lockManager();
    if (!locks) return replayLocked(fetchImpl);
    return locks.request(`aura-habit-replay:${account}`, { ifAvailable: true }, async (lock) =>
      lock ? replayLocked(fetchImpl) : { attempted: 0, confirmed: 0, removed: 0, stoppedBecause: 'busy' as const }
    );
  };
  const p = run()
    .catch((err) =>
      err instanceof AccountUnavailableError
        ? ({ attempted: 0, confirmed: 0, removed: 0, stoppedBecause: 'unavailable' } as ReplayResult)
        : ({ attempted: 0, confirmed: 0, removed: 0, stoppedBecause: 'account-changed' } as ReplayResult)
    )
    .finally(() => replaysInFlight.delete(account));
  replaysInFlight.set(account, p);
  return p;
}

async function replayLocked(fetchImpl: typeof fetch): Promise<ReplayResult> {
  return runActivityOperation(async (lease) => {
    const result: ReplayResult = { attempted: 0, confirmed: 0, removed: 0, stoppedBecause: null };
    const read = readOwnedQueue(lease.account);
    if (!read.ok) return { ...result, stoppedBecause: 'unreadable' };
    const settled: string[] = [];
    try {
      for (const item of read.items as OwnedQueuedHabitLog[]) {
        if (!lease.isCurrent()) { result.stoppedBecause = 'account-changed'; break; }
        const { tempId: _tempId, ownerUserId: _owner, ...payload } = item;
        result.attempted++;
        let status: number | 'network-error';
        try {
          const res = await post(lease, fetchImpl, payload);
          status = res.status;
        } catch {
          status = 'network-error';
        }
        if (typeof status === 'number' && ACCOUNT_HOLD.has(status)) {
          // Keep the entry for its owner and stop: this session can't write it.
          result.stoppedBecause = 'account-hold';
          break;
        }
        const outcome = classifyHabitLogSyncOutcome(status);
        if (outcome === 'confirmed') { settled.push(item.clientRequestId); result.confirmed++; }
        else if (outcome === 'permanent-failure') settled.push(item.clientRequestId);
        // 'retry' stays queued.
      }
    } finally {
      // Remove only what was settled; anything enqueued meanwhile survives.
      if (settled.length > 0 && removeOwnedEntries(lease.account, settled)) result.removed = settled.length;
    }
    return result;
  });
}

/** Test-only. */
export function __resetActivitySyncForTests() {
  replaysInFlight.clear();
}
