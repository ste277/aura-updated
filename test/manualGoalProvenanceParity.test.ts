/**
 * O5 P0a -- manual Goal provenance parity (pure, no DB).
 *
 * The SAME recurrence-eligible GoalActivity, planned through the automatic
 * Goal-demand path or through the manual Goal Detail handoff, must reach
 * preview with ONE canonical identity, and therefore receive the SAME
 * server-derived recurrence and opportunity facts. This file is the
 * permanent source-path-privilege proof: entry path alone can never change
 * the facts an intent receives.
 *
 * Everything below runs the REAL production functions (handoff marking,
 * row factories, request builder, facts provider, preview handler, O4
 * enrichment, acceptance authorization); only the database loaders are
 * injected fakes.
 */
import { markCanonicalGoalDemandHandoff, resolveAutomaticGoalDemand, type GoalActivityHandoffItem, type AutomaticGoalDemandBootstrapDeps } from '../apps/web/lib/planDayBootstrap';
import { createIntentRowFromGoalHandoffItem, createIntentRowFromAutoGoalSuggestion, createIntentRowFromGoalActivity, createInitialIntentRow, buildRequestedIntentsForSubmission, buildGoalActivityLinksForAccept, deriveAvailableAutoGoalSuggestions, type PlanDayIntentRow } from '../apps/web/lib/planDayEntry';
import { encodeGoalDemandIntentId } from '../apps/web/lib/goalDemandIntentId';
import { loadGoalDecisionFacts } from '../apps/web/lib/goalDecisionFactsProvider';
import { authorizeGoalActivityLinks } from '../apps/web/lib/goalDemandProvenanceAuthorization';
import { parseConstructDayPreviewRequestBody, runDayConstructorPreview } from '../apps/web/lib/dayConstructorPreviewRequest';
import { getDatePartsInTimezone } from '../apps/web/lib/timezone';
import type { GoalDemandCandidatesDeps } from '../apps/web/lib/goalDemandCandidates';
import type { CandidateGoalActivityForRhythmDemandRow, User } from '../apps/web/lib/db';
import type { GoalActivityRhythmOccurrenceFact } from '../apps/web/lib/goalActivityRhythm';
import type { DayConstructorOrchestratorDeps, ConstructDayRequest } from '../apps/web/lib/dayConstructorOrchestrator';
import type { OpportunityRangeDeps } from '../apps/web/lib/opportunityRangeAdapter';
import type { AvailabilityConfiguration } from '../apps/web/lib/availabilityContext';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}
const iso = (s: string) => new Date(s);

// ---------- fakes for the database loaders only ----------
interface FakeActivity {
  id: string;
  title: string;
  activityId: string | null;
  rhythmKind: string | null;
  target: number | null;
  occurrences?: GoalActivityRhythmOccurrenceFact[];
}
function candidateDeps(activitiesByUser: Record<string, FakeActivity[]>) {
  const calls = { discovery: 0, facts: 0 };
  const deps: GoalDemandCandidatesDeps = {
    loadCandidateGoalActivities: async (userId) => {
      calls.discovery += 1;
      return (activitiesByUser[userId] ?? [])
        .filter((a) => a.rhythmKind === 'N_PER_WEEK')
        .map((a) => ({ goalActivityId: a.id, goalId: 'g', goalTitle: 'g', title: a.title, activityId: a.activityId, rhythmKind: a.rhythmKind, rhythmTargetPerWeek: a.target }) as CandidateGoalActivityForRhythmDemandRow);
    },
    loadRhythmFacts: async (userId) => {
      calls.facts += 1;
      return new Map((activitiesByUser[userId] ?? []).map((a) => [a.id, a.occurrences ?? []]));
    },
  };
  return { deps, calls };
}
const workWeek: AvailabilityConfiguration = { configured: true, periods: ([1, 2, 3, 4, 5] as const).map((weekday) => ({ weekday, startTime: '09:00', endTime: '17:00' })) };
const rangeDeps = (configuration: AvailabilityConfiguration): OpportunityRangeDeps => ({ loadAvailabilityConfiguration: async () => configuration, loadPlansOverlappingRange: async () => [] });
const orchestratorDeps: DayConstructorOrchestratorDeps = {
  loadBlockingPlans: async () => [],
  loadDurationContext: async () => ({ preferredDurationByActivityId: {}, behavioralDurationByActivityId: {} }),
  searchTiming: () => ({ candidates: [] }),
  loadAvailabilityConfiguration: async () => ({ configured: false, periods: [] }),
};
const userOf = (id: string, timezone: string) => ({ id, timezone }) as User;

const A: FakeActivity = { id: 'ga-recurring', title: 'Cardio', activityId: 'workout', rhythmKind: 'N_PER_WEEK', target: 3 };
const FINITE: FakeActivity = { id: 'ga-finite', title: 'One-off task', activityId: null, rhythmKind: null, target: null };
const EXHAUSTED: FakeActivity = { id: 'ga-exhausted', title: 'Done this week', activityId: 'workout', rhythmKind: 'N_PER_WEEK', target: 1, occurrences: [{ localDate: '2026-10-06', contribution: 'COMPLETED' }] };

/** The two entry paths for ONE activity: what the client puts in `rows`. */
function automaticRow(activity: FakeActivity, planningDate: string): PlanDayIntentRow {
  return createIntentRowFromAutoGoalSuggestion({ title: activity.title, activityId: activity.activityId, goalActivityId: activity.id }, encodeGoalDemandIntentId(planningDate, activity.id));
}
function manualRow(activity: FakeActivity, planningDate: string, canonical: boolean): PlanDayIntentRow {
  const item: GoalActivityHandoffItem = canonical ? { id: activity.id, title: activity.title, activityId: activity.activityId, canonicalDemand: true } : { id: activity.id, title: activity.title, activityId: activity.activityId };
  return createIntentRowFromGoalHandoffItem(item, encodeGoalDemandIntentId(planningDate, activity.id));
}

(async () => {
  // ============================================================
  // Server-side marking (the ONLY place canonicalDemand is decided)
  // ============================================================
  {
    const items: GoalActivityHandoffItem[] = [
      { id: 'ga-recurring', title: 'Cardio', activityId: 'workout' },
      { id: 'ga-finite', title: 'Cardio', activityId: 'workout' }, // same title/activityId as the recurring one, different id
    ];
    const marked = markCanonicalGoalDemandHandoff(items, ['ga-recurring']);
    check('marking is by EXACT id only: the recurring item is marked, a finite item with an identical title/activity is NOT (no title or label matching)', marked[0].canonicalDemand === true && marked[1].canonicalDemand === undefined);
    check('marking with no canonical ids (e.g. a failed load) leaves every item as the legacy manual item', markCanonicalGoalDemandHandoff(items, []).every((i) => i.canonicalDemand === undefined));
    check('marking never mutates its input and adds no other field', items.every((i) => i.canonicalDemand === undefined) && JSON.stringify(Object.keys(marked[0]).sort()) === JSON.stringify(['activityId', 'canonicalDemand', 'id', 'title']));
  }
  {
    const { deps, calls } = candidateDeps({ u1: [A, FINITE, EXHAUSTED], u2: [] });
    const auto: AutomaticGoalDemandBootstrapDeps = { getSessionToken: () => 'tok', verifySession: () => ({ userId: 'u1' }), ...deps };
    const result = await resolveAutomaticGoalDemand(auto, '2026-10-07', 'UTC', ['ga-recurring', 'ga-finite', 'ga-exhausted', 'ga-not-mine']);
    check('resolveAutomaticGoalDemand reports which MANUAL ids the SAME single load recognizes as canonical demand (recurring yes; finite, exhausted and unknown no)', result.status === 'OK' && JSON.stringify(result.manualCanonicalGoalActivityIds) === JSON.stringify(['ga-recurring']));
    check('...with the manual id excluded from the automatic suggestions exactly as before, and ONE discovery + ONE facts load (no extra query for the marking)', result.status === 'OK' && result.suggestions.length === 0 && calls.discovery === 1 && calls.facts === 1);
    const noSession = await resolveAutomaticGoalDemand({ ...auto, getSessionToken: () => undefined }, '2026-10-07', 'UTC', ['ga-recurring']);
    check('unauthenticated / missing context: nothing is marked and nothing is loaded', noSession.status === 'OK' && noSession.manualCanonicalGoalActivityIds.length === 0);
    const failing = await resolveAutomaticGoalDemand({ ...auto, loadCandidateGoalActivities: async () => { throw new Error('down'); } }, '2026-10-07', 'UTC', ['ga-recurring']);
    check('a failed load stays LOAD_FAILED (the page then marks nothing: legacy manual rows)', failing.status === 'LOAD_FAILED');
  }

  // ============================================================
  // The two entry paths produce ONE canonical identity
  // ============================================================
  const PLANNING = '2026-10-07';
  {
    const auto = automaticRow(A, PLANNING);
    const manual = manualRow(A, PLANNING, true);
    check('same user + activity + planning date: the canonical manual row is field-for-field the SAME row an automatic inclusion creates', JSON.stringify(manual) === JSON.stringify(auto));
    check('...with the canonical id from the ONE encoder (goal-demand:<date>:<activityId>)', manual.id === `goal-demand:${PLANNING}:${A.id}` && manual.id === encodeGoalDemandIntentId(PLANNING, A.id));
    check('...carrying provenance only as the client row field the accept-link builder already reads (goalActivityId), never in the preview request', manual.goalActivityId === A.id && JSON.stringify(buildRequestedIntentsForSubmission([manual], 'UTC', PLANNING)) === JSON.stringify(buildRequestedIntentsForSubmission([auto], 'UTC', PLANNING)) && !/goalActivityId|goalId/.test(JSON.stringify(buildRequestedIntentsForSubmission([manual], 'UTC', PLANNING))));
    const legacy = manualRow(A, PLANNING, false);
    check('an UNMARKED handoff item keeps the unmodified legacy manual row (plan-day-goal-<id>)', legacy.id === `plan-day-goal-${A.id}` && JSON.stringify(legacy) === JSON.stringify(createIntentRowFromGoalActivity({ id: A.id, title: A.title, activityId: A.activityId })));
    check('a MARKED item with no canonical id available (no planning date) falls back to the legacy row, never a guessed id', createIntentRowFromGoalHandoffItem({ id: A.id, title: A.title, activityId: A.activityId, canonicalDemand: true }, null).id === `plan-day-goal-${A.id}`);
    const freeform = createInitialIntentRow();
    check('a normal freeform row never gains Goal provenance', freeform.goalActivityId === undefined && !freeform.id.startsWith('goal-demand:'));
    check('the accept-time link for a canonical manual row equals the automatic one (same builder, same row shape)', JSON.stringify(buildGoalActivityLinksForAccept([manual], [{ intentId: manual.id }])) === JSON.stringify(buildGoalActivityLinksForAccept([auto], [{ intentId: auto.id }])));
    check('an activity with a canonical manual row is not offered again as an automatic suggestion (dedup by activity id, as before)', deriveAvailableAutoGoalSuggestions([{ goalActivityId: A.id } as any], [manual]).length === 0);
  }

  // ============================================================
  // SOURCE-PATH PRIVILEGE: identical facts regardless of entry path
  // ============================================================
  const factsFor = async (timezone: string, now: Date, rows: PlanDayIntentRow[], activities: FakeActivity[], userId = 'u1') => {
    const planningDate = getDatePartsInTimezone(timezone, now).dateStr;
    const { deps } = candidateDeps({ [userId]: activities });
    const parsed = parseConstructDayPreviewRequestBody({ intents: buildRequestedIntentsForSubmission(rows, timezone, planningDate) }, { timezone, now });
    if (!parsed.ok) throw new Error(parsed.error);
    const map = await loadGoalDecisionFacts(userOf(userId, timezone), parsed.request, deps);
    return { planningDate, request: parsed.request, facts: map };
  };
  const scenarios: Array<[string, string, Date]> = [
    ['UTC Wednesday', 'UTC', iso('2026-10-07T09:00:00Z')],
    ['Sunday (last day of the period)', 'UTC', iso('2026-10-11T09:00:00Z')],
    ['next Monday (new period)', 'UTC', iso('2026-10-12T09:00:00Z')],
    ['Asia/Kolkata: UTC Sunday is already local Monday', 'Asia/Kolkata', iso('2026-10-11T20:00:00Z')],
    ['America/Los_Angeles: UTC Monday is still local Sunday', 'America/Los_Angeles', iso('2026-10-12T03:00:00Z')],
  ];
  for (const [label, tz, now] of scenarios) {
    const planningDate = getDatePartsInTimezone(tz, now).dateStr;
    const viaAuto = await factsFor(tz, now, [automaticRow(A, planningDate)], [A]);
    const viaManual = await factsFor(tz, now, [manualRow(A, planningDate, true)], [A]);
    const idA = encodeGoalDemandIntentId(planningDate, A.id);
    const fa = viaAuto.facts.get(idA);
    const fm = viaManual.facts.get(idA);
    check(`${label}: automatic and manual entry produce IDENTICAL recurrence facts (${fa?.recurrence?.periodStartDate}..${fa?.recurrence?.periodEndDate})`, !!fa?.recurrence && JSON.stringify(fa) === JSON.stringify(fm));
    check(`${label}: the planning date is the user's LOCAL date (${planningDate}) and lies inside the emitted period`, !!fa?.recurrence && fa.recurrence.periodStartDate <= planningDate && planningDate <= fa.recurrence.periodEndDate);
  }

  // Through the real preview handler + O4 enrichment: opportunity facts parity.
  {
    const NOW = iso('2026-10-07T09:00:00Z');
    const bodyFor = (rows: PlanDayIntentRow[]) => ({ constructionWindowSource: 'EXPLICIT_RANGE', explicitStart: '2026-10-07T09:00:00Z', explicitEnd: '2026-10-07T17:00:00Z', intents: buildRequestedIntentsForSubmission(rows, 'UTC', PLANNING) });
    const run = async (rows: PlanDayIntentRow[]) => {
      const { deps } = candidateDeps({ u1: [A] });
      const result = await runDayConstructorPreview(bodyFor(rows), 'UTC', NOW, orchestratorDeps, (request: ConstructDayRequest) => loadGoalDecisionFacts(userOf('u1', 'UTC'), request, deps), rangeDeps(workWeek));
      return JSON.parse(JSON.stringify(result.body));
    };
    const viaAuto = await run([automaticRow(A, PLANNING)]);
    const viaManual = await run([manualRow(A, PLANNING, true)]);
    const dayIntent = (b: any) => b.preview.resolvedIntents[0].dayIntent;
    check('through the real preview boundary: automatic and manual intents carry IDENTICAL decisionFacts (recurrence AND opportunity)', !!dayIntent(viaAuto).decisionFacts?.opportunity && JSON.stringify(dayIntent(viaAuto).decisionFacts) === JSON.stringify(dayIntent(viaManual).decisionFacts));
    check('...identical duration basis, horizon and coverage', dayIntent(viaAuto).decisionFacts.opportunity.durationBasis === dayIntent(viaManual).decisionFacts.opportunity.durationBasis && dayIntent(viaAuto).decisionFacts.opportunity.horizonEndDate === dayIntent(viaManual).decisionFacts.opportunity.horizonEndDate && dayIntent(viaAuto).decisionFacts.opportunity.coverage === dayIntent(viaManual).decisionFacts.opportunity.coverage);
    check('...and an identical constructed day (the facts remain inert; entry path changes nothing)', JSON.stringify(viaAuto.preview.constructedDay) === JSON.stringify(viaManual.preview.constructedDay) && JSON.stringify(viaAuto.preview.resolvedIntents) === JSON.stringify(viaManual.preview.resolvedIntents));
    const legacyRun = await run([manualRow(A, PLANNING, false)]);
    check('the LEGACY manual id (stale tab, old state) stays fact-free and is never promoted by title or activity matching', legacyRun.preview.resolvedIntents[0].dayIntent.decisionFacts === undefined);
  }

  // ============================================================
  // Eligibility is reused, never broadened
  // ============================================================
  {
    const { facts } = await factsFor('UTC', iso('2026-10-07T09:00:00Z'), [manualRow(EXHAUSTED, PLANNING, true), manualRow(FINITE, PLANNING, true)], [A, FINITE, EXHAUSTED]);
    check('an exhausted recurring activity gets no facts even with a canonical id (zero-remaining exclusion intact)', !facts.has(encodeGoalDemandIntentId(PLANNING, EXHAUSTED.id)));
    check('a non-recurrent activity gets no recurrence facts even if (wrongly) given a canonical id -- the provider only honors server-eligible ids', !facts.has(encodeGoalDemandIntentId(PLANNING, FINITE.id)));
  }
  {
    const request = (ids: string[]): ConstructDayRequest => ({ targetDate: PLANNING, timezone: 'UTC', constructionWindowSource: 'EXPLICIT_RANGE', now: iso('2026-10-07T09:00:00Z'), intents: ids.map((id, i) => ({ id, title: 'x', flexibility: 'FLEXIBLE', originalOrder: i })) });
    const dataFor = { u1: [A], u2: [{ ...A, id: 'ga-of-u2' }] };
    const asB = await loadGoalDecisionFacts(userOf('u2', 'UTC'), request([encodeGoalDemandIntentId(PLANNING, A.id)]), candidateDeps(dataFor).deps);
    check('cross-user: user B supplying user A\'s canonical id gets NO facts (matching is against B\'s own eligible demand)', asB.size === 0);
    const asA = await loadGoalDecisionFacts(userOf('u1', 'UTC'), request([encodeGoalDemandIntentId('2026-10-08', A.id), encodeGoalDemandIntentId(PLANNING, 'ga-does-not-exist'), 'goal-demand:not-a-date:ga-recurring', 'goal-demand:2026-10-07', 'goal-demand:2026-10-07:ga-recurring:extra']), candidateDeps(dataFor).deps);
    check('forged canonical ids -- wrong planning date, nonexistent activity, malformed, missing id, extra component -- all yield NO facts', asA.size === 0);
  }

  // ============================================================
  // Authority: titles are presentation only; provenance comes from the signed id
  // ============================================================
  {
    const { facts: f1 } = await factsFor('UTC', iso('2026-10-07T09:00:00Z'), [{ ...manualRow(A, PLANNING, true), title: 'Cardio' }], [A]);
    const { facts: f2 } = await factsFor('UTC', iso('2026-10-07T09:00:00Z'), [{ ...manualRow(A, PLANNING, true), title: 'Totally different title' }], [A]);
    check('a legitimate canonical id with an altered title yields the same facts (the id, not the title, is the identity)', JSON.stringify([...f1.entries()]) === JSON.stringify([...f2.entries()]) && f1.size === 1);
    const id = encodeGoalDemandIntentId(PLANNING, A.id);
    const mismatch = authorizeGoalActivityLinks([{ intentId: id }], PLANNING, new Map([[id, 'ga-some-other-activity']]));
    check('acceptance authorization: a client link that DIFFERS from the signed canonical id is rejected (a forged title/link cannot redirect provenance)', mismatch.status === 'REJECTED');
    const ok = authorizeGoalActivityLinks([{ intentId: id }], PLANNING, new Map([[id, A.id]]));
    const omitted = authorizeGoalActivityLinks([{ intentId: id }], PLANNING, new Map());
    check('acceptance authorization: a matching link, or none at all, is authorized from the verified id (manual canonical rows are now MORE tightly bound than legacy ones)', ok.status === 'OK' && omitted.status === 'OK' && omitted.goalActivityLinks.get(id) === A.id);
    const wrongDate = authorizeGoalActivityLinks([{ intentId: id }], '2026-10-08', new Map());
    check('acceptance authorization: a canonical id for another planning date is rejected', wrongDate.status === 'REJECTED');
    const legacyId = `plan-day-goal-${A.id}`;
    const legacy = authorizeGoalActivityLinks([{ intentId: legacyId }], PLANNING, new Map([[legacyId, A.id]]));
    check('acceptance authorization: the legacy manual id behaves exactly as before (client link passes through; still validated transactionally at persistence)', legacy.status === 'OK' && legacy.goalActivityLinks.get(legacyId) === A.id);
  }

  // ============================================================
  // Same-request duplicates and identity per planning date
  // ============================================================
  {
    const row = manualRow(A, PLANNING, true);
    const dup = parseConstructDayPreviewRequestBody({ intents: buildRequestedIntentsForSubmission([row, { ...row }], 'UTC', PLANNING) }, { timezone: 'UTC', now: iso('2026-10-07T09:00:00Z') });
    check('the same canonical identity entered twice in one request is rejected by the existing duplicate-id rule (no duplicate candidate)', !dup.ok && /duplicates an earlier intent id/.test(dup.error));
    check('canonical identity includes the planning date: the same activity on different dates is a different intent (dates are never collapsed)', manualRow(A, '2026-10-07', true).id !== manualRow(A, '2026-10-08', true).id);
  }

  // ============================================================
  // Query parity: no extra or candidate-linear Goal lookups
  // ============================================================
  {
    const mk = async (rows: PlanDayIntentRow[]) => {
      const { deps, calls } = candidateDeps({ u1: [A, { ...A, id: 'ga-2' }, { ...A, id: 'ga-3' }] });
      const planningDate = '2026-10-07';
      const parsed = parseConstructDayPreviewRequestBody({ intents: buildRequestedIntentsForSubmission(rows, 'UTC', planningDate) }, { timezone: 'UTC', now: iso('2026-10-07T09:00:00Z') });
      if (!parsed.ok) throw new Error(parsed.error);
      await loadGoalDecisionFacts(userOf('u1', 'UTC'), parsed.request, deps);
      return calls;
    };
    const ids = [A.id, 'ga-2', 'ga-3'];
    const autoCalls = await mk(ids.map((id) => automaticRow({ ...A, id }, PLANNING)));
    const manualCalls = await mk(ids.map((id) => manualRow({ ...A, id }, PLANNING, true)));
    check('preview-time Goal queries are identical for 3 automatic and 3 manual intents (1 discovery + 1 facts load, never per intent)', JSON.stringify(autoCalls) === JSON.stringify(manualCalls) && manualCalls.discovery === 1 && manualCalls.facts === 1);
  }

  if (!allPassed) {
    console.error('SOME MANUAL GOAL PROVENANCE PARITY CHECKS FAILED');
    process.exit(1);
  }
  console.log('ALL MANUAL GOAL PROVENANCE PARITY CHECKS PASSED');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
