/**
 * AURA-ANDROID-REL-04 R18 (ticket 39265; architecture decision 39264 Option B; verification 39262 NO-GO: G8 partial,
 * new G10 and G11) -- the ONLINE-FIRST initial release on ONE authoritative recovery decision.
 *
 *   G10  discovery: a copy whose request identity is contradictory / unattributable still contributes its activity
 *        intent -- it withholds an unsafe new submission, never authorizes a send or a cleanup
 *   G11  outcomes: requestState is a view of the decision; a valid receipt never hides a surviving conflicting copy
 *        (Check again, explicit Retry, settlement and the UI all report the decision's status)
 *   online-first  no automatic dispatch (startup, connectivity, visibility, post-submit); a confirmed pre-dispatch
 *        offline failure stores nothing; an ambiguous send stays unresolved across restart; explicit Retry converges
 *        on one row; Check again is read-only; legacy / retired data is never sent or deleted
 *
 * The G10/G11 witnesses run on the UNCHANGED R17 implementation (ab3c15b, vendored in test/fixtures/rel04-r17-head and
 * checked against git) -- the negative control -- and on R18. A generative matrix runs every combination of stored
 * evidence through every consumer and compares returned outcomes, dispatches, retained copies and UI projection.
 *
 *   TS_NODE_COMPILER_OPTIONS='{"jsx":"react-jsx"}' npx ts-node --project tsconfig.jsdom-tests.json test/rel04R18OnlineFirst.test.ts
 */
import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { React, mount, flush, act, click, typeInto } from './jsdomReactHarness';
import { Device, WEB, addUser, check, clearQueueDb, closeAllTabs, finish, idbFault, logsOf, openTab, payload, queueDump, resetStore, storage } from './rel04AccountIsolationHarness';

const ts = require(require.resolve('typescript', { paths: [WEB] }));
const Module = require('module');
const FX = path.join(__dirname, 'fixtures', 'rel04-r17-head');
const fx = (n: string) => fs.readFileSync(path.join(FX, n), 'utf8');
const src = (n: string) => fs.readFileSync(path.join(WEB, 'lib', n), 'utf8');
const R17_HEAD = 'ab3c15b3abc988d2d50b2b4d804e954abcc988a5';
const FLAG = '__AURA_TEST_ENABLE_DORMANT_REPLAY__';
const gitHas = (c: string) => { try { execFileSync('git', ['cat-file', '-e', `${c}^{commit}`], { stdio: 'ignore' }); return true; } catch { return false; } };
(function provenance() {
  if (!gitHas(R17_HEAD)) { console.log(`SKIP fixture re-check: ${R17_HEAD.slice(0, 7)} not in this checkout (shallow clone); fixtures used as vendored`); return; }
  for (const f of ['offlineHabitQueue', 'activitySync', 'habitLogSyncPolicy', 'pendingReplayReconciliation']) {
    check(`fixture rel04-r17-head/${f}.ts.txt == ${R17_HEAD.slice(0, 7)} apps/web/lib/${f}.ts`, execFileSync('git', ['show', `${R17_HEAD}:apps/web/lib/${f}.ts`], { encoding: 'utf8', maxBuffer: 1 << 26 }) === fx(`${f}.ts.txt`));
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
const A = 'r18-account-a', B = 'r18-account-b';
addUser(A, 'r18a@example.invalid'); addUser(B, 'r18b@example.invalid');
const route = '/api/habit-logs';
const body = (id: string, title = 'Alpha') => payload(title, id);
const rows = (owner: string, crid?: string) => logsOf(owner).filter((l: any) => crid === undefined || l.clientRequestId === crid);
const realNow = Date.now;
const setOnline = (on: boolean) => { Object.defineProperty((global as any).navigator ?? ((global as any).navigator = {}), 'onLine', { configurable: true, get: () => on }); if (typeof window !== 'undefined') Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => on }); };
async function fresh() { Date.now = realNow; resetStore(); storage.clear(); storage.fail = { get: false, set: false, remove: false }; idbFault.open = false; idbFault.read = false; idbFault.write = false; setOnline(true); closeAllTabs(); await clearQueueDb(); }
type Stack = { q: any; sync: any; acct: any };
type Impl = { name: string; tab: (id: string) => Stack };
const CUR: Impl = { name: 'R18', tab: (id) => { const t = openTab(id); return { q: t.q, sync: t.sync, acct: t.acct }; } };
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
const R17 = stackOf('R17', { q: fx('offlineHabitQueue.ts.txt'), sync: fx('activitySync.ts.txt'), policy: fx('habitLogSyncPolicy.ts.txt'), recon: fx('pendingReplayReconciliation.ts.txt') });
const current = { q: src('offlineHabitQueue.ts'), sync: src('activitySync.ts'), policy: src('habitLogSyncPolicy.ts'), recon: src('pendingReplayReconciliation.ts') };
const mutant = (name: string, part: keyof typeof current, edits: Array<[string, string]>) => stackOf(name, { ...current, [part]: patched(current[part], edits) });

const dev = new Device();
dev.extra['/api/plans'] = () => [];
dev.extra['/api/habits'] = () => [];
let n = 0;
async function tab(impl: Impl, owner = A) { dev.signIn(owner); const s = impl.tab(`${impl.name}-${owner}-${n++}`); await s.acct.fetchVerifiedSession(dev.fetch as any); return s; }
async function putStore(s: Stack, store: 'tombstones' | 'records', d: Record<string, unknown>) { const db: IDBDatabase = await s.q.__openQueueDbForTests(); const t = db.transaction(store, 'readwrite'); t.objectStore(store).put(d); await new Promise<void>((ok) => { t.oncomplete = () => ok(); }); }
const posts = () => dev.count('POST', route);
const dumpKey = async () => { const d = await queueDump(); const norm = (xs: any[]) => JSON.stringify([...xs].sort((a, b) => String(a.recordId ?? a.key).localeCompare(String(b.recordId ?? b.key)))); return [norm(d.records), norm(d.tombstones), norm(d.claims)].join('|'); };
/** Commits on the real route; the acknowledgement is an unreadable HTML 200. */
const htmlAck: typeof fetch = (async (input: any, init: any = {}) => {
  const res = await dev.fetch(input, init);
  if (String(init.method ?? 'GET').toUpperCase() === 'POST' && String(input).endsWith(route)) return new Response('<html>Unreadable acknowledgement</html>', { status: 200, headers: { 'content-type': 'text/html' } });
  return res;
}) as any;
const marker = (s: Stack, id: string, extra: Record<string, unknown>) => ({ recordId: s.q.decisionKey(A, id), ownerUserId: A, clientRequestId: id, decision: 'settled', fmt: 'r8', at: Date.now(), ...extra });
const canon = (s: Stack, b: Record<string, unknown>) => s.q.canonicalPayload({ ...b, tempId: 'x' });
const serverRow = (id: string) => rows(A, id)[0];
const fullRow = (r: any) => ({ id: r.id, userId: A, clientRequestId: r.clientRequestId, activityTitle: r.activityTitle, activityId: r.activityId ?? null, activeWindow: r.activeWindow, logMinuteOfDay: r.logMinuteOfDay, logTimestamp: r.logTimestamp, durationMinutes: r.durationMinutes, notes: r.notes ?? null, logSource: r.logSource, activitySignificance: r.activitySignificance });
const validReceipt = (s: Stack, id: string, b: Record<string, unknown>) => { const pl = canon(s, b); const r = serverRow(id); return { v: 2, kind: 'accepted', owner: A, crid: id, payload: pl, serverRecordId: r.id, row: fullRow(r), at: 1 }; };

async function main() {
  // ================================================================ G10 witness (39262): a contradictory copy's intent is dropped
  {
    const out: Record<string, any> = {};
    for (const impl of [R17, CUR]) {
      await fresh();
      const s = await tab(impl);
      const id = 'g10-original';
      await s.sync.submitActivityLog(body(id, 'Review exact original') as any, 't', htmlAck); // committed; unverifiable
      const rec = (await queueDump()).records.find((r: any) => r.clientRequestId === id);
      await putStore(s, 'records', { ...rec, item: { ...rec.item, clientRequestId: `${id}-replaced-nested-id` } }); // the reviewer's mutation
      const ops = (await s.q.readActivityOperations(A)) ?? [];
      const p0 = posts();
      const again = await s.sync.submitActivityLog(body(`g10-new-${impl.name}`, 'Review exact original') as any, 't2', dev.fetch as any, undefined, { newOperation: { activityTitle: 'Review exact original' } });
      const retryA = await s.sync.submitActivityLog(body(id, 'Review exact original') as any, 'r', dev.fetch as any, undefined, { explicitRetry: true });
      out[impl.name] = { ops: ops.map((o: any) => ({ id: o.clientRequestId, status: o.status, retryable: o.retryable, title: o.body?.activityTitle ?? null })), again: again.kind, named: again.operation?.clientRequestId, retryA: retryA.kind, posts: posts() - p0, rows: rows(A).length, copyKept: (await queueDump()).records.some((r: any) => r.recordId === rec.recordId) };
    }
    console.log('W G10', JSON.stringify(out));
    check('W G10 -- R17 (negative control) reproduces: the contradictory copy contributes no intent; the identical new entry is sent under a NEW id (2 rows)', out.R17.again === 'confirmed' && out.R17.rows === 2);
    const u = out.R18.ops.find((o: any) => String(o.id).startsWith('unattributed:'));
    check(`W G10 -- R18: the contradictory copy is UNATTRIBUTED account evidence (unresolved, "${u?.title}", no Retry); the identical new entry is refused in the claiming transaction (recovery-required -> ${out.R18.named}); an explicit Retry under the original id sends nothing (${out.R18.retryA}); 0 POSTs, 1 row, copy preserved`, Boolean(u) && u.status === 'unresolved' && u.retryable === false && u.title === 'Review exact original' && out.R18.again === 'recovery-required' && String(out.R18.named).startsWith('unattributed:') && out.R18.retryA === 'outcome-unknown' && out.R18.posts === 0 && out.R18.rows === 1 && out.R18.copyKept);
  }

  // ================================================================ G11 witness (39262): a valid receipt hides a surviving conflicting copy
  {
    const out: Record<string, any> = {};
    for (const impl of [R17, CUR]) {
      await fresh();
      const s = await tab(impl);
      const id = 'g11-original';
      const b1 = body(id, 'Review exact original');
      await s.sync.submitActivityLog(b1 as any, 't', htmlAck); // the real commit, unreadable acknowledgement
      await putStore(s, 'tombstones', marker(s, id, { payload: canon(s, b1), serverOutcome: 'accepted', possiblySent: true, receipt: validReceipt(s, id, b1) }));
      const other = { ...b1, activityTitle: 'A different second copy' };
      await putStore(s, 'records', { recordId: 'second-copy', ownerUserId: A, clientRequestId: id, item: { ...other, ownerUserId: A, tempId: 'x', recordId: 'second-copy' }, queuedAt: 2, fmt: 'r8' });
      const before = await dumpKey();
      const p0 = posts();
      const checkAgain = await s.sync.checkActivityOperation({ account: A, clientRequestId: id, body: b1 }, dev.fetch as any, undefined, { dispatched: true });
      const retry = await s.sync.submitActivityLog(b1 as any, 'r', dev.fetch as any, undefined, { explicitRetry: true });
      const op = ((await s.q.readActivityOperations(A)) ?? []).find((o: any) => o.clientRequestId === id);
      out[impl.name] = { checkAgain: checkAgain.kind, reason: checkAgain.reason, retry: retry.kind, projection: op && { status: op.status, conflict: op.conflict, retryable: op.retryable }, unchanged: before === (await dumpKey()), posts: posts() - p0, rows: rows(A).length, records: (await queueDump()).records.length };
    }
    console.log('W G11', JSON.stringify(out));
    check('W G11 -- R17 (negative control) reproduces: Check again and Retry report the operation as already recorded although a conflicting copy survives', out.R17.checkAgain === 'already-recorded' && out.R17.retry === 'already-recorded' && out.R17.records === 2);
    check(`W G11 -- R18: Check again reports the decision (${out.R18.checkAgain}/${out.R18.reason}) and so does Retry (${out.R18.retry}); the projection is a conflict without Retry; nothing written (storage unchanged), 0 POSTs, 1 row, both copies kept`, out.R18.checkAgain === 'outcome-unknown' && out.R18.reason === 'conflict' && out.R18.retry === 'outcome-unknown' && out.R18.projection?.conflict === true && out.R18.projection?.retryable === false && out.R18.unchanged && out.R18.posts === 0 && out.R18.rows === 1 && out.R18.records === 2);
  }
  {
    // Check again is READ-ONLY: R17 persisted a receipt and removed the copy on a GET match; R18 writes nothing
    const out: Record<string, any> = {};
    for (const impl of [R17, CUR]) {
      await fresh();
      const s = await tab(impl);
      const id = 'read-only';
      await s.sync.submitActivityLog(body(id) as any, 't', htmlAck);
      await putStore(s, 'tombstones', marker(s, id, { payload: canon(s, body(id)) })); // proofless: both read the server
      const before = await dumpKey();
      const p0 = posts();
      const r = await s.sync.checkActivityOperation({ account: A, clientRequestId: id, body: body(id) }, dev.fetch as any, undefined, { dispatched: true });
      out[impl.name] = { kind: r.kind, reason: r.reason, unchanged: before === (await dumpKey()), posts: posts() - p0 };
      if (impl === CUR) {
        const retry = await s.sync.submitActivityLog(body(id) as any, 'r', dev.fetch as any, undefined, { explicitRetry: true });
        out.R18.retry = retry.kind; out.R18.rows = rows(A, id).length; out.R18.copies = (await queueDump()).records.length;
      }
    }
    console.log('CHECK-AGAIN', JSON.stringify(out));
    check('Check again -- R17 (negative control): a GET match WRITES (receipt persisted, copy removed)', out.R17.kind === 'already-recorded' && !out.R17.unchanged);
    check(`Check again -- R18 is read-only: the server has it (${out.R18.reason}); storage unchanged, 0 POSTs; the user's Retry then finishes under the same id (${out.R18.retry}, ${out.R18.rows} row, ${out.R18.copies} copies)`, out.R18.kind === 'outcome-unknown' && out.R18.reason === 'server-has-it' && out.R18.unchanged && out.R18.posts === 0 && out.R18.retry === 'confirmed' && out.R18.rows === 1 && out.R18.copies === 0);
  }

  // ================================================================ negative controls (each R18 rule removed in turn)
  {
    const noUnattributed = mutant('N10-no-unattributed-evidence', 'q', [['      if (!concealed.includes(r) && (id.crid || id.candidates.some((c) => crids.has(c)))) continue;\n      unattributed(', '      if (true as boolean) continue;\n      unattributed(']]);
    await fresh();
    const s = await tab(noUnattributed);
    await s.sync.submitActivityLog(body('n10', 'Review exact original') as any, 't', htmlAck);
    const rec = (await queueDump()).records[0];
    await putStore(s, 'records', { ...rec, item: { ...rec.item, clientRequestId: 'n10-nested' } });
    const r = await s.sync.submitActivityLog(body('n10-new', 'Review exact original') as any, 't2', dev.fetch as any, undefined, { newOperation: { activityTitle: 'Review exact original' } });
    check(`N10 dropping unattributed evidence from discovery is detected: the identical new entry is sent (${r.kind}; 2 rows)`, r.kind === 'confirmed' && rows(A).length === 2);

    const receiptFirst = mutant('N11-receipt-first', 'q', [['      if (livePayloads.some((p) => p !== fact.payload)) { out.set(crid, op(\'conflict\', null, single)); continue; }\n', '']]);
    await fresh();
    const s2 = await tab(receiptFirst);
    const b1 = body('n11', 'Review exact original');
    await s2.sync.submitActivityLog(b1 as any, 't', htmlAck);
    await putStore(s2, 'tombstones', marker(s2, 'n11', { payload: canon(s2, b1), receipt: validReceipt(s2, 'n11', b1) }));
    await putStore(s2, 'records', { recordId: 'n11-second', ownerUserId: A, clientRequestId: 'n11', item: { ...b1, activityTitle: 'Other', ownerUserId: A, tempId: 'x', recordId: 'n11-second' }, queuedAt: 2, fmt: 'r8' });
    const c = await s2.sync.checkActivityOperation({ account: A, clientRequestId: 'n11', body: b1 }, dev.fetch as any);
    check(`N11 letting a valid receipt decide before the surviving copies is detected: Check again reports ${c.kind} with a conflicting copy present`, c.kind === 'already-recorded');

    const noBoundary = mutant('N12-replay-boundary-removed', 'sync', [["  if (!dormantReplayEnabled()) return Promise.resolve(EMPTY('disabled'));\n", '']]);
    await fresh();
    const s3 = await tab(noBoundary);
    dev.fault('POST', route, 'network-before');
    await s3.sync.submitActivityLog(body('n12') as any, 't', dev.fetch as any);
    delete (globalThis as any)[FLAG];
    const p0 = posts();
    const rp = await s3.sync.replayOfflineQueue(dev.fetch as any);
    (globalThis as any)[FLAG] = true;
    check(`N12 removing the automatic-dispatch boundary is detected: without any user action the stored activity is sent (${rp.attempted} attempted, ${posts() - p0} POST)`, rp.attempted === 1 && posts() - p0 === 1);

    const noOffline = mutant('N13-offline-refusal-removed', 'sync', [["    if (ONLINE_FIRST && confirmedOffline()) return { kind: 'not-stored', reason: 'offline' };\n", '']]);
    await fresh();
    const s4 = await tab(noOffline);
    setOnline(false);
    dev.fault('POST', route, 'network-before');
    const r4 = await s4.sync.submitActivityLog(body('n13') as any, 't', dev.fetch as any);
    setOnline(true);
    check(`N13 removing the pre-dispatch offline refusal is detected: a NEW activity is stored while offline (${r4.kind}; ${(await queueDump()).records.length} record)`, (await queueDump()).records.length === 1);
  }

  // ================================================================ generative consumer agreement (every evidence combination x every consumer)
  {
    type Live = 'none' | 'A' | 'AB';
    type Block = 'none' | 'contradictory' | 'damaged';
    type Mark = 'none' | 'prooflessA' | 'prooflessB' | 'nullPayload' | 'unboundA' | 'receiptA' | 'discardNull' | 'discardA';
    type Srv = 'none' | 'rowA';
    const LIVES: Live[] = ['none', 'A', 'AB'], BLOCKS: Block[] = ['none', 'contradictory', 'damaged'], MARKS: Mark[] = ['none', 'prooflessA', 'prooflessB', 'nullPayload', 'unboundA', 'receiptA', 'discardNull', 'discardA'], SRVS: Srv[] = ['none', 'rowA'];
    const ID = 'gen';
    const bA = body(ID, 'Alpha'), bB = body(ID, 'Beta');
    const setup = async (s: Stack, live: Live, block: Block, mark: Mark, srv: Srv) => {
      if (srv === 'rowA') { await s.sync.submitActivityLog(bA as any, 'seed', htmlAck); await clearQueueDb(); } // the server holds Alpha under the id; local evidence reset
      if (live !== 'none') await putStore(s, 'records', { recordId: 'copy-a', ownerUserId: A, clientRequestId: ID, item: { ...bA, ownerUserId: A, tempId: 'x', recordId: 'copy-a' }, queuedAt: 1, fmt: 'r8' });
      if (live === 'AB') await putStore(s, 'records', { recordId: 'copy-b', ownerUserId: A, clientRequestId: ID, item: { ...bB, ownerUserId: A, tempId: 'x', recordId: 'copy-b' }, queuedAt: 2, fmt: 'r8' });
      if (block === 'contradictory') await putStore(s, 'records', { recordId: 'copy-x', ownerUserId: A, clientRequestId: ID, item: { ...bA, clientRequestId: `${ID}-nested`, ownerUserId: A, tempId: 'x', recordId: 'copy-x' }, queuedAt: 3, fmt: 'r8' });
      if (block === 'damaged') await putStore(s, 'records', { recordId: 'copy-d', ownerUserId: A, clientRequestId: '', item: { ...bA, ownerUserId: A, tempId: 'x', recordId: 'copy-d' }, queuedAt: 3, fmt: 'r8' });
      const m: Record<Mark, Record<string, unknown> | null> = {
        none: null,
        prooflessA: marker(s, ID, { payload: canon(s, bA) }),
        prooflessB: marker(s, ID, { payload: canon(s, bB) }),
        nullPayload: marker(s, ID, { payload: null }),
        unboundA: marker(s, ID, { ownerUserId: B, payload: canon(s, bA) }),
        receiptA: srv === 'rowA' ? marker(s, ID, { payload: canon(s, bA), serverOutcome: 'accepted', possiblySent: true, receipt: validReceipt(s, ID, bA) }) : null,
        discardNull: { recordId: s.q.decisionKey(A, ID), ownerUserId: A, clientRequestId: ID, payload: null, decision: 'discarded', fmt: 'r8', at: 1 },
        discardA: { recordId: s.q.decisionKey(A, ID), ownerUserId: A, clientRequestId: ID, payload: canon(s, bA), decision: 'discarded', fmt: 'r8', at: 1 },
      };
      if (m[mark]) await putStore(s, 'tombstones', m[mark]!);
    };
    const expectedOutcome = (d: any, pl: string) => {
      if (!d) return ['not-stored', 'outcome-unknown'];
      if (d.status === 'confirmed') return d.fact?.payload === pl ? ['already-recorded'] : ['outcome-unknown'];
      if (d.status === 'failed') return d.fact?.payload === pl ? ['rejected'] : ['outcome-unknown'];
      if (d.status === 'discarded') return d.fact?.payload === null || d.fact?.payload === pl || !d.fact ? ['not-stored'] : ['outcome-unknown'];
      return ['outcome-unknown'];
    };
    let combos = 0, agree = 0;
    const failures: string[] = [];
    for (const live of LIVES) for (const block of BLOCKS) for (const mark of MARKS) for (const srv of SRVS) {
      if (mark === 'receiptA' && srv !== 'rowA') continue;
      combos++;
      const label = `${live}/${block}/${mark}/${srv}`;
      const problems: string[] = [];
      const run = async () => { await fresh(); const s = await tab(CUR); await setup(s, live, block, mark, srv); return s; };
      // the decision and the UI projection
      let s = await run();
      const decision = ((await s.q.readRecoveryDecision(A)) ?? []) as any[];
      const d = decision.find((o) => o.clientRequestId === ID);
      const projection = ((await s.q.readActivityOperations(A)) ?? []) as any[];
      const pOp = projection.find((o) => o.clientRequestId === ID);
      const pA = canon(s, bA), pB = canon(s, bB);
      if (d && (!pOp || pOp.status !== (d.status === 'conflict' ? 'unresolved' : d.status) || pOp.retryable !== (d.dispatchPayload !== null && (d.status === 'pending' || d.status === 'unresolved')) || pOp.conflict !== (d.status === 'conflict'))) problems.push('projection');
      // invariant: conflicting bodies (two live, or a marker body different from a live copy) are never dispatchable
      if ((live === 'AB' || (live !== 'none' && mark === 'prooflessB')) && d?.dispatchPayload) problems.push('conflict-dispatchable');
      // invariant: contradictory / damaged evidence never makes anything dispatchable on its own
      if (live === 'none' && block !== 'none' && !['prooflessA', 'prooflessB'].includes(mark) && d?.dispatchPayload) problems.push('blocked-dispatchable');
      // Check again (read-only) agrees with the decision
      const before = await dumpKey(); let p0 = posts();
      const ca = await s.sync.checkActivityOperation({ account: A, clientRequestId: ID, body: bA }, dev.fetch as any, undefined, { dispatched: true });
      if (before !== (await dumpKey()) || posts() !== p0) problems.push('check-again-wrote');
      if (!expectedOutcome(d, pA).includes(ca.kind)) problems.push(`check-again:${ca.kind}`);
      if (d?.status === 'conflict' && ca.reason !== 'conflict') problems.push('check-again-not-conflict');
      // explicit Retry with each body: sent iff it is the decision's dispatch payload of an open operation
      for (const [pl, b, tag] of [[pA, bA, 'A'], [pB, bB, 'B']] as const) {
        s = await run();
        const all = ((await s.q.readRecoveryDecision(A)) ?? []) as any[];
        const dd = all.find((o) => o.clientRequestId === ID) ?? all.find((o) => !o.attributable && (o.candidates ?? []).includes(ID)); // THE decision's answer for this id
        const before2 = await dumpKey(); p0 = posts();
        const r = await s.sync.submitActivityLog(b as any, 'retry', dev.fetch as any, undefined, { explicitRetry: true });
        const sent = posts() - p0;
        const may = dd ? dd.dispatchPayload === pl && (dd.status === 'pending' || dd.status === 'unresolved') : true; // absent id: a new operation under this id
        if (sent !== (may ? 1 : 0)) problems.push(`retry${tag}-sent:${sent}`);
        if (sent === 0 && before2 !== (await dumpKey())) problems.push(`retry${tag}-wrote-without-send`);
        if (sent === 0 && !expectedOutcome(dd, pl).includes(r.kind)) problems.push(`retry${tag}:${r.kind}`);
        if (sent === 1) {
          const after = (((await s.q.readRecoveryDecision(A)) ?? []) as any[]).find((o) => o.clientRequestId === ID);
          if (r.kind === 'confirmed' && after?.status !== 'confirmed') problems.push(`retry${tag}-confirmed-but-${after?.status}`);
          if (rows(A, ID).length !== 1) problems.push(`retry${tag}-rows:${rows(A, ID).length}`);
          const kept = (await queueDump()).records.map((x: any) => x.recordId).sort().join(',');
          const expectKept = ['copy-b', 'copy-x', 'copy-d'].filter((k) => (k === 'copy-b' && live === 'AB') || (k === 'copy-x' && block === 'contradictory') || (k === 'copy-d' && block === 'damaged')).sort().join(',');
          if (r.kind === 'confirmed' && kept !== expectKept) problems.push(`retry${tag}-kept:${kept}`);
        }
      }
      // a NEW submission of the same activity: refused iff THE decision holds an open operation naming it
      s = await run();
      const open = (((await s.q.readRecoveryDecision(A)) ?? []) as any[]).some((o) => ['pending', 'unresolved', 'conflict'].includes(o.status) && o.intents.some((i: any) => i.activityTitle === 'Alpha'));
      // independent oracle: any stored copy or marker body naming Alpha that is not a validated terminal decision of Alpha alone
      const oracle = block !== 'none' // a blocked copy naming Alpha is never concealed, whatever the marker says
        || (live === 'AB' && mark !== 'discardNull') // two bodies: open unless the user's discard fenced every payload
        || (live === 'A' && !['receiptA', 'discardNull', 'discardA'].includes(mark)) // an Alpha copy without a terminal decision for Alpha
        || (live === 'none' && ['prooflessA', 'unboundA'].includes(mark)); // a marker naming Alpha that proves nothing
      p0 = posts();
      const fr = await s.sync.submitActivityLog(body(`gen-new-${combos}`, 'Alpha') as any, 'fresh', dev.fetch as any, undefined, { newOperation: { activityTitle: 'Alpha' } });
      if ((fr.kind === 'recovery-required') !== open) problems.push(`fresh:${fr.kind}/open:${open}`);
      if (open !== oracle) problems.push(`oracle:${oracle}/open:${open}`);
      if (fr.kind === 'recovery-required' && posts() !== p0) problems.push('fresh-sent-while-refused');
      // automatic dispatch: none, whatever is stored
      delete (globalThis as any)[FLAG];
      p0 = posts();
      const rp = await s.sync.replayOfflineQueue(dev.fetch as any);
      (globalThis as any)[FLAG] = true;
      if (rp.stoppedBecause !== 'disabled' || posts() !== p0) problems.push('automatic-send');
      if (problems.length) failures.push(`${label}: ${problems.join(', ')} (decision ${d?.status}/${d?.dispatchPayload === pA ? 'A' : d?.dispatchPayload === pB ? 'B' : d?.dispatchPayload ?? 'none'})`); else agree++;
    }
    for (const f of failures.slice(0, 20)) console.log('  generative FAIL', f);
    check(`generative consumer agreement: ${agree}/${combos} evidence combinations (live copies x blocked copies x markers x server state) -- projection, Check again (read-only), explicit Retry with each body, a new submission and automatic dispatch all act on THE decision; dispatches, retained copies and returned outcomes agree; independent oracles for conflicts and withheld entries hold`, agree === combos);
  }

  // ================================================================ online-first behaviour (library)
  {
    await fresh();
    const s = await tab(CUR);
    dev.fault('POST', route, 'network-before');
    const queued = await s.sync.submitActivityLog(body('ol-stored') as any, 't', dev.fetch as any);
    delete (globalThis as any)[FLAG];
    const p0 = posts();
    const rp = await s.sync.replayOfflineQueue(dev.fetch as any);
    check(`automatic dispatch boundary: a stored unconfirmed activity (${queued.kind} -> status ${s.sync.operationStatusOf(queued)}) is never sent by replay (${rp.stoppedBecause}, 0 POSTs); the copy is kept`, queued.kind === 'queued' && s.sync.operationStatusOf(queued) === 'unresolved' && rp.stoppedBecause === 'disabled' && posts() === p0 && (await queueDump()).records.length === 1);
    (globalThis as any)[FLAG] = true;
    setOnline(false);
    const p1 = posts();
    const offNew = await s.sync.submitActivityLog(body('ol-new', 'Beta') as any, 't2', dev.fetch as any, undefined, { newOperation: { activityTitle: 'Beta' } });
    const offRetry = await s.sync.submitActivityLog(body('ol-stored') as any, 't3', dev.fetch as any, undefined, { explicitRetry: true });
    setOnline(true);
    const recs = (await queueDump()).records;
    check(`offline before dispatch: a NEW activity stores nothing (${offNew.kind}/${offNew.reason}); an explicit Retry leaves its operation untouched (${offRetry.kind}/${offRetry.reason}); 0 POSTs`, offNew.kind === 'not-stored' && offNew.reason === 'offline' && offRetry.kind === 'not-stored' && offRetry.reason === 'offline' && posts() === p1 && recs.length === 1 && recs[0].clientRequestId === 'ol-stored');
    // ambiguous submission across restart, then Retry converges on one row
    await fresh();
    const s1 = await tab(CUR);
    const amb = await s1.sync.submitActivityLog(body('amb') as any, 't', htmlAck);
    closeAllTabs();
    const s2 = await tab(CUR);
    const after = ((await s2.q.readActivityOperations(A)) ?? []).find((o: any) => o.clientRequestId === 'amb');
    const r1 = await s2.sync.submitActivityLog(body('amb') as any, 'r', dev.fetch as any, undefined, { explicitRetry: true });
    const r2 = await s2.sync.submitActivityLog(body('amb') as any, 'r2', dev.fetch as any, undefined, { explicitRetry: true });
    check(`ambiguous submission (${amb.kind}) is kept across restart (stored ${after?.status}, retryable ${after?.retryable}); Retry converges on ONE row under the original id (${r1.kind}); a second Retry reports the same (${r2.kind}, still 1 row, no copy)`, amb.kind === 'outcome-unknown' && after?.retryable === true && r1.kind === 'confirmed' && r2.kind === 'already-recorded' && rows(A, 'amb').length === 1 && (await queueDump()).records.length === 0);
    // multi-tab explicit Retry: one claim, one row
    await fresh();
    const t1 = await tab(CUR);
    await t1.sync.submitActivityLog(body('mt') as any, 't', htmlAck);
    const t2 = await tab(CUR);
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const slow: typeof fetch = (async (i: any, init: any = {}) => { if (String(init.method ?? 'GET').toUpperCase() === 'POST') await gate; return dev.fetch(i, init); }) as any;
    const p2 = posts();
    const first = t1.sync.submitActivityLog(body('mt') as any, 'r1', slow, undefined, { explicitRetry: true });
    for (let i = 0; i < 20; i++) await flush();
    const second = await t2.sync.submitActivityLog(body('mt') as any, 'r2', dev.fetch as any, undefined, { explicitRetry: true });
    release();
    const firstR = await first;
    check(`multi-tab explicit Retry: while tab 1 holds the claim, tab 2 sends nothing (${second.kind} -> ${t2.sync.operationStatusOf(second)}); tab 1 converges (${firstR.kind}); 1 POST, 1 row`, posts() - p2 === 1 && t2.sync.operationStatusOf(second) === 'unresolved' && firstR.kind === 'confirmed' && rows(A, 'mt').length === 1);
    // discard at sign-out fences a later Retry
    await fresh();
    const d1 = await tab(CUR);
    dev.fault('POST', route, 'network-before');
    await d1.sync.submitActivityLog(body('dsc') as any, 't', dev.fetch as any);
    const read = await d1.q.readOwnedQueue(A);
    const disc = await d1.q.discardOwned(A, { records: read.records, corruptIds: read.corruptIds, corrupt: read.corrupt, quarantined: read.quarantined }, { tab: 'signout' });
    const p3 = posts();
    const afterDiscard = await d1.sync.submitActivityLog(body('dsc') as any, 'r', dev.fetch as any, undefined, { explicitRetry: true });
    check(`sign-out discard fences a later Retry (removed ${disc.removed}; Retry -> ${afterDiscard.kind}/${afterDiscard.reason}; 0 POSTs, 0 rows)`, disc.removed === 1 && afterDiscard.kind === 'not-stored' && afterDiscard.reason === 'discarded' && posts() === p3 && rows(A, 'dsc').length === 0);
  }

  // ================================================================ the real page (shared entry point for Home, Timeline, Calendar, Past Activity)
  (global as any).fetch = dev.fetch; (window as any).fetch = dev.fetch;
  (global as any).requestAnimationFrame = (f: any) => setTimeout(f, 0); (global as any).cancelAnimationFrame = (id: any) => clearTimeout(id);
  (window as any).confirm = () => true; (window as any).alert = () => {};
  for (const k of ['HTMLElement', 'HTMLInputElement', 'HTMLButtonElement', 'HTMLDivElement', 'Node', 'Element', 'FocusEvent', 'Event']) if ((window as any)[k] && !(global as any)[k]) (global as any)[k] = (window as any)[k];
  closeAllTabs();
  delete (globalThis as any)[FLAG]; // the page runs with the production boundary (no dormant replay)
  const pageAcct = require('../apps/web/lib/accountSession');
  const pageQ = require('../apps/web/lib/offlineHabitQueue');
  const Page = require('../apps/web/app/page').default;
  const settle = async (k = 30) => { for (let i = 0; i < k; i++) await flush(); };
  const text = () => (document.body.textContent ?? '').replace(/\s+/g, ' ');
  const pagePosts: any[] = [];
  let ackHtml = false;
  (global as any).fetch = (window as any).fetch = async (input: any, init: any = {}) => {
    const isPost = String(init.method ?? 'GET').toUpperCase() === 'POST' && String(input).endsWith(route);
    if (isPost) pagePosts.push(JSON.parse(String(init.body)));
    const res = await dev.fetch(input, init);
    if (ackHtml && isPost) return new Response('<html>Unverified acknowledgement</html>', { status: 200, headers: { 'content-type': 'text/html' } });
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
  const RealDate = Date;
  const clockOffset = new RealDate(2026, 10, 27, 15, 0, 0).getTime() - RealDate.now();
  class FixedDayDate extends RealDate {
    constructor(...a: any[]) { if (a.length === 0) super(RealDate.now() + clockOffset); else super(...(a as [any])); }
    static now() { return RealDate.now() + clockOffset; }
  }
  (global as any).Date = (window as any).Date = FixedDayDate;
  {
    // zero automatic activity POSTs: stored unconfirmed + legacy (REL-05) activity, startup, connectivity, visibility, post-submit
    let P = await page();
    await P.press('+ Log Activity');
    ackHtml = true;
    await P.fillAndSave('Evening walk'); // ambiguous: stays unresolved
    ackHtml = false;
    await settle();
    const ambiguousShown = text().includes("Couldn't verify whether this activity was saved.");
    await P.press('Cancel');
    await P.h.unmount();
    closeAllTabs();
    storage.setItem('offline_habit_queue', JSON.stringify([{ activityTitle: 'REL-05 legacy entry', activeWindow: 'NEUTRAL', logTimestamp: '2026-11-20T06:00:00.000Z', durationMinutes: 30, tempId: 'legacy-1', clientRequestId: 'legacy-crid-1' }]));
    const legacyRaw = storage.getItem('offline_habit_queue');
    const p0 = pagePosts.length;
    P = await page({ keepStore: true });
    await act(async () => { window.dispatchEvent(new (window as any).Event('online')); });
    await settle();
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    await act(async () => { document.dispatchEvent(new (window as any).Event('visibilitychange')); });
    await settle();
    const automatic = pagePosts.length - p0;
    const restartShown = text().includes("Couldn't verify whether this activity was saved.") && text().includes('Evening walk');
    const legacyNotice = /legacy|earlier version|previous version/i.test(text());
    await P.press('+ Log Activity');
    await P.fillAndSave('Morning reading'); // an unrelated user submission
    await settle(40);
    const afterSubmit = pagePosts.slice(p0).map((b) => b.activityTitle);
    await P.h.unmount();
    check(`zero automatic POSTs: after a restart with an unresolved activity (shown before ${ambiguousShown}, after ${restartShown}) and an REL-05 legacy queue, startup + 'online' + visibilitychange sent ${automatic} requests; the only request afterwards is the user's own submission (${JSON.stringify(afterSubmit)})`, ambiguousShown && restartShown && automatic === 0 && afterSubmit.length === 1 && afterSubmit[0] === 'Morning reading');
    check(`REL-05 upgrade: the legacy queue is never sent and never modified (kept byte-identical; notice shown ${legacyNotice})`, storage.getItem('offline_habit_queue') === legacyRaw && !pagePosts.some((b) => b.activityTitle === 'REL-05 legacy entry'));
  }
  {
    // offline before dispatch (Calendar): nothing stored, the accurate message
    const P = await page();
    setOnline(false);
    await P.press('+ Log Activity');
    await P.fillAndSave('Offline entry');
    await settle();
    const shown = text().includes("You're offline, so this activity wasn't saved");
    const records = (await queueDump()).records.length;
    setOnline(true);
    await P.h.unmount();
    check(`offline before dispatch (Calendar): "You're offline, so this activity wasn't saved" (${shown}); nothing stored (${records}), nothing sent, no unresolved operation`, shown && records === 0 && pagePosts.length === 0 && !text().includes("Couldn't verify"));
  }
  {
    // G10 (page): the identical Calendar Save after a restart is withheld; no Retry (identity untrusted), separate allowed
    let P = await page();
    await P.press('+ Log Activity');
    ackHtml = true;
    await P.fillAndSave('Review exact original');
    ackHtml = false;
    await settle();
    await P.press('Cancel');
    const rec = (await queueDump()).records[0];
    await putStore({ q: pageQ } as any, 'records', { ...rec, item: { ...rec.item, clientRequestId: `${rec.clientRequestId}-replaced-nested-id` } });
    await P.h.unmount(); closeAllTabs();
    const p0 = pagePosts.length;
    P = await page({ keepStore: true });
    await P.press('+ Log Activity');
    await P.fillAndSave('Review exact original');
    await settle();
    const r = { sent: pagePosts.length - p0, rows: rows(A).length, retry: Boolean(P.byText('Retry that entry')), separate: Boolean(P.byText('Save as a separate activity')), kept: (await queueDump()).records.length };
    await P.h.unmount();
    console.log('PAGE G10', JSON.stringify(r));
    check('G10 (page) contradictory copy after restart: the identical Calendar Save is withheld (0 POSTs, 1 row); no Retry is offered (the identity cannot be trusted); a deliberately separate entry is; the copy is kept', r.sent === 0 && r.rows === 1 && !r.retry && r.separate && r.kept === 1);
  }
  {
    // G11 (page): the conflict stays visible; Check again does not confirm it away and writes nothing
    let P = await page();
    await P.press('+ Log Activity');
    ackHtml = true;
    await P.fillAndSave('Review exact original');
    ackHtml = false;
    await settle();
    await P.press('Cancel');
    const rec = (await queueDump()).records[0];
    const id = rec.clientRequestId;
    const s = { q: pageQ } as any;
    const b1 = pageQ.canonicalPayload(rec.item);
    const row = rows(A, id)[0];
    await putStore(s, 'tombstones', { recordId: pageQ.decisionKey(A, id), ownerUserId: A, clientRequestId: id, payload: b1, decision: 'settled', fmt: 'r8', at: 1, serverOutcome: 'accepted', possiblySent: true, receipt: { v: 2, kind: 'accepted', owner: A, crid: id, payload: b1, serverRecordId: row.id, row: fullRow(row), at: 1 } });
    await putStore(s, 'records', { recordId: 'second-copy', ownerUserId: A, clientRequestId: id, item: { ...rec.item, activityTitle: 'A different second copy', recordId: 'second-copy' }, queuedAt: 2, fmt: 'r8' });
    await P.h.unmount(); closeAllTabs();
    P = await page({ keepStore: true });
    const item = () => document.querySelector(`[data-operation-id="${id}"]`);
    const shownBefore = (item()?.textContent ?? '').includes('conflicting copies');
    const before = await dumpKey();
    const p0 = pagePosts.length;
    const checkBtn = item() ? [...item()!.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === 'Check again') : undefined;
    if (checkBtn) await act(async () => { await click(checkBtn); });
    await settle();
    const r = { shownBefore, stillShown: (item()?.textContent ?? '').includes('conflicting copies'), retry: item() ? [...item()!.querySelectorAll('button')].some((b) => (b.textContent ?? '').trim() === 'Retry') : true, unchanged: before === (await dumpKey()), sent: pagePosts.length - p0 };
    await P.h.unmount();
    console.log('PAGE G11', JSON.stringify(r));
    check('G11 (page) a valid receipt beside a conflicting copy: the conflict is shown, Check again keeps it (no confirmation), offers no Retry, writes nothing and sends nothing', r.shownBefore && r.stillShown && !r.retry && r.unchanged && r.sent === 0);
  }
  {
    // ambiguous Calendar submission across restart; explicit Retry converges on one persisted activity
    let P = await page();
    await P.press('+ Log Activity');
    ackHtml = true;
    await P.fillAndSave('Review exact original');
    ackHtml = false;
    await settle();
    const original = rows(A)[0]?.clientRequestId;
    await P.press('Cancel');
    await P.h.unmount(); closeAllTabs();
    P = await page({ keepStore: true });
    const item = document.querySelector(`[data-operation-id="${original}"]`);
    const retryBtn = item ? [...item.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === 'Retry') : undefined;
    if (retryBtn) await act(async () => { await click(retryBtn); });
    await settle(40);
    const r = { offered: Boolean(retryBtn), rows: rows(A).length, ids: [...new Set(rows(A).map((x: any) => x.clientRequestId))], copies: (await queueDump()).records.length, notice: Boolean(document.querySelector(`[data-operation-id="${original}"]`)) };
    await P.h.unmount();
    check(`ambiguous Calendar submission across restart: the shared notice offers Retry (${r.offered}); Retry converges on ONE row under the original id (${r.rows} row, ${r.ids.length} id); no copy, no notice left`, r.offered && r.rows === 1 && r.ids[0] === original && r.copies === 0 && !r.notice);
  }
  (global as any).Date = (window as any).Date = RealDate;
  (globalThis as any)[FLAG] = true;

  // ================================================================ one decision, one boundary (source)
  {
    const q = src('offlineHabitQueue.ts'), sync = src('activitySync.ts'), pageSrc = fs.readFileSync(path.join(WEB, 'app', 'page.tsx'), 'utf8');
    const requestStateIsView = /async function requestState\([^)]*\): Promise<RequestState> \{\n\s+return stateForPayload\(\(await decideOperations\(st, owner, q, crid\)\)\.get\(crid\), payload\);\n\}/.test(q);
    const oneBoundary = (sync.match(/dormantReplayEnabled\(\)/g) ?? []).length === 1 && !/replayOfflineQueue/.test(pageSrc) && !/__AURA_TEST_ENABLE_DORMANT_REPLAY__/.test(pageSrc + q + sync.replace("'__AURA_TEST_ENABLE_DORMANT_REPLAY__'", ''));
    const ui = ['app/page.tsx', 'components/HomeDashboard.tsx', 'components/Timeline.tsx', 'components/PastActivityModal.tsx', 'components/CalendarViewSection.tsx'].map((f) => fs.readFileSync(path.join(WEB, f), 'utf8')).join('\n');
    const noUiInterpretation = !/decisionAuthority|validReceipt|tombstones|decisionKey\(/.test(ui);
    const noSyncPromise = !/will sync|Pending sync|Saved offline/.test(ui + sync + src('signOut.ts'));
    const checkReadOnly = !/recordVerifiedReceipt\(/.test(sync.slice(sync.indexOf('export async function checkActivityOperation'), sync.indexOf('export interface ReplayResult')));
    check(`one decision, one boundary: requestState is a view of decideOperations (${requestStateIsView}); automatic replay has ONE boundary and no app caller (${oneBoundary}); Check again writes nothing (${checkReadOnly}); no surface interprets markers or receipts (${noUiInterpretation}); no automatic-sync promise in the UI (${noSyncPromise})`, requestStateIsView && oneBoundary && checkReadOnly && noUiInterpretation && noSyncPromise);
  }
  finish();
}
main().catch((e) => { console.error(e); process.exit(1); });
