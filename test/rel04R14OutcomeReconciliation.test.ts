/**
 * AURA-ANDROID-REL-04 (R14, ticket 39253) -- unified outcome reconciliation for independent verification 39252
 * (R13 handover f6a8cbe, implementation a8a9767; NO-GO: F1-F3).
 *
 * The reviewer's evidence (review-r13-independent.ts, logs, CI bundles) is preserved byte-for-byte in
 * docs/android/evidence/rel04-r13-independent-39252/ (SHA256SUMS). Each F-witness runs against the R13 code head
 * a8a9767 (vendored in test/fixtures/rel04-r13-head, checked against git) -- the NEGATIVE CONTROL -- and the current
 * code; then the outcome matrix, the REAL Home "Start now" interaction (with an R13-submission negative control that
 * shows the fresh-id duplicate) and the cleanup matrix. The real-browser cross-tab case is Chromium CH16.
 *
 *   TS_NODE_COMPILER_OPTIONS='{"jsx":"react-jsx"}' npx ts-node --project tsconfig.jsdom-tests.json test/rel04R14OutcomeReconciliation.test.ts
 */
import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { React, mount, flush, act, click } from './jsdomReactHarness';
import { Device, WEB, addUser, check, clearQueueDb, closeAllTabs, finish, idbFault, logsOf, openTab, payload, queueDump, resetStore, storage, store } from './rel04AccountIsolationHarness';

const ts = require(require.resolve('typescript', { paths: [WEB] }));
const Module = require('module');
const crypto = require('crypto');
const fidb = require(require.resolve('fake-indexeddb', { paths: [WEB] }));
const fx = (n: string) => fs.readFileSync(path.join(__dirname, 'fixtures', 'rel04-r13-head', n), 'utf8');
const gitHas = (c: string) => { try { execFileSync('git', ['cat-file', '-e', `${c}^{commit}`], { stdio: 'ignore' }); return true; } catch { return false; } };

(function provenance() {
  for (const f of ['offlineHabitQueue', 'activitySync', 'signOut']) {
    if (!gitHas('a8a9767')) { console.log('SKIP fixture re-check: a8a9767 not in this checkout'); break; }
    check(`fixture rel04-r13-head/${f}.ts.txt == a8a9767 apps/web/lib/${f}.ts`, execFileSync('git', ['show', `a8a9767:apps/web/lib/${f}.ts`], { encoding: 'utf8', maxBuffer: 1 << 26 }) === fx(`${f}.ts.txt`));
  }
  const W = path.join(__dirname, '..', 'docs', 'android', 'evidence', 'rel04-r13-independent-39252');
  const ren: Record<string, string> = { 'review-r12-independent.ts': 'review-r12-independent.ts.txt', 'review-r13-independent.ts': 'review-r13-independent.ts.txt', 'verify-integrity.py': 'verify-integrity.py.txt' };
  const sums = fs.readFileSync(path.join(W, 'SHA256SUMS'), 'utf8').trim().split('\n').map((l) => l.split(/\s+/)).map(([h, f]) => { const k = f.replace(/^\.\//, ''); return [h, ren[k] ?? k]; });
  check(`the 39252 reviewer evidence is preserved byte-for-byte (${sums.length} SHA256SUMS entries; scripts stored as .txt)`, sums.length > 40 && sums.every(([h, f]) => fs.existsSync(path.join(W, f)) && crypto.createHash('sha256').update(fs.readFileSync(path.join(W, f))).digest('hex') === h));
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
const A = 'r14-account-a', B = 'r14-account-b';
addUser(A, 'r14a@example.invalid'); addUser(B, 'r14b@example.invalid');
const route = '/api/habit-logs';
const body = (id: string, title = 'reviewed activity') => payload(title, id);
const item = (id: string, owner = A, title?: string) => ({ ...body(id, title), ownerUserId: owner, tempId: 'tmp' });
const row = (recordId: string, id: string, owner = A, title?: string) => ({ recordId, ownerUserId: owner, clientRequestId: id, item: item(id, owner, title), fmt: 'r8', queuedAt: 1 });
const rows = (owner: string, crid?: string) => logsOf(owner).filter((l: any) => crid === undefined || l.clientRequestId === crid);
const realNow = Date.now;
const afterClaimExpiry = () => { const t0 = realNow(); Date.now = () => t0 + 61_000; };
async function fresh() { Date.now = realNow; resetStore(); storage.clear(); storage.fail = { get: false, set: false, remove: false }; idbFault.open = false; idbFault.read = false; idbFault.write = false; closeAllTabs(); await clearQueueDb(); }
type Stack = { q: any; sync: any; acct: any; so: any };
type Impl = { name: 'R13' | 'current'; tab: (id: string) => Stack };
const R13: Impl = { name: 'R13', tab: (id) => { const t = openTab(id); const q = compile(fx('offlineHabitQueue.ts.txt'), lib(`offlineHabitQueue.r13.${id}.${seq++}.js`)); const sync = compile(fx('activitySync.ts.txt'), lib(`activitySync.r13.${id}.${seq++}.js`), { './offlineHabitQueue': q }); const so = compile(fx('signOut.ts.txt'), lib(`signOut.r13.${id}.${seq++}.js`), { './offlineHabitQueue': q }); return { q, sync, acct: t.acct, so }; } };
const CUR: Impl = { name: 'current', tab: (id) => { const t = openTab(id); return { q: t.q, sync: t.sync, acct: t.acct, so: t.so }; } };
const dev = new Device();
dev.extra['/api/plans'] = () => [];
dev.extra['/api/habits'] = () => [];
let n = 0;
async function tab(impl: Impl, owner = A) { dev.signIn(owner); const s = impl.tab(`${impl.name}-${owner}-${n++}`); await s.acct.fetchVerifiedSession(dev.fetch as any); return s; }
async function put(s: Stack, r: any) { const db: IDBDatabase = await s.q.__openQueueDbForTests(); const t = db.transaction('records', 'readwrite'); t.objectStore('records').put(r); await new Promise<void>((ok, err) => { t.oncomplete = () => ok(); t.onabort = () => err(t.error); }); }
async function putDecision(s: Stack, owner: string, crid: string, decision: 'settled' | 'discarded', extra: Record<string, unknown> = {}) { const db: IDBDatabase = await s.q.__openQueueDbForTests(); const t = db.transaction('tombstones', 'readwrite'); t.objectStore('tombstones').put({ recordId: s.q.decisionKey(owner, crid), ownerUserId: owner, clientRequestId: crid, payload: null, decision, at: 1, fmt: 'r8', ...extra }); await new Promise<void>((ok) => { t.oncomplete = () => ok(); }); }
const decisions = async () => (await queueDump()).tombstones.filter((t: any) => t.fmt === 'r8').map((d: any) => `${d.ownerUserId === A ? 'A' : 'B'}:${d.clientRequestId}:${d.decision}${d.serverOutcome ? ':' + d.serverOutcome : ''}`);
/** The next read-write transaction commits, but its acknowledgement is withheld until release(), then delivered as an error. */
function withholdNextAck(opts: { failReconciliationRead?: boolean } = {}) {
  const o = fidb.IDBDatabase.prototype.transaction;
  let release!: () => void;
  const reached = new Promise<void>((resolve) => {
    fidb.IDBDatabase.prototype.transaction = function (...a: any[]) {
      const t = o.apply(this, a);
      if (t.mode === 'readwrite') { fidb.IDBDatabase.prototype.transaction = o; t.addEventListener('complete', () => { const onerror = t.onerror; t.oncomplete = null; release = () => { if (opts.failReconciliationRead) idbFault.read = true; onerror?.call(t, new Event('error')); }; resolve(); }); }
      return t;
    };
  });
  return { reached, release: () => release(), restore: () => { fidb.IDBDatabase.prototype.transaction = o; } };
}

async function f1(impl: Impl, schedule: 'settle-before-ack' | 'no-settle') {
  await fresh();
  const sender = await tab(impl), other = await tab(impl);
  const h = withholdNextAck();
  const p = sender.sync.submitActivityLog(body('ack-id'), 'tmp', dev.fetch as any);
  await h.reached;
  afterClaimExpiry();
  if (schedule === 'settle-before-ack') await other.sync.replayOfflineQueue(dev.fetch as any);
  h.release();
  const first = await p.finally(h.restore);
  // The supported recovery workflow: the same id (pending row), or -- only when the outcome invites it -- a fresh id.
  const same = await other.sync.submitActivityLog(body('ack-id'), 'tmp', dev.fetch as any);
  const invitesFreshRetry = first.kind === 'storage-unavailable' || (first.kind === 'not-stored' && first.reason !== 'discarded');
  if (invitesFreshRetry) await other.sync.submitActivityLog(body('ui-retry-new-id'), 'tmp', dev.fetch as any);
  Date.now = realNow;
  return { first: first.kind, same: same.kind, invitesFreshRetry, rowsA: rows(A).length, rowsOriginal: rows(A, 'ack-id').length, decisions: await decisions() };
}

async function main() {
  // ================================================================ F1: R13 (negative control: ignores the durable settlement) vs current
  {
    const b = await f1(R13, 'settle-before-ack'), a = await f1(CUR, 'settle-before-ack');
    console.log('F1', JSON.stringify({ R13: b, current: a }));
    check('F1 R13 (negative control) reproduces: commit + lost acknowledgement + another tab settles -> storage-unavailable; the invited fresh-id retry creates a DUPLICATE (2 A rows)', b.first === 'storage-unavailable' && b.invitesFreshRetry && b.rowsA === 2);
    check('F1 CORRECTED: reconciliation reads the durable settlement for the exact account + request id -> already-recorded; no retry invited; a same-id retry is idempotent; exactly 1 server row', a.first === 'already-recorded' && !a.invitesFreshRetry && a.same === 'already-recorded' && a.rowsA === 1 && a.rowsOriginal === 1 && a.decisions.join() === 'A:ack-id:settled:accepted');
  }
  // ================================================================ outcome matrix (current code)
  {
    const nb = await f1(CUR, 'no-settle');
    check('M1 commit + lost acknowledgement, nothing settled yet -> queued (live copy found), same-id retry kept, no fresh retry invited; it later replays once', nb.first === 'queued' && !nb.invitesFreshRetry);
    // settlement DURING reconciliation: the reconciliation read is one transaction -> it sees either the live copy or the decision
    await fresh();
    const s = await tab(CUR), other = await tab(CUR);
    const h = withholdNextAck();
    const p = s.sync.submitActivityLog(body('during'), 'tmp', dev.fetch as any);
    await h.reached;
    afterClaimExpiry();
    const replaying = other.sync.replayOfflineQueue(dev.fetch as any);
    h.release();
    const [r] = await Promise.all([p.finally(h.restore), replaying]);
    Date.now = realNow;
    check('M2 settlement concurrent with reconciliation -> queued or already-recorded (never a failure); exactly 1 row', (r.kind === 'queued' || r.kind === 'already-recorded') && rows(A, 'during').length === 1);
  }
  for (const [label, setup, expect] of [
    ['M3 active copy absent + durable DISCARD', 'discarded', 'not-stored:discarded'],
    ['M4 active copy absent + settlement whose server answer was a REJECTION', 'rejected', 'rejected'],
    ['M5 active copy absent + settlement written before R14 (answer not recorded)', 'legacy-settled', 'outcome-unknown'],
    ['M6 decision for the same id but a DIFFERENT payload (contradictory evidence)', 'conflict', 'not-stored'],
  ] as const) {
    await fresh();
    const s = await tab(CUR);
    if (setup === 'discarded') await putDecision(s, A, 'x', 'discarded');
    // R15 (39257): a recorded rejection is authoritative only with its versioned receipt (a bare pre-R15 marker
    // proves nothing and stays unresolved -- covered by test/rel04ActivityOperationContract.test.ts C-cases).
    if (setup === 'rejected') { const pl = s.q.canonicalPayload({ ...body('x'), tempId: 'tmp' }); await putDecision(s, A, 'x', 'settled', { payload: pl, serverOutcome: 'rejected', receipt: { v: 1, kind: 'rejected', owner: A, crid: 'x', payload: pl, status: 400, afterPossibleSend: false, at: 1 } }); }
    if (setup === 'legacy-settled') await putDecision(s, A, 'x', 'settled');
    if (setup === 'conflict') await putDecision(s, A, 'x', 'settled', { payload: 'something else', serverOutcome: 'accepted' });
    const r = await s.sync.submitActivityLog(body('x'), 'tmp', dev.fetch as any);
    const got = r.kind === 'not-stored' && r.reason ? `not-stored:${r.reason}` : r.kind;
    check(`${label} -> ${expect} (never already-recorded, never storage-unavailable); 0 server rows`, got === expect && rows(A).length === 0);
  }
  {
    // M7 lost acknowledgement + the reconciliation read ALSO fails -> unresolved, identity kept, replays once later
    await fresh();
    const s = await tab(CUR);
    const h = withholdNextAck({ failReconciliationRead: true });
    const p = s.sync.submitActivityLog(body('unread'), 'tmp', dev.fetch as any);
    await h.reached; h.release();
    const r = await p.finally(() => { h.restore(); idbFault.read = false; });
    afterClaimExpiry();
    const rp = await s.sync.replayOfflineQueue(dev.fetch as any);
    Date.now = realNow;
    check('M7 durable-decision read failure during reconciliation -> outcome-unknown (never a failure), the same id replays exactly once', r.kind === 'outcome-unknown' && rp.attempted === 1 && rows(A, 'unread').length === 1);
    // M8 no copy and no decision (the transaction never committed) -> confirmed not queued
    await fresh();
    const s2 = await tab(CUR);
    idbFault.write = true;
    const r2 = await s2.sync.submitActivityLog(body('nope'), 'tmp', dev.fetch as any);
    idbFault.write = false;
    check('M8 no active copy AND no decision (rolled back) -> storage-unavailable is only reported when non-commit is ESTABLISHED; 0 rows', r2.kind === 'storage-unavailable' && rows(A).length === 0 && (await queueDump()).records.length === 0);
    // M9 cross-account decision isolation
    await fresh();
    const sB = await tab(CUR, B);
    await putDecision(sB, B, 'shared', 'settled', { serverOutcome: 'accepted' });
    const sA = await tab(CUR, A);
    const rA = await sA.sync.submitActivityLog(body('shared'), 'tmp', dev.fetch as any);
    check('M9 B\'s durable settlement for the same request id never answers for A: A\'s request is sent and confirmed once', rA.kind === 'confirmed' && rows(A, 'shared').length === 1 && rows(B).length === 0);
  }

  // ================================================================ Home: the real "Start now" interaction
  // NEGATIVE CONTROL first: Home driven by R13's submission (ignores the settlement) shows "Couldn't log. Try again."
  // and its retry click creates a fresh-id duplicate. Then the current code: success, no retry, one row.
  (global as any).fetch = dev.fetch; (window as any).fetch = dev.fetch;
  (global as any).requestAnimationFrame = (f: any) => setTimeout(f, 0); (global as any).cancelAnimationFrame = (id: any) => clearTimeout(id);
  (window as any).confirm = () => true; (window as any).alert = () => {};
  closeAllTabs();
  const pageAcct = require('../apps/web/lib/accountSession');
  const pageQ = require('../apps/web/lib/offlineHabitQueue');
  const pageSync = require('../apps/web/lib/activitySync');
  const Page = require('../apps/web/app/page').default;
  const currentSubmit = pageSync.submitActivityLog;
  const r13q = compile(fx('offlineHabitQueue.ts.txt'), lib('offlineHabitQueue.r13.home.js'));
  const r13sync = compile(fx('activitySync.ts.txt'), lib('activitySync.r13.home.js'), { './offlineHabitQueue': r13q, './accountSession': pageAcct });
  const settle = async (k = 30) => { for (let i = 0; i < k; i++) await flush(); };
  const textOf = (el: HTMLElement) => (el.textContent ?? '').replace(/\s+/g, ' ');
  async function homeRun(submit: unknown) {
    Date.now = realNow; resetStore(); storage.clear(); await pageQ.__resetQueueDbForTests(); await clearQueueDb();
    pageSync.submitActivityLog = submit;
    pageAcct.__resetAccountSessionForTests('home');
    dev.signIn(A);
    const h = await mount(React.createElement(Page));
    await settle();
    const c = h.container as HTMLElement;
    const byText = (t: string) => [...c.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === t) as HTMLButtonElement | undefined;
    const start = () => byText('Start now');
    /** The user's log action on Good Right Now: "Start now", then a duration ("30m") -- this is what calls handleLogActivity. */
    const logOnce = async () => { const b = start(); if (!b) return false; await act(async () => { await click(b); }); await settle(4); const d = byText('30m'); if (!d) return false; await act(async () => { await click(d); }); return true; };
    if (!start()) { await h.unmount(); return { found: false } as any; }
    const held = withholdNextAck();
    if (!(await logOnce())) { held.restore(); await h.unmount(); return { found: false } as any; }
    await held.reached;
    // Another tab of the same account, past the claim lifetime, replays and settles the committed request.
    const other = openTab('home-other'); await other.acct.fetchVerifiedSession(dev.fetch as any);
    afterClaimExpiry();
    await other.sync.replayOfflineQueue(dev.fetch as any);
    held.release();
    await settle(); held.restore();
    const afterFirst = textOf(c);
    const errorShown = /Couldn.t log\. Try again\./.test(afterFirst);
    const retryBtn = start();
    if (errorShown && retryBtn) { await logOnce(); await settle(); } // the user's retry: the same Home action, a fresh request id
    const ids = [...new Set(rows(A).map((l: any) => l.clientRequestId))];
    Date.now = realNow;
    await h.unmount();
    return { found: true, errorShown, retried: Boolean(errorShown && retryBtn), rowsA: rows(A).length, distinctIds: ids.length };
  }
  {
    const neg = await homeRun(r13sync.submitActivityLog);
    const cur = await homeRun(currentSubmit);
    pageSync.submitActivityLog = currentSubmit;
    console.log('HOME', JSON.stringify({ R13: neg, current: cur }));
    check('H1 the real Home page offers "Start now" (Good Right Now) and drives handleLogActivity -> submitActivityLog', neg.found && cur.found);
    check('H1 NEGATIVE CONTROL (R13 submission in the real Home): the settled activity is shown as "Couldn\'t log. Try again." and the retry click creates a fresh-id DUPLICATE (2 rows, 2 request ids)', neg.errorShown && neg.retried && neg.rowsA === 2 && neg.distinctIds === 2);
    check('H1 CORRECTED (current code, real Home): no error and no retry is offered; exactly 1 row under the original request id', !cur.errorShown && !cur.retried && cur.rowsA === 1 && cur.distinctIds === 1);
  }

  // ================================================================ cleanup matrix (F2, F3 and the physical-state rules)
  async function discardCase(impl: Impl, setup: (s: Stack) => Promise<void> | void, during?: { removeThrowsOnce?: string; finalReadFails?: boolean; writeDuringFinalScan?: () => void }) {
    await fresh();
    const s = await tab(impl);
    await setup(s);
    const snap = await s.q.readOwnedQueue(A);
    const origGet = storage.getItem.bind(storage), origRemove = storage.removeItem.bind(storage);
    let failNext = false;
    if (during?.removeThrowsOnce) {
      (storage as any).removeItem = (k: string) => { origRemove(k); if (k === during.removeThrowsOnce) failNext = true; };
      (storage as any).getItem = (k: string) => { if (k === during.removeThrowsOnce && failNext) { failNext = false; throw new Error('transient read-back failure (synthetic)'); } return origGet(k); };
    }
    const os = fidb.IDBObjectStore.prototype.getAll;
    let n = 0;
    if (during?.finalReadFails || during?.writeDuringFinalScan) {
      fidb.IDBObjectStore.prototype.getAll = function (...a: any[]) {
        if (this.name === 'records' && this.transaction.mode === 'readonly') {
          if (during.finalReadFails) throw new Error('final verification read failure (synthetic)');
          const r = os.apply(this, a); if (n++ === 0) r.addEventListener('success', () => during.writeDuringFinalScan!()); return r;
        }
        return os.apply(this, a);
      };
    }
    try { return await s.q.discardOwned(A, snap, { tab: 't' }); }
    finally { (storage as any).getItem = origGet; (storage as any).removeItem = origRemove; fidb.IDBObjectStore.prototype.getAll = os; }
  }
  const outcome = (o: any) => ['removed', 'cleanupPending', 'discardedUnverified', 'unidentified'].filter((k) => o[k]).map((k) => `${k}=${o[k]}`).join(',');
  {
    // F2 opaque v2 array holding the same activity
    const opaque = async (s: Stack) => { await put(s, row('known-active', 'opaque-id')); storage.setItem(`offline_habit_queue_v2:${A}`, '[' + JSON.stringify(item('opaque-id'))); };
    const b = await discardCase(R13, opaque), a = await discardCase(CUR, opaque);
    console.log('F2', JSON.stringify({ R13: outcome(b), current: outcome(a) }));
    check('F2 R13 (negative control: opaque storage treated as absent) reproduces: removed=1 while an unreadable v2 array still holds the activity', b.removed === 1);
    check('F2 CORRECTED: discarded with physical state UNVERIFIED (not removed); the opaque bytes are preserved; the decision blocks resubmission', a.removed === 0 && a.discardedUnverified === 1 && a.unidentified === 1 && storage.data.has(`offline_habit_queue_v2:${A}`));
    // F3 transient read-back failure, later complete verification proves absence
    const q3 = (s: Stack) => { storage.setItem(`aura_q3:${A}:removed`, JSON.stringify(item('removed'))); void s; };
    const b3 = await discardCase(R13, q3, { removeThrowsOnce: `aura_q3:${A}:removed` }), a3 = await discardCase(CUR, q3, { removeThrowsOnce: `aura_q3:${A}:removed` });
    console.log('F3', JSON.stringify({ R13: outcome(b3), current: outcome(a3) + `,cleanupErrors=${a3.cleanupErrors}` }));
    check('F3 R13 (negative control: a stale cleanup error overrides verification) reproduces: cleanupPending=1 although storage is empty', b3.cleanupPending === 1 && !storage.data.has(`aura_q3:${A}:removed`));
    check('F3 CORRECTED: the final complete verification is authoritative -> removed=1; the transient error is kept as a diagnostic (cleanupErrors=1)', a3.removed === 1 && a3.cleanupPending === 0 && a3.cleanupErrors === 1);
  }
  for (const [label, setup, during, expect] of [
    ['C1 deletion + successful final verification', (s: Stack) => put(s, row('c1', 'c1')), undefined, 'removed=1'],
    ['C2 deletion + failed final verification', (s: Stack) => put(s, row('c2', 'c2')), { finalReadFails: true }, 'discardedUnverified=1'],
    ['C3 known remaining copy (a contradictory copy of it is preserved)', async (s: Stack) => { await put(s, row('c3', 'c3')); storage.setItem(`aura_q3:${A}:c3`, JSON.stringify(item('c3', B))); }, undefined, 'cleanupPending=1,unidentified=1'],
    ['C4 retired write during the final scan', (s: Stack) => put(s, row('c4', 'c4')), { writeDuringFinalScan: () => storage.setItem(`aura_q3:${A}:c4`, JSON.stringify(item('c4'))) }, 'cleanupPending=1'],
  ] as const) {
    const o = await discardCase(CUR, setup as any, during as any);
    check(`${label} -> ${expect}`, outcome(o) === expect);
  }
  {
    // C5 a different identity is written at the same record id during the final scan: never decided or deleted
    let s5: Stack | null = null;
    const o = await discardCase(CUR, async (s) => { s5 = s; await put(s, row('c5', 'c5')); }, { writeDuringFinalScan: () => { void put(s5!, row('c5', 'c5-replacement')); } });
    await new Promise((r) => setTimeout(r, 20));
    const d = await decisions();
    check('C5 concurrent replacement (another identity at the same record id) -> the confirmed one removed and decided; the replacement preserved, undecided', o.removed === 1 && d.join() === 'A:c5:discarded' && (await queueDump()).records.map((r: any) => r.clientRequestId).join() === 'c5-replacement');
  }
  {
    // C6 durable discard with uncertain physical cleanup (transient final-read failure), then recovery: the same
    // confirmed snapshot re-verified once storage is readable reports verified absence; the decision blocks resubmission
    await fresh();
    const s = await tab(CUR);
    await put(s, row('c6', 'c6'));
    const snap = await s.q.readOwnedQueue(A);
    const os = fidb.IDBObjectStore.prototype.getAll;
    fidb.IDBObjectStore.prototype.getAll = function (...a: any[]) { if (this.name === 'records' && this.transaction.mode === 'readonly') throw new Error('transient final read failure (synthetic)'); return os.apply(this, a); };
    const first = await s.q.discardOwned(A, snap, { tab: 't' }).finally(() => { fidb.IDBObjectStore.prototype.getAll = os; });
    const resubmit = await s.sync.submitActivityLog(body('c6'), 'tmp', dev.fetch as any);
    const again = await s.q.discardOwned(A, snap, { tab: 't' });
    check('C6 transient final-read failure -> discardedUnverified (never removed); resubmission refused as discarded; a later verification of the same snapshot reports removed; 0 rows', first.discardedUnverified === 1 && first.removed === 0 && resubmit.kind === 'not-stored' && resubmit.reason === 'discarded' && again.removed === 1 && rows(A).length === 0);
  }
  finish();
}

main().catch((e) => { console.error(e); process.exit(1); });
