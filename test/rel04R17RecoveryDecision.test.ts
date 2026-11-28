/**
 * AURA-ANDROID-REL-04 R17 (ticket 39261; verification 39260 NO-GO: G7-G9) -- ONE account-scoped recovery decision
 * (lib/offlineHabitQueue.ts decideOperations) consumed by the UI projection, a NEW submission (inside the claiming
 * transaction), the user's explicit Retry and automatic replay.
 *
 * Each 39260 witness runs on the UNCHANGED R16 implementation (e94a863 == 3c906f9 for these files, vendored in
 * test/fixtures/rel04-r16-head and checked against git) -- the negative control -- and on R17; then the decision
 * matrix with every consumer checked for agreement, storage / startup faults, the real page (Calendar / Past
 * Activity after remount and restart, held startup reads, a stale read delivered late) and one negative control
 * per blocker (each R17 rule removed in turn).
 *
 *   G7  conflicting recovery payload: a marker / receipt naming a DIFFERENT body than the live copy never supplies
 *       the Retry body, and conflicting evidence is never sent under the id (Retry withheld; copies kept)
 *   G8  startup: a NEW submission is decided in the claiming transaction -- a delayed / held projection read cannot
 *       admit a fresh-id duplicate; storage failure refuses; stale reads are fenced
 *   G9  incomplete marker: a null-payload / proofless marker never hides the live copy -- its intent stays
 *       recoverable (withheld re-entry, Retry under the original id)
 *
 *   TS_NODE_COMPILER_OPTIONS='{"jsx":"react-jsx"}' npx ts-node --project tsconfig.jsdom-tests.json test/rel04R17RecoveryDecision.test.ts
 */
import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { React, mount, flush, act, click, typeInto } from './jsdomReactHarness';
import { Device, WEB, addUser, check, clearQueueDb, closeAllTabs, finish, idbFault, logsOf, openTab, payload, queueDump, resetStore, storage } from './rel04AccountIsolationHarness';

const ts = require(require.resolve('typescript', { paths: [WEB] }));
const Module = require('module');
const fidb = require('fake-indexeddb');
const FX = path.join(__dirname, 'fixtures', 'rel04-r16-head');
const fx = (n: string) => fs.readFileSync(path.join(FX, n), 'utf8');
const src = (n: string) => fs.readFileSync(path.join(WEB, 'lib', n), 'utf8');
const R16_HEAD = 'e94a86306bff8356447e35ef2530ebde18cfbdb6';
const gitHas = (c: string) => { try { execFileSync('git', ['cat-file', '-e', `${c}^{commit}`], { stdio: 'ignore' }); return true; } catch { return false; } };
(function provenance() {
  if (!gitHas(R16_HEAD)) { console.log(`SKIP fixture re-check: ${R16_HEAD.slice(0, 7)} not in this checkout (shallow clone); fixtures used as vendored`); return; }
  for (const f of ['offlineHabitQueue', 'activitySync', 'habitLogSyncPolicy', 'pendingReplayReconciliation']) {
    check(`fixture rel04-r16-head/${f}.ts.txt == ${R16_HEAD.slice(0, 7)} apps/web/lib/${f}.ts`, execFileSync('git', ['show', `${R16_HEAD}:apps/web/lib/${f}.ts`], { encoding: 'utf8', maxBuffer: 1 << 26 }) === fx(`${f}.ts.txt`));
  }
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
function patched(source: string, edits: Array<[string, string]>): string {
  let s = source;
  for (const [a, b] of edits) { if (!s.includes(a)) throw new Error(`negative-control patch does not apply: ${a.slice(0, 90)}`); s = s.split(a).join(b); }
  return s;
}
const lib = (n: string) => path.join(WEB, 'lib', n);
let seq = 0;
const A = 'r17-account-a', B = 'r17-account-b';
addUser(A, 'r17a@example.invalid'); addUser(B, 'r17b@example.invalid');
const route = '/api/habit-logs';
const body = (id: string, title = 'Workout') => payload(title, id);
const rows = (owner: string, crid?: string) => logsOf(owner).filter((l: any) => crid === undefined || l.clientRequestId === crid);
const realNow = Date.now;
async function fresh() { Date.now = realNow; resetStore(); storage.clear(); storage.fail = { get: false, set: false, remove: false }; idbFault.open = false; idbFault.read = false; idbFault.write = false; closeAllTabs(); await clearQueueDb(); }
type Stack = { q: any; sync: any; acct: any };
type Impl = { name: string; tab: (id: string) => Stack };
const CUR: Impl = { name: 'R17', tab: (id) => { const t = openTab(id); return { q: t.q, sync: t.sync, acct: t.acct }; } };
function stackOf(name: string, sources: { q: string; sync: string; policy: string; recon: string }): Impl {
  return {
    name,
    tab: (id) => {
      const t = openTab(id);
      const policy = compile(sources.policy, lib(`habitLogSyncPolicy.${name}.${seq++}.js`));
      const recon = compile(sources.recon, lib(`pendingReplayReconciliation.${name}.${seq++}.js`));
      const q = compile(sources.q, lib(`offlineHabitQueue.${name}.${seq++}.js`), { './habitLogSyncPolicy': policy, './pendingReplayReconciliation': recon });
      const sync = compile(sources.sync, lib(`activitySync.${name}.${seq++}.js`), { './offlineHabitQueue': q, './habitLogSyncPolicy': policy, './pendingReplayReconciliation': recon });
      return { q, sync, acct: t.acct };
    },
  };
}
const R16 = stackOf('R16', { q: fx('offlineHabitQueue.ts.txt'), sync: fx('activitySync.ts.txt'), policy: fx('habitLogSyncPolicy.ts.txt'), recon: fx('pendingReplayReconciliation.ts.txt') });
const current = { q: src('offlineHabitQueue.ts'), sync: src('activitySync.ts'), policy: src('habitLogSyncPolicy.ts'), recon: src('pendingReplayReconciliation.ts') };
const mutant = (name: string, part: keyof typeof current, edits: Array<[string, string]>) => stackOf(name, { ...current, [part]: patched(current[part], edits) });

const dev = new Device();
dev.extra['/api/plans'] = () => [];
dev.extra['/api/habits'] = () => [];
let n = 0;
async function tab(impl: Impl, owner = A) { dev.signIn(owner); const s = impl.tab(`${impl.name}-${owner}-${n++}`); await s.acct.fetchVerifiedSession(dev.fetch as any); return s; }
async function putDecision(s: Stack, d: Record<string, unknown>) { const db: IDBDatabase = await s.q.__openQueueDbForTests(); const t = db.transaction('tombstones', 'readwrite'); t.objectStore('tombstones').put(d); await new Promise<void>((ok) => { t.oncomplete = () => ok(); }); }
async function putRecord(s: Stack, r: Record<string, unknown>) { const db: IDBDatabase = await s.q.__openQueueDbForTests(); const t = db.transaction('records', 'readwrite'); t.objectStore('records').put(r); await new Promise<void>((ok) => { t.oncomplete = () => ok(); }); }
const posts = () => dev.count('POST', route);
const postedBodies: any[] = [];
const copies = async (crid: string) => (await queueDump()).records.filter((r: any) => r.clientRequestId === crid).length;
const decisionsOf = async (crid: string) => (await queueDump()).tombstones.filter((d: any) => d.clientRequestId === crid || String(d.recordId).endsWith(`\u0000${crid}`));
/** Commits on the real route; the acknowledgement is an unreadable HTML 200 (the reviewer's fault). */
const htmlAck: typeof fetch = (async (input: any, init: any = {}) => {
  const res = await dev.fetch(input, init);
  if (String(init.method ?? 'GET').toUpperCase() === 'POST' && String(input).endsWith(route)) return new Response('<html>Unreadable acknowledgement</html>', { status: 200, headers: { 'content-type': 'text/html' } });
  return res;
}) as any;
const recording: typeof fetch = (async (input: any, init: any = {}) => {
  if (String(init.method ?? 'GET').toUpperCase() === 'POST' && String(input).endsWith(route)) postedBodies.push(JSON.parse(String(init.body)));
  return dev.fetch(input, init);
}) as any;
const markerOf = (s: Stack, id: string, extra: Record<string, unknown>) => ({ recordId: s.q.decisionKey(A, id), ownerUserId: A, clientRequestId: id, decision: 'settled', fmt: 'r8', at: Date.now(), ...extra });
const canon = (s: Stack, b: Record<string, unknown>) => s.q.canonicalPayload({ ...b, tempId: 'x' });

/** Held projection: every READ-ONLY queue transaction completes physically but its completion is delivered only on release (the reviewer's G8 fault). */
const hold = { on: false, held: 0, pending: [] as Array<() => void> };
{
  const realTx = fidb.IDBDatabase.prototype.transaction;
  fidb.IDBDatabase.prototype.transaction = function (this: any, ...a: any[]) {
    const t = realTx.apply(this, a);
    if (hold.on && t.mode === 'readonly' && t.objectStoreNames.contains('dispatches')) {
      let h: any = null;
      Object.defineProperty(t, 'oncomplete', { configurable: true, get: () => (h ? (ev: any) => { hold.held++; hold.pending.push(() => h.call(t, ev)); } : null), set: (fn) => { h = fn; } });
    }
    return t;
  };
}
const releaseHeld = () => { hold.on = false; const p = hold.pending.splice(0); for (const f of p) f(); };

async function main() {
  // ================================================================ G7 witness: an invalid receipt + conflicting marker supply the Retry body
  {
    const out: Record<string, any> = {};
    for (const impl of [R16, CUR]) {
      await fresh();
      const s = await tab(impl);
      const id = 'g7-conflict';
      dev.fault('POST', route, 'network-before');
      await s.sync.submitActivityLog({ ...body(id), activityId: 'workout', logSource: 'AURA_DO_NOW' } as any, 't', dev.fetch as any); // Home "Start now": queued, nothing written
      const changed = { ...body(id, 'Different marker activity'), activityId: 'workout', logSource: 'AURA_DO_NOW' };
      await putDecision(s, markerOf(s, id, { payload: canon(s, changed), receipt: { v: 2, kind: 'accepted', owner: A } })); // malformed v2 receipt
      const projected = (await s.q.readActivityOperations(A))?.find((o: any) => o.clientRequestId === id);
      const p0 = posts();
      postedBodies.length = 0;
      // THE same explicit Retry page.tsx performs after a restart: the projection's body, the original id
      const viaProjection = projected?.body ? await s.sync.submitActivityLog(projected.body, 'retry', recording, undefined, { explicitRetry: true }) : null;
      const viaMarkerBody = await s.sync.submitActivityLog(changed as any, 'retry2', recording, undefined, { explicitRetry: true });
      out[impl.name] = { shown: projected?.body?.activityTitle, retryable: projected?.retryable, conflict: projected?.conflict, a: viaProjection?.kind, b: viaMarkerBody.kind, posts: posts() - p0, changedRows: rows(A, id).filter((r: any) => r.activityTitle === 'Different marker activity').length, rows: rows(A, id).length, copies: await copies(id), sent: postedBodies.map((x) => x.activityTitle) };
    }
    console.log('W G7', JSON.stringify(out));
    check('W G7 -- R16 (negative control) reproduces: the projection shows the MARKER body and the explicit Retry commits the changed activity under the original id', out.R16.shown === 'Different marker activity' && out.R16.changedRows === 1);
    check(`W G7 -- R17: the projection shows the operation's own intent (${out.R17.shown}), conflict, not retryable; neither the projection body nor the marker body is sent (0 POSTs, 0 rows); the original copy is kept`, out.R17.shown === 'Workout' && out.R17.conflict === true && out.R17.retryable === false && out.R17.a === 'outcome-unknown' && out.R17.b === 'outcome-unknown' && out.R17.posts === 0 && out.R17.rows === 0 && out.R17.copies === 1);
  }

  // ================================================================ G9 witness: an incomplete marker masks the live copy
  {
    const out: Record<string, any> = {};
    for (const impl of [R16, CUR]) {
      await fresh();
      const s = await tab(impl);
      const id = 'g9-live';
      const first = await s.sync.submitActivityLog(body(id, 'Review exact original') as any, 't', htmlAck); // the route committed; unreadable ack
      await putDecision(s, markerOf(s, id, { payload: null })); // account-bound, proofless, null payload
      const projected = (await s.q.readActivityOperations(A))?.find((o: any) => o.clientRequestId === id);
      const view = projected ? { [id]: { clientRequestId: id, status: projected.status, activityTitle: projected.body?.activityTitle ?? '', at: projected.at, account: A, intents: projected.intents } } : {};
      const recon = impl === CUR ? require('../apps/web/lib/pendingReplayReconciliation') : compile(fx('pendingReplayReconciliation.ts.txt'), lib(`pendingReplayReconciliation.W9.${seq++}.js`));
      const found = recon.findRecoverableOperation(view, { activityTitle: 'Review exact original' })?.clientRequestId;
      const p0 = posts();
      const again = await s.sync.submitActivityLog(body(`g9-new-${impl.name}`, 'Review exact original') as any, 't2', dev.fetch as any, undefined, { newOperation: { activityTitle: 'Review exact original' } });
      out[impl.name] = { first: first.kind, status: projected?.status, shown: projected?.body?.activityTitle ?? null, retryable: projected?.retryable, found, again: again.kind, named: again.operation?.clientRequestId, posts: posts() - p0, rows: rows(A).length, ids: new Set(rows(A).map((r: any) => r.clientRequestId)).size };
      if (impl === CUR) {
        const retry = await s.sync.submitActivityLog(projected.body, 'retry', dev.fetch as any, undefined, { explicitRetry: true });
        out.R17.retry = retry.kind; out.R17.afterRetry = { rows: rows(A).length, ids: [...new Set(rows(A).map((r: any) => r.clientRequestId))], copies: await copies(id), receipt: (await decisionsOf(id))[0]?.receipt?.kind ?? null };
      }
    }
    console.log('W G9', JSON.stringify(out));
    check('W G9 -- R16 (negative control) reproduces: the null-payload marker hides the live copy (no body, the activity cannot be matched) and an identical new entry is sent under a NEW id (2 rows)', out.R16.first === 'outcome-unknown' && out.R16.shown === null && out.R16.found === undefined && out.R16.posts === 1 && out.R16.ids === 2);
    check(`W G9 -- R17: the live copy supplies the operation's intent (unresolved, ${out.R17.shown}, retryable); the identical new entry is refused in the claiming transaction (recovery-required naming the original; 0 POSTs, 1 row)`, out.R17.status === 'unresolved' && out.R17.shown === 'Review exact original' && out.R17.retryable === true && out.R17.found === 'g9-live' && out.R17.again === 'recovery-required' && out.R17.named === 'g9-live' && out.R17.posts === 0 && out.R17.rows === 1);
    check('W G9 -- R17: Retry resumes the ORIGINAL id with its own body -> still 1 row, 1 id; a validated accepted receipt replaces the incomplete marker; no copy left', out.R17.retry === 'confirmed' && out.R17.afterRetry.rows === 1 && out.R17.afterRetry.ids.length === 1 && out.R17.afterRetry.ids[0] === 'g9-live' && out.R17.afterRetry.copies === 0 && out.R17.afterRetry.receipt === 'accepted');
  }

  // ================================================================ G8 witness: a NEW submission while the account's recovery state is not loaded
  {
    const out: Record<string, any> = {};
    for (const impl of [R16, CUR]) {
      await fresh();
      const s = await tab(impl);
      await s.sync.submitActivityLog(body('g8-open', 'Review exact original') as any, 't', htmlAck); // committed, unverifiable
      hold.on = true; hold.held = 0; // the projection read is held (as at a delayed startup)
      const read = s.q.readActivityOperations(A);
      let readDelivered = false; void read.then(() => { readDelivered = true; });
      for (let i = 0; i < 10; i++) await flush();
      const p0 = posts();
      const fresh1 = await s.sync.submitActivityLog(body(`g8-new-${impl.name}`, 'Review exact original') as any, 't2', dev.fetch as any, undefined, { newOperation: { activityTitle: 'Review exact original' } });
      out[impl.name] = { readDelivered, held: hold.held, fresh: fresh1.kind, named: fresh1.operation?.clientRequestId, posts: posts() - p0, rows: rows(A).length };
      releaseHeld(); await read;
    }
    console.log('W G8', JSON.stringify(out));
    check('W G8 -- R16 (negative control) reproduces: while the projection read is held, an identical new entry is sent under a NEW id (2 rows)', out.R16.readDelivered === false && out.R16.held > 0 && out.R16.fresh === 'confirmed' && out.R16.rows === 2);
    check('W G8 -- R17: with the projection read still held, the claiming transaction decides: recovery-required naming the original, 0 POSTs, 1 row', out.R17.readDelivered === false && out.R17.held > 0 && out.R17.fresh === 'recovery-required' && out.R17.named === 'g8-open' && out.R17.posts === 0 && out.R17.rows === 1);
  }
  {
    // storage failure never becomes an implicit empty recovery state
    await fresh();
    const s = await tab(CUR);
    dev.fault('POST', route, 'network-before');
    await s.sync.submitActivityLog(body('g8-store') as any, 't', dev.fetch as any);
    idbFault.read = true;
    const decision = await s.q.readRecoveryDecision(A);
    const ops = await s.q.readActivityOperations(A);
    const p0 = posts();
    const r = await s.sync.submitActivityLog(body('g8-store-new') as any, 't2', dev.fetch as any, undefined, { newOperation: { activityTitle: 'Workout' } });
    idbFault.read = false;
    check(`G8 storage failure: the recovery decision is UNREADABLE (null, never []) for the projection and the gate; a new submission is refused (${r.kind}), nothing sent, the original copy kept`, decision === null && ops === null && r.kind === 'storage-unavailable' && posts() === p0 && (await copies('g8-store')) === 1 && (await copies('g8-store-new')) === 0);
    // the gate matches by activity only: an unrelated activity is not withheld; a deliberately separate one is not either
    const other = await s.sync.submitActivityLog(body('g8-other', 'Read a book') as any, 't3', dev.fetch as any, undefined, { newOperation: { activityTitle: 'Read a book' } });
    const separate = await s.sync.submitActivityLog(body('g8-separate') as any, 't4', dev.fetch as any);
    check(`G8 scope: an UNRELATED activity is not withheld (${other.kind}); a deliberately separate identical activity (no newOperation) still goes through (${separate.kind}) -- 2 new rows`, other.kind === 'confirmed' && separate.kind === 'confirmed' && rows(A).length === 2);
    // account isolation: another account's open operation never withholds this account's activity
    const sB = await tab(CUR, B);
    const rb = await sB.sync.submitActivityLog({ ...body('g8-b'), } as any, 'tb', dev.fetch as any, undefined, { newOperation: { activityTitle: 'Workout' } });
    check(`G8 account isolation: account A's open "Workout" never withholds account B's (${rb.kind}, 1 row for B)`, rb.kind === 'confirmed' && rows(B).length === 1);
  }

  // ================================================================ the decision matrix: every consumer agrees
  {
    type Case = { name: string; setup: (s: Stack, id: string) => Promise<void>; expect: { status: string; dispatch: 'live' | 'marker' | null; shown?: string | null }; replay?: boolean };
    const live = async (s: Stack, id: string, title = 'Workout') => { await s.q.enqueueOwned({ ...body(id, title), tempId: 't', ownerUserId: A }); };
    const fullRow = (id: string, extra: Record<string, unknown> = {}) => ({ id: 'srv-1', userId: A, clientRequestId: id, activityTitle: 'Workout', activityId: null, activeWindow: 'NEUTRAL', logMinuteOfDay: 0, logTimestamp: '2026-11-24T06:00:00.000Z', durationMinutes: 30, notes: null, logSource: 'MANUAL', activitySignificance: 'MEDIUM', ...extra });
    const cases: Case[] = [
      { name: 'no marker + one live copy', setup: (s, id) => live(s, id), expect: { status: 'pending', dispatch: 'live', shown: 'Workout' }, replay: true },
      { name: 'no marker + two live copies with different bodies', setup: async (s, id) => { await live(s, id); await putRecord(s, { recordId: 'second', ownerUserId: A, clientRequestId: id, item: { ...body(id, 'Other'), ownerUserId: A, recordId: 'second' }, queuedAt: 1, fmt: 'r8' }); }, expect: { status: 'conflict', dispatch: null, shown: null } },
      { name: 'proofless bound marker (same body) + live copy', setup: async (s, id) => { await live(s, id); await putDecision(s, markerOf(s, id, { payload: canon(s, body(id)) })); }, expect: { status: 'unresolved', dispatch: 'live', shown: 'Workout' } },
      { name: 'proofless bound marker (DIFFERENT body) + live copy', setup: async (s, id) => { await live(s, id); await putDecision(s, markerOf(s, id, { payload: canon(s, body(id, 'Different')) })); }, expect: { status: 'conflict', dispatch: null, shown: 'Workout' } },
      { name: 'malformed v2 receipt (same body) + live copy', setup: async (s, id) => { await live(s, id); await putDecision(s, markerOf(s, id, { payload: canon(s, body(id)), receipt: { v: 2, kind: 'accepted', owner: A } })); }, expect: { status: 'unresolved', dispatch: 'live', shown: 'Workout' } },
      { name: 'contradictory receipt row (same marker body) + live copy', setup: async (s, id) => { await live(s, id); const pl = canon(s, body(id)); await putDecision(s, markerOf(s, id, { payload: pl, receipt: { v: 2, kind: 'accepted', owner: A, crid: id, payload: pl, serverRecordId: 'srv-1', row: fullRow(id, { activityTitle: 'Other' }), at: 1 } })); }, expect: { status: 'unresolved', dispatch: 'live', shown: 'Workout' } },
      { name: 'null-payload marker + live copy (G9)', setup: async (s, id) => { await live(s, id); await putDecision(s, markerOf(s, id, { payload: null })); }, expect: { status: 'unresolved', dispatch: 'live', shown: 'Workout' } },
      { name: 'marker with missing fields (no fmt) + live copy', setup: async (s, id) => { await live(s, id); await putDecision(s, { recordId: s.q.decisionKey(A, id) }); }, expect: { status: 'unresolved', dispatch: 'live', shown: 'Workout' } },
      { name: 'unbound marker (another account named) with a DIFFERENT body + live copy', setup: async (s, id) => { await live(s, id); await putDecision(s, markerOf(s, id, { ownerUserId: B, payload: canon(s, body(id, 'Different')) })); }, expect: { status: 'conflict', dispatch: null, shown: 'Workout' } },
      { name: 'unparseable marker payload + live copy', setup: async (s, id) => { await live(s, id); await putDecision(s, markerOf(s, id, { payload: '{' })); }, expect: { status: 'conflict', dispatch: null, shown: 'Workout' } },
      { name: 'proofless bound marker, no copy', setup: async (s, id) => { await putDecision(s, markerOf(s, id, { payload: canon(s, body(id)) })); }, expect: { status: 'unresolved', dispatch: 'marker', shown: 'Workout' } },
      { name: 'unbound marker, no copy', setup: async (s, id) => { await putDecision(s, markerOf(s, id, { ownerUserId: B, payload: canon(s, body(id)) })); }, expect: { status: 'unresolved', dispatch: null, shown: 'Workout' } },
      { name: 'null-payload marker, no copy', setup: async (s, id) => { await putDecision(s, markerOf(s, id, { payload: null })); }, expect: { status: 'unresolved', dispatch: null, shown: null } },
      { name: 'valid accepted receipt, no copy', setup: async (s, id) => { const pl = canon(s, body(id)); await putDecision(s, markerOf(s, id, { payload: pl, serverOutcome: 'accepted', possiblySent: true, receipt: { v: 2, kind: 'accepted', owner: A, crid: id, payload: pl, serverRecordId: 'srv-1', row: fullRow(id), at: 1 } })); }, expect: { status: 'confirmed', dispatch: null, shown: 'Workout' } },
      { name: 'valid accepted receipt + a live copy with ANOTHER body', setup: async (s, id) => { const pl = canon(s, body(id)); await putDecision(s, markerOf(s, id, { payload: pl, receipt: { v: 2, kind: 'accepted', owner: A, crid: id, payload: pl, serverRecordId: 'srv-1', row: fullRow(id), at: 1 } })); await putRecord(s, { recordId: 'late', ownerUserId: A, clientRequestId: id, item: { ...body(id, 'Other'), ownerUserId: A, recordId: 'late' }, queuedAt: 1, fmt: 'r8' }); }, expect: { status: 'conflict', dispatch: null, shown: 'Other' } },
      { name: 'null-payload discard + live copy', setup: async (s, id) => { await live(s, id); await putDecision(s, { recordId: s.q.decisionKey(A, id), ownerUserId: A, clientRequestId: id, payload: null, decision: 'discarded', fmt: 'r8', at: 1 }); }, expect: { status: 'discarded', dispatch: null } },
      { name: 'damaged copy only (no outer request id)', setup: async (s, id) => { await putRecord(s, { recordId: 'dmg', ownerUserId: A, clientRequestId: '', item: { ...body(id), ownerUserId: A }, queuedAt: 1, fmt: 'r8' }); }, expect: { status: 'unresolved', dispatch: null, shown: null } },
      { name: 'live copy + quarantined retired copy of the same id', setup: async (s, id) => { await live(s, id); storage.setItem(`aura_q3:${A}:${id}`, JSON.stringify({ ...body(id), ownerUserId: A })); }, expect: { status: 'pending', dispatch: null, shown: 'Workout' } },
    ];
    let agree = 0;
    for (const c of cases) {
      await fresh();
      const s = await tab(CUR);
      const id = `m-${agree}-${seq++}`;
      await c.setup(s, id);
      const decision = (await s.q.readRecoveryDecision(A))?.find((o: any) => o.clientRequestId === id);
      const projected = (await s.q.readActivityOperations(A))?.find((o: any) => o.clientRequestId === id);
      const expectedPayload = c.expect.dispatch === null ? null : canon(s, body(id));
      const p0 = posts();
      const replay = await s.sync.replayOfflineQueue(dev.fetch as any);
      const autoSent = posts() - p0;
      const p1 = posts();
      const retry = await s.sync.submitActivityLog(body(id) as any, 'r', dev.fetch as any, undefined, { explicitRetry: true });
      const retrySent = posts() - p1;
      const shownOk = c.expect.shown === undefined || (decision?.body?.activityTitle ?? null) === c.expect.shown;
      const projectionOk = projected && projected.status === (c.expect.status === 'conflict' ? 'unresolved' : c.expect.status) && projected.conflict === (c.expect.status === 'conflict') && projected.retryable === (expectedPayload !== null && (c.expect.status === 'pending' || c.expect.status === 'unresolved'));
      const consumersOk = autoSent === (c.replay ? 1 : 0) && (c.replay || retrySent === (expectedPayload !== null && c.expect.status !== 'pending' ? 1 : 0));
      const ok = decision && decision.status === c.expect.status && decision.dispatchPayload === expectedPayload && shownOk && projectionOk && consumersOk;
      if (ok) agree++;
      console.log(`  matrix ${ok ? 'OK  ' : 'FAIL'} ${c.name}`, JSON.stringify({ status: decision?.status, dispatch: decision?.dispatchPayload === expectedPayload, shown: decision?.body?.activityTitle ?? null, projection: projected && { status: projected.status, retryable: projected.retryable, conflict: projected.conflict }, autoSent, retrySent, retry: retry.kind, replay: replay.attempted }));
    }
    check(`decision matrix: ${agree}/${cases.length} evidence combinations give the specified decision AND the projection, automatic replay and explicit Retry all act on that same decision (sent only with its one dispatch payload)`, agree === cases.length);
  }

  // ================================================================ negative controls (each R17 rule removed in turn)
  {
    // N7 the Retry/replay binding to the decision removed from the claiming gate
    const noBinding = mutant('N7-no-decision-binding', 'q', [["  if (!decided || decided.dispatchPayload !== payload) return state.kind === 'live' ? { status: 'paused' } : { status: 'unverified' };\n", ''], ["  if (state.kind === 'unverified') return explicitRetry && decided.status === 'unresolved' ? { status: 'eligible', copies: state.copies } : { status: 'unverified' };", "  if (state.kind === 'unverified') return explicitRetry ? { status: 'eligible', copies: state.copies } : { status: 'unverified' };"]]);
    await fresh();
    const s = await tab(noBinding);
    const id = 'n7';
    await s.q.enqueueOwned({ ...body(id), tempId: 't', ownerUserId: A });
    await putDecision(s, markerOf(s, id, { payload: canon(s, body(id, 'Different marker activity')), receipt: { v: 2, kind: 'accepted', owner: A } }));
    const r = await s.sync.submitActivityLog(body(id, 'Different marker activity') as any, 'retry', dev.fetch as any, undefined, { explicitRetry: true });
    check(`N7 removing the decision binding at the claim boundary is detected: the conflicting marker body is committed under the original id (${r.kind}, changed rows ${rows(A, id).filter((x: any) => x.activityTitle === 'Different marker activity').length})`, rows(A, id).some((x: any) => x.activityTitle === 'Different marker activity'));

    // N8 the in-transaction NEW-operation decision removed
    const noFreshGate = mutant('N8-no-fresh-gate', 'q', [['      if (newOperation) {\n        const open = openFor(', '      if (false as boolean) {\n        const open = openFor(']]);
    await fresh();
    const s8 = await tab(noFreshGate);
    await s8.sync.submitActivityLog(body('n8-open', 'Review exact original') as any, 't', htmlAck);
    hold.on = true;
    const r8 = await s8.sync.submitActivityLog(body('n8-new', 'Review exact original') as any, 't2', dev.fetch as any, undefined, { newOperation: { activityTitle: 'Review exact original' } });
    releaseHeld();
    check(`N8 removing the in-transaction new-operation decision is detected: with the projection read held, the identical entry is sent under a NEW id (${r8.kind}; 2 rows)`, r8.kind === 'confirmed' && rows(A).length === 2);

    // N9 the marker-first rule (an unverified marker's payload alone decides; the live copy is ignored)
    const markerFirst = mutant('N9-marker-first', 'q', [
      ['    for (const p of [...livePayloads, ...(markerPayload !== null ? [markerPayload] : [])]) {', "    for (const p of [...(a.kind === 'none' ? livePayloads : []), ...(markerPayload !== null ? [markerPayload] : [])]) {"],
      ['    const named = new Set(livePayloads);', "    const named = new Set(a.kind === 'none' ? livePayloads : []);"],
    ]);
    await fresh();
    const s9 = await tab(markerFirst);
    await s9.sync.submitActivityLog(body('n9-live', 'Review exact original') as any, 't', htmlAck);
    await putDecision(s9, markerOf(s9, 'n9-live', { payload: null }));
    const proj9 = (await s9.q.readActivityOperations(A))?.find((o: any) => o.clientRequestId === 'n9-live');
    const r9 = await s9.sync.submitActivityLog(body('n9-new', 'Review exact original') as any, 't2', dev.fetch as any, undefined, { newOperation: { activityTitle: 'Review exact original' } });
    check(`N9 letting the incomplete marker take precedence over the live copy is detected: no intent, not retryable (${proj9?.retryable}) and the identical entry is sent under a NEW id (${r9.kind}; 2 rows)`, proj9?.body === null && proj9?.retryable === false && r9.kind === 'confirmed' && rows(A).length === 2);
  }

  // ================================================================ the real page: Calendar / Past Activity (shared entry point)
  (global as any).fetch = dev.fetch; (window as any).fetch = dev.fetch;
  (global as any).requestAnimationFrame = (f: any) => setTimeout(f, 0); (global as any).cancelAnimationFrame = (id: any) => clearTimeout(id);
  (window as any).confirm = () => true; (window as any).alert = () => {};
  for (const k of ['HTMLElement', 'HTMLInputElement', 'HTMLButtonElement', 'HTMLDivElement', 'Node', 'Element', 'FocusEvent']) if ((window as any)[k] && !(global as any)[k]) (global as any)[k] = (window as any)[k];
  closeAllTabs();
  const pageAcct = require('../apps/web/lib/accountSession');
  const pageQ = require('../apps/web/lib/offlineHabitQueue');
  const pageSync = require('../apps/web/lib/activitySync');
  const realSubmit = pageSync.submitActivityLog;
  const realReadOps = pageQ.readActivityOperations;
  const Page = require('../apps/web/app/page').default;
  const settle = async (k = 30) => { for (let i = 0; i < k; i++) await flush(); };
  const text = () => (document.body.textContent ?? '').replace(/\s+/g, ' ');
  const UNVERIFIED = "Couldn't verify whether this activity was saved.";
  /** 'original': like the reviewer's probe, EVERY acknowledgement for the first request id stays unreadable (replay included) until 'off'. */
  let ackHtml: 'off' | 'original' = 'off';
  let ackId: string | null = null;
  const pagePosts: any[] = [];
  (global as any).fetch = (window as any).fetch = async (input: any, init: any = {}) => {
    const isPost = String(init.method ?? 'GET').toUpperCase() === 'POST' && String(input).endsWith(route);
    if (isPost) pagePosts.push(JSON.parse(String(init.body)));
    const res = await dev.fetch(input, init);
    if (ackHtml === 'original' && isPost) {
      const crid = pagePosts[pagePosts.length - 1].clientRequestId;
      if (ackId === null) ackId = crid;
      if (crid === ackId) return new Response('<html>Unverified acknowledgement</html>', { status: 200, headers: { 'content-type': 'text/html' } });
    }
    return res;
  };
  async function page(opts: { keepStore?: boolean } = {}) {
    if (!opts.keepStore) { resetStore(); storage.clear(); await pageQ.__resetQueueDbForTests(); await clearQueueDb(); pagePosts.length = 0; }
    pageAcct.__resetAccountSessionForTests(`page-${seq++}`);
    dev.signIn(A);
    window.history.replaceState(null, '', '/?tab=activity');
    const h = await mount(React.createElement(Page));
    await settle();
    const buttons = () => [...document.querySelectorAll('button')] as HTMLButtonElement[];
    const byText = (t: string | RegExp) => buttons().find((b) => (typeof t === 'string' ? (b.textContent ?? '').trim() === t : t.test((b.textContent ?? '').trim())));
    const press = async (t: string | RegExp) => { const b = byText(t); if (!b) return false; await act(async () => { await click(b); }); await settle(6); return true; };
    const fillAndSave = async (title: string) => {
      const t = document.querySelector('#quick-log-activity') as HTMLInputElement | null; if (!t) return false;
      await typeInto(t, title);
      const time = document.querySelector('input[type="time"]') as HTMLInputElement | null; if (time) await typeInto(time, '10:00');
      await settle(4);
      return press(/^Save "/);
    };
    return { h, byText, press, fillAndSave };
  }
  const ids = () => [...new Set(rows(A).map((l: any) => l.clientRequestId))];
  const RealDate = Date;
  const clockOffset = new RealDate(2026, 10, 27, 15, 0, 0).getTime() - RealDate.now();
  class FixedDayDate extends RealDate {
    constructor(...a: any[]) { if (a.length === 0) super(RealDate.now() + clockOffset); else super(...(a as [any])); }
    static now() { return RealDate.now() + clockOffset; }
  }
  (global as any).Date = (window as any).Date = FixedDayDate;
  /** The reviewer's schedule: the real Calendar write commits, its acknowledgement is unreadable; then a restart. */
  async function committedThenRestart(mode: 'normal' | 'held' | 'null-marker' | 'conflict', opts: { negative?: boolean } = {}) {
    if (opts.negative) pageSync.submitActivityLog = (p: any, t: any, f: any, b: any, o: any = {}) => { const { newOperation: _drop, ...rest } = o; return realSubmit(p, t, f, b, rest); };
    try {
      let P = await page();
      await P.press('+ Log Activity');
      ackHtml = 'original'; ackId = null;
      await P.fillAndSave('Review exact original');
      await settle();
      const original = ids()[0];
      const unresolvedFirst = text().includes(UNVERIFIED);
      await P.press('Cancel');
      if (mode === 'null-marker') { const s = { q: pageQ } as any; await putDecision(s, markerOf(s, original, { payload: null })); }
      if (mode === 'conflict') { const s = { q: pageQ } as any; const rec = (await queueDump()).records[0]; await putDecision(s, markerOf(s, original, { payload: pageQ.canonicalPayload({ ...rec.item, activityTitle: 'Different marker activity' }), receipt: { v: 2, kind: 'accepted', owner: A } })); }
      await P.h.unmount();
      closeAllTabs();
      hold.held = 0;
      if (mode === 'held') hold.on = true;
      P = await page({ keepStore: true });
      const heldReads = hold.held;
      const p0 = pagePosts.length;
      await P.press('+ Log Activity');
      await P.fillAndSave('Review exact original'); // the ordinary identical Save
      await settle();
      const sentNew = pagePosts.slice(p0).some((b) => b.clientRequestId !== original);
      const r = { original: Boolean(original), unresolvedFirst, heldReads, sentNew, rowsAfterSave: rows(A).length, retryOffered: Boolean(P.byText('Retry that entry')), separateOffered: Boolean(P.byText('Save as a separate activity')), conflictNote: text().includes('conflicting copies'), retried: false, afterRetry: { rows: 0, ids: [] as string[], copies: 0 } };
      if (r.retryOffered) {
        ackHtml = 'off';
        r.retried = await P.press('Retry that entry');
        await settle();
        r.afterRetry = { rows: rows(A).length, ids: ids(), copies: (await queueDump()).records.length };
      }
      if (mode === 'held') releaseHeld();
      await settle();
      await P.h.unmount();
      console.log(`PAGE ${mode}${opts.negative ? ' (negative control)' : ''}`, JSON.stringify({ ...r, originalId: original }));
      return { ...r, originalId: original };
    } finally { pageSync.submitActivityLog = realSubmit; ackHtml = 'off'; hold.on = false; releaseHeld(); }
  }
  {
    const normal = await committedThenRestart('normal');
    check('G8 control (startup completed): the identical Calendar re-entry after a restart is withheld with "Retry that entry"; Retry keeps 1 row under the original id', normal.unresolvedFirst && !normal.sentNew && normal.rowsAfterSave === 1 && normal.retryOffered && normal.afterRetry.rows === 1 && normal.afterRetry.ids[0] === normal.originalId);
    const held = await committedThenRestart('held');
    check(`G8 held startup projection (${held.heldReads} read(s) held): the identical Save sends NO new id, 1 row; "Retry that entry" is offered from the claiming transaction's decision and resumes the original id (1 row, 1 id, no copy left)`, held.heldReads > 0 && !held.sentNew && held.rowsAfterSave === 1 && held.retryOffered && held.afterRetry.rows === 1 && held.afterRetry.ids.length === 1 && held.afterRetry.ids[0] === held.originalId && held.afterRetry.copies === 0);
    const neg8 = await committedThenRestart('held', { negative: true });
    check('N8 (page) dropping the new-operation decision from the shared entry point is detected: with the startup projection held, the identical Save sends a NEW id (2 rows)', neg8.heldReads > 0 && neg8.sentNew && neg8.rowsAfterSave === 2);
    const g9 = await committedThenRestart('null-marker');
    check('G9 (page) a null-payload marker beside the live copy: the identical Save is withheld (no new id, 1 row); "Retry that entry" resumes the original id (1 row)', !g9.sentNew && g9.rowsAfterSave === 1 && g9.retryOffered && g9.afterRetry.rows === 1 && g9.afterRetry.ids[0] === g9.originalId);
    const g7 = await committedThenRestart('conflict');
    check('G7 (page) a conflicting marker body beside the live copy: the identical Save is withheld (no new id, 1 row), NO Retry is offered (a deliberate separate entry is), and nothing more was sent', !g7.sentNew && g7.rowsAfterSave === 1 && !g7.retryOffered && g7.separateOffered && rows(A).every((r: any) => r.activityTitle === 'Review exact original'));
  }
  {
    // G7 (page): the shared notice shows the operation's own title, offers no Retry, explains why
    await fresh();
    const s = await tab(CUR);
    dev.fault('POST', route, 'network-before');
    await s.sync.submitActivityLog({ ...body('g7-page'), activityId: 'workout', logSource: 'AURA_DO_NOW' } as any, 't', dev.fetch as any);
    await putDecision(s, markerOf(s, 'g7-page', { payload: canon(s, { ...body('g7-page', 'Different marker activity'), activityId: 'workout', logSource: 'AURA_DO_NOW' }), receipt: { v: 2, kind: 'accepted', owner: A } }));
    closeAllTabs();
    const P = await page({ keepStore: true });
    const item = document.querySelector('[data-operation-id="g7-page"]');
    const shown = (item?.textContent ?? '').replace(/\s+/g, ' ');
    const retry = item ? [...item.querySelectorAll('button')].some((b) => (b.textContent ?? '').trim() === 'Retry') : true;
    await P.h.unmount();
    check(`G7 (page) the shared recovery notice shows the operation's own activity ("${shown.slice(0, 60)}"), never the marker's, and offers Check again but NO Retry (conflicting copies are never sent)`, shown.startsWith('Workout') && !shown.includes('Different marker activity') && !retry && shown.includes('conflicting copies'));
  }
  {
    // G8 stale-read fencing: a projection read computed BEFORE the user's recovery and delivered AFTER it never
    // regresses the operation (it was confirmed meanwhile)
    let P = await page();
    await P.press('+ Log Activity');
    ackHtml = 'original'; ackId = null;
    await P.fillAndSave('Review exact original');
    await settle();
    const original = ids()[0];
    await P.press('Cancel');
    { const s = { q: pageQ } as any; const rec = (await queueDump()).records[0]; await putDecision(s, markerOf(s, original, { payload: pageQ.canonicalPayload(rec.item) })); } // proofless: the snapshot says "unresolved"
    await P.h.unmount();
    closeAllTabs();
    let releaseStale!: () => void;
    const gate = new Promise<void>((r) => { releaseStale = r; });
    let staleReads = 0;
    pageQ.readActivityOperations = async (owner: string) => { const snapshot = await realReadOps(owner); if (staleReads++ === 0) await gate; return snapshot; }; // the FIRST read's snapshot arrives late
    try {
      P = await page({ keepStore: true });
      await P.press('+ Log Activity');
      await P.fillAndSave('Review exact original');
      await settle();
      const offered = Boolean(P.byText('Retry that entry'));
      ackHtml = 'off';
      await P.press('Retry that entry');
      await settle();
      const confirmedRows = rows(A).length;
      await P.press('Cancel');
      releaseStale(); // the stale "unresolved" snapshot is delivered now
      await settle();
      const notice = document.querySelector(`[data-operation-id="${original}"]`);
      check(`G8 stale-read fencing: a projection snapshot taken before the recovery and delivered after it does not resurrect the confirmed operation (Retry offered ${offered}; ${confirmedRows} row; no unresolved notice for it afterwards)`, offered && confirmedRows === 1 && !notice);
      await P.h.unmount();
    } finally { pageQ.readActivityOperations = realReadOps; }
  }
  (global as any).Date = (window as any).Date = RealDate;

  // ================================================================ one decision, no component-specific interpretation (source)
  {
    const q = src('offlineHabitQueue.ts');
    const consumers = { projection: /export async function readRecoveryDecision[\s\S]*?decideOperations\(st, owner, q\)/.test(q) && /export async function readActivityOperations[\s\S]*?readRecoveryDecision\(owner\)/.test(q), newOperation: /if \(newOperation\) \{\n\s+const open = openFor\(\(await decideOperations\(st, owner, q\)\)/.test(q), retryAndReplay: /const decided = \(await decideOperations\(st, owner, q, crid\)\)\.get\(crid\);/.test(q) };
    const ui = ['app/page.tsx', 'components/HomeDashboard.tsx', 'components/Timeline.tsx', 'components/PastActivityModal.tsx', 'components/CalendarViewSection.tsx'].map((f) => fs.readFileSync(path.join(WEB, f), 'utf8')).join('\n');
    const noUiInterpretation = !/decisionAuthority|validReceipt|tombstones|decisionKey\(/.test(ui);
    const oneMatcher = /matchesActivityIntent\(op\.intents, next\)/.test(q) && /matchesActivityIntent\(intentsOf\(op\), next\)/.test(src('pendingReplayReconciliation.ts'));
    check(`one recovery decision: decideOperations feeds the projection (${consumers.projection}), the new-operation gate (${consumers.newOperation}) and the Retry/replay gate (${consumers.retryAndReplay}); one activity-match rule for memory and storage (${oneMatcher}); no surface interprets markers or receipts (${noUiInterpretation})`, consumers.projection && consumers.newOperation && consumers.retryAndReplay && oneMatcher && noUiInterpretation);
  }
  finish();
}
main().catch((e) => { console.error(e); process.exit(1); });
