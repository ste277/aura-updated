/**
 * Constructor Decision Intelligence -- O5 P2c: duration-source and catalog REACHABILITY of Decision Pressure (pure, no DB).
 *
 * Question answered: can a recurrence-eligible candidate's evidence reach `durationBasis: 'RESOLVED'` -- the only basis
 * `deriveDecisionPressure` accepts -- and from which sources? And separately: does a RESOLVED duration actually produce
 * `LAST_KNOWN_OPPORTUNITY`? (Those are different questions and are asserted separately: a RESOLVED duration is necessary,
 * never sufficient; scarcity of the remaining days is the other half.)
 *
 * The REAL orchestrator (which owns duration resolution), the REAL generic preparer, the REAL O2 range adapter, the REAL O1
 * projection, the REAL evidence builder and the REAL pressure deriver run. Only the database loaders (duration context,
 * blockers, availability) and the timing search are injected, so every duration source can be driven individually:
 *
 *   explicit requested duration > stored UserActivityPreference > behavioral typical duration > catalog
 *   `defaultDurationMinutes`   -- all four are RESOLVED
 *   catalog `suggestedDurations[0]` (no default) and the generic 45-minute floor -- both GENERIC_FALLBACK
 *
 * Pressure is derived HERE only; nothing in production calls it (P2b is unwired and P2c does not wire it). The explicit
 * per-activity table below is deliberately NOT a frozen count: it classifies every current catalog activity by name, so a
 * catalog edit (a default added or removed, an activity added) fails here and must be re-classified on purpose; the counts are
 * reported from the live catalog, not asserted as a magic number.
 *
 * READINESS NOTE: this suite is evidence for approving P3 SHADOW evaluation only. It says nothing about active policy (P4),
 * which additionally needs the P3a contention trace, P3b shadow evidence, the P2d coherent scheduling snapshot, a typed
 * promotion input and a contention-gated policy.
 */
import * as preparationModule from '../apps/web/lib/decisionFactPreparation';
import { createDecisionFactPreparer, type DecisionFactPreparer, type PreparationIntentInput } from '../apps/web/lib/decisionFactPreparation';
import { orchestrateConstructDay, type ConstructDayRequest, type DayConstructorOrchestratorDeps, type RequestedDayIntent } from '../apps/web/lib/dayConstructorOrchestrator';
import { deriveDecisionPressure, type DecisionPressure } from '../apps/web/lib/decisionPressure';
import type { DecisionEvidence, DecisionEvidenceByIntentId } from '../apps/web/lib/decisionEvidence';
import type { DecisionFacts } from '../apps/web/lib/decisionFacts';
import type { OpportunityRangeDeps } from '../apps/web/lib/opportunityRangeAdapter';
import type { AvailabilityConfiguration } from '../apps/web/lib/availabilityContext';
import { FULL_ACTIVITY_CATALOG, getActivityProfileById, findActivityIntent } from '../packages/recommendation/src/personalizedTasks';
import { getActivityDefinition } from '../packages/recommendation/src/activityDefinitions';
import { durationMinutesFor, GENERIC_DURATION_FALLBACK_MINUTES } from '../apps/web/lib/dayBuilderOrchestrator';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

type Weekday = AvailabilityConfiguration['periods'][number]['weekday'];
const workWeek: AvailabilityConfiguration = { configured: true, periods: ([1, 2, 3, 4, 5] as Weekday[]).map((weekday) => ({ weekday, startTime: '09:00', endTime: '17:00' })) };
const UNCONFIGURED: AvailabilityConfiguration = { configured: false, periods: [] };

const FRIDAY = '2026-10-09'; // the last weekday of the 2026-10-05..2026-10-11 local calendar week: Saturday and Sunday have no availability
const WEDNESDAY = '2026-10-07'; // Thursday and Friday are still viable later days
const WEEK_FACTS: DecisionFacts = { recurrence: { period: 'LOCAL_CALENDAR_WEEK', periodStartDate: '2026-10-05', periodEndDate: '2026-10-11', targetPerPeriod: 3, completedInPeriod: 0, committedInPeriod: 0, remainingInPeriod: 3 } };

/**
 * EVERY activity of the current catalog, classified by name: [activityId, defaultDurationMinutes | null, suggestedDurations[0] | null].
 * `default` -> a RESOLVED basis with no other source. `suggested` only (no default) -> GENERIC_FALLBACK although the minutes
 * are the suggestion. Neither -> GENERIC_FALLBACK at the 45-minute floor.
 */
const CATALOG_TABLE: ReadonlyArray<readonly [string, number | null, number | null]> = [
  ['task-1', null, null], ['task-2', null, null], ['task-3', 10, null], ['task-4', null, null], ['task-5', null, null], ['task-6', null, null], ['task-7', 10, null],
  ['start-journey', null, null], ['deep-work', null, 30], ['workout', null, 30], ['tea-break', 10, null], ['dating', null, null], ['party', null, null],
  ['financial-decision', null, null], ['new-beginning', null, null], ['learning', null, 20], ['business-start', null, null], ['property-purchase', null, null],
  ['engagement', null, null], ['griha-pravesh', null, null], ['marriage', null, null],
  ['date-night', 120, 90], ['dinner-date', 90, 60], ['coffee-tea', 45, 30], ['movie-night', 150, 120], ['walk-together', 45, 30], ['family-dinner', 90, 60],
  ['family-outing', 180, 120], ['visit-family', 120, 60], ['family-movie-night', 150, 120], ['dinner-with-friends', 120, 90], ['catch-up', 60, 45],
  ['game-night', 150, 120], ['birthday-party', 180, 120], ['anniversary-dinner', 120, 90], ['celebration-dinner', 120, 90], ['road-trip', 240, 240],
  ['day-trip', 300, 240], ['picnic', 120, 90], ['shopping-trip', 90, 60], ['meditation', 15, 10], ['quiet-time', 45, 30],
];
const tableEntry = (id: string) => CATALOG_TABLE.find(([activityId]) => activityId === id)!;
const defaultOf = (id: string): number | null => tableEntry(id)[1];
const suggestedOf = (id: string): number | null => tableEntry(id)[2];
const expectedMinutesWithNoSource = (id: string): number => defaultOf(id) ?? suggestedOf(id) ?? GENERIC_DURATION_FALLBACK_MINUTES;
const expectedBasisWithNoSource = (id: string): 'RESOLVED' | 'GENERIC_FALLBACK' => (defaultOf(id) !== null ? 'RESOLVED' : 'GENERIC_FALLBACK');

const rangeDeps = (): OpportunityRangeDeps => ({ loadAvailabilityConfiguration: async () => workWeek, loadPlansOverlappingRange: async () => [] });

// test-only observation of the evidence stage (module-object wrapper; production has no hook)
const realPrepareEvidence = preparationModule.prepareDecisionEvidence;
let lastEvidence: DecisionEvidenceByIntentId | undefined;
const capturedEvidence = (): DecisionEvidenceByIntentId | undefined => lastEvidence;
(preparationModule as any).prepareDecisionEvidence = (...args: Parameters<typeof realPrepareEvidence>) => { lastEvidence = realPrepareEvidence(...args); return lastEvidence; };

interface Scenario {
  activityId?: string;
  title?: string;
  durationMinutes?: number;
  preferred?: Record<string, number>;
  behavioral?: Record<string, number>;
  date?: string;
  flexibility?: 'FLEXIBLE' | 'FIXED';
  facts?: DecisionFacts;
  intentId?: string;
}
interface Outcome {
  /** What the ORCHESTRATOR resolved and handed to preparation -- the one authoritative resolution. */
  prepared: PreparationIntentInput;
  evidence: DecisionEvidence | undefined;
  basis: 'RESOLVED' | 'GENERIC_FALLBACK' | undefined;
  minutes: number | undefined;
  pressure: DecisionPressure;
}
async function run(s: Scenario): Promise<Outcome> {
  const date = s.date ?? FRIDAY;
  const intentId = s.intentId ?? 'subject';
  const real = createDecisionFactPreparer(rangeDeps());
  let captured: PreparationIntentInput | undefined;
  const preparer: DecisionFactPreparer = (input) => { captured = input.intents.find((i) => i.intentId === intentId); return real(input); };
  const deps: DayConstructorOrchestratorDeps = {
    loadBlockingPlans: async () => [],
    loadDurationContext: async () => ({ preferredDurationByActivityId: s.preferred ?? {}, behavioralDurationByActivityId: s.behavioral ?? {} }),
    searchTiming: () => ({ candidates: [] }),
    loadAvailabilityConfiguration: async () => UNCONFIGURED,
    prepareDecisionFacts: preparer,
  };
  const requested: RequestedDayIntent = { id: intentId, title: s.title ?? s.activityId ?? 'Finite task', flexibility: s.flexibility ?? 'FLEXIBLE', activityId: s.activityId, durationMinutes: s.durationMinutes, originalOrder: 0 };
  const start = new Date(`${date}T09:00:00Z`);
  const request: ConstructDayRequest = {
    targetDate: date, timezone: 'UTC', constructionWindowSource: 'EXPLICIT_RANGE', now: start,
    explicitStart: start, explicitEnd: new Date(`${date}T17:00:00Z`),
    intents: [requested], decisionFactsByIntentId: new Map([[intentId, s.facts ?? WEEK_FACTS]]),
  };
  lastEvidence = undefined;
  await orchestrateConstructDay(request, deps);
  const evidence = capturedEvidence()?.get(intentId);
  return {
    prepared: captured!,
    evidence,
    basis: evidence?.opportunity?.durationBasis,
    minutes: evidence?.opportunity?.durationMinutes,
    pressure: deriveDecisionPressure({ evidence, planningDate: date, flexibility: s.flexibility ?? 'FLEXIBLE' }),
  };
}

async function runSequentially(scenarios: Scenario[]): Promise<Outcome[]> {
  const out: Outcome[] = [];
  for (const scenario of scenarios) out.push(await run(scenario)); // never concurrent: the evidence capture is one shared slot
  return out;
}

(async () => {
  try {
    // ============================================================
    console.log('=== the catalog: explicit per-activity characterization against the LIVE catalog ===');
    const liveIds = FULL_ACTIVITY_CATALOG.map((a) => a.id);
    const tableIds = CATALOG_TABLE.map(([id]) => id);
    check('CATALOG DRIFT (set): every live catalog activity is classified by name in the table and the table lists nothing the catalog no longer has (a new, removed or renamed activity must be re-classified on purpose)', JSON.stringify([...liveIds].sort()) === JSON.stringify([...tableIds].sort()) && new Set(tableIds).size === tableIds.length);
    const defaultsAgree = CATALOG_TABLE.every(([id, def]) => (getActivityProfileById(id)?.defaultDurationMinutes ?? null) === def);
    const suggestedAgree = CATALOG_TABLE.every(([id, , sug]) => (getActivityDefinition(id)?.experience.suggestedDurations?.[0] ?? null) === sug);
    check('CATALOG DRIFT (durations): each activity\'s live `defaultDurationMinutes` and first `suggestedDurations` entry equal the table (an activity moving between RESOLVED-by-default and fallback is detected here, by name)', defaultsAgree && suggestedAgree);
    check('NO SOURCE DIVERGENCE: the catalog PROFILE default (what classifies the basis) and the activity DEFINITION default (what resolves the minutes) are the same value for every activity, so a minute count and its basis can never come from two different catalog fields', FULL_ACTIVITY_CATALOG.every((a) => getActivityProfileById(a.id)!.defaultDurationMinutes === getActivityDefinition(a.id)?.experience.defaultDurationMinutes));
    const withDefault = CATALOG_TABLE.filter(([, def]) => def !== null);
    const withoutDefault = CATALOG_TABLE.filter(([, def]) => def === null);
    console.log(`[info] live catalog: ${liveIds.length} activities; ${withDefault.length} have a resolving catalog default, ${withoutDefault.length} do not (${withoutDefault.filter(([, , sug]) => sug !== null).length} of those carry only a suggested duration; ${withoutDefault.filter(([, , sug]) => sug === null).length} carry neither)`);
    check('the live counts reported above are derived from the table, which is verified against the live catalog (no unverified magic number)', withDefault.length + withoutDefault.length === liveIds.length);

    // ============================================================
    console.log('=== NO SOURCE: every catalog activity through the REAL orchestrator, with no explicit duration, preference or behavior ===');
    let matrixOk = true;
    const matrixLines: string[] = [];
    const matrixRows: Array<{ id: string; outcome: Outcome }> = [];
    for (const [id] of CATALOG_TABLE) {
      const outcome = await run({ activityId: id });
      matrixRows.push({ id, outcome });
      const wantBasis = expectedBasisWithNoSource(id);
      const wantMinutes = expectedMinutesWithNoSource(id);
      const ok = outcome.prepared?.durationFromGenericFallback === (wantBasis === 'GENERIC_FALLBACK') && outcome.prepared?.durationMinutes === wantMinutes && outcome.basis === wantBasis && outcome.minutes === wantMinutes;
      if (!ok) { matrixOk = false; matrixLines.push(`${id}: got basis=${outcome.basis} minutes=${outcome.minutes} fallbackFlag=${outcome.prepared?.durationFromGenericFallback}, want ${wantBasis}/${wantMinutes}`); }
    }
    if (!matrixOk) console.log(matrixLines.join('\n'));
    check(`DEFAULT/FALLBACK MATRIX: all ${CATALOG_TABLE.length} activities resolve exactly as classified -- the orchestrator's own fallback flag, the resolved minutes and the evidence basis agree for each one`, matrixOk);
    const resolvedByDefault = matrixRows.filter((r) => r.outcome.basis === 'RESOLVED');
    check('DEFAULT-DURATION MATRIX: every activity WITH a catalog default reaches RESOLVED with no explicit duration, at exactly its default minutes', withDefault.length > 0 && withDefault.every(([id, def]) => { const o = matrixRows.find((r) => r.id === id)!.outcome; return o.basis === 'RESOLVED' && o.minutes === def && o.prepared.durationFromGenericFallback === false; }));
    check('FALLBACK MATRIX: every activity WITHOUT a catalog default stays GENERIC_FALLBACK with no explicit duration, preference or behavior', withoutDefault.length > 0 && withoutDefault.every(([id]) => matrixRows.find((r) => r.id === id)!.outcome.basis === 'GENERIC_FALLBACK' && matrixRows.find((r) => r.id === id)!.outcome.prepared.durationFromGenericFallback === true));
    check(`DURATION REACHABILITY IS NOT PRESSURE REACHABILITY (control): on a NON-scarce day (Wednesday, Thursday and Friday still viable) the same ${withDefault.length} RESOLVED activities are all NONE -- a RESOLVED duration is necessary, never sufficient`, (await runSequentially(withDefault.map(([id]) => ({ activityId: id, date: WEDNESDAY })))).every((o) => o.basis === 'RESOLVED' && o.pressure === 'NONE'));
    check('PRESSURE REACHABILITY (catalog default): on the scarce Friday every activity that resolves by catalog default is LAST_KNOWN_OPPORTUNITY, and EVERY fallback activity is NONE with otherwise identical facts', resolvedByDefault.length === withDefault.length && matrixRows.every((r) => r.outcome.pressure === (expectedBasisWithNoSource(r.id) === 'RESOLVED' ? 'LAST_KNOWN_OPPORTUNITY' : 'NONE')));

    // ============================================================
    console.log('=== the four important fallback activities: why default demand does or does not reach RESOLVED ===');
    for (const id of ['workout', 'deep-work', 'learning', 'dating']) {
      const o = matrixRows.find((r) => r.id === id)!.outcome;
      check(`${id.toUpperCase()}: no catalog default -> GENERIC_FALLBACK -> NONE, resolved only by explicit duration, a stored preference or behavior (minutes without them: ${o.minutes})`, defaultOf(id) === null && o.basis === 'GENERIC_FALLBACK' && o.pressure === 'NONE');
    }

    // ============================================================
    console.log('=== SUGGESTED vs DEFAULT: the repository treats them differently for authority, and so does pressure ===');
    for (const id of ['workout', 'deep-work', 'learning']) {
      const o = matrixRows.find((r) => r.id === id)!.outcome;
      check(`${id}: the SUGGESTED duration sets the minutes (${suggestedOf(id)}, not the 45-minute floor) but is NOT authority: the basis stays GENERIC_FALLBACK and pressure NONE -- suggested is never promoted to RESOLVED to raise coverage`, o.minutes === suggestedOf(id) && o.minutes !== GENERIC_DURATION_FALLBACK_MINUTES && o.basis === 'GENERIC_FALLBACK' && o.pressure === 'NONE' && durationMinutesFor(id) === suggestedOf(id));
    }
    const sampleDefault = withDefault.find(([id, def, sug]) => sug !== null && sug !== def)!;
    check('a DEFAULT, by contrast, is authority: an activity carrying both (e.g. one whose suggestion differs from its default) resolves to the DEFAULT minutes, as RESOLVED', matrixRows.find((r) => r.id === sampleDefault[0])!.outcome.minutes === sampleDefault[1] && matrixRows.find((r) => r.id === sampleDefault[0])!.outcome.basis === 'RESOLVED');

    // ============================================================
    console.log('=== UNTYPED demand: activityId == null ===');
    const untyped = await run({ activityId: undefined, title: 'Finite task' });
    check('UNTYPED, no explicit duration, a title that resolves to no catalog activity ("Finite task") -> the 45-minute generic floor, GENERIC_FALLBACK, NONE', untyped.minutes === GENERIC_DURATION_FALLBACK_MINUTES && untyped.basis === 'GENERIC_FALLBACK' && untyped.pressure === 'NONE' && untyped.prepared.durationFromGenericFallback === true);
    const untypedExplicit = await run({ activityId: undefined, title: 'Finite task', durationMinutes: 60 });
    check('UNTYPED with an explicit duration -> RESOLVED and (scarce Friday) LAST_KNOWN_OPPORTUNITY: an explicit duration needs no catalog identity', untypedExplicit.basis === 'RESOLVED' && untypedExplicit.minutes === 60 && untypedExplicit.pressure === 'LAST_KNOWN_OPPORTUNITY');
    const aliasTitle = getActivityProfileById('walk-together')!.aliases[0];
    const aliasResolves = findActivityIntent(aliasTitle)?.id === 'walk-together';
    const untypedAlias = await run({ activityId: undefined, title: aliasTitle });
    check(`UNTYPED whose TITLE exactly matches a catalog alias ("${aliasTitle}") is resolved by the orchestrator's EXISTING title resolution (not new behavior) and so follows that activity's catalog default (${defaultOf('walk-together')} min, RESOLVED)`, aliasResolves && untypedAlias.basis === 'RESOLVED' && untypedAlias.minutes === defaultOf('walk-together') && untypedAlias.pressure === 'LAST_KNOWN_OPPORTUNITY');

    // ============================================================
    console.log('=== EVERY resolution source, individually (each is RESOLVED and each yields pressure under scarcity) ===');
    const explicit = await run({ activityId: 'workout', durationMinutes: 60 });
    check('EXPLICIT duration (a user-chosen 60 minutes on an activity with no catalog default): RESOLVED, 60 minutes, and LAST_KNOWN_OPPORTUNITY on the scarce Friday', explicit.prepared.durationFromGenericFallback === false && explicit.basis === 'RESOLVED' && explicit.minutes === 60 && explicit.pressure === 'LAST_KNOWN_OPPORTUNITY');
    const preference = await run({ activityId: 'deep-work', preferred: { 'deep-work': 90 } });
    check('STORED PREFERENCE (deep-work, no catalog default): RESOLVED at the stored 90 minutes, LAST_KNOWN_OPPORTUNITY', preference.basis === 'RESOLVED' && preference.minutes === 90 && preference.pressure === 'LAST_KNOWN_OPPORTUNITY');
    const behavioral = await run({ activityId: 'learning', behavioral: { learning: 45 } });
    check('BEHAVIORAL typical duration (learning, no catalog default): RESOLVED at the behavioral 45 minutes, LAST_KNOWN_OPPORTUNITY', behavioral.basis === 'RESOLVED' && behavioral.minutes === 45 && behavioral.pressure === 'LAST_KNOWN_OPPORTUNITY');
    const catalog = await run({ activityId: 'meditation' });
    check('CATALOG DEFAULT (meditation): RESOLVED at 15 minutes, LAST_KNOWN_OPPORTUNITY', catalog.basis === 'RESOLVED' && catalog.minutes === 15 && catalog.pressure === 'LAST_KNOWN_OPPORTUNITY');
    const none = await run({ activityId: 'workout' });
    check('NEGATIVE CONTROL: the SAME activity and the SAME scarce Friday facts with NO source (workout) -> GENERIC_FALLBACK, NONE', none.basis === 'GENERIC_FALLBACK' && none.pressure === 'NONE' && JSON.stringify({ ...none.evidence!.opportunity!, durationMinutes: 0, durationBasis: 'x' }) === JSON.stringify({ ...explicit.evidence!.opportunity!, durationMinutes: 0, durationBasis: 'x' }));
    const nonScarce = await run({ activityId: 'workout', durationMinutes: 60, date: WEDNESDAY });
    check('SCARCITY CONTROL: the very same explicit duration on a Wednesday (later viable days) is RESOLVED but NONE', nonScarce.basis === 'RESOLVED' && nonScarce.pressure === 'NONE');

    // ============================================================
    console.log('=== precedence among the RESOLVED sources (the basis stays RESOLVED at every level; the minutes follow the chain) ===');
    const stack = { preferred: { meditation: 20 }, behavioral: { meditation: 25 } };
    const p1 = await run({ activityId: 'meditation', durationMinutes: 30, ...stack });
    const p2 = await run({ activityId: 'meditation', ...stack });
    const p3 = await run({ activityId: 'meditation', behavioral: stack.behavioral });
    const p4 = await run({ activityId: 'meditation' });
    check('explicit (30) > stored preference (20) > behavioral (25) > catalog default (15); every level is RESOLVED', [p1, p2, p3, p4].every((o) => o.basis === 'RESOLVED') && [p1.minutes, p2.minutes, p3.minutes, p4.minutes].join() === '30,20,25,15');
    const fallbackWithBehavior = await run({ activityId: 'workout', behavioral: { workout: 40 } });
    check('a source on a DIFFERENT activity never leaks: a preference and a behavioral duration for other activities leave workout (no catalog default) at GENERIC_FALLBACK', (await run({ activityId: 'workout', preferred: { meditation: 20 }, behavioral: { 'deep-work': 60 } })).basis === 'GENERIC_FALLBACK' && fallbackWithBehavior.basis === 'RESOLVED');

    // ============================================================
    console.log('=== source neutrality of the resolution and of pressure ===');
    const idShapes = ['goal-demand:2026-10-09:ga-1', 'plan-day-goal-ga-1', 'typed-intent-1'];
    const shaped: Outcome[] = [];
    for (const intentId of idShapes) shaped.push(await run({ activityId: 'meditation', intentId })); // sequential: `run` observes ONE shared evidence capture
    check('identical demand under a canonical automatic id, a manual hand-off id and a typed id gives deeply equal evidence and identical pressure (the resolution has no source branch)', shaped.every((o) => JSON.stringify(o.evidence) === JSON.stringify(shaped[0].evidence) && o.pressure === shaped[0].pressure) && shaped[0].pressure === 'LAST_KNOWN_OPPORTUNITY');
    const fixedFlex = await run({ activityId: 'meditation', flexibility: 'FIXED' });
    check('flexibility is the only candidate property pressure reads: the same evidence for a FIXED candidate is NONE', fixedFlex.pressure === 'NONE' && JSON.stringify(fixedFlex.evidence) === JSON.stringify(catalog.evidence));

    // ============================================================
    console.log('=== inertness ===');
    check('the evidence under test is the evidence the preview stage prepared: it is frozen and was produced by the real preparer, and deriving pressure left it unchanged', Object.isFrozen(catalog.evidence) && Object.isFrozen(catalog.evidence!.opportunity) && JSON.stringify(catalog.evidence!.opportunity) === JSON.stringify((await run({ activityId: 'meditation' })).evidence!.opportunity));

    if (!allPassed) { console.error('SOME DECISION PRESSURE CATALOG REACHABILITY CHECKS FAILED'); process.exitCode = 1; return; }
    console.log('ALL DECISION PRESSURE CATALOG REACHABILITY CHECKS PASSED');
  } finally {
    (preparationModule as any).prepareDecisionEvidence = realPrepareEvidence;
  }
})().then(() => process.exit(), (err) => { console.error(err); process.exit(1); });
