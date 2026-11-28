/**
 * AURA-ANDROID-REL-04 (R13, ticket 39250) -- queue integrity corrections for independent verification 39249
 * (R12 handover 6373fd9, implementation 02e283e; NO-GO: E1-E4).
 *
 * The reviewer's evidence (review-r12-independent.ts, origins probe, logs) is preserved byte-for-byte in
 * docs/android/evidence/rel04-r12-independent-39249/ (SHA256SUMS). Each E-witness runs against the R12 code head
 * 02e283e (vendored in test/fixtures/rel04-r12-head, checked against git) -- the NEGATIVE CONTROL showing each test
 * detects the broken invariant -- and against the current code. Then the invariant matrix:
 *
 *   M1  replacement matrix (account-only, payload-only, request+record id, cross/same account) x replay, with the
 *       healthy-equivalent POSITIVE control; direct submission's claim/lease agreement (mutation negative control)
 *   M2  transaction outcomes: abort before commit, refusal at the claim's linearization point, lost acknowledgement
 *       after commit (reconciled), lost acknowledgement + failed reconciliation (unknown), storage-read failure after
 *       a committed write; retry and replay after each; exact rows, payloads, claims, decisions
 *   M3  cleanup verification: writes during the final scan; decision known + unreadable physical state
 *
 *   TS_NODE_COMPILER_OPTIONS='{"jsx":"react-jsx"}' npx ts-node --project tsconfig.jsdom-tests.json test/rel04R13QueueIntegrity.test.ts
 */
import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { Device, WEB, addUser, check, clearQueueDb, closeAllTabs, finish, idbFault, logsOf, openTab, payload, queueDump, resetStore, storage } from './rel04AccountIsolationHarness';

const ts = require(require.resolve('typescript', { paths: [WEB] }));
const Module = require('module');
const crypto = require('crypto');
const fidb = require(require.resolve('fake-indexeddb', { paths: [WEB] }));
const fx = (n: string) => fs.readFileSync(path.join(__dirname, 'fixtures', 'rel04-r12-head', n), 'utf8');
const gitHas = (c: string) => { try { execFileSync('git', ['cat-file', '-e', `${c}^{commit}`], { stdio: 'ignore' }); return true; } catch { return false; } };

(function provenance() {
  for (const f of ['offlineHabitQueue', 'activitySync', 'signOut']) {
    if (!gitHas('02e283e')) { console.log('SKIP fixture re-check: 02e283e not in this checkout'); break; }
    check(`fixture rel04-r12-head/${f}.ts.txt == 02e283e apps/web/lib/${f}.ts`, execFileSync('git', ['show', `02e283e:apps/web/lib/${f}.ts`], { encoding: 'utf8', maxBuffer: 1 << 26 }) === fx(`${f}.ts.txt`));
  }
  const W = path.join(__dirname, '..', 'docs', 'android', 'evidence', 'rel04-r12-independent-39249');
  const ren: Record<string, string> = { 'review-r12-independent.ts': 'review-r12-independent.ts.txt', 'review-r12-origins.cjs': 'review-r12-origins.cjs.txt', 'verify-integrity-r12.py': 'verify-integrity-r12.py.txt' };
  const sums = fs.readFileSync(path.join(W, 'SHA256SUMS'), 'utf8').trim().split('\n').map((l) => l.split(/\s+/)).map(([h, f]) => [h, ren[f] ?? f]);
  check(`the 39249 reviewer evidence is preserved byte-for-byte (${sums.length} SHA256SUMS entries; scripts stored as .txt)`, sums.length > 30 && sums.every(([h, f]) => fs.existsSync(path.join(W, f)) && crypto.createHash('sha256').update(fs.readFileSync(path.join(W, f))).digest('hex') === h));
})();

function compile(source: string, fakeFile: string, overrides: Record<string, unknown> = {}) {
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText;
  const m = new Module(fakeFile, module);
  m.filename = fakeFile; m.paths = Module._nodeModulePaths(path.dirname(fakeFile));
  const orig = m.require.bind(m);
  m.require = (id: string) => (id in overrides ? overrides[id] : orig(id));
  m._compile(js, fakeFile);
  return m.exports;
}
const lib = (n: string) => path.join(WEB, 'lib', n);
let seq = 0;
const A = 'r13-account-a', B = 'r13-account-b';
addUser(A, 'r13-a@example.invalid'); addUser(B, 'r13-b@example.invalid');
const route = '/api/habit-logs';
const body = (id: string, title = 'reviewed activity') => payload(title, id);
const item = (id: string, owner = A, title?: string) => ({ ...body(id, title), ownerUserId: owner, tempId: 'tmp' });
const row = (recordId: string, id: string, owner = A, title?: string) => ({ recordId, ownerUserId: owner, clientRequestId: id, item: item(id, owner, title), fmt: 'r8', queuedAt: 1 });
const realNow = Date.now;
/** Past the claim lifetime (60 s): an unconfirmed attempt's committed claim has expired. */
const afterClaimExpiry = () => { const t0 = realNow(); Date.now = () => t0 + 61_000; };
const rows = (owner: string, crid?: string) => logsOf(owner).filter((l: any) => crid === undefined || l.clientRequestId === crid);
async function fresh() { Date.now = realNow; resetStore(); storage.clear(); storage.fail = { get: false, set: false, remove: false }; idbFault.open = false; idbFault.read = false; idbFault.write = false; closeAllTabs(); await clearQueueDb(); }
type Stack = { q: any; sync: any; acct: any; so: any };
type Impl = { name: 'R12' | 'current'; tab: (id: string) => Stack };
const R12: Impl = { name: 'R12', tab: (id) => { const t = openTab(id); const q = compile(fx('offlineHabitQueue.ts.txt'), lib(`offlineHabitQueue.r12.${id}.${seq++}.js`)); const sync = compile(fx('activitySync.ts.txt'), lib(`activitySync.r12.${id}.${seq++}.js`), { './offlineHabitQueue': q }); const so = compile(fx('signOut.ts.txt'), lib(`signOut.r12.${id}.${seq++}.js`), { './offlineHabitQueue': q }); return { q, sync, acct: t.acct, so }; } };
const CUR: Impl = { name: 'current', tab: (id) => { const t = openTab(id); return { q: t.q, sync: t.sync, acct: t.acct, so: t.so }; } };
const dev = new Device();
let n = 0;
async function tab(impl: Impl, owner = A) { dev.signIn(owner); const s = impl.tab(`${impl.name}-${owner}-${n++}`); await s.acct.fetchVerifiedSession(dev.fetch as any); return s; }
function recorder() { const posts: Array<{ body: any; expected: string | null }> = []; const f = (async (u: unknown, i: any) => { if (String(u) === route && i?.method === 'POST') posts.push({ body: JSON.parse(i.body), expected: new Headers(i.headers).get('x-aura-expected-account') }); return dev.fetch(u as any, i); }) as any; return { posts, f }; }
async function put(s: Stack, r: any) { const db: IDBDatabase = await s.q.__openQueueDbForTests(); const t = db.transaction('records', 'readwrite'); t.objectStore('records').put(r); await new Promise<void>((ok, err) => { t.oncomplete = () => ok(); t.onabort = () => err(t.error); }); }
const dump = async () => { const d = await queueDump(); return { records: d.records.map((r: any) => `${r.recordId}:${r.ownerUserId === A ? 'A' : r.ownerUserId === B ? 'B' : '?'}:${r.clientRequestId}:${r.item?.activityTitle}`).sort(), claims: d.claims.map((c: any) => `${c.ownerUserId === A ? 'A' : 'B'}:${c.clientRequestId}`), decisions: d.tombstones.filter((t: any) => t.fmt === 'r8').map((t: any) => `${t.ownerUserId === A ? 'A' : 'B'}:${t.clientRequestId}:${t.decision}`) }; };
/** Barrier: commit `replacement` right after replay's first read-only records snapshot, whichever read API is used. */
function afterSnapshotRead(replacement: any) {
  const oi = fidb.IDBIndex.prototype.getAll, os = fidb.IDBObjectStore.prototype.getAll;
  const done = { committed: false };
  const restore = () => { fidb.IDBIndex.prototype.getAll = oi; fidb.IDBObjectStore.prototype.getAll = os; };
  const fire = (req: any, db: IDBDatabase) => { restore(); req.addEventListener('success', () => { const w = db.transaction('records', 'readwrite'); w.objectStore('records').put(replacement); w.oncomplete = () => { done.committed = true; }; }); };
  fidb.IDBIndex.prototype.getAll = function (...a: any[]) { const r = oi.apply(this, a); if (this.name === 'owner' && this.objectStore.transaction.mode === 'readonly') fire(r, this.objectStore.transaction.db); return r; };
  fidb.IDBObjectStore.prototype.getAll = function (...a: any[]) { const r = os.apply(this, a); if (this.name === 'records' && this.transaction.mode === 'readonly') fire(r, this.transaction.db); return r; };
  return { restore, done };
}
/** Barrier: run `effect` when the claim transaction's first decision read succeeds (inside the claim). */
// R18: the claim transaction's first decision read is get() (R12-R17) or getAll() (R18: one account-wide discovery).
function insideClaim(effect: () => void) {
  const o = fidb.IDBObjectStore.prototype.get, oa = fidb.IDBObjectStore.prototype.getAll;
  const restore = () => { fidb.IDBObjectStore.prototype.get = o; fidb.IDBObjectStore.prototype.getAll = oa; };
  const hook = (orig: any) => function (this: any, ...a: any[]) { const r = orig.apply(this, a); if (this.name === 'tombstones' && this.transaction.mode === 'readwrite') { restore(); r.addEventListener('success', effect); } return r; };
  fidb.IDBObjectStore.prototype.get = hook(o); fidb.IDBObjectStore.prototype.getAll = hook(oa);
  return restore;
}
/** The next read-write transaction commits, but its caller sees an error (lost acknowledgement). */
function loseNextAck(onLost?: () => void) { const o = fidb.IDBDatabase.prototype.transaction; fidb.IDBDatabase.prototype.transaction = function (...a: any[]) { const t = o.apply(this, a); if (t.mode === 'readwrite') { fidb.IDBDatabase.prototype.transaction = o; t.addEventListener('complete', () => { onLost?.(); t.onerror?.(new Event('error')); }); } return t; }; return () => { fidb.IDBDatabase.prototype.transaction = o; }; }

async function replacementCase(impl: Impl, replacement: any) {
  await fresh();
  const s = await tab(impl);
  await put(s, row('K', 'X'));
  const rec = recorder();
  const b = afterSnapshotRead(replacement);
  const r = await s.sync.replayOfflineQueue(rec.f).finally(b.restore);
  return { committed: b.done.committed, attempted: r.attempted, posts: rec.posts.map((p) => `${p.expected === A ? 'A' : 'B'}:${p.body.clientRequestId}:${p.body.activityTitle}`), rowsA: rows(A).length, rowsB: rows(B).length, ...(await dump()) };
}

async function main() {
  // ================================================================ E-witnesses: R12 (negative control) vs current
  {
    const b = await replacementCase(R12, row('K', 'X', B)), a = await replacementCase(CUR, row('K', 'X', B));
    console.log('E1', JSON.stringify({ R12: b, current: a }));
    check('E1 R12 (negative control) reproduces: account-only replacement (B/X/P at K) -> claim for B, POST of P with A\'s lease, 1 A row', b.committed && b.claims.join() === 'B:X' && b.posts.join() === 'A:X:reviewed activity' && b.rowsA === 1);
    check('E1 CORRECTED: the claim binds the inspected account -> refused; 0 POSTs, 0 rows, no claim, no decision; B\'s record preserved', a.committed && a.attempted === 0 && a.posts.length === 0 && a.rowsA + a.rowsB === 0 && a.claims.length === 0 && a.decisions.length === 0 && a.records.join() === 'K:B:X:reviewed activity');
  }
  for (const impl of [R12, CUR]) {
    await fresh();
    const s = await tab(impl);
    const restore = insideClaim(() => { storage.fail.get = true; });
    const r = await s.sync.submitActivityLog(body('late-fail'), 'tmp', dev.fetch as any).finally(() => { restore(); storage.fail.get = false; });
    const before = await dump();
    const rec = recorder();
    const rp = await s.sync.replayOfflineQueue(rec.f);
    console.log(`E2 ${impl.name}`, JSON.stringify({ result: r.kind, before, replayAttempted: rp.attempted, rows: rows(A).length }));
    if (impl === R12) check('E2 R12 (negative control) reproduces: "storage-unavailable" but a hidden outbox row committed and later replays (1 row)', r.kind === 'storage-unavailable' && before.records.length === 1 && rp.attempted === 1 && rows(A).length === 1);
    else check('E2 CORRECTED: the refusal aborts the claim transaction -> nothing committed (0 records, 0 claims); replay sends nothing; 0 rows -- the result matches storage', r.kind === 'storage-unavailable' && before.records.length === 0 && before.claims.length === 0 && rp.attempted === 0 && rows(A).length === 0);
  }
  for (const impl of [R12, CUR]) {
    await fresh();
    const s = await tab(impl);
    await put(s, row('only-in-idb', 'report-race'));
    const snap = await s.q.readOwnedQueue(A);
    const os = fidb.IDBObjectStore.prototype.getAll;
    fidb.IDBObjectStore.prototype.getAll = function (...a: any[]) { const r = os.apply(this, a); if (this.name === 'records' && this.transaction.mode === 'readonly') r.addEventListener('success', () => storage.setItem(`aura_q3:${A}:report-race`, JSON.stringify(item('report-race')))); return r; };
    const out = await s.q.discardOwned(A, snap, { tab: 't' }).finally(() => { fidb.IDBObjectStore.prototype.getAll = os; });
    console.log(`E3 ${impl.name}`, JSON.stringify(out));
    if (impl === R12) check('E3 R12 (negative control) reproduces: a retired copy written during the final scan -> removed=1 although it exists', out.removed === 1 && storage.data.has(`aura_q3:${A}:report-race`));
    else check('E3 CORRECTED: retired storage is inspected at the reporting boundary -> cleanup pending (known remaining copy), never removed', out.removed === 0 && out.cleanupPending === 1 && storage.data.has(`aura_q3:${A}:report-race`));
  }
  for (const impl of [R12, CUR]) {
    await fresh();
    const s = await tab(impl);
    await put(s, row('report-read-fails', 'verify-unavailable'));
    const snap = await s.q.readOwnedQueue(A);
    const os = fidb.IDBObjectStore.prototype.getAll;
    fidb.IDBObjectStore.prototype.getAll = function (...a: any[]) { if (this.name === 'records' && this.transaction.mode === 'readonly') throw new Error('physical verification failure (synthetic)'); return os.apply(this, a); };
    const out = await s.q.discardOwned(A, snap, { tab: 't' }).finally(() => { fidb.IDBObjectStore.prototype.getAll = os; });
    const msg = impl === CUR ? s.so.discardOutcomeMessage({ outcome: 'signed-out', owned: { unknown: false, ...out } }) : '';
    console.log(`E4 ${impl.name}`, JSON.stringify(out));
    if (impl === R12) check('E4 R12 (negative control) reproduces: decision known, physical read failed -> "cleanup pending" (implies a known copy) with 0 copies', out.cleanupPending === 1 && (await queueDump()).records.length === 0);
    else check('E4 CORRECTED: reported as discarded with the physical state UNVERIFIED (never "a copy could not be deleted"); decision kept', out.discardedUnverified === 1 && out.cleanupPending === 0 && out.removed === 0 && /couldn't check whether a copy of it remains/.test(msg) && !/couldn't delete/.test(msg));
  }

  // ================================================================ M1 replacement matrix (replay) + positive control
  const cases: Array<[string, any]> = [
    ['healthy equivalent (positive control)', row('K', 'X')],
    ['account-only (B/X/P)', row('K', 'X', B)],
    ['payload-only (A/X/P\')', row('K', 'X', A, 'changed payload')],
    ['request id (A/Y/P)', row('K', 'Y')],
    ['cross-account request id (B/Y/P)', row('K', 'Y', B)],
    ['equivalent copy added under another record id (A/X/P at K2)', null],
  ];
  for (const [label, rep] of cases) {
    let r: any;
    if (rep === null) {
      await fresh();
      const s = await tab(CUR);
      await put(s, row('K', 'X'));
      const rec = recorder();
      const b = afterSnapshotRead(row('K2', 'X'));
      const res = await s.sync.replayOfflineQueue(rec.f).finally(b.restore);
      r = { attempted: res.attempted, posts: rec.posts.map((p) => `${p.expected === A ? 'A' : 'B'}:${p.body.clientRequestId}:${p.body.activityTitle}`), rowsA: rows(A).length, rowsB: rows(B).length, ...(await dump()) };
      check(`M1 ${label}: an equivalent copy under another record id is the same logical activity -> sent once with the claimed payload, both copies settled`, r.posts.join() === 'A:X:reviewed activity' && r.rowsA === 1 && r.records.length === 0 && r.decisions.join() === 'A:X:settled');
      continue;
    }
    r = await replacementCase(CUR, rep);
    console.log(`M1 ${label}`, JSON.stringify(r));
    if (label.startsWith('healthy')) check(`M1 ${label}: sent once with the claimed payload, A row 1, settled`, r.posts.join() === 'A:X:reviewed activity' && r.rowsA === 1 && r.decisions.join() === 'A:X:settled' && r.records.length === 0);
    else check(`M1 ${label}: refused at the claim -> 0 POSTs, 0 rows, no claim, no decision, replacement preserved`, r.attempted === 0 && r.posts.length === 0 && r.rowsA + r.rowsB === 0 && r.claims.length === 0 && r.decisions.length === 0 && r.records.length === 1);
  }
  // Direct submission: claim/lease agreement. NEGATIVE CONTROL: a mutated queue that returns a claim for B.
  {
    await fresh();
    const s = await tab(CUR);
    const realEnqueue = s.q.enqueueOwned;
    s.q.enqueueOwned = async (it: any, o: any) => { const r = await realEnqueue(it, o); return r.status === 'stored' && r.claim ? { ...r, claim: { ...r.claim, owner: B } } : r; };
    const rec = recorder();
    let r: any;
    try { r = await s.sync.submitActivityLog(body('direct-x'), 'tmp', rec.f); } finally { s.q.enqueueOwned = realEnqueue; }
    check('M1 direct submission: a claim whose account differs from the authenticated lease is never transmitted (mutation negative control: 0 POSTs, kept)', rec.posts.length === 0 && r.kind === 'account-changed' && rows(A).length + rows(B).length === 0);
    const ok = await s.sync.submitActivityLog(body('direct-ok'), 'tmp', rec.f);
    check('M1 direct submission positive control: unmutated -> confirmed once with A\'s header and the claimed payload', ok.kind === 'confirmed' && rec.posts.map((p) => `${p.expected === A ? 'A' : 'B'}:${p.body.clientRequestId}`).join() === 'A:direct-ok' && rows(A, 'direct-ok').length === 1);
  }

  // ================================================================ M2 transaction outcomes + retry/replay
  {
    // (a) abort before commit
    await fresh();
    const s = await tab(CUR);
    idbFault.write = true;
    const r = await s.sync.submitActivityLog(body('m2a'), 'tmp', dev.fetch as any);
    idbFault.write = false;
    const rp = await s.sync.replayOfflineQueue(dev.fetch as any);
    check('M2a write fails before commit -> confirmed NOT queued (storage-unavailable), nothing stored, replay sends nothing, 0 rows', r.kind === 'storage-unavailable' && (await dump()).records.length === 0 && rp.attempted === 0 && rows(A).length === 0);
  }
  {
    // (b) lost acknowledgement after commit, reconciled -> queued; retry (same id) and replay never duplicate
    await fresh();
    const s = await tab(CUR);
    const restore = loseNextAck();
    const rec = recorder();
    const r = await s.sync.submitActivityLog(body('m2b'), 'tmp', rec.f).finally(restore);
    const after = await dump();
    const postsBeforeRetry = rec.posts.length;
    afterClaimExpiry();
    const retry = await s.sync.submitActivityLog(body('m2b'), 'tmp', rec.f);
    const rp = await s.sync.replayOfflineQueue(rec.f);
    console.log('M2b', JSON.stringify({ first: r.kind, after, retry: retry.kind, replayAttempted: rp.attempted, posts: rec.posts.length, rows: rows(A, 'm2b').length }));
    check('M2b lost acknowledgement after commit -> reconciled from storage: reported QUEUED (never rejected), exactly 1 committed record', r.kind === 'queued' && after.records.length === 1 && postsBeforeRetry === 0);
    check('M2b retry under the same request id and later replay deliver it exactly once: 1 POST, 1 row, settled', rec.posts.length === 1 && rows(A, 'm2b').length === 1 && (await dump()).decisions.join() === 'A:m2b:settled');
  }
  {
    // (c) lost acknowledgement + failed reconciliation -> unknown; the row stays pending; replay once later
    await fresh();
    const s = await tab(CUR);
    const restore = loseNextAck(() => { idbFault.read = true; });
    const r = await s.sync.submitActivityLog(body('m2c'), 'tmp', dev.fetch as any).finally(() => { restore(); idbFault.read = false; });
    const after = await dump();
    const rec = recorder();
    afterClaimExpiry();
    const rp = await s.sync.replayOfflineQueue(rec.f);
    const rp2 = await s.sync.replayOfflineQueue(rec.f);
    check('M2c commit unconfirmed and reconciliation unreadable -> OUTCOME-UNKNOWN (never "not saved"); the committed record replays exactly once later (1 POST, 1 row)', r.kind === 'outcome-unknown' && after.records.length === 1 && rp.attempted + rp2.attempted === 1 && rec.posts.length === 1 && rows(A, 'm2c').length === 1);
  }
  {
    // (d) storage-read failure AFTER a committed write (at the transmission check)
    await fresh();
    const s = await tab(CUR);
    const o = fidb.IDBDatabase.prototype.transaction;
    fidb.IDBDatabase.prototype.transaction = function (...a: any[]) { const t = o.apply(this, a); if (t.mode === 'readwrite') { fidb.IDBDatabase.prototype.transaction = o; t.addEventListener('complete', () => { storage.fail.get = true; }); } return t; };
    const rec = recorder();
    const r = await s.sync.submitActivityLog(body('m2d'), 'tmp', rec.f).finally(() => { fidb.IDBDatabase.prototype.transaction = o; storage.fail.get = false; });
    const after = await dump();
    const postsBefore = rec.posts.length;
    const rp = await s.sync.replayOfflineQueue(rec.f);
    console.log('M2d', JSON.stringify({ r: r.kind, postsBefore, after, replayAttempted: rp.attempted, posts: rec.posts.length }));
    check('M2d read failure after the committed write -> reported QUEUED (kept, not sent now; never "not stored"), no POST, claim released', r.kind === 'queued' && postsBefore === 0 && after.records.length === 1 && after.claims.length === 0);
    check('M2d once storage is readable the queued request replays exactly once: 1 row', rows(A, 'm2d').length === 1 && rec.posts.length === 1);
  }
  {
    // (e) refusal at the claim's linearization point with an EXISTING copy: the existing copy is unaffected
    await fresh();
    const s = await tab(CUR);
    await put(s, row('pre', 'm2e'));
    const restore = insideClaim(() => { storage.fail.get = true; });
    const r = await s.sync.submitActivityLog(body('m2e'), 'tmp', dev.fetch as any).finally(() => { restore(); storage.fail.get = false; });
    const after = await dump();
    check('M2e refusal while an earlier copy exists -> storage-unavailable for THIS call; the pre-existing copy is untouched (still queued), no claim', r.kind === 'storage-unavailable' && after.records.join() === 'pre:A:m2e:reviewed activity' && after.claims.length === 0);
  }

  // ================================================================ M3 cleanup verification
  {
    // IndexedDB write during the final scan's transaction lifetime -> visible to the scan's ordering or not at all
    await fresh();
    const s = await tab(CUR);
    await put(s, row('m3', 'm3'));
    const snap = await s.q.readOwnedQueue(A);
    const out = await s.q.discardOwned(A, snap, { tab: 't' });
    await put(s, row('late', 'm3')); // AFTER reporting: outside the reported observation; the decision still blocks it
    const sub = await s.sync.submitActivityLog(body('m3'), 'tmp', dev.fetch as any);
    const rp = await s.sync.replayOfflineQueue(dev.fetch as any);
    check('M3 "removed" means observed absent at the reporting boundary; a copy written afterwards never resurrects (decision blocks submit and replay, 0 rows)', out.removed === 1 && sub.kind === 'not-stored' && rp.attempted === 0 && rows(A).length === 0);
  }
  finish();
}

main().catch((e) => { console.error(e); process.exit(1); });
