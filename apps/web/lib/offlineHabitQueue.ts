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
 * AURA-ANDROID-REL-04 IR-01 / IR-03 (R4, R5) -- durable offline activity queue
 * on IndexedDB.
 *
 * WHY IndexedDB (decision R4, accepted by the R4 independent disposition): the
 * queue's lifecycle steps are check-then-act operations between browsing
 * contexts. localStorage has no atomic compare-and-set across tabs. An
 * IndexedDB readwrite transaction is atomic and serialized against every
 * other overlapping readwrite transaction of the origin (all tabs and
 * contexts), with or without Web Locks. Every lifecycle step below is ONE
 * such transaction.
 *
 * Stores (database `aura-offline`, version 2):
 *   records     recordId -> { recordId, ownerUserId, clientRequestId, item, queuedAt }   (immutable once written)
 *   claims      key -> { key, ownerUserId, clientRequestId, tab, attempt, at }
 *               ONE claim per LOGICAL request (account + clientRequestId), whatever number of
 *               records carry it; `attempt` identifies one send attempt (expires after CLAIM_TTL_MS)
 *   dispatches  key -> { key, attempts, lastAt }   the request has been handed to the network at least once
 *   tombstones  recordId -> { recordId, ownerUserId, at }   settled/discarded: no migration may recreate it
 * (R5: version 2 re-keys claims and dispatch marks by account + clientRequestId; the
 * version-1 marks are carried over in the upgrade transaction.)
 *
 * Lifecycle guarantees:
 *   create     enqueue checks identity and writes the record (+ the caller's claim) in one transaction:
 *              one clientRequestId = one payload; a different payload is refused ('conflict').
 *   dispatch   sent only after claimForDispatch() atomically confirmed a record of that request still
 *              exists and no attempt holds a fresh claim on the request, recorded the dispatch, and issued
 *              this attempt's token. No await separates the caller's final account check from the send.
 *   release    an unresolved attempt releases ONLY its own claim (token): a late completion after the
 *              claim expired and another attempt took it can never release that other attempt's claim.
 *   settle     a definitive server answer removes exactly the given records and writes tombstones; it
 *              clears the claim only if it is still this attempt's (`superseded` reports otherwise).
 *   discard    atomically removes the confirmed records EXCEPT those of a request another context is
 *              sending right now (kept, reported). Records of a request already dispatched are removed
 *              but reported as "may have been sent": a local discard never undoes a server commit.
 *   migration  each owned interim-format entry (localStorage R1/R2/R3 formats) is copied under a
 *              deterministic recordId in one transaction that first checks the record and its tombstone.
 *              A source is removed only after that transaction committed AND only if it is still exactly
 *              what was copied (a changed or unparseable source is left in place: uncertain sources are
 *              preserved). Tombstones are kept for as long as ANY interim source of that account still
 *              exists (source retirement), and only then expire.
 *   failures   any IndexedDB failure => reads report `ok:false` (unreadable, never "empty"), writes report
 *              'failed'. There is NO fallback to localStorage or memory.
 */
export const LEGACY_QUEUE_KEY = 'offline_habit_queue';
export const QUEUE_V2_PREFIX = 'offline_habit_queue_v2:';
export const QUEUE_V3_PREFIX = 'aura_q3:';
export const QUEUE_V4_PREFIX = 'aura_q4:';
export const TOMBSTONE_V4_PREFIX = 'aura_q4t:';
export const QUEUE_DB_NAME = 'aura-offline';
export const QUEUE_DB_VERSION = 2;
export const CLAIM_TTL_MS = 60_000;
export const TOMBSTONE_TTL_MS = 30 * 24 * 3600_000;

export interface OwnedQueuedHabitLog extends QueuedHabitLog {
  ownerUserId: string;
  recordId?: string;
  queuedAt?: number;
}

export interface QueueRecord {
  recordId: string;
  item: OwnedQueuedHabitLog;
  /** Some context is sending this request now. */
  inFlight: boolean;
  /** This request was handed to the network at least once (it may have been sent and saved). */
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

/** The logical request a record belongs to (claims and dispatch marks are per request). */
export function requestKey(ownerUserId: string, clientRequestId: string): string {
  return `${ownerUserId}\u0000${clientRequestId}`;
}

/** Proof of one send attempt: only its holder may release or (claim-wise) settle it. */
export interface ClaimToken { readonly key: string; readonly attempt: string }

// ------------------------------------------------------------------ IndexedDB plumbing

type Stored = { recordId: string; ownerUserId: string; clientRequestId: string; item: OwnedQueuedHabitLog; queuedAt: number };
type Claim = { key: string; ownerUserId: string; clientRequestId: string; tab: string; attempt: string; at: number };
type Dispatch = { key: string; attempts: number; lastAt: number };
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

/** Version-1 -> 2: claims/dispatch marks were per record; re-key them per request (inside the upgrade transaction). */
function upgradeToV2(db: IDBDatabase, t: IDBTransaction) {
  const oldDispatches: Array<{ recordId: string; attempts: number; lastAt: number }> = [];
  const finish = () => {
    if (db.objectStoreNames.contains('dispatches')) db.deleteObjectStore('dispatches');
    if (db.objectStoreNames.contains('claims')) db.deleteObjectStore('claims'); // transient; an old attempt's claim is dropped (its send settles by record)
    db.createObjectStore('claims', { keyPath: 'key' });
    const d = db.createObjectStore('dispatches', { keyPath: 'key' });
    if (!db.objectStoreNames.contains('records')) return;
    const records = t.objectStore('records');
    for (const od of oldDispatches) {
      const g = records.get(od.recordId);
      g.onsuccess = () => {
        const r = g.result as Stored | undefined;
        if (r) d.put({ key: requestKey(r.ownerUserId, r.clientRequestId), attempts: od.attempts, lastAt: od.lastAt } satisfies Dispatch);
      };
    }
  };
  if (db.objectStoreNames.contains('dispatches')) {
    const cur = t.objectStore('dispatches').openCursor();
    cur.onsuccess = () => {
      const c = cur.result;
      if (c) { oldDispatches.push(c.value); c.continue(); } else finish();
    };
  } else finish();
}

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  const factory = idb();
  if (!factory) return Promise.reject(new Error('IndexedDB unavailable'));
  const p = new Promise<IDBDatabase>((resolve, reject) => {
    let req: IDBOpenDBRequest;
    try { req = factory.open(QUEUE_DB_NAME, QUEUE_DB_VERSION); } catch (e) { reject(e); return; }
    req.onupgradeneeded = (ev) => {
      const db = req.result;
      const t = req.transaction!;
      if (!db.objectStoreNames.contains('records')) {
        const r = db.createObjectStore('records', { keyPath: 'recordId' });
        r.createIndex('owner', 'ownerUserId');
        r.createIndex('ownerCrid', ['ownerUserId', 'clientRequestId']);
      }
      if (!db.objectStoreNames.contains('tombstones')) db.createObjectStore('tombstones', { keyPath: 'recordId' }).createIndex('owner', 'ownerUserId');
      if ((ev.oldVersion ?? 0) < 2) upgradeToV2(db, t);
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

interface MigrationSource { key: string; raw: string; candidates: Array<{ recordId: string; item: OwnedQueuedHabitLog }>; tombstoned: Set<string> }

/** Reads the owner's localStorage interim sources (with the exact raw value copied). Throws if storage throws. */
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
    out.push({ key, raw, candidates: [{ recordId: v.recordId, item: v }], tombstoned: lsTombs });
  }
  for (const key of keysWithPrefix(s, `${QUEUE_V3_PREFIX}${owner}:`)) {
    const raw = s.getItem(key);
    if (raw === null) continue;
    let v: unknown; try { v = JSON.parse(raw); } catch { continue; }
    if (!valid(v)) continue;
    out.push({ key, raw, candidates: [{ recordId: migratedRecordId(v), item: v }], tombstoned: lsTombs });
  }
  const v2 = s.getItem(QUEUE_V2_PREFIX + owner);
  if (v2 !== null) {
    let arr: unknown; try { arr = JSON.parse(v2); } catch { arr = null; }
    if (Array.isArray(arr) && arr.every(valid)) out.push({ key: QUEUE_V2_PREFIX + owner, raw: v2, candidates: arr.map((item) => ({ recordId: migratedRecordId(item), item })), tombstoned: lsTombs });
  }
  return out;
}

/** True when no interim source (parseable or not) of this account remains. Throws if storage throws. */
function sourcesRetired(owner: string): boolean {
  const s = storageOrNull();
  if (!s) return true;
  return keysWithPrefix(s, `${QUEUE_V4_PREFIX}${owner}:`).length === 0 && keysWithPrefix(s, `${QUEUE_V3_PREFIX}${owner}:`).length === 0 && s.getItem(QUEUE_V2_PREFIX + owner) === null;
}

const prunedThisSession = new Set<string>();

/** Interruption-safe, idempotent migration. Rejects if storage fails (the queue is then unreadable). */
async function migrateOwnedSources(owner: string): Promise<void> {
  const sources = collectSources(owner);
  if (sources.length > 0) {
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
    // Committed. Remove a source only if it is STILL exactly what was copied; anything else is uncertain and kept.
    const s = storageOrNull();
    if (s) for (const src of sources) { try { if (s.getItem(src.key) === src.raw) s.removeItem(src.key); } catch { /* re-run later */ } }
  }
  // Tombstones expire only once source retirement is established (no interim source of any kind remains).
  if (prunedThisSession.has(owner) || !sourcesRetired(owner)) return;
  const now = Date.now();
  await tx('readwrite', async (st) => {
    const tombs = (await asPromise(st.tombstones.index('owner').getAll(IDBKeyRange.only(owner)))) as Tomb[];
    for (const t of tombs) if (now - t.at > TOMBSTONE_TTL_MS) await asPromise(st.tombstones.delete(t.recordId));
  });
  try {
    const s = storageOrNull();
    if (s) for (const t of keysWithPrefix(s, `${TOMBSTONE_V4_PREFIX}${owner}:`)) s.removeItem(t);
  } catch { /* best effort */ }
  prunedThisSession.add(owner);
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
      for (const key of new Set(stored.map((r) => requestKey(r.ownerUserId, r.clientRequestId)))) {
        const c = (await asPromise(st.claims.get(key))) as Claim | undefined;
        if (c) claims.set(key, c);
        if (await asPromise(st.dispatches.get(key))) dispatches.add(key);
      }
      return { stored, claims, dispatches };
    });
    const records: QueueRecord[] = [];
    const corruptIds: string[] = [];
    for (const r of stored) {
      const item = r.item;
      if (!isQueuedHabitLog(item) || item.ownerUserId !== ownerUserId || item.clientRequestId !== r.clientRequestId) { corruptIds.push(r.recordId); continue; }
      const key = requestKey(r.ownerUserId, r.clientRequestId);
      records.push({ recordId: r.recordId, item: { ...item, recordId: r.recordId, queuedAt: r.queuedAt }, inFlight: fresh(claims.get(key), now), dispatched: dispatches.has(key) });
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

/**
 * Presentation read. R5: `null` when the queue could not be read -- callers
 * must present that as UNKNOWN, never as "no pending activity".
 */
export async function readOfflineHabitQueue(ownerUserId: string | null | undefined): Promise<OwnedQueuedHabitLog[] | null> {
  if (!ownerUserId) return [];
  const r = await readOwnedQueue(ownerUserId);
  return r.ok ? r.items : null;
}

// ------------------------------------------------------------------ writes

export type EnqueueResult =
  | { status: 'stored'; recordId: string; claim: ClaimToken | null }
  | { status: 'conflict' }
  | { status: 'failed' };

async function takeClaim(st: Record<(typeof STORES)[number], IDBObjectStore>, owner: string, crid: string, tab: string, now: number): Promise<ClaimToken | null> {
  const key = requestKey(owner, crid);
  if (fresh((await asPromise(st.claims.get(key))) as Claim | undefined, now)) return null;
  const attempt = randomId() + randomId();
  await asPromise(st.claims.put({ key, ownerUserId: owner, clientRequestId: crid, tab, attempt, at: now } satisfies Claim));
  const d = (await asPromise(st.dispatches.get(key))) as Dispatch | undefined;
  await asPromise(st.dispatches.put({ key, attempts: (d?.attempts ?? 0) + 1, lastAt: now } satisfies Dispatch));
  return { key, attempt };
}

/**
 * Stores one record for its owner, atomically with the identity check and
 * (claimFor) the sender's claim on the request. An identical payload already
 * queued under the same identity is reused; it is claimed only if no attempt
 * holds a fresh claim on the request. A different payload is refused.
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
      const claim = claimFor ? await takeClaim(st, item.ownerUserId, item.clientRequestId, claimFor, now) : null;
      return { status: 'stored', recordId, claim } as const;
    });
  } catch {
    return { status: 'failed' };
  }
}

export type ClaimResult = { status: 'claimed'; claim: ClaimToken } | { status: 'gone' } | { status: 'in-flight' } | { status: 'failed' };

/**
 * Atomically: a record of this request still exists and no attempt holds a
 * fresh claim on the request -> this attempt claims it (token) and the dispatch
 * is recorded (conservatively, before the send). Only 'claimed' permits sending.
 */
export async function claimForDispatch(recordId: string, tab: string): Promise<ClaimResult> {
  try {
    const now = Date.now();
    return await tx('readwrite', async (st) => {
      const rec = (await asPromise(st.records.get(recordId))) as Stored | undefined;
      if (!rec) return { status: 'gone' } as const;
      const claim = await takeClaim(st, rec.ownerUserId, rec.clientRequestId, tab, now);
      return claim ? ({ status: 'claimed', claim } as const) : ({ status: 'in-flight' } as const);
    });
  } catch {
    return { status: 'failed' };
  }
}

/** Releases THIS attempt's claim (the send was unresolved; the records stay queued). Another attempt's claim is never touched. */
export async function releaseClaim(token: ClaimToken): Promise<'released' | 'superseded' | 'failed'> {
  try {
    return await tx('readwrite', async (st) => {
      const c = (await asPromise(st.claims.get(token.key))) as Claim | undefined;
      if (!c || c.attempt !== token.attempt) return 'superseded' as const;
      await asPromise(st.claims.delete(token.key));
      return 'released' as const;
    });
  } catch {
    return 'failed'; // the claim expires on its own
  }
}

export interface RemovalResult { removed: number; alreadyGone: number; failed: number; superseded?: boolean }

/**
 * Settlement after a DEFINITIVE server answer: removes exactly these records
 * and tombstones them, atomically. The request's claim is cleared only if it
 * is still `token`'s attempt; a dispatch mark is cleared once no record of the
 * request remains.
 */
export async function settleRecords(recordIds: Iterable<string>, token?: ClaimToken): Promise<RemovalResult> {
  const ids = [...recordIds];
  try {
    const now = Date.now();
    return await tx('readwrite', async (st) => {
      const out: RemovalResult = { removed: 0, alreadyGone: 0, failed: 0 };
      const keys = new Set<string>();
      for (const id of ids) {
        const rec = (await asPromise(st.records.get(id))) as Stored | undefined;
        if (!rec) { out.alreadyGone++; continue; }
        keys.add(requestKey(rec.ownerUserId, rec.clientRequestId));
        await asPromise(st.records.delete(id));
        await asPromise(st.tombstones.put({ recordId: id, ownerUserId: rec.ownerUserId, at: now } satisfies Tomb));
        out.removed++;
      }
      if (token) {
        keys.add(token.key);
        const c = (await asPromise(st.claims.get(token.key))) as Claim | undefined;
        if (c && c.attempt === token.attempt) await asPromise(st.claims.delete(token.key));
        else if (c) out.superseded = true;
      }
      for (const key of keys) {
        const [owner, crid] = key.split('\u0000');
        const left = (await asPromise(st.records.index('ownerCrid').getAll(IDBKeyRange.only([owner, crid])))) as Stored[];
        if (left.length === 0) await asPromise(st.dispatches.delete(key));
      }
      return out;
    });
  } catch {
    return { removed: 0, alreadyGone: 0, failed: ids.length };
  }
}

export interface DiscardResult {
  /** Removed from this device (includes `removedPossiblySent`). */
  removed: number;
  /** Of `removed`: the request had already been handed to the network -- it may have been sent and saved. */
  removedPossiblySent: number;
  /** Another context was sending the request at that moment: kept for its account. */
  keptInFlight: number;
  alreadyGone: number;
  /** Could not be removed (storage failure): still stored for their account. */
  failed: number;
}

/**
 * A CONFIRMED discard of exactly these records (sign-out). Atomic. Records of
 * a request another context is sending right now are kept; records of a request
 * already dispatched are removed but reported as possibly sent.
 */
export async function discardRecords(recordIds: Iterable<string>, { tab }: { tab: string }): Promise<DiscardResult> {
  const ids = [...recordIds];
  try {
    const now = Date.now();
    return await tx('readwrite', async (st) => {
      const out: DiscardResult = { removed: 0, removedPossiblySent: 0, keptInFlight: 0, alreadyGone: 0, failed: 0 };
      const touched = new Set<string>();
      for (const id of ids) {
        const rec = (await asPromise(st.records.get(id))) as Stored | undefined;
        if (!rec) { out.alreadyGone++; continue; }
        const key = requestKey(rec.ownerUserId, rec.clientRequestId);
        const c = (await asPromise(st.claims.get(key))) as Claim | undefined;
        if (fresh(c, now) && c!.tab !== tab) { out.keptInFlight++; continue; }
        const dispatched = Boolean(await asPromise(st.dispatches.get(key)));
        await asPromise(st.records.delete(id));
        await asPromise(st.tombstones.put({ recordId: id, ownerUserId: rec.ownerUserId, at: now } satisfies Tomb));
        touched.add(key);
        out.removed++;
        if (dispatched) out.removedPossiblySent++;
      }
      for (const key of touched) {
        const [owner, crid] = key.split('\u0000');
        const left = (await asPromise(st.records.index('ownerCrid').getAll(IDBKeyRange.only([owner, crid])))) as Stored[];
        if (left.length === 0) { await asPromise(st.dispatches.delete(key)); await asPromise(st.claims.delete(key)); }
      }
      return out;
    });
  } catch {
    return { removed: 0, removedPossiblySent: 0, keptInFlight: 0, alreadyGone: 0, failed: ids.length };
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
  prunedThisSession.clear();
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
