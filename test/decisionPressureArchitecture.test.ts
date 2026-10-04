/**
 * Constructor Decision Intelligence -- O5 P2b: pure Decision Pressure derivation (architecture guard, pure).
 *
 * Pins that the pressure deriver is a pure, categorical, source-neutral function whose ONLY fact authority is the immutable
 * `DecisionEvidence` (never the mutable `DecisionFacts` transport), that it exposes exactly two values, reads no importance,
 * deadline, order, timing, capacity, contention or Constructor result, has no DB/clock/environment/logging, and -- because
 * P2b is infrastructure -- is called by nothing: not the Constructor, the comparator, placement, replenishment, any
 * request/response/signed/persisted contract, or any explanation.
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

const srcRaw = read('apps/web/lib/decisionPressure.ts');
const src = stripComments(srcRaw);
const imports = (s: string) => [...s.matchAll(/^import (?:type )?(?:\{[^}]*\}|\*[^;]*|[^;{]*?) from '([^']+)';/gm)].map((m) => m[1]);

// ---- the type: categorical, exactly two values ----
check('PRESSURE TYPE: exactly `NONE | LAST_KNOWN_OPPORTUNITY`, a string-literal union -- no numeric score, no third value', /export type DecisionPressure = 'NONE' \| 'LAST_KNOWN_OPPORTUNITY';/.test(src) && count(/'LAST_KNOWN_OPPORTUNITY'/g, src) === 2 && count(/'NONE'/g, src) === 3);
check('the deriver is ONE exported pure function returning the categorical type: `deriveDecisionPressure(input): DecisionPressure`', /export function deriveDecisionPressure\(input: DecisionPressureInput\): DecisionPressure \{/.test(src) && count(/export function /g, src) === 1);
check('NO NUMERIC SCORE: no score / weight / rank / boost / priority / shortfall / deficit / urgency vocabulary, and no numeric return type', !/\bscore|weight|rank|boost|priorit|shortfall|deficit|urgen/i.test(src) && !/\): number\b/.test(src.slice(src.indexOf('export function deriveDecisionPressure'))));
check('NO USER-FACING LANGUAGE: no "must do today", "last chance" or "required today" wording anywhere (explanation belongs to P5)', !/must do today|last chance|required today/i.test(srcRaw));
check('the input is the minimal generic context: immutable evidence, the planning date and the candidate flexibility -- not a DayIntent', /export interface DecisionPressureInput \{\s*readonly evidence: DecisionEvidence \| undefined;\s*readonly planningDate: string;\s*readonly flexibility: PressureCandidateFlexibility;\s*\}/.test(src) && /export type PressureCandidateFlexibility = 'FLEXIBLE' \| 'FIXED';/.test(src) && !/DayIntent/.test(src));

// ---- authority: DecisionEvidence only ----
check('AUTHORITY: the evidence input is typed `DecisionEvidence` and the module imports exactly that type (from decisionEvidence) plus the strict civil-date validator -- nothing else', JSON.stringify(imports(src)) === JSON.stringify(['./decisionEvidence', '../../../packages/panchang/src/localDate']) && /^import type \{ DecisionEvidence \} from '\.\/decisionEvidence';/m.test(src) && /^import \{ isValidCalendarDateString \} from '\.\.\/\.\.\/\.\.\/packages\/panchang\/src\/localDate';/m.test(src));
check('NO DECISIONFACTS AUTHORITY: the module neither imports the mutable `DecisionFacts` transport module nor names any of its types (DecisionFacts, RecurrenceDecisionFacts, OpportunityDecisionFacts, resolveDecisionFactsForIntent, decisionFacts)', !/DecisionFacts|decisionFacts|resolveDecisionFactsForIntent|DecisionFactsByIntentId/.test(src));
const importersOf = (re: RegExp) => {
  const out: string[] = [];
  const walk = (dir: string) => fs.readdirSync(path.join(root, dir), { withFileTypes: true }).forEach((e) => {
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules' && !e.name.startsWith('.')) walk(rel); } else if (/\.(ts|tsx)$/.test(e.name) && re.test(stripComments(read(rel)))) out.push(rel);
  });
  ['apps/web/lib', 'apps/web/app', 'apps/web/components'].forEach(walk);
  return out.sort();
};
check('P2A AUTHORITY BOUNDARY: the only production modules that import the immutable evidence module are the evidence preparation stage and the pressure deriver; the pressure deriver is the only one that is a POLICY module and it never imports DecisionFacts', JSON.stringify(importersOf(/from '\.\/decisionEvidence'/)) === JSON.stringify(['apps/web/lib/decisionFactPreparation.ts', 'apps/web/lib/decisionPressure.ts']) && !/from '\.\/decisionFacts'/.test(src));

// ---- purity ----
check('PURE: no async, await, Promise, timer, DB, pool, query, transaction or write in the module', !/\basync\b|\bawait\b|Promise|setTimeout|setInterval|pool|\.query\(|beginTransaction|INSERT|UPDATE|DELETE|fetch\(/.test(src));
check('NO CLOCK: no `Date.now`, `new Date`, `Date.parse`, `getTime` or any Date construction in the deriver (civil dates are strings, compared as strings; validity comes from the existing strict validator)', !/\bDate\b|getTime|Intl\.|toISOString|Math\.random/.test(src) && /isValidCalendarDateString\(value\)/.test(src));
check('NO ENVIRONMENT / FLAGS: no process.env, feature flag, config or global read', !/process\.|\benv\b|feature|flag|globalThis|\bglobal\b|\bwindow\b|require\(/i.test(src));
check('NO GLOBAL STATE: no module-level `let`/`var` and no mutable module state (only const arrow helpers and the exported function)', !/^(let|var)\s/m.test(src) && count(/^const /gm, src) === 2);
check('NO LOGGING / TELEMETRY: no console, logger, warn or metric call', !/console\.|logger|\.warn\(|\.error\(|telemetry|metric|trackEvent/i.test(src));
check('FAILS CLOSED, NEVER THROWS: the derivation runs inside try/catch that returns NONE, and the module contains no `throw`', /try \{\s*return qualifies\(input\) \? 'LAST_KNOWN_OPPORTUNITY' : 'NONE';\s*\} catch \{\s*return 'NONE';\s*\}/.test(src) && !/\bthrow\b/.test(src));
check('NO MUTATION OF EVIDENCE: no assignment to, delete of or mutating call on any evidence property', !/(recurrence|opportunity|evidence)\.[A-Za-z]+\s*=[^=]/.test(src) && !/\bdelete\b|\.push\(|\.splice\(|Object\.assign|\.sort\(/.test(src));

// ---- source neutrality ----
check('SOURCE NEUTRALITY: no Goal, manual/automatic, demand, provenance, hand-off, rhythm, intent-id, title, activity or UI vocabulary, and the input carries no id, title or source', !/goal|manual|automatic|demand|provenance|handoff|hand-off|rhythm|plan-day|intentId|\btitle\b|activityId|startsWith|decode|encode|\bUI\b/i.test(src));
check('EXCLUDED AUTHORITIES: no importance, deadline, original order, timing fit, capacity, contention or targetDate is read', !/importance|deadline|originalOrder|timingFit|capacity|contention|targetDate/i.test(src));
check('NO CONSTRUCTOR RESULT: no proposed/deferred item, conflict diagnostic, winner/loser, placement or constructDay concept is read', !/proposed|deferred|conflict|diagnostic|winner|loser|placement|constructDay|precedence|compareBy/i.test(src));
check('NO SHORTFALL MATH: no line combines recurrence demand with opportunity supply (demand is occurrences, supply is viable civil days -- never subtracted or compared)', !src.split('\n').some((l) => /remainingInPeriod/.test(l) && /viableDays|afterStartViableDays/.test(l)));

// ---- the exact predicate ----
const pins: Array<[string, RegExp]> = [
  ['A: only FLEXIBLE can qualify; FIXED (and anything else) returns false', /if \(input\.flexibility !== 'FLEXIBLE'\) return false;/],
  ['B/F: both evidence categories are required', /const recurrence = input\.evidence\?\.recurrence;\s*const opportunity = input\.evidence\?\.opportunity;\s*if \(!recurrence \|\| !opportunity\) return false;/],
  ['C: the period must be LOCAL_CALENDAR_WEEK', /if \(recurrence\.period !== 'LOCAL_CALENDAR_WEEK'\) return false;/],
  ['strict civil dates for all five date inputs', /isCivilDate\(planningDate\)[\s\S]*isCivilDate\(recurrence\.periodStartDate\) \|\| !isCivilDate\(recurrence\.periodEndDate\)[\s\S]*isCivilDate\(opportunity\.horizonStartDate\) \|\| !isCivilDate\(opportunity\.horizonEndDate\)/],
  ['date order: period and horizon', /recurrence\.periodStartDate > recurrence\.periodEndDate\) return false;[\s\S]*opportunity\.horizonStartDate > opportunity\.horizonEndDate\) return false;/],
  ['D: the planning date lies inside the period', /planningDate < recurrence\.periodStartDate \|\| planningDate > recurrence\.periodEndDate\) return false;/],
  ['recurrence counts are nonnegative integers', /isCount\(recurrence\.targetPerPeriod\)[\s\S]*isCount\(recurrence\.completedInPeriod\)[\s\S]*isCount\(recurrence\.committedInPeriod\)[\s\S]*isCount\(recurrence\.remainingInPeriod\)/],
  ['recurrence arithmetic: remaining equals the producer relation max(0, target - completed - committed)', /recurrence\.remainingInPeriod !== Math\.max\(0, recurrence\.targetPerPeriod - recurrence\.completedInPeriod - recurrence\.committedInPeriod\)\) return false;/],
  ['E: at least one occurrence remains (>= 1, not exactly 1)', /if \(recurrence\.remainingInPeriod < 1\) return false;/],
  ['G: the horizon starts exactly at the planning date', /if \(opportunity\.horizonStartDate !== planningDate\) return false;/],
  ['H: the horizon ends exactly at the period end', /if \(opportunity\.horizonEndDate !== recurrence\.periodEndDate\) return false;/],
  ['I: the duration basis must be RESOLVED, and the duration a positive integer', /if \(opportunity\.durationBasis !== 'RESOLVED'\) return false;[\s\S]*opportunity\.durationMinutes < 1\) return false;/],
  ['opportunity counts are nonnegative integers (all six)', /isCount\(opportunity\.evaluatedDays\)[\s\S]*isCount\(opportunity\.viableDays\)[\s\S]*isCount\(opportunity\.unknownDays\)[\s\S]*isCount\(opportunity\.afterStartEvaluatedDays\)[\s\S]*isCount\(opportunity\.afterStartViableDays\)[\s\S]*isCount\(opportunity\.afterStartUnknownDays\)/],
  ['N: the evaluated partition', /opportunity\.evaluatedDays !== 1 \+ opportunity\.afterStartEvaluatedDays\) return false;/],
  ['N: the viable partition', /opportunity\.viableDays !== \(opportunity\.startDateState === 'KNOWN_FEASIBLE' \? 1 : 0\) \+ opportunity\.afterStartViableDays\) return false;/],
  ['N: the unknown partition', /opportunity\.unknownDays !== \(opportunity\.startDateState === 'UNKNOWN' \? 1 : 0\) \+ opportunity\.afterStartUnknownDays\) return false;/],
  ['J: the current day must be KNOWN_FEASIBLE', /if \(opportunity\.startDateState !== 'KNOWN_FEASIBLE'\) return false;/],
  ['K: no later day is known viable', /if \(opportunity\.afterStartViableDays !== 0\) return false;/],
  ['L: no later day is unknown', /if \(opportunity\.afterStartUnknownDays !== 0\) return false;/],
  ['M: coverage must be COMPLETE', /if \(opportunity\.coverage !== 'COMPLETE'\) return false;/],
  ['positive evidence only: the function ends in `return true` (anything not explicitly established was already NONE)', /if \(opportunity\.coverage !== 'COMPLETE'\) return false;\s*return true;\s*\}/],
];
for (const [label, re] of pins) check(`PREDICATE ${label}`, re.test(src));
check('the predicate has no OR-branch that could widen it: every qualifying condition is an early `return false`, and there is exactly one `return true`', count(/return true;/g, src) === 1 && !/\|\| \(.*\) return true|return .* \|\| /.test(src));

// ---- unwired: infrastructure only ----
const pressureMentions = importersOf(/DecisionPressure|decisionPressure|deriveDecisionPressure|LAST_KNOWN_OPPORTUNITY|PressureCandidateFlexibility/);
check('UNWIRED: the only production file that mentions pressure at all is the deriver itself -- not the orchestrator, Constructor, comparator, placement, capacity, replenishment, preview, acceptance, signing, persistence, routes or explanation code', JSON.stringify(pressureMentions) === JSON.stringify(['apps/web/lib/decisionPressure.ts']));
const INERT = ['apps/web/lib/dayConstructorOrchestrator.ts', 'apps/web/lib/dayConstructor.ts', 'apps/web/lib/dayIntent.ts', 'apps/web/lib/dayCapacity.ts', 'apps/web/lib/decisionFactPreparation.ts', 'apps/web/lib/decisionEvidence.ts', 'apps/web/lib/dayConstructorPreviewRequest.ts', 'apps/web/lib/dayConstructorPreviewIntegrity.ts', 'apps/web/lib/dayConstructorAcceptance.ts', 'apps/web/lib/dayConstructorAcceptancePersistence.ts', 'apps/web/lib/remainingDayRecomposition.ts', 'apps/web/lib/dayPlanPreviewPresentation.ts', 'apps/web/app/api/day-constructor/preview/route.ts', 'apps/web/app/api/day-constructor/accept/route.ts'];
check('the Constructor, comparator, placement, capacity, replenishment, evidence/preparation stage, preview request, signing, acceptance, persistence, Recomposition, presentation and routes contain no pressure reference (nothing is wired)', INERT.every((f) => !/ressure/.test(stripComments(read(f)))));
check('NO NEW FIELD ANYWHERE: pressure is not a field of DayIntent, ProposedItem, DeferredItem, the preview body, the signed item facts or any persisted row (no schema change: 43 migration directories)', !/ressure/.test(stripComments(read('apps/web/lib/dayIntent.ts'))) && !/ressure/.test(stripComments(read('apps/web/lib/dayConstructor.ts'))) && !/ressure/.test(stripComments(read('apps/web/lib/dayConstructorPreviewIntegrity.ts'))) && !/ressure/.test(read('apps/web/prisma/schema.prisma')) && fs.readdirSync(path.join(root, 'apps/web/prisma/migrations'), { withFileTypes: true }).filter((e) => e.isDirectory()).length === 43);
check('no shadow evaluation, contention trace, active policy or explanation exists in this slice (P3a / P3b / P4 / P5 own them)', !/shadow|contentionTrace|trace|explain|explanation|activePolicy|enabled/i.test(src));

// ---- P2a boundary kept ----
const ev = stripComments(read('apps/web/lib/decisionEvidence.ts'));
check('P2A UNCHANGED: the evidence module still has only a type-only import, no policy or pressure concept, and is not given a consumer by this slice', count(/^import /gm, ev) === 1 && !/ressure|derive|LAST_KNOWN/i.test(ev));

// ---- this slice's tests ----
const unit = read('test/decisionPressure.test.ts');
const FALSE_CLAIM = /policy (is )?(active|enabled|applied)|changes? (the )?(placement|precedence|winner)|affects? the (constructed|proposed)/i;
check('the unit test makes no claim that pressure is wired, active or changes any Constructor outcome', !(unit.match(/check\(`?'?[^\n]*/g) ?? []).some((l) => FALSE_CLAIM.test(l)));
check('the unit test covers: the canonical positive, remaining > 1, Sunday one-day horizon, Monday, midweek, year boundary, DST dates, the single-predicate matrix (>=150), malformed counts/durations/dates, absence/hostile evidence, immutability, determinism, no clock/log, source neutrality, multiple candidates, and the REAL producers', /canonical positive/.test(unit) && /REMAINING \$\{remaining\}/.test(unit) && /ONE-DAY HORIZON/.test(unit) && /MONDAY/.test(unit) && /MIDWEEK/.test(unit) && /YEAR BOUNDARY/.test(unit) && /DST/.test(unit) && /THE MATRIX IS EXHAUSTIVE/.test(unit) && /MALFORMED COUNTS/.test(unit) && /MALFORMED DURATION/.test(unit) && /MALFORMED DATES/.test(unit) && /EVIDENCE IMMUTABILITY/.test(unit) && /NO CLOCK/.test(unit) && /NO LOGGING/.test(unit) && /SOURCE NEUTRALITY/.test(unit) && /MULTIPLE CANDIDATES/.test(unit) && /REAL PRODUCER/.test(unit));

if (!allPassed) {
  console.error('SOME DECISION PRESSURE ARCHITECTURE CHECKS FAILED');
  process.exit(1);
}
console.log('ALL DECISION PRESSURE ARCHITECTURE CHECKS PASSED');
