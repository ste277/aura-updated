/**
 * AURA-ANDROID-REL-04 (R11, ticket 39245) -- structural queue correction for independent review 39244 (R10 head
 * 4a37173, implementation 8f3d316; disposition OPEN: D1-D7, P3).
 *
 * The reviewer's edge probe (review-r10-edge.ts) and every log are preserved byte-for-byte in
 * docs/android/evidence/rel04-r10-independent-39244/ (SHA256SUMS, plus the disposition). Each witness is re-run
 * here, in the probe's shape, against the R10 code head 8f3d316 (vendored in test/fixtures/rel04-r10-head,
 * checked against git) and against the current code; then the R11 cross-format matrix (X1-X12).
 *
 *   TS_NODE_COMPILER_OPTIONS='{"jsx":"react-jsx"}' npx ts-node --project tsconfig.jsdom-tests.json test/rel04R11StructuralQueue.test.ts
 */
import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { Device, WEB, addUser, check, clearQueueDb, closeAllTabs, finish, idbFault, logsOf, openTab, payload, queueDump, resetStore, storage } from './rel04AccountIsolationHarness';

const ts = require(require.resolve('typescript', { paths: [WEB] }));
const Module = require('module');
const crypto = require('crypto');
const FIX = path.join(__dirname, 'fixtures');
const fx = (dir: string, n: string) => fs.readFileSync(path.join(FIX, dir, n), 'utf8');
const gitHas = (c: string) => { try { execFileSync('git', ['cat-file', '-e', `${c}^{commit}`], { stdio: 'ignore' }); return true; } catch { return false; } };
const fidb = require(require.resolve('fake-indexeddb', { paths: [WEB] }));

(function provenance() {
  for (const f of ['offlineHabitQueue', 'activitySync', 'signOut']) {
    if (!gitHas('8f3d316')) { console.log('SKIP fixture re-check: 8f3d316 not in this checkout'); break; }
    check(`fixture rel04-r10-head/${f}.ts.txt == 8f3d316 apps/web/lib/${f}.ts`, execFileSync('git', ['show', `8f3d316:apps/web/lib/${f}.ts`], { encoding: 'utf8', maxBuffer: 1 << 26 }) === fx('rel04-r10-head', `${f}.ts.txt`));
  }
  const W = path.join(__dirname, '..', 'docs', 'android', 'evidence', 'rel04-r10-independent-39244');
  const sums = fs.readFileSync(path.join(W, 'SHA256SUMS'), 'utf8').trim().split('\n').map((l) => l.split(/\s+/)).map(([h, f]) => [h, f.replace(/^review-r10-(edge|browser)\.ts$/, 'review-r10-$1.ts.txt')]);
  check(`the 39244 reviewer evidence is preserved byte-for-byte (${sums.length} SHA256SUMS entries; the two probes stored as .ts.txt)`, sums.length >= 25 && sums.every(([h, f]) => fs.existsSync(path.join(W, f)) && crypto.createHash('sha256').update(fs.readFileSync(path.join(W, f))).digest('hex') === h));
})();

function compile(source: string, fakeFile: string, overrides: Record<string, unknown> = {}) {
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText;
  const m = new Module(fakeFile, module);
  m.filename = fakeFile;
  m.paths = Module._nodeModulePaths(path.dirname(fakeFile));
  const orig = m.require.bind(m);
  m.require = (id: string) => (id in overrides ? overrides[id] : orig(id));
  m._compile(js, fakeFile);
  return m.exports;
}
const lib = (n: string) => path.join(WEB, 'lib', n);
let seq = 0;

const A = 'r11-account-a';
const B = 'r11-account-b';
addUser(A, 'r11-a@example.invalid');
addUser(B, 'r11-b@example.invalid');
const item = (crid: string, owner = A, title = 'review activity') => ({ ...payload(title, crid), ownerUserId: owner, tempId: 'temp' });
const damaged = (crid: string, owner = A) => ({ ...item(crid, owner), logTimestamp: 'invalid' });
const lsKeys = (prefix: string) => [...storage.data.keys()].filter((k) => k.startsWith(prefix));
const rows = (owner: string, crid?: string) => logsOf(owner).filter((l: any) => crid === undefined || l.clientRequestId === crid).length;

async function fresh() {
  resetStore(); storage.clear(); storage.fail = { get: false, set: false, remove: false };
  idbFault.open = false; idbFault.read = false; idbFault.write = false;
  closeAllTabs();
  await clearQueueDb();
}

type Stack = { q: any; sync: any; acct: any; so: any };
type Impl = { name: 'R10' | 'current'; tab: (id: string) => Stack };
const R10: Impl = {
  name: 'R10',
  tab: (id) => {
    const t = openTab(id);
    const q = compile(fx('rel04-r10-head', 'offlineHabitQueue.ts.txt'), lib(`offlineHabitQueue.r10.${id}.${seq++}.js`));
    const sync = compile(fx('rel04-r10-head', 'activitySync.ts.txt'), lib(`activitySync.r10.${id}.${seq++}.js`), { './offlineHabitQueue': q });
    const so = compile(fx('rel04-r10-head', 'signOut.ts.txt'), lib(`signOut.r10.${id}.${seq++}.js`), { './offlineHabitQueue': q });
    return { q, sync, acct: t.acct, so };
  },
};
const CUR: Impl = { name: 'current', tab: (id) => { const t = openTab(id); return { q: t.q, sync: t.sync, acct: t.acct, so: t.so }; } };

const dev = new Device();
let tabSeq = 0;
async function tab(impl: Impl, owner = A): Promise<Stack> {
  dev.signIn(owner);
  const s = impl.tab(`${impl.name}-${owner}-${tabSeq++}`);
  await s.acct.fetchVerifiedSession(dev.fetch as any);
  return s;
}
const submit = (s: Stack, id: string, title = 'review activity') => s.sync.submitActivityLog(payload(title, id), 'temp', dev.fetch as any);
const replay = (s: Stack) => s.sync.replayOfflineQueue(dev.fetch as any);
async function signout(s: Stack, opts: { onConfirm?: () => void; fetch?: typeof fetch } = {}) {
  let asked = '';
  const out = await s.so.performSignOut({ fetch: (opts.fetch ?? dev.fetch) as any, confirm: (m: string) => { asked = m; opts.onConfirm?.(); return true; } });
  return { out, owned: out.owned, asked, message: (s.so.signOutOutcomeMessage(out) as string | null) ?? '' };
}
const markers = async () => (await queueDump()).tombstones.filter((t: any) => t.fmt === 'r8').map((r: any) => [r.ownerUserId, r.clientRequestId, r.decision]);
async function put(s: Stack, r: any) {
  const db: IDBDatabase = await s.q.__openQueueDbForTests();
  const t = db.transaction('records', 'readwrite');
  t.objectStore('records').put(r);
  await new Promise<void>((ok, err) => { t.oncomplete = () => ok(); t.onerror = () => err(t.error); });
}
const snapshot = async (s: Stack, owner = A) => { const r = await s.q.readOwnedQueue(owner); if (!r.ok) throw new Error('unreadable'); return r; };

// ================================================================ the reviewer's witnesses, per implementation
const W = {
  async D1(impl: Impl) {
    await fresh();
    const s = await tab(impl);
    await put(s, { recordId: 'missing-index', ownerUserId: A, item: damaged('nested-request'), fmt: 'r8', queuedAt: 1 });
    const so = await signout(s);
    const decisionsAtSignOut = (await markers()).length;
    const sub = await submit(await tab(impl), 'nested-request');
    return { outcome: so.owned, decisionsAtSignOut, submit: sub.kind, rows: rows(A, 'nested-request'), copies: (await queueDump()).records.length };
  },
  async D2claim(impl: Impl) {
    await fresh();
    const s = await tab(impl);
    await s.q.enqueueOwned(item('candidate-y'));
    await put(s, { recordId: 'contradiction', ownerUserId: A, clientRequestId: 'candidate-x', item: item('candidate-y'), fmt: 'r8', queuedAt: 2 });
    const direct = await submit(s, 'candidate-y');
    const good = (await queueDump()).records.find((r: any) => r.clientRequestId === 'candidate-y');
    const claim = await s.q.claimForDispatch(good.recordId, 'claim-review');
    if (claim.status === 'claimed') await s.q.releaseClaim(claim.claim);
    return { direct: direct.kind, claim: claim.status, rows: rows(A) };
  },
  async D2replay(impl: Impl) {
    await fresh();
    const s = await tab(impl);
    await s.q.enqueueOwned(item('race-y'));
    // Deterministic barrier: the FIRST read-only read of the queue's records (replay's snapshot read), whichever
    // read the implementation uses (R10/R11: the owner index; R12: a store scan); the conflict is written then.
    const originalIndex = fidb.IDBIndex.prototype.getAll;
    const originalStore = fidb.IDBObjectStore.prototype.getAll;
    const restore = () => { fidb.IDBIndex.prototype.getAll = originalIndex; fidb.IDBObjectStore.prototype.getAll = originalStore; };
    const inject = (req: any, db: IDBDatabase) => { restore(); req.addEventListener('success', () => { db.transaction('records', 'readwrite').objectStore('records').put({ recordId: 'late-conflict', ownerUserId: A, clientRequestId: 'race-x', item: item('race-y'), fmt: 'r8', queuedAt: 3 }); }); };
    fidb.IDBIndex.prototype.getAll = function (...args: any[]) { const req = originalIndex.apply(this, args); if (this.name === 'owner' && this.objectStore.transaction.mode === 'readonly') inject(req, this.objectStore.transaction.db); return req; };
    fidb.IDBObjectStore.prototype.getAll = function (...args: any[]) { const req = originalStore.apply(this, args); if (this.name === 'records' && this.transaction.mode === 'readonly') inject(req, this.transaction.db); return req; };
    try { const r = await replay(s); return { attempted: r.attempted, rows: rows(A, 'race-y') }; } finally { restore(); }
  },
  async D3(impl: Impl, format: 'aura_q3' | 'aura_q4') {
    await fresh();
    const s = await tab(impl);
    const key = `${format}:${A}:wrong-owner${format === 'aura_q4' ? ':copy' : ''}`;
    const raw = JSON.stringify(damaged('wrong-owner', B));
    storage.setItem(key, raw);
    const before = await snapshot(s);
    const a = await submit(s, 'wrong-owner');
    const so = await signout(s);
    const b = await snapshot(await tab(impl, B), B);
    return { pausedA: before.paused, pausedB: b.paused, submitA: a.kind, rowsA: rows(A), rowsB: rows(B), unidentified: so.owned?.unidentified ?? 0, rawPreserved: storage.getItem(key) === raw };
  },
  async D4(impl: Impl) {
    await fresh();
    const s = await tab(impl);
    await put(s, { recordId: 'edited-while-confirming', ownerUserId: A, clientRequestId: 'approved', item: damaged('approved'), fmt: 'r8', queuedAt: 1 });
    const so = await signout(s, { fetch: (async (input: unknown, init: any) => { if (String(input) === '/api/auth/logout') await put(s, { recordId: 'edited-while-confirming', ownerUserId: A, clientRequestId: 'unseen', item: damaged('unseen'), fmt: 'r8', queuedAt: 1 }); return dev.fetch(input as any, init); }) as any });
    return { removed: so.owned?.removed, remaining: (await queueDump()).records.map((r: any) => r.clientRequestId), markers: (await markers()).map((m) => `${m[1]}:${m[2]}`) };
  },
  async D5(impl: Impl) {
    await fresh();
    const s = await tab(impl);
    await s.q.enqueueOwned(item('possibly-sent'));
    const rec = (await queueDump()).records[0];
    const held = await s.q.claimForDispatch(rec.recordId, 'other-tab');
    await put(s, { ...rec, item: damaged('possibly-sent', B) });
    storage.setItem(`aura_q3:${A}:possibly-sent`, JSON.stringify(item('possibly-sent')));
    const before = await snapshot(s);
    const so = await signout(s);
    const left = { claims: (await queueDump()).claims.length, retired: lsKeys(`aura_q3:${A}:`).length, decisions: (await markers()).length };
    if (held.status === 'claimed') await s.q.releaseClaim(held.claim);
    return { dispatched: before.dispatched, total: before.total, owned: so.owned, message: so.message, ...left };
  },
  async D6(impl: Impl) {
    await fresh();
    const s = await tab(impl);
    dev.fault('POST', '/api/habit-logs', 'network-after');
    await submit(s, 'already-sent');
    storage.setItem(`aura_q3:${A}:already-sent`, JSON.stringify(item('already-sent')));
    storage.fail.remove = true;
    const first = await signout(s);
    storage.fail.remove = false;
    const second = await signout(await tab(impl));
    return { first: first.owned, second: second.owned, rows: rows(A, 'already-sent'), message: second.message };
  },
  async D7(impl: Impl) {
    await fresh();
    const s = await tab(impl);
    storage.setItem(`aura_q4:${A}:missing-record-id-delimiter`, '{bad');
    const so = await signout(s);
    return { outcome: so.owned, markers: (await markers()).length, sourceLeft: storage.getItem(`aura_q4:${A}:missing-record-id-delimiter`) };
  },
  async P3(impl: Impl) {
    await fresh();
    const s = await tab(impl);
    await s.q.enqueueOwned(item('ack-lost'));
    const raw = JSON.stringify([damaged('ack-lost')]);
    storage.setItem(`offline_habit_queue_v2:${A}`, raw);
    const sn = await snapshot(s);
    const original = fidb.IDBDatabase.prototype.transaction;
    fidb.IDBDatabase.prototype.transaction = function (...args: any[]) {
      const t = original.apply(this, args);
      if (t.mode === 'readwrite') { fidb.IDBDatabase.prototype.transaction = original; t.addEventListener('complete', () => t.onerror?.(new Event('error'))); }
      return t;
    };
    let out: any;
    try { out = await s.q.discardOwned(A, sn, { tab: 'review' }); } finally { fidb.IDBDatabase.prototype.transaction = original; }
    const a = await tab(impl);
    const direct = await submit(a, 'ack-lost');
    return { out, markers: (await markers()).length, sourcePreserved: storage.getItem(`offline_habit_queue_v2:${A}`) === raw, submit: direct.kind, rows: rows(A, 'ack-lost') };
  },
};

async function main() {
  // ---------------------------------------------------------------- D1
  { const b = await W.D1(R10), a = await W.D1(CUR); console.log('D1', JSON.stringify({ R10: b, current: a }));
    check('D1 R10 reproduces: missing outer request id, intact nested identity -> no outcome, no decision; resubmission confirmed (1 row)', b.decisionsAtSignOut === 0 && b.submit === 'confirmed' && b.rows === 1);
    check('D1 CORRECTED: identified by its nested identity -> removed with a durable decision; resubmission refused; 0 rows', a.outcome.removed === 1 && a.decisionsAtSignOut === 1 && a.copies === 0 && a.submit === 'not-stored' && a.rows === 0); }
  // ---------------------------------------------------------------- D2
  { const b = await W.D2claim(R10), a = await W.D2claim(CUR); console.log('D2 claim', JSON.stringify({ R10: b, current: a }));
    check('D2 R10 reproduces: direct submission refuses the contradictory request but the replay CLAIM accepts it', b.direct === 'not-stored' && b.claim === 'claimed');
    check('D2 CORRECTED: direct submission and claim apply the same gate (both refuse)', a.direct === 'not-stored' && a.claim === 'paused' && a.rows === 0); }
  { const b = await W.D2replay(R10), a = await W.D2replay(CUR); console.log('D2 replay', JSON.stringify({ R10: b, current: a }));
    check('D2 R10 reproduces: a contradiction written between replay\'s read and its claim is sent (1 row)', b.attempted === 1 && b.rows === 1);
    check('D2 CORRECTED: the claim transaction re-resolves every copy and refuses it (0 attempts, 0 rows)', a.attempted === 0 && a.rows === 0); }
  // ---------------------------------------------------------------- D3
  for (const f of ['aura_q3', 'aura_q4'] as const) {
    const b = await W.D3(R10, f), a = await W.D3(CUR, f); console.log(`D3 ${f}`, JSON.stringify({ R10: b, current: a }));
    check(`D3 R10 reproduces (${f}): a key under A whose value names B is skipped -> A 0 paused, A's same-id submission confirmed (1 row), sign-out reports nothing`, b.pausedA === 0 && b.submitA === 'confirmed' && b.rowsA === 1 && b.unidentified === 0);
    check(`D3 CORRECTED (${f}): contradictory -> quarantined for A (paused 1), A's same-id submission refused, preserved and reported unidentified; B unaffected; 0 rows`, a.pausedA === 1 && a.submitA === 'not-stored' && a.rowsA === 0 && a.rowsB === 0 && a.pausedB === 0 && a.unidentified === 1 && a.rawPreserved);
  }
  // ---------------------------------------------------------------- D4
  { const b = await W.D4(R10), a = await W.D4(CUR); console.log('D4', JSON.stringify({ R10: b, current: a }));
    check('D4 R10 reproduces: a replacement identity written after confirmation is deleted and decided; the confirmed one gets no decision', b.remaining.length === 0 && b.markers.join() === 'unseen:discarded');
    check('D4 CORRECTED: only the confirmed identity is decided; the replacement (unseen) is neither deleted nor decided', a.markers.join() === 'approved:discarded' && a.remaining.join() === 'unseen'); }
  // ---------------------------------------------------------------- D5
  { const b = await W.D5(R10), a = await W.D5(CUR); console.log('D5', JSON.stringify({ R10: { ...b, message: undefined }, current: { ...a, message: undefined } }));
    check('D5 R10 reproduces: with another context\'s fresh claim and a damaged active copy, sign-out removes the retired copy and reports removed + possibly sent while the claim remains', b.owned.removed === 1 && b.owned.keptInFlight === 0 && b.retired === 0 && b.claims === 1);
    check('D5 CORRECTED: the claimed activity is kept in flight as a whole (nothing deleted or decided); the damaged copy is reported unidentified without "never sent"; the confirmation counts the one send once', a.owned.keptInFlight === 1 && a.owned.removed === 0 && a.retired === 1 && a.decisions === 0 && a.claims === 1 && a.dispatched === 1 && !/never sent/.test(a.message)); }
  // ---------------------------------------------------------------- D6
  { const b = await W.D6(R10), a = await W.D6(CUR); console.log('D6', JSON.stringify({ R10: { ...b, message: undefined }, current: { ...a, message: undefined } }));
    check('D6 R10 reproduces: the retry forgets the actual prior send (removedPossiblySent 0, server row exists)', b.first.cleanupPendingPossiblySent === 1 && b.second.removed === 1 && b.second.removedPossiblySent === 0 && b.rows === 1);
    check('D6 CORRECTED: the decision keeps the prior-send fact; the retry reports removed 1, possibly sent 1', a.first.cleanupPendingPossiblySent === 1 && a.second.removed === 1 && a.second.removedPossiblySent === 1 && /may already have been sent/.test(a.message)); }
  // ---------------------------------------------------------------- D7
  { const b = await W.D7(R10), a = await W.D7(CUR); console.log('D7', JSON.stringify({ R10: b, current: a }));
    check('D7 R10 reproduces: an aura_q4 key without its record-id part is trusted: deleted and decided', b.outcome.removed === 1 && b.markers === 1 && b.sourceLeft === null);
    check('D7 CORRECTED: incomplete identity -> preserved, no decision, reported unidentified', a.outcome.removed === 0 && a.outcome.unidentified === 1 && a.markers === 0 && a.sourceLeft === '{bad'); }
  // ---------------------------------------------------------------- P3
  { const b = await W.P3(R10), a = await W.P3(CUR); console.log('P3', JSON.stringify({ R10: b, current: a }));
    check('P3 R10 reproduces: a committed transaction whose acknowledgement fails is reported failed (as a rollback) although its decision exists', b.out.failed === 1 && b.markers === 1);
    check('P3 CORRECTED: the outcome is verified: the decision exists -> cleanup pending (never "failed"), no cleanup attempted, request refused, 0 rows', a.out.failed === 0 && a.out.cleanupPending === 1 && a.markers === 1 && a.sourcePreserved && a.submit === 'not-stored' && a.rows === 0); }

  // ================================================================ X: the R11 cross-format matrix (current code)
  // X1 identity classification per format: valid / damaged / incomplete / contradictory
  {
    await fresh();
    const s = await tab(CUR);
    const { clientRequestId: _x, ...noId } = item('x');
    storage.setItem(`offline_habit_queue_v2:${A}`, JSON.stringify([damaged('v2-dmg'), noId, { ...item('v2-bad'), clientRequestId: 5 }, item('v2-b', B)]));
    storage.setItem(`aura_q3:${A}:q3-ok`, JSON.stringify(damaged('q3-ok')));
    storage.setItem(`aura_q3:${A}:q3-k`, JSON.stringify(item('q3-v')));
    storage.setItem(`aura_q4:${A}:q4-ok:r1`, '{unreadable');
    storage.setItem(`aura_q4:${A}:q4-b:r2`, JSON.stringify(item('q4-b', B)));
    await put(s, { recordId: 'idb-dmg', ownerUserId: A, clientRequestId: 'idb-dmg', item: damaged('idb-dmg'), fmt: 'r8', queuedAt: 1 });
    await put(s, { recordId: 'idb-noouter', ownerUserId: A, item: damaged('idb-noouter'), fmt: 'r8', queuedAt: 2 });
    await put(s, { recordId: 'idb-split', ownerUserId: A, clientRequestId: 'idb-o', item: item('idb-n'), fmt: 'r8', queuedAt: 3 });
    await put(s, { recordId: 'idb-none', ownerUserId: A, item: { activityTitle: 'no id' }, fmt: 'r8', queuedAt: 4 });
    const snap = await snapshot(s);
    const so = await signout(s);
    const s2 = await tab(CUR);
    const identified = ['v2-dmg', 'q3-ok', 'q4-ok', 'idb-dmg', 'idb-noouter'];
    const blocked = ['v2-b', 'q3-k', 'q3-v', 'q4-b', 'idb-o', 'idb-n'];
    const subs = await Promise.all([...identified, ...blocked].map((c) => submit(s2, c)));
    check('X1 5 identifiable (damaged v2, aura_q3, unreadable aura_q4 with a complete key, damaged IndexedDB, IndexedDB without outer id) -> discarded with decisions; 7 incomplete/contradictory (v2 no id, v2 malformed id, v2 naming B, q3 key/value disagreement, q4 naming B, IndexedDB outer/nested disagreement, IndexedDB no id) -> preserved, reported unidentified', snap.paused === 12 && so.owned.removed + so.owned.cleanupPending === 5 && so.owned.unidentified === 7 && JSON.stringify((await markers()).map((m) => m[1]).sort()) === JSON.stringify([...identified].sort()));
    check('X1 every identified and every blocked candidate id is refused afterwards; 0 rows; contradictory copies retained', subs.every((r: any) => r.kind === 'not-stored') && rows(A) === 0 && (await queueDump()).records.length === 2 && storage.data.has(`aura_q3:${A}:q3-k`) && storage.data.has(`aura_q4:${A}:q4-b:r2`));
  }
  // X2 direct submission vs replay: same gate for every blocking cause
  {
    let mismatched = 0;
    for (const cause of ['retired-copy', 'damaged-copy', 'contradiction', 'decision'] as const) {
      await fresh();
      const s = await tab(CUR);
      await s.q.enqueueOwned(item('gate'));
      if (cause === 'retired-copy') storage.setItem(`aura_q3:${A}:gate`, JSON.stringify(item('gate')));
      if (cause === 'damaged-copy') await put(s, { recordId: 'gate-dmg', ownerUserId: A, clientRequestId: 'gate', item: damaged('gate'), fmt: 'r8', queuedAt: 5 });
      if (cause === 'contradiction') await put(s, { recordId: 'gate-c', ownerUserId: A, clientRequestId: 'other', item: item('gate'), fmt: 'r8', queuedAt: 5 });
      if (cause === 'decision') { const db: IDBDatabase = await s.q.__openQueueDbForTests(); const t = db.transaction('tombstones', 'readwrite'); t.objectStore('tombstones').put({ recordId: s.q.decisionKey(A, 'gate'), ownerUserId: A, clientRequestId: 'gate', payload: null, decision: 'discarded', at: 1, fmt: 'r8' }); await new Promise<void>((ok) => { t.oncomplete = () => ok(); }); }
      const good = (await queueDump()).records.find((r: any) => r.recordId !== 'gate-dmg' && r.recordId !== 'gate-c');
      const claim = await s.q.claimForDispatch(good.recordId, 'x');
      const direct = await submit(s, 'gate');
      const rp = await replay(s);
      if (claim.status === 'claimed' || direct.kind === 'confirmed' || rp.attempted !== 0 || rows(A) !== 0) mismatched++;
    }
    check('X2 for a retired copy, a damaged copy, an identity contradiction and a decision, direct submission, claim and replay all refuse (0 rows)', mismatched === 0);
  }
  // X3 sign-out vs an in-flight submission in another tab, and no new transmission after confirmation.
  // Sign-out's transition aborts the other tab's request on the CLIENT; whether the server saw it is unknown to the
  // client, so the activity must be reported as possibly sent -- never as cancelled -- in both server outcomes.
  for (const phase of ['before', 'after'] as const) {
    await fresh();
    const t1 = await tab(CUR);
    const t2 = CUR.tab('t2'); await t2.acct.fetchVerifiedSession(dev.fetch as any);
    const gate = dev.hold('POST', '/api/habit-logs', phase); // 'before': not yet processed; 'after': saved, answer withheld
    const inflight = submit(t2, 'inflight').catch((e: any) => ({ kind: `refused:${e?.reason}` }));
    await gate.arrived; // the request has been handed to the network before sign-out
    let during: any = null;
    const refused = (e: any) => ({ kind: `refused:${e?.reason ?? e?.name ?? 'error'}` }); // the boundary refuses (AccountUnavailableError)
    const so = await signout(t1, { onConfirm: () => { during = submit(t2, 'during-signout').catch(refused); } });
    gate.release();
    await inflight;
    const duringResult = await during;
    const after = await submit(t2, 'after-signout').catch(refused);
    const o = so.owned;
    console.log(`X3 ${phase}`, JSON.stringify({ during: duringResult.kind, after: after.kind, owned: o, serverRow: rows(A, 'inflight') }));
    check(`X3 (${phase === 'before' ? 'server never processed it' : 'server saved it, answer lost'}) the request handed to the network before sign-out is reported as possibly sent (or still being sent) -- never as not sent or cancelled; server rows ${phase === 'before' ? 0 : 1}`, ((o.removed === 1 && o.removedPossiblySent === 1) || o.keptInFlight === 1) && /may already have been sent|still being sent/.test(so.message) && rows(A, 'inflight') === (phase === 'before' ? 0 : 1));
    check(`X3 (${phase}) no NEW transmission begins once sign-out is confirmed: submissions during and after sign-out are refused and create no server row`, duringResult.kind.startsWith('refused') && after.kind.startsWith('refused') && rows(A, 'during-signout') === 0 && rows(A, 'after-signout') === 0);
  }
  // X4 replacement identity after confirmation (localStorage and IndexedDB)
  {
    await fresh();
    const s = await tab(CUR);
    storage.setItem(`aura_q3:${A}:conf-1`, JSON.stringify(item('conf-1')));
    await put(s, { recordId: 'slot', ownerUserId: A, clientRequestId: 'conf-2', item: damaged('conf-2'), fmt: 'r8', queuedAt: 1 });
    const so = await signout(s, { onConfirm: () => { storage.setItem(`aura_q3:${A}:new-1`, JSON.stringify(item('new-1'))); void put(s, { recordId: 'slot', ownerUserId: A, clientRequestId: 'new-2', item: damaged('new-2'), fmt: 'r8', queuedAt: 1 }); } });
    const m = (await markers()).map((x) => x[1]).sort().join();
    check('X4 identities introduced after the confirmation (a new retired entry; a replaced IndexedDB value) are not decided or deleted; the confirmed ones are', m === 'conf-1,conf-2' && storage.data.has(`aura_q3:${A}:new-1`) && (await queueDump()).records.map((r: any) => r.item.clientRequestId).join() === 'new-2' && so.owned.removed === 2);
  }
  // X5 failed (verified rollback) vs uncertain transactions
  {
    await fresh();
    const s = await tab(CUR);
    storage.setItem(`aura_q3:${A}:f-1`, JSON.stringify(damaged('f-1')));
    const so = await signout(s, { onConfirm: () => { idbFault.write = true; } });
    idbFault.write = false;
    check('X5 a rolled-back transaction (verified: no decision) is reported "couldn\'t be discarded", entry preserved, still refused, 0 rows', so.owned.failed === 1 && so.owned.uncertain === 0 && (await markers()).length === 0 && lsKeys(`aura_q3:${A}:`).length === 1 && (await submit(await tab(CUR), 'f-1')).kind === 'not-stored' && rows(A) === 0);
    await fresh();
    const s3 = await tab(CUR);
    storage.setItem(`aura_q3:${A}:u-1`, JSON.stringify(damaged('u-1')));
    const sn = await snapshot(s3);
    const original = fidb.IDBDatabase.prototype.transaction;
    let n = 0;
    fidb.IDBDatabase.prototype.transaction = function (...args: any[]) { if (++n >= 1) throw new Error('database closing (synthetic)'); return original.apply(this, args); };
    let d: any;
    try { d = await s3.q.discardOwned(A, sn, { tab: 't' }); } finally { fidb.IDBDatabase.prototype.transaction = original; }
    check('X5 when neither the transaction nor a verification read can be completed, the outcome is UNCERTAIN (never "rolled back"); nothing is cleaned up', d.uncertain === 1 && d.failed === 0 && lsKeys(`aura_q3:${A}:`).length === 1);
  }
  // X6 interrupted cleanup and cleanup retries keep the prior-send fact
  {
    await fresh();
    const s = await tab(CUR);
    dev.fault('POST', '/api/habit-logs', 'network-after');
    await submit(s, 'retry-sent');
    storage.setItem(`aura_q3:${A}:retry-sent`, JSON.stringify(item('retry-sent')));
    storage.setItem(`offline_habit_queue_v2:${A}`, JSON.stringify([item('retry-sent')]));
    const outs: any[] = [];
    for (const fail of [true, true, false]) { storage.fail.remove = fail; outs.push((await signout(await tab(CUR))).owned); }
    storage.fail.remove = false;
    check('X6 across two failed cleanups and a successful retry the one logical activity is cleanup-pending+possibly-sent, cleanup-pending+possibly-sent, then removed+possibly-sent; one server row', outs[0].cleanupPending === 1 && outs[0].cleanupPendingPossiblySent === 1 && outs[1].cleanupPending === 1 && outs[1].cleanupPendingPossiblySent === 1 && outs[2].removed === 1 && outs[2].removedPossiblySent === 1 && rows(A, 'retry-sent') === 1);
  }
  // X7 mixed logical outcomes in one sign-out (each activity exactly once)
  {
    await fresh();
    const t1 = await tab(CUR);
    const t2 = CUR.tab('t2'); await t2.acct.fetchVerifiedSession(dev.fetch as any);
    await t1.q.enqueueOwned(item('m-removed'));
    storage.setItem(`offline_habit_queue_v2:${A}`, JSON.stringify([item('m-pending')]));
    storage.setItem(`aura_q3:${A}:m-unident`, JSON.stringify(item('m-unident', B)));
    await t2.q.enqueueOwned(item('m-flight'));
    const rec = (await queueDump()).records.find((r: any) => r.clientRequestId === 'm-flight');
    const held = await t2.q.claimForDispatch(rec.recordId, 't2');
    storage.fail.remove = true;
    const so = await signout(t1);
    storage.fail.remove = false;
    const o = so.owned;
    check('X7 four activities, four outcomes: removed 1, cleanup-pending 1, kept in flight 1, unidentified 1 (sum = asked 4)', /You have 4 activity logs/.test(so.asked) && o.removed === 1 && o.cleanupPending === 1 && o.keptInFlight === 1 && o.unidentified === 1 && o.failed === 0 && o.uncertain === 0);
    if (held.status === 'claimed') await t2.q.releaseClaim(held.claim);
  }
  // X8 cross-account isolation of every operation
  {
    await fresh();
    for (const o of [A, B]) { storage.setItem(`aura_q3:${o}:iso`, JSON.stringify(damaged('iso', o))); storage.setItem(`offline_habit_queue_v2:${o}`, JSON.stringify([item('iso-v2', o)])); }
    const sB = await tab(CUR, B);
    await sB.q.enqueueOwned(item('iso-idb', B));
    const sA = await tab(CUR, A);
    await signout(sA);
    const vB = await (await tab(CUR, B)).q.readOfflineQueueView(B);
    check('X8 A\'s discard decides and deletes only A\'s copies; B\'s retired and IndexedDB copies are untouched and counted for B only', (await markers()).every((m) => m[0] === A) && lsKeys(`aura_q3:${B}:`).length === 1 && storage.data.has(`offline_habit_queue_v2:${B}`) && (await queueDump()).records.length === 1 && vB?.paused === 2 && vB?.items.length === 1);
  }
  // X9 healthy online submission and offline replay
  {
    await fresh();
    const s = await tab(CUR);
    const on = await submit(s, 'ok-on');
    dev.fault('POST', '/api/habit-logs', 'network-before');
    const off = await submit(s, 'ok-off');
    const rp = await replay(s);
    check('X9 healthy online submission confirmed once; offline submission queued then replayed once', on.kind === 'confirmed' && off.kind === 'queued' && rp.confirmed === 1 && rows(A, 'ok-on') === 1 && rows(A, 'ok-off') === 1);
  }
  finish();
}

main().catch((e) => { console.error(e); process.exit(1); });
