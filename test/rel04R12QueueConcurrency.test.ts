/**
 * AURA-ANDROID-REL-04 (R12, ticket 39248) -- queue concurrency correction for independent verification 39247
 * (R11 handover d150327, implementation abdd9d8; disposition OPEN: N1-N6).
 *
 * The reviewer's probe (review-r11-independent.ts) and logs are preserved byte-for-byte in
 * docs/android/evidence/rel04-r11-independent-39247/ (SHA256SUMS). Each N-witness is re-run here against the R11
 * code head abdd9d8 (vendored in test/fixtures/rel04-r11-head, checked against git) and the current code, with
 * the injection placed at the same LOGICAL boundary whichever storage read the implementation uses. Then one
 * deterministic test per asynchronous boundary of the concurrency model (B1-B6), asserting the exact transmitted
 * payloads, server rows, claim identity, decisions, retained copies and outcomes.
 *
 *   TS_NODE_COMPILER_OPTIONS='{"jsx":"react-jsx"}' npx ts-node --project tsconfig.jsdom-tests.json test/rel04R12QueueConcurrency.test.ts
 */
import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { Device, WEB, addUser, check, clearQueueDb, closeAllTabs, finish, idbFault, logsOf, openTab, payload, queueDump, resetStore, storage } from './rel04AccountIsolationHarness';

const ts = require(require.resolve('typescript', { paths: [WEB] }));
const Module = require('module');
const crypto = require('crypto');
const fidb = require(require.resolve('fake-indexeddb', { paths: [WEB] }));
const FIX = path.join(__dirname, 'fixtures');
const fx = (n: string) => fs.readFileSync(path.join(FIX, 'rel04-r11-head', n), 'utf8');
const gitHas = (c: string) => { try { execFileSync('git', ['cat-file', '-e', `${c}^{commit}`], { stdio: 'ignore' }); return true; } catch { return false; } };

(function provenance() {
  for (const f of ['offlineHabitQueue', 'activitySync', 'signOut']) {
    if (!gitHas('abdd9d8')) { console.log('SKIP fixture re-check: abdd9d8 not in this checkout'); break; }
    check(`fixture rel04-r11-head/${f}.ts.txt == abdd9d8 apps/web/lib/${f}.ts`, execFileSync('git', ['show', `abdd9d8:apps/web/lib/${f}.ts`], { encoding: 'utf8', maxBuffer: 1 << 26 }) === fx(`${f}.ts.txt`));
  }
  const W = path.join(__dirname, '..', 'docs', 'android', 'evidence', 'rel04-r11-independent-39247');
  const ren: Record<string, string> = { 'review-r11-independent.ts': 'review-r11-independent.ts.txt', 'verify-integrity.py': 'verify-integrity.py.txt' };
  const sums = fs.readFileSync(path.join(W, 'SHA256SUMS'), 'utf8').trim().split('\n').map((l) => l.split(/\s+/)).map(([h, f]) => [h, ren[f] ?? f]);
  check(`the 39247 reviewer evidence is preserved byte-for-byte (${sums.length} SHA256SUMS entries; probe/script stored as .txt)`, sums.length === 27 && sums.every(([h, f]) => fs.existsSync(path.join(W, f)) && crypto.createHash('sha256').update(fs.readFileSync(path.join(W, f))).digest('hex') === h));
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

const A = 'r12-account-a';
const B = 'r12-account-b';
addUser(A, 'r12-a@example.invalid');
addUser(B, 'r12-b@example.invalid');
const route = '/api/habit-logs';
const body = (id: string, title = 'reviewed activity') => payload(title, id);
const item = (id: string, owner = A, title?: string) => ({ ...body(id, title), ownerUserId: owner, tempId: 'tmp' });
const row = (recordId: string, id: string, owner = A, title?: string) => ({ recordId, ownerUserId: owner, clientRequestId: id, item: item(id, owner, title), fmt: 'r8', queuedAt: 1 });
const rows = (owner: string, crid?: string) => logsOf(owner).filter((l: any) => crid === undefined || l.clientRequestId === crid);
const lsKeys = (prefix: string) => [...storage.data.keys()].filter((k) => k.startsWith(prefix));

async function fresh() {
  resetStore(); storage.clear(); storage.fail = { get: false, set: false, remove: false };
  idbFault.open = false; idbFault.read = false; idbFault.write = false;
  closeAllTabs();
  await clearQueueDb();
}
type Stack = { q: any; sync: any; acct: any; so: any };
type Impl = { name: 'R11' | 'current'; tab: (id: string) => Stack };
const R11: Impl = {
  name: 'R11',
  tab: (id) => {
    const t = openTab(id);
    const q = compile(fx('offlineHabitQueue.ts.txt'), lib(`offlineHabitQueue.r11.${id}.${seq++}.js`));
    const sync = compile(fx('activitySync.ts.txt'), lib(`activitySync.r11.${id}.${seq++}.js`), { './offlineHabitQueue': q });
    const so = compile(fx('signOut.ts.txt'), lib(`signOut.r11.${id}.${seq++}.js`), { './offlineHabitQueue': q });
    return { q, sync, acct: t.acct, so };
  },
};
const CUR: Impl = { name: 'current', tab: (id) => { const t = openTab(id); return { q: t.q, sync: t.sync, acct: t.acct, so: t.so }; } };
const dev = new Device();
let n = 0;
async function tab(impl: Impl, owner = A) { dev.signIn(owner); const s = impl.tab(`${impl.name}-${owner}-${n++}`); await s.acct.fetchVerifiedSession(dev.fetch as any); return s; }
/** A fetch that records every POST body actually transmitted. */
function recorder() { const posts: any[] = []; const f = (async (u: unknown, i: any) => { if (String(u) === route && i?.method === 'POST') posts.push(JSON.parse(i.body)); return dev.fetch(u as any, i); }) as any; return { posts, f }; }
async function put(s: Stack, r: any) {
  const db: IDBDatabase = await s.q.__openQueueDbForTests();
  const t = db.transaction('records', 'readwrite'); t.objectStore('records').put(r);
  await new Promise<void>((ok, err) => { t.oncomplete = () => ok(); t.onabort = () => err(t.error); });
}
const decisions = async () => (await queueDump()).tombstones.filter((t: any) => t.fmt === 'r8').map((d: any) => `${d.ownerUserId === A ? 'A' : 'B'}:${d.clientRequestId}:${d.decision}`);
const remaining = async () => (await queueDump()).records.map((r: any) => `${r.recordId}:${r.clientRequestId ?? '-'}:${r.item?.ownerUserId === A ? 'A' : r.item?.ownerUserId === B ? 'B' : '?'}`).sort();
async function signout(s: Stack, beforeAck?: () => Promise<unknown> | void) {
  let asked = '';
  const out = await s.so.performSignOut({ confirm: (m: string) => { asked = m; return true; }, fetch: (async (u: unknown, i: any) => { if (String(u) === '/api/auth/logout') await beforeAck?.(); return dev.fetch(u as any, i); }) as any });
  return { owned: out.owned, asked, message: s.so.signOutOutcomeMessage(out) ?? '' };
}
/** Barrier at replay's snapshot read -> claim: fires on the FIRST read-only records read, whichever API is used. */
function afterSnapshotRead(effect: (db: IDBDatabase) => void) {
  const oi = fidb.IDBIndex.prototype.getAll, os = fidb.IDBObjectStore.prototype.getAll;
  const restore = () => { fidb.IDBIndex.prototype.getAll = oi; fidb.IDBObjectStore.prototype.getAll = os; };
  const fire = (req: any, db: IDBDatabase) => { restore(); req.addEventListener('success', () => effect(db)); };
  fidb.IDBIndex.prototype.getAll = function (...a: any[]) { const r = oi.apply(this, a); if (this.name === 'owner' && this.objectStore.transaction.mode === 'readonly') fire(r, this.objectStore.transaction.db); return r; };
  fidb.IDBObjectStore.prototype.getAll = function (...a: any[]) { const r = os.apply(this, a); if (this.name === 'records' && this.transaction.mode === 'readonly') fire(r, this.transaction.db); return r; };
  return restore;
}
/** Barrier inside the claim transaction (its first decision read): the reviewer's N2 injection point. */
// R18: the claim transaction's first decision read is get() (R12-R17) or getAll() (R18: one account-wide discovery).
function insideClaim(effect: () => void) {
  const o = fidb.IDBObjectStore.prototype.get, oa = fidb.IDBObjectStore.prototype.getAll;
  const restore = () => { fidb.IDBObjectStore.prototype.get = o; fidb.IDBObjectStore.prototype.getAll = oa; };
  const hook = (orig: any) => function (this: any, ...a: any[]) { const r = orig.apply(this, a); if (this.name === 'tombstones' && this.transaction.mode === 'readwrite') { restore(); r.addEventListener('success', effect); } return r; };
  fidb.IDBObjectStore.prototype.get = hook(o); fidb.IDBObjectStore.prototype.getAll = hook(oa);
  return restore;
}

async function n1(impl: Impl, newOwner: string) {
  await fresh();
  const s = await tab(impl);
  await put(s, row('reused-record', 'old-request'));
  const rec = recorder();
  const restore = afterSnapshotRead((db) => { db.transaction('records', 'readwrite').objectStore('records').put(row('reused-record', 'replacement', newOwner)); });
  const r = await s.sync.replayOfflineQueue(rec.f).finally(restore);
  return { attempted: r.attempted, posted: rec.posts.map((p) => p.clientRequestId), decisions: await decisions(), remaining: await remaining() };
}
async function n2(impl: Impl, mode: 'direct' | 'replay') {
  await fresh();
  const s = await tab(impl);
  if (mode === 'replay') await put(s, row('before-local-conflict', 'late-retired'));
  const key = `aura_q3:${A}:late-retired`;
  const restore = insideClaim(() => storage.setItem(key, JSON.stringify(item('late-retired', B))));
  const rec = recorder();
  const r = await (mode === 'direct' ? s.sync.submitActivityLog(body('late-retired'), 'tmp', rec.f) : s.sync.replayOfflineQueue(rec.f)).finally(restore);
  return { posts: rec.posts.length, rows: rows(A).length + rows(B).length, kind: (r as any).kind ?? `attempted:${(r as any).attempted}`, retiredKept: storage.data.has(key) };
}
async function n3(impl: Impl) {
  await fresh();
  const s = await tab(impl);
  const gate = dev.hold('POST', route, 'after');
  const req = s.sync.submitActivityLog(body('settlement-original'), 'tmp', dev.fetch as any);
  await gate.arrived;
  const r0 = (await queueDump()).records[0];
  await put(s, { ...r0, item: { ...r0.item, ownerUserId: B } });
  gate.release();
  const r = await req;
  return { kind: r.kind, rowsA: rows(A).length, contradictoryKept: (await queueDump()).records.length === 1 };
}
async function n4(impl: Impl, type: 'readable-nested-id' | 'missing-record-id-after-colon' | 'outer-owner-absent') {
  await fresh();
  const s = await tab(impl);
  const id = 'incomplete-member';
  const key = `aura_q4:${A}:${id}${type === 'missing-record-id-after-colon' ? ':' : ''}`;
  if (type === 'outer-owner-absent') { const { ownerUserId: _x, ...noOwner } = row('unowned-outer', id); await put(s, noOwner); }
  else storage.setItem(key, type === 'readable-nested-id' ? JSON.stringify(item(id)) : '{bad');
  const so = await signout(s);
  const sub = await (await tab(impl)).sync.submitActivityLog(body(id), 'tmp', dev.fetch as any);
  return { removed: so.owned.removed, unidentified: so.owned.unidentified, decisions: (await decisions()).length, rawKept: type === 'outer-owner-absent' ? (await queueDump()).records.length === 1 : storage.data.has(key), submit: sub.kind, rows: rows(A, id).length };
}
async function n5(impl: Impl, added: 'new-key-same-id' | 'contradiction-same-record') {
  await fresh();
  const s = await tab(impl);
  await put(s, row('confirmed-copy', 'confirmed'));
  const so = await signout(s, async () => {
    await put(s, row('second-copy', 'confirmed'));
    if (added === 'new-key-same-id') storage.setItem(`aura_q3:${A}:confirmed`, JSON.stringify(item('confirmed')));
    else await put(s, { ...row('confirmed-copy', 'confirmed'), item: item('confirmed', B) });
  });
  return { owned: so.owned, decisions: await decisions(), remaining: await remaining(), retiredKept: storage.data.has(`aura_q3:${A}:confirmed`) };
}
async function n6(impl: Impl, failRead: boolean) {
  await fresh();
  const s = await tab(impl);
  await put(s, row('idb-only-ack', 'idb-only'));
  const snap = await s.q.readOwnedQueue(A);
  const o = fidb.IDBDatabase.prototype.transaction;
  fidb.IDBDatabase.prototype.transaction = function (...a: any[]) { const t = o.apply(this, a); if (t.mode === 'readwrite') { fidb.IDBDatabase.prototype.transaction = o; t.addEventListener('complete', () => { if (failRead) idbFault.read = true; t.onerror?.(new Event('error')); }); } return t; };
  const out = await s.q.discardOwned(A, snap, { tab: 't' }).finally(() => { fidb.IDBDatabase.prototype.transaction = o; idbFault.read = false; });
  return { out, records: (await queueDump()).records.length };
}

async function main() {
  // ================================================================ N1
  for (const owner of [A, B]) {
    const b = await n1(R11, owner), a = await n1(CUR, owner);
    console.log(`N1 ${owner === A ? 'same-account' : 'cross-account'}`, JSON.stringify({ R11: b, current: a }));
    check(`N1 R11 reproduces (${owner === A ? 'A/new' : 'B/new'} replacement after replay's read): a claim is taken for the replacement while the stale original is posted`, b.attempted === 1 && b.posted.join() === 'old-request');
    check(`N1 CORRECTED (${owner === A ? 'same-account' : 'cross-account'}): the stale claim is refused ('changed'); nothing is posted; the replacement is neither claimed, settled nor deleted`, a.attempted === 0 && a.posted.length === 0 && a.decisions.length === 0 && a.remaining.join() === `reused-record:replacement:${owner === A ? 'A' : 'B'}`);
  }
  // ================================================================ N2
  for (const mode of ['direct', 'replay'] as const) {
    const b = await n2(R11, mode), a = await n2(CUR, mode);
    console.log(`N2 ${mode}`, JSON.stringify({ R11: b, current: a }));
    check(`N2 R11 reproduces (${mode}): a retired contradiction written inside the claim transaction is missed: 1 POST, 1 row`, b.posts === 1 && b.rows === 1);
    check(`N2 CORRECTED (${mode}): the claim's linearization-point inspection sees it: 0 POSTs, 0 rows, the retired copy preserved`, a.posts === 0 && a.rows === 0 && a.retiredKept);
  }
  // ================================================================ N3
  { const b = await n3(R11), a = await n3(CUR); console.log('N3', JSON.stringify({ R11: b, current: a }));
    check('N3 R11 reproduces: a successful response settles (deletes) a copy that became contradictory while the response was held', b.kind === 'confirmed' && b.contradictoryKept === false);
    check('N3 CORRECTED: settlement is bound to the claim and re-resolves identity: the contradictory copy is preserved; 1 server row', a.kind === 'confirmed' && a.contradictoryKept === true && a.rowsA === 1); }
  // ================================================================ N4
  for (const type of ['readable-nested-id', 'missing-record-id-after-colon', 'outer-owner-absent'] as const) {
    const b = await n4(R11, type), a = await n4(CUR, type);
    console.log(`N4 ${type}`, JSON.stringify({ R11: b, current: a }));
    check(`N4 R11 reproduces (${type})`, type === 'readable-nested-id' ? (b.removed === 1 && b.decisions === 1 && !b.rawKept) : (b.submit === 'confirmed' && b.rows === 1));
    check(`N4 CORRECTED (${type}): incomplete identity -> preserved, no decision, reported unidentified, its candidate refused (0 rows)`, a.removed === 0 && a.unidentified === 1 && a.decisions === 0 && a.rawKept && a.submit === 'not-stored' && a.rows === 0);
  }
  // ================================================================ N5
  for (const added of ['new-key-same-id', 'contradiction-same-record'] as const) {
    const b = await n5(R11, added), a = await n5(CUR, added);
    console.log(`N5 ${added}`, JSON.stringify({ R11: b, current: a }));
    check(`N5 R11 reproduces (${added}): reports removed=1 although a copy survives`, b.owned.removed === 1 && b.owned.cleanupPending === 0);
    check(`N5 CORRECTED (${added}): removal is verified -> cleanup pending (the surviving copy kept)${added === 'contradiction-same-record' ? ' + the new contradictory copy reported unidentified' : ''}; one durable decision`, a.owned.removed === 0 && a.owned.cleanupPending === 1 && a.owned.unidentified === (added === 'contradiction-same-record' ? 1 : 0) && a.decisions.join() === 'A:confirmed:discarded' && (added === 'new-key-same-id' ? a.retiredKept : a.remaining.join() === 'confirmed-copy:confirmed:B'));
  }
  // ================================================================ N6
  { const b = await n6(R11, false), a = await n6(CUR, false), u = await n6(CUR, true); console.log('N6', JSON.stringify({ R11: b, current: a, failRead: u }));
    check('N6 R11 reproduces: a lost acknowledgement for an IndexedDB-only discard reports cleanup pending although no copy remains', b.out.cleanupPending === 1 && b.records === 0);
    check('N6 CORRECTED: verified -> removed (no copy remains); with the reconciliation read failing -> uncertain', a.out.removed === 1 && a.out.cleanupPending === 0 && a.records === 0 && u.out.uncertain === 1 && u.out.failed === 0); }

  // ================================================================ B: one deterministic test per asynchronous boundary (current code)
  // B1 inspection -> claim (direct path): a retired contradiction AND a same-account replacement appear before the claim
  {
    await fresh();
    const s = await tab(CUR);
    await s.q.enqueueOwned(item('b1'));
    const rec = recorder();
    // Direct submission has no separate snapshot read: its claim transaction (gate + claim) is the boundary.
    const r1 = await s.sync.submitActivityLog(body('b1', 'different payload'), 'tmp', rec.f);
    const restore2 = insideClaim(() => storage.setItem(`aura_q4:${A}:b1:r9`, JSON.stringify(item('b1', B))));
    const r2 = await s.sync.submitActivityLog(body('b1'), 'tmp', rec.f).finally(restore2);
    check('B1 inspection->claim: a conflicting payload is refused, and a contradiction arriving during the claim blocks it: 0 POSTs, 0 rows', r1.kind === 'not-stored' && r2.kind === 'not-stored' && rec.posts.length === 0 && rows(A).length === 0);
  }
  // B2 claim -> transmission: changes after the claim commits, before the network call
  {
    await fresh();
    const s = await tab(CUR);
    await put(s, row('b2-rec', 'b2', A, 'claimed title'));
    const o = fidb.IDBDatabase.prototype.transaction;
    let modified = false;
    fidb.IDBDatabase.prototype.transaction = function (...a: any[]) {
      const t = o.apply(this, a);
      if (t.mode === 'readwrite' && !modified) { fidb.IDBDatabase.prototype.transaction = o; t.addEventListener('complete', () => { modified = true; const w = (this as IDBDatabase).transaction('records', 'readwrite'); w.objectStore('records').put(row('b2-rec', 'b2', A, 'edited after claim')); }); }
      return t;
    };
    const rec = recorder();
    const r = await s.sync.replayOfflineQueue(rec.f).finally(() => { fidb.IDBDatabase.prototype.transaction = o; });
    check('B2 claim->transmission: the record modified after the claim committed -> the CLAIMED payload is what is posted (never the later copy); exactly 1 row with the claimed title', modified && r.attempted === 1 && rec.posts.length === 1 && rec.posts[0].activityTitle === 'claimed title' && rows(A).length === 1 && rows(A)[0].activityTitle === 'claimed title');
    check('B2 ... and settlement removes only the claimed identity+payload: the modified copy is preserved (paused as a conflicting payload), decision settled', (await remaining()).join() === 'b2-rec:b2:A' && (await decisions()).join() === 'A:b2:settled');
    await fresh();
    const s2 = await tab(CUR);
    await put(s2, row('b2b-rec', 'b2b'));
    const o2 = fidb.IDBDatabase.prototype.transaction;
    fidb.IDBDatabase.prototype.transaction = function (...a: any[]) { const t = o2.apply(this, a); if (t.mode === 'readwrite') { fidb.IDBDatabase.prototype.transaction = o2; t.addEventListener('complete', () => storage.setItem(`aura_q3:${A}:b2b`, JSON.stringify(item('b2b', B)))); } return t; };
    const rec2 = recorder();
    const rr = await s2.sync.replayOfflineQueue(rec2.f).finally(() => { fidb.IDBDatabase.prototype.transaction = o2; });
    check('B2 claim->transmission: a retired contradiction appearing after the claim, before the send, is caught by the synchronous transmission check: 0 POSTs, claim released', rec2.posts.length === 0 && rr.attempted === 0 && (await queueDump()).claims.length === 0 && rows(A).length === 0);
  }
  // B3 transmission -> response: the copy is replaced by another identity while the response is in flight
  {
    await fresh();
    const s = await tab(CUR);
    const gate = dev.hold('POST', route, 'after');
    const rec = recorder();
    const req = s.sync.submitActivityLog(body('b3'), 'tmp', rec.f);
    await gate.arrived;
    const r0 = (await queueDump()).records[0];
    await put(s, row(r0.recordId, 'b3-replacement'));
    gate.release();
    const r = await req;
    check('B3 transmission->response: a successful response for b3 never deletes the unsent replacement stored at the same record; decision only for b3', r.kind === 'confirmed' && rec.posts.map((p) => p.clientRequestId).join() === 'b3' && (await remaining()).join() === `${r0.recordId}:b3-replacement:A` && (await decisions()).join() === 'A:b3:settled' && rows(A, 'b3-replacement').length === 0);
  }
  // B4 response -> settlement: an equivalent copy and a different-payload copy appear before settlement
  {
    await fresh();
    const s = await tab(CUR);
    const gate = dev.hold('POST', route, 'after');
    const req = s.sync.submitActivityLog(body('b4'), 'tmp', dev.fetch as any);
    await gate.arrived;
    await put(s, row('b4-equivalent', 'b4'));
    await put(s, row('b4-different', 'b4', A, 'other payload'));
    gate.release();
    await req;
    check('B4 response->settlement: equivalent copies of the claimed identity+payload are removed; a different-payload copy is preserved; 1 row', (await remaining()).join() === 'b4-different:b4:A' && rows(A, 'b4').length === 1 && (await decisions()).join() === 'A:b4:settled');
  }
  // B5 decision -> physical cleanup: a new equivalent retired copy appears after the commit, before cleanup
  {
    await fresh();
    const s = await tab(CUR);
    storage.setItem(`aura_q3:${A}:b5`, JSON.stringify(item('b5')));
    const snap = await s.q.readOwnedQueue(A);
    const o = fidb.IDBDatabase.prototype.transaction;
    fidb.IDBDatabase.prototype.transaction = function (...a: any[]) { const t = o.apply(this, a); if (t.mode === 'readwrite') { fidb.IDBDatabase.prototype.transaction = o; t.addEventListener('complete', () => storage.setItem(`offline_habit_queue_v2:${A}`, JSON.stringify([item('b5')]))); } return t; };
    const d = await s.q.discardOwned(A, snap, { tab: 't' }).finally(() => { fidb.IDBDatabase.prototype.transaction = o; });
    const sub = await s.sync.submitActivityLog(body('b5'), 'tmp', dev.fetch as any);
    check('B5 decision->cleanup: the confirmed retired copy is removed, the copy that appeared afterwards is kept and the activity reported cleanup-pending (not removed); refused; 0 rows', d.cleanupPending === 1 && d.removed === 0 && !storage.data.has(`aura_q3:${A}:b5`) && storage.data.has(`offline_habit_queue_v2:${A}`) && sub.kind === 'not-stored' && rows(A).length === 0);
  }
  // B6 cleanup -> outcome reporting: a copy appears after cleanup, before the outcome is computed
  {
    await fresh();
    const s = await tab(CUR);
    storage.setItem(`aura_q3:${A}:b6`, JSON.stringify(item('b6')));
    const snap = await s.q.readOwnedQueue(A);
    const realRemove = storage.removeItem.bind(storage);
    (storage as any).removeItem = (k: string) => { realRemove(k); (storage as any).removeItem = realRemove; storage.setItem(`aura_q4:${A}:b6:late`, JSON.stringify(item('b6'))); };
    const d = await s.q.discardOwned(A, snap, { tab: 't' }).finally(() => { (storage as any).removeItem = realRemove; });
    check('B6 cleanup->reporting: the outcome is computed from what physically remains: a copy written after cleanup keeps it cleanup-pending', d.cleanupPending === 1 && d.removed === 0 && storage.data.has(`aura_q4:${A}:b6:late`));
  }
  // B7 cross-account and healthy controls
  {
    await fresh();
    const sB = await tab(CUR, B);
    await put(sB, row('b-rec', 'shared-id', B));
    const sA = await tab(CUR, A);
    const recA = recorder();
    const a1 = await sA.sync.submitActivityLog(body('shared-id'), 'tmp', recA.f);
    const rpA = await sA.sync.replayOfflineQueue(recA.f);
    check('B7 B\'s record with the same request id never blocks, is never claimed, settled or deleted by A; A\'s own submission is sent once', a1.kind === 'confirmed' && rpA.attempted === 0 && recA.posts.length === 1 && (await remaining()).join() === 'b-rec:shared-id:B' && rows(A, 'shared-id').length === 1 && rows(B).length === 0);
    await fresh();
    const s = await tab(CUR);
    const on = await s.sync.submitActivityLog(body('ok-on'), 'tmp', dev.fetch as any);
    dev.fault('POST', route, 'network-before');
    const off = await s.sync.submitActivityLog(body('ok-off'), 'tmp', dev.fetch as any);
    const rec = recorder();
    const rp = await s.sync.replayOfflineQueue(rec.f);
    check('B7 healthy: online submission confirmed once; offline submission queued then replayed once with its own payload', on.kind === 'confirmed' && off.kind === 'queued' && rp.confirmed === 1 && rec.posts.map((p) => p.clientRequestId).join() === 'ok-off' && rows(A, 'ok-on').length === 1 && rows(A, 'ok-off').length === 1);
  }
  finish();
}

main().catch((e) => { console.error(e); process.exit(1); });
