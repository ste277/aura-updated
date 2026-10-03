/**
 * Constructor scheduling correctness -- overlapping plan blockers
 * (architecture guard, pure).
 *
 * Pins that the Constructor's target-day blocker selection uses HALF-OPEN
 * OVERLAP semantics (one shared definition) rather than start-date-only
 * semantics, and that this fix stayed a narrow query-semantics change:
 * no lifecycle expansion, no policy vocabulary, no new loaders, no
 * snapshot/transaction machinery, no acceptance or persistence change.
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
function functionBody(source: string, name: string): string {
  const start = source.indexOf(`function ${name}`);
  if (start < 0) throw new Error(`missing function ${name}`);
  const braceStart = source.indexOf('{', source.indexOf(')', start));
  let depth = 0;
  for (let i = braceStart; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`unterminated ${name}`);
}
const count = (re: RegExp, s: string) => (s.match(re) ?? []).length;

const orchestratorSrc = read('apps/web/lib/dayConstructorOrchestrator.ts');
const orchestrator = stripComments(orchestratorSrc);
const db = stripComments(read('apps/web/lib/db.ts'));
const o2Real = stripComments(read('apps/web/lib/opportunityRangeRealDeps.ts'));
const lifecycle = stripComments(read('apps/web/lib/planBlockerLifecycle.ts'));
const dayCapacity = stripComments(read('apps/web/lib/dayCapacity.ts'));

const realDeps = functionBody(orchestrator, 'createRealDayConstructorOrchestratorDeps');
const loader = realDeps.slice(realDeps.indexOf('loadBlockingPlans:'), realDeps.indexOf('loadDurationContext:'));
const overlapFn = functionBody(db, 'listPlannedActivitiesOverlappingRange');
const dayFn = functionBody(db, 'listPlannedActivitiesForDay');

// ---- the Constructor's real blocker loader uses OVERLAP semantics ----
check('the real Constructor blocker loader calls listPlannedActivitiesOverlappingRange', /listPlannedActivitiesOverlappingRange\(user\.id, bounds\.from, bounds\.to\)/.test(loader));
check('it no longer uses the start-date-only listPlannedActivitiesForDay anywhere in the orchestrator (code)', !/listPlannedActivitiesForDay/.test(orchestrator));
check('the orchestrator imports no start-date-only plan loader', !/import \{[^}]*listPlannedActivitiesForDay[^}]*\} from '\.\/db'/.test(orchestrator));
check('the loader still makes ONE plan query (a single call, no loop, no per-intent query)', count(/listPlannedActivitiesOverlappingRange\(/g, loader) === 1 && !/for \(|\.map\(async|Promise\.all/.test(loader));
check('the orchestrator calls deps.loadBlockingPlans exactly once, with bounds derived from the day AND the resolved window', count(/deps\.loadBlockingPlans\(/g, orchestrator) === 1 && /const blockerBounds = resolveBlockerLoadBounds\(dayBounds, window\);/.test(orchestrator) && /deps\.loadBlockingPlans\(blockerBounds\)/.test(orchestrator));
check('the window is resolved BEFORE the blocker load (the range can depend on it)', orchestrator.indexOf('window = ') > 0 && orchestrator.indexOf('resolveBlockerLoadBounds(dayBounds, window)') > orchestrator.lastIndexOf('window = '));
const bounds = functionBody(orchestrator, 'resolveBlockerLoadBounds');
check('resolveBlockerLoadBounds is pure and generic: no I/O, no clock, no clipping, no policy vocabulary', !/await|pool\.|new Date|Date\.now|clip|normalize|pressure|scarc|lastOpportunity|promot|shadow|policy|score/i.test(bounds));

// ---- ONE overlap definition, strict half-open ----
check('db.ts contains exactly ONE half-open overlap predicate over plannedStartAt/plannedEndAt (a single shared definition)', count(/"plannedStartAt" < \$3 AND "plannedEndAt" > \$2/g, db) === 1);
check('the overlap predicate is strictly half-open: strict < and > only (no <= / >= on either end)', /"plannedStartAt" < \$3 AND "plannedEndAt" > \$2/.test(overlapFn) && !/"plannedStartAt" <= \$3|"plannedEndAt" >= \$2/.test(overlapFn));
check('the overlap query is user-scoped and excludes CANCELLED at the SQL level', /"userId" = \$1 AND status <> 'CANCELLED'/.test(overlapFn));
check('the overlap query has BOTH bounds (it can never degrade to "all history"): lower and upper', /"plannedStartAt" < \$3/.test(overlapFn) && /"plannedEndAt" > \$2/.test(overlapFn) && !/LIMIT/i.test(overlapFn));
check('O2 PARITY: the O2 range loader and the Constructor loader both use that one query', /listPlannedActivitiesOverlappingRange\(user\.id, bounds\.from, bounds\.to\)/.test(o2Real) && /listPlannedActivitiesOverlappingRange\(user\.id, bounds\.from, bounds\.to\)/.test(loader));
check('the shared start-date-only loader keeps its documented semantics for its OTHER consumers (this fix did not widen it)', /"plannedStartAt" BETWEEN \$2 AND \$3/.test(dayFn) && /status <> 'CANCELLED'/.test(dayFn));

// ---- lifecycle and clipping ownership unchanged ----
check('lifecycle is unchanged: CANCELLED/SKIPPED/MOVED never block, LOGGED always blocks, UPCOMING blocks until it has elapsed', /plan\.status === 'CANCELLED'\) return false/.test(lifecycle) && /plan\.status === 'SKIPPED'\) return false/.test(lifecycle) && /plan\.status === 'MOVED'\) return false/.test(lifecycle) && /plan\.status === 'LOGGED'\) return true/.test(lifecycle) && /return plan\.end\.getTime\(\) >= referenceInstant\.getTime\(\)/.test(lifecycle));
check('lifecycle is still applied by the orchestrator after the load (the loader never filters by lifecycle)', /blockingPlanCandidates\.filter\(\(plan\) => isActivePlanBlocker\(plan, request\.now\)\)/.test(orchestrator));
check('clipping to the construction window is still owned by dayCapacity (single owner): the orchestrator never clips', /function clipToWindow/.test(dayCapacity) && !/clipToWindow|normalizeBlockedIntervals/.test(orchestrator));

// ---- scope: nothing else changed ----
check('the two decision modules are untouched by this fix (precedence and placement sources still contain no overlap/blocker-loading concern)', !/listPlannedActivities|loadBlockingPlans/.test(stripComments(read('apps/web/lib/dayIntent.ts'))) && !/listPlannedActivities|loadBlockingPlans/.test(stripComments(read('apps/web/lib/dayConstructor.ts'))));
check('acceptance persistence reads its fresh blockers through the SAME canonical overlap loader as the Constructor (updated deliberately by schedule-write S1: this guard previously pinned acceptance\'s old start-scoped read as known debt), on its transaction client', /listPlannedActivitiesOverlappingRange\(userId, bounds\.from, bounds\.to, client\)/.test(stripComments(read('apps/web/lib/dayConstructorAcceptancePersistence.ts'))) && !/listPlannedActivitiesForDay/.test(stripComments(read('apps/web/lib/dayConstructorAcceptancePersistence.ts'))));
check('no snapshot machinery was introduced: no REPEATABLE READ / SERIALIZABLE / transaction in the orchestrator', !/REPEATABLE READ|SERIALIZABLE|beginTransaction|ISOLATION/i.test(orchestrator));
check('no feature flag or environment switch was introduced in the orchestrator', !/process\.env/.test(orchestrator));
check('no policy vocabulary was introduced into the orchestrator or the plan loaders (pressure, scarcity, last opportunity, promotion, shadow, policy score)', !/DecisionPressure|LAST_KNOWN_OPPORTUNITY|lastOpportunity|scarcity|promotion|shadowEval|policyScore/i.test(orchestrator) && !/DecisionPressure|LAST_KNOWN_OPPORTUNITY|lastOpportunity|scarcity|promotion|shadowEval|policyScore/i.test(overlapFn));

// ---- the regression suites that prove the behavior exist ----
const dbTest = read('test/dayConstructorOverlappingBlockerDb.test.ts');
const pureTest = read('test/dayConstructorBlockerOverlap.test.ts');
check('the real-DB regression reproduces the overnight case, asserts the mathematical non-overlap, the boundaries, lifecycle, cross-user, DST, explicit window, row volume and O2 parity', ['PRIMARY: persisted overnight plan', 'for every proposal, start >= blocker end OR end <= blocker start', 'ONE millisecond', 'EXACTLY at the day end', 'another USER', 'SPRING FORWARD', 'FALL BACK', 'CROSSES midnight', 'exactly the 1 overlapping row', 'O2 range loader return the same plans'].every((m) => dbTest.includes(m)));
check('the pure suite covers the bounds helper, the single load, lifecycle statuses, adjacency, zero-length and DST day lengths', ['resolveBlockerLoadBounds', 'lifecycle unchanged', 'adjacent plans', 'zero-length', '23-hour', '25-hour'].every((m) => pureTest.includes(m)));

if (!allPassed) {
  console.error('SOME BLOCKER OVERLAP ARCHITECTURE CHECKS FAILED');
  process.exit(1);
}
console.log('ALL BLOCKER OVERLAP ARCHITECTURE CHECKS PASSED');
