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
 * AURA-ANDROID-REL-04 IR-01 (R2) -- the queue is partitioned by VERIFIED
 * account and stored ONE ENTRY PER KEY:
 *
 *     aura_q3:<ownerUserId>:<clientRequestId>  ->  JSON entry (with ownerUserId)
 *
 * so every mutation is a single, atomic storage operation:
 *   enqueue  = setItem(one key)         settle/remove = removeItem(one key)
 *   snapshot = the set of keys present  discard       = removeItem of exactly
 *                                                       the snapshot's keys
 * No read-modify-write of a shared array exists, so concurrent tabs (with or
 * without Web Locks) cannot lose an appended entry, resurrect a settled one,
 * or delete work added after a discard was confirmed. Web Locks are used
 * only to keep two tabs from replaying the same account at once; without
 * them a duplicate replay is harmless (the server de-duplicates by
 * clientRequestId).
 *
 * The pre-REL-04 key (`offline_habit_queue`) holds entries with NO owner.
 * Their owner is never inferred: they stay QUARANTINED until the user
 * explicitly discards them or explicitly adds them to the signed-in account.
 * The interim array format of the unreleased R1 head
 * (`offline_habit_queue_v2:<owner>`) is migrated entry by entry.
 */
export const LEGACY_QUEUE_KEY = 'offline_habit_queue';
export const QUEUE_V2_PREFIX = 'offline_habit_queue_v2:';
export const QUEUE_PREFIX = 'aura_q3:';

export interface OwnedQueuedHabitLog extends QueuedHabitLog {
  ownerUserId: string;
  /** When it was queued (ordering only). */
  queuedAt?: number;
}

export function queueKeyFor(ownerUserId: string, clientRequestId: string): string {
  return `${QUEUE_PREFIX}${ownerUserId}:${clientRequestId}`;
}
function ownerPrefix(ownerUserId: string) {
  return `${QUEUE_PREFIX}${ownerUserId}:`;
}

export type QueueRead = { ok: true; items: OwnedQueuedHabitLog[]; keys: string[] } | { ok: false };

function storageOrNull(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/**
 * The owner's entries (and their keys = the snapshot). `ok:false` when storage
 * is unavailable or throws -- callers must not treat that as "nothing pending".
 * A malformed entry, or one whose ownerUserId differs, is ignored (not removed).
 */
export function readOwnedQueue(ownerUserId: string): QueueRead {
  const s = storageOrNull();
  if (!s) return { ok: false };
  try {
    migrateV2(s, ownerUserId);
    const prefix = ownerPrefix(ownerUserId);
    const keys: string[] = [];
    for (let i = 0; i < s.length; i++) {
      const k = s.key(i);
      if (k && k.startsWith(prefix)) keys.push(k);
    }
    const found: Array<{ it: OwnedQueuedHabitLog; k: string }> = [];
    for (const k of keys) {
      let v: unknown;
      try { v = JSON.parse(s.getItem(k) ?? 'null'); } catch { continue; }
      if (isQueuedHabitLog(v) && (v as { ownerUserId?: unknown }).ownerUserId === ownerUserId && k === queueKeyFor(ownerUserId, (v as QueuedHabitLog).clientRequestId)) {
        found.push({ it: v as OwnedQueuedHabitLog, k });
      }
    }
    found.sort((a, b) => (a.it.queuedAt ?? 0) - (b.it.queuedAt ?? 0) || a.it.logTimestamp.localeCompare(b.it.logTimestamp));
    return { ok: true, items: found.map((o) => o.it), keys: found.map((o) => o.k) };
  } catch {
    return { ok: false };
  }
}

/** One-time move of the unreleased R1 array format into per-entry keys (idempotent by clientRequestId). */
function migrateV2(s: Storage, ownerUserId: string) {
  const raw = s.getItem(QUEUE_V2_PREFIX + ownerUserId);
  if (!raw) return;
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return; }
  if (!Array.isArray(parsed)) return;
  for (const v of parsed) {
    if (isQueuedHabitLog(v) && (v as { ownerUserId?: unknown }).ownerUserId === ownerUserId) {
      const key = queueKeyFor(ownerUserId, (v as QueuedHabitLog).clientRequestId);
      if (s.getItem(key) === null) s.setItem(key, JSON.stringify(v));
    }
  }
  s.removeItem(QUEUE_V2_PREFIX + ownerUserId);
}

/** Presentation read: the owner's entries, or [] if unreadable. */
export function readOfflineHabitQueue(ownerUserId: string | null | undefined): OwnedQueuedHabitLog[] {
  if (!ownerUserId) return [];
  const r = readOwnedQueue(ownerUserId);
  return r.ok ? r.items : [];
}

/** Stores one entry for its owner (one atomic setItem). false = not stored. */
export function enqueueOwned(item: OwnedQueuedHabitLog): boolean {
  const s = storageOrNull();
  if (!s || !item.ownerUserId || !item.clientRequestId) return false;
  try {
    s.setItem(queueKeyFor(item.ownerUserId, item.clientRequestId), JSON.stringify({ queuedAt: Date.now(), ...item }));
    return true;
  } catch {
    return false;
  }
}

export interface RemovalResult { removed: number; failed: number }

/** Removes exactly these entries (one atomic removeItem each). Reports failures truthfully. */
export function removeOwnedEntries(ownerUserId: string, clientRequestIds: Iterable<string>): RemovalResult {
  return removeKeys([...clientRequestIds].map((id) => queueKeyFor(ownerUserId, id)));
}

/** Removes exactly these keys (a discard snapshot); never touches keys added later. */
export function removeKeys(keys: Iterable<string>): RemovalResult {
  const s = storageOrNull();
  const result: RemovalResult = { removed: 0, failed: 0 };
  for (const k of keys) {
    try {
      if (!s) throw new Error('no storage');
      s.removeItem(k);
      if (s.getItem(k) !== null) throw new Error('still present');
      result.removed++;
    } catch {
      result.failed++;
    }
  }
  return result;
}

/** Quarantined legacy (unowned) entries; null if unreadable. */
export function readLegacyQueue(): unknown[] | null {
  const s = storageOrNull();
  if (!s) return null;
  try {
    const raw = s.getItem(LEGACY_QUEUE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Number of quarantined legacy (unowned) entries; null if unreadable. */
export function legacyQueueCount(): number | null {
  const l = readLegacyQueue();
  return l === null ? null : l.length;
}

/** Explicit discard of the quarantined legacy entries (a user decision). */
export function clearLegacyQueue(): boolean {
  const s = storageOrNull();
  if (!s) return false;
  try {
    s.removeItem(LEGACY_QUEUE_KEY);
    return s.getItem(LEGACY_QUEUE_KEY) === null;
  } catch {
    return false;
  }
}

/**
 * EXPLICIT user decision only ("these are mine -- add them to this account"):
 * copies each valid legacy entry into the account's queue (its original
 * clientRequestId kept, so a copy the server already has is de-duplicated),
 * then removes the legacy key. Never called automatically.
 */
export function adoptLegacyQueue(ownerUserId: string): { adopted: number; skipped: number; ok: boolean } {
  const legacy = readLegacyQueue();
  if (legacy === null) return { adopted: 0, skipped: 0, ok: false };
  let adopted = 0, skipped = 0;
  for (const v of legacy) {
    if (isQueuedHabitLog(v)) {
      if (enqueueOwned({ ...(v as QueuedHabitLog), ownerUserId })) adopted++;
      else return { adopted, skipped, ok: false };
    } else skipped++;
  }
  return { adopted, skipped, ok: clearLegacyQueue() };
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
