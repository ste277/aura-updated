/**
 * AURA-ANDROID-REL-04 R16 (ticket 39259; verification 39258 NO-GO: G4-G6) -- completes the R15 shared operation
 * contract. Each 39258 witness runs on the UNCHANGED R15 implementation (e6a6a66, vendored in
 * test/fixtures/rel04-r15-head and checked against git) -- the negative control -- and on R16; then the matrices,
 * the shared recovery contract through the real page (Home, Timeline, Calendar / Past Activity, remount and
 * restart) and one negative control per new blocker.
 *
 *   G4  receipts: matching ids with contradictory / incomplete / malformed intent never establish success, on every
 *       consumer (gate, operations read, recovery upgrade, settlement); copies and identity preserved
 *   G5  refusals: 429 and every other unsupported refusal stays unresolved in BOTH send paths; copy + id kept; the
 *       later same-id retry reaches the writer
 *   G6  recovery: an open operation survives Calendar remount, navigation and restart; a fresh identical entry is
 *       withheld with the original operation's recovery offered; a deliberate separate entry is still possible
 *
 *   TS_NODE_COMPILER_OPTIONS='{"jsx":"react-jsx"}' npx ts-node --project tsconfig.jsdom-tests.json test/rel04R16OperationCorrection.test.ts
 */
import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { React, mount, flush, act, click, typeInto } from './jsdomReactHarness';
import { Device, WEB, addUser, check, clearQueueDb, closeAllTabs, finish, idbFault, logsOf, openTab, payload, queueDump, resetStore, storage } from './rel04AccountIsolationHarness';

const ts = require(require.resolve('typescript', { paths: [WEB] }));
const Module = require('module');
const FX = path.join(__dirname, 'fixtures', 'rel04-r15-head');
const fx = (n: string) => fs.readFileSync(path.join(FX, n), 'utf8');
const src = (n: string) => fs.readFileSync(path.join(WEB, 'lib', n), 'utf8');
const R15_HEAD = 'e6a6a6678bf6300362e15cf398343a246807a7e2';
const gitHas = (c: string) => { try { execFileSync('git', ['cat-file', '-e', `${c}^{commit}`], { stdio: 'ignore' }); return true; } catch { return false; } };
(function provenance() {
  if (!gitHas(R15_HEAD)) { console.log(`SKIP fixture re-check: ${R15_HEAD.slice(0, 7)} not in this checkout (shallow clone); fixtures used as vendored`); return; }
  for (const f of ['offlineHabitQueue', 'activitySync', 'habitLogSyncPolicy', 'signOut', 'pendingReplayReconciliation']) {
    check(`fixture rel04-r15-head/${f}.ts.txt == ${R15_HEAD.slice(0, 7)} apps/web/lib/${f}.ts`, execFileSync('git', ['show', `${R15_HEAD}:apps/web/lib/${f}.ts`], { encoding: 'utf8', maxBuffer: 1 << 26 }) === fx(`${f}.ts.txt`));
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
const A = 'r16-account-a', B = 'r16-account-b';
addUser(A, 'r16a@example.invalid'); addUser(B, 'r16b@example.invalid');
const route = '/api/habit-logs';
const body = (id: string, title = 'Original activity') => payload(title, id);
const item = (id: string, owner = A, title?: string) => ({ ...body(id, title), ownerUserId: owner, tempId: 'tmp' });
const rows = (owner: string, crid?: string) => logsOf(owner).filter((l: any) => crid === undefined || l.clientRequestId === crid);
const realNow = Date.now;
async function fresh() { Date.now = realNow; resetStore(); storage.clear(); storage.fail = { get: false, set: false, remove: false }; idbFault.open = false; idbFault.read = false; idbFault.write = false; closeAllTabs(); await clearQueueDb(); }
type Stack = { q: any; sync: any; acct: any };
type Impl = { name: string; tab: (id: string) => Stack };
const CUR: Impl = { name: 'R16', tab: (id) => { const t = openTab(id); return { q: t.q, sync: t.sync, acct: t.acct }; } };
function stackOf(name: string, sources: { q: string; sync: string; policy: string }): Impl {
  return {
    name,
    tab: (id) => {
      const t = openTab(id);
      const policy = compile(sources.policy, lib(`habitLogSyncPolicy.${name}.${seq++}.js`));
      const q = compile(sources.q, lib(`offlineHabitQueue.${name}.${seq++}.js`), { './habitLogSyncPolicy': policy });
      const sync = compile(sources.sync, lib(`activitySync.${name}.${seq++}.js`), { './offlineHabitQueue': q, './habitLogSyncPolicy': policy });
      return { q, sync, acct: t.acct };
    },
  };
}
const R15 = stackOf('R15', { q: fx('offlineHabitQueue.ts.txt'), sync: fx('activitySync.ts.txt'), policy: fx('habitLogSyncPolicy.ts.txt') });
const current = { q: src('offlineHabitQueue.ts'), sync: src('activitySync.ts'), policy: src('habitLogSyncPolicy.ts') };
const mutant = (name: string, part: keyof typeof current, edits: Array<[string, string]>) => stackOf(name, { ...current, [part]: patched(current[part], edits) });

const dev = new Device();
dev.extra['/api/plans'] = () => [];
dev.extra['/api/habits'] = () => [];
let n = 0;
async function tab(impl: Impl, owner = A) { dev.signIn(owner); const s = impl.tab(`${impl.name}-${owner}-${n++}`); await s.acct.fetchVerifiedSession(dev.fetch as any); return s; }
async function putDecision(s: Stack, d: Record<string, unknown>) { const db: IDBDatabase = await s.q.__openQueueDbForTests(); const t = db.transaction('tombstones', 'readwrite'); t.objectStore('tombstones').put(d); await new Promise<void>((ok) => { t.oncomplete = () => ok(); }); }
const posts = () => dev.count('POST', route);
const copies = async (crid: string) => (await queueDump()).records.filter((r: any) => r.clientRequestId === crid).length;
const decisionsOf = async (crid: string) => (await queueDump()).tombstones.filter((d: any) => d.clientRequestId === crid || String(d.recordId).endsWith(`\u0000${crid}`));

// ---- G4: receipts with matching ids
const fullRow = (id: string, extra: Record<string, unknown> = {}) => ({ id: 'srv-1', userId: A, clientRequestId: id, activityTitle: 'Original activity', activityId: null, activeWindow: 'NEUTRAL', logMinuteOfDay: 0, logTimestamp: '2026-11-24T06:00:00.000Z', durationMinutes: 30, notes: null, logSource: 'MANUAL', activitySignificance: 'MEDIUM', ...extra });
const omit = (o: Record<string, unknown>, ...keys: string[]) => Object.fromEntries(Object.entries(o).filter(([k]) => !keys.includes(k)));
function marker(s: Stack, id: string, v: number, row: unknown) {
  const pl = s.q.canonicalPayload(item(id));
  return { recordId: s.q.decisionKey(A, id), ownerUserId: A, clientRequestId: id, payload: pl, decision: 'settled', serverOutcome: 'accepted', fmt: 'r8', possiblySent: true, at: Date.now(), receipt: { v, kind: 'accepted', owner: A, crid: id, payload: pl, serverRecordId: 'srv-1', row, at: Date.now() } };
}
// ---- G5: refusals that never reach the writer
function refusing(status: number, bodyText: string, count = { n: 0 }): typeof fetch {
  return (async (input: any, init: any = {}) => {
    if (String(init.method ?? 'GET').toUpperCase() === 'POST' && String(input).endsWith(route)) { count.n++; return new Response(bodyText, { status, headers: { 'content-type': 'application/json' } }); }
    return dev.fetch(input, init);
  }) as any;
}
const REFUSALS: Array<[string, number, string]> = [
  ['JSON 429 "Temporary rate limit"', 429, JSON.stringify({ error: 'Temporary rate limit' })],
  ['JSON 429 gateway fallback', 429, JSON.stringify({ error: 'JSON gateway fallback' })],
  ['JSON 404 "User not found."', 404, JSON.stringify({ error: 'User not found.' })],
  ['JSON 400 "Unknown activity." (cannot be re-derived locally)', 400, JSON.stringify({ error: 'Unknown activity.' })],
  ['JSON 400 "Missing required fields." for a body WITH a title', 400, JSON.stringify({ error: 'Missing required fields.' })],
  ['JSON 400 "logTimestamp must be a valid date." for a VALID timestamp', 400, JSON.stringify({ error: 'logTimestamp must be a valid date.' })],
  ['JSON 422 unknown error', 422, JSON.stringify({ error: 'Unprocessable' })],
  ['JSON 400 without an error string', 400, JSON.stringify({ message: 'bad' })],
];

async function main() {
  // ================================================================ G4 witness (39258 probe) and matrix
  {
    const out: Record<string, any> = {};
    for (const impl of [R15, CUR]) {
      await fresh();
      const s = await tab(impl);
      const id = 'receipt-inconsistent-intent';
      await s.q.enqueueOwned({ ...body(id), tempId: 'first', ownerUserId: A });
      // the reviewer's exact marker: v1, matching ids, a row with a DIFFERENT title and missing intent fields
      const pl = s.q.canonicalPayload({ ...body(id), tempId: 'first' });
      await putDecision(s, { recordId: s.q.decisionKey(A, id), ownerUserId: A, clientRequestId: id, payload: pl, decision: 'settled', serverOutcome: 'accepted', fmt: 'r8', possiblySent: true, at: Date.now(), receipt: { v: 1, kind: 'accepted', owner: A, crid: id, payload: pl, serverRecordId: 'different-intent-row', at: Date.now(), row: { id: 'different-intent-row', userId: A, clientRequestId: id, activityTitle: 'Different activity' } } });
      const ops = await s.q.readActivityOperations(A);
      const p0 = posts();
      const r = await s.sync.submitActivityLog(body(id), 'retry', dev.fetch as any);
      out[impl.name] = { op: ops?.find((o: any) => o.clientRequestId === id)?.status, reply: r.kind, posts: posts() - p0, rows: rows(A).length, copies: await copies(id) };
    }
    console.log('G4', JSON.stringify(out));
    check('W G4 -- R15 (negative control) reproduces: a receipt whose row contradicts the intent -> operation "confirmed", already-recorded, 0 POSTs, 0 rows', out.R15.op === 'confirmed' && out.R15.reply === 'already-recorded' && out.R15.posts === 0 && out.R15.rows === 0);
    check('W G4 -- R16: the same marker proves nothing -> operation unresolved, outcome-unknown, 0 POSTs, 0 rows, the copy preserved', out.R16.op === 'unresolved' && out.R16.reply === 'outcome-unknown' && out.R16.posts === 0 && out.R16.rows === 0 && out.R16.copies === 1);
  }
  const g4: Array<[string, (id: string) => unknown]> = [
    ['contradictory title', (id) => fullRow(id, { activityTitle: 'Different activity' })],
    ['contradictory timestamp', (id) => fullRow(id, { logTimestamp: '2026-11-24T07:00:00.000Z' })],
    ['contradictory duration', (id) => fullRow(id, { durationMinutes: 45 })],
    ['contradictory source', (id) => fullRow(id, { logSource: 'AURA_DO_NOW' })],
    ['contradictory significance', (id) => fullRow(id, { activitySignificance: 'HIGH' })],
    ['contradictory notes', (id) => fullRow(id, { notes: 'something else' })],
    ['contradictory activity id', (id) => fullRow(id, { activityId: 'workout' })],
    ['incomplete: no notes field', (id) => omit(fullRow(id), 'notes')],
    ['incomplete: no activityId field', (id) => omit(fullRow(id), 'activityId')],
    ['incomplete: no logSource', (id) => omit(fullRow(id), 'logSource')],
    ['incomplete: no durationMinutes', (id) => omit(fullRow(id), 'durationMinutes')],
    ['malformed: duration as a string', (id) => fullRow(id, { durationMinutes: '30' })],
    ['malformed: unparseable timestamp', (id) => fullRow(id, { logTimestamp: 'yesterday-ish' })],
    ['malformed: row is an array', () => [1, 2]],
    ['malformed: row missing', () => undefined],
    ['record id mismatch (row id != serverRecordId)', (id) => fullRow(id, { id: 'srv-2' })],
  ];
  for (const [label, mk] of g4) {
    await fresh();
    const s = await tab(CUR);
    const id = `g4-${seq++}`;
    await s.q.enqueueOwned({ ...body(id), tempId: 't', ownerUserId: A });
    const m = marker(s, id, 2, mk(id));
    await putDecision(s, m);
    const auth = s.q.decisionAuthority(m, A, id, m.payload);
    const op = (await s.q.readActivityOperations(A))?.find((o: any) => o.clientRequestId === id);
    const p0 = posts();
    const r = await s.sync.submitActivityLog(body(id), 'retry', dev.fetch as any);
    const upgraded = await s.q.recordVerifiedReceipt(m.receipt);
    const settled = await s.q.settleRecords([], undefined, { owner: A, receipt: m.receipt });
    check(`G4 v2 receipt, matching ids, ${label}: no success on ANY consumer (authority ${auth.kind}, operation ${op?.status}, submit ${r.kind}, recovery upgrade ${upgraded}); 0 POSTs; copy preserved`, auth.kind === 'unverified' && op?.status === 'unresolved' && r.kind === 'outcome-unknown' && posts() === p0 && !upgraded && settled.removed === 0 && (await copies(id)) === 1 && rows(A).length === 0);
  }
  {
    await fresh();
    const s = await tab(CUR);
    const id = 'g4-valid';
    const m = marker(s, id, 2, fullRow(id));
    await putDecision(s, m);
    const r = await s.sync.submitActivityLog(body(id), 'retry', dev.fetch as any);
    const v1 = marker(s, 'g4-v1', 1, fullRow('g4-v1'));
    check('G4 control: a COMPLETE v2 receipt bound to the exact intent establishes success (already-recorded with its row; 0 POSTs); the same receipt as v1 does not', r.kind === 'already-recorded' && r.serverLog?.id === 'srv-1' && posts() === 0 && s.q.decisionAuthority(v1, A, 'g4-v1', v1.payload).kind === 'unverified');
  }

  // ================================================================ G5 witness (39258 probe) and matrix
  for (const mode of ['direct', 'replay'] as const) {
    const out: Record<string, any> = {};
    for (const impl of [R15, CUR]) {
      await fresh();
      const s = await tab(impl);
      const id = `unsupported-json-${mode}`;
      const count = { n: 0 };
      const f = refusing(429, JSON.stringify({ error: 'JSON gateway fallback' }), count);
      if (mode === 'replay') await s.q.enqueueOwned({ ...body(id), tempId: 'first', ownerUserId: A });
      const reply = mode === 'replay' ? await s.sync.replayOfflineQueue(f) : await s.sync.submitActivityLog(body(id), 'first', f);
      const kept = await copies(id), rejected = (await decisionsOf(id)).some((d: any) => d.receipt?.kind === 'rejected');
      Date.now = () => realNow() + 61_000; // past the claim lifetime
      const again = await s.sync.submitActivityLog(body(id), 'retry', dev.fetch as any, undefined, impl === CUR ? { explicitRetry: true } : undefined);
      Date.now = realNow;
      out[impl.name] = { reply: mode === 'direct' ? reply.kind : { removed: reply.removed, unverified: reply.unverified ?? 0 }, intercepted: count.n, kept, rejected, again: again.kind, rowsAfter: rows(A, id).length };
    }
    console.log(`G5-${mode}`, JSON.stringify(out));
    check(`W G5 ${mode} -- R15 (negative control) reproduces: a JSON 429 settles a DURABLE rejection and deletes the copy; the same-id retry never reaches the writer (0 rows)`, out.R15.intercepted === 1 && out.R15.kept === 0 && out.R15.rejected && out.R15.rowsAfter === 0);
    check(`W G5 ${mode} -- R16: the JSON 429 leaves it unresolved, the copy and id KEPT, no rejection recorded; the same-id retry reaches the writer -> confirmed, 1 row`, out.R16.intercepted === 1 && out.R16.kept === 1 && !out.R16.rejected && out.R16.again === 'confirmed' && out.R16.rowsAfter === 1 && (mode === 'direct' ? out.R16.reply === 'outcome-unknown' : out.R16.reply.removed === 0 && out.R16.reply.unverified === 1));
  }
  for (const [label, status, text] of REFUSALS) {
    for (const mode of ['direct', 'replay'] as const) {
      await fresh();
      const s = await tab(CUR);
      const id = `g5-${seq++}`;
      const f = refusing(status, text);
      if (mode === 'replay') await s.q.enqueueOwned({ ...body(id), tempId: 'first', ownerUserId: A });
      const reply = mode === 'replay' ? await s.sync.replayOfflineQueue(f) : await s.sync.submitActivityLog(body(id), 'first', f);
      const kept = await copies(id), anyReceipt = (await decisionsOf(id)).some((d: any) => d.receipt);
      const op = (await s.q.readActivityOperations(A))?.find((o: any) => o.clientRequestId === id);
      Date.now = () => realNow() + 61_000;
      const rp = await s.sync.replayOfflineQueue(dev.fetch as any);
      Date.now = realNow;
      check(`G5 ${mode} ${label}: unresolved (${mode === 'direct' ? reply.kind : `removed ${reply.removed}`}), copy + id kept (${op?.status}), nothing recorded; the later same-id replay reaches the writer -> 1 row`, (mode === 'direct' ? reply.kind === 'outcome-unknown' : reply.removed === 0) && kept === 1 && !anyReceipt && op?.status === 'pending' && rp.confirmed === 1 && rows(A, id).length === 1);
    }
  }
  {
    // a definitive refusal AFTER a possible earlier send is not settled either (kept, unresolved)
    await fresh();
    const s = await tab(CUR);
    const id = 'after-send';
    const pBefore = posts();
    dev.fault('POST', route, 'network-before');
    await s.sync.submitActivityLog({ ...body(id), logTimestamp: 'not-a-date' } as any, 'tmp', dev.fetch as any);
    Date.now = () => realNow() + 61_000;
    const r = await s.sync.submitActivityLog({ ...body(id), logTimestamp: 'not-a-date' } as any, 'tmp', dev.fetch as any, undefined, { explicitRetry: true });
    Date.now = realNow;
    console.log('after-send', JSON.stringify({ r: r.kind, posts: posts(), copies: await copies(id), decisions: (await decisionsOf(id)).length }));
    check(`G5 a body the route would refuse definitively is never re-dispatched after a possible earlier send (its stored copy is damaged -> paused: ${r.kind}); nothing is settled and the copy is kept`, r.kind === 'not-stored' && !(await decisionsOf(id)).some((d: any) => d.receipt) && (await copies(id)) === 1 && posts() - pBefore === 1);
  }

  // ================================================================ negative controls for G4 / G5
  {
    const noBinder = mutant('N9-receipt-without-binder', 'q', [["    const bound = bindServerRow(x.row, { account: owner, clientRequestId: crid, body });\n    if (!bound.ok || bound.row.id !== x.serverRecordId) return null;", "    const row = x.row as any; if (!row || row.id !== x.serverRecordId || row.userId !== owner || row.clientRequestId !== crid) return null;"]]);
    await fresh();
    const s = await tab(noBinder);
    const id = 'n9';
    await s.q.enqueueOwned({ ...body(id), tempId: 't', ownerUserId: A });
    await putDecision(s, marker(s, id, 2, fullRow(id, { activityTitle: 'Different activity' })));
    const r = await s.sync.submitActivityLog(body(id), 'retry', dev.fetch as any);
    check(`N9 consuming a receipt WITHOUT the row binder is detected (the G4 check fails: ${r.kind} with 0 rows)`, r.kind === 'already-recorded' && rows(A).length === 0);

    // N10 the R15 refusal rule (any JSON error string is definitive) in the decoder, alone and combined with the R15
    // rejected-receipt reader: the decoder check detects the first; the G5 copy check detects the full path.
    const r15Rule: Array<[string, string]> = [["    const reason = definitiveRefusal(expect.body, res.status, err);\n    if (!reason) return { kind: 'unverified', reason: 'unsupported-refusal' };", "    const reason = (typeof err === 'string' && err ? 'missing-title' : null) as any;\n    if (!reason) return { kind: 'unverified', reason: 'unsupported-refusal' };"]];
    const mPolicy = compile(patched(current.policy, r15Rule), lib(`habitLogSyncPolicy.N10.${seq++}.js`));
    const cPolicy = require('../apps/web/lib/habitLogSyncPolicy');
    const mk429 = () => new Response(JSON.stringify({ error: 'Temporary rate limit' }), { status: 429, headers: { 'content-type': 'application/json' } });
    const expect429 = { account: A, clientRequestId: 'n10', body: body('n10') as any };
    const dm = await mPolicy.decodeHabitLogResponse(mk429(), expect429, () => true, 'client_upgrade_required');
    const dc = await cPolicy.decodeHabitLogResponse(mk429(), expect429, () => true, 'client_upgrade_required');
    check(`N10a the R15 refusal rule in the decoder is detected (decoded ${dm.kind}; R16 decodes ${dc.kind})`, dm.kind === 'rejected' && dc.kind === 'unverified');
    const fullR15Refusal = stackOf('N10b', { ...current, policy: patched(current.policy, r15Rule), q: patched(current.q, [["  if (x.kind === 'rejected' && typeof x.status === 'number' && x.afterPossibleSend === false && typeof x.reason === 'string' && x.reason in DEFINITIVE_REFUSALS) {", "  if (x.kind === 'rejected') return x as any;\n  if (x.kind === 'rejected' && typeof x.status === 'number' && x.afterPossibleSend === false && typeof x.reason === 'string' && x.reason in DEFINITIVE_REFUSALS) {"]]) });
    await fresh();
    const s2 = await tab(fullR15Refusal);
    await s2.sync.submitActivityLog(body('n10'), 'first', refusing(429, JSON.stringify({ error: 'Temporary rate limit' })));
    check(`N10b the full R15 refusal path (decoder rule + permissive rejected receipt) is detected by the G5 check (copy deleted: ${await copies('n10')} left, rejection recorded)`, (await copies('n10')) === 0 && (await decisionsOf('n10')).some((d: any) => d.receipt?.kind === 'rejected'));

    const settleAnyway = mutant('N12-settle-with-invalid-receipt', 'q', [["        if (opts.receipt && !receipt) { out.paused!++; continue; }\n", ""]]);
    await fresh();
    const s3 = await tab(settleAnyway);
    await s3.q.enqueueOwned({ ...body('n12'), tempId: 't', ownerUserId: A });
    const rec = (await queueDump()).records.find((x: any) => x.clientRequestId === 'n12');
    const bad = { v: 2, kind: 'accepted', owner: A, crid: 'n12', payload: s3.q.canonicalPayload(item('n12')), serverRecordId: 'srv-1', row: fullRow('n12', { activityTitle: 'Different activity' }), at: 1 };
    await s3.q.settleRecords([rec.recordId], undefined, { owner: A, receipt: bad });
    check('N12 letting an INVALID receipt settle (deletion without authority) is detected (the copy is deleted)', (await copies('n12')) === 0);
    await fresh();
    const s4 = await tab(CUR);
    await s4.q.enqueueOwned({ ...body('n12c'), tempId: 't', ownerUserId: A });
    const rec4 = (await queueDump()).records.find((x: any) => x.clientRequestId === 'n12c');
    await s4.q.settleRecords([rec4.recordId], undefined, { owner: A, receipt: { ...bad, crid: 'n12c', payload: s4.q.canonicalPayload(item('n12c')), row: fullRow('n12c', { activityTitle: 'Different activity' }) } });
    check('G4 bypass review: settlement with an invalid receipt removes NOTHING and writes no decision (R16)', (await copies('n12c')) === 1 && (await decisionsOf('n12c')).length === 0);
  }

  // ================================================================ G6: the shared recovery contract through the real page
  (global as any).fetch = dev.fetch; (window as any).fetch = dev.fetch;
  (global as any).requestAnimationFrame = (f: any) => setTimeout(f, 0); (global as any).cancelAnimationFrame = (id: any) => clearTimeout(id);
  (window as any).confirm = () => true; (window as any).alert = () => {};
  for (const k of ['HTMLElement', 'HTMLInputElement', 'HTMLButtonElement', 'HTMLDivElement', 'Node', 'Element', 'FocusEvent']) if ((window as any)[k] && !(global as any)[k]) (global as any)[k] = (window as any)[k];
  closeAllTabs();
  const pageAcct = require('../apps/web/lib/accountSession');
  const pageQ = require('../apps/web/lib/offlineHabitQueue');
  const pageRecon = require('../apps/web/lib/pendingReplayReconciliation');
  const realFind = pageRecon.findRecoverableOperation;
  const Page = require('../apps/web/app/page').default;
  const settle = async (k = 30) => { for (let i = 0; i < k; i++) await flush(); };
  const textOf = (_el: HTMLElement) => (document.body.textContent ?? '').replace(/\s+/g, ' ');
  const UNVERIFIED = "Couldn't verify whether this activity was saved.";
  /** POSTs reach the route (they commit); their acknowledgement is replaced by an HTML 200 ('next': the next one only). */
  let ackHtml: 'off' | 'next' | 'all' = 'off';
  (global as any).fetch = (window as any).fetch = async (input: any, init: any = {}) => {
    const res = await dev.fetch(input, init);
    if (ackHtml !== 'off' && String(init.method ?? 'GET').toUpperCase() === 'POST' && String(input).endsWith(route)) { if (ackHtml === 'next') ackHtml = 'off'; return new Response('<html>Unverified acknowledgement</html>', { status: 200, headers: { 'content-type': 'text/html' } }); }
    return res;
  };
  async function page(opts: { keepStore?: boolean } = {}) {
    Date.now = realNow;
    if (!opts.keepStore) { resetStore(); storage.clear(); await pageQ.__resetQueueDbForTests(); await clearQueueDb(); }
    pageAcct.__resetAccountSessionForTests(`page-${seq++}`);
    dev.signIn(A);
    window.history.replaceState(null, '', '/?tab=activity'); // the Activity Log (Calendar) surface
    const h = await mount(React.createElement(Page));
    await settle();
    const c = h.container as HTMLElement;
    const buttons = () => [...document.querySelectorAll('button')] as HTMLButtonElement[]; // incl. portalled modals
    const byText = (t: string | RegExp) => buttons().find((b) => (typeof t === 'string' ? (b.textContent ?? '').trim() === t : t.test((b.textContent ?? '').trim())));
    const press = async (t: string | RegExp) => { const b = byText(t); if (!b) return false; await act(async () => { await click(b); }); await settle(6); return true; };
    const openCalendarModal = async () => press('+ Log Activity');
    const fillAndSave = async (title: string) => {
      const t = document.querySelector('#quick-log-activity') as HTMLInputElement | null; if (!t) return false;
      await typeInto(t, title);
      const time = document.querySelector('input[type="time"]') as HTMLInputElement | null; if (time) await typeInto(time, '10:00');
      await settle(4);
      return press(/^Save "/);
    };
    return { h, c, byText, press, openCalendarModal, fillAndSave };
  }
  const ids = () => [...new Set(rows(A).map((l: any) => l.clientRequestId))];
  async function calendarRun(label: string, options: { negative?: boolean; restart?: boolean; separate?: boolean } = {}) {
    if (options.negative) pageRecon.findRecoverableOperation = () => undefined;
    try {
      let P = await page();
      const opened = await P.openCalendarModal();
      ackHtml = options.restart ? 'all' : 'next'; // restart: every answer stays unverifiable until the recovery step
      await P.fillAndSave('Review same operation');
      await settle();
      const firstUnresolved = textOf(P.c).includes(UNVERIFIED);
      const original = ids()[0];
      // leave: close the modal, back to You, reopen the Activity Log (a fresh Calendar mount) -- or a full restart
      await P.press('Cancel'); await P.press('Back to You');
      if (options.restart) { await P.h.unmount(); P = await page({ keepStore: true }); }
      else await P.press(/Activity Log/i);
      const noticeOnReturn = textOf(P.c).includes(UNVERIFIED);
      await P.press('+ Log Activity');
      const p0 = posts();
      await P.fillAndSave('Review same operation'); // the identical re-entry
      await settle();
      const blocked = posts() === p0 && textOf(P.c).includes(UNVERIFIED) && Boolean(P.byText('Retry that entry'));
      const afterReentry = { rows: rows(A).length, ids: ids().length };
      ackHtml = 'off';
      let recovered = false, afterRecovery = { rows: 0, ids: 0, originalKept: false };
      if (options.separate) recovered = await P.press('Save as a separate activity'); // a deliberately separate activity
      else recovered = await P.press('Retry that entry'); // THAT operation, under its original id
      await settle();
      afterRecovery = { rows: rows(A).length, ids: ids().length, originalKept: ids().includes(original) };
      await P.h.unmount();
      const r = { opened, firstUnresolved, original: Boolean(original), noticeOnReturn, blocked, afterReentry, recovered, afterRecovery };
      console.log(`G6 ${label}`, JSON.stringify(r));
      return r;
    } finally { pageRecon.findRecoverableOperation = realFind; ackHtml = 'off'; }
  }
  {
    const neg = await calendarRun('negative control (shared recovery contract disabled)', { negative: true });
    check('N11 disabling the shared recovery contract is detected: the identical Calendar re-entry after remount sends a second request and creates a fresh-id duplicate (2 rows, 2 ids)', neg.opened && neg.firstUnresolved && !neg.blocked && neg.afterReentry.rows === 2 && neg.afterReentry.ids === 2);
    const rem = await calendarRun('remount');
    check('G6 Calendar remount (navigate away and back): the unresolved operation is shown on return; the identical re-entry is WITHHELD (no POST) with THAT operation\'s recovery offered -- 1 row, 1 id', rem.opened && rem.firstUnresolved && rem.noticeOnReturn && rem.blocked && rem.afterReentry.rows === 1 && rem.afterReentry.ids === 1);
    check('G6 Calendar remount: "Retry that entry" resumes the ORIGINAL id -> still 1 row, 1 id', rem.recovered && rem.afterRecovery.rows === 1 && rem.afterRecovery.ids === 1 && rem.afterRecovery.originalKept);
    const sep = await calendarRun('separate', { separate: true });
    check('G6 a deliberately SEPARATE identical activity stays possible: "Save as a separate activity" creates a second operation and row (2 rows, 2 ids; the original kept)', sep.blocked && sep.recovered && sep.afterRecovery.rows === 2 && sep.afterRecovery.ids === 2 && sep.afterRecovery.originalKept);
    const rst = await calendarRun('restart', { restart: true });
    check('G6 restart (page remounted: memory gone, durable store kept; every answer still unverifiable): the identical re-entry is withheld (no POST, 1 row); Retry resumes the original id -> 1 row, 1 id', rst.opened && rst.firstUnresolved && rst.blocked && rst.afterReentry.rows === 1 && rst.recovered && rst.afterRecovery.rows === 1 && rst.afterRecovery.ids === 1);
  }
  {
    // Home and Timeline go through the SAME contract: an open operation for "Workout" (from durable storage)
    // withholds Timeline's / Home's fresh submission; the error names that operation.
    await fresh();
    const s = await tab(CUR);
    dev.fault('POST', route, 'network-before');
    const queued = await s.sync.submitActivityLog({ ...body('open-workout', 'Workout'), logSource: 'AURA_DO_NOW' } as any, 'tmp', dev.fetch as any);
    closeAllTabs();
    const P = await page({ keepStore: true });
    const banner = textOf(P.c);
    const handlerSrc = fs.readFileSync(path.join(WEB, 'app', 'page.tsx'), 'utf8');
    const oneEntry = (handlerSrc.match(/findRecoverableOperation\(/g) ?? []).length === 1 && /throw new ActivityRecoveryRequiredError\(open\.clientRequestId, open\.activityTitle\)/.test(handlerSrc);
    const surfaces = ['HomeDashboard.tsx', 'Timeline.tsx', 'PastActivityModal.tsx'].every((f) => /recoveryOperationOf\(err\)/.test(fs.readFileSync(path.join(WEB, 'components', f), 'utf8')));
    const noLocalReconciliation = !/resolvePendingActivityStatus/.test(fs.readFileSync(path.join(WEB, 'components', 'HomeDashboard.tsx'), 'utf8') + fs.readFileSync(path.join(WEB, 'components', 'Timeline.tsx'), 'utf8') + fs.readFileSync(path.join(WEB, 'components', 'PastActivityModal.tsx'), 'utf8') + fs.readFileSync(path.join(WEB, 'components', 'CalendarViewSection.tsx'), 'utf8'));
    await P.h.unmount();
    check(`G6 one shared recovery contract: page.tsx handleLogActivity is the single gate (${oneEntry}); Home, Timeline and Past Activity consume its error (${surfaces}); no view-specific reconciliation (${noLocalReconciliation}); the queued operation (${queued.kind}) is restart-visible`, oneEntry && surfaces && noLocalReconciliation && queued.kind === 'queued' && banner.length > 0);
  }
  finish();
}
main().catch((e) => { console.error(e); process.exit(1); });
