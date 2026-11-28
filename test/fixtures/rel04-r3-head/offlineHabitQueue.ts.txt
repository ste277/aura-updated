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
 * AURA-ANDROID-REL-04 IR-01 (R3) -- durable offline activity queue.
 *
 * Storage: one IMMUTABLE record per key, written exactly once:
 *     aura_q4:<ownerUserId>:<clientRequestId>:<recordId>  ->  JSON record
 * A record is never rewritten, so:
 *   - settlement and discard remove EXACT keys and can never remove a
 *     different or newer payload (that would have another recordId);
 *   - every mutation is a single atomic setItem/removeItem -- no shared array,
 *     no read-modify-write, no dependency on Web Locks for integrity.
 * Identity: one clientRequestId = one payload. An enqueue whose identity
 * already exists with a DIFFERENT payload is refused ('conflict'); records
 * that conflict anyway (e.g. written by different builds) are QUARANTINED
 * from replay and reported, never sent.
 * Reads: any storage exception => `ok:false` ("unreadable"), never an empty
 * queue. A record that cannot be parsed is kept and counted as corrupt.
 * Migration (owned interim formats only: the unreleased R1 array
 * `offline_habit_queue_v2:<owner>` and R2 per-entry `aura_q3:<owner>:<crid>`;
 * both carry ownerUserId under the owner's own key, i.e. trustworthy
 * ownership): each source entry is copied to a DETERMINISTIC recordId
 * (m + content hash), so re-running after an interruption is idempotent;
 * settling or discarding a migrated record first writes a TOMBSTONE
 * (aura_q4t:<owner>:<recordId>), so a concurrent or repeated migration can
 * never recreate it; the source is removed only after its copy exists.
 *
 * Why not IndexedDB (evaluated): migration sources live in localStorage, so
 * IndexedDB transactions could not make migration atomic anyway; every
 * synchronous presentation path would become asynchronous; jsdom (the test
 * runtime) has no IndexedDB. Immutable single-key records give the required
 * guarantees in every supported environment, with or without Web Locks.
 * If localStorage itself is unavailable, the queue is unavailable (reported
 * as 'not stored'); there is no fallback to a weaker store.
 */
export const LEGACY_QUEUE_KEY = 'offline_habit_queue';
export const QUEUE_V2_PREFIX = 'offline_habit_queue_v2:';
export const QUEUE_V3_PREFIX = 'aura_q3:';
export const QUEUE_PREFIX = 'aura_q4:';
export const TOMBSTONE_PREFIX = 'aura_q4t:';
const TOMBSTONE_TTL_MS = 30 * 24 * 3600_000;

export interface OwnedQueuedHabitLog extends QueuedHabitLog {
  ownerUserId: string;
  /** Unique per record; 'm…' for migrated records (deterministic). */
  recordId?: string;
  queuedAt?: number;
}

export interface QueueRecord {
  key: string;
  raw: string;
  item: OwnedQueuedHabitLog;
}

export type QueueRead =
  | {
      ok: true;
      /** Presentation: one entry per clientRequestId, excluding conflicts. */
      items: OwnedQueuedHabitLog[];
      /** Every readable record (the discard snapshot). */
      records: QueueRecord[];
      /** Replay groups: identical-payload records per clientRequestId. */
      groups: QueueRecord[][];
      /** clientRequestIds with conflicting payloads (quarantined). */
      conflicts: string[];
      /** Keys that could not be parsed (kept, counted). */
      corruptKeys: string[];
    }
  | { ok: false };

function storageOrNull(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** The payload that defines a request identity (no bookkeeping fields). */
export function canonicalPayload(v: QueuedHabitLog): string {
  const { tempId: _t, ...rest } = v as QueuedHabitLog & Record<string, unknown>;
  const r = rest as Record<string, unknown>;
  delete r.ownerUserId; delete r.recordId; delete r.queuedAt;
  return JSON.stringify(Object.keys(r).sort().reduce<Record<string, unknown>>((o, k) => { if (r[k] !== undefined) o[k] = r[k]; return o; }, {}));
}

function hash(text: string): string {
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x5bd1e995) >>> 0;
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}

function randomId(): string {
  try {
    const a = new Uint32Array(2);
    (globalThis.crypto as Crypto).getRandomValues(a);
    return a[0].toString(16).padStart(8, '0') + a[1].toString(16).padStart(8, '0');
  } catch {
    return Math.random().toString(16).slice(2, 10) + Date.now().toString(16);
  }
}

export function recordKey(ownerUserId: string, clientRequestId: string, recordId: string): string {
  return `${QUEUE_PREFIX}${ownerUserId}:${clientRequestId}:${recordId}`;
}
const ownerPrefix = (owner: string) => `${QUEUE_PREFIX}${owner}:`;
const tombstoneKey = (owner: string, recordId: string) => `${TOMBSTONE_PREFIX}${owner}:${recordId}`;

function keysWithPrefix(s: Storage, prefix: string): string[] {
  const out: string[] = [];
  const n = s.length;
  for (let i = 0; i < n; i++) {
    const k = s.key(i);
    if (k && k.startsWith(prefix)) out.push(k);
  }
  return out;
}

/** The owner's queue. `ok:false` when storage is unavailable or ANY read throws. */
export function readOwnedQueue(ownerUserId: string): QueueRead {
  const s = storageOrNull();
  if (!s) return { ok: false };
  try {
    migrateOwnedSources(s, ownerUserId);
    const records: QueueRecord[] = [];
    const corruptKeys: string[] = [];
    for (const key of keysWithPrefix(s, ownerPrefix(ownerUserId))) {
      const raw = s.getItem(key); // a throw here => unreadable (outer catch)
      if (raw === null) continue; // removed meanwhile
      let v: unknown;
      try { v = JSON.parse(raw); } catch { corruptKeys.push(key); continue; }
      const item = v as OwnedQueuedHabitLog;
      if (!isQueuedHabitLog(v) || item.ownerUserId !== ownerUserId || !key.startsWith(`${ownerPrefix(ownerUserId)}${item.clientRequestId}:`)) { corruptKeys.push(key); continue; }
      records.push({ key, raw, item });
    }
    records.sort((a, b) => (a.item.queuedAt ?? 0) - (b.item.queuedAt ?? 0) || a.item.logTimestamp.localeCompare(b.item.logTimestamp) || a.key.localeCompare(b.key));
    const byCrid = new Map<string, QueueRecord[]>();
    for (const r of records) byCrid.set(r.item.clientRequestId, [...(byCrid.get(r.item.clientRequestId) ?? []), r]);
    const groups: QueueRecord[][] = [];
    const conflicts: string[] = [];
    for (const [crid, rs] of byCrid) {
      const payloads = new Set(rs.map((r) => canonicalPayload(r.item)));
      if (payloads.size > 1) conflicts.push(crid);
      else groups.push(rs);
    }
    return { ok: true, items: groups.map((g) => g[0].item), records, groups, conflicts, corruptKeys };
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

export type EnqueueResult = { status: 'stored'; key: string } | { status: 'conflict' } | { status: 'failed' };

/**
 * Stores one record for its owner (one atomic setItem of a NEW key). An
 * identical payload already queued under the same identity is reused
 * ('stored', its key); a different payload under the same identity is
 * refused ('conflict').
 */
export function enqueueOwned(item: OwnedQueuedHabitLog): EnqueueResult {
  const s = storageOrNull();
  if (!s || !item.ownerUserId || !item.clientRequestId) return { status: 'failed' };
  try {
    const mine = canonicalPayload(item);
    for (const k of keysWithPrefix(s, `${ownerPrefix(item.ownerUserId)}${item.clientRequestId}:`)) {
      const raw = s.getItem(k);
      if (raw === null) continue;
      let other: QueuedHabitLog | null = null;
      try { other = JSON.parse(raw); } catch { return { status: 'conflict' }; }
      if (!other || canonicalPayload(other) !== mine) return { status: 'conflict' };
      return { status: 'stored', key: k };
    }
    const recordId = item.recordId ?? randomId();
    const key = recordKey(item.ownerUserId, item.clientRequestId, recordId);
    const raw = JSON.stringify({ queuedAt: Date.now(), ...item, recordId });
    s.setItem(key, raw);
    return s.getItem(key) === raw ? { status: 'stored', key } : { status: 'failed' };
  } catch {
    return { status: 'failed' };
  }
}

export interface RemovalResult { removed: number; alreadyGone: number; failed: number }

/**
 * Removes EXACTLY these records (settlement or a confirmed discard). Each key
 * is immutable, so this can never remove a different or newer payload. A
 * migrated record gets its tombstone first, so no migration can recreate it.
 * Every removal is verified; failures are counted, never hidden.
 */
export function removeRecords(records: Iterable<{ key: string; raw?: string }>): RemovalResult {
  const s = storageOrNull();
  const out: RemovalResult = { removed: 0, alreadyGone: 0, failed: 0 };
  for (const r of records) {
    try {
      if (!s) throw new Error('no storage');
      const current = s.getItem(r.key);
      if (current === null) { out.alreadyGone++; continue; }
      if (r.raw !== undefined && current !== r.raw) throw new Error('record changed'); // immutable: should not happen
      let parsed: OwnedQueuedHabitLog | null = null;
      try { parsed = JSON.parse(current) as OwnedQueuedHabitLog; } catch { parsed = null; } // corrupt: no tombstone needed
      if (parsed?.recordId?.startsWith('m')) {
        const t = tombstoneKey(parsed.ownerUserId, parsed.recordId);
        s.setItem(t, String(Date.now()));
        if (s.getItem(t) === null) throw new Error('tombstone not written');
      }
      s.removeItem(r.key);
      if (s.getItem(r.key) !== null) throw new Error('still present');
      out.removed++;
    } catch {
      out.failed++;
    }
  }
  return out;
}

/** Interruption-safe, idempotent migration of the owner's interim-format entries. */
function migrateOwnedSources(s: Storage, ownerUserId: string) {
  const copy = (v: unknown): boolean => {
    if (!isQueuedHabitLog(v) || (v as OwnedQueuedHabitLog).ownerUserId !== ownerUserId) return true; // not ours / invalid: nothing to copy
    const item = v as OwnedQueuedHabitLog;
    const recordId = 'm' + hash(`${item.clientRequestId}|${canonicalPayload(item)}`);
    if (s.getItem(tombstoneKey(ownerUserId, recordId)) !== null) return true; // settled before
    const key = recordKey(ownerUserId, item.clientRequestId, recordId);
    if (s.getItem(key) !== null) return true; // already copied
    const raw = JSON.stringify({ queuedAt: item.queuedAt ?? 0, ...item, recordId });
    s.setItem(key, raw);
    return s.getItem(key) === raw;
  };
  // R2 per-entry interim records: copy, then remove that source key.
  for (const k of keysWithPrefix(s, `${QUEUE_V3_PREFIX}${ownerUserId}:`)) {
    const raw = s.getItem(k);
    if (raw === null) continue;
    let v: unknown;
    try { v = JSON.parse(raw); } catch { continue; }
    if (copy(v)) s.removeItem(k);
  }
  // R1 array interim record: copy every entry, then remove the source.
  const v2 = s.getItem(QUEUE_V2_PREFIX + ownerUserId);
  if (v2 !== null) {
    let arr: unknown;
    try { arr = JSON.parse(v2); } catch { arr = null; }
    if (Array.isArray(arr) && arr.every((v) => copy(v))) s.removeItem(QUEUE_V2_PREFIX + ownerUserId);
  }
  // Tombstones are only needed while a source could still exist.
  if (keysWithPrefix(s, `${QUEUE_V3_PREFIX}${ownerUserId}:`).length === 0 && s.getItem(QUEUE_V2_PREFIX + ownerUserId) === null) {
    for (const t of keysWithPrefix(s, `${TOMBSTONE_PREFIX}${ownerUserId}:`)) {
      const at = Number(s.getItem(t));
      if (!Number.isFinite(at) || Date.now() - at > TOMBSTONE_TTL_MS) s.removeItem(t);
    }
  }
}

// ------------------------------------------------------------------ legacy quarantine

export type LegacySnapshot = { ok: true; raw: string | null; count: number } | { ok: false };

/**
 * Pre-REL-04 entries (`offline_habit_queue`, written by old bundles) have NO
 * owner. They are QUARANTINED: never replayed, never assigned to any account,
 * never shown (their contents are private to whoever logged them). The only
 * action is an explicit, confirmed DISCARD of the exact snapshot the user
 * confirmed.
 */
export function readLegacySnapshot(): LegacySnapshot {
  const s = storageOrNull();
  if (!s) return { ok: false };
  try {
    const raw = s.getItem(LEGACY_QUEUE_KEY);
    if (raw === null) return { ok: true, raw: null, count: 0 };
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? { ok: true, raw, count: parsed.length } : { ok: false };
  } catch {
    return { ok: false };
  }
}

/** Number of quarantined legacy entries; null if unreadable. */
export function legacyQueueCount(): number | null {
  const r = readLegacySnapshot();
  return r.ok ? r.count : null;
}

export interface LegacyDiscardResult { removed: number; keptAddedLater: number; failed: boolean }

/**
 * Discards exactly the confirmed legacy snapshot. If an old tab added entries
 * after the confirmation, only the confirmed ones are removed and the later
 * ones are kept (and reported). Failures are reported, never hidden.
 */
export function discardLegacySnapshot(snapshot: { raw: string | null }): LegacyDiscardResult {
  const s = storageOrNull();
  if (!s) return { removed: 0, keptAddedLater: 0, failed: true };
  if (snapshot.raw === null) return { removed: 0, keptAddedLater: 0, failed: false };
  try {
    const confirmed: unknown[] = JSON.parse(snapshot.raw);
    const current = s.getItem(LEGACY_QUEUE_KEY);
    if (current === null) return { removed: 0, keptAddedLater: 0, failed: false };
    if (current === snapshot.raw) {
      s.removeItem(LEGACY_QUEUE_KEY);
      return s.getItem(LEGACY_QUEUE_KEY) === null ? { removed: confirmed.length, keptAddedLater: 0, failed: false } : { removed: 0, keptAddedLater: 0, failed: true };
    }
    const now: unknown[] = JSON.parse(current);
    const pool = confirmed.map((v) => JSON.stringify(v));
    const kept = now.filter((v) => {
      const i = pool.indexOf(JSON.stringify(v));
      if (i >= 0) { pool.splice(i, 1); return false; }
      return true;
    });
    const removed = now.length - kept.length;
    if (kept.length === 0) s.removeItem(LEGACY_QUEUE_KEY);
    else s.setItem(LEGACY_QUEUE_KEY, JSON.stringify(kept));
    return { removed, keptAddedLater: kept.length, failed: false };
  } catch {
    return { removed: 0, keptAddedLater: 0, failed: true };
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
