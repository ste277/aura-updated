import type { LoggedEntryItem } from '../components/CalendarViewSection';

/**
 * Pending Activity Reload Visibility V1 -- the shape page.tsx's own
 * handleLogActivity has always pushed into localStorage['offline_habit_queue']
 * (its own POST /api/habit-logs payload, plus tempId): unchanged here, this
 * module only reads it. logSource/activitySignificance are re-validated
 * against their known literal sets (never trusted blindly from storage,
 * matching the same defensiveness POST /api/habit-logs itself already
 * applies to the same fields) so a corrupted/hand-edited localStorage
 * value degrades to a safe default instead of producing a malformed
 * LoggedEntryItem.
 */
export interface QueuedHabitLog {
  activityTitle: string;
  activeWindow: string;
  logMinuteOfDay?: number;
  logTimestamp: string;
  notes?: string;
  durationMinutes?: number;
  logSource?: 'AURA_PLANNED' | 'AURA_DO_NOW' | 'MANUAL' | 'OVERRIDE_CAUTION';
  activitySignificance?: 'LOW' | 'MEDIUM' | 'HIGH';
  clientRequestId: string;
  tempId: string;
}

function isValidLogSource(value: unknown): value is NonNullable<QueuedHabitLog['logSource']> {
  return value === 'AURA_PLANNED' || value === 'AURA_DO_NOW' || value === 'MANUAL' || value === 'OVERRIDE_CAUTION';
}
function isValidActivitySignificance(value: unknown): value is NonNullable<QueuedHabitLog['activitySignificance']> {
  return value === 'LOW' || value === 'MEDIUM' || value === 'HIGH';
}
function isQueuedHabitLog(value: unknown): value is QueuedHabitLog {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.activityTitle === 'string' &&
    item.activityTitle.trim().length > 0 &&
    typeof item.clientRequestId === 'string' &&
    item.clientRequestId.trim().length > 0 &&
    typeof item.logTimestamp === 'string' &&
    !isNaN(new Date(item.logTimestamp).getTime())
  );
}

/**
 * AURA-ANDROID-REL-04 IR-01 -- the queue is partitioned by VERIFIED account.
 * Each account's entries live under their own key and carry ownerUserId, so
 * replay for account B can never read account A's entries, a sign-out
 * discards only the signed-out account's entries, and an account switch or
 * session expiry leaves the previous account's entries untouched (they replay
 * only when that account is verified again).
 *
 * The pre-REL-04 key (`offline_habit_queue`) holds entries with NO owner.
 * Their owner is never inferred: they are QUARANTINED (never replayed, never
 * shown as the current account's pending work) and removed only through an
 * explicit, confirmed discard (lib/signOut.ts).
 *
 * Every mutation is a synchronous read-modify-write of the latest stored
 * value (localStorage is synchronous within a tab), and replay removes only
 * the ids it settled -- it never writes back a snapshot -- so a concurrent
 * enqueue or a concurrent replay can't be overwritten, and a late completion
 * can't restore a cleared queue.
 */
export const LEGACY_QUEUE_KEY = 'offline_habit_queue';
export const QUEUE_KEY_PREFIX = 'offline_habit_queue_v2:';

export interface OwnedQueuedHabitLog extends QueuedHabitLog {
  ownerUserId: string;
}

export function queueKeyFor(ownerUserId: string): string {
  return QUEUE_KEY_PREFIX + ownerUserId;
}

export type QueueRead = { ok: true; items: OwnedQueuedHabitLog[] } | { ok: false };

function storageOrNull(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/**
 * The owner's entries. `ok:false` when storage is unavailable, throws, or
 * holds something that isn't a queue -- callers must not treat that as
 * "nothing pending". Entries whose ownerUserId differs are ignored.
 */
export function readOwnedQueue(ownerUserId: string): QueueRead {
  const s = storageOrNull();
  if (!s) return { ok: false };
  try {
    const raw = s.getItem(queueKeyFor(ownerUserId));
    if (!raw) return { ok: true, items: [] };
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return { ok: false };
    return {
      ok: true,
      items: parsed.filter((v): v is OwnedQueuedHabitLog => isQueuedHabitLog(v) && (v as { ownerUserId?: unknown }).ownerUserId === ownerUserId),
    };
  } catch {
    return { ok: false };
  }
}

/** Presentation read: the owner's entries, or [] if unreadable. */
export function readOfflineHabitQueue(ownerUserId: string | null | undefined): OwnedQueuedHabitLog[] {
  if (!ownerUserId) return [];
  const r = readOwnedQueue(ownerUserId);
  return r.ok ? r.items : [];
}

function writeOwned(s: Storage, ownerUserId: string, items: OwnedQueuedHabitLog[]) {
  if (items.length === 0) s.removeItem(queueKeyFor(ownerUserId));
  else s.setItem(queueKeyFor(ownerUserId), JSON.stringify(items));
}

/** Appends one entry for its owner. false = not stored (storage unavailable/full/corrupt). */
export function enqueueOwned(item: OwnedQueuedHabitLog): boolean {
  const s = storageOrNull();
  if (!s || !item.ownerUserId) return false;
  const current = readOwnedQueue(item.ownerUserId);
  if (!current.ok) return false;
  try {
    const items = current.items.filter((i) => i.clientRequestId !== item.clientRequestId);
    items.push(item);
    writeOwned(s, item.ownerUserId, items);
    return true;
  } catch {
    return false;
  }
}

/** Removes exactly these clientRequestIds from the owner's latest stored queue. */
export function removeOwnedEntries(ownerUserId: string, clientRequestIds: Iterable<string>): boolean {
  const s = storageOrNull();
  if (!s) return false;
  const ids = new Set(clientRequestIds);
  if (ids.size === 0) return true;
  const current = readOwnedQueue(ownerUserId);
  if (!current.ok) return false;
  try {
    writeOwned(s, ownerUserId, current.items.filter((i) => !ids.has(i.clientRequestId)));
    return true;
  } catch {
    return false;
  }
}

/** Discards the owner's whole queue (confirmed sign-out only). */
export function clearOwnedQueue(ownerUserId: string): boolean {
  const s = storageOrNull();
  if (!s) return false;
  try {
    s.removeItem(queueKeyFor(ownerUserId));
    return true;
  } catch {
    return false;
  }
}

/** Number of quarantined legacy (unowned) entries; null if unreadable. */
export function legacyQueueCount(): number | null {
  const s = storageOrNull();
  if (!s) return null;
  try {
    const raw = s.getItem(LEGACY_QUEUE_KEY);
    if (!raw) return 0;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.length : null;
  } catch {
    return null;
  }
}

export function clearLegacyQueue(): boolean {
  const s = storageOrNull();
  if (!s) return false;
  try {
    s.removeItem(LEGACY_QUEUE_KEY);
    return true;
  } catch {
    return false;
  }
}

/**
 * The reload-reconstruction counterpart to handleLogActivity's own
 * optimisticEntry literal (page.tsx) -- deliberately a separate mapper
 * rather than a shared one: the live optimistic path derives its fields
 * from function arguments mid-call (targetDate, calculatedMinute,
 * finalLogSource, ...), this derives the identical LoggedEntryItem shape
 * from the already-serialized queue payload. clientRequestId is reused
 * verbatim as both the entry's id and its own clientRequestId field --
 * never a newly generated identity -- so reconstructing the same
 * still-queued item on repeated reloads always produces the same logical
 * pending entry.
 */
export function toPendingLoggedEntry(item: QueuedHabitLog): LoggedEntryItem {
  return {
    id: item.clientRequestId,
    activityTitle: item.activityTitle,
    activeWindow: item.activeWindow,
    loggedAt: new Date(item.logTimestamp),
    logMinuteOfDay: item.logMinuteOfDay,
    durationMinutes: item.durationMinutes,
    notes: item.notes ?? null,
    logSource: isValidLogSource(item.logSource) ? item.logSource : 'MANUAL',
    activitySignificance: isValidActivitySignificance(item.activitySignificance) ? item.activitySignificance : 'MEDIUM',
    syncStatus: 'pending',
    clientRequestId: item.clientRequestId,
  };
}

/**
 * The decision behind page.tsx's loadUserDataAndLogs merge, extracted so
 * it's a real, independently testable function rather than logic buried
 * inside a useCallback closure. confirmedEntries always survive
 * unconditionally (server truth). A previously-pending row from
 * prevLogEntries survives alongside them only if it is BOTH not yet
 * confirmed (its clientRequestId doesn't appear among confirmedEntries)
 * AND still genuinely present in the live offline queue
 * (queuedClientRequestIds) -- the second condition is what lets a
 * permanently-rejected (4xx) replay's now-queue-removed stale row get
 * correctly cleared here, exactly as the pre-reload-visibility hard
 * replace already did (PR #86's own invariant), while a still-retryable
 * (5xx/network) entry, still in the queue, is preserved.
 */
export function mergeConfirmedLogEntries(
  confirmedEntries: LoggedEntryItem[],
  prevLogEntries: LoggedEntryItem[],
  queuedClientRequestIds: Set<string>
): LoggedEntryItem[] {
  const confirmedClientRequestIds = new Set(
    confirmedEntries.map((entry) => entry.clientRequestId).filter((id): id is string => Boolean(id))
  );
  const stillPendingLocalOnly = prevLogEntries.filter(
    (item) =>
      item.syncStatus === 'pending' &&
      !(item.clientRequestId && confirmedClientRequestIds.has(item.clientRequestId)) &&
      Boolean(item.clientRequestId && queuedClientRequestIds.has(item.clientRequestId))
  );
  return [...confirmedEntries, ...stillPendingLocalOnly];
}

/**
 * The decision behind page.tsx's reload-reconstruction effect, extracted
 * for the same reason as mergeConfirmedLogEntries above. A queued item is
 * only worth reconstructing into a new pending presentation row if it
 * isn't already represented in logEntries -- neither as an identical id
 * (already reconstructed, or a live optimistic entry sharing the same
 * clientRequestId) nor as an already-confirmed entry (strong
 * clientRequestId match only; deliberately no title/timestamp
 * heuristic).
 */
export function selectQueueItemsToReconstruct(
  queued: QueuedHabitLog[],
  existingLogEntries: LoggedEntryItem[]
): QueuedHabitLog[] {
  const existingIds = new Set(existingLogEntries.map((item) => item.id));
  const confirmedClientRequestIds = new Set(
    existingLogEntries
      .filter((item) => item.syncStatus !== 'pending' && item.clientRequestId)
      .map((item) => item.clientRequestId as string)
  );
  return queued.filter((item) => !existingIds.has(item.clientRequestId) && !confirmedClientRequestIds.has(item.clientRequestId));
}
