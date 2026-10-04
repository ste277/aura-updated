/**
 * Constructor Decision Intelligence -- O5 P2d: the DECISION SCHEDULING CONTEXT (architecture guard, pure).
 *
 * Pins that every database-derived input of the decision evidence is read ONCE, inside ONE PostgreSQL REPEATABLE READ
 * transaction, into a detached deep-frozen context -- and that nothing else happens inside that transaction:
 *
 *   - the isolation level actually EMITTED is REPEATABLE READ (not SERIALIZABLE, no row lock, no advisory lock, no write)
 *   - exactly one production module opens the snapshot and exactly one production route acquires a context, once per
 *     evaluation (no per-candidate transaction), through an executor that is SELECT-only and unusable after the snapshot
 *   - the callback contains the seven database reads and NOTHING else: no Constructor, no opportunity projection, no timing
 *     search, no Rhythm counting, no duration resolution, no loop, no network call -- all CPU follows the transaction
 *   - the transaction executor / client never escapes (the context module has no database type or method; the loader's
 *     result carries no executor)
 *   - the read SQL is byte-for-byte the SQL the live providers always ran (hash-pinned): relocating the reads changed no
 *     lifecycle, overlap, civil-date or Rhythm semantics
 *   - the preview boundary's binding REPLACES the independent live providers and never falls back to them; the production
 *     route does not wire the live providers at all
 *   - the Constructor, comparator, placement, capacity, replenishment, evidence, pressure, shadow, trace, acceptance,
 *     persistence and Recomposition code do not know the context
 *
 * Every rule is a PURE FUNCTION over source files: it runs on the real tree (zero violations expected) AND on the tree with
 * a synthetic violation injected, proving each rule fires. P2d does not activate pressure, change precedence or add P4.
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}
const root = path.join(__dirname, '..');
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8');
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const count = (re: RegExp, s: string) => (s.match(re) ?? []).length;

interface SrcFile { f: string; src: string }
function productionFiles(): SrcFile[] {
  const out: SrcFile[] = [];
  const walk = (dir: string) => fs.readdirSync(path.join(root, dir), { withFileTypes: true }).forEach((e) => {
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules' && !e.name.startsWith('.')) walk(rel); } else if (/\.(ts|tsx)$/.test(e.name) && !/\.d\.ts$/.test(e.name)) out.push({ f: rel, src: stripComments(read(rel)) });
  });
  ['apps/web/lib', 'apps/web/app', 'apps/web/components'].forEach(walk);
  fs.readdirSync(path.join(root, 'packages'), { withFileTypes: true }).forEach((p) => { if (p.isDirectory() && fs.existsSync(path.join(root, 'packages', p.name, 'src'))) walk(path.join('packages', p.name, 'src')); });
  return out.sort((a, b) => (a.f < b.f ? -1 : 1));
}

const DB = 'apps/web/lib/db.ts';
const LOADER = 'apps/web/lib/decisionSchedulingContextLoader.ts';
const CONTEXT = 'apps/web/lib/decisionSchedulingContext.ts';
const PREVIEW = 'apps/web/lib/dayConstructorPreviewRequest.ts';
const ROUTE = 'apps/web/app/api/day-constructor/preview/route.ts';
const PROVIDER = 'apps/web/lib/goalDecisionFactsProvider.ts';
const ORCH = 'apps/web/lib/dayConstructorOrchestrator.ts';
/** The only production files that name the context at all. */
const CONTEXT_NAMING_ALLOW = [CONTEXT, LOADER, PREVIEW, ROUTE, PROVIDER];
const CONTEXT_IDENT = /DecisionSchedulingContext|decisionSchedulingContext|DecisionSchedulingBinding|schedulingContext|SchedulingContext|schedulingBinding/;
/** The seven reads inside the snapshot, in order. Each is a function that already existed (or, for the occurrence rows and the availability flag, the SAME SQL split out) and takes the executor as its last argument. */
const SNAPSHOT_READS = ['loadCandidateGoalActivitiesForRhythmDemand', 'listGoalActivityOccurrenceRowsForActivities', 'listUserActivityPreferenceRows', 'listHabitLogs', 'readUserAvailabilityConfigured', 'listUserAvailabilityPeriods', 'listPlannedActivitiesOverlappingRange'];
/** SQL hashes of the read functions at the P3b baseline: relocating the reads must not change a statement. */
const SQL_PINS: Record<string, string> = {
  loadCandidateGoalActivitiesForRhythmDemand: '0903d372d2fc9c8c',
  listGoalActivityOccurrenceRowsForActivities: '15d09f004da4ef97',
  listUserActivityPreferenceRows: 'f38cabdfd8929bb5',
  listHabitLogs: '5dde9aca259966b5',
  listUserAvailabilityPeriods: '730c50d711a8d9dc',
  listPlannedActivitiesOverlappingRange: '8c48ffe3a285922d',
  readUserAvailabilityConfigured: 'b80f23bbcf111f87',
};

function fnBody(src: string, header: string): string {
  const start = src.indexOf(header);
  if (start < 0) return '';
  const open = src.indexOf('{', src.indexOf(')', start));
  let depth = 0;
  for (let i = open; i < src.length; i++) { if (src[i] === '{') depth++; else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(start, i + 1); } }
  return '';
}
/** The text of the callback handed to `runSnapshot<...>(async (executor) => { ... })` in the loader. */
function snapshotCallback(loader: string): string {
  const marker = 'runSnapshot<DecisionSchedulingContextParts>(async (executor) => {';
  const start = loader.indexOf(marker);
  if (start < 0) return '';
  let depth = 1; let i = start + marker.length;
  for (; i < loader.length && depth > 0; i++) { if (loader[i] === '{') depth++; else if (loader[i] === '}') depth--; }
  return loader.slice(start + marker.length, i - 1);
}
const IDS_PROJECTION = 'candidateRows.map((row) => row.goalActivityId)';
/** Each awaited call in the callback: its name, and whether its statement ends with the executor as the last argument. */
function callbackReads(cb: string): { name: string; viaExecutor: boolean }[] {
  return cb.split('await ').slice(1).map((seg) => ({ name: (seg.match(/^(\w+)\(/) ?? [])[1] ?? '?', viaExecutor: /executor\)(;| : \[\];)/.test(seg.split('\n')[0]) }));
}
const CPU_IN_TX = /\bconstructDay|orchestrate|projectOpportunity|computeOpportunityDecisionFacts|loadOpportunityRangeInputs|adaptOpportunityRangeInputs|runTimingSearch|searchTiming|computeGoalActivityRhythmEligibility|durationMinutesFor|buildDurationContext|deriveBehavioralProfile|fetch\(|setTimeout|new Date\(|Date\.now|\bfor \(|\bwhile \(|\.map\(|\.forEach\(|\.filter\(/;
function sqlHash(rawDb: string, name: string): string {
  const i = rawDb.indexOf(`export async function ${name}(`);
  if (i < 0) return 'MISSING';
  const body = rawDb.slice(i, rawDb.indexOf('\n}\n', i));
  const sqls = [...body.matchAll(/`([^`]*)`|'(SELECT[^']*)'/g)].map((m) => (m[1] || m[2]).replace(/\s+/g, ' ').trim()).filter((s) => /^(SELECT|WITH)/i.test(s));
  return crypto.createHash('sha256').update(sqls.join('\n')).digest('hex').slice(0, 16);
}

function audit(files: SrcFile[]): string[] {
  const v: string[] = [];
  const get = (f: string) => files.find((x) => x.f === f);
  const by = (re: RegExp) => files.filter((x) => re.test(x.src)).map((x) => x.f);
  const notIn = (list: string[], allow: string[]) => list.filter((f) => !allow.includes(f));
  // T1 -- who may open a snapshot / acquire a context
  notIn(by(/\bwithRepeatableReadSnapshot\b/), [DB, LOADER]).forEach((f) => v.push(`T1:opens-a-snapshot:${f}`));
  notIn(by(/\bloadDecisionSchedulingContext\(/), [LOADER, ROUTE]).forEach((f) => v.push(`T1:acquires-a-context:${f}`));
  notIn(by(CONTEXT_IDENT), CONTEXT_NAMING_ALLOW).forEach((f) => v.push(`T1:names-the-context:${f}`));
  // T2 -- the transaction helper
  const db = get(DB);
  if (db) {
    const helper = fnBody(db.src, 'export async function withRepeatableReadSnapshot');
    if (count(/BEGIN ISOLATION LEVEL REPEATABLE READ/g, helper) !== 1) v.push(`T2:isolation-is-not-exactly-repeatable-read:${DB}`);
    if (/SERIALIZABLE|READ COMMITTED|FOR UPDATE|FOR SHARE|LOCK TABLE|pg_advisory|INSERT|UPDATE |DELETE/.test(helper)) v.push(`T2:snapshot-helper-escalates-locks-or-writes:${DB}`);
    if (!/\^\\s\*\(SELECT\|WITH\)\\b/.test(helper) || !/open = false/.test(helper) || !/ROLLBACK/.test(helper) || !/COMMIT/.test(helper) || !/client\.release\(\)/.test(helper)) v.push(`T2:snapshot-helper-lost-a-guard:${DB}`);
    if (/read\(client|return client;|read\(executor as/.test(helper)) v.push(`T2:transaction-client-escapes:${DB}`);
    for (const name of SNAPSHOT_READS) {
      const body = fnBody(db.src, `export async function ${name}`);
      if (!/executor: ReadQueryExecutor = pool/.test(body) || /\bpool\.query\(/.test(body) || !/executor\.query\(/.test(body)) v.push(`T2:read-not-executor-parameterized:${name}`);
    }
  }
  // T3 -- the loader
  const loader = get(LOADER);
  if (loader) {
    const cb = snapshotCallback(loader.src);
    const reads = callbackReads(cb);
    if (JSON.stringify(reads.map((r) => r.name)) !== JSON.stringify(SNAPSHOT_READS)) v.push(`T3:snapshot-callback-is-not-exactly-the-seven-reads:${LOADER}`);
    if (!reads.every((r) => r.viaExecutor)) v.push(`T3:a-read-bypasses-the-snapshot-executor:${LOADER}`);
    if (CPU_IN_TX.test(cb.replace(IDS_PROJECTION, ''))) v.push(`T3:cpu-or-constructor-or-loop-inside-the-snapshot:${LOADER}`);
    if (cb.replace(/, executor\)/g, ')').replace(/\(async \(executor\)/g, '').match(/\bexecutor\b/)) v.push(`T3:transaction-executor-escapes-the-callback:${LOADER}`);
    if (count(/runSnapshot<|runSnapshot\(/g, loader.src) !== 1) v.push(`T3:not-exactly-one-snapshot-per-evaluation:${LOADER}`);
    for (const name of SNAPSHOT_READS) if (count(new RegExp(`\\b${name}\\(`, 'g'), loader.src) !== 1) v.push(`T3:read-outside-or-duplicated:${name}`);
    if (loader.src.indexOf('createDecisionSchedulingContext(parts)') < loader.src.indexOf('const parts = await runSnapshot')) v.push(`T3:context-built-before-the-snapshot-ended:${LOADER}`);
    if (/INSERT|UPDATE |DELETE|TRUNCATE|FOR UPDATE|FOR SHARE|LOCK TABLE|pg_advisory|SERIALIZABLE/.test(loader.src)) v.push(`T3:loader-writes-or-locks:${LOADER}`);
  }
  // T4 -- the context module: data and pure derivations only; no database, no executor, no policy
  const ctx = get(CONTEXT);
  if (ctx) {
    if (/^import (?!type )[^\n]*from '\.\/db'/m.test(ctx.src) || /\bReadQueryExecutor|PoolClient|\bPool\b|\.query\(|runSnapshot|withRepeatableReadSnapshot|\bpool\b/.test(ctx.src)) v.push(`T4:context-holds-a-database-handle:${CONTEXT}`);
    if (/DecisionPressure|LAST_KNOWN_OPPORTUNITY|DecisionEvidence|DecisionFacts|ShadowPressure|ContentionTrace|promot|constructDay|opportunityProjection|projectOpportunity/.test(ctx.src)) v.push(`T4:context-names-policy-or-construction:${CONTEXT}`);
    if (!/function deepFreeze/.test(ctx.src) || !/return deepFreeze\(/.test(ctx.src) || !/Object\.freeze\(value\)/.test(ctx.src)) v.push(`T4:context-is-not-deep-frozen:${CONTEXT}`);
    if (/new Date\(\)|Date\.now|process\.|console\.|fetch\(|\basync function [A-Za-z]+\([^)]*\)[^{]*\{[^}]*\bawait\b/.test(ctx.src.replace(/async \(\) =>[\s\S]*?\n    \},?/g, ''))) v.push(`T4:context-reads-a-clock-or-environment:${CONTEXT}`);
  }
  // T5 -- the preview boundary: the binding replaces the live providers and never falls back to them
  const pv = get(PREVIEW);
  if (pv) {
    const start = pv.src.indexOf('if (schedulingBinding) {');
    const end = pv.src.indexOf('} else if (decisionFactsSource) {', start);
    const branch = start >= 0 && end > start ? pv.src.slice(start, end) : '';
    if (!branch) v.push(`T5:binding-branch-not-found:${PREVIEW}`);
    if (/decisionFactsSource\(|opportunityRangeDeps|createRealOpportunityRangeDeps|createRealGoalDemandCandidatesDeps|listPlannedActivities|listUserAvailabilityPeriods/.test(branch)) v.push(`T5:binding-falls-back-to-live-reads:${PREVIEW}`);
    if (count(/schedulingBinding\.loadContext\(/g, pv.src) !== 1 || !/orchestrationDeps = deps;/.test(branch)) v.push(`T5:binding-not-one-context-or-no-reset-on-failure:${PREVIEW}`);
    if (!/loadDurationContext: async \(\) => schedulingContextDurationContext\(coherent, timezone, now\)/.test(branch) || !/prepareDecisionFacts: createDecisionFactPreparer\(schedulingContextOpportunityRangeDeps\(coherent\)\)/.test(branch)) v.push(`T5:binding-does-not-feed-duration-and-opportunity-from-the-context:${PREVIEW}`);
  }
  const rt = get(ROUTE);
  if (rt) {
    if (/\bloadDecisionFacts:|\bcreateOpportunityRangeDeps:|createRealOpportunityRangeDeps|createRealGoalDemandCandidatesDeps/.test(rt.src) || count(/loadSchedulingContext:/g, rt.src) !== 1 || count(/loadDecisionFactsFromContext:/g, rt.src) !== 1) v.push(`T5:route-wires-live-providers-or-no-context:${ROUTE}`);
  }
  // T6 -- the context-backed Goal deps read the context only
  const pr = get(PROVIDER);
  if (pr) {
    const body = fnBody(pr.src, 'export function createGoalDemandDepsFromSchedulingContext');
    if (!body || /\bpool\b|\.query\(|await (?!Promise)load\w+\(|listGoalActivity|loadCandidateGoalActivitiesForRhythmDemand|loadGoalActivityRhythmFactsForActivities/.test(body)) v.push(`T6:context-backed-deps-read-the-database:${PROVIDER}`);
  }
  // T7 -- evidence, pressure, shadow, trace, Constructor, comparator, capacity, acceptance and orchestrator do not know the context
  for (const f of ['apps/web/lib/dayConstructor.ts', 'apps/web/lib/dayIntent.ts', 'apps/web/lib/dayCapacity.ts', ORCH, 'apps/web/lib/decisionEvidence.ts', 'apps/web/lib/decisionFactPreparation.ts', 'apps/web/lib/decisionFacts.ts', 'apps/web/lib/decisionPressure.ts', 'apps/web/lib/shadowPressureEvaluation.ts', 'apps/web/lib/shadowPressureObservation.ts', 'apps/web/lib/contentionTrace.ts', 'apps/web/lib/opportunityProjection.ts', 'apps/web/lib/opportunityDecisionFacts.ts', 'apps/web/lib/dayConstructorAcceptance.ts', 'apps/web/lib/dayConstructorAcceptancePersistence.ts', 'apps/web/lib/remainingDayRecomposition.ts', 'apps/web/lib/planMove.ts']) {
    const x = get(f); if (x && CONTEXT_IDENT.test(x.src)) v.push(`T7:module-names-the-context:${f}`);
  }
  return v;
}
const real = productionFiles();
const src = (f: string) => real.find((x) => x.f === f)!.src;
const rawDb = read(DB);
const mutateFile = (files: SrcFile[], f: string, fn: (s: string) => string): SrcFile[] => files.map((x) => (x.f === f ? { f, src: fn(x.src) } : x));
const addFile = (files: SrcFile[], f: string, s: string): SrcFile[] => [...files, { f, src: s }];
const flags = (violations: string[], prefix: string, file?: string) => violations.some((x) => x.startsWith(prefix) && (file === undefined || x.endsWith(`:${file}`)));
const names = (re: RegExp) => real.filter((x) => re.test(x.src)).map((x) => x.f);

console.log('=== the real tree conforms ===');
const baseline = audit(real);
check(`THE REAL PRODUCTION TREE HAS ZERO SCHEDULING-SNAPSHOT ARCHITECTURE VIOLATIONS (${real.length} production files scanned)${baseline.length ? ': ' + baseline.join(', ') : ''}`, baseline.length === 0);

console.log('=== the transaction: actual REPEATABLE READ, nothing else ===');
const helper = fnBody(src(DB), 'export async function withRepeatableReadSnapshot');
check('ACTUAL ISOLATION LEVEL: the helper issues exactly one `BEGIN ISOLATION LEVEL REPEATABLE READ` -- not the default, not SERIALIZABLE -- (the DB suite proves `transaction_isolation` reads "repeatable read" and that a commit after the snapshot is invisible, with a READ COMMITTED control that does see it)', count(/BEGIN ISOLATION LEVEL REPEATABLE READ/g, helper) === 1 && !/SERIALIZABLE|READ COMMITTED/.test(helper) && count(/withRepeatableReadSnapshot/g, src(DB)) === 1);
check('NO ESCALATION: no row lock (FOR UPDATE / FOR SHARE), table lock, advisory lock or write in the helper, the loader or the context -- so there is no new deadlock surface; and no retry loop (a read-only snapshot needs none)', !/FOR UPDATE|FOR SHARE|LOCK TABLE|pg_advisory|SERIALIZABLE|INSERT|UPDATE |DELETE/.test(helper + src(LOADER) + src(CONTEXT)) && !/\bfor \(|\bwhile \(|retry|attempt/i.test(helper + src(LOADER)));
check('SNAPSHOT START IS DOCUMENTED: PostgreSQL takes the snapshot at the FIRST non-transaction-control statement, not at BEGIN (the first read is the candidates query); this is stated in the helper and the loader, and the DB suite pins it by committing before / after every statement', /FIRST non-transaction-control statement/.test(rawDb) && /first statement: PostgreSQL takes the snapshot here/.test(read(LOADER)));
check('READ-ONLY AT THE APPLICATION LEVEL: the executor accepts one SELECT / WITH statement only, stops working when the callback settles, and the transaction is committed (it wrote nothing) or rolled back, with the connection always released; the client is never handed to the callback', /\^\\s\*\(SELECT\|WITH\)\\b/.test(helper) && /;\\s\*\\S/.test(helper) && /open = false/.test(helper) && /client\.release\(\)/.test(helper) && /await client\.query\('COMMIT'\)/.test(helper) && /ROLLBACK/.test(helper) && !/read\(client\)/.test(helper));
check('the executor type is the narrowest thing a read needs: `ReadQueryExecutor` has exactly one member, `query`, and no release / connect / end / transaction control', /export interface ReadQueryExecutor \{\s*query\(text: string, params\?: unknown\[\]\): Promise<\{ rows: any\[\] \}>;\s*\}/.test(src(DB)));
check('THE SEVEN READS TAKE THE EXECUTOR (default: the global pool, so every existing caller is unchanged) and use it, never `pool.query`: candidates, occurrence rows, preferences, habit logs, availability flag, availability periods, overlapping plans', SNAPSHOT_READS.every((n) => { const b = fnBody(src(DB), `export async function ${n}`); return /executor: ReadQueryExecutor = pool/.test(b) && /executor\.query\(/.test(b) && !/\bpool\.query\(/.test(b); }));
check('READ SQL IS UNCHANGED (hash-pinned to the P3b baseline): the lifecycle filters, the half-open overlap, the candidate eligibility join, the occurrence join, the 50-log window and the availability ordering are byte-for-byte the SQL the live providers always ran', Object.entries(SQL_PINS).every(([n, h]) => sqlHash(rawDb, n) === h));
check('the existing live Rhythm facts function still exists and is now the raw read plus the pure mapping (no second counting implementation): `loadGoalActivityRhythmFactsForActivities` = `buildGoalActivityRhythmFactsFromOccurrenceRows(await listGoalActivityOccurrenceRowsForActivities(...))`', /return buildGoalActivityRhythmFactsFromOccurrenceRows\(await listGoalActivityOccurrenceRowsForActivities\(userId, goalActivityIds\), timezone\);/.test(src(DB)));

console.log('=== the loader: the reads and nothing else, once per evaluation ===');
const loader = src(LOADER);
const cb = snapshotCallback(loader);
check('EXACTLY THE SEVEN READS, IN ORDER, ALL THROUGH THE SNAPSHOT EXECUTOR: the callback awaits only the seven read functions and each receives `executor` as its last argument', JSON.stringify(callbackReads(cb).map((r) => r.name)) === JSON.stringify(SNAPSHOT_READS) && callbackReads(cb).every((r) => r.viaExecutor));
check('NOTHING ELSE INSIDE THE TRANSACTION: no Constructor, no orchestration, no opportunity projection or adaptation, no timing / astronomy search, no Rhythm eligibility counting, no duration resolution, no behavioral derivation, no loop or collection pipeline (beyond projecting the candidate ids for the one batched occurrence read), no network call, no clock', !CPU_IN_TX.test(cb.replace(IDS_PROJECTION, '')));
check('NO ESCAPED TRANSACTION CLIENT: the callback uses `executor` only as the last argument of a read -- it is never returned, stored, captured or passed on -- and the loader\'s result is built from rows only, AFTER the snapshot has ended', !cb.replace(/, executor\)/g, ')').match(/\bexecutor\b/) && loader.indexOf('createDecisionSchedulingContext(parts)') > loader.indexOf('const parts = await runSnapshot'));
check('ONE SNAPSHOT PER EVALUATION, NOT PER CANDIDATE: the loader has exactly one `runSnapshot` call, takes a user and a planning date (no candidate list), and every read function appears exactly once in it', count(/runSnapshot<|runSnapshot\(/g, loader) === 1 && !/candidates?:|intents|requestedIntentIds/.test(read(LOADER).match(/export interface DecisionSchedulingContextRequest \{[\s\S]*?\n\}/)![0]) && SNAPSHOT_READS.every((n) => count(new RegExp(`\\b${n}\\(`, 'g'), loader) === 1));
check('THE PRODUCTION CALL GRAPH: the context is acquired by exactly one production call site -- the preview route, once per request -- and the snapshot runner is injectable only so a test can interleave a commit into a REAL snapshot (the default is the real REPEATABLE READ runner)', JSON.stringify(names(/\bloadDecisionSchedulingContext\(/)) === JSON.stringify([LOADER, ROUTE].sort()) && count(/loadDecisionSchedulingContext\(/g, src(ROUTE)) === 1 && /runSnapshot: SnapshotRunner = withRepeatableReadSnapshot/.test(loader));
check('FAILURE: the loader has no try / catch, no retry and no fallback -- a failing statement rejects the whole acquisition (the helper rolls back), so no partially filled context is ever produced', !/\btry\b|\bcatch\b|retry|fallback/i.test(loader));

console.log('=== the context: data, ownership, no database, no policy ===');
const ctx = src(CONTEXT);
check('GENERIC, CARRIES NO POLICY: three authority groups only (recurrence, durationSources, opportunity); no DecisionPressure, LAST_KNOWN_OPPORTUNITY, DecisionEvidence, DecisionFacts, shadow, contention, promotion or Constructor concept', /export interface DecisionSchedulingContext \{\s*readonly recurrence: SchedulingContextRecurrence;\s*readonly durationSources: SchedulingContextDurationSources;\s*readonly opportunity: SchedulingContextOpportunity \| undefined;\s*\}/.test(ctx) && !/DecisionPressure|LAST_KNOWN_OPPORTUNITY|DecisionEvidence|DecisionFacts|ShadowPressure|ContentionTrace|promot|constructDay/.test(ctx));
check('NO DATABASE HANDLE: only type imports from the database layer; no executor, client, pool, query or snapshot name -- the transaction executor cannot reach the context', !/^import (?!type )[^\n]*from '\.\/db'/m.test(ctx) && !/ReadQueryExecutor|PoolClient|\bPool\b|\.query\(|runSnapshot|withRepeatableReadSnapshot|\bpool\b/.test(ctx));
check('OWNERSHIP AND IMMUTABILITY: the context is built by copying rows into new objects with instants as ISO strings and is deep-frozen before it is returned; every derivation constructs fresh Date instances and arrays', /return deepFreeze\(\{/.test(ctx) && /Object\.freeze\(value\)/.test(ctx) && count(/new Date\(/g, ctx) >= 4 && !/:\s*Date\b/.test(ctx.match(/export interface DecisionSchedulingContext \{[\s\S]*?\n\}/)![0] + ctx.match(/export interface SchedulingContextOpportunity \{[\s\S]*?\n\}/)![0]));
check('A MISSING RANGE OR AVAILABILITY FAILS, IT NEVER FALLS BACK: the context-backed range deps throw when the context holds no opportunity part or the request lies outside the snapshot range', /decision scheduling context holds no availability/.test(ctx) && /decision scheduling context holds no plans/.test(ctx) && /requested plan range lies outside the snapshot range/.test(ctx));
check('the duration assembly is shared, not copied: the live orchestrator dependencies and the snapshot-backed ones both call the one pure `buildDurationContext`', /buildDurationContext\(/.test(ctx) && /return buildDurationContext\(preferences, habitLogs, user\.timezone, now\);/.test(src(ORCH)) && !/preferredDurationByActivityId\(|deriveBehavioralProfile\(/.test(ctx));

console.log('=== the consumers: preview boundary, route, Goal provider ===');
const pv = src(PREVIEW);
const bindingBranch = pv.slice(pv.indexOf('if (schedulingBinding) {'), pv.indexOf('} else if (decisionFactsSource) {'));
check('NO MIXED-SNAPSHOT FALLBACK (critical): in the binding branch the independent live providers (`decisionFactsSource`, `opportunityRangeDeps`, the real range / demand deps, any plan or availability read) are never referenced; on a failed acquisition the orchestration deps are reset to the caller\'s own (no evidence provider), so there is NO evidence rather than live-read evidence', !/decisionFactsSource\(|opportunityRangeDeps|createRealOpportunityRangeDeps|createRealGoalDemandCandidatesDeps|listPlannedActivities|listUserAvailabilityPeriods/.test(bindingBranch) && /orchestrationDeps = deps;/.test(bindingBranch) && /else if \(decisionFactsSource\)/.test(pv));
check('ONE CONTEXT FEEDS EVERYTHING: the recurrence facts come from `decisionFactsFromContext`, the duration resolution from `schedulingContextDurationContext`, the availability / blocker adaptation from `schedulingContextOpportunityRangeDeps` -- all built from the same `coherent` context, with exactly one `loadContext` call per request', /schedulingBinding\.decisionFactsFromContext\(parsed\.request, coherent\)/.test(bindingBranch) && /schedulingContextDurationContext\(coherent, timezone, now\)/.test(bindingBranch) && /schedulingContextOpportunityRangeDeps\(coherent\)/.test(bindingBranch) && count(/schedulingBinding\.loadContext\(/g, pv) === 1);
check('THE PRODUCTION ROUTE USES THE SNAPSHOT AND NOT THE LIVE PROVIDERS: it wires `loadSchedulingContext` and `loadDecisionFactsFromContext`, and does not wire `loadDecisionFacts`, `createOpportunityRangeDeps`, `createRealOpportunityRangeDeps` or the live demand deps', count(/loadSchedulingContext:/g, src(ROUTE)) === 1 && count(/loadDecisionFactsFromContext:/g, src(ROUTE)) === 1 && !/\bloadDecisionFacts:|\bcreateOpportunityRangeDeps:|createRealOpportunityRangeDeps|createRealGoalDemandCandidatesDeps/.test(src(ROUTE)));
check('SOURCE-NEUTRAL: the context, its loader and the binding know nothing of manual / automatic / Goal provenance or the UI (the loader takes a user id, a planning date and a timezone; the only Goal-aware piece is the existing Rhythm provider, which now reads the context)', !/manual|automatic|provenance|canonicalDemand|plan-day|goal-demand|\bUI\b/i.test(ctx + loader) && /export function createGoalDemandDepsFromSchedulingContext/.test(src(PROVIDER)));
const providerFn = fnBody(src(PROVIDER), 'export function createGoalDemandDepsFromSchedulingContext');
check('the context-backed Goal demand dependencies read the context only: no pool, no query, no database read function -- the recurrence facts therefore derive exclusively from the coherent context', providerFn.length > 0 && !/\bpool\b|\.query\(|await (?!Promise)load\w+\(|loadCandidateGoalActivitiesForRhythmDemand|loadGoalActivityRhythmFactsForActivities/.test(providerFn) && /buildGoalActivityRhythmFactsFromOccurrenceRows\(/.test(providerFn));

console.log('=== untouched: evidence, pressure, shadow, trace, Constructor, comparator, placement, capacity, acceptance ===');
check('THE CONTEXT IS KNOWN ONLY TO ITS FIVE MODULES: the context vocabulary appears in exactly the context, its loader, the preview boundary, the preview route and the Goal provider -- not in the Constructor, comparator, placement, capacity, replenishment, evidence, preparation, facts, pressure, shadow, trace, opportunity projection, acceptance, persistence, Recomposition or Move code', JSON.stringify(names(CONTEXT_IDENT)) === JSON.stringify([...CONTEXT_NAMING_ALLOW].sort()));
check('the orchestrator does not import or name the context (evidence preparation still happens in the orchestrator, from the facts and the durations it is handed, before the first `constructDay`)', !CONTEXT_IDENT.test(src(ORCH)) && src(ORCH).indexOf('prepareDecisionEvidence(preparationIntents') < src(ORCH).indexOf('constructDay({'));
check('NO PER-CANDIDATE OR PER-REQUEST CACHE: the context is a function result, never stored in a module-level variable, map or cache (a later evaluation always reads afresh)', !/^(let|var) /m.test(ctx + loader) && !/new Map\(\)\s*;?\s*\/\/ cache|const \w*[cC]ache\w* =/.test(ctx + loader));

console.log('=== MUTATIONS OF THE GUARD: each violation class, injected into the real tree, is detected ===');
check('MUTATION: the snapshot is opened WITHOUT REPEATABLE READ (default isolation) or escalated to SERIALIZABLE / given a row lock -> detected', flags(audit(mutateFile(real, DB, (s) => s.replace("'BEGIN ISOLATION LEVEL REPEATABLE READ'", "'BEGIN'"))), 'T2:isolation-is-not-exactly-repeatable-read', DB) && flags(audit(mutateFile(real, DB, (s) => s.replace("'BEGIN ISOLATION LEVEL REPEATABLE READ'", "'BEGIN ISOLATION LEVEL SERIALIZABLE'"))), 'T2:isolation-is-not-exactly-repeatable-read', DB) && flags(audit(mutateFile(real, DB, (s) => s.replace("'BEGIN ISOLATION LEVEL REPEATABLE READ'", "'BEGIN ISOLATION LEVEL REPEATABLE READ'; // FOR UPDATE\n    const lock = 'SELECT 1 FOR UPDATE'"))), 'T2:snapshot-helper-escalates-locks-or-writes', DB));
check('MUTATION: the transaction client / executor escapes (the helper hands the raw client to the callback, or the context module imports and holds the executor type) -> detected', flags(audit(mutateFile(real, DB, (s) => s.replace('result = await read(executor);', 'result = await read(client as unknown as ReadQueryExecutor);'))), 'T2:transaction-client-escapes', DB) && flags(audit(mutateFile(real, CONTEXT, (s) => `import type { ReadQueryExecutor } from './db';\n${s}\nexport type Leak = ReadQueryExecutor;`)), 'T4:context-holds-a-database-handle', CONTEXT));
check('MUTATION: CPU / the opportunity projection / the Constructor inside the transaction -> detected', flags(audit(mutateFile(real, LOADER, (s) => s.replace('const plans = await listPlannedActivitiesOverlappingRange(', 'const projected = projectOpportunityFacts(request);\n    const plans = await listPlannedActivitiesOverlappingRange('))), 'T3:cpu-or-constructor-or-loop-inside-the-snapshot', LOADER) && flags(audit(mutateFile(real, LOADER, (s) => s.replace('const habitLogs = await listHabitLogs(', 'const built = constructDay(request);\n    const habitLogs = await listHabitLogs('))), 'T3:cpu-or-constructor-or-loop-inside-the-snapshot', LOADER));
check('MUTATION: a read moved OUT of the transaction (recurrence, blockers, availability, preferences, habit logs) or issued live -> detected', SNAPSHOT_READS.every((n) => flags(audit(mutateFile(real, LOADER, (s) => s.split('\n').map((line) => (line.includes(`await ${n}(`) ? line.replace(', executor)', ')') : line)).join('\n'))), 'T3:', LOADER)));
check('MUTATION: the plans read is split into a SECOND snapshot (a second runSnapshot) or a read per candidate -> detected', flags(audit(mutateFile(real, LOADER, (s) => `${s}\nexport const second = (r: SnapshotRunner) => r(async (e) => e);\nconst again = runSnapshot(async () => 1);`)), 'T3:not-exactly-one-snapshot-per-evaluation', LOADER) && flags(audit(mutateFile(real, LOADER, (s) => s.replace('const candidateRows = await', 'for (const id of []) { await loadCandidateGoalActivitiesForRhythmDemand(request.userId, executor); }\n    const candidateRows = await'))), 'T3:', LOADER));
check('MUTATION: a second production module opens its own snapshot, or acquires a context outside the route -> detected', flags(audit(addFile(real, 'apps/web/lib/rogueSnapshot.ts', "import { withRepeatableReadSnapshot } from './db';\nexport const r = withRepeatableReadSnapshot;")), 'T1:opens-a-snapshot', 'apps/web/lib/rogueSnapshot.ts') && flags(audit(addFile(real, 'apps/web/lib/rogueAcquire.ts', "import { loadDecisionSchedulingContext } from './decisionSchedulingContextLoader';\nexport const a = (r: never) => loadDecisionSchedulingContext(r);")), 'T1:acquires-a-context', 'apps/web/lib/rogueAcquire.ts'));
check('MUTATION: FALLBACK TO THE LIVE READS on a failed acquisition (the binding branch calls the old independent provider) -> detected', flags(audit(mutateFile(real, PREVIEW, (s) => s.replace("orchestrationDeps = deps;\n    if (context) {", "orchestrationDeps = deps;\n    if (!context && decisionFactsSource) { decisionFactsByIntentId = await decisionFactsSource(parsed.request); }\n    if (context) {"))), 'T5:binding-falls-back-to-live-reads', PREVIEW));
check('MUTATION: the production route wires the independent live providers again -> detected', flags(audit(mutateFile(real, ROUTE, (s) => s.replace('loadSchedulingContext:', 'loadDecisionFacts: (u: never, r: never) => loadGoalDecisionFacts(u, r),\n    loadSchedulingContext:'))), 'T5:route-wires-live-providers-or-no-context', ROUTE));
check('MUTATION: the context-backed Goal deps read the database -> detected', flags(audit(mutateFile(real, PROVIDER, (s) => s.replace('loadCandidateGoalActivities: async () => context.recurrence.candidateRows.map((row) => ({ ...row })),', 'loadCandidateGoalActivities: async () => loadCandidateGoalActivitiesForRhythmDemand("u"),'))), 'T6:context-backed-deps-read-the-database', PROVIDER));
check('MUTATION: the context becomes mutable (no deep freeze) -> detected', flags(audit(mutateFile(real, CONTEXT, (s) => s.replace('return deepFreeze({', 'return ({'))), 'T4:context-is-not-deep-frozen', CONTEXT));
check('MUTATION: the context carries pressure / evidence / a Constructor concept, or the Constructor / comparator / shadow / evidence modules start to know the context -> detected', flags(audit(mutateFile(real, CONTEXT, (s) => `${s}\nexport type P = DecisionPressure;`)), 'T4:context-names-policy-or-construction', CONTEXT) && ['apps/web/lib/dayConstructor.ts', 'apps/web/lib/dayIntent.ts', ORCH, 'apps/web/lib/decisionEvidence.ts', 'apps/web/lib/shadowPressureObservation.ts', 'apps/web/lib/decisionPressure.ts'].every((f) => flags(audit(mutateFile(real, f, (s) => `${s}\nconst probe = 'DecisionSchedulingContext';`)), 'T7:module-names-the-context', f)));
check('MUTATION: a read function stops using the executor (back to the global pool) or its SQL changes -> detected', flags(audit(mutateFile(real, DB, (s) => s.replace('const result = await executor.query(\n    `SELECT * FROM "PlannedActivity"\n     WHERE "userId" = $1 AND status <> \'CANCELLED\' AND "plannedStartAt" < $3', 'const result = await pool.query(\n    `SELECT * FROM "PlannedActivity"\n     WHERE "userId" = $1 AND status <> \'CANCELLED\' AND "plannedStartAt" < $3'))), 'T2:read-not-executor-parameterized', DB) || sqlHash(rawDb.replace("status <> 'CANCELLED' AND \"plannedStartAt\" < $3", "status <> 'CANCELLED' AND \"plannedStartAt\" <= $3"), 'listPlannedActivitiesOverlappingRange') !== SQL_PINS.listPlannedActivitiesOverlappingRange);
check('the SQL pin is sensitive: changing the overlap boundary or a lifecycle filter changes the hash', sqlHash(rawDb.replace("status <> 'CANCELLED' AND \"plannedStartAt\" < $3", "status <> 'CANCELLED' AND \"plannedStartAt\" <= $3"), 'listPlannedActivitiesOverlappingRange') !== SQL_PINS.listPlannedActivitiesOverlappingRange && sqlHash(rawDb.replace("pa.status IS DISTINCT FROM 'UPCOMING'", 'TRUE'), 'loadCandidateGoalActivitiesForRhythmDemand') !== SQL_PINS.loadCandidateGoalActivitiesForRhythmDemand);
check('the mutations were applied to in-memory copies only: the real tree still has zero violations afterwards', audit(real).length === 0);

console.log('=== wiring and honest scope ===');
const workflow = read('.github/workflows/ci.yml').split('\n');
let currentJob = ''; let inJobs = false;
const stepJob = new Map<string, string>();
for (const line of workflow) {
  if (/^jobs:\s*$/.test(line)) { inJobs = true; continue; }
  const job = line.match(/^  ([A-Za-z0-9_-]+):\s*$/);
  if (inJobs && job) currentJob = job[1];
  const run = line.match(/^\s+run: npx ts-node (test\/[A-Za-z0-9_]+\.test\.ts)\s*$/);
  if (run && currentJob) stepJob.set(run[1], currentJob);
}
check('the pure suites (context behavior, architecture guard) run in the required PURE job and the concurrency / snapshot suite in the required DB job', stepJob.get('test/decisionSchedulingContext.test.ts') === 'math-core-tests' && stepJob.get('test/decisionSchedulingContextArchitecture.test.ts') === 'math-core-tests' && stepJob.get('test/decisionSchedulingSnapshotDb.test.ts') === 'day-constructor-acceptance-db-tests');
const FLAKY = /\bctid\b|VACUUM|ANALYZE|EXPLAIN\b|Math\.random|setTimeout|setInterval|pg_sleep|Date\.now\(|new Date\(\)|\bsleep\b/;
check('the new suites assert invariants only: no sleeps, timers, randomness, wall-clock reads, heap layout or query-plan mechanics -- the concurrent commit is placed by an awaited hook at an exact statement, never by timing', ['test/decisionSchedulingContext.test.ts', 'test/decisionSchedulingSnapshotDb.test.ts'].every((f) => !FLAKY.test(stripComments(read(f)))));
const FALSE_CLAIM = /pressure is (active|enabled)|P4 (is )?ready|ready for P4|activates? (decision )?pressure|promote(s|d)? the/i;
check('no assertion label claims pressure is active, that P4 is ready, or that this slice promotes anything', ['test/decisionSchedulingContext.test.ts', 'test/decisionSchedulingSnapshotDb.test.ts'].every((f) => !(read(f).match(/check\(`?'?[^\n]*/g) ?? []).some((l) => FALSE_CLAIM.test(l))));
check('NO SCHEMA, NO MIGRATION: the Prisma schema names no scheduling context and the migration set is still the 43 directories of the baseline', !/SchedulingContext|withRepeatableRead/.test(read('apps/web/prisma/schema.prisma')) && fs.readdirSync(path.join(root, 'apps/web/prisma/migrations'), { withFileTypes: true }).filter((e) => e.isDirectory()).length === 43);

if (!allPassed) {
  console.error('SOME DECISION SCHEDULING CONTEXT ARCHITECTURE CHECKS FAILED');
  process.exit(1);
}
console.log('ALL DECISION SCHEDULING CONTEXT ARCHITECTURE CHECKS PASSED');
