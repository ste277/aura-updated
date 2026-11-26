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
 * AURA-ANDROID-REL-04 IR-01 / IR-03 (R4, R5, R8) -- durable offline activity
 * queue on IndexedDB.
 *
 * WHY IndexedDB (decision R4, accepted by the R4 independent disposition): the
 * queue's lifecycle steps are check-then-act operations between browsing
 * contexts. localStorage has no atomic compare-and-set across tabs. An
 * IndexedDB readwrite transaction is atomic and serialized against every
 * other overlapping readwrite transaction of the origin (all tabs and
 * contexts), with or without Web Locks. Every lifecycle step below is ONE
 * such transaction.
 *
 * R8 -- ONE active record format, ONE decision-marker format, no migration.
 * Release history (report §R8-1): the only queue format ever shipped to
 * Production or to a distributed client is the unscoped localStorage
 * `offline_habit_queue` (quarantined read-only, below). Every interim format of
 * REL-04 R1-R7 existed only on the unmerged PR branch. By owner decision (ticket
 * 39224) they are no longer migrated: any such data is PRESERVED IN PLACE,
 * never replayed, counted for its account, shown as "sync paused", and removed
 * only by that account's explicit discard (sign-out).
 *
 * Stores (database `aura-offline`, version 2 -- no schema change in R8):
 *   records     recordId -> { recordId, ownerUserId, clientRequestId, item, queuedAt, fmt }
 *               ACTIVE only when fmt === ACTIVE_RECORD_FORMAT (written by R8 enqueue). A record
 *               without it was written by a pre-R8 development build: QUARANTINED (paused).
 *   claims      requestKey(owner, crid) -> { key, ownerUserId, clientRequestId, tab, attempt, at }
 *   dispatches  requestKey(owner, crid) -> { key, attempts, lastAt }
 *   tombstones  decisionKey(owner, crid) -> { recordId: key, ownerUserId, clientRequestId, payload, decision, at, fmt }
 *               the account's FINAL decision (settled / discarded) about one LOGICAL request. Never
 *               expires, never pruned (no source can re-create the request, but a stale tab could
 *               re-enqueue its clientRequestId). Pre-R8 markers stay in the store, inert and untouched.
 *
 * Logical identity: an activity is (account, clientRequestId); its payload
 * (canonicalPayload) separates an EQUIVALENT copy (same payload) from a
 * CONFLICTING request (different payload). The physical recordId identifies a
 * stored copy only; no lifecycle decision is ever keyed by it.
 *
 * Lifecycle guarantees:
 *   create     enqueue (one transaction) consults the request's decision first: already settled/discarded
 *              -> 'settled' (nothing stored, nothing sent); a quarantined copy of the request exists ->
 *              'paused' (never adopted, never sent); a different payload -> 'conflict'. Otherwise the
 *              record (+ the caller's claim) is written, or the identical active copy reused.
 *   dispatch   only an ACTIVE record; claimForDispatch() atomically confirms it still exists and no attempt
 *              holds a fresh claim on the request, records the dispatch and issues this attempt's token.
 *   release    an unresolved attempt releases ONLY its own claim (token).
 *   settle     a definitive server answer removes EVERY active equivalent copy of the request and writes the
 *              account's decision, in one transaction; the claim is cleared only if still this attempt's.
 *   discard    the account's confirmed discard removes the records (and every active equivalent copy of
 *              their request) and writes the decision, in one transaction, EXCEPT a request another context
 *              is sending right now (kept, reported). Quarantined localStorage entries of the account are
 *              removed only if unchanged since they were shown; a failed removal leaves them quarantined.
 *   ownership  every read, settle and discard is bound to one account; another account's record is never
 *              touched; a decision applies only to its own account.
 *   failures   any IndexedDB or localStorage inspection failure => reads report `ok:false` (unreadable, never
 *              "empty"), writes report 'failed'. There is NO fallback to localStorage or memory.
 */
export const LEGACY_QUEUE_KEY = 'offline_habit_queue';
/** Retired REL-04 development formats (never released): quarantined in place, never migrated. */
export const QUEUE_V2_PREFIX = 'offline_habit_queue_v2:';
export const QUEUE_V3_PREFIX = 'aura_q3:';
export const QUEUE_V4_PREFIX = 'aura_q4:';
export const QUARANTINED_PREFIXES = [QUEUE_V2_PREFIX, QUEUE_V3_PREFIX, QUEUE_V4_PREFIX] as const;
export const QUEUE_DB_NAME = 'aura-offline';
export const QUEUE_DB_VERSION = 2;
export const CLAIM_TTL_MS = 60_000;
/** R8: the one active record (and decision) format. */
export const ACTIVE_RECORD_FORMAT = 'r8';

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
  /** R8: written by a retired pre-R8 build -- quarantined: kept, counted, discardable; never shown as pending, never sent. */
  paused: boolean;
}

/**
 * R8: one account's retired-format localStorage entry, exactly as read (discard removes it only if
 * unchanged). `crids` = the logical requests it carries when parseable; `unparsed` = entries whose
 * request cannot be read (each counted on its own).
 */
export interface QuarantinedSource { key: string; raw: string; entries: number; crids: string[]; unparsed: number }

export type QueueRead =
  | {
      ok: true;
      /** Presentation: activity PENDING AUTOMATIC SYNC -- one entry per active request, excluding conflicts. */
      items: OwnedQueuedHabitLog[];
      /** Every readable IndexedDB record of the account, active and paused (the discard snapshot). */
      records: QueueRecord[];
      /** Replay groups: identical-payload ACTIVE records per clientRequestId. */
      groups: QueueRecord[][];
      /** Active clientRequestIds with conflicting payloads (never sent). */
      conflicts: string[];
      /** recordIds whose value is not a valid entry (kept, counted, discardable). */
      corruptIds: string[];
      /** R8: the account's retired-format localStorage entries (kept in place, never migrated). */
      quarantined: QuarantinedSource[];
      /** R8: activity kept on this device that will NOT sync automatically ("sync paused"). */
      paused: number;
    }
  | { ok: false };

/** The payload that defines a request identity (no bookkeeping fields). */
export function canonicalPayload(v: QueuedHabitLog): string {
  const { tempId: _t, ...rest } = v as QueuedHabitLog & Record<string, unknown>;
  const r = rest as Record<string, unknown>;
  delete r.ownerUserId; delete r.recordId; delete r.queuedAt;
  return JSON.stringify(Object.keys(r).sort().reduce<Record<string, unknown>>((o, k) => { if (r[k] !== undefined) o[k] = r[k]; return o; }, {}));
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

/** The logical request (claims and dispatch marks are per request). */
export function requestKey(ownerUserId: string, clientRequestId: string): string {
  return `${ownerUserId}\u0000${clientRequestId}`;
}

/** R8: the key of the account's settle/discard DECISION about one logical request (the only marker format). */
export function decisionKey(ownerUserId: string, clientRequestId: string): string {
  return `d\u0000${ownerUserId}\u0000${clientRequestId}`;
}

/** Proof of one send attempt: only its holder may release or (claim-wise) settle it. */
export interface ClaimToken { readonly key: string; readonly attempt: string }

// ------------------------------------------------------------------ IndexedDB plumbing

type Stored = { recordId: string; ownerUserId: string; clientRequestId: string; item: OwnedQueuedHabitLog; queuedAt: number; fmt?: string };
type Claim = { key: string; ownerUserId: string; clientRequestId: string; tab: string; attempt: string; at: number };
type Dispatch = { key: string; attempts: number; lastAt: number };
type Decision = { recordId: string; ownerUserId: string; clientRequestId: string; payload: string; decision: 'settled' | 'discarded'; at: number; fmt: typeof ACTIVE_RECORD_FORMAT };
type Stores = Record<'records' | 'claims' | 'dispatches' | 'tombstones', IDBObjectStore>;
const STORES = ['records', 'claims', 'dispatches', 'tombstones'] as const;

const isActive = (r: Stored) => r.fmt === ACTIVE_RECORD_FORMAT;

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
async function tx<T>(mode: IDBTransactionMode, body: (s: Stores) => Promise<T>): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    let t: IDBTransaction;
    try { t = db.transaction(STORES as unknown as string[], mode); } catch (e) { reject(e); return; }
    const stores = Object.fromEntries(STORES.map((n) => [n, t.objectStore(n)])) as Stores;
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

/** All of `owner`'s ACTIVE copies of the logical request with this payload (the equivalent representations). */
async function activeCopies(st: Stores, owner: string, crid: string, payload: string): Promise<Stored[]> {
  const same = (await asPromise(st.records.index('ownerCrid').getAll(IDBKeyRange.only([owner, crid])))) as Stored[];
  return same.filter((r) => isActive(r) && isQueuedHabitLog(r.item) && canonicalPayload(r.item) === payload);
}

/** Records `owner`'s final decision about the logical request (first decision wins; it is never replaced). */
async function writeDecision(st: Stores, owner: string, crid: string, payload: string, decision: Decision['decision'], at: number) {
  const key = decisionKey(owner, crid);
  if ((await asPromise(st.tombstones.get(key))) as Decision | undefined) return;
  await asPromise(st.tombstones.put({ recordId: key, ownerUserId: owner, clientRequestId: crid, payload, decision, at, fmt: ACTIVE_RECORD_FORMAT } satisfies Decision));
}

// ------------------------------------------------------------------ quarantine of retired development formats (read-only)

/**
 * The account's retired-format localStorage entries (R1 v2 array, R2 aura_q3,
 * R3 aura_q4): read, never parsed into the queue, never migrated. Ownership is
 * the account named in the key (and, when the value parses, in the entry).
 * R3 localStorage markers (aura_q4t) are not activity: not counted, left in place.
 */
type Quarantine = { state: 'unavailable' } | { state: 'ok'; sources: QuarantinedSource[]; crids: Set<string> };
function inspectQuarantine(owner: string): Quarantine {
  let s: Storage;
  try {
    if (typeof localStorage === 'undefined' || localStorage === null) return { state: 'unavailable' };
    s = localStorage;
  } catch {
    return { state: 'unavailable' };
  }
  try {
    const sources: QuarantinedSource[] = [];
    const parse = (raw: string): unknown => { try { return JSON.parse(raw); } catch { return undefined; } };
    const cridOf = (v: unknown) => (isQueuedHabitLog(v) ? v.clientRequestId : null);
    const v2 = s.getItem(QUEUE_V2_PREFIX + owner);
    if (v2 !== null) {
      const a = parse(v2);
      const list = Array.isArray(a) ? a : [undefined]; // unparseable: one kept entry
      const crids = list.map(cridOf).filter((c): c is string => c !== null);
      if (list.length > 0) sources.push({ key: QUEUE_V2_PREFIX + owner, raw: v2, entries: list.length, crids, unparsed: list.length - crids.length });
    }
    for (const prefix of [QUEUE_V3_PREFIX, QUEUE_V4_PREFIX]) {
      for (const key of keysWithPrefix(s, `${prefix}${owner}:`)) {
        const raw = s.getItem(key);
        if (raw === null) continue;
        const v = parse(raw);
        if (v && typeof v === 'object' && typeof (v as { ownerUserId?: unknown }).ownerUserId === 'string' && (v as { ownerUserId: string }).ownerUserId !== owner) continue; // another account's (an owner id extending this one)
        const c = cridOf(v);
        sources.push({ key, raw, entries: 1, crids: c ? [c] : [], unparsed: c ? 0 : 1 });
      }
    }
    return { state: 'ok', sources, crids: new Set(sources.flatMap((x) => x.crids)) };
  } catch {
    return { state: 'unavailable' };
  }
}

// ------------------------------------------------------------------ reads

/** The owner's queue. `ok:false` when IndexedDB or the quarantined (localStorage) sources cannot be read, or ANY step fails. */
export async function readOwnedQueue(ownerUserId: string): Promise<QueueRead> {
  try {
    const q = inspectQuarantine(ownerUserId);
    if (q.state === 'unavailable') return { ok: false }; // unknown, never "nothing paused"
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
      records.push({ recordId: r.recordId, item: { ...item, recordId: r.recordId, queuedAt: r.queuedAt }, inFlight: fresh(claims.get(key), now), dispatched: dispatches.has(key), paused: !isActive(r) });
    }
    // Deterministic order: queued time, then log time, then identity (entries queued in the same millisecond).
    records.sort((a, b) => (a.item.queuedAt ?? 0) - (b.item.queuedAt ?? 0) || a.item.logTimestamp.localeCompare(b.item.logTimestamp) || a.item.clientRequestId.localeCompare(b.item.clientRequestId) || a.recordId.localeCompare(b.recordId));
    // Per LOGICAL request: any quarantined copy (IndexedDB or localStorage) pauses the whole request (an active
    // copy of it is never sent either); otherwise conflicting payloads are never sent; otherwise one replay group.
    const byCrid = new Map<string, QueueRecord[]>();
    for (const r of records) byCrid.set(r.item.clientRequestId, [...(byCrid.get(r.item.clientRequestId) ?? []), r]);
    const groups: QueueRecord[][] = [];
    const conflicts: string[] = [];
    const pausedRequests = new Set<string>(q.crids);
    for (const [crid, rs] of byCrid) {
      if (rs.some((r) => r.paused) || q.crids.has(crid)) { pausedRequests.add(crid); for (const r of rs) r.paused = true; }
      else if (new Set(rs.map((r) => canonicalPayload(r.item))).size > 1) conflicts.push(crid);
      else groups.push(rs);
    }
    // Counted per logical request (an entry with an unreadable request counts on its own).
    const paused = pausedRequests.size + conflicts.length + corruptIds.length + q.sources.reduce((n, x) => n + x.unparsed, 0);
    return { ok: true, items: groups.map((g) => g[0].item), records, groups, conflicts, corruptIds, quarantined: q.sources, paused };
  } catch {
    return { ok: false };
  }
}

/**
 * Presentation read. R5: `null` when the queue could not be read -- callers
 * must present that as UNKNOWN, never as "no pending activity". Only activity
 * pending automatic sync (R8: never quarantined activity).
 */
export async function readOfflineHabitQueue(ownerUserId: string | null | undefined): Promise<OwnedQueuedHabitLog[] | null> {
  if (!ownerUserId) return [];
  const r = await readOwnedQueue(ownerUserId);
  return r.ok ? r.items : null;
}

/** R8: presentation read with the paused count ("sync paused" status); null = unreadable. */
export async function readOfflineQueueView(ownerUserId: string | null | undefined): Promise<{ items: OwnedQueuedHabitLog[]; paused: number } | null> {
  if (!ownerUserId) return { items: [], paused: 0 };
  const r = await readOwnedQueue(ownerUserId);
  return r.ok ? { items: r.items, paused: r.paused } : null;
}

// ------------------------------------------------------------------ writes

export type EnqueueResult =
  | { status: 'stored'; recordId: string; claim: ClaimToken | null }
  /** R8: this account already settled or discarded this request: nothing stored, nothing to send. */
  | { status: 'settled' }
  /** R8: a quarantined (retired-format) copy of this request exists: never adopted, never sent. */
  | { status: 'paused' }
  | { status: 'conflict' }
  | { status: 'failed' };

async function takeClaim(st: Stores, owner: string, crid: string, tab: string, now: number): Promise<ClaimToken | null> {
  const key = requestKey(owner, crid);
  if (fresh((await asPromise(st.claims.get(key))) as Claim | undefined, now)) return null;
  const attempt = randomId() + randomId();
  await asPromise(st.claims.put({ key, ownerUserId: owner, clientRequestId: crid, tab, attempt, at: now } satisfies Claim));
  const d = (await asPromise(st.dispatches.get(key))) as Dispatch | undefined;
  await asPromise(st.dispatches.put({ key, attempts: (d?.attempts ?? 0) + 1, lastAt: now } satisfies Dispatch));
  return { key, attempt };
}

/**
 * Stores one ACTIVE record for its owner, atomically with the decision and
 * identity checks and (claimFor) the sender's claim on the request.
 */
export async function enqueueOwned(item: OwnedQueuedHabitLog, { claimFor }: { claimFor?: string } = {}): Promise<EnqueueResult> {
  if (!item.ownerUserId || !item.clientRequestId) return { status: 'failed' };
  try {
    const now = Date.now();
    const owner = item.ownerUserId;
    const mine = canonicalPayload(item);
    const q = inspectQuarantine(owner);
    return await tx('readwrite', async (st) => {
      const decided = (await asPromise(st.tombstones.get(decisionKey(owner, item.clientRequestId)))) as Decision | undefined;
      if (decided) return decided.payload === mine ? ({ status: 'settled' } as const) : ({ status: 'conflict' } as const);
      if (q.state === 'ok' && q.crids.has(item.clientRequestId)) return { status: 'paused' } as const; // a quarantined localStorage copy
      const same = (await asPromise(st.records.index('ownerCrid').getAll(IDBKeyRange.only([owner, item.clientRequestId])))) as Stored[];
      if (same.some((r) => !isActive(r))) return { status: 'paused' } as const;
      if (same.some((r) => !isQueuedHabitLog(r.item) || canonicalPayload(r.item) !== mine)) return { status: 'conflict' } as const;
      let recordId: string;
      if (same.length > 0) {
        recordId = same[0].recordId;
      } else {
        recordId = randomId();
        const rec: Stored = { recordId, ownerUserId: owner, clientRequestId: item.clientRequestId, item: { ...item, recordId }, queuedAt: now, fmt: ACTIVE_RECORD_FORMAT };
        await asPromise(st.records.add(rec));
      }
      const claim = claimFor ? await takeClaim(st, owner, item.clientRequestId, claimFor, now) : null;
      return { status: 'stored', recordId, claim } as const;
    });
  } catch {
    return { status: 'failed' };
  }
}

export type ClaimResult = { status: 'claimed'; claim: ClaimToken } | { status: 'gone' } | { status: 'in-flight' } | { status: 'paused' } | { status: 'failed' };

/**
 * Atomically: an ACTIVE record of this request still exists, the request has no
 * decision, and no attempt holds a fresh claim on it -> this attempt claims it
 * (token) and the dispatch is recorded (before the send). Only 'claimed' permits sending.
 */
export async function claimForDispatch(recordId: string, tab: string): Promise<ClaimResult> {
  try {
    const now = Date.now();
    return await tx('readwrite', async (st) => {
      const rec = (await asPromise(st.records.get(recordId))) as Stored | undefined;
      if (!rec) return { status: 'gone' } as const;
      if (!isActive(rec)) return { status: 'paused' } as const; // R8: quarantined -- never sent
      const q = inspectQuarantine(rec.ownerUserId);
      if (q.state !== 'ok') return { status: 'failed' } as const; // the request's quarantine state is unknown: never send
      if (q.crids.has(rec.clientRequestId)) return { status: 'paused' } as const;
      const siblings = (await asPromise(st.records.index('ownerCrid').getAll(IDBKeyRange.only([rec.ownerUserId, rec.clientRequestId])))) as Stored[];
      if (siblings.some((r) => !isActive(r))) return { status: 'paused' } as const; // a quarantined copy pauses the whole request
      if ((await asPromise(st.tombstones.get(decisionKey(rec.ownerUserId, rec.clientRequestId)))) as Decision | undefined) return { status: 'gone' } as const;
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

export interface RemovalResult { removed: number; alreadyGone: number; failed: number; superseded?: boolean; /** Records of another account, left untouched. */ foreign?: number; /** R8: quarantined records, never settled by a send. */ paused?: number }

/** The account a settlement acts for (explicit, or the claim token's). */
const ownerOfToken = (token?: ClaimToken) => (token ? token.key.split('\u0000')[0] : undefined);

/**
 * Settlement after a DEFINITIVE server answer about the logical request of
 * these records: removes every active equivalent copy and records the
 * account's decision, atomically. The claim is cleared only if it is still
 * `token`'s attempt; the dispatch mark once no record of the request remains.
 */
export async function settleRecords(recordIds: Iterable<string>, token?: ClaimToken, opts: { owner?: string } = {}): Promise<RemovalResult> {
  const ids = [...recordIds];
  const owner = opts.owner ?? ownerOfToken(token);
  try {
    const now = Date.now();
    return await tx('readwrite', async (st) => {
      const out: RemovalResult = { removed: 0, alreadyGone: 0, failed: 0, foreign: 0, paused: 0 };
      const keys = new Set<string>();
      const removed = new Set<string>();
      for (const id of ids) {
        if (removed.has(id)) continue;
        const rec = (await asPromise(st.records.get(id))) as Stored | undefined;
        if (!rec) { out.alreadyGone++; continue; }
        if (owner !== undefined && rec.ownerUserId !== owner) { out.foreign!++; continue; } // never another account's record
        if (!isActive(rec) || !isQueuedHabitLog(rec.item)) { out.paused!++; continue; } // never sent, so never settled
        const payload = canonicalPayload(rec.item);
        keys.add(requestKey(rec.ownerUserId, rec.clientRequestId));
        for (const copy of await activeCopies(st, rec.ownerUserId, rec.clientRequestId, payload)) {
          await asPromise(st.records.delete(copy.recordId));
          removed.add(copy.recordId);
          out.removed++;
        }
        await writeDecision(st, rec.ownerUserId, rec.clientRequestId, payload, 'settled', now);
      }
      if (token) {
        keys.add(token.key);
        const c = (await asPromise(st.claims.get(token.key))) as Claim | undefined;
        if (c && c.attempt === token.attempt) await asPromise(st.claims.delete(token.key));
        else if (c) out.superseded = true;
      }
      for (const key of keys) {
        const [o, crid] = key.split('\u0000');
        const left = (await asPromise(st.records.index('ownerCrid').getAll(IDBKeyRange.only([o, crid])))) as Stored[];
        if (left.length === 0) await asPromise(st.dispatches.delete(key));
      }
      return out;
    });
  } catch {
    return { removed: 0, alreadyGone: 0, failed: ids.length, foreign: 0, paused: 0 };
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
  /** Could not be removed (storage failure, or a quarantined entry changed since it was shown): still stored for their account. */
  failed: number;
  /** Records of another account, left untouched. */
  foreign?: number;
}

/**
 * A CONFIRMED discard of exactly these records (sign-out). Atomic. Removes each
 * record and every active equivalent copy of its request, and records the
 * account's 'discarded' decision for the request; a request another context is
 * sending right now is kept; one already dispatched is removed but reported as
 * possibly sent.
 */
export async function discardRecords(recordIds: Iterable<string>, { tab, owner }: { tab: string; owner?: string }): Promise<DiscardResult> {
  const ids = [...recordIds];
  try {
    const now = Date.now();
    return await tx('readwrite', async (st) => {
      const out: DiscardResult = { removed: 0, removedPossiblySent: 0, keptInFlight: 0, alreadyGone: 0, failed: 0, foreign: 0 };
      const touched = new Set<string>();
      const removed = new Set<string>();
      for (const id of ids) {
        if (removed.has(id)) continue;
        const rec = (await asPromise(st.records.get(id))) as Stored | undefined;
        if (!rec) { out.alreadyGone++; continue; }
        if (owner !== undefined && rec.ownerUserId !== owner) { out.foreign!++; continue; } // never another account's record
        const key = requestKey(rec.ownerUserId, rec.clientRequestId);
        const c = (await asPromise(st.claims.get(key))) as Claim | undefined;
        if (isActive(rec) && fresh(c, now) && c!.tab !== tab) { out.keptInFlight++; continue; }
        const dispatched = Boolean(await asPromise(st.dispatches.get(key)));
        const valid = isQueuedHabitLog(rec.item) && rec.item.clientRequestId === rec.clientRequestId;
        const copies = valid && isActive(rec) ? await activeCopies(st, rec.ownerUserId, rec.clientRequestId, canonicalPayload(rec.item)) : [];
        for (const r of [rec, ...copies.filter((x) => x.recordId !== rec.recordId)]) {
          await asPromise(st.records.delete(r.recordId));
          removed.add(r.recordId);
          out.removed++;
          if (dispatched) out.removedPossiblySent++;
        }
        if (valid) await writeDecision(st, rec.ownerUserId, rec.clientRequestId, canonicalPayload(rec.item), 'discarded', now);
        touched.add(key);
      }
      for (const key of touched) {
        const [o, crid] = key.split('\u0000');
        const left = (await asPromise(st.records.index('ownerCrid').getAll(IDBKeyRange.only([o, crid])))) as Stored[];
        if (left.length === 0) { await asPromise(st.dispatches.delete(key)); await asPromise(st.claims.delete(key)); }
      }
      return out;
    });
  } catch {
    return { removed: 0, removedPossiblySent: 0, keptInFlight: 0, alreadyGone: 0, failed: ids.length, foreign: 0 };
  }
}

/**
 * R8 -- the account's CONFIRMED discard of exactly these quarantined
 * localStorage entries (as read for the confirmation). An entry is removed only
 * if it is still exactly what was shown; a changed entry or a failed removal is
 * kept (and stays quarantined: it can never be sent).
 */
export function discardQuarantined(owner: string, sources: QuarantinedSource[]): { removed: number; failed: number } {
  const out = { removed: 0, failed: 0 };
  const s = storageOrNull();
  for (const src of sources) {
    const own = QUARANTINED_PREFIXES.some((p) => src.key === `${p}${owner}` || src.key.startsWith(`${p}${owner}:`));
    if (!own || !s) { out.failed += src.entries; continue; }
    try {
      if (s.getItem(src.key) === src.raw) s.removeItem(src.key);
      if (s.getItem(src.key) === null) out.removed += src.entries; else out.failed += src.entries;
    } catch {
      out.failed += src.entries;
    }
  }
  return out;
}

// ------------------------------------------------------------------ legacy quarantine (read-only)

export type LegacySnapshot = { ok: true; count: number } | { ok: false };

/**
 * Pre-REL-04 entries (`offline_habit_queue`, a shared array written by OLD
 * bundles -- the one format ever released) have NO owner. They are
 * QUARANTINED: never replayed, never assigned to any account, never shown. R4:
 * this build never rewrites or removes that array. Old bundles update it with
 * an unsynchronised read-modify-write, and they may still be open in another
 * tab or context; any destructive cleanup here could lose or resurrect their
 * entries. Cleanup is deferred until older writers can no longer be active (an
 * activation-dependent decision); until then the entries are kept and only counted.
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
