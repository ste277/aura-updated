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
 *   tombstones  key -> { recordId: key, ownerUserId, ref, at }   settled/discarded: no migration may recreate it
 *               R7: key = markerKey(owner, recordId) -- a marker is ACCOUNT-SCOPED; markers written before R7
 *               are keyed by the bare recordId and are honoured only for the account they name
 * (R5: version 2 re-keys claims and dispatch marks by account + clientRequestId; the
 * version-1 marks are carried over in the upgrade transaction. R7 needs no schema change: existing
 * records and markers are kept as they are and read through the ownership rules below.)
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
 *   ownership  (R7) a recordId alone never proves ownership. Every migrated entry gets the account-scoped
 *              identity migratedRecordId(item, owner) whatever its source format; earlier ids are aliases
 *              honoured only for a record/marker naming the same account; dedup is by account +
 *              clientRequestId + payload. Settle and discard act only on the given account's records and
 *              write only that account's markers. If only a pre-R7 marker of ANOTHER account exists for an
 *              entry's shared id, its ownership cannot be established: it is kept and shown, but HELD
 *              (never sent automatically), and the user's discard still removes it.
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
  /** R7: this account's ownership of the entry's earlier decision is unverified -- kept and shown, never sent automatically. */
  held: boolean;
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
      /** R7: clientRequestIds held because ownership could not be established (kept, shown, discardable; never sent automatically). */
      held: string[];
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

/**
 * Deterministic id for an entry migrated from an interim format. R6: the
 * OWNING ACCOUNT is part of the identity -- two accounts' entries with the same
 * clientRequestId and payload are two different records.
 */
export function migratedRecordId(item: QueuedHabitLog, ownerUserId: string): string {
  return 'm' + hash(`${ownerUserId}|${item.clientRequestId}|${canonicalPayload(item)}`);
}

/** The R4/R5 (owner-less) migrated id; honoured only for a record or marker OWNED by the same account. */
export function legacyMigratedRecordId(item: QueuedHabitLog): string {
  return 'm' + hash(`${item.clientRequestId}|${canonicalPayload(item)}`);
}

/**
 * R7 -- the settlement/discard marker key of `recordId` FOR `ownerUserId`.
 * Every marker written from R7 on is keyed by account + recordId, so no
 * account's settlement or discard can ever replace another account's marker,
 * whatever recordId the two share. Markers written before R7 are keyed by the
 * bare recordId; they are honoured only for the account they name (see markerOf).
 */
export function markerKey(ownerUserId: string, recordId: string): string {
  return `t\u0000${ownerUserId}\u0000${recordId}`;
}

/** The logical request a record belongs to (claims and dispatch marks are per request). */
export function requestKey(ownerUserId: string, clientRequestId: string): string {
  return `${ownerUserId}\u0000${clientRequestId}`;
}

/** Proof of one send attempt: only its holder may release or (claim-wise) settle it. */
export interface ClaimToken { readonly key: string; readonly attempt: string }

// ------------------------------------------------------------------ IndexedDB plumbing

/**
 * `held` (R7): migrated, but this account's ownership of the entry's earlier
 * decision could not be established (a pre-R7 marker under one of its shared
 * ids names ANOTHER account, so this account's own settle/discard marker may
 * have been overwritten). Kept, shown and discardable; never sent automatically.
 */
type Stored = { recordId: string; ownerUserId: string; clientRequestId: string; item: OwnedQueuedHabitLog; queuedAt: number; held?: 'ownership-unverified' };
type Claim = { key: string; ownerUserId: string; clientRequestId: string; tab: string; attempt: string; at: number };
type Dispatch = { key: string; attempts: number; lastAt: number };
/** `recordId` is the store key: markerKey(owner, ref) from R7 on; the bare recordId for pre-R7 markers. */
type Tomb = { recordId: string; ownerUserId: string; at: number; ref?: string };
type Stores = Record<'records' | 'claims' | 'dispatches' | 'tombstones', IDBObjectStore>;
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

// ------------------------------------------------------------------ ownership (R7: one mechanism for every persisted identity)
//
// A recordId alone is NEVER proof of ownership: pre-R7 formats share ids between
// accounts (R3 aura_q4 migrated ids, R4/R5 owner-less migrated ids). Ownership is
// established only by the account stored WITH a record or marker:
//   record  owned  <=> record.ownerUserId === owner (and it is the same logical entry:
//                      account + clientRequestId + canonical payload)
//   marker  owned  <=> markerKey(owner, id) exists (R7+), OR a pre-R7 bare-id marker whose
//                      ownerUserId === owner, OR an R3 localStorage marker aura_q4t:<owner>:<id>
//   marker foreign <=> only a pre-R7 bare-id marker naming ANOTHER account exists for one of
//                      the entry's ids: this account's own decision may have been overwritten.

type MarkerState = 'owned' | 'foreign' | 'none';

/** Is there a settlement/discard marker of `owner` for any of `ids`? */
async function markerOf(st: Stores, owner: string, ids: string[], lsTombs: Set<string>): Promise<MarkerState> {
  let foreign = false;
  for (const id of ids) {
    if (lsTombs.has(id)) return 'owned';
    if ((await asPromise(st.tombstones.get(markerKey(owner, id)))) as Tomb | undefined) return 'owned';
    const bare = (await asPromise(st.tombstones.get(id))) as Tomb | undefined;
    if (bare) { if (bare.ownerUserId === owner) return 'owned'; foreign = true; }
  }
  return foreign ? 'foreign' : 'none';
}

/** This account's existing record of the same logical entry (any identity format), if any. */
async function ownedRecordOf(st: Stores, owner: string, item: QueuedHabitLog, ids: string[]): Promise<Stored | undefined> {
  const mine = canonicalPayload(item);
  const same = (r: Stored | undefined): r is Stored => Boolean(r && r.ownerUserId === owner && r.clientRequestId === item.clientRequestId && isQueuedHabitLog(r.item) && canonicalPayload(r.item) === mine);
  for (const id of ids) {
    const r = (await asPromise(st.records.get(id))) as Stored | undefined;
    if (same(r)) return r;
  }
  const byRequest = (await asPromise(st.records.index('ownerCrid').getAll(IDBKeyRange.only([owner, item.clientRequestId])))) as Stored[];
  return byRequest.find(same);
}

/** Writes `owner`'s marker for `recordId` (never a bare-id marker: it could replace another account's). */
async function writeMarker(st: Stores, owner: string, recordId: string, at: number) {
  await asPromise(st.tombstones.put({ recordId: markerKey(owner, recordId), ownerUserId: owner, ref: recordId, at } satisfies Tomb));
}

// ------------------------------------------------------------------ migration (owned interim formats)

/**
 * One interim entry: `recordId` is its account-scoped identity (the id it migrates to, whatever its source
 * format); `aliases` are the pre-R7 ids an earlier build may have stored it or its marker under -- honoured
 * only for a record or marker that names this same account.
 */
interface Candidate { recordId: string; aliases: string[]; item: OwnedQueuedHabitLog }
interface MigrationSource { key: string; raw: string; candidates: Candidate[] }
/**
 * R6 -- what inspecting the account's interim (localStorage) sources established:
 *   'unavailable'  storage could not be inspected (access denied, a read threw, no storage):
 *                  NOTHING is concluded -- no source is assumed absent, no marker is pruned;
 *   'ok'           inspected; `remaining` = some interim key of this account still exists
 *                  (parseable or not), i.e. retirement is NOT established.
 */
type Inspection = { state: 'unavailable' } | { state: 'ok'; sources: MigrationSource[]; remaining: boolean; lsTombs: Set<string> };

function inspectSources(owner: string): Inspection {
  let s: Storage;
  try {
    if (typeof localStorage === 'undefined' || localStorage === null) return { state: 'unavailable' };
    s = localStorage;
  } catch {
    return { state: 'unavailable' }; // the property itself denied
  }
  try {
    const sources: MigrationSource[] = [];
    const lsTombs = new Set(keysWithPrefix(s, `${TOMBSTONE_V4_PREFIX}${owner}:`).map((k) => k.slice(`${TOMBSTONE_V4_PREFIX}${owner}:`.length)));
    const valid = (v: unknown): v is OwnedQueuedHabitLog => isQueuedHabitLog(v) && (v as OwnedQueuedHabitLog).ownerUserId === owner;
    const v4 = keysWithPrefix(s, `${QUEUE_V4_PREFIX}${owner}:`);
    const v3 = keysWithPrefix(s, `${QUEUE_V3_PREFIX}${owner}:`);
    const v2 = s.getItem(QUEUE_V2_PREFIX + owner);
    for (const key of v4) {
      const raw = s.getItem(key);
      if (raw === null) continue;
      let v: unknown; try { v = JSON.parse(raw); } catch { continue; } // unparseable: left in place, never guessed at
      if (!valid(v) || !v.recordId) continue;
      // R7: an aura_q4 recordId is NOT account-scoped (the R3 migrator derived it from clientRequestId + payload
      // only), so it is an alias like any other pre-R7 id; the record itself gets the account-scoped identity.
      const legacy = legacyMigratedRecordId(v);
      sources.push({ key, raw, candidates: [{ recordId: migratedRecordId(v, owner), aliases: v.recordId === legacy ? [legacy] : [v.recordId, legacy], item: v }] });
    }
    for (const key of v3) {
      const raw = s.getItem(key);
      if (raw === null) continue;
      let v: unknown; try { v = JSON.parse(raw); } catch { continue; }
      if (!valid(v)) continue;
      sources.push({ key, raw, candidates: [{ recordId: migratedRecordId(v, owner), aliases: [legacyMigratedRecordId(v)], item: v }] });
    }
    if (v2 !== null) {
      let arr: unknown; try { arr = JSON.parse(v2); } catch { arr = null; }
      if (Array.isArray(arr) && arr.every(valid)) sources.push({ key: QUEUE_V2_PREFIX + owner, raw: v2, candidates: arr.map((item) => ({ recordId: migratedRecordId(item, owner), aliases: [legacyMigratedRecordId(item)], item })) });
    }
    return { state: 'ok', sources, remaining: v4.length > 0 || v3.length > 0 || v2 !== null, lsTombs };
  } catch {
    return { state: 'unavailable' };
  }
}

const prunedThisSession = new Set<string>();

export type MigrationState = 'retired' | 'pending' | 'unavailable';

/**
 * Interruption-safe, idempotent migration. Rejects if IndexedDB fails. Returns
 * what is established about the interim sources afterwards. A source is removed
 * only when EVERY entry in it is confirmed in this account's own store -- an
 * owned record or an owned settlement marker -- and the source is still exactly
 * what was copied. Markers are pruned only once retirement is positively
 * established ('retired'); never when storage is 'unavailable'.
 */
async function migrateOwnedSources(owner: string): Promise<MigrationState> {
  const first = inspectSources(owner);
  if (first.state === 'unavailable') return 'unavailable';
  if (first.sources.length > 0) {
    const confirmed = await tx('readwrite', async (st) => {
      const ok = new Set<string>(); // source keys whose every entry is confirmed for THIS account
      for (const src of first.sources) {
        let all = true;
        for (const c of src.candidates) {
          const ids = [c.recordId, ...c.aliases];
          const marker = await markerOf(st, owner, ids, first.lsTombs);
          if (marker === 'owned') continue; // settled or discarded before, BY THIS ACCOUNT
          if (await ownedRecordOf(st, owner, c.item, ids)) continue; // already stored for this account (any identity format)
          const existing = (await asPromise(st.records.get(c.recordId))) as Stored | undefined;
          if (existing) { all = false; continue; } // never reuse another account's record (account-scoped ids: only a hash collision)
          const rec: Stored = { recordId: c.recordId, ownerUserId: owner, clientRequestId: c.item.clientRequestId, item: { ...c.item, recordId: c.recordId }, queuedAt: c.item.queuedAt ?? 0 };
          // Ownership of the entry's earlier decision cannot be established: keep it, never send it automatically.
          if (marker === 'foreign') rec.held = 'ownership-unverified';
          await asPromise(st.records.add(rec));
        }
        if (all) ok.add(src.key);
      }
      return ok;
    });
    // Committed. Remove a source only if every entry was confirmed for this account AND it is still exactly what was copied.
    try {
      const s = localStorage;
      for (const src of first.sources) {
        if (!confirmed.has(src.key)) continue;
        try { if (s.getItem(src.key) === src.raw) s.removeItem(src.key); } catch { /* re-run later */ }
      }
    } catch { /* storage became unavailable: sources stay; re-run later */ }
  }
  // Markers expire only once source retirement is POSITIVELY established.
  const after = inspectSources(owner);
  if (after.state === 'unavailable') return 'unavailable';
  if (after.remaining) return 'pending';
  if (prunedThisSession.has(owner)) return 'retired';
  const now = Date.now();
  await tx('readwrite', async (st) => {
    const tombs = (await asPromise(st.tombstones.index('owner').getAll(IDBKeyRange.only(owner)))) as Tomb[];
    for (const t of tombs) if (now - t.at > TOMBSTONE_TTL_MS) await asPromise(st.tombstones.delete(t.recordId));
  });
  try {
    const s = localStorage;
    for (const t of keysWithPrefix(s, `${TOMBSTONE_V4_PREFIX}${owner}:`)) s.removeItem(t);
  } catch { /* best effort */ }
  prunedThisSession.add(owner);
  return 'retired';
}

// ------------------------------------------------------------------ reads

/** The owner's queue. `ok:false` when IndexedDB or the interim (localStorage) sources cannot be read, or ANY step fails. */
export async function readOwnedQueue(ownerUserId: string): Promise<QueueRead> {
  try {
    // R6: if the interim sources cannot be inspected, the queue is NOT known -- report it unreadable.
    if ((await migrateOwnedSources(ownerUserId)) === 'unavailable') return { ok: false };
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
      records.push({ recordId: r.recordId, item: { ...item, recordId: r.recordId, queuedAt: r.queuedAt }, inFlight: fresh(claims.get(key), now), dispatched: dispatches.has(key), held: Boolean(r.held) });
    }
    // Deterministic order: queued time, then log time, then identity (entries queued in the same millisecond).
    records.sort((a, b) => (a.item.queuedAt ?? 0) - (b.item.queuedAt ?? 0) || a.item.logTimestamp.localeCompare(b.item.logTimestamp) || a.item.clientRequestId.localeCompare(b.item.clientRequestId) || a.recordId.localeCompare(b.recordId));
    const byCrid = new Map<string, QueueRecord[]>();
    for (const r of records) byCrid.set(r.item.clientRequestId, [...(byCrid.get(r.item.clientRequestId) ?? []), r]);
    const groups: QueueRecord[][] = [];
    const conflicts: string[] = [];
    const held: string[] = [];
    const heldItems: OwnedQueuedHabitLog[] = [];
    for (const [crid, rs] of byCrid) {
      if (new Set(rs.map((r) => canonicalPayload(r.item))).size > 1) conflicts.push(crid);
      else if (rs.some((r) => r.held)) { held.push(crid); heldItems.push(rs[0].item); } // shown, never a replay group
      else groups.push(rs);
    }
    return { ok: true, items: [...groups.map((g) => g[0].item), ...heldItems], records, groups, conflicts, held, corruptIds };
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
      // R7: a held request (ownership unverified) is never claimed for sending.
      const claim = claimFor && !same.some((r) => r.held) ? await takeClaim(st, item.ownerUserId, item.clientRequestId, claimFor, now) : null;
      return { status: 'stored', recordId, claim } as const;
    });
  } catch {
    return { status: 'failed' };
  }
}

export type ClaimResult = { status: 'claimed'; claim: ClaimToken } | { status: 'gone' } | { status: 'in-flight' } | { status: 'held' } | { status: 'failed' };

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
      if (rec.held) return { status: 'held' } as const; // R7: ownership unverified -- never sent automatically
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

export interface RemovalResult { removed: number; alreadyGone: number; failed: number; superseded?: boolean; /** R7: records of another account, left untouched. */ foreign?: number }

/** R7: the account a settlement/discard acts for (explicit, or the claim token's). */
const ownerOfToken = (token?: ClaimToken) => (token ? token.key.split('\u0000')[0] : undefined);

/**
 * Settlement after a DEFINITIVE server answer: removes exactly these records
 * and tombstones them, atomically. The request's claim is cleared only if it
 * is still `token`'s attempt; a dispatch mark is cleared once no record of the
 * request remains.
 */
export async function settleRecords(recordIds: Iterable<string>, token?: ClaimToken, opts: { owner?: string } = {}): Promise<RemovalResult> {
  const ids = [...recordIds];
  const owner = opts.owner ?? ownerOfToken(token);
  try {
    const now = Date.now();
    return await tx('readwrite', async (st) => {
      const out: RemovalResult = { removed: 0, alreadyGone: 0, failed: 0, foreign: 0 };
      const keys = new Set<string>();
      for (const id of ids) {
        const rec = (await asPromise(st.records.get(id))) as Stored | undefined;
        if (!rec) { out.alreadyGone++; continue; }
        if (owner !== undefined && rec.ownerUserId !== owner) { out.foreign!++; continue; } // R7: never another account's record
        keys.add(requestKey(rec.ownerUserId, rec.clientRequestId));
        await asPromise(st.records.delete(id));
        await writeMarker(st, rec.ownerUserId, id, now);
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
    return { removed: 0, alreadyGone: 0, failed: ids.length, foreign: 0 };
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
  /** R7: records of another account, left untouched. */
  foreign?: number;
}

/**
 * A CONFIRMED discard of exactly these records (sign-out). Atomic. Records of
 * a request another context is sending right now are kept; records of a request
 * already dispatched are removed but reported as possibly sent.
 */
export async function discardRecords(recordIds: Iterable<string>, { tab, owner }: { tab: string; owner?: string }): Promise<DiscardResult> {
  const ids = [...recordIds];
  try {
    const now = Date.now();
    return await tx('readwrite', async (st) => {
      const out: DiscardResult = { removed: 0, removedPossiblySent: 0, keptInFlight: 0, alreadyGone: 0, failed: 0, foreign: 0 };
      const touched = new Set<string>();
      for (const id of ids) {
        const rec = (await asPromise(st.records.get(id))) as Stored | undefined;
        if (!rec) { out.alreadyGone++; continue; }
        if (owner !== undefined && rec.ownerUserId !== owner) { out.foreign!++; continue; } // R7: never another account's record
        const key = requestKey(rec.ownerUserId, rec.clientRequestId);
        const c = (await asPromise(st.claims.get(key))) as Claim | undefined;
        if (fresh(c, now) && c!.tab !== tab) { out.keptInFlight++; continue; }
        const dispatched = Boolean(await asPromise(st.dispatches.get(key)));
        await asPromise(st.records.delete(id));
        await writeMarker(st, rec.ownerUserId, id, now);
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
    return { removed: 0, removedPossiblySent: 0, keptInFlight: 0, alreadyGone: 0, failed: ids.length, foreign: 0 };
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
