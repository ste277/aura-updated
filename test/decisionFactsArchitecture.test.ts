/**
 * Constructor Decision Intelligence -- Decision Facts V1, architecture
 * proof (pure, no DB).
 *
 * Asserts the ARCHITECTURE (forbidden modules/imports/references in the
 * protected files, where the source-specific boundary lives, that facts
 * are inert) rather than relying on identifier names, plus the pure
 * behavior of the generic seam, the Goal-aware provider, the preview
 * handler's failure behavior, and two-direction source neutrality.
 */
import fs from 'fs';
import path from 'path';
import { resolveDecisionFactsForIntent, type DecisionFacts } from '../apps/web/lib/decisionFacts';
import { translateGoalDemandToDecisionFacts, loadGoalDecisionFacts } from '../apps/web/lib/goalDecisionFactsProvider';
import type { GoalDemandCandidate, GoalDemandCandidatesDeps } from '../apps/web/lib/goalDemandCandidates';
import { encodeGoalDemandIntentId } from '../apps/web/lib/goalDemandIntentId';
import { runDayConstructorPreview } from '../apps/web/lib/dayConstructorPreviewRequest';
import type { DayConstructorOrchestratorDeps, ConstructDayRequest } from '../apps/web/lib/dayConstructorOrchestrator';
import { constructDay } from '../apps/web/lib/dayConstructor';
import { buildDayIntent, type DayIntent } from '../apps/web/lib/dayIntent';
import type { CandidateGoalActivityForRhythmDemandRow, User } from '../apps/web/lib/db';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

const read = (p: string) => fs.readFileSync(path.join(__dirname, p), 'utf8');
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const iso = (s: string) => new Date(s);

const orchestratorSrc = read('../apps/web/lib/dayConstructorOrchestrator.ts');
const decisionFactsSrc = read('../apps/web/lib/decisionFacts.ts');
const previewRequestSrc = read('../apps/web/lib/dayConstructorPreviewRequest.ts');
const providerSrc = read('../apps/web/lib/goalDecisionFactsProvider.ts');
const previewRouteSrc = read('../apps/web/app/api/day-constructor/preview/route.ts');
const dayConstructorSrc = read('../apps/web/lib/dayConstructor.ts');
const dayIntentSrc = read('../apps/web/lib/dayIntent.ts');
const dayCapacitySrc = read('../apps/web/lib/dayCapacity.ts');

// ============================================================
// STRUCTURE -- forbidden modules/imports, not just words
// ============================================================
check('orchestrator is Goal-blind (no "goal" anywhere, comments included)', !/goal/i.test(orchestratorSrc));
check('orchestrator is Rhythm-blind (no "rhythm" anywhere, comments included)', !/rhythm/i.test(orchestratorSrc));
check('orchestrator imports no goal-demand module (goalDemandIntentId/goalDemandCandidates/goalDemandProvenanceAuthorization/goalActivityRhythm)', !/from '\.\/(goalDemand|goalActivityRhythm|goals|goalDecision)/.test(orchestratorSrc));
check('orchestrator imports decisionFacts.ts only for the generic lookup/type', /import \{ resolveDecisionFactsForIntent, type DecisionFactsByIntentId \} from '\.\/decisionFacts';/.test(orchestratorSrc));
check('orchestrator has exactly one deps-bound fact acquisition: none (no loader dependency, no DB call for facts)', !/loadGoal|loadDecisionFacts|loadRhythm/.test(orchestratorSrc));

check('decisionFacts.ts has no import statements at all (source-blind)', !/^\s*import\s/m.test(stripComments(decisionFactsSrc)));
check('decisionFacts.ts never mentions a source, goal, rhythm, or intent-id decoding', !/goal|rhythm|goal-demand|classify|decode|split\(/i.test(decisionFactsSrc));
check('decisionFacts.ts does no DB/network I/O', !/pool\.|fetch\(|beginTransaction|async\s/.test(stripComments(decisionFactsSrc)));
check(
  'DecisionFacts type carries no priority/urgency/rank/weight/boost/penalty/score or source-identity field',
  !/\b(priority\w*|urgency\w*|rank\w*|weight\w*|boost\w*|penalty\w*|score\w*|goalId|goalActivityId|templateCategory|source)\b/i.test(stripComments(decisionFactsSrc))
);

check('preview request handler is source-blind (no goal/rhythm mention, no goal module import)', !/goal|rhythm/i.test(previewRequestSrc));

check('provider reuses Candidate A1 read model verbatim (imports loadEligibleGoalDemand)', /import \{[^}]*loadEligibleGoalDemand[^}]*\} from '\.\/goalDemandCandidates';/.test(providerSrc));
check('provider uses the ENCODER, never the decoder, and no ad hoc namespace parsing', /encodeGoalDemandIntentId\(/.test(stripComments(providerSrc)) && !/classifyGoalDemandIntentId|\.split\(['"]:['"]\)|startsWith\(['"]goal-demand/.test(stripComments(providerSrc)));
check('provider never imports the provenance authorization layer', !/goalDemandProvenanceAuthorization/.test(providerSrc));
check('provider contains no Rhythm arithmetic of its own (no eligibility call, no Math.max, no week-start or date arithmetic)', !/computeGoalActivityRhythmEligibility|Math\.max|localCalendarWeekStart|addDaysToDateStr|getWeekdayForDateStr|getUTCDay|setUTCDate|Date\.UTC|new Date\(/.test(stripComments(providerSrc)));
check('O3: provider obtains the period bounds ONLY from the canonical Rhythm helper (import + single use)', /import \{ localCalendarWeekBounds \} from '\.\/goalActivityRhythm';/.test(providerSrc) && (stripComments(providerSrc).match(/localCalendarWeekBounds\(/g) ?? []).length === 1);
check('O3: provider imports no opportunity (O1/O2) module and no range/availability module', !/opportunityProjection|opportunityRange|availabilityContext|dayCapacity|planBlockerLifecycle/.test(providerSrc));
check('O3: the canonical week helper lives with the Rhythm week-start it is derived from', /export function localCalendarWeekBounds\(/.test(read('../apps/web/lib/goalActivityRhythm.ts')) && /const startDate = localCalendarWeekStart\(localDateStr\);/.test(read('../apps/web/lib/goalActivityRhythm.ts')));
check('O3: decisionFacts.ts CARRIES the period bounds but calculates nothing (no date arithmetic, no helper, no Date)', /periodStartDate: string;/.test(decisionFactsSrc) && /periodEndDate: string;/.test(decisionFactsSrc) && !/addDays|getWeekday|getUTC|setUTC|Date\.|new Date|Math\.|localCalendar/.test(stripComments(decisionFactsSrc)));
check('O3: no OpportunityFacts fields (viableDays/unknownDays/coverage) in the decision-facts path -- that is O4', !/viableDays|unknownDays|coverage|OpportunityFacts/.test(stripComments(decisionFactsSrc) + stripComments(providerSrc)));
check('provider imports db.ts for the User TYPE only (no direct query)', /import type \{ User \} from '\.\/db';/.test(providerSrc) && !/from '\.\/db'/.test(providerSrc.replace("import type { User } from './db';", '')));

check('route wires the source-specific provider into the generic loader seam', /loadGoalDecisionFacts/.test(previewRouteSrc) && /loadDecisionFacts:/.test(previewRouteSrc));

// ============================================================
// INERTNESS -- no decision/acceptance/persistence consumer
// ============================================================
function functionBody(source: string, name: string): string {
  const start = source.indexOf(`function ${name}`);
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
check('dayConstructor.ts never references decision facts', !/decisionFacts|DecisionFacts/.test(dayConstructorSrc));
check('dayCapacity.ts never references decision facts', !/decisionFacts|DecisionFacts/.test(dayCapacitySrc));
check('compareByOverloadPrecedence has no DecisionFacts branch (exact existing precedence)', !/decisionFacts|recurrence|remainingInPeriod/.test(functionBody(dayIntentSrc, 'compareByOverloadPrecedence')));
for (const [label, file] of Object.entries({
  'acceptance (dayConstructorAcceptance.ts)': '../apps/web/lib/dayConstructorAcceptance.ts',
  'acceptance persistence (dayConstructorAcceptancePersistence.ts)': '../apps/web/lib/dayConstructorAcceptancePersistence.ts',
  'preview integrity/signing (dayConstructorPreviewIntegrity.ts)': '../apps/web/lib/dayConstructorPreviewIntegrity.ts',
  'accept route': '../apps/web/app/api/day-constructor/accept/route.ts',
  'goal-demand provenance authorization': '../apps/web/lib/goalDemandProvenanceAuthorization.ts',
  'acceptance body builder (acceptConstructedDay.ts)': '../apps/web/lib/acceptConstructedDay.ts',
})) {
  check(`${label} never references decision facts (facts are not provenance and never reach persistence)`, !/decisionFacts|DecisionFacts|remainingInPeriod/.test(read(file)));
}
const libDir = path.join(__dirname, '../apps/web/lib');
const consumers = fs.readdirSync(libDir).filter((f) => f.endsWith('.ts') && /remainingInPeriod|completedInPeriod|committedInPeriod|targetPerPeriod/.test(fs.readFileSync(path.join(libDir, f), 'utf8')));
check('only the generic type module and the source-specific provider reference the recurrence fact fields', consumers.sort().join(',') === 'decisionFacts.ts,goalDecisionFactsProvider.ts');
const periodBoundConsumers = fs.readdirSync(libDir).filter((f) => f.endsWith('.ts') && /periodStartDate|periodEndDate/.test(fs.readFileSync(path.join(libDir, f), 'utf8')));
check('O3: only the generic type module and the source-specific provider reference periodStartDate/periodEndDate -- no policy, precedence, placement, eligibility, acceptance or opportunity consumer', periodBoundConsumers.sort().join(',') === 'decisionFacts.ts,goalDecisionFactsProvider.ts');
check('O3: no component/route/page reads the period bounds either', !/periodStartDate|periodEndDate/.test(fs.readdirSync(path.join(__dirname, '../apps/web/app'), { recursive: true }).filter((f) => typeof f === 'string' && /\.(ts|tsx)$/.test(f)).map((f) => fs.readFileSync(path.join(__dirname, '../apps/web/app', f as string), 'utf8')).join('\n')));
check('no scarcity/wellbeing/score field exists anywhere in the decision-facts path', !/viableOpportunities|lastChance|lastViableWindow|weeklyWindowCount|wellbeing|priorityScore|urgencyScore/i.test(decisionFactsSrc + providerSrc));

// ============================================================
// PURE BEHAVIOR -- generic seam
// ============================================================
const sampleFacts: DecisionFacts = { recurrence: { period: 'LOCAL_CALENDAR_WEEK', periodStartDate: '2026-10-05', periodEndDate: '2026-10-11', targetPerPeriod: 3, completedInPeriod: 1, committedInPeriod: 0, remainingInPeriod: 2 } };
check('resolveDecisionFactsForIntent: returns the provider-associated facts', resolveDecisionFactsForIntent('a', new Map([['a', sampleFacts]])) === sampleFacts);
check('resolveDecisionFactsForIntent: unknown id -> undefined', resolveDecisionFactsForIntent('zzz', new Map([['a', sampleFacts]])) === undefined);
check('resolveDecisionFactsForIntent: absent map -> undefined (behavior identical to no provider)', resolveDecisionFactsForIntent('a', undefined) === undefined);
check('resolveDecisionFactsForIntent does not decode ids: a goal-demand-shaped id with no association gets nothing', resolveDecisionFactsForIntent(encodeGoalDemandIntentId('2026-10-06', 'ga-1'), new Map()) === undefined);

// ============================================================
// PURE BEHAVIOR -- source-specific provider
// ============================================================
function candidate(goalActivityId: string, overrides: Partial<GoalDemandCandidate['rhythm']> = {}): GoalDemandCandidate {
  const rhythm = { targetPerWeek: 3, completedThisWeek: 1, committedThisWeek: 0, remainingOccurrences: 2, ...overrides };
  return { goalActivityId, goalId: 'g', goalTitle: 'g', title: 't', activityId: null, remainingThisWeek: rhythm.remainingOccurrences, rhythm };
}
{
  const date = '2026-10-06';
  const requested = new Set([encodeGoalDemandIntentId(date, 'ga-1'), 'typed-1', encodeGoalDemandIntentId('2026-10-07', 'ga-2')]);
  const out = translateGoalDemandToDecisionFacts([candidate('ga-1'), candidate('ga-2'), candidate('ga-3')], date, requested);
  check('translate: only facts for requested ids are produced (ga-3 not requested)', out.size === 1 && out.has(encodeGoalDemandIntentId(date, 'ga-1')));
  check('translate: an id encoded for a DIFFERENT planning date gets no facts (ga-2)', !out.has(encodeGoalDemandIntentId('2026-10-07', 'ga-2')));
  const facts = out.get(encodeGoalDemandIntentId(date, 'ga-1'))!;
  check('translate: exact canonical field mapping, with the explicit period literal', JSON.stringify(facts) === JSON.stringify(sampleFacts));
  check('translate: carries no identity (no goalId/goalActivityId anywhere in the generic fact)', !/goal/i.test(JSON.stringify(facts)));
  check('translate: a non-demand (typed) intent id never receives facts', !out.has('typed-1'));
}

const FAKE_USER = { id: 'user-A', timezone: 'UTC' } as User;
function rowFor(id: string): CandidateGoalActivityForRhythmDemandRow {
  return { goalActivityId: id, goalId: 'g', goalTitle: 'g', title: 't', activityId: null, rhythmKind: 'N_PER_WEEK', rhythmTargetPerWeek: 3 } as CandidateGoalActivityForRhythmDemandRow;
}
function requestFor(ids: string[], targetDate = '2026-10-06'): ConstructDayRequest {
  return { targetDate, timezone: 'UTC', constructionWindowSource: 'EXPLICIT_RANGE', now: iso('2026-10-06T03:00:00Z'), intents: ids.map((id, i) => ({ id, title: `t${i}`, flexibility: 'FLEXIBLE', originalOrder: i })) };
}
(async () => {
  {
    const calls = { discovery: 0, facts: 0 };
    const deps: GoalDemandCandidatesDeps = {
      loadCandidateGoalActivities: async () => {
        calls.discovery += 1;
        return [rowFor('ga-1'), rowFor('ga-2'), rowFor('ga-3')];
      },
      loadRhythmFacts: async () => {
        calls.facts += 1;
        return new Map();
      },
    };
    const ids = ['ga-1', 'ga-2', 'ga-3'].map((g) => encodeGoalDemandIntentId('2026-10-06', g));
    const out = await loadGoalDecisionFacts(FAKE_USER, requestFor(ids), deps);
    check('provider: 3 goal-derived intents -> 3 fact entries', out.size === 3);
    check('provider query shape: exactly one discovery call and one batched facts call, independent of intent count (no N+1)', calls.discovery === 1 && calls.facts === 1);
    const none = await loadGoalDecisionFacts(FAKE_USER, requestFor([]), deps);
    check('provider: a request with no intents performs zero queries', none.size === 0 && calls.discovery === 1 && calls.facts === 1);
  }
  {
    const failing: GoalDemandCandidatesDeps = {
      loadCandidateGoalActivities: async () => {
        throw new Error('db down');
      },
      loadRhythmFacts: async () => new Map(),
    };
    const out = await loadGoalDecisionFacts(FAKE_USER, requestFor([encodeGoalDemandIntentId('2026-10-06', 'ga-1')]), failing);
    check('provider failure behavior: a failed Goal-demand load yields NO facts (never throws, never fabricates)', out.size === 0);
  }

  // ============================================================
  // PREVIEW HANDLER -- generic seam, failure behavior, trust
  // ============================================================
  const orchestratorDeps: DayConstructorOrchestratorDeps = {
    loadBlockingPlans: async () => [],
    loadDurationContext: async () => ({ preferredDurationByActivityId: {}, behavioralDurationByActivityId: {} }),
    searchTiming: () => ({ candidates: [] }),
    loadAvailabilityConfiguration: async () => ({ configured: false, periods: [] }),
  };
  const NOW = iso('2026-09-16T09:00:00Z');
  const body = (extra: Record<string, unknown> = {}, intentExtra: Record<string, unknown> = {}) => ({
    constructionWindowSource: 'EXPLICIT_RANGE',
    explicitStart: '2026-09-16T09:00:00Z',
    explicitEnd: '2026-09-16T17:00:00Z',
    intents: [{ id: 'i1', title: 'Draft the deck', flexibility: 'FLEXIBLE', durationMinutes: 30, ...intentExtra }, { id: 'i2', title: 'Write report', flexibility: 'FLEXIBLE', durationMinutes: 30 }],
    ...extra,
  });
  const resolvedFor = (result: { body: Record<string, any> }, id: string) => JSON.parse(JSON.stringify(result.body)).preview.resolvedIntents.find((r: any) => r.requestedIntentId === id);

  {
    let seen: ConstructDayRequest | undefined;
    const source = async (request: ConstructDayRequest) => {
      seen = request;
      return new Map<string, DecisionFacts>([['i1', sampleFacts]]);
    };
    const result = await runDayConstructorPreview(body(), 'UTC', NOW, orchestratorDeps, source);
    check('handler: preview with a provider is READY', result.httpStatus === 200 && (result.body as any).status === 'READY');
    check('handler: provider facts reach the matching resolved intent', JSON.stringify(resolvedFor(result, 'i1').dayIntent.decisionFacts) === JSON.stringify(sampleFacts));
    check('handler: intents without an association carry no facts (non-source intents unaffected)', resolvedFor(result, 'i2').dayIntent.decisionFacts === undefined);
    check('handler: provider received the parsed request with the real intent ids', !!seen && seen.intents.map((i) => i.id).join(',') === 'i1,i2');
    check('handler: provider receives a request with no pre-existing fact map', !!seen && (seen as any).decisionFactsByIntentId === undefined);
  }
  {
    const result = await runDayConstructorPreview(body(), 'UTC', NOW, orchestratorDeps);
    check('handler: no provider -> READY with no facts anywhere (byte-equivalent to pre-Decision-Facts behavior)', (result.body as any).status === 'READY' && resolvedFor(result, 'i1').dayIntent.decisionFacts === undefined);
  }
  {
    const throwing = async () => {
      throw new Error('provider exploded');
    };
    const originalWarn = console.warn;
    console.warn = () => {};
    const result = await runDayConstructorPreview(body(), 'UTC', NOW, orchestratorDeps, throwing);
    console.warn = originalWarn;
    check('failure behavior: a throwing provider does NOT fail the preview (HTTP 200 READY)', result.httpStatus === 200 && (result.body as any).status === 'READY');
    check('failure behavior: ...and the intent simply carries no facts', resolvedFor(result, 'i1').dayIntent.decisionFacts === undefined);
  }
  {
    // TRUST: a client cannot supply facts through the request body.
    const forged = { recurrence: { period: 'LOCAL_CALENDAR_WEEK', periodStartDate: '1999-01-04', periodEndDate: '1999-01-10', targetPerPeriod: 99, completedInPeriod: 0, committedInPeriod: 0, remainingInPeriod: 99 } };
    const result = await runDayConstructorPreview(body({ decisionFactsByIntentId: { i1: forged }, decisionFacts: forged }, { decisionFacts: forged }), 'UTC', NOW, orchestratorDeps);
    check('trust: forged decisionFacts in the request body (top-level or per-intent) are ignored entirely', resolvedFor(result, 'i1').dayIntent.decisionFacts === undefined);
  }

  // ============================================================
  // TWO-DIRECTION SOURCE NEUTRALITY (pure constructDay)
  // ============================================================
  {
    const window = { date: '2026-10-06', start: iso('2026-10-06T03:30:00Z'), end: iso('2026-10-06T04:00:00Z'), timezone: 'UTC', source: 'EXPLICIT_RANGE' as const };
    const cand = (intentId: string) => ({ intentId, start: window.start, end: window.end, candidateOrder: 0 });
    const mk = (title: string, order: number, id: string, facts?: DecisionFacts): DayIntent => ({
      ...buildDayIntent({ title, targetDate: '2026-10-06', flexibility: 'FLEXIBLE', estimatedDurationMinutes: 30 }, order),
      id,
      ...(facts ? { decisionFacts: facts } : {}),
    });
    const run = (a: DayIntent, b: DayIntent) =>
      constructDay({ intents: [a, b], window, today: '2026-10-06', blockedIntervals: [], candidatesByIntentId: { [a.id]: [cand(a.id)], [b.id]: [cand(b.id)] }, fixedConstraintsByIntentId: {} });
    const withFactsFirst = run(mk('A', 0, 'A1', sampleFacts), mk('B', 1, 'B1'));
    const withoutFactsFirst = run(mk('A', 1, 'A2', sampleFacts), mk('B', 0, 'B2'));
    check('neutrality (A carries facts, A first by originalOrder): A wins only because of originalOrder', withFactsFirst.status === 'READY' && withFactsFirst.day.proposedItems.map((i) => i.intentId).join() === 'A1');
    check('neutrality (A carries facts, B first by originalOrder): B wins -- facts never change the existing precedence outcome', withoutFactsFirst.status === 'READY' && withoutFactsFirst.day.proposedItems.map((i) => i.intentId).join() === 'B2');
    const plainFirst = run(mk('A', 0, 'A3'), mk('B', 1, 'B3'));
    check('neutrality: identical outcome with and without facts when originalOrder is the same', plainFirst.status === 'READY' && plainFirst.day.proposedItems[0].intentId === 'A3');
  }

  if (!allPassed) {
    console.error('SOME DECISION FACTS ARCHITECTURE CHECKS FAILED');
    process.exit(1);
  }
  console.log('ALL DECISION FACTS ARCHITECTURE CHECKS PASSED');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
