/**
 * Scheduling read authority -- R2: Forward Planner overlap blocker read (architecture guard, pure).
 *
 * Pins that Forward Planner loads the persisted plans that can conflict with a candidate with the canonical half-open
 * overlap loader, once per request, over the union of the requested civil-date range and the candidates' own extent --
 * not the start-scoped `listPlannedActivitiesForDay` -- and that R2 stayed a read-correctness change only: policy
 * (UPCOMING blocks, LOGGED does not) unchanged, no lock/transaction/write/SQL, one shared code path for the API and
 * Ask Aura, no change to Daily Guidance, My Day, Day Builder, Recomposition, the Constructor or the schema.
 *
 * It deliberately bans NO helper globally: `listPlannedActivitiesForDay` legitimately stays the loader of readers whose
 * semantic range is "plans that start in this day" (Daily Guidance candidates, the My Day agenda). It does NOT claim a
 * coherent snapshot: the timing FIND and the plan load are separate reads (P2d).
 */
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
function blockAfter(source: string, marker: string): string {
  const start = source.indexOf(marker);
  if (start < 0) throw new Error(`missing marker ${marker}`);
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') { depth--; if (depth === 0) return source.slice(start, i + 1); }
  }
  throw new Error(`unterminated block after ${marker}`);
}

const orchSrc = read('apps/web/lib/forwardPlannerOrchestrator.ts');
const orch = stripComments(orchSrc);
const pure = stripComments(read('apps/web/lib/forwardPlanner.ts'));
const route = stripComments(read('apps/web/app/api/forward-planner/route.ts'));
const askAura = stripComments(read('apps/web/lib/askAuraOrchestrator.ts'));
const db = stripComments(read('apps/web/lib/db.ts'));
const plannerFiles = [{ f: 'forwardPlannerOrchestrator.ts', src: orch }, { f: 'forwardPlanner.ts', src: pure }, { f: 'api/forward-planner/route.ts', src: route }];
const result = blockAfter(orch, 'export async function buildForwardPlannerResult');
const helper = orch.slice(orch.indexOf('export function resolveForwardPlannerBlockerLoadBounds'), orch.indexOf('export async function buildForwardPlannerResult'));
const filterBlock = blockAfter(result, 'if (aboveFloor.length > 0)');

// ---- the loader ----
check('LOADER: the orchestrator imports the canonical overlap loader `listPlannedActivitiesOverlappingRange` from db', /import \{ listPlannedActivitiesOverlappingRange \} from '\.\/db';/.test(orch));
check('NO START-SCOPED LOADER: no Forward Planner module (orchestrator, pure planner, route) references `listPlannedActivitiesForDay`', plannerFiles.every((p) => !/listPlannedActivitiesForDay/.test(p.src)));
check('NO NEW SQL: no Forward Planner module contains SQL against PlannedActivity (no table reference, SELECT, INSERT, UPDATE, DELETE or BETWEEN)', plannerFiles.every((p) => !/"PlannedActivity"|\bSELECT\b|\bINSERT\b|\bUPDATE\b|\bDELETE\b|\bBETWEEN\b/.test(p.src)));
check('the canonical overlap predicate is defined exactly once in db.ts and is half-open: `plannedStartAt < $3 AND plannedEndAt > $2`, user-scoped, CANCELLED excluded in SQL', count(/"plannedStartAt" < \$3 AND "plannedEndAt" > \$2/g, db) === 1 && /WHERE "userId" = \$1 AND status <> 'CANCELLED' AND "plannedStartAt" < \$3 AND "plannedEndAt" > \$2/.test(db));
check('the overlap loader is unchanged in shape: `(userId, from, to, executor = pool)`', /export async function listPlannedActivitiesOverlappingRange\(userId: string, from: Date, to: Date, executor: QueryExecutor = pool\)/.test(db));

// ---- exactly one load, never per date / per candidate ----
check('SINGLE LOAD: exactly one call to the overlap loader in the whole orchestrator', count(/listPlannedActivitiesOverlappingRange\(/g, orch) === 1);
check('NO N+1: the call sits in a straight-line block -- no loop, no per-candidate map/forEach/Promise.all around it', /listPlannedActivitiesOverlappingRange\(user\.id, loadBounds\.from, loadBounds\.to\)/.test(filterBlock) && !/\bfor\s*\(|\bwhile\s*\(|\.forEach\(|\.map\(async|Promise\.all/.test(filterBlock.replace(/\.map\(\(plan\) => \(\{ start: plan\.plannedStartAt, end: plan\.plannedEndAt \}\)\)/, '')));
check('the load is user-scoped by the authenticated user the request was built for (never a request value)', /listPlannedActivitiesOverlappingRange\(user\.id,/.test(orch));
check('ZERO CANDIDATES: the plan load is skipped when no candidate remains to be filtered (guarded by `aboveFloor.length > 0`); the result is still NO_SUITABLE_WINDOW', /let conflictFree = aboveFloor;\s*if \(aboveFloor\.length > 0\) \{/.test(result) && /if \(conflictFree\.length === 0\) return \{ status: 'NO_SUITABLE_WINDOW', range \};/.test(result));

// ---- the range ----
check('REQUESTED RANGE: derived with the canonical civil-date helper (`localDayBoundsUTC` of the range\'s start and end dates), not millisecond arithmetic', /const \{ from \} = localDayBoundsUTC\(range\.startLocalDate, user\.timezone\);/.test(filterBlock) && /const \{ to \} = localDayBoundsUTC\(range\.endLocalDate, user\.timezone\);/.test(filterBlock));
check('AUTHORITATIVE LOAD RANGE: the load bounds are `resolveForwardPlannerBlockerLoadBounds({ from, to }, aboveFloor)` -- the requested range widened by the actual candidate set that is filtered', /const loadBounds = resolveForwardPlannerBlockerLoadBounds\(\{ from, to \}, aboveFloor\);/.test(filterBlock));
check('CANDIDATE EXTENT: the helper takes the min start / max end of the candidates\' own instants (`new Date(candidate.start|end)`), starting from the requested bounds -- no constant buffer, day, week or history', /let from = requested\.from\.getTime\(\);/.test(helper) && /let to = requested\.to\.getTime\(\);/.test(helper) && /Math\.min\(from, new Date\(candidate\.start\)\.getTime\(\)\)/.test(helper) && /Math\.max\(to, new Date\(candidate\.end\)\.getTime\(\)\)/.test(helper) && !/\d{5,}|24 \* 60|addDaysToDateStr|86400000/.test(helper));
check('no arbitrary widening anywhere in the orchestrator: no day/week/history constants around the blocker load', !/86400000|24 \* 60 \* 60|7 \* 24|addDaysToDateStr\(range|history/i.test(filterBlock));

// ---- policy preserved ----
check('POLICY: only UPCOMING plans block (`plan.status === \'UPCOMING\'`); LOGGED, CANCELLED, SKIPPED and MOVED are not blockers; no lifecycle machinery (`isActivePlanBlocker`) was added', /plans\.filter\(\(plan\) => plan\.status === 'UPCOMING'\)/.test(filterBlock) && !/LOGGED|SKIPPED|MOVED|isActivePlanBlocker/.test(filterBlock));
check('the conflict test itself is unchanged: the pure `filterConflictingCandidates` (half-open [start,end) overlap with every blocking interval) in forwardPlanner.ts', /export function filterConflictingCandidates\(/.test(pure) && /intervalsOverlap\(start, end, interval\.start, interval\.end\)/.test(pure));

// ---- pipeline order and unrelated policy untouched ----
const order = ['runTimingSearch({', 'selectOneCandidatePerLocalDate(', 'isAboveForwardPlannerFloor(', 'listPlannedActivitiesOverlappingRange(user.id', 'filterConflictingCandidates(', 'buildDailyPersonalFitForUser(user, targetEvaluationTime)', 'rankForwardPlannerCandidates(', 'MAX_FORWARD_PLANNER_RESULTS)'].map((m) => result.indexOf(m));
check('FILTERING ORDER preserved: timing FIND -> one-per-date -> floor -> persisted-blocker filtering -> personal fit -> ranking -> max results', order.every((i) => i > 0) && order.every((v, i) => i === 0 || v > order[i - 1]));
check('ONE FIND call, one-candidate-per-date, floor, personal-fit and max-results policy are untouched', count(/runTimingSearch\(/g, result) === 1 && /mode: 'FIND'/.test(result) && /limit: Math\.min\(21, dayCount \* 3\)/.test(result) && /\.slice\(0, MAX_FORWARD_PLANNER_RESULTS\)/.test(result));

// ---- read-only, no serialization ----
check('READ-ONLY / NO SERIALIZATION: no Forward Planner module takes an advisory lock, row lock or transaction or calls a plan writer', plannerFiles.every((p) => !/pg_advisory|beginTransaction|FOR UPDATE|FOR SHARE|\bCOMMIT\b|\bROLLBACK\b|pool\.connect|createPlannedActivity|applyMoveWrites|movePlannedActivity|cancelPlannedActivity|skipPlannedActivity|logPlannedActivity|deletePlannedActivity/.test(p.src)));
check('the request `now` is the single explicit clock: no `Date.now()` / `new Date()` is read for "the current time" in the orchestrator', !/Date\.now\(\)|new Date\(\)/.test(orch));

// ---- one shared authority for the API and Ask Aura ----
check('SHARED AUTHORITY: the API route and Ask Aura both call the SAME `buildForwardPlannerResult` (route once, Ask Aura at its two sites); neither loads plans for forward planning itself', count(/buildForwardPlannerResult\(/g, route) === 1 && count(/buildForwardPlannerResult\(/g, askAura) === 2 && !/listPlannedActivities(OverlappingRange|ForDay)/.test(route) && !/listPlannedActivities(OverlappingRange|ForDay)/.test(askAura));

// ---- readers that must stay start-scoped, and no global ban ----
const guidance = stripComments(read('apps/web/lib/dailyGuidanceCandidates.ts'));
const myDay = stripComments(read('apps/web/lib/myDayOrchestrator.ts'));
check('DAILY GUIDANCE UNCHANGED: collectPlanCandidates still reads "plans that start today" with the start-scoped loader (R1 proved that is its correct contract) and does not use the overlap loader', /import \{ listPlannedActivitiesForDay \} from '\.\/db';/.test(guidance) && /await listPlannedActivitiesForDay\(user\.id, from, to\)/.test(guidance) && !/listPlannedActivitiesOverlappingRange/.test(guidance));
check('MY DAY UNCHANGED: the day agenda and tomorrow preview still list by start day (documented boundary); Day Builder availability is not touched here', count(/listPlannedActivitiesForDay\(user\.id, from, to\)/g, myDay) === 2 && !/listPlannedActivitiesOverlappingRange/.test(myDay));
check('NO GLOBAL BAN: `listPlannedActivitiesForDay` still exists, unchanged, as the loader of the legitimately start-scoped readers', /export async function listPlannedActivitiesForDay\(userId: string, from: Date, to: Date, executor: QueryExecutor = pool\)/.test(db) && /status <> 'CANCELLED' AND "plannedStartAt" BETWEEN \$2 AND \$3/.test(db));

// ---- other systems structurally unchanged ----
const recomp = stripComments(read('apps/web/lib/remainingDayRecompositionServer.ts'));
const constructor = stripComments(read('apps/web/lib/dayConstructorOrchestrator.ts'));
const acceptance = stripComments(read('apps/web/lib/remainingDayRecompositionAcceptance.ts'));
check('RECOMPOSITION / CONSTRUCTOR UNCHANGED (structure): the proposal and the Constructor still load blockers with the canonical overlap loader; acceptance still takes the shared lock', /loadPlansForDay: \(bounds\) => listPlannedActivitiesOverlappingRange\(user\.id, bounds\.from, bounds\.to\),/.test(recomp) && /listPlannedActivitiesOverlappingRange\(user\.id, bounds\.from, bounds\.to\)/.test(constructor) && /pg_advisory_xact_lock\(hashtext\(\$1\)\)/.test(acceptance));
check('the shared advisory lock is still taken at exactly the same four production sites (no new blocker-adding writer)', ['apps/web/lib/dayConstructorAcceptancePersistence.ts', 'apps/web/lib/planMove.ts', 'apps/web/lib/remainingDayRecompositionAcceptance.ts', 'apps/web/app/api/plans/route.ts'].every((f) => count(/pg_advisory_xact_lock\(hashtext\(\$1\)\)/g, stripComments(read(f))) === 1));
const migrationDirs = fs.readdirSync(path.join(root, 'apps/web/prisma/migrations'), { withFileTypes: true }).filter((e) => e.isDirectory());
check('NO SCHEMA CHANGE: 43 migration directories, no exclusion constraint', migrationDirs.length === 43 && !/EXCLUDE USING|btree_gist/i.test(read('apps/web/prisma/schema.prisma')));

// ---- this slice's tests make no false claim ----
const dbTest = read('test/forwardPlannerOverlapBlockerDb.test.ts');
const FALSE_CLAIM = /snapshot[- ]consistent|race[- ]free|serializ(ed|able) (planner|request)|coherent snapshot|P2d (is )?(done|fixed)/i;
check('the DB test makes no snapshot-coherence, race-freedom or serialization claim in any assertion label', !(dbTest.match(/check\(`?'?[^\n]*/g) ?? []).some((l) => FALSE_CLAIM.test(l)));
check('the DB test drives the real `buildForwardPlannerResult` with an explicit clock (no wall clock) and covers: primary prior-start case, full span, same-day control, lifecycle, cross-user, boundaries, multi-date single query, candidate extent (both ends), zero candidates, DST/Auckland, row volume, zero writes', /buildForwardPlannerResult\(user, now, v\.request\)/.test(dbTest) && !/new Date\(\)|Date\.now\(\)/.test(stripComments(dbTest)) && /PRIMARY FIXTURE/.test(dbTest) && /LIFECYCLE/.test(dbTest) && /CROSS-USER/.test(dbTest) && /BOUNDARIES/.test(dbTest) && /MULTIPLE BLOCKERS, MULTIPLE DATES/.test(dbTest) && /CANDIDATE EXTENT/.test(dbTest) && /ZERO candidates/.test(dbTest) && /LA spring-forward/.test(dbTest) && /LA fall-back/.test(dbTest) && /Auckland/.test(dbTest) && /ROW VOLUME/.test(dbTest) && /ZERO WRITES/.test(dbTest));

if (!allPassed) {
  console.error('SOME FORWARD PLANNER OVERLAP BLOCKER ARCHITECTURE CHECKS FAILED');
  process.exit(1);
}
console.log('ALL FORWARD PLANNER OVERLAP BLOCKER ARCHITECTURE CHECKS PASSED');
