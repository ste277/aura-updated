import type { LoggedEntryItem } from '../components/CalendarViewSection';

/**
 * Pending Activity Reload Visibility V1 -- the shape page.tsx's own
 * handleLogActivity has always queued
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
 * AURA-ANDROID-REL-04 IR-01 / IR-03 (R4) -- durable offline activity queue on
 * IndexedDB.
 *
 * WHY IndexedDB (decision, R4; reverses the R3 localStorage design): the
 * remaining queue findings are all check-then-act races between browsing
 * contexts (migration: "no tombstone" then "write"; replay: "still queued"
 * then "send"; discard vs. a send already under way). localStorage has no
 * atomic compare-and-set across tabs, so without Web Locks those races cannot
 * be closed there. An IndexedDB readwrite transaction is atomic and is
 * serialized against every other overlapping readwrite transaction of the
 * origin (all tabs, all contexts) -- with or without Web Locks. Every
 * lifecycle step below is ONE such transaction.
 *
 * Stores (database `aura-offline`, version 1):
 *   records     recordId -> { recordId, ownerUserId, clientRequestId, item, queuedAt }   (immutable once written)
 *   claims      recordId -> { recordId, tab, at }      a context is sending it now (expires after CLAIM_TTL_MS)
 *   dispatches  recordId -> { recordId, attempts, lastAt }   it has been handed to the network at least once
 *   tombstones  recordId -> { recordId, ownerUserId, at }    settled/discarded: no migration may recreate it
 *
 * Lifecycle guarantees:
 *   create     enqueue checks identity and writes the record (+ the caller's claim) in one transaction:
 *              one clientRequestId = one payload; a different payload is refused ('conflict').
 *   dispatch   a record is sent only after claimForDispatch() atomically confirmed it still exists and no
 *              other context holds a fresh claim, and recorded the dispatch. No await separates the
 *              caller's final account check from the send.
 *   settle     removes exactly the given records (+ claims, dispatch marks) and writes tombstones, atomically.
 *   discard    atomically removes the confirmed records EXCEPT ones another context is sending right now
 *              (kept, reported). Records already dispatched are removed but reported as "may already have
 *              been saved": a local discard never undoes what the server accepted.
 *   migration  each owned interim-format entry (localStorage: R1 `offline_habit_queue_v2:<owner>`, R2
 *              `aura_q3:<owner>:<crid>`, R3 `aura_q4:<owner>:<crid>:<recordId>`) is copied under a
 *              deterministic recordId in one transaction that first checks the record and its tombstone,
 *              so a concurrent or repeated migration can never recreate a settled entry; the source is
 *              removed only after that transaction committed (re-running is idempotent).
 *   failures   any IndexedDB failure => reads report `ok:false` (unreadable, never "empty"), writes report
 *              'failed'. There is NO fallback to localStorage or memory.
 *   interrupt  a context that dies while sending leaves a claim that expires; the record is then sent
 *              again with the same clientRequestId, which the server de-duplicates.
 */
export const LEGACY_QUEUE_KEY = 'offline_habit_queue';
export const QUEUE_V2_PREFIX = 'offline_habit_queue_v2:';
export const QUEUE_V3_PREFIX = 'aura_q3:';
export const QUEUE_V4_PREFIX = 'aura_q4:';
export const TOMBSTONE_V4_PREFIX = 'aura_q4t:';
export const QUEUE_DB_NAME = 'aura-offline';
export const QUEUE_DB_VERSION = 1;
export const CLAIM_TTL_MS = 60_000;
const TOMBSTONE_TTL_MS = 30 * 24 * 3600_000;

export interface OwnedQueuedHabitLog extends QueuedHabitLog {
  ownerUserId: string;
  recordId?: string;
  queuedAt?: number;
}

export interface QueueRecord {
  recordId: string;
  item: OwnedQueuedHabitLog;
  /** Another (or this) context is sending it now. */
  inFlight: boolean;
  /** Handed to the network at least once (the server may have accepted it). */
  dispatched: boolean;
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
      /** clientRequestIds with conflicting payloads (quarantined, never sent). */
      conflicts: string[];
      /** recordIds whose value is not a valid entry (kept, counted, discardable). */
      corruptIds: string[];
    }
  | { ok: false };

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

/** Deterministic id for an entry migrated from an interim format. */
export function migratedRecordId(item: QueuedHabitLog): string {
  return 'm' + hash(`${item.clientRequestId}|${canonicalPayload(item)}`);
}

// ------------------------------------------------------------------ IndexedDB plumbing

type Stored = { recordId: string; ownerUserId: string; clientRequestId: string; item: OwnedQueuedHabitLog; queuedAt: number };
type Claim = { recordId: string; tab: string; at: number };
type Dispatch = { recordId: string; attempts: number; lastAt: number };
type Tomb = { recordId: string; ownerUserId: string; at: number };
const STORES = ['records', 'claims', 'dispatches', 'tombstones'] as const;

let dbPromise: Promise<IDBDatabase> | null = null;

function idb(): IDBFactory | null {
  try {
    return typeof indexedDB === 'undefined' ? null : indexedDB;
  } catch {
    return null;
  }
}

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  const factory = idb();
  if (!factory) return Promise.reject(new Error('IndexedDB unavailable'));
  const p = new Promise<IDBDatabase>((resolve, reject) => {
    let req: IDBOpenDBRequest;
    try { req = factory.open(QUEUE_DB_NAME, QUEUE_DB_VERSION); } catch (e) { reject(e); return; }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('records')) {
        const r = db.createObjectStore('records', { keyPath: 'recordId' });
        r.createIndex('owner', 'ownerUserId');
        r.createIndex('ownerCrid', ['ownerUserId', 'clientRequestId']);
      }
      if (!db.objectStoreNames.contains('claims')) db.createObjectStore('claims', { keyPath: 'recordId' });
      if (!db.objectStoreNames.contains('dispatches')) db.createObjectStore('dispatches', { keyPath: 'recordId' });
      if (!db.objectStoreNames.contains('tombstones')) db.createObjectStore('tombstones', { keyPath: 'recordId' }).createIndex('owner', 'ownerUserId');
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => { db.close(); dbPromise = null; };
      db.onclose = () => { dbPromise = null; };
      resolve(db);
    };
    req.onerror = () => reject(req.error ?? new Error('open failed'));
    req.onblocked = () => reject(new Error('open blocked'));
  });
  dbPromise = p;
  p.catch(() => { if (dbPromise === p) dbPromise = null; });
  return p;
}

const asPromise = <T>(r: IDBRequest<T>) => new Promise<T>((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });

/**
 * Runs `body` inside ONE transaction over all queue stores and resolves with
 * its value only after the transaction COMMITTED (oncomplete). Any failure
 * (open, request, abort, quota) rejects.
 */
async function tx<T>(mode: IDBTransactionMode, body: (s: Record<(typeof STORES)[number], IDBObjectStore>) => Promise<T>): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    let t: IDBTransaction;
    try { t = db.transaction(STORES as unknown as string[], mode); } catch (e) { reject(e); return; }
    const stores = Object.fromEntries(STORES.map((n) => [n, t.objectStore(n)])) as Record<(typeof STORES)[number], IDBObjectStore>;
    let value: T;
    let failed: unknown = null;
    t.oncomplete = () => (failed ? reject(failed) : resolve(value));
    t.onerror = () => reject(t.error ?? failed ?? new Error('transaction error'));
    t.onabort = () => reject(t.error ?? failed ?? new Error('transaction aborted'));
    body(stores).then((v) => { value = v; }, (e) => { failed = e; try { t.abort(); } catch { /* already finished */ } });
  });
}

function storageOrNull(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function keysWithPrefix(s: Storage, prefix: string): string[] {
  const out: string[] = [];
  const n = s.length;
  for (let i = 0; i < n; i++) {
    const k = s.key(i);
    if (k && k.startsWith(prefix)) out.push(k);
  }
  return out;
}

const fresh = (c: Claim | undefined, now: number) => Boolean(c && now - c.at < CLAIM_TTL_MS && c.at <= now + 5_000);

// ------------------------------------------------------------------ migration (owned interim formats)

interface MigrationSource { key: string; candidates: Array<{ recordId: string; item: OwnedQueuedHabitLog }>; tombstoned: Set<string> }

/** Reads the owner's localStorage interim sources. Throws if storage throws. */
function collectSources(owner: string): MigrationSource[] {
  const s = storageOrNull();
  if (!s) return [];
  const out: MigrationSource[] = [];
  const lsTombs = new Set(keysWithPrefix(s, `${TOMBSTONE_V4_PREFIX}${owner}:`).map((k) => k.slice(`${TOMBSTONE_V4_PREFIX}${owner}:`.length)));
  const valid = (v: unknown): v is OwnedQueuedHabitLog => isQueuedHabitLog(v) && (v as OwnedQueuedHabitLog).ownerUserId === owner;
  for (const key of keysWithPrefix(s, `${QUEUE_V4_PREFIX}${owner}:`)) {
    const raw = s.getItem(key);
    if (raw === null) continue;
    let v: unknown; try { v = JSON.parse(raw); } catch { continue; } // unparseable: left in place, never guessed at
    if (!valid(v) || !v.recordId) continue;
    out.push({ key, candidates: [{ recordId: v.recordId, item: v }], tombstoned: lsTombs });
  }
  for (const key of keysWithPrefix(s, `${QUEUE_V3_PREFIX}${owner}:`)) {
    const raw = s.getItem(key);
    if (raw === null) continue;
    let v: unknown; try { v = JSON.parse(raw); } catch { continue; }
    if (!valid(v)) continue;
    out.push({ key, candidates: [{ recordId: migratedRecordId(v), item: v }], tombstoned: lsTombs });
  }
  const v2 = s.getItem(QUEUE_V2_PREFIX + owner);
  if (v2 !== null) {
    let arr: unknown; try { arr = JSON.parse(v2); } catch { arr = null; }
    if (Array.isArray(arr) && arr.every(valid)) out.push({ key: QUEUE_V2_PREFIX + owner, candidates: arr.map((item) => ({ recordId: migratedRecordId(item), item })), tombstoned: lsTombs });
  }
  return out;
}

/** Interruption-safe, idempotent migration. Rejects if storage fails (the queue is then unreadable). */
async function migrateOwnedSources(owner: string): Promise<void> {
  const sources = collectSources(owner);
  if (sources.length === 0) return;
  await tx('readwrite', async (st) => {
    for (const src of sources) {
      for (const c of src.candidates) {
        if (src.tombstoned.has(c.recordId)) continue;
        if (await asPromise(st.tombstones.get(c.recordId))) continue; // settled or discarded before
        if (await asPromise(st.records.get(c.recordId))) continue; // already migrated
        const rec: Stored = { recordId: c.recordId, ownerUserId: owner, clientRequestId: c.item.clientRequestId, item: { ...c.item, recordId: c.recordId }, queuedAt: c.item.queuedAt ?? 0 };
        await asPromise(st.records.add(rec));
      }
    }
  });
  // Committed: only now remove the sources (each removal verified; a failure just re-runs idempotently).
  const s = storageOrNull();
  if (!s) return;
  for (const src of sources) { try { s.removeItem(src.key); } catch { /* re-run later */ } }
  try {
    if (keysWithPrefix(s, `${QUEUE_V4_PREFIX}${owner}:`).length === 0 && keysWithPrefix(s, `${QUEUE_V3_PREFIX}${owner}:`).length === 0 && s.getItem(QUEUE_V2_PREFIX + owner) === null) {
      for (const t of keysWithPrefix(s, `${TOMBSTONE_V4_PREFIX}${owner}:`)) s.removeItem(t);
    }
  } catch { /* best effort */ }
}

// ------------------------------------------------------------------ reads

/** The owner's queue. `ok:false` when storage is unavailable or ANY step fails. */
export async function readOwnedQueue(ownerUserId: string): Promise<QueueRead> {
  try {
    await migrateOwnedSources(ownerUserId);
    const now = Date.now();
    const { stored, claims, dispatches } = await tx('readonly', async (st) => {
      const stored = (await asPromise(st.records.index('owner').getAll(IDBKeyRange.only(ownerUserId)))) as Stored[];
      const claims = new Map<string, Claim>();
      const dispatches = new Set<string>();
      for (const r of stored) {
        const c = (await asPromise(st.claims.get(r.recordId))) as Claim | undefined;
        if (c) claims.set(r.recordId, c);
        if (await asPromise(st.dispatches.get(r.recordId))) dispatches.add(r.recordId);
      }
      return { stored, claims, dispatches };
    });
    const records: QueueRecord[] = [];
    const corruptIds: string[] = [];
    for (const r of stored) {
      const item = r.item;
      if (!isQueuedHabitLog(item) || item.ownerUserId !== ownerUserId || item.clientRequestId !== r.clientRequestId) { corruptIds.push(r.recordId); continue; }
      records.push({ recordId: r.recordId, item: { ...item, recordId: r.recordId, queuedAt: r.queuedAt }, inFlight: fresh(claims.get(r.recordId), now), dispatched: dispatches.has(r.recordId) });
    }
    // Deterministic order: queued time, then log time, then identity (entries queued in the same millisecond).
    records.sort((a, b) => (a.item.queuedAt ?? 0) - (b.item.queuedAt ?? 0) || a.item.logTimestamp.localeCompare(b.item.logTimestamp) || a.item.clientRequestId.localeCompare(b.item.clientRequestId) || a.recordId.localeCompare(b.recordId));
    const byCrid = new Map<string, QueueRecord[]>();
    for (const r of records) byCrid.set(r.item.clientRequestId, [...(byCrid.get(r.item.clientRequestId) ?? []), r]);
    const groups: QueueRecord[][] = [];
    const conflicts: string[] = [];
    for (const [crid, rs] of byCrid) {
      if (new Set(rs.map((r) => canonicalPayload(r.item))).size > 1) conflicts.push(crid);
      else groups.push(rs);
    }
    return { ok: true, items: groups.map((g) => g[0].item), records, groups, conflicts, corruptIds };
  } catch {
    return { ok: false };
  }
}

/** Presentation read: the owner's entries, or [] if unreadable. */
export async function readOfflineHabitQueue(ownerUserId: string | null | undefined): Promise<OwnedQueuedHabitLog[]> {
  if (!ownerUserId) return [];
  const r = await readOwnedQueue(ownerUserId);
  return r.ok ? r.items : [];
}

// ------------------------------------------------------------------ writes

export type EnqueueResult =
  | { status: 'stored'; recordId: string; claimed: boolean }
  | { status: 'conflict' }
  | { status: 'failed' };

/**
 * Stores one record for its owner, atomically with the identity check and
 * (claimFor) the sender's claim. An identical payload already queued under
 * the same identity is reused; it is claimed only if no context is sending it
 * now. A different payload under the same identity is refused ('conflict').
 */
export async function enqueueOwned(item: OwnedQueuedHabitLog, { claimFor }: { claimFor?: string } = {}): Promise<EnqueueResult> {
  if (!item.ownerUserId || !item.clientRequestId) return { status: 'failed' };
  try {
    await migrateOwnedSources(item.ownerUserId);
    const now = Date.now();
    return await tx('readwrite', async (st) => {
      const same = (await asPromise(st.records.index('ownerCrid').getAll(IDBKeyRange.only([item.ownerUserId, item.clientRequestId])))) as Stored[];
      const mine = canonicalPayload(item);
      if (same.some((r) => !isQueuedHabitLog(r.item) || canonicalPayload(r.item) !== mine)) return { status: 'conflict' } as const;
      let recordId: string;
      if (same.length > 0) {
        recordId = same[0].recordId;
      } else {
        recordId = item.recordId ?? randomId();
        const rec: Stored = { recordId, ownerUserId: item.ownerUserId, clientRequestId: item.clientRequestId, item: { ...item, recordId }, queuedAt: now };
        await asPromise(st.records.add(rec));
      }
      if (!claimFor) return { status: 'stored', recordId, claimed: false } as const;
      const existing = (await asPromise(st.claims.get(recordId))) as Claim | undefined;
      if (fresh(existing, now)) return { status: 'stored', recordId, claimed: false } as const;
      await asPromise(st.claims.put({ recordId, tab: claimFor, at: now } satisfies Claim));
      const d = (await asPromise(st.dispatches.get(recordId))) as Dispatch | undefined;
      await asPromise(st.dispatches.put({ recordId, attempts: (d?.attempts ?? 0) + 1, lastAt: now } satisfies Dispatch));
      return { status: 'stored', recordId, claimed: true } as const;
    });
  } catch {
    return { status: 'failed' };
  }
}

export type ClaimResult = 'claimed' | 'gone' | 'in-flight' | 'failed';

/**
 * Atomically: the record still exists, no context holds a fresh claim -> this
 * context claims it and the dispatch is recorded (conservatively, before the
 * send). Only 'claimed' permits sending.
 */
export async function claimForDispatch(recordId: string, tab: string): Promise<ClaimResult> {
  try {
    const now = Date.now();
    return await tx('readwrite', async (st) => {
      if (!(await asPromise(st.records.get(recordId)))) return 'gone' as const;
      if (fresh((await asPromise(st.claims.get(recordId))) as Claim | undefined, now)) return 'in-flight' as const;
      await asPromise(st.claims.put({ recordId, tab, at: now } satisfies Claim));
      const d = (await asPromise(st.dispatches.get(recordId))) as Dispatch | undefined;
      await asPromise(st.dispatches.put({ recordId, attempts: (d?.attempts ?? 0) + 1, lastAt: now } satisfies Dispatch));
      return 'claimed' as const;
    });
  } catch {
    return 'failed';
  }
}

/** Releases this context's claim (the send was unresolved; the record stays queued). */
export async function releaseClaim(recordId: string, tab: string): Promise<void> {
  try {
    await tx('readwrite', async (st) => {
      const c = (await asPromise(st.claims.get(recordId))) as Claim | undefined;
      if (c && c.tab === tab) await asPromise(st.claims.delete(recordId));
    });
  } catch {
    /* the claim expires on its own */
  }
}

export interface RemovalResult { removed: number; alreadyGone: number; failed: number }

/** Settlement: removes exactly these records (with claims and dispatch marks) and tombstones them, atomically. */
export async function settleRecords(recordIds: Iterable<string>): Promise<RemovalResult> {
  const ids = [...recordIds];
  try {
    const now = Date.now();
    return await tx('readwrite', async (st) => {
      const out: RemovalResult = { removed: 0, alreadyGone: 0, failed: 0 };
      for (const id of ids) {
        const rec = (await asPromise(st.records.get(id))) as Stored | undefined;
        if (!rec) { out.alreadyGone++; continue; }
        await asPromise(st.records.delete(id));
        await asPromise(st.claims.delete(id));
        await asPromise(st.dispatches.delete(id));
        await asPromise(st.tombstones.put({ recordId: id, ownerUserId: rec.ownerUserId, at: now } satisfies Tomb));
        out.removed++;
      }
      return out;
    });
  } catch {
    return { removed: 0, alreadyGone: 0, failed: ids.length };
  }
}

export interface DiscardResult {
  /** Removed from this device. */
  removed: number;
  /** Of `removed`: had already been handed to the network, so the server may have saved them. */
  removedPossiblySaved: number;
  /** Another context was sending them at that moment: kept for their account. */
  keptInFlight: number;
  alreadyGone: number;
  /** Could not be removed (storage failure): still stored for their account. */
  failed: number;
}

/**
 * A CONFIRMED discard of exactly these records (sign-out). Atomic. Records a
 * context is sending right now are kept (their send decides them); records
 * that were already sent are removed but reported as possibly saved.
 */
export async function discardRecords(recordIds: Iterable<string>, { tab }: { tab: string }): Promise<DiscardResult> {
  const ids = [...recordIds];
  try {
    const now = Date.now();
    return await tx('readwrite', async (st) => {
      const out: DiscardResult = { removed: 0, removedPossiblySaved: 0, keptInFlight: 0, alreadyGone: 0, failed: 0 };
      for (const id of ids) {
        const rec = (await asPromise(st.records.get(id))) as Stored | undefined;
        if (!rec) { out.alreadyGone++; continue; }
        const c = (await asPromise(st.claims.get(id))) as Claim | undefined;
        if (fresh(c, now) && c!.tab !== tab) { out.keptInFlight++; continue; }
        const dispatched = Boolean(await asPromise(st.dispatches.get(id)));
        await asPromise(st.records.delete(id));
        await asPromise(st.claims.delete(id));
        await asPromise(st.dispatches.delete(id));
        await asPromise(st.tombstones.put({ recordId: id, ownerUserId: rec.ownerUserId, at: now } satisfies Tomb));
        out.removed++;
        if (dispatched) out.removedPossiblySaved++;
      }
      // Tombstones are only needed while an interim source could still exist.
      const old = (await asPromise(st.tombstones.getAll())) as Tomb[];
      for (const t of old) if (now - t.at > TOMBSTONE_TTL_MS) await asPromise(st.tombstones.delete(t.recordId));
      return out;
    });
  } catch {
    return { removed: 0, removedPossiblySaved: 0, keptInFlight: 0, alreadyGone: 0, failed: ids.length };
  }
}

// ------------------------------------------------------------------ legacy quarantine (read-only)

export type LegacySnapshot = { ok: true; count: number } | { ok: false };

/**
 * Pre-REL-04 entries (`offline_habit_queue`, a shared array written by OLD
 * bundles) have NO owner. They are QUARANTINED: never replayed, never assigned
 * to any account, never shown. R4: this build never rewrites or removes that
 * array. Old bundles update it with an unsynchronised read-modify-write, and
 * they may still be open in another tab or context; any destructive cleanup
 * here could lose or resurrect their entries. Cleanup is deferred until older
 * writers can no longer be active (an activation-dependent decision); until
 * then the entries are kept and only counted.
 */
export function readLegacySnapshot(): LegacySnapshot {
  const s = storageOrNull();
  if (!s) return { ok: false };
  try {
    const raw = s.getItem(LEGACY_QUEUE_KEY);
    if (raw === null) return { ok: true, count: 0 };
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? { ok: true, count: parsed.length } : { ok: false };
  } catch {
    return { ok: false };
  }
}

/** Number of quarantined legacy entries; null if unreadable. */
export function legacyQueueCount(): number | null {
  const r = readLegacySnapshot();
  return r.ok ? r.count : null;
}

/** Test-only: the queue database (same schema/connection the module uses). */
export function __openQueueDbForTests(): Promise<IDBDatabase> { return openDb(); }

/** Test-only: forget the cached connection (e.g. after replacing the IndexedDB factory). */
export async function __resetQueueDbForTests(): Promise<void> {
  const p = dbPromise;
  dbPromise = null;
  if (p) { try { (await p).close(); } catch { /* ignore */ } }
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
