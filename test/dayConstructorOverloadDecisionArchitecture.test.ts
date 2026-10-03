/**
 * O5 P0c -- architecture guard for the real overload decision fixture
 * (pure, no DB).
 *
 * P0c is CHARACTERIZATION: it adds a behavioral anchor and changes no
 * production behavior. This guard protects that baseline until a policy
 * slice deliberately changes it:
 *
 *   - the CURRENT decision ordering code is pinned by a hash of its
 *     normalized source (comments and whitespace ignored), plus structural
 *     facts about what it reads
 *   - no Decision Pressure, score, scarcity/shortfall concept, source
 *     branch, or Opportunity/Decision-Fact consumption exists in any
 *     decision module
 *   - the primary fixture is a real-pipeline test, not a direct comparator
 *     call, and asserts the required semantic properties
 *
 * INTENTIONAL UPDATE: when a later slice (P2/P4) deliberately changes the
 * ordering, update the PINNED hashes below in the same change, together
 * with the behavioral expectations in dayConstructorOverloadDecisionDb.test.ts.
 * A mismatch means "the decision baseline changed"; it is a prompt to
 * review, not an obstacle.
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}
const root = path.join(__dirname, '..');
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8');
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const normalize = (s: string) => stripComments(s).replace(/\s+/g, ' ').trim();
const slice = (src: string, from: string, to: string) => {
  const a = src.indexOf(from);
  const b = src.indexOf(to, a + from.length);
  if (a < 0 || b < 0) throw new Error(`pin markers missing: "${from}" .. "${to}" (the decision code was restructured: review and update this guard deliberately)`);
  return src.slice(a, b);
};
const sha = (s: string) => crypto.createHash('sha256').update(normalize(s)).digest('hex').slice(0, 16);

const dayIntent = read('apps/web/lib/dayIntent.ts');
const dayConstructor = read('apps/web/lib/dayConstructor.ts');
const dayCapacity = read('apps/web/lib/dayCapacity.ts');
const orchestrator = read('apps/web/lib/dayConstructorOrchestrator.ts');

// ============================================================
// PINNED BASELINE (update deliberately with a policy slice)
// ============================================================
const PINNED = {
  /** IMPORTANCE_RANK + compareByOverloadPrecedence + sortByOverloadPrecedence (dayIntent.ts). */
  intentPrecedence: 'f3d11aa9c907d9e8',
  /** TIMING_FIT_RANK + timingFitRank + compareCandidatesForPlacement (dayConstructor.ts). */
  placementRanking: '8acdbbede12cee16',
};
const precedenceSrc = slice(dayIntent, 'const IMPORTANCE_RANK', 'export type ConstructionWindowValidationError');
const placementSrc = slice(dayConstructor, 'const TIMING_FIT_RANK', 'export type PlacementDeferralReason');
check(`the overload PRECEDENCE code is exactly the pinned baseline (importance rank, deadline-today, deadline, original order) -- hash ${sha(precedenceSrc)}`, sha(precedenceSrc) === PINNED.intentPrecedence);
check(`the candidate PLACEMENT ranking code is exactly the pinned baseline (timingFit, earlier start, candidateOrder) -- hash ${sha(placementSrc)}`, sha(placementSrc) === PINNED.placementRanking);
check('the construction call sites are the pinned baseline: ONE precedence sort of the intents, and the per-intent candidate sort by the placement comparator', /const orderedIntents = sortByOverloadPrecedence\(intents, today\);/.test(stripComments(dayConstructor)) && /feasible\.sort\(\(a, b\) => compareCandidatesForPlacement\(a\.candidate, b\.candidate\)\);/.test(stripComments(dayConstructor)));

// ============================================================
// What the precedence reads (structural, not just a hash)
// ============================================================
const cmp = stripComments(slice(dayIntent, 'export function compareByOverloadPrecedence', 'export function sortByOverloadPrecedence'));
const reads = Array.from(new Set(Array.from(cmp.matchAll(/\b[ab]\.(\w+)/g)).map((m) => m[1]))).sort();
check('compareByOverloadPrecedence reads EXACTLY deadline, importance and originalOrder -- nothing else (current precedence: deadline today, importance, deadline, original order)', JSON.stringify(reads) === JSON.stringify(['deadline', 'importance', 'originalOrder']));
check('the order of the dimensions is the pinned one: deadline-today, then importance, then deadline presence/earlier deadline, then original order', cmp.indexOf('aDeadlineToday') < cmp.indexOf('importanceDelta') && cmp.indexOf('importanceDelta') < cmp.indexOf('aHasDeadline') && cmp.indexOf('aHasDeadline') < cmp.indexOf('originalOrder'));
check('the importance ranking is HIGH < MEDIUM < LOW (HIGH first)', /IMPORTANCE_RANK: Record<DayIntentImportance, number> = \{ HIGH: 0, MEDIUM: 1, LOW: 2 \}/.test(stripComments(dayIntent)));
check('the final tie-break is submission order, ascending (a.originalOrder - b.originalOrder)', /return a\.originalOrder - b\.originalOrder;/.test(cmp));
check('the comparators take no timing/Muhurta quality and no decision facts: selection is isolated from placement quality', !/timingFit|candidate|score|decisionFacts|opportunity|recurrence|rhythm|goal/i.test(cmp));

// ============================================================
// No policy / score / source branch / fact consumption in any decision module
// ============================================================
const POLICY = /decisionPressure|DecisionPressure|LAST_KNOWN_OPPORTUNITY|lastOpportunity|lastKnownOpportunity|scarc|shortfall|deficit|atRisk|\bpressure\b|priorityScore|urgencyScore|decisionScore|\bscore\b/i;
for (const [label, src] of Object.entries({ 'dayIntent.ts': dayIntent, 'dayConstructor.ts': dayConstructor, 'dayCapacity.ts': dayCapacity, 'the orchestrator': orchestrator })) {
  check(`${label} has no Decision Pressure, score, scarcity, shortfall or deficit concept in its code`, !POLICY.test(stripComments(src).replace(/timingFit|requestedCapacity/g, '')));
}
const FACT_READS = /\.opportunity\b|startDateState|afterStart|viableDays|unknownDays|\.recurrence\b|remainingInPeriod|targetPerPeriod|decisionFacts\??\./;
check('no decision module (precedence, placement, capacity, orchestrator) READS an opportunity or recurrence fact: facts remain inert metadata', ![dayIntent, dayConstructor, dayCapacity].some((s) => FACT_READS.test(stripComments(s))) && !FACT_READS.test(stripComments(orchestrator)));
check('the orchestrator still attaches facts as opaque metadata only (resolveDecisionFactsForIntent lookup, never inspected)', /resolveDecisionFactsForIntent\(requested\.id, request\.decisionFactsByIntentId\)/.test(stripComments(orchestrator)));
const SOURCE_BRANCH = /plan-day-goal|goal-demand|canonicalDemand|classifyGoalDemandIntentId|\bisGoal\b|\bmanual\b|\bautomatic\b|goalActivityId|GoalActivity/;
check('no decision module has a source branch: no Goal / automatic / manual vocabulary in precedence, placement, capacity or the orchestrator code', ![dayIntent, dayConstructor, dayCapacity, orchestrator].some((s) => SOURCE_BRANCH.test(stripComments(s))));
check('constructDay is reached ONLY through the orchestrator in production (no second construction path)', fs.readdirSync(path.join(root, 'apps/web/lib')).filter((f) => f.endsWith('.ts') && /\bconstructDay\(/.test(stripComments(read(`apps/web/lib/${f}`)))).sort().join(',') === 'dayConstructor.ts,dayConstructorOrchestrator.ts');
check('no backtracking or second optimization pass was introduced: the only repeat of constructDay is the existing bounded replenishment loop', (stripComments(orchestrator).match(/constructDay\(\{/g) ?? []).length === 2 && /for \(let round = 0; round < flexibleIntentCount; round \+= 1\)/.test(stripComments(orchestrator)));
check('no test-only production hook: no fixture/force-overload/debug flag/environment branch in the decision modules', ![dayIntent, dayConstructor, dayCapacity, orchestrator].some((s) => /process\.env|forceOverload|__test|debugOverload|FIXTURE|NODE_ENV/.test(stripComments(s))));

// ============================================================
// The fixture is a REAL-pipeline test that asserts the required semantics
// ============================================================
const fixture = read('test/dayConstructorOverloadDecisionDb.test.ts');
const fx = stripComments(fixture);
check('the primary fixture exercises the real preview boundary and real persistence and never calls a comparator directly', /handleDayConstructorPreviewRequest\(/.test(fx) && /createPlannedActivity\(/.test(fx) && /replaceUserAvailabilityConfiguration\(/.test(fx) && !/compareByOverloadPrecedence|sortByOverloadPrecedence|compareCandidatesForPlacement|constructDay\(/.test(fx));
check('the fixture uses no mocked availability, plans, facts or Constructor result (no fake deps objects)', !/loadBlockingPlans:|loadAvailabilityConfiguration:\s*async|searchTiming:|jest\.|sinon|vi\.fn/.test(fx));
check('the fixture asserts INDIVIDUAL feasibility of each candidate, the combined contention, the winner and the deferred loser', /INDIVIDUAL FEASIBILITY: candidate A/.test(fixture) && /INDIVIDUAL FEASIBILITY: candidate B/.test(fixture) && /REAL CONTENTION/.test(fixture) && /CURRENT WINNER/.test(fixture) && /CURRENT DEFERRED REASON/.test(fixture));
check('the fixture asserts ORDER INDEPENDENCE for unequal importance (both submission orders) and the importance matrix', /reversed input \(B then A\)/.test(fixture) && /IMPORTANCE MATRIX/.test(fixture));
check('the fixture documents and asserts the current TIE behavior (submission order) and the deadline controls (today, earlier, none, and their rank against importance)', /final tie-break is submission order/.test(fixture) && /deadline TODAY/.test(fixture) && /EARLIER DEADLINE/.test(fixture) && /PRECEDENCE ORDER: deadline today ranks ABOVE importance/.test(fixture));
check('the fixture asserts the non-overloaded and fixed/blocker controls, the empty day, the Goal source-neutrality control, and the capacity-metadata discrepancy', /NOT OVERLOADED: enough capacity proposes BOTH/.test(fixture) && /FIXED stays authoritative/.test(fixture) && /EMPTY DAY/.test(fixture) && /SOURCE NEUTRALITY/.test(fixture) && /CAPACITY METADATA vs ACTUAL PLACEMENT CONTENTION/.test(fixture));
check('the fixture runs 20 determinism repetitions and both input permutations, and a UTC civil-time control', /i < 20/.test(fx) && /i < 10/.test(fx) && /CIVIL-TIME CONTROL/.test(fixture));
check('the fixture isolates selection from placement: equal activity, equal RESOLVED duration, explicit configured availability (no unconfigured fallback, no generic-fallback duration)', /durationMinutes: 60/.test(fx) && /replaceUserAvailabilityConfiguration\(/.test(fx) && !/GENERIC_FALLBACK/.test(fx));

if (!allPassed) {
  console.error('SOME OVERLOAD DECISION ARCHITECTURE CHECKS FAILED');
  process.exit(1);
}
console.log('ALL OVERLOAD DECISION ARCHITECTURE CHECKS PASSED');
