/**
 * Constructor Decision Intelligence -- O5 P2d: the DECISION SCHEDULING CONTEXT (pure behavior, no database).
 *
 * The loader runs against a FAKE snapshot runner and executor (canned rows by statement) and the preview boundary against
 * fake orchestrator dependencies, so everything that does not need real PostgreSQL semantics is proven without a database:
 * detached, deep-frozen, independently owned context data; fresh-object derivations; the opportunity range adapter and the
 * Rhythm / duration assemblies fed from the context giving exactly what the live inputs give; ONE snapshot and a constant
 * statement count whatever the number of candidates; no work after the snapshot ends; no partial context on failure; and
 * the preview boundary's rule that a failed context means NO decision evidence -- never the independent live reads.
 * (The real REPEATABLE READ behavior and the concurrent-commit reproduction are decisionSchedulingSnapshotDb.test.ts.)
 */
import { createDecisionSchedulingContext, schedulingContextDurationContext, schedulingContextOpportunityRangeDeps, type DecisionSchedulingContext, type DecisionSchedulingContextParts } from '../apps/web/lib/decisionSchedulingContext';
import { loadDecisionSchedulingContext, type SnapshotRunner } from '../apps/web/lib/decisionSchedulingContextLoader';
import { createGoalDemandDepsFromSchedulingContext } from '../apps/web/lib/goalDecisionFactsProvider';
import { loadEligibleGoalDemand, type GoalDemandCandidatesDeps } from '../apps/web/lib/goalDemandCandidates';
import { buildGoalActivityRhythmFactsFromOccurrenceRows, type ReadQueryExecutor, type CandidateGoalActivityForRhythmDemandRow } from '../apps/web/lib/db';
import { preferredDurationByActivityId, userActivityPreferencesFromRows } from '../apps/web/lib/activityPreferences';
import { deriveBehavioralProfile, activityDurationByActivityId } from '../apps/web/lib/behavioralAffinity';
import { runDayConstructorPreview, type DecisionSchedulingBinding } from '../apps/web/lib/dayConstructorPreviewRequest';
import type { DayConstructorOrchestratorDeps } from '../apps/web/lib/dayConstructorOrchestrator';
import * as preparationModule from '../apps/web/lib/decisionFactPreparation';
import type { DecisionEvidenceByIntentId } from '../apps/web/lib/decisionEvidence';
import type { DecisionFacts } from '../apps/web/lib/decisionFacts';
import type { TimingCandidate } from '../packages/recommendation/src/timingSearch';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}
const throwsTypeError = (fn: () => void) => { try { fn(); return false; } catch (e) { return e instanceof TypeError; } };
const rejects = async (p: Promise<unknown>) => { try { await p; return false; } catch { return true; } };
const reachable = (v: unknown, seen = new Set<unknown>()): unknown[] => (v === null || typeof v !== 'object' || seen.has(v) ? [] : (seen.add(v), [v, ...Object.values(v as Record<string, unknown>).flatMap((c) => reachable(c, seen))]));

const FRIDAY = '2026-10-09';
const row = (id: string, over: Partial<CandidateGoalActivityForRhythmDemandRow> = {}): CandidateGoalActivityForRhythmDemandRow => ({ goalActivityId: id, goalId: 'g1', goalTitle: 'G', title: id, activityId: 'meditation', rhythmKind: 'N_PER_WEEK', rhythmTargetPerWeek: 3, ...over });
const workWeekPeriods = [1, 2, 3, 4, 5].map((weekday) => ({ weekday, startTime: '09:00', endTime: '17:00' }));
const parts = (over: Partial<DecisionSchedulingContextParts> = {}): DecisionSchedulingContextParts => ({
  recurrence: { candidateRows: [row('ga-1'), row('ga-2', { activityId: 'quiet-time' })], occurrenceRows: [{ goalActivityId: 'ga-1', plannedStartAt: new Date('2026-10-06T05:00:00Z'), status: 'LOGGED', scheduledWeekStart: null, scheduledWeekTimezone: null }, { goalActivityId: 'ga-2', plannedStartAt: '2026-10-07T05:00:00.000Z', status: 'UPCOMING', scheduledWeekStart: null, scheduledWeekTimezone: null }] },
  durationSources: { preferenceRows: [{ activityId: 'meditation', preferredDurationMinutes: 25 }, { activityId: 'retired-activity', preferredDurationMinutes: 99 }], habitLogs: [{ activityId: 'quiet-time', logTimestamp: new Date('2026-10-02T05:00:00Z'), durationMinutes: 40 }, { activityId: 'quiet-time', logTimestamp: new Date('2026-10-03T05:00:00Z'), durationMinutes: 45 }, { activityId: 'quiet-time', logTimestamp: new Date('2026-10-04T05:00:00Z'), durationMinutes: 50 }] },
  opportunity: { configured: true, periods: workWeekPeriods, planRangeFrom: new Date('2026-10-09T00:00:00Z'), planRangeTo: new Date('2026-10-12T00:00:00Z'), plans: [{ plannedStartAt: new Date('2026-10-08T22:00:00Z'), plannedEndAt: new Date('2026-10-09T01:00:00Z'), status: 'UPCOMING' }, { plannedStartAt: new Date('2026-10-09T12:00:00Z'), plannedEndAt: new Date('2026-10-09T13:00:00Z'), status: 'UPCOMING' }, { plannedStartAt: new Date('2026-10-11T23:00:00Z'), plannedEndAt: new Date('2026-10-12T02:00:00Z'), status: 'LOGGED' }] },
  ...over,
});

// ---- a fake snapshot (runner + executor) that answers by statement and records exactly what happens inside and after it ----
function fakeSnapshot(canned: { candidates: object[]; occurrences?: object[]; preferences?: object[]; habitLogs?: object[]; configured?: boolean; periods?: object[]; plans?: object[] }, opts: { failAt?: number } = {}) {
  const state = { runs: 0, statements: [] as string[], open: false, usedWhileClosed: 0, ended: false };
  const executor: ReadQueryExecutor = {
    query: async (text) => {
      if (!state.open) state.usedWhileClosed += 1;
      state.statements.push(text.replace(/\s+/g, ' ').trim().slice(0, 400));
      if (opts.failAt && state.statements.length === opts.failAt) throw new Error('simulated failure');
      const rows = /FROM "GoalActivityOccurrence"/.test(text) ? canned.occurrences ?? [] : /FROM "GoalActivity" ga/.test(text) ? canned.candidates : /FROM "UserActivityPreference"/.test(text) ? canned.preferences ?? [] : /FROM "HabitLog"/.test(text) ? canned.habitLogs ?? [] : /"availabilityConfigured"/.test(text) ? [{ availabilityConfigured: canned.configured ?? true }] : /FROM "UserAvailabilityPeriod"/.test(text) ? canned.periods ?? [] : /FROM "PlannedActivity"/.test(text) ? canned.plans ?? [] : [];
      return { rows: rows as any[] };
    },
  };
  const runner: SnapshotRunner = async (read) => { state.runs += 1; state.open = true; try { return await read(executor); } finally { state.open = false; state.ended = true; } };
  return { runner, state };
}

(async () => {
  console.log('=== strict-mode precondition ===');
  check('this file runs in strict mode: a write to a frozen object THROWS', throwsTypeError(() => { (Object.freeze({ a: 1 }) as { a: number }).a = 2; }));

  // ============================================================
  console.log('=== the context is detached, deep-frozen and independently owned ===');
  {
    const input = parts();
    const ctx = createDecisionSchedulingContext(input);
    const snapshot = JSON.stringify(ctx);
    check('the context has exactly the three authority groups and nothing derived: recurrence, durationSources, opportunity (no pressure, evidence, classification, promotion or contention)', JSON.stringify(Object.keys(ctx)) === JSON.stringify(['recurrence', 'durationSources', 'opportunity']) && !/ressure|vidence|hadow|ontention|romot/.test(snapshot));
    check('DEEP FREEZE: the context and every nested object and array are frozen; a write at any depth throws', reachable(ctx).every((o) => Object.isFrozen(o)) && throwsTypeError(() => { (ctx as any).opportunity = undefined; }) && throwsTypeError(() => { (ctx.recurrence.candidateRows[0] as any).title = 'x'; }) && throwsTypeError(() => { (ctx.opportunity!.plans as any).push({}); }) && throwsTypeError(() => { (ctx.durationSources.habitLogs[0] as any).durationMinutes = 1; }));
    check('DATE OWNERSHIP: no Date (and no object shared with the input rows) is reachable from the context -- instants are ISO strings, every row is a copy', reachable(ctx).every((o) => !(o instanceof Date)) && reachable(ctx).every((o) => !reachable(input).includes(o)) && ctx.recurrence.occurrenceRows[0].plannedStartAt === '2026-10-06T05:00:00.000Z' && ctx.opportunity!.planRangeFrom === '2026-10-09T00:00:00.000Z');
    input.recurrence.candidateRows[0].title = 'MUTATED'; (input.recurrence.occurrenceRows as any)[0].status = 'MUTATED'; (input.opportunity!.plans as any)[0].status = 'MUTATED'; input.opportunity!.planRangeFrom.setTime(0); (input.durationSources.habitLogs as any)[0].durationMinutes = 1;
    check('INDEPENDENT OF THE SOURCE ROWS: mutating the rows / Dates the loader read after the context was created changes nothing in it', JSON.stringify(ctx) === snapshot);
    check('a missing activity identity is normalised to null, never undefined', createDecisionSchedulingContext(parts({ durationSources: { preferenceRows: [], habitLogs: [{ logTimestamp: '2026-10-02T05:00:00Z', durationMinutes: 30 }] } })).durationSources.habitLogs[0].activityId === null);
  }

  // ============================================================
  console.log('=== derivations: fresh objects, the same meaning as the live inputs, no live read ever ===');
  {
    const ctx = createDecisionSchedulingContext(parts());
    const deps = schedulingContextOpportunityRangeDeps(ctx);
    const a = await deps.loadPlansOverlappingRange({ from: new Date('2026-10-09T00:00:00Z'), to: new Date('2026-10-12T00:00:00Z') });
    const b = await deps.loadPlansOverlappingRange({ from: new Date('2026-10-09T00:00:00Z'), to: new Date('2026-10-12T00:00:00Z') });
    check('OPPORTUNITY PLANS: every plan overlapping the requested [from, to) comes back (the 22:00Z plan that ends 01:00Z on the 9th overlaps the range start; the one that starts at 23:00Z on the 11th overlaps its end), as fresh Date-bearing objects on every call', a.length === 3 && a.map((p) => p.status).join() === 'UPCOMING,UPCOMING,LOGGED' && a[0] !== b[0] && a[0].start !== b[0].start && a[0].start instanceof Date);
    check('HALF-OPEN [from, to): a plan that ends exactly at the range start (the first plan ends 01:00Z) and one that starts exactly at its end (the second starts 12:00Z) are excluded', (await deps.loadPlansOverlappingRange({ from: new Date('2026-10-09T01:00:00Z'), to: new Date('2026-10-09T12:00:00Z') })).length === 0);
    check('a plan range the snapshot did not cover FAILS (never a live read, never a guess): a request starting before or ending after the snapshot range rejects', await rejects(deps.loadPlansOverlappingRange({ from: new Date('2026-10-08T00:00:00Z'), to: new Date('2026-10-12T00:00:00Z') })) && await rejects(deps.loadPlansOverlappingRange({ from: new Date('2026-10-09T00:00:00Z'), to: new Date('2026-10-13T00:00:00Z') })));
    const avail = await deps.loadAvailabilityConfiguration();
    check('AVAILABILITY: the configured flag and the five weekday periods come back as fresh objects equal to what was read', avail.configured === true && avail.periods.length === 5 && avail.periods[0] !== (await deps.loadAvailabilityConfiguration()).periods[0]);
    const none = schedulingContextOpportunityRangeDeps(createDecisionSchedulingContext(parts({ opportunity: undefined })));
    check('a context that read no availability / plans (no recurrence candidate) answers neither: both reject', await rejects(none.loadAvailabilityConfiguration()) && await rejects(none.loadPlansOverlappingRange({ from: new Date(0), to: new Date(1) })));

    const now = new Date('2026-10-09T03:30:00Z');
    const fromContext = schedulingContextDurationContext(ctx, 'Asia/Kolkata', now);
    const independent = { preferredDurationByActivityId: preferredDurationByActivityId(userActivityPreferencesFromRows(parts().durationSources.preferenceRows)), behavioralDurationByActivityId: activityDurationByActivityId(deriveBehavioralProfile(parts().durationSources.habitLogs.map((l) => ({ activityId: l.activityId ?? null, logTimestamp: new Date(l.logTimestamp), durationMinutes: l.durationMinutes })), 'Asia/Kolkata', now)) };
    check('DURATION CONTEXT: derived from the snapshot rows it equals an independent assembly of the stored preferences (a retired activity id is omitted) and the behavioral typical duration (three consistent logs -> median 45)', JSON.stringify(fromContext) === JSON.stringify(independent) && fromContext.preferredDurationByActivityId.meditation === 25 && !('retired-activity' in fromContext.preferredDurationByActivityId) && fromContext.behavioralDurationByActivityId['quiet-time'] === 45);

    const goalDeps = createGoalDemandDepsFromSchedulingContext(ctx);
    const c1 = await goalDeps.loadCandidateGoalActivities('anyone'); const c2 = await goalDeps.loadCandidateGoalActivities('anyone');
    check('RECURRENCE CANDIDATES: fresh copies on every call, in the order read', c1.map((r) => r.goalActivityId).join() === 'ga-1,ga-2' && c1[0] !== c2[0]);
    const facts = await goalDeps.loadRhythmFacts('anyone', ['ga-1'], 'Asia/Kolkata');
    check('RHYTHM OCCURRENCE FACTS: only the requested activities, shaped by the one shared pure mapping (local date in the user\'s timezone, LOGGED completed)', JSON.stringify([...facts]) === JSON.stringify([...buildGoalActivityRhythmFactsFromOccurrenceRows([{ goalActivityId: 'ga-1', plannedStartAt: '2026-10-06T05:00:00.000Z', status: 'LOGGED', scheduledWeekStart: null, scheduledWeekTimezone: null }], 'Asia/Kolkata')]) && !facts.has('ga-2'));
    const liveFake: GoalDemandCandidatesDeps = { loadCandidateGoalActivities: async () => parts().recurrence.candidateRows, loadRhythmFacts: async (_u, ids, tz) => buildGoalActivityRhythmFactsFromOccurrenceRows(parts().recurrence.occurrenceRows.filter((r) => ids.includes(r.goalActivityId)), tz) };
    check('SAME DEMAND AS THE LIVE INPUTS: `loadEligibleGoalDemand` over the context-backed deps equals the result over deps serving the very same rows (the eligibility and counting code is untouched; only the row source differs)', JSON.stringify(await loadEligibleGoalDemand(goalDeps, 'u', FRIDAY, 'Asia/Kolkata')) === JSON.stringify(await loadEligibleGoalDemand(liveFake, 'u', FRIDAY, 'Asia/Kolkata')));
  }

  // ============================================================
  console.log('=== the loader: ONE snapshot, a fixed statement set, constant in the candidate count, nothing after it ends ===');
  {
    const base = { occurrences: [{ goalActivityId: 'ga-1', plannedStartAt: new Date('2026-10-06T05:00:00Z'), status: 'LOGGED' }], preferences: [{ activityId: 'meditation', preferredDurationMinutes: 25 }], habitLogs: [], periods: workWeekPeriods, plans: [{ plannedStartAt: new Date('2026-10-09T05:00:00Z'), plannedEndAt: new Date('2026-10-09T06:00:00Z'), status: 'UPCOMING' }] };
    const two = fakeSnapshot({ ...base, candidates: [row('ga-1'), row('ga-2')] });
    const ctx2 = await loadDecisionSchedulingContext({ userId: 'u', planningDate: FRIDAY, timezone: 'Asia/Kolkata' }, two.runner);
    const nine = fakeSnapshot({ ...base, candidates: Array.from({ length: 9 }, (_, i) => row(`ga-${i}`)) });
    await loadDecisionSchedulingContext({ userId: 'u', planningDate: FRIDAY, timezone: 'Asia/Kolkata' }, nine.runner);
    check('ONE SNAPSHOT AND A FIXED STATEMENT SET: exactly one snapshot, seven statements in the documented order (candidates, occurrences, preferences, habit logs, availability flag, availability periods, plans)', two.state.runs === 1 && two.state.statements.length === 7 && /GoalActivity" ga/.test(two.state.statements[0]) && /GoalActivityOccurrence/.test(two.state.statements[1]) && /UserActivityPreference/.test(two.state.statements[2]) && /HabitLog/.test(two.state.statements[3]) && /availabilityConfigured/.test(two.state.statements[4]) && /UserAvailabilityPeriod/.test(two.state.statements[5]) && /PlannedActivity/.test(two.state.statements[6]));
    check('QUERY BOUND: 2 candidates and 9 candidates issue exactly the same statements in one snapshot each (the occurrence read is ONE batched query; no per-candidate query or transaction)', nine.state.runs === 1 && nine.state.statements.length === two.state.statements.length && JSON.stringify(nine.state.statements.map((s) => s.slice(0, 40))) === JSON.stringify(two.state.statements.map((s) => s.slice(0, 40))));
    check('NOTHING RUNS AFTER THE SNAPSHOT: every statement was issued while the snapshot was open, and the copy-and-freeze happens after it ended', two.state.usedWhileClosed === 0 && two.state.ended && Object.isFrozen(ctx2));
    const noCand = fakeSnapshot({ candidates: [], preferences: base.preferences });
    const ctxNone = await loadDecisionSchedulingContext({ userId: 'u', planningDate: FRIDAY, timezone: 'Asia/Kolkata' }, noCand.runner);
    check('NO CANDIDATE -> NO OPPORTUNITY READS: only the candidates, preferences and habit logs are read (3 statements); the context has no opportunity part', noCand.state.statements.length === 3 && ctxNone.opportunity === undefined && ctxNone.recurrence.occurrenceRows.length === 0);
    check('THE PLAN RANGE IS THE OPPORTUNITY HORIZON in the user\'s timezone: the planning date\'s local start through the local start of the day after its week\'s end (Asia/Kolkata: Fri 00:00 IST .. Mon 00:00 IST)', ctx2.opportunity!.planRangeFrom === '2026-10-08T18:30:00.000Z' && ctx2.opportunity!.planRangeTo === '2026-10-11T18:30:00.000Z');
    base.preferences[0].preferredDurationMinutes = 999;
    check('the context is independent of the rows the executor returned (mutating them afterwards changes nothing)', ctx2.durationSources.preferenceRows[0].preferredDurationMinutes === 25);
    const failMid = fakeSnapshot({ ...base, candidates: [row('ga-1')] }, { failAt: 3 });
    check('PARTIAL READ FAILURE: when any statement fails the acquisition rejects with no context at all (the first reads are discarded)', await rejects(loadDecisionSchedulingContext({ userId: 'u', planningDate: FRIDAY, timezone: 'Asia/Kolkata' }, failMid.runner)) && failMid.state.statements.length === 3 && failMid.state.ended);
    check('the loader runs the snapshot callback exactly once per evaluation even on failure (no retry loop, no second snapshot)', failMid.state.runs === 1);
  }

  // ============================================================
  console.log('=== the preview boundary: one context per evaluation; a failed context means NO evidence, never the live reads ===');
  {
    const realPrepare = preparationModule.prepareDecisionEvidence;
    let evidence: DecisionEvidenceByIntentId | undefined;
    (preparationModule as any).prepareDecisionEvidence = (...args: Parameters<typeof realPrepare>) => { evidence = realPrepare(...args); return evidence; };
    const slot = (): TimingCandidate => ({ start: `${FRIDAY}T11:00:00Z`, end: `${FRIDAY}T12:00:00Z`, score: 5, label: 'GOOD', muhurtaScore: 0, reasons: [], metadata: { windowType: 'NEUTRAL', windowLabel: 'x', activityType: 'x', dateLabel: FRIDAY } });
    const order: string[] = [];
    const liveDuration = { calls: 0 };
    const orchestratorDeps = (): DayConstructorOrchestratorDeps => ({
      loadBlockingPlans: async () => { order.push('blockingPlans'); return []; },
      loadDurationContext: async () => { liveDuration.calls += 1; order.push('liveDuration'); return { preferredDurationByActivityId: {}, behavioralDurationByActivityId: {} }; },
      searchTiming: () => ({ candidates: [slot()] }),
      loadAvailabilityConfiguration: async () => ({ configured: false, periods: [] }),
    });
    const WEEK: DecisionFacts = { recurrence: { period: 'LOCAL_CALENDAR_WEEK', periodStartDate: '2026-10-05', periodEndDate: '2026-10-11', targetPerPeriod: 3, completedInPeriod: 0, committedInPeriod: 0, remainingInPeriod: 3 } };
    const body = { targetDate: FRIDAY, constructionWindowSource: 'EXPLICIT_RANGE', explicitStart: `${FRIDAY}T09:00:00Z`, explicitEnd: `${FRIDAY}T17:00:00Z`, intents: ['A', 'B', 'C'].map((id) => ({ id, title: id, activityId: 'meditation', flexibility: 'FLEXIBLE' })) };
    const now = new Date(`${FRIDAY}T09:00:00Z`);
    let legacyFactsCalls = 0; let legacyRangeCalls = 0;
    const legacyFacts = async () => { legacyFactsCalls += 1; return new Map<string, DecisionFacts>([['A', WEEK]]); };
    const legacyRange = { loadAvailabilityConfiguration: async () => { legacyRangeCalls += 1; return { configured: true, periods: [] }; }, loadPlansOverlappingRange: async () => { legacyRangeCalls += 1; return []; } };
    const ctx = createDecisionSchedulingContext(parts({ durationSources: { preferenceRows: [{ activityId: 'meditation', preferredDurationMinutes: 25 }], habitLogs: [] }, opportunity: { configured: true, periods: workWeekPeriods, planRangeFrom: new Date(`${FRIDAY}T00:00:00Z`), planRangeTo: new Date('2026-10-12T00:00:00Z'), plans: [] } }));
    let loadCalls = 0;
    const binding = (load: () => Promise<DecisionSchedulingContext>): DecisionSchedulingBinding => ({ loadContext: async () => { loadCalls += 1; order.push('context'); return load(); }, decisionFactsFromContext: async () => new Map<string, DecisionFacts>([['A', WEEK], ['B', WEEK], ['C', WEEK]]) });
    try {
      const ok = await runDayConstructorPreview(body, 'UTC', now, orchestratorDeps(), legacyFacts, legacyRange, binding(async () => ctx));
      check('ONE CONTEXT PER EVALUATION: three candidates cause exactly one context acquisition, and it happens BEFORE the Constructor\'s own reads (context, then blockers)', ok.httpStatus === 200 && loadCalls === 1 && order[0] === 'context' && order.indexOf('blockingPlans') > 0);
      check('NO MIXING: with a binding supplied the independent live providers are never called (no live decision-facts read, no live availability / plan read), and the live duration read is replaced by the snapshot\'s (zero live duration calls)', legacyFactsCalls === 0 && legacyRangeCalls === 0 && liveDuration.calls === 0);
      check('EVIDENCE FROM THE SNAPSHOT ONLY: all three candidates have evidence; the duration is the snapshot\'s stored preference (25, RESOLVED) and the supply comes from the snapshot\'s availability and plans', ['A', 'B', 'C'].every((id) => evidence?.get(id)?.recurrence?.remainingInPeriod === 3 && evidence?.get(id)?.opportunity?.durationMinutes === 25 && evidence?.get(id)?.opportunity?.durationBasis === 'RESOLVED' && evidence?.get(id)?.opportunity?.startDateState === 'KNOWN_FEASIBLE'));
      order.length = 0; loadCalls = 0; evidence = undefined; liveDuration.calls = 0;
      const failed = await runDayConstructorPreview(body, 'UTC', now, orchestratorDeps(), legacyFacts, legacyRange, binding(async () => { throw new Error('snapshot unavailable'); }));
      check('NO MIXED-SNAPSHOT FALLBACK (critical): when the context cannot be acquired the preview still succeeds (HTTP 200, READY) but there is NO decision evidence, and the independent live providers (decision facts, availability, plans) were NOT used as a substitute and nothing is labelled authoritative', failed.httpStatus === 200 && (failed.body as any).status === 'READY' && (evidence === undefined || (evidence as DecisionEvidenceByIntentId).size === 0) && legacyFactsCalls === 0 && legacyRangeCalls === 0);
      check('in that case the Constructor keeps its own live duration / blocker inputs exactly as a request with no evidence provider (one live duration read, one blocker read)', liveDuration.calls === 1 && order.filter((o) => o === 'blockingPlans').length === 1);
      order.length = 0; evidence = undefined;
      const legacyOnly = await runDayConstructorPreview(body, 'UTC', now, orchestratorDeps(), legacyFacts, legacyRange);
      check('WITHOUT a binding the legacy path behaves exactly as before (the live providers ARE used) -- the composition is the control the DB suite compares against', legacyOnly.httpStatus === 200 && legacyFactsCalls === 1 && legacyRangeCalls >= 1 && evidence !== undefined && (evidence as DecisionEvidenceByIntentId).get('A')?.recurrence?.remainingInPeriod === 3);
      const noFacts = await runDayConstructorPreview(body, 'UTC', now, orchestratorDeps(), undefined, undefined, { loadContext: async () => ctx, decisionFactsFromContext: async () => { throw new Error('facts boom'); } });
      check('FACT FAILURE stays fail-open: a context that loads but whose facts cannot be derived yields a normal preview with no recurrence facts (and so no evidence) -- nothing is guessed', noFacts.httpStatus === 200 && (noFacts.body as any).status === 'READY');
    } finally {
      (preparationModule as any).prepareDecisionEvidence = realPrepare;
    }
  }

  if (!allPassed) { console.error('SOME DECISION SCHEDULING CONTEXT CHECKS FAILED'); process.exitCode = 1; return; }
  console.log('ALL DECISION SCHEDULING CONTEXT CHECKS PASSED');
})().then(() => process.exit(), (err) => { console.error(err); process.exit(1); });
