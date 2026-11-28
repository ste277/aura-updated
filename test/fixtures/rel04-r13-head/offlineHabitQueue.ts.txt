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
 *   discard    (R9) the account's confirmed discard (discardOwned) is by LOGICAL activity: ONE transaction records
 *              the 'discarded' decision of every activity it was shown -- including one that exists only in a
 *              retired localStorage entry -- and removes every IndexedDB copy, EXCEPT a request another context
 *              is sending right now (kept, reported). Only after that transaction committed are the retired
 *              localStorage entries removed (each only if unchanged). A failed or unknown transaction removes
 *              nothing; a failed removal after the commit leaves an entry that is permanently ineligible.
 *   identity   (R10) lifecycle identity (account + clientRequestId) is established by activityIdentity from the
 *              identity fields ALONE: malformed other fields never bypass a durable discard; missing, malformed or
 *              conflicting identity (incl. a value naming another account) is preserved in quarantine, never
 *              discarded, never eligible, and reported as such.
 *   boundary   (R9) the ONLY way to transmit is a claim on an eligible active record (enqueueOwned with claimFor,
 *              or claimForDispatch). Eligible = readable IndexedDB and retired sources, no decision, no
 *              quarantined copy (a retired entry's request id is read from its key), no unidentifiable retired
 *              entry of the account. Otherwise the write reports 'unavailable'/'failed' and nothing is sent.
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
 * R8: one account's retired-format localStorage entry, exactly as read (discard removes it only if unchanged).
 * R10: classified by IDENTITY ONLY (activityIdentity), never by the validity of its other fields:
 *   `crids`        the logical requests it IDENTIFIES (account + clientRequestId established);
 *   `unidentified` entries whose identity cannot be established safely (missing, malformed or conflicting
 *                  identity fields; an unparseable v2 array) -- preserved, never discarded;
 *   `blocked`      every request id it may stand for, incl. conflicting candidates: never eligible;
 *   `payloads`     crid -> canonical payload, only for a COMPLETE valid entry.
 */
export interface QuarantinedSource { key: string; raw: string; entries: number; crids: string[]; unidentified: number; blocked: string[]; payloads?: Record<string, string> }

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
      /** R10: each such record's trustworthy request id (activityIdentity), or null when it cannot be established. */
      corrupt: Array<{ recordId: string; clientRequestId: string | null }>;
      /** R8: the account's retired-format localStorage entries (kept in place, never migrated). */
      quarantined: QuarantinedSource[];
      /** R8: activity kept on this device that will NOT sync automatically ("sync paused"), per LOGICAL activity. */
      paused: number;
      /** R9: logical activities pending automatic sync (= items.length). */
      pending: number;
      /** R9: every logical activity of the account on this device (pending + paused): Home and sign-out count this. */
      total: number;
      /** R9: of `total`: logical activities already handed to the network at least once. */
      dispatched: number;
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
/**
 * Proof of one send attempt: only its holder may release or (claim-wise) settle it.
 * R12: an IMMUTABLE representation of exactly what was claimed -- account, request id, canonical payload, the
 * record it was claimed from and that record's item. The sender transmits `item` (never an earlier cached copy)
 * and settlement acts only on copies that still carry this identity and payload.
 */
export interface ClaimToken {
  readonly key: string;
  readonly attempt: string;
  readonly owner?: string;
  readonly crid?: string;
  readonly payload?: string;
  readonly recordId?: string;
  readonly item?: Readonly<OwnedQueuedHabitLog>;
}

// ------------------------------------------------------------------ IndexedDB plumbing

type Stored = { recordId: string; ownerUserId: string; clientRequestId: string; item: OwnedQueuedHabitLog; queuedAt: number; fmt?: string };
type Claim = { key: string; ownerUserId: string; clientRequestId: string; tab: string; attempt: string; at: number; payload?: string; recordId?: string };
type Dispatch = { key: string; attempts: number; lastAt: number };
/** `payload` null: the request was discarded from a retired entry whose payload could not be read (any payload is refused). */
/**
 * `payload` null: discarded from a copy whose payload could not be read (any payload is refused).
 * `possiblySent` (R11): the request had been handed to the network before this decision -- kept with the decision
 * so the fact survives the removal of its dispatch mark and later cleanup retries.
 */
type Decision = { recordId: string; ownerUserId: string; clientRequestId: string; payload: string | null; decision: 'settled' | 'discarded'; at: number; fmt: typeof ACTIVE_RECORD_FORMAT; possiblySent?: boolean };
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
/**
 * R12: every record that may concern `owner`: the owner index misses records without (or with another) outer
 * owner, so the whole store is scanned for records whose outer OR nested account is `owner`.
 */
async function relevantRecords(st: Stores, owner: string): Promise<Stored[]> {
  const all = (await asPromise(st.records.getAll())) as Stored[];
  return all.filter((r) => r.ownerUserId === owner || ((r.item as { ownerUserId?: unknown } | undefined)?.ownerUserId === owner));
}
/** `owner`'s ACTIVE copies of the request with exactly this identity and payload (re-resolved, never by index alone). */
async function activeCopies(st: Stores, owner: string, crid: string, payload: string): Promise<Stored[]> {
  return (await relevantRecords(st, owner)).filter((r) => { const id = recordIdentity(owner, r); return isActive(r) && id.kind === 'valid' && id.crid === crid && canonicalPayload(r.item) === payload; });
}

/**
 * Records `owner`'s final decision about the logical request. The first decision wins (never replaced); R11: a
 * later write only adds `possiblySent` -- the prior-send fact is never lost.
 */
async function writeDecision(st: Stores, owner: string, crid: string, payload: string | null, decision: Decision['decision'], at: number, possiblySent = false): Promise<Decision> {
  const key = decisionKey(owner, crid);
  const prior = (await asPromise(st.tombstones.get(key))) as Decision | undefined;
  if (prior) {
    if (possiblySent && !prior.possiblySent) { const merged = { ...prior, possiblySent: true }; await asPromise(st.tombstones.put(merged)); return merged; }
    return prior;
  }
  const d: Decision = { recordId: key, ownerUserId: owner, clientRequestId: crid, payload, decision, at, fmt: ACTIVE_RECORD_FORMAT, possiblySent };
  await asPromise(st.tombstones.put(d));
  return d;
}

// ------------------------------------------------------------------ R11: ONE identity-resolution contract

/**
 * R11 -- the ONLY way any stored copy (IndexedDB record, v2 entry, aura_q3/aura_q4 entry) is given a lifecycle
 * identity. Inputs are the storage CONTEXT, never the signed-in account:
 *   owner         the account whose storage is being read (the queue being read or discarded)
 *   contextOwner  the account the storage location names (IndexedDB record field; the account in a key)
 *   outer         the request id the location carries: a string; null = the format carries one but it is missing
 *                 or malformed (a damaged index field, an incomplete aura_q4 key); undefined = the format has none (v2)
 *   partial       an incomplete outer fragment (an aura_q4 key without its record-id part): never trusted, only blocked
 *   value         the stored value (nested ownerUserId / clientRequestId, payload)
 *
 *   valid          one unambiguous request id from every present identity field, the nested account equals the
 *                  context account, the outer id present, and the payload complete
 *   damaged        the same unambiguous identity, but a non-identity field (or the outer index) is missing/damaged
 *   incomplete     no request id can be established
 *   contradictory  identity fields disagree (two ids, another account named, a malformed id field beside a known one)
 *
 * Only valid copies may be sent. valid and damaged copies are discarded durably by their identity. incomplete and
 * contradictory copies are preserved: never sent, never deleted; every candidate id they name is blocked.
 */
export type IdentityKind = 'valid' | 'damaged' | 'incomplete' | 'contradictory';
export interface ResolvedIdentity { kind: IdentityKind; crid: string | null; candidates: string[] }
const nonEmptyId = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
export function resolveIdentity(owner: string, contextOwner: unknown, outer: string | null | undefined, value: unknown, partial?: string): ResolvedIdentity {
  const v = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  const ids = new Set<string>();
  if (nonEmptyId(outer)) ids.add(outer);
  if (v && nonEmptyId(v.clientRequestId)) ids.add(v.clientRequestId);
  const candidates = [...new Set([...ids, ...(nonEmptyId(partial) ? [partial] : [])])];
  const contradictory = { kind: 'contradictory' as const, crid: null, candidates };
  if (contextOwner !== owner) return contradictory; // never this account's to decide
  if (v && v.ownerUserId !== undefined && v.ownerUserId !== contextOwner) return contradictory; // another account named
  if (v && v.clientRequestId !== undefined && !nonEmptyId(v.clientRequestId)) return ids.size ? contradictory : { kind: 'incomplete', crid: null, candidates };
  if (ids.size > 1) return contradictory;
  if (ids.size === 0) return { kind: 'incomplete', crid: null, candidates };
  const crid = [...ids][0];
  const complete = outer !== null && isQueuedHabitLog(v) && v.clientRequestId === crid && v.ownerUserId === contextOwner;
  return { kind: complete ? 'valid' : 'damaged', crid, candidates };
}
/** The identity of an IndexedDB record (the indexed fields are its storage context). */
const recordIdentity = (owner: string, r: Stored) => resolveIdentity(owner, r.ownerUserId, nonEmptyId(r.clientRequestId) ? r.clientRequestId : null, r.item);
/** Compatibility wrapper (R10 callers/tests): identified = valid or damaged. */
export type ActivityIdentity = { kind: 'identified'; crid: string } | { kind: 'conflict'; candidates: string[] } | { kind: 'unknown' };
export function activityIdentity(value: unknown, owner: string, expectedCrid?: string): ActivityIdentity {
  const id = resolveIdentity(owner, owner, expectedCrid === undefined ? undefined : expectedCrid, value);
  if (id.kind === 'valid' || id.kind === 'damaged') return { kind: 'identified', crid: id.crid! };
  return id.kind === 'contradictory' ? { kind: 'conflict', candidates: id.candidates } : { kind: 'unknown' };
}

// ------------------------------------------------------------------ quarantine of retired development formats (read-only)

/**
 * The account's retired-format localStorage entries (R1 v2 array, R2 aura_q3, R3 aura_q4): read, never migrated,
 * classified by resolveIdentity. The account is the one named in the key; a value naming another account is a
 * CONTRADICTION (R11), never skipped. R3 localStorage markers (aura_q4t) are not activity: left in place.
 * `opaque` (R9): an unparseable v2 array may hide any request id: nothing of the account is eligible.
 */
type Quarantine = { state: 'unavailable' } | { state: 'ok'; sources: QuarantinedSource[]; /** every blocked request id (eligibility) */ crids: Set<string>; /** identified request ids (counting) */ identified: Set<string>; opaque: boolean };
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
    let opaque = false;
    const classify = (key: string, raw: string, values: unknown[], outer: string | null | undefined, partial?: string): QuarantinedSource => {
      const crids = new Set<string>(), blocked = new Set<string>(), payloads: Record<string, string> = {};
      let unidentified = 0;
      for (const v of values) {
        const id = resolveIdentity(owner, owner, outer, v, partial);
        for (const c of id.candidates) blocked.add(c);
        if (id.kind === 'valid' || id.kind === 'damaged') { crids.add(id.crid!); if (isQueuedHabitLog(v) && v.clientRequestId === id.crid) payloads[id.crid!] = canonicalPayload(v); }
        else unidentified++;
      }
      return { key, raw, entries: values.length, crids: [...crids], unidentified, blocked: [...blocked], payloads };
    };
    const v2 = s.getItem(QUEUE_V2_PREFIX + owner);
    if (v2 !== null) {
      const a = parse(v2);
      if (!Array.isArray(a)) { opaque = true; sources.push({ key: QUEUE_V2_PREFIX + owner, raw: v2, entries: 1, crids: [], unidentified: 1, blocked: [], payloads: {} }); }
      else if (a.length > 0) sources.push(classify(QUEUE_V2_PREFIX + owner, v2, a, undefined));
    }
    // aura_q3:<owner>:<crid>     the key's request id is complete when non-empty
    // aura_q4:<owner>:<crid>:<recordId>   the historical writer always emits BOTH parts; anything else is incomplete
    for (const prefix of [QUEUE_V3_PREFIX, QUEUE_V4_PREFIX]) {
      const head = `${prefix}${owner}:`;
      for (const key of keysWithPrefix(s, head)) {
        const raw = s.getItem(key);
        if (raw === null) continue;
        const rest = key.slice(head.length);
        let outer: string | null = null;
        if (prefix === QUEUE_V3_PREFIX) outer = rest.length > 0 && !rest.endsWith(':') ? rest : null;
        else { const i = rest.lastIndexOf(':'); if (i > 0 && i < rest.length - 1) outer = rest.slice(0, i); }
        if (outer !== null) { sources.push(classify(key, raw, [parse(raw)], outer)); continue; }
        // R12: an INCOMPLETE key is never trusted -- not even with a readable value: incomplete identity (preserved,
        // never deleted or decided), blocking every plausible request id it may stand for.
        const v = parse(raw);
        const nested = v && typeof v === 'object' && nonEmptyId((v as { clientRequestId?: unknown }).clientRequestId) ? [(v as { clientRequestId: string }).clientRequestId] : [];
        const i = rest.lastIndexOf(':');
        const variants = [rest, rest.replace(/:+$/, ''), i > 0 ? rest.slice(0, i) : ''].filter(nonEmptyId);
        sources.push({ key, raw, entries: 1, crids: [], unidentified: 1, blocked: [...new Set([...variants, ...nested])], payloads: {} });
      }
    }
    return { state: 'ok', sources, crids: new Set(sources.flatMap((x) => x.blocked)), identified: new Set(sources.flatMap((x) => x.crids)), opaque };
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
    const { stored, claims, dispatches, priorSent } = await tx('readonly', async (st) => {
      const stored = await relevantRecords(st, ownerUserId); // R12: incl. records naming the account without (its) outer owner
      // Every request id any copy may stand for (resolved, candidates, retired entries).
      const ids = new Set<string>([...q.crids]);
      for (const r of stored) for (const c of recordIdentity(ownerUserId, r).candidates) ids.add(c);
      const claims = new Map<string, Claim>();
      const dispatches = new Set<string>();
      const priorSent = new Set<string>();
      for (const crid of ids) {
        const key = requestKey(ownerUserId, crid);
        const c = (await asPromise(st.claims.get(key))) as Claim | undefined;
        if (c) claims.set(crid, c);
        if (await asPromise(st.dispatches.get(key))) dispatches.add(crid);
        const d = (await asPromise(st.tombstones.get(decisionKey(ownerUserId, crid)))) as Decision | undefined;
        if (d?.possiblySent) priorSent.add(crid); // R11: kept across cleanup retries
      }
      return { stored, claims, dispatches, priorSent };
    });
    const records: QueueRecord[] = [];
    const corruptIds: string[] = [];
    const corrupt: Array<{ recordId: string; clientRequestId: string | null }> = [];
    const damaged = new Set<string>(); // identified requests with a damaged copy (paused, discardable by identity)
    const blockedByRecords = new Set<string>(); // candidates of incomplete/contradictory copies (never eligible)
    const unidentifiedUnits: string[][] = []; // the candidate ids of each copy whose identity cannot be established
    for (const r of stored) {
      const id = recordIdentity(ownerUserId, r);
      if (id.kind !== 'valid') {
        corruptIds.push(r.recordId);
        corrupt.push({ recordId: r.recordId, clientRequestId: id.kind === 'damaged' ? id.crid : null });
        if (id.kind === 'damaged') damaged.add(id.crid!);
        else { unidentifiedUnits.push(id.candidates); for (const c of id.candidates) blockedByRecords.add(c); }
        continue;
      }
      records.push({ recordId: r.recordId, item: { ...r.item, recordId: r.recordId, queuedAt: r.queuedAt }, inFlight: fresh(claims.get(id.crid!), now), dispatched: dispatches.has(id.crid!), paused: !isActive(r) });
    }
    // Deterministic order: queued time, then log time, then identity (entries queued in the same millisecond).
    records.sort((a, b) => (a.item.queuedAt ?? 0) - (b.item.queuedAt ?? 0) || a.item.logTimestamp.localeCompare(b.item.logTimestamp) || a.item.clientRequestId.localeCompare(b.item.clientRequestId) || a.recordId.localeCompare(b.recordId));
    // Per LOGICAL request: any quarantined, damaged or identity-blocked copy pauses the whole request (an active
    // copy of it is never sent either); otherwise conflicting payloads are never sent; otherwise one replay group.
    const byCrid = new Map<string, QueueRecord[]>();
    for (const r of records) byCrid.set(r.item.clientRequestId, [...(byCrid.get(r.item.clientRequestId) ?? []), r]);
    const groups: QueueRecord[][] = [];
    const conflicts: string[] = [];
    const pausedRequests = new Set<string>([...q.identified, ...damaged]);
    for (const [crid, rs] of byCrid) {
      if (rs.some((r) => r.paused) || q.crids.has(crid) || q.opaque || damaged.has(crid) || blockedByRecords.has(crid)) { pausedRequests.add(crid); for (const r of rs) r.paused = true; }
      else if (new Set(rs.map((r) => canonicalPayload(r.item))).size > 1) conflicts.push(crid);
      else groups.push(rs);
    }
    // Counted per LOGICAL request; a copy whose identity cannot be established counts on its own.
    const lsUnidentified = q.sources.reduce((n, x) => n + x.unidentified, 0);
    const paused = pausedRequests.size + conflicts.length + unidentifiedUnits.length + lsUnidentified;
    // R11: a logical unit "may already have been sent" if its dispatch mark exists or its decision kept the fact.
    const sent = (crid: string) => dispatches.has(crid) || priorSent.has(crid);
    // Each send is attributed ONCE: an unidentifiable copy adds to the count only for a send no counted unit carries.
    const sentCrids = new Set([...groups.map((g) => g[0].item.clientRequestId), ...pausedRequests, ...conflicts].filter(sent));
    let dispatched = sentCrids.size;
    for (const cands of unidentifiedUnits) { const own = cands.filter(sent); if (own.length && own.every((c) => !sentCrids.has(c))) { dispatched++; for (const c of own) sentCrids.add(c); } }
    return { ok: true, items: groups.map((g) => g[0].item), records, groups, conflicts, corruptIds, corrupt, quarantined: q.sources, paused, pending: groups.length, total: groups.length + paused, dispatched };
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
  /** R9: eligibility cannot be established (localStorage unreadable, or an unidentifiable retired entry): not stored, NOT to be sent. */
  | { status: 'unavailable' }
  /**
   * R13: the transaction's commit could not be confirmed AND a reconciliation read could not establish whether the
   * request is queued. It may be queued (and would then replay under this same request id); never resubmit it as new.
   */
  | { status: 'unknown' }
  | { status: 'conflict' }
  | { status: 'failed' };

/**
 * R12 -- the claim's linearization point. IndexedDB and localStorage share no transaction, so the retired
 * localStorage state is inspected SYNCHRONOUSLY immediately before the claim write is issued (no await between),
 * and again by the sender immediately before the network call (transmissionCheck). Returns null when another
 * attempt holds a fresh claim, 'blocked' / 'unavailable' when the retired state forbids the claim.
 */
async function takeClaim(st: Stores, owner: string, crid: string, tab: string, now: number, claimed?: { payload: string; recordId: string; item: OwnedQueuedHabitLog }): Promise<ClaimToken | null | 'blocked' | 'unavailable'> {
  const key = requestKey(owner, crid);
  if (fresh((await asPromise(st.claims.get(key))) as Claim | undefined, now)) return null;
  const q = inspectQuarantine(owner);
  if (q.state !== 'ok') return 'unavailable';
  if (q.opaque || q.crids.has(crid)) return 'blocked';
  const attempt = randomId() + randomId();
  const claimPut = asPromise(st.claims.put({ key, ownerUserId: owner, clientRequestId: crid, tab, attempt, at: now, payload: claimed?.payload, recordId: claimed?.recordId } satisfies Claim));
  await claimPut;
  const d = (await asPromise(st.dispatches.get(key))) as Dispatch | undefined;
  await asPromise(st.dispatches.put({ key, attempts: (d?.attempts ?? 0) + 1, lastAt: now } satisfies Dispatch));
  return Object.freeze({ key, attempt, owner, crid, payload: claimed?.payload, recordId: claimed?.recordId, item: claimed ? Object.freeze({ ...claimed.item }) : undefined });
}

/**
 * R12 -- the sender's final check, called SYNCHRONOUSLY immediately before the network call (no await between):
 * the retired localStorage state as visible to this context when transmission begins.
 */
export function transmissionCheck(token: ClaimToken): 'clear' | 'blocked' | 'unavailable' {
  if (!token.owner || !token.crid) return 'blocked';
  const q = inspectQuarantine(token.owner);
  if (q.state !== 'ok') return 'unavailable';
  return q.opaque || q.crids.has(token.crid) ? 'blocked' : 'clear';
}

/**
 * Stores one ACTIVE record for its owner, atomically with the decision and
 * identity checks and (claimFor) the sender's claim on the request.
 */
/**
 * R11 -- THE transmission eligibility gate, evaluated inside the read-write transaction that claims the request
 * (both direct submission and replay call it; nothing else may claim). It resolves EVERY copy of the account
 * through resolveIdentity (never only the compound index, which a damaged copy may lack), so a contradiction that
 * appears before the claim is seen by it.
 */
type Gate = { status: 'eligible'; copies: Stored[] } | { status: 'settled' } | { status: 'conflict' } | { status: 'paused' };
async function eligibilityGate(st: Stores, owner: string, crid: string, payload: string, q: Extract<Quarantine, { state: 'ok' }>): Promise<Gate> {
  const decided = (await asPromise(st.tombstones.get(decisionKey(owner, crid)))) as Decision | undefined;
  if (decided) return decided.payload === null || decided.payload === payload ? { status: 'settled' } : { status: 'conflict' };
  if (q.opaque || q.crids.has(crid)) return { status: 'paused' }; // a quarantined / blocked retired copy
  const owned = await relevantRecords(st, owner); // R12: incl. records without (or with another) outer owner
  const copies: Stored[] = [];
  for (const r of owned) {
    const id = recordIdentity(owner, r);
    if (id.crid !== crid && !id.candidates.includes(crid)) continue;
    if (id.kind !== 'valid' || id.crid !== crid || !isActive(r)) return { status: 'paused' }; // damaged, contradictory, incomplete or retired copy
    copies.push(r);
  }
  if (copies.some((r) => canonicalPayload(r.item) !== payload)) return { status: 'conflict' };
  return { status: 'eligible', copies };
}

/**
 * Stores one ACTIVE record for its owner, atomically with the eligibility gate and (claimFor) the sender's claim.
 */
/** R13: a refusal decided INSIDE the transaction aborts it, so nothing it wrote commits. */
class EnqueueRefusal extends Error { constructor(readonly result: EnqueueResult) { super('enqueue refused'); } }

/**
 * Stores one ACTIVE record for its owner, atomically with the eligibility gate and (claimFor) the sender's claim.
 *
 * R13 -- transaction outcomes (each result is CONFIRMED unless it says otherwise):
 *   stored              committed: queued (claim = this attempt's token, or null when another attempt holds one)
 *   settled / paused / conflict / unavailable
 *                       confirmed NOT queued by this call: the transaction aborted before commit (a refusal at the
 *                       claim's linearization point aborts it, so a newly added record never survives a refusal)
 *   failed              confirmed not queued: storage could not be opened / the transaction never ran / it failed
 *                       before issuing any write, or the reconciliation read proved no copy was committed
 *   unknown             the commit could not be confirmed and the reconciliation read failed: possibly queued
 * A commit that is confirmed by the reconciliation read is reported as 'stored' (without a claim), never as a
 * rejection; it then replays under the same request id.
 */
export async function enqueueOwned(item: OwnedQueuedHabitLog, { claimFor }: { claimFor?: string } = {}): Promise<EnqueueResult> {
  if (!item.ownerUserId || !item.clientRequestId) return { status: 'failed' };
  const owner = item.ownerUserId;
  const mine = canonicalPayload(item);
  let started = false;
  let wrote = false; // a write request was issued in the transaction (only then can a commit be uncertain)
  let addedRecordId: string | null = null;
  try {
    const now = Date.now();
    // R9: the retired sources are inspected BEFORE the transaction. A discard writes its decision and only then
    // removes a source, so either this inspection still sees the source (paused) or the decision is already
    // committed and the transaction below sees it (settled): no interleaving admits a discarded request.
    const q = inspectQuarantine(owner);
    if (q.state !== 'ok' || q.opaque) return { status: 'unavailable' };
    return await tx('readwrite', async (st) => {
      started = true;
      const g = await eligibilityGate(st, owner, item.clientRequestId, mine, q);
      if (g.status !== 'eligible') return { status: g.status } as const; // nothing written
      let recordId: string;
      if (g.copies.length > 0) {
        recordId = g.copies[0].recordId;
      } else {
        recordId = randomId();
        addedRecordId = recordId;
        wrote = true;
        const rec: Stored = { recordId, ownerUserId: owner, clientRequestId: item.clientRequestId, item: { ...item, recordId }, queuedAt: now, fmt: ACTIVE_RECORD_FORMAT };
        await asPromise(st.records.add(rec));
      }
      const stored = g.copies.length > 0 ? g.copies[0].item : { ...item, recordId };
      if (claimFor) wrote = true;
      const claim = claimFor ? await takeClaim(st, owner, item.clientRequestId, claimFor, now, { payload: mine, recordId, item: stored }) : null;
      // R13: abort -> the record added above does NOT commit; the result is exactly what storage holds.
      if (claim === 'blocked') throw new EnqueueRefusal({ status: 'paused' });
      if (claim === 'unavailable') throw new EnqueueRefusal({ status: 'unavailable' });
      return { status: 'stored', recordId, claim } as const;
    });
  } catch (e) {
    if (e instanceof EnqueueRefusal) return e.result;
    if (!started || !wrote) return { status: 'failed' }; // never ran, or failed before issuing any write: nothing can have committed
    // The commit could not be confirmed: reconcile from storage, never from the error.
    try {
      const found = await tx('readonly', async (st) => {
        const copies = await activeCopies(st, owner, item.clientRequestId, mine);
        return copies.find((c) => c.recordId === addedRecordId) ?? copies[0] ?? null;
      });
      return found ? { status: 'stored', recordId: found.recordId, claim: null } : { status: 'failed' };
    } catch {
      return { status: 'unknown' };
    }
  }
}

export type ClaimResult = { status: 'claimed'; claim: ClaimToken } | { status: 'gone' } | { status: 'in-flight' } | { status: 'paused' } | { status: 'changed' } | { status: 'failed' };

/**
 * Atomically: an ACTIVE record of this request still exists, the request has no
 * decision, and no attempt holds a fresh claim on it -> this attempt claims it
 * (token) and the dispatch is recorded (before the send). Only 'claimed' permits sending.
 */
/**
 * R12/R13: `expected` binds the claim to what the caller inspected (account + request id + canonical payload). If the record at
 * `recordId` was replaced or modified since, the stale operation is refused ('changed') -- never claimed for a
 * different record or identity.
 */
export async function claimForDispatch(recordId: string, tab: string, expected?: { ownerUserId?: string; clientRequestId: string; payload: string }): Promise<ClaimResult> {
  try {
    const now = Date.now();
    return await tx('readwrite', async (st) => {
      const rec = (await asPromise(st.records.get(recordId))) as Stored | undefined;
      if (!rec) return { status: 'gone' } as const;
      const id = recordIdentity(rec.ownerUserId, rec);
      if (id.kind !== 'valid' || !isActive(rec)) return { status: 'paused' } as const; // R8/R11: never sent
      const payload = canonicalPayload(rec.item);
      // R13: the inspected ACCOUNT is part of the binding: a record replaced by another account's record (even with the
      // same record id, request id and payload) never inherits the inspection's eligibility.
      if (expected && ((expected.ownerUserId !== undefined && rec.ownerUserId !== expected.ownerUserId) || id.crid !== expected.clientRequestId || payload !== expected.payload)) return { status: 'changed' } as const;
      const q = inspectQuarantine(rec.ownerUserId);
      if (q.state !== 'ok') return { status: 'failed' } as const; // the request's quarantine state is unknown: never send
      // R11: the SAME gate as direct submission, at the final transmission boundary.
      const g = await eligibilityGate(st, rec.ownerUserId, id.crid!, payload, q);
      if (g.status === 'settled') return { status: 'gone' } as const;
      if (g.status !== 'eligible') return { status: 'paused' } as const;
      const claim = await takeClaim(st, rec.ownerUserId, id.crid!, tab, now, { payload, recordId, item: rec.item });
      if (claim === 'unavailable') return { status: 'failed' } as const;
      if (claim === 'blocked') return { status: 'paused' } as const;
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
/**
 * Settlement after a DEFINITIVE server answer. R12: bound to the CLAIM -- the answer concerns exactly the claimed
 * account, request id and payload, so only copies that STILL resolve (valid) to that identity and payload are
 * removed; a replaced, modified or newly contradictory copy is preserved. The decision is written for the claimed
 * identity. Without a token (tests, legacy callers) each given record is re-resolved first.
 */
export async function settleRecords(recordIds: Iterable<string>, token?: ClaimToken, opts: { owner?: string } = {}): Promise<RemovalResult> {
  const ids = [...recordIds];
  const owner = opts.owner ?? token?.owner ?? ownerOfToken(token);
  try {
    const now = Date.now();
    return await tx('readwrite', async (st) => {
      const out: RemovalResult = { removed: 0, alreadyGone: 0, failed: 0, foreign: 0, paused: 0 };
      const targets = new Map<string, { o: string; crid: string; payload: string }>(); // the identities the answer concerns
      if (token?.crid && token.payload !== undefined && token.owner) {
        if (owner !== undefined && token.owner !== owner) { out.foreign!++; return out; }
        targets.set(requestKey(token.owner, token.crid), { o: token.owner, crid: token.crid, payload: token.payload });
      }
      for (const id of ids) {
        const rec = (await asPromise(st.records.get(id))) as Stored | undefined;
        if (!rec) { out.alreadyGone++; continue; }
        if (owner !== undefined && rec.ownerUserId !== owner) { out.foreign!++; continue; } // never another account's record
        const rid = recordIdentity(rec.ownerUserId, rec);
        if (!isActive(rec) || rid.kind !== 'valid') { out.paused!++; continue; } // changed / contradictory / never sent: preserved
        const p = canonicalPayload(rec.item);
        if (token?.crid !== undefined && (rid.crid !== token.crid || p !== token.payload)) { out.paused!++; continue; } // not what was claimed
        const k = requestKey(rec.ownerUserId, rid.crid!);
        if (!targets.has(k)) targets.set(k, { o: rec.ownerUserId, crid: rid.crid!, payload: p });
      }
      for (const { o, crid, payload } of targets.values()) {
        for (const copy of await activeCopies(st, o, crid, payload)) { await asPromise(st.records.delete(copy.recordId)); out.removed++; }
        await writeDecision(st, o, crid, payload, 'settled', now, true);
      }
      if (token) {
        const c = (await asPromise(st.claims.get(token.key))) as Claim | undefined;
        if (c && c.attempt === token.attempt) await asPromise(st.claims.delete(token.key));
        else if (c) out.superseded = true;
      }
      for (const { o, crid } of targets.values()) {
        const stillNamed = (await relevantRecords(st, o)).some((r) => recordIdentity(o, r).candidates.includes(crid));
        if (!stillNamed) await asPromise(st.dispatches.delete(requestKey(o, crid)));
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
 * R9-R11: what one logical discard did, per LOGICAL activity (account + clientRequestId). Each activity of the
 * confirmed snapshot is in exactly ONE outcome; "possibly sent" is attributed within its outcome and is kept
 * with the decision, so it survives cleanup retries.
 */
export interface LogicalDiscardResult {
  /** Discarded (decision recorded) AND no copy of it remains on this device. */
  removed: number;
  /** Of `removed`: it had been handed to the network -- it may have been sent and saved. */
  removedPossiblySent: number;
  /** Discarded (decision recorded, never sent again) but a copy of it could not (yet) be deleted from this device. */
  cleanupPending: number;
  /** Of `cleanupPending`: it had been handed to the network. */
  cleanupPendingPossiblySent: number;
  /** R13: discarded (decision recorded, never sent again) but whether a copy remains could not be verified. */
  discardedUnverified: number;
  /** Of `discardedUnverified`: it had been handed to the network. */
  discardedUnverifiedPossiblySent: number;
  /** Another context was sending it at that moment: nothing decided, nothing deleted. */
  keptInFlight: number;
  /** NOT discarded: the transaction did not record a decision (verified afterwards); kept exactly as before. */
  failed: number;
  /** R11: the transaction's outcome could not be established (no verification possible): kept or discarded, unknown. */
  uncertain: number;
  /** NOT discarded: its identity could not be established safely; preserved in quarantine, never sent. */
  unidentified: number;
  /** Already settled (sent and confirmed) or gone before the discard. */
  alreadyGone: number;
}

export interface DiscardSnapshot {
  records: Array<{ recordId: string; item: { clientRequestId: string } }>;
  corruptIds: string[];
  corrupt?: Array<{ recordId: string; clientRequestId: string | null }>;
  quarantined: QuarantinedSource[];
}

/**
 * R12: what physically remains for these requests: any IndexedDB record of (or naming) the account whose identity or
 * candidates include one of them, and any retired localStorage entry that blocks one of them. null = cannot be read
 * (removal is then never reported).
 */
async function remainingCopies(owner: string, crids: Set<string>): Promise<{ crids: Set<string>; unidentifiedRecordIds: string[]; unidentifiedKeys: string[] } | null> {
  if (crids.size === 0) return { crids: new Set(), unidentifiedRecordIds: [], unidentifiedKeys: [] };
  try {
    const rows = await tx('readonly', (st) => relevantRecords(st, owner));
    // R13: retired storage is inspected AFTER the IndexedDB read completed, synchronously with computing the result
    // (no await between): a retired write visible to this context at the reporting boundary is never missed.
    const q = inspectQuarantine(owner);
    if (q.state !== 'ok') return null;
    const left = new Set<string>(), unidentifiedRecordIds: string[] = [], unidentifiedKeys: string[] = [];
    for (const r of rows) {
      const id = recordIdentity(owner, r);
      const names = id.candidates.filter((c) => crids.has(c));
      if (names.length === 0) continue;
      for (const c of names) left.add(c);
      if (id.kind === 'incomplete' || id.kind === 'contradictory') unidentifiedRecordIds.push(r.recordId);
    }
    for (const src of q.sources) {
      const names = src.blocked.filter((c) => crids.has(c));
      if (names.length === 0) continue;
      for (const c of names) left.add(c);
      if (src.unidentified > 0) unidentifiedKeys.push(src.key);
    }
    return { crids: left, unidentifiedRecordIds, unidentifiedKeys };
  } catch {
    return null;
  }
}

/**
 * R9-R11 -- the account's CONFIRMED discard of exactly the logical activities it was shown (sign-out).
 *
 *   * The discard set is the snapshot's resolved identities ONLY. Inside the transaction every copy of the account
 *     is re-resolved (resolveIdentity); a copy is deleted only if it STILL resolves (valid or damaged) to a
 *     confirmed identity. A replacement or a newly appearing identity is never decided or deleted implicitly.
 *   * A logical activity with a fresh claim from another context (whatever the state of its copies) is kept,
 *     undecided, and nothing of it is deleted.
 *   * ONE transaction records every decision (with its prior-send fact) and deletes the copies; retired
 *     localStorage entries are removed only after it COMMITTED. If the commit cannot be confirmed, a separate read
 *     verifies which decisions exist: those are cleanup-pending (no cleanup is attempted), the others failed; if
 *     even that read fails the outcome is uncertain. Nothing is ever reported as rolled back without that read.
 */
export async function discardOwned(owner: string, snap: DiscardSnapshot, { tab }: { tab: string }): Promise<LogicalDiscardResult> {
  const out: LogicalDiscardResult = { removed: 0, removedPossiblySent: 0, cleanupPending: 0, cleanupPendingPossiblySent: 0, discardedUnverified: 0, discardedUnverifiedPossiblySent: 0, keptInFlight: 0, failed: 0, uncertain: 0, unidentified: 0, alreadyGone: 0 };
  const own = (key: string) => QUARANTINED_PREFIXES.some((p) => key === `${p}${owner}` || key.startsWith(`${p}${owner}:`));
  const sources = snap.quarantined.filter((x) => own(x.key));
  const sourceCrids = new Set(sources.flatMap((x) => x.crids));
  const corrupt = snap.corrupt ?? snap.corruptIds.map((recordId) => ({ recordId, clientRequestId: null }));
  // The confirmed logical identities.
  const confirmed = new Set<string>([...snap.records.map((r) => r.item.clientRequestId), ...sourceCrids, ...corrupt.map((c) => c.clientRequestId).filter((c): c is string => c !== null)]);
  out.unidentified = sources.reduce((n, x) => n + x.unidentified, 0) + corrupt.filter((c) => c.clientRequestId === null).length;
  type Outcome = { decided: Map<string, boolean>; kept: Set<string> };
  let committed: Outcome | null = null;
  try {
    const now = Date.now();
    committed = await tx('readwrite', async (st) => {
      const decided = new Map<string, boolean>(); // crid -> possibly sent
      const kept = new Set<string>();
      const owned = await relevantRecords(st, owner); // R12: incl. records naming the account without (its) outer owner
      const resolved = owned.map((r) => ({ r, id: recordIdentity(owner, r) }));
      for (const crid of confirmed) {
        const key = requestKey(owner, crid);
        const c = (await asPromise(st.claims.get(key))) as Claim | undefined;
        if (fresh(c, now) && c!.tab !== tab) { kept.add(crid); out.keptInFlight++; continue; } // being sent elsewhere: whole activity kept
        const prior = (await asPromise(st.tombstones.get(decisionKey(owner, crid)))) as Decision | undefined;
        const mine = resolved.filter(({ id }) => (id.kind === 'valid' || id.kind === 'damaged') && id.crid === crid).map(({ r }) => r);
        if (prior?.decision === 'settled' && mine.length === 0 && !sourceCrids.has(crid)) { out.alreadyGone++; continue; }
        const sent = Boolean(await asPromise(st.dispatches.get(key))) || Boolean(prior?.possiblySent);
        const payloads = new Set<string>();
        for (const r of mine) if (isQueuedHabitLog(r.item)) payloads.add(canonicalPayload(r.item));
        for (const src of sources) if (src.payloads?.[crid]) payloads.add(src.payloads[crid]);
        for (const r of mine) await asPromise(st.records.delete(r.recordId));
        await writeDecision(st, owner, crid, payloads.size === 1 ? [...payloads][0] : null, 'discarded', now, sent);
        // The dispatch mark stays while ANY copy still names this request (e.g. a preserved contradictory copy).
        const stillNamed = resolved.some(({ r, id }) => !mine.includes(r) && id.candidates.includes(crid));
        if (!stillNamed) { await asPromise(st.dispatches.delete(key)); await asPromise(st.claims.delete(key)); }
        decided.set(crid, sent);
      }
      return { decided, kept };
    });
  } catch {
    committed = null;
  }
  if (!committed) {
    // The commit could not be confirmed. Verify, in a separate read, which decisions exist; never assume a rollback.
    out.keptInFlight = 0; out.alreadyGone = 0;
    let found: Map<string, boolean>;
    try {
      found = await tx('readonly', async (st) => {
        const m = new Map<string, boolean>();
        for (const crid of confirmed) { const dd = (await asPromise(st.tombstones.get(decisionKey(owner, crid)))) as Decision | undefined; if (dd?.decision === 'discarded') m.set(crid, Boolean(dd.possiblySent)); }
        return m;
      });
    } catch {
      out.uncertain = confirmed.size;
      return out;
    }
    for (const crid of confirmed) if (!found.has(crid)) out.failed++;
    // Decided ones: no cleanup is attempted after an unconfirmed commit; report by what PHYSICALLY remains (R12).
    const remaining = await remainingCopies(owner, new Set(found.keys()));
    for (const [crid, sent] of found) {
      if (remaining === null) { out.discardedUnverified++; if (sent) out.discardedUnverifiedPossiblySent++; } // R13: unknown, not "a copy remains"
      else if (remaining.crids.has(crid)) { out.cleanupPending++; if (sent) out.cleanupPendingPossiblySent++; }
      else { out.removed++; if (sent) out.removedPossiblySent++; }
    }
    return out;
  }
  // Committed: now, and only now, remove the retired entries whose every entry is identified and decided.
  const pendingCleanup = new Set<string>();
  const s = storageOrNull();
  for (const src of sources) {
    if (src.unidentified > 0 || !src.crids.every((c) => committed!.decided.has(c))) { for (const c of src.crids) pendingCleanup.add(c); continue; }
    let gone = false;
    try {
      if (s && s.getItem(src.key) === src.raw) s.removeItem(src.key);
      gone = Boolean(s) && s!.getItem(src.key) === null;
    } catch { gone = false; }
    if (!gone) for (const c of src.crids) pendingCleanup.add(c);
  }
  // R12: report removal only after verifying what PHYSICALLY remains (IndexedDB and retired storage) for each decided
  // request; copies that appeared or changed meanwhile keep it cleanup-pending, and a newly unidentifiable copy that
  // names it is reported as preserved.
  const remaining = await remainingCopies(owner, new Set(committed.decided.keys()));
  const snapshotCorrupt = new Set(corrupt.map((c) => c.recordId));
  const snapshotKeys = new Set(sources.map((x) => x.key));
  if (remaining) out.unidentified += remaining.unidentifiedRecordIds.filter((id) => !snapshotCorrupt.has(id)).length + remaining.unidentifiedKeys.filter((k) => !snapshotKeys.has(k)).length;
  for (const [crid, sent] of committed.decided) {
    if (pendingCleanup.has(crid) || remaining?.crids.has(crid)) { out.cleanupPending++; if (sent) out.cleanupPendingPossiblySent++; } // a copy is KNOWN to remain
    else if (remaining === null) { out.discardedUnverified++; if (sent) out.discardedUnverifiedPossiblySent++; } // R13: physical state unknown
    else { out.removed++; if (sent) out.removedPossiblySent++; } // observed absent at the reporting boundary
  }
  return out;
}

/** R9: the durable discard of the account's quarantined localStorage entries alone (decision first, then cleanup). */
export async function discardQuarantined(owner: string, sources: QuarantinedSource[]): Promise<LogicalDiscardResult> {
  return discardOwned(owner, { records: [], corruptIds: [], quarantined: sources }, { tab: 'discard-quarantined' });
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
