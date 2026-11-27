/**
 * AURA-ANDROID-REL-04 R15 (ticket 39257; architecture 39256 option B; verification 39255 NO-GO: G1-G3) --
 * the SHARED OPERATION CONTRACT, exercised through the real client modules, the real habit-logs route and the
 * harness's persistence double (the disposable-PostgreSQL + production-build + two-real-Chromium-tab acceptance is
 * test/rel04ActivityOperationHomeChromiumDb.test.ts).
 *
 *   W   the original 39255 witnesses, each run on the UNCHANGED R14 implementation (6c69d7d, vendored in
 *       test/fixtures/rel04-r14-head and checked against git) -- the negative control -- and on R15
 *   B   direct AND replay reject every non-authoritative success (HTML 200, malformed / empty JSON, redirect, wrong
 *       account / request / intent, missing record id); a later authentic same-id reconciliation gives ONE row
 *   C   contradictory, incomplete and proofless legacy markers establish neither success nor cleanup
 *   D   a valid matching receipt establishes success (no POST)
 *   E   same-id recovery after a genuine server commit converges on one row (replay, Retry, Check again)
 *   F   two legitimate separate operations with identical payloads -> two ids, two rows
 *   G   a same-title unrelated record never releases an unresolved operation (Check again, merge, Home)
 *   H   failed identity recovery blocks unsafe dispatch (no id is generated; Retry of an unknown id is refused)
 *   I   replacement, account switching and sign-out keep ownership and exact-representation guarantees
 *   J   F2 opaque-storage preservation and F3 final-verification reporting are unchanged
 *   N   negative controls: each protection is removed in a compiled copy of the current code and the matching check
 *       must FAIL there (bypass direct / replay validation, trust the marker key, remove by request id alone, a fresh
 *       id for an unresolved operation, release by list absence / title, opacity as absence, no final verification)
 *
 *   TS_NODE_COMPILER_OPTIONS='{"jsx":"react-jsx"}' npx ts-node --project tsconfig.jsdom-tests.json test/rel04ActivityOperationContract.test.ts
 */
import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { React, mount, flush, act, click } from './jsdomReactHarness';
import { Device, WEB, addUser, check, clearQueueDb, closeAllTabs, finish, idbFault, logsOf, openTab, payload, queueDump, resetStore, storage, store } from './rel04AccountIsolationHarness';

const ts = require(require.resolve('typescript', { paths: [WEB] }));
const Module = require('module');
const fidb = require(require.resolve('fake-indexeddb', { paths: [WEB] }));
const FX = path.join(__dirname, 'fixtures', 'rel04-r14-head');
const fx = (n: string) => fs.readFileSync(path.join(FX, n), 'utf8');
const src = (n: string) => fs.readFileSync(path.join(WEB, 'lib', n), 'utf8');
const R14_HEAD = '6c69d7d9089566b44b7a24ff0725add754cb7dbd';
const gitHas = (c: string) => { try { execFileSync('git', ['cat-file', '-e', `${c}^{commit}`], { stdio: 'ignore' }); return true; } catch { return false; } };

(function provenance() {
  if (!gitHas(R14_HEAD)) { console.log(`SKIP fixture re-check: ${R14_HEAD.slice(0, 7)} not in this checkout (shallow clone); fixtures used as vendored`); return; }
  for (const f of ['offlineHabitQueue', 'activitySync', 'habitLogSyncPolicy', 'signOut', 'pendingReplayReconciliation']) {
    check(`fixture rel04-r14-head/${f}.ts.txt == ${R14_HEAD.slice(0, 7)} apps/web/lib/${f}.ts`, execFileSync('git', ['show', `${R14_HEAD}:apps/web/lib/${f}.ts`], { encoding: 'utf8', maxBuffer: 1 << 26 }) === fx(`${f}.ts.txt`));
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
/** Applies exact source patches; a patch that does not apply is a test defect (never a silent no-op). */
function patched(source: string, edits: Array<[string, string]>): string {
  let s = source;
  for (const [a, b] of edits) { if (!s.includes(a)) throw new Error(`negative-control patch does not apply: ${a.slice(0, 90)}`); s = s.split(a).join(b); }
  return s;
}
const lib = (n: string) => path.join(WEB, 'lib', n);
let seq = 0;
const A = 'r15-account-a', B = 'r15-account-b';
addUser(A, 'r15a@example.invalid'); addUser(B, 'r15b@example.invalid');
const route = '/api/habit-logs';
const body = (id: string, title = 'reviewed activity') => payload(title, id);
const item = (id: string, owner = A, title?: string) => ({ ...body(id, title), ownerUserId: owner, tempId: 'tmp' });
const row = (recordId: string, id: string, owner = A, title?: string) => ({ recordId, ownerUserId: owner, clientRequestId: id, item: item(id, owner, title), fmt: 'r8', queuedAt: 1 });
const rows = (owner: string, crid?: string) => logsOf(owner).filter((l: any) => crid === undefined || l.clientRequestId === crid);
const realNow = Date.now;
const afterClaimExpiry = () => { const t0 = realNow(); Date.now = () => t0 + 61_000; };
async function fresh() { Date.now = realNow; resetStore(); storage.clear(); storage.fail = { get: false, set: false, remove: false }; idbFault.open = false; idbFault.read = false; idbFault.write = false; closeAllTabs(); await clearQueueDb(); }

type Stack = { q: any; sync: any; acct: any; so: any };
type Impl = { name: string; tab: (id: string) => Stack };
const CUR: Impl = { name: 'R15', tab: (id) => { const t = openTab(id); return { q: t.q, sync: t.sync, acct: t.acct, so: t.so }; } };
/** A compiled stack from (possibly patched) sources -- the R14 fixtures, or the current code with a protection removed. */
function stackOf(name: string, sources: { q: string; sync: string; policy: string; so: string }): Impl {
  return {
    name,
    tab: (id) => {
      const t = openTab(id);
      const policy = compile(sources.policy, lib(`habitLogSyncPolicy.${name}.${seq++}.js`));
      const q = compile(sources.q, lib(`offlineHabitQueue.${name}.${seq++}.js`), { './habitLogSyncPolicy': policy });
      const sync = compile(sources.sync, lib(`activitySync.${name}.${seq++}.js`), { './offlineHabitQueue': q, './habitLogSyncPolicy': policy });
      const so = compile(sources.so, lib(`signOut.${name}.${seq++}.js`), { './offlineHabitQueue': q });
      return { q, sync, acct: t.acct, so };
    },
  };
}
const R14 = stackOf('R14', { q: fx('offlineHabitQueue.ts.txt'), sync: fx('activitySync.ts.txt'), policy: fx('habitLogSyncPolicy.ts.txt'), so: fx('signOut.ts.txt') });
const current = { q: src('offlineHabitQueue.ts'), sync: src('activitySync.ts'), policy: src('habitLogSyncPolicy.ts'), so: src('signOut.ts') };
const mutant = (name: string, part: keyof typeof current, edits: Array<[string, string]>) => stackOf(name, { ...current, [part]: patched(current[part], edits) });

const dev = new Device();
dev.extra['/api/plans'] = () => [];
dev.extra['/api/habits'] = () => [];
let n = 0;
async function tab(impl: Impl, owner = A) { dev.signIn(owner); const s = impl.tab(`${impl.name}-${owner}-${n++}`); await s.acct.fetchVerifiedSession(dev.fetch as any); return s; }
async function put(s: Stack, r: any) { const db: IDBDatabase = await s.q.__openQueueDbForTests(); const t = db.transaction('records', 'readwrite'); t.objectStore('records').put(r); await new Promise<void>((ok, err) => { t.oncomplete = () => ok(); t.onabort = () => err(t.error); }); }
async function putDecision(s: Stack, d: Record<string, unknown>) { const db: IDBDatabase = await s.q.__openQueueDbForTests(); const t = db.transaction('tombstones', 'readwrite'); t.objectStore('tombstones').put(d); await new Promise<void>((ok) => { t.oncomplete = () => ok(); }); }
const decisionsOf = async (crid: string) => (await queueDump()).tombstones.filter((d: any) => d.clientRequestId === crid || String(d.recordId).endsWith(`\u0000${crid}`));
const acceptedMarkers = async (crid: string) => (await decisionsOf(crid)).filter((d: any) => d.serverOutcome === 'accepted').length;
const copies = async (crid: string) => (await queueDump()).records.filter((r: any) => r.clientRequestId === crid).length;
const posts = () => dev.count('POST', route);
/** R16: the complete persisted row the route returns for body(id) (identity + every persisted-intent field). */
const fullRow = (id: string, owner = A, title = 'reviewed activity', extra: Record<string, unknown> = {}) => ({ id: 'srv-1', userId: owner, clientRequestId: id, activityTitle: title, activityId: null, activeWindow: 'NEUTRAL', logMinuteOfDay: 0, logTimestamp: '2026-11-24T06:00:00.000Z', durationMinutes: 30, notes: null, logSource: 'MANUAL', activitySignificance: 'MEDIUM', ...extra });
const acceptedMarker = (s: Stack, id: string, row: unknown, payloadOverride?: string) => { const pl = s.q.canonicalPayload(item(id)); return { recordId: s.q.decisionKey(A, id), ownerUserId: A, clientRequestId: id, payload: pl, decision: 'settled', serverOutcome: 'accepted', at: 1, fmt: 'r8', possiblySent: true, receipt: { v: 2, kind: 'accepted', owner: A, crid: id, payload: payloadOverride ?? pl, serverRecordId: 'srv-1', row, at: 1 } }; };

// ---- answers that are NOT authoritative evidence of this operation (the route is never reached)
type Fake = 'html200' | 'malformed-json' | 'empty-json' | 'wrong-account' | 'wrong-request' | 'wrong-intent' | 'missing-record-id' | 'redirect';
const FAKES: Fake[] = ['html200', 'malformed-json', 'empty-json', 'wrong-account', 'wrong-request', 'wrong-intent', 'missing-record-id', 'redirect'];
function fakingFetch(mode: Fake, count = { n: 0 }): typeof fetch {
  return (async (input: any, init: any = {}) => {
    if (String(init.method ?? 'GET').toUpperCase() !== 'POST' || !String(input).endsWith(route)) return dev.fetch(input, init);
    count.n++;
    const b = JSON.parse(String(init.body));
    const persisted = { id: `fake-${seq++}`, userId: A, clientRequestId: b.clientRequestId, activityTitle: b.activityTitle, activityId: null, activeWindow: 'NEUTRAL', logMinuteOfDay: 0, logTimestamp: b.logTimestamp, durationMinutes: b.durationMinutes ?? 30, notes: null, logSource: b.logSource, activitySignificance: b.activitySignificance };
    const json = (v: unknown) => new Response(JSON.stringify(v), { status: 200, headers: { 'content-type': 'application/json' } });
    switch (mode) {
      case 'html200': return new Response('<html>Wi-Fi sign-in</html>', { status: 200, headers: { 'content-type': 'text/html' } });
      case 'malformed-json': return new Response('{"id": "half', { status: 200, headers: { 'content-type': 'application/json' } });
      case 'empty-json': return new Response('', { status: 200, headers: { 'content-type': 'application/json' } });
      case 'wrong-account': return json({ ...persisted, userId: B });
      case 'wrong-request': return json({ ...persisted, clientRequestId: 'some-other-request' });
      case 'wrong-intent': return json({ ...persisted, activityTitle: 'a different activity' });
      case 'missing-record-id': return json({ ...persisted, id: '' });
      case 'redirect':
        // fetch(..., { redirect: 'error' }) rejects a redirect; a caller without it would see the redirected page.
        if (init.redirect === 'error') throw new TypeError('Failed to fetch: redirect');
        return Object.defineProperty(new Response('<html>login</html>', { status: 200, headers: { 'content-type': 'text/html' } }), 'redirected', { value: true });
    }
  }) as any;
}

/** The authoritative evidence state of one operation after a non-authoritative answer. */
async function evidence(crid: string) { return { accepted: await acceptedMarkers(crid), copies: await copies(crid), rows: rows(A, crid).length }; }

async function main() {
  // ================================================================ W: the original 39255 witnesses (R14 vs R15)
  for (const mode of ['direct', 'replay'] as const) {
    const out: Record<string, any> = {};
    for (const impl of [R14, CUR]) {
      await fresh();
      const s = await tab(impl);
      dev.fault('POST', route, 'html200');
      let result: any;
      if (mode === 'direct') result = await s.sync.submitActivityLog(body('fake-200'), 'tmp', dev.fetch as any);
      else { await put(s, row('http-fallback-record', 'fake-200')); result = await s.sync.replayOfflineQueue(dev.fetch as any); }
      const ev = await evidence('fake-200');
      const again = await s.sync.submitActivityLog(body('fake-200'), 'tmp', dev.fetch as any); // authentic same-id resubmission
      out[impl.name] = { result: mode === 'direct' ? result.kind : { confirmed: result.confirmed, removed: result.removed, unverified: result.unverified ?? 0 }, ...ev, again: again.kind, rowsAfter: rows(A, 'fake-200').length };
    }
    console.log(`G1-${mode}`, JSON.stringify(out));
    const r14 = out.R14, r15 = out.R15;
    if (mode === 'direct') {
      check('W G1 direct -- R14 (negative control) reproduces: HTML 200 -> confirmed + durable accepted marker + copy removed with ZERO server rows; resubmission -> already-recorded', r14.result === 'confirmed' && r14.accepted === 1 && r14.copies === 0 && r14.rows === 0 && r14.again === 'already-recorded' && r14.rowsAfter === 0);
      check('W G1 direct -- R15: HTML 200 -> unresolved (outcome-unknown), no accepted receipt, the copy KEPT; the authentic same-id resubmission is confirmed with exactly 1 row', r15.result === 'outcome-unknown' && r15.accepted === 0 && r15.copies === 1 && r15.rows === 0 && r15.again === 'confirmed' && r15.rowsAfter === 1);
    } else {
      check('W G1 replay -- R14 (negative control) reproduces: HTML 200 -> confirmed=1 removed=1 + accepted marker with ZERO server rows; resubmission -> already-recorded', r14.result.confirmed === 1 && r14.result.removed === 1 && r14.accepted === 1 && r14.rows === 0 && r14.again === 'already-recorded' && r14.rowsAfter === 0);
      check('W G1 replay -- R15: HTML 200 -> unverified=1, nothing settled, the copy KEPT; the authentic same-id resubmission is confirmed with exactly 1 row', r15.result.confirmed === 0 && r15.result.removed === 0 && r15.result.unverified === 1 && r15.accepted === 0 && r15.copies === 1 && r15.again === 'confirmed' && r15.rowsAfter === 1);
    }
  }
  for (const marker of ['wrong-owner', 'missing-payload', 'wrong-request'] as const) {
    const out: Record<string, any> = {};
    for (const impl of [R14, CUR]) {
      await fresh();
      const s = await tab(impl);
      const id = 'decision-id';
      await putDecision(s, { recordId: s.q.decisionKey(A, id), ownerUserId: marker === 'wrong-owner' ? B : A, clientRequestId: marker === 'wrong-request' ? 'other-request' : id, payload: marker === 'missing-payload' ? null : s.q.canonicalPayload(item(id)), decision: 'settled', serverOutcome: 'accepted', at: Date.now(), fmt: 'r8' });
      const p0 = posts();
      const r = await s.sync.submitActivityLog(body(id), 'tmp', dev.fetch as any);
      out[impl.name] = { result: r.kind, posts: posts() - p0, rowsA: rows(A).length, rowsB: rows(B).length };
    }
    console.log(`G2-${marker}`, JSON.stringify(out));
    check(`W G2 ${marker} -- R14 (negative control) reproduces: the marker key alone yields already-recorded, 0 POSTs, 0 rows for A or B`, out.R14.result === 'already-recorded' && out.R14.posts === 0 && out.R14.rowsA === 0 && out.R14.rowsB === 0);
    check(`W G2 ${marker} -- R15: no success authority -> unresolved (outcome-unknown), nothing sent automatically, 0 rows`, out.R15.result === 'outcome-unknown' && out.R15.posts === 0 && out.R15.rowsA === 0 && out.R15.rowsB === 0);
  }

  // ================================================================ B: one decoder, both send paths, every fake
  for (const mode of FAKES) {
    for (const path_ of ['direct', 'replay'] as const) {
      await fresh();
      const s = await tab(CUR);
      const crid = `b-${mode}-${path_}`;
      const fake = fakingFetch(mode);
      let result: any;
      if (path_ === 'direct') result = await s.sync.submitActivityLog(body(crid), 'tmp', fake);
      else { await put(s, row(`rec-${crid}`, crid)); result = await s.sync.replayOfflineQueue(fake); }
      const ev = await evidence(crid);
      const ops = await s.q.readActivityOperations(A);
      const op = ops?.find((o: any) => o.clientRequestId === crid);
      // Later authentic same-id reconciliation (replay past the claim lifetime).
      afterClaimExpiry();
      const later = await s.sync.replayOfflineQueue(dev.fetch as any);
      Date.now = realNow;
      const final = { rows: rows(A, crid).length, receipt: (await decisionsOf(crid)).filter((d: any) => d.receipt?.kind === 'accepted' && d.receipt.serverRecordId === rows(A, crid)[0]?.id).length };
      const firstOk = path_ === 'direct'
        ? (mode === 'redirect' ? result.kind === 'queued' : result.kind === 'outcome-unknown')
        : result.confirmed === 0 && result.removed === 0;
      check(`B ${path_} ${mode}: no accepted receipt, no destructive settlement, no false success (${path_ === 'direct' ? result.kind : JSON.stringify({ c: result.confirmed, u: result.unverified })}); copy kept, operation ${op?.status}; the later authentic same-id replay -> 1 row with its validated receipt`,
        firstOk && ev.accepted === 0 && ev.copies === 1 && ev.rows === 0 && op?.status === 'pending' && later.confirmed === 1 && final.rows === 1 && final.receipt === 1);
    }
  }
  {
    // B: a route refusal is a definitive failure only when it is the route's own JSON answer.
    await fresh();
    const s = await tab(CUR);
    const html404 = (async (i: any, init: any = {}) => (String(init.method ?? 'GET').toUpperCase() === 'POST' ? new Response('<html>not found</html>', { status: 404, headers: { 'content-type': 'text/html' } }) : dev.fetch(i, init))) as any;
    const r1 = await s.sync.submitActivityLog(body('html-404'), 'tmp', html404);
    const r2 = await s.sync.submitActivityLog({ ...body('json-400'), activityId: 'no-such-catalog-activity' } as any, 'tmp', dev.fetch as any);
    const r3 = await s.sync.submitActivityLog({ ...body('bad-ts'), logTimestamp: 'not-a-date' } as any, 'tmp', dev.fetch as any);
    const r3d = (await decisionsOf('bad-ts'))[0];
    check('B a non-route 4xx (HTML 404) is NOT a definitive failure: unresolved, copy kept', r1.kind === 'outcome-unknown' && (await copies('html-404')) === 1);
    // R16 (39258 G5): a refusal is definitive ONLY when the route's deterministic validation of THIS body says so and the
    // client re-derives the same failure from its own request; "Unknown activity" cannot be re-derived -> unresolved.
    check('B R16: the route\'s 400 "Unknown activity" is NOT definitive (unresolved; copy kept, no rejected receipt)', r2.kind === 'outcome-unknown' && (await copies('json-400')) === 1 && !(await decisionsOf('json-400')).some((d: any) => d.receipt));
    check('B R16: the route\'s 400 "logTimestamp must be a valid date." for a body whose timestamp IS invalid is the definitive failure, with a v2 rejected receipt naming its reason', r3.kind === 'rejected' && r3.status === 400 && r3d?.receipt?.v === 2 && r3d.receipt.kind === 'rejected' && r3d.receipt.reason === 'invalid-timestamp');
  }

  // ================================================================ C/D: marker authority
  {
    const markerCases: Array<[string, (s: Stack, id: string) => Record<string, unknown>, string]> = [
      ['proofless legacy accepted marker (correct key, value and payload; no receipt)', (s, id) => ({ recordId: s.q.decisionKey(A, id), ownerUserId: A, clientRequestId: id, payload: s.q.canonicalPayload(item(id)), decision: 'settled', serverOutcome: 'accepted', at: 1, fmt: 'r8' }), 'outcome-unknown'],
      ['receipt naming another server account', (s, id) => acceptedMarker(s, id, fullRow(id, B)), 'outcome-unknown'],
      ['receipt bound to another payload', (s, id) => acceptedMarker(s, id, fullRow(id), s.q.canonicalPayload(item(id)) + 'x'), 'outcome-unknown'],
      ['rejection after a possible earlier send', (s, id) => { const pl = s.q.canonicalPayload(item(id)); return { recordId: s.q.decisionKey(A, id), ownerUserId: A, clientRequestId: id, payload: pl, decision: 'settled', serverOutcome: 'rejected', at: 1, fmt: 'r8', receipt: { v: 2, kind: 'rejected', owner: A, crid: id, payload: pl, status: 400, reason: 'missing-title', afterPossibleSend: true, at: 1 } }; }, 'outcome-unknown'],
      ['VALID matching accepted receipt (D)', (s, id) => acceptedMarker(s, id, fullRow(id)), 'already-recorded'],
      ['valid discard fence with a DAMAGED (null) payload', (s, id) => ({ recordId: s.q.decisionKey(A, id), ownerUserId: A, clientRequestId: id, payload: null, decision: 'discarded', at: 1, fmt: 'r8', possiblySent: true }), 'not-stored:discarded'],
    ];
    for (const [label, mk, expect] of markerCases) {
      await fresh();
      const s = await tab(CUR);
      const id = 'marker-id';
      await putDecision(s, mk(s, id));
      await put(s, row('live-copy-beside-marker', id)); // a copy beside the marker: NO cleanup authority for a marker that proves nothing
      const p0 = posts();
      const r = await s.sync.submitActivityLog(body(id), 'tmp', dev.fetch as any);
      const rp = await s.sync.replayOfflineQueue(dev.fetch as any);
      const got = r.kind === 'not-stored' && r.reason ? `not-stored:${r.reason}` : r.kind;
      const op = (await s.q.readActivityOperations(A))?.find((o: any) => o.clientRequestId === id);
      const success = expect === 'already-recorded';
      check(`${success ? 'D' : 'C'} ${label} -> ${expect}; ${posts() - p0} POSTs, ${rows(A).length} rows; the copy beside it ${success ? 'is outside the operation' : 'is preserved (no cleanup authority)'}; operation ${op?.status}`,
        got === expect && posts() === p0 && rows(A).length === 0 && rp.attempted === 0 && (success || (await copies(id)) === 1) && op?.status === (success ? 'confirmed' : expect.startsWith('not-stored') ? 'discarded' : 'unresolved') && (!success || r.serverLog?.id === 'srv-1'));
    }
    {
      // C: Check again on a proofless marker: GET absence is inconclusive (stays unresolved); a matching server row upgrades it.
      await fresh();
      const s = await tab(CUR);
      const id = 'legacy-upgrade';
      await putDecision(s, { recordId: s.q.decisionKey(A, id), ownerUserId: A, clientRequestId: id, payload: s.q.canonicalPayload(item(id)), decision: 'settled', serverOutcome: 'accepted', at: 1, fmt: 'r8' });
      const op = { account: A, clientRequestId: id, body: body(id) };
      const before = await s.sync.checkActivityOperation(op, dev.fetch as any);
      const retry = await s.sync.submitActivityLog(body(id), 'tmp', dev.fetch as any, undefined, { explicitRetry: true }); // the user's Retry: same id, same body
      const after = await s.sync.checkActivityOperation(op, dev.fetch as any);
      const d = (await decisionsOf(id))[0];
      check('C Check again on a proofless marker with NO server row -> still unresolved (absence is not evidence); the user\'s same-operation Retry sends the same id once -> confirmed, 1 row; the marker is upgraded to a valid receipt', before.kind === 'outcome-unknown' && retry.kind === 'confirmed' && rows(A, id).length === 1 && after.kind === 'already-recorded' && d?.receipt?.kind === 'accepted' && d.receipt.serverRecordId === rows(A, id)[0].id);
      const pre = rows(A).length;
      const auto = await s.sync.replayOfflineQueue(dev.fetch as any);
      check('C a marker that proves nothing is NEVER sent automatically (replay pauses it; only explicit Retry may)', auto.attempted === 0 && rows(A).length === pre);
    }
  }

  // ================================================================ E: same-id recovery after a genuine commit
  {
    for (const fault of ['network-after', 'process-then-500'] as const) {
      await fresh();
      const s = await tab(CUR);
      const id = `commit-${fault}`;
      dev.fault('POST', route, fault);
      const r1 = await s.sync.submitActivityLog(body(id), 'tmp', dev.fetch as any);
      const committed = rows(A, id).length;
      const op = { account: A, clientRequestId: id, body: body(id) };
      const ca = await s.sync.checkActivityOperation(op, dev.fetch as any, undefined, { dispatched: true });
      const retry = await s.sync.submitActivityLog(body(id), 'tmp', dev.fetch as any, undefined, { explicitRetry: true });
      afterClaimExpiry();
      const rp = await s.sync.replayOfflineQueue(dev.fetch as any);
      Date.now = realNow;
      const final = await s.sync.submitActivityLog(body(id), 'tmp', dev.fetch as any);
      check(`E ${fault}: the route committed but the answer was lost -> queued (same id kept); Check again -> pending (${ca.kind}); Retry/replay converge on ONE row (${committed}->${rows(A, id).length}); afterwards already-recorded`, r1.kind === 'queued' && committed === 1 && ca.kind === 'queued' && (retry.kind === 'queued' || retry.kind === 'confirmed') && rows(A, id).length === 1 && final.kind === 'already-recorded' && rp.removeFailed === 0);
    }
  }

  // ================================================================ F: separate intentional operations
  {
    await fresh();
    const s = await tab(CUR);
    const r1 = await s.sync.submitActivityLog(body('op-one', 'Workout'), 'tmp', dev.fetch as any);
    const r2 = await s.sync.submitActivityLog(body('op-two', 'Workout'), 'tmp', dev.fetch as any);
    check('F two explicit operations with IDENTICAL payloads (different ids) -> two confirmations, two rows, two ids (never deduplicated by payload)', r1.kind === 'confirmed' && r2.kind === 'confirmed' && rows(A).length === 2 && new Set(rows(A).map((l: any) => l.clientRequestId)).size === 2);
  }

  // ================================================================ G: same-title unrelated records never release
  {
    await fresh();
    const s = await tab(CUR);
    await s.sync.submitActivityLog(body('unrelated-earlier', 'Workout'), 'tmp', dev.fetch as any); // a real row, same title
    const id = 'unresolved-same-title';
    await putDecision(s, { recordId: s.q.decisionKey(A, id), ownerUserId: A, clientRequestId: id, payload: s.q.canonicalPayload(item(id, A, 'Workout')), decision: 'settled', serverOutcome: 'accepted', at: 1, fmt: 'r8' });
    const ca = await s.sync.checkActivityOperation({ account: A, clientRequestId: id, body: body(id, 'Workout') }, dev.fetch as any);
    check('G Check again with ONLY a same-title row of another operation on the server -> still unresolved (the title row is not evidence)', ca.kind === 'outcome-unknown');
    // the list merge
    const listed = [{ id: rows(A)[0].id, activityTitle: 'Workout', activeWindow: 'NEUTRAL', loggedAt: new Date(), clientRequestId: 'unrelated-earlier' }];
    const pendingRow = { id: 'temp-1', activityTitle: 'Workout', activeWindow: 'NEUTRAL', loggedAt: new Date(), syncStatus: 'pending', clientRequestId: id };
    const ops = new Map([[id, { status: 'unresolved' }]]);
    const merged = s.q.mergeConfirmedLogEntries(listed, [pendingRow], new Set(), ops);
    const r14Merge = compile(fx('offlineHabitQueue.ts.txt'), lib(`offlineHabitQueue.r14merge.${seq++}.js`)).mergeConfirmedLogEntries(listed, [pendingRow], new Set());
    check('G the list merge KEEPS the unresolved operation\'s row although the queue is empty and a same-title row exists (R14 negative control drops it)', merged.some((e: any) => e.clientRequestId === id && e.syncStatus === 'pending') && !r14Merge.some((e: any) => e.clientRequestId === id));
    const R14P = compile(fx('pendingReplayReconciliation.ts.txt'), lib(`pendingReplayReconciliation.r14.${seq++}.js`));
    check('G (negative control) R14\'s title inference reports the same-title server row as "confirmed" for the unresolved operation -- the inference R15 no longer uses to release', R14P.resolvePendingActivityStatus(listed, 'workout') === 'confirmed');
  }

  // ================================================================ H: failed identity recovery blocks unsafe dispatch
  {
    await fresh();
    const s = await tab(CUR);
    idbFault.read = true;
    const p0 = posts();
    const r = await s.sync.submitActivityLog(body('store-unreadable'), 'tmp', dev.fetch as any);
    const ops = await s.q.readActivityOperations(A);
    idbFault.read = false;
    check('H an unreadable store: nothing is sent (storage-unavailable), and the operations read reports UNKNOWN (null), never "none open"', r.kind === 'storage-unavailable' && posts() === p0 && ops === null && (await copies('store-unreadable')) === 0);
  }

  // ================================================================ I: replacement, account switching, sign-out
  {
    // I1 replacement during dispatch: the settlement removes only the copy carrying the claimed identity + payload.
    await fresh();
    const s = await tab(CUR);
    await put(s, row('swap-rec', 'swap'));
    const gate = dev.hold('POST', route, 'after');
    const rp = s.sync.replayOfflineQueue(dev.fetch as any);
    await gate.arrived;
    await put(s, row('swap-rec', 'swap', A, 'edited elsewhere')); // replaced in place: same record + request id, other payload
    gate.release();
    await rp;
    const dump = await queueDump();
    check('I1 a copy replaced during dispatch is preserved (never removed by request id alone); the validated receipt is for the claimed payload only', dump.records.some((r: any) => r.recordId === 'swap-rec' && r.item.activityTitle === 'edited elsewhere') && rows(A, 'swap').length === 1);
    // I2 account switch between dispatch and the answer: the answer is not applied to the new account.
    await fresh();
    const sA = await tab(CUR, A);
    const g2 = dev.hold('POST', route, 'after');
    const pr = sA.sync.submitActivityLog(body('switch'), 'tmp', dev.fetch as any);
    await g2.arrived;
    dev.signIn(B); await sA.acct.fetchVerifiedSession(dev.fetch as any);
    g2.release();
    const r = await pr;
    const leftover = (await queueDump()).records.filter((x: any) => x.clientRequestId === 'switch');
    check(`I2 account switched before the answer arrived (${r.kind}): no stale-account settlement; the copy stays bound to A; nothing attributed to B`, r.kind !== 'confirmed' && rows(B).length === 0 && leftover.every((x: any) => x.ownerUserId === A) && (await acceptedMarkers('switch')) === 0);
    // I3 sign-out discard while a send's answer is outstanding elsewhere is reported as possibly sent; a late accepted
    // answer never overrides the durable discard.
    await fresh();
    const sB = await tab(CUR, A);
    await put(sB, row('late-rec', 'late'));
    const snap = await sB.q.readOwnedQueue(A);
    afterClaimExpiry();
    const g3 = dev.hold('POST', route, 'after');
    const other = await tab(CUR, A);
    afterClaimExpiry();
    const rp3 = other.sync.replayOfflineQueue(dev.fetch as any);
    await g3.arrived;
    Date.now = () => realNow() + 200_000; // the sender's claim is stale for the discard
    const dr = await sB.q.discardOwned(A, snap, { tab: 'signing-out' });
    g3.release();
    await rp3;
    Date.now = realNow;
    const d = (await decisionsOf('late'))[0];
    check(`I3 durable discard during an outstanding send: reported as possibly sent (${JSON.stringify({ removed: dr.removed, removedPossiblySent: dr.removedPossiblySent })}); the late answer never turns the discard into a success`, d?.decision === 'discarded' && dr.removedPossiblySent + dr.cleanupPendingPossiblySent + dr.discardedUnverifiedPossiblySent === 1 && (await sB.sync.submitActivityLog(body('late'), 'tmp', dev.fetch as any)).kind === 'not-stored');
  }

  // ================================================================ J: F2 / F3 (unchanged physical reporting)
  async function discardCase(impl: Impl, setup: (s: Stack) => Promise<void> | void, during?: { removeThrowsOnce?: string }) {
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
    try { return await s.q.discardOwned(A, snap, { tab: 't' }); }
    finally { (storage as any).getItem = origGet; (storage as any).removeItem = origRemove; }
  }
  const opaque = async (s: Stack) => { await put(s, row('known-active', 'opaque-id')); storage.setItem(`offline_habit_queue_v2:${A}`, '[' + JSON.stringify(item('opaque-id'))); };
  const q3removed = (s: Stack) => { storage.setItem(`aura_q3:${A}:removed`, JSON.stringify(item('removed'))); void s; };
  {
    const f2 = await discardCase(CUR, opaque);
    check('J F2 preserved: opaque v2 storage -> discardedUnverified=1 (never removed), unidentified=1, bytes preserved', f2.removed === 0 && f2.discardedUnverified === 1 && f2.unidentified === 1 && storage.data.has(`offline_habit_queue_v2:${A}`));
    const f3 = await discardCase(CUR, q3removed, { removeThrowsOnce: `aura_q3:${A}:removed` });
    check('J F3 preserved: a stale cleanup error never overrides the clean final verification -> removed=1, cleanupErrors=1', f3.removed === 1 && f3.cleanupErrors === 1 && f3.cleanupPending === 0);
  }

  // ================================================================ N: negative controls (each protection removed)
  {
    const bypassDirect = mutant('N-bypass-direct', 'sync', [["const decoded = await __decoder.decode(res, expectationOf(token, lease.account, body), () => lease.isCurrent(), UPGRADE_REQUIRED_CODE);\n    return applyDirectAnswer", "const decoded: any = res !== 'network-error' && res.ok ? { kind: 'accepted', row: { id: 'unchecked', userId: lease.account, clientRequestId: token.crid, activityTitle: '', logTimestamp: '', durationMinutes: 0 } } : await __decoder.decode(res, expectationOf(token, lease.account, body), () => lease.isCurrent(), UPGRADE_REQUIRED_CODE);\n    return applyDirectAnswer"]]);
    await fresh();
    let s = await tab(bypassDirect);
    dev.fault('POST', route, 'html200');
    const r = await s.sync.submitActivityLog(body('n1'), 'tmp', dev.fetch as any);
    const n1 = r.kind === 'outcome-unknown' && (await acceptedMarkers('n1')) === 0;
    check(`N1 bypassing DIRECT response validation is detected (the B/G1-direct check fails: ${r.kind}, accepted markers ${await acceptedMarkers('n1')}, rows ${rows(A, 'n1').length})`, !n1);

    const bypassReplay = mutant('N-bypass-replay', 'sync', [["const decoded = await __decoder.decode(res, expectationOf(token, lease.account, body), () => lease.isCurrent(), UPGRADE_REQUIRED_CODE);\n      if (decoded.kind === 'upgrade')", "const decoded: any = res !== 'network-error' && res.ok ? { kind: 'accepted', row: { id: 'unchecked', userId: lease.account, clientRequestId: token.crid, activityTitle: '', logTimestamp: '', durationMinutes: 0 } } : await __decoder.decode(res, expectationOf(token, lease.account, body), () => lease.isCurrent(), UPGRADE_REQUIRED_CODE);\n      if (decoded.kind === 'upgrade')"]]);
    await fresh();
    s = await tab(bypassReplay);
    await put(s, row('n2-rec', 'n2'));
    dev.fault('POST', route, 'html200');
    const rp = await s.sync.replayOfflineQueue(dev.fetch as any);
    check(`N2 bypassing REPLAY response validation is detected (the B/G1-replay check fails: confirmed ${rp.confirmed}, removed ${rp.removed}, rows ${rows(A, 'n2').length})`, !(rp.confirmed === 0 && rp.removed === 0 && (await copies('n2')) === 1));

    const trustKey = mutant('N-trust-marker-key', 'q', [["  if (value === undefined || value === null) return { kind: 'none' };", "  if (value === undefined || value === null) return { kind: 'none' };\n  if ((value as any).decision === 'settled' && (value as any).serverOutcome === 'accepted') return { kind: 'success', receipt: { v: 1, kind: 'accepted', owner, crid, payload: payload ?? '', serverRecordId: 'trusted', row: { id: 'trusted', userId: owner, clientRequestId: crid, activityTitle: '', logTimestamp: '', durationMinutes: 0 }, at: 0 }, possiblySent: true } as any;"]]);
    await fresh();
    s = await tab(trustKey);
    await putDecision(s, { recordId: s.q.decisionKey(A, 'n3'), ownerUserId: B, clientRequestId: 'n3', payload: s.q.canonicalPayload(item('n3')), decision: 'settled', serverOutcome: 'accepted', at: 1, fmt: 'r8' });
    const r3 = await s.sync.submitActivityLog(body('n3'), 'tmp', dev.fetch as any);
    check(`N3 trusting only the settlement marker KEY is detected (the C/G2 check fails: ${r3.kind} with 0 rows)`, r3.kind !== 'outcome-unknown');

    const byIdOnly = mutant('N-remove-by-request-id', 'q', [["return (await relevantRecords(st, owner)).filter((r) => { const id = recordIdentity(owner, r); return isActive(r) && id.kind === 'valid' && id.crid === crid && canonicalPayload(r.item) === payload; });", "return (await relevantRecords(st, owner)).filter((r) => r.clientRequestId === crid);"]]);
    await fresh();
    s = await tab(byIdOnly);
    await put(s, row('n4-rec', 'n4'));
    const g = dev.hold('POST', route, 'after');
    const rp4 = s.sync.replayOfflineQueue(dev.fetch as any);
    await g.arrived;
    await put(s, row('n4-rec', 'n4', A, 'edited elsewhere'));
    g.release(); await rp4;
    check('N4 removing a stored copy by request id ALONE is detected (the I1 replacement check fails: the replacement is deleted)', !(await queueDump()).records.some((x: any) => x.recordId === 'n4-rec'));

    // N5 a fresh id for an unresolved operation: what the I/A row-count assertions detect.
    await fresh();
    s = await tab(CUR);
    dev.fault('POST', route, 'network-after');
    await s.sync.submitActivityLog(body('n5-original', 'Workout'), 'tmp', dev.fetch as any); // committed, answer lost: unresolved under its id
    const fresh5 = await s.sync.submitActivityLog(body('n5-fresh-replacement', 'Workout'), 'tmp', dev.fetch as any);
    const same5 = rows(A).length;
    check(`N5 generating a FRESH id for an unresolved operation is detected by the one-row assertion (${same5} rows, ${fresh5.kind}); the same-operation Retry keeps it at one`, same5 === 2);

    // N6 release by list absence / title equality: R14's merge and title inference (above, G) -- the merge with no
    // operation projection drops the unresolved row.
    const noOps = s.q.mergeConfirmedLogEntries([], [{ id: 't', activityTitle: 'Workout', activeWindow: 'NEUTRAL', loggedAt: new Date(), syncStatus: 'pending', clientRequestId: 'n6' }], new Set());
    check('N6 releasing an unresolved operation from list absence is detected (without the operation projection the merge drops its row)', noOps.length === 0);

    const opacityAbsent = mutant('N-opacity-as-absence', 'q', [["const unknown = new Set<string>(unattributable ? [...crids].filter((c) => !left.has(c)) : []);", "const unknown = new Set<string>();"]]);
    const n7 = await discardCase(opacityAbsent, opaque);
    check(`N7 treating opaque storage as verified absence is detected (the J F2 check fails: removed=${n7.removed})`, n7.removed === 1);

    const noFinal = mutant('N-no-final-verification', 'q', [["  const remaining = await remainingCopies(owner, new Set(committed.decided.keys()));", "  const remaining = { crids: new Set<string>(), unknown: new Set<string>(), unidentifiedRecordIds: [] as string[], unidentifiedKeys: [] as string[] };"]]);
    const n8 = await discardCase(noFinal, opaque);
    check(`N8 removing the authoritative final cleanup verification is detected (the J F2 check fails: removed=${n8.removed})`, n8.removed === 1);
  }

  // ================================================================ Home (jsdom): Retry keeps the identity; blocked when unreadable
  (global as any).fetch = dev.fetch; (window as any).fetch = dev.fetch;
  (global as any).requestAnimationFrame = (f: any) => setTimeout(f, 0); (global as any).cancelAnimationFrame = (id: any) => clearTimeout(id);
  (window as any).confirm = () => true; (window as any).alert = () => {};
  closeAllTabs();
  const pageAcct = require('../apps/web/lib/accountSession');
  const pageQ = require('../apps/web/lib/offlineHabitQueue');
  const Page = require('../apps/web/app/page').default;
  const settle = async (k = 30) => { for (let i = 0; i < k; i++) await flush(); };
  const textOf = (el: HTMLElement) => (el.textContent ?? '').replace(/\s+/g, ' ');
  async function home(setup?: () => void) {
    Date.now = realNow; resetStore(); storage.clear(); await pageQ.__resetQueueDbForTests(); await clearQueueDb();
    pageAcct.__resetAccountSessionForTests('home');
    dev.signIn(A);
    setup?.();
    const h = await mount(React.createElement(Page));
    await settle();
    const c = h.container as HTMLElement;
    const byText = (t: string) => [...c.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === t) as HTMLButtonElement | undefined;
    const logOnce = async () => { const b = byText('Start now'); if (!b) return false; await act(async () => { await click(b); }); await settle(4); const d = byText('30m'); if (!d) return false; await act(async () => { await click(d); }); await settle(); return true; };
    return { h, c, byText, logOnce };
  }
  {
    // HR: the route commits but the answer is an HTML 200 (unverified) -> Home shows the unresolved state with Check
    // again + Retry (no Start now); Retry resends the SAME id; Check again confirms; exactly one row, one id.
    const { h, c, byText, logOnce } = await home();
    const started = Boolean(byText('Start now'));
    dev.fault('POST', route, 'html200');
    await logOnce();
    const unresolvedShown = textOf(c).includes("Couldn't verify whether this activity was saved.");
    const startHidden = !byText('Start now');
    const retry = byText('Retry');
    if (retry) { await act(async () => { await click(retry); }); await settle(); }
    const logged = /Logged at/.test(textOf(c));
    const ids = [...new Set(rows(A).map((l: any) => l.clientRequestId))];
    await h.unmount();
    console.log('HOME-RETRY', JSON.stringify({ started, unresolvedShown, startHidden, retried: Boolean(retry), logged, rows: rows(A).length, ids: ids.length }));
    check('HR real Home: an unverified answer shows "Couldn\'t verify whether this activity was saved." with Retry (Start now withheld); Retry reuses the ORIGINAL id -> Logged, exactly 1 row and 1 id', started && unresolvedShown && startHidden && Boolean(retry) && logged && rows(A).length === 1 && ids.length === 1);
  }
  {
    // HB: the operations cannot be read at load -> a new operation is BLOCKED (no id, no record, no POST); after the
    // store is readable again, Check again re-reads and logging works normally.
    let failReads = true;
    const os = fidb.IDBObjectStore.prototype.getAll;
    fidb.IDBObjectStore.prototype.getAll = function (...a: any[]) { if (failReads && this.name === 'tombstones') throw new Error('operations read failure (synthetic)'); return os.apply(this, a); };
    const { h, c, byText, logOnce } = await home();
    const p0 = posts();
    const banner = textOf(c).includes('New activity logging is paused on this device');
    await logOnce();
    const blockedUi = textOf(c).includes("Couldn't verify whether this activity was saved.") && posts() === p0;
    failReads = false;
    fidb.IDBObjectStore.prototype.getAll = os;
    const blocked = blockedUi && (await queueDump()).records.length === 0;
    const again = byText('Check again');
    if (again) { await act(async () => { await click(again); }); await settle(); }
    const bannerGone = !textOf(c).includes('New activity logging is paused on this device');
    await h.unmount();
    check(`HB real Home: an unreadable operations store blocks NEW logging (banner ${banner}; no id, no record, no POST); Check again re-reads and lifts the block (${bannerGone})`, banner && blocked && Boolean(again) && bannerGone);
  }
  finish();
}
main().catch((e) => { console.error(e); process.exit(1); });
