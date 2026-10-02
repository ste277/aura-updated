/**
 * Opportunity Scarcity V1 -- O4: inert opportunity facts (pure, no DB).
 *
 * Composes the REAL O2 range adapter and the REAL O1 projection engine
 * (only the two database loaders are injected fakes) through the generic
 * enrichment, then through the real preview handler. Proves:
 *   - horizon (later of planning date and period start, through the
 *     period's inclusive end), candidate-local projection, one range load
 *   - complete / partial / unknown / known-zero coverage, DST uncertainty
 *   - demand and supply stay independent facts (no shortfall)
 *   - fallback durations are labelled, never passed off as resolved
 *   - absent horizon/duration -> no facts and no load
 *   - the constructed day is bit-for-bit identical with and without
 *     enrichment; failures never fail a preview or fabricate supply
 *   - forged client opportunity/period values are ignored
 */
import { computeOpportunityDecisionFacts, deriveOpportunityHorizon, type OpportunityCandidateInput } from '../apps/web/lib/opportunityDecisionFacts';
import { runDayConstructorPreview } from '../apps/web/lib/dayConstructorPreviewRequest';
import type { DecisionFacts, OpportunityDecisionFacts } from '../apps/web/lib/decisionFacts';
import type { OpportunityRangeDeps } from '../apps/web/lib/opportunityRangeAdapter';
import type { AvailabilityConfiguration } from '../apps/web/lib/availabilityContext';
import type { PlanBlockerCandidate } from '../apps/web/lib/planBlockerLifecycle';
import type { ConstructDayRequest, DayConstructorOrchestratorDeps } from '../apps/web/lib/dayConstructorOrchestrator';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}
const iso = (s: string) => new Date(s);

type Weekday = AvailabilityConfiguration['periods'][number]['weekday'];
const workWeek = (start = '09:00', end = '17:00'): AvailabilityConfiguration => ({
  configured: true,
  periods: ([1, 2, 3, 4, 5] as Weekday[]).map((weekday) => ({ weekday, startTime: start, endTime: end })),
});
const UNCONFIGURED: AvailabilityConfiguration = { configured: false, periods: [] };
const CONFIGURED_EMPTY: AvailabilityConfiguration = { configured: true, periods: [] };

function rangeDeps(configuration: AvailabilityConfiguration, plans: PlanBlockerCandidate[] = []) {
  const calls = { config: 0, plans: 0, bounds: [] as Array<{ from: Date; to: Date }> };
  const deps: OpportunityRangeDeps = {
    loadAvailabilityConfiguration: async () => {
      calls.config += 1;
      return configuration;
    },
    loadPlansOverlappingRange: async (bounds) => {
      calls.plans += 1;
      calls.bounds.push(bounds);
      return plans;
    },
  };
  return { deps, calls };
}
const recurrence = (start: string, end: string, remaining = 3, target = 5): DecisionFacts => ({
  recurrence: { period: 'LOCAL_CALENDAR_WEEK', periodStartDate: start, periodEndDate: end, targetPerPeriod: target, completedInPeriod: 1, committedInPeriod: target - remaining - 1, remainingInPeriod: remaining },
});
const cand = (intentId: string, durationMinutes: number | undefined, facts: DecisionFacts | undefined, durationBasis: 'RESOLVED' | 'GENERIC_FALLBACK' = 'RESOLVED'): OpportunityCandidateInput => ({ intentId, durationMinutes, durationBasis, facts });
const WEEK = recurrence('2026-10-05', '2026-10-11'); // Monday 2026-10-05 .. Sunday 2026-10-11
const MON = iso('2026-10-05T00:00:00Z');
const dayBlocker = (date: string): PlanBlockerCandidate => ({ start: iso(`${date}T00:00:00Z`), end: iso(`${date}T23:59:59Z`), status: 'LOGGED' });
const compute = (cands: OpportunityCandidateInput[], ctx: { planningDate: string; timezone: string; now: Date }, deps: OpportunityRangeDeps) => computeOpportunityDecisionFacts(cands, ctx, deps);

(async () => {
  // ============================================================
  // Horizon derivation
  // ============================================================
  check('horizon: planning date inside the period starts the horizon AT the planning date (elapsed days excluded) and ends at the inclusive period end', JSON.stringify(deriveOpportunityHorizon(WEEK, '2026-10-07')) === JSON.stringify({ startDate: '2026-10-07', endDate: '2026-10-11' }));
  check('horizon: a planning date equal to the period start starts at the period start', JSON.stringify(deriveOpportunityHorizon(WEEK, '2026-10-05')) === JSON.stringify({ startDate: '2026-10-05', endDate: '2026-10-11' }));
  check('horizon: a planning date BEFORE the period starts at the period start (the later of the two)', JSON.stringify(deriveOpportunityHorizon(WEEK, '2026-10-01')) === JSON.stringify({ startDate: '2026-10-05', endDate: '2026-10-11' }));
  check('horizon: a planning date after the period end yields no horizon', deriveOpportunityHorizon(WEEK, '2026-10-12') === undefined);
  check('horizon: facts without a horizon-defining entry, or no facts, yield none', deriveOpportunityHorizon({}, '2026-10-07') === undefined && deriveOpportunityHorizon(undefined, '2026-10-07') === undefined);

  // ============================================================
  // Coverage states (real O1 + real O2, fake loaders only)
  // ============================================================
  {
    const { deps, calls } = rangeDeps(workWeek());
    const out = await compute([cand('a', 30, WEEK)], { planningDate: '2026-10-05', timezone: 'UTC', now: MON }, deps);
    const f = out.get('a')!;
    check('COMPLETE: configured week, Mon-Fri 09-17, 30 min -> 7 evaluated, 5 viable, 0 unknown, COMPLETE', f.evaluatedDays === 7 && f.viableDays === 5 && f.unknownDays === 0 && f.coverage === 'COMPLETE');
    check('contract: the eight original fact fields (unchanged order) then the four additive P0b fields, horizon dates echoed as civil dates', JSON.stringify(Object.keys(f)) === JSON.stringify(['horizonStartDate', 'horizonEndDate', 'evaluatedDays', 'viableDays', 'unknownDays', 'coverage', 'durationMinutes', 'durationBasis', 'startDateState', 'afterStartEvaluatedDays', 'afterStartViableDays', 'afterStartUnknownDays']) && f.horizonStartDate === '2026-10-05' && f.horizonEndDate === '2026-10-11' && f.durationMinutes === 30 && f.durationBasis === 'RESOLVED');
    check('one availability load and one plan query for one candidate', calls.config === 1 && calls.plans === 1);
  }
  {
    const { deps } = rangeDeps(workWeek());
    const out = await compute([cand('a', 30, WEEK)], { planningDate: '2026-10-07', timezone: 'UTC', now: iso('2026-10-07T00:00:00Z') }, deps);
    const f = out.get('a')!;
    check('effective start: planning on Wednesday evaluates Wed..Sun only (5 days), viable Wed/Thu/Fri = 3', f.horizonStartDate === '2026-10-07' && f.evaluatedDays === 5 && f.viableDays === 3 && f.coverage === 'COMPLETE');
  }
  {
    // DST: America/New_York falls back on Sunday 2026-11-01; a Sunday window that starts at the repeated 01:30 cannot be converted exactly.
    const cfg: AvailabilityConfiguration = { configured: true, periods: [...workWeek().periods, { weekday: 0 as Weekday, startTime: '01:30', endTime: '03:00' }] };
    const { deps } = rangeDeps(cfg);
    const out = await compute([cand('a', 30, recurrence('2026-10-26', '2026-11-01'))], { planningDate: '2026-10-26', timezone: 'America/New_York', now: iso('2026-10-26T04:00:00Z') }, deps);
    const f = out.get('a')!;
    check('PARTIAL + DST: the ambiguous Sunday is UNKNOWN (never zero): 7 evaluated, 5 viable (lower bound), 1 unknown, PARTIAL', f.evaluatedDays === 7 && f.viableDays === 5 && f.unknownDays === 1 && f.coverage === 'PARTIAL');
  }
  {
    const { deps } = rangeDeps(UNCONFIGURED);
    const out = await compute([cand('a', 30, WEEK)], { planningDate: '2026-10-05', timezone: 'UTC', now: MON }, deps);
    const f = out.get('a')!;
    check('UNKNOWN: unconfigured availability -> every day unknown, viableDays 0, coverage UNKNOWN (not a COMPLETE zero)', f.evaluatedDays === 7 && f.unknownDays === 7 && f.viableDays === 0 && f.coverage === 'UNKNOWN');
  }
  {
    const { deps } = rangeDeps(CONFIGURED_EMPTY);
    const f = (await compute([cand('a', 30, WEEK)], { planningDate: '2026-10-05', timezone: 'UTC', now: MON }, deps)).get('a')!;
    check('CONFIGURED EMPTY: known-infeasible days, COMPLETE with viableDays 0 (a factual zero, not unknown)', f.unknownDays === 0 && f.viableDays === 0 && f.coverage === 'COMPLETE');
  }
  {
    const blockers = ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09'].map(dayBlocker);
    const { deps } = rangeDeps(workWeek(), blockers);
    const f = (await compute([cand('a', 30, WEEK)], { planningDate: '2026-10-05', timezone: 'UTC', now: MON }, deps)).get('a')!;
    check('KNOWN ZERO: configured availability fully consumed by persisted blockers -> COMPLETE, viableDays 0, no classification field', f.viableDays === 0 && f.unknownDays === 0 && f.coverage === 'COMPLETE' && !('classification' in f));
  }

  // ============================================================
  // Candidate-local projection, one range load
  // ============================================================
  {
    const lunch: PlanBlockerCandidate = { start: iso('2026-10-06T12:00:00Z'), end: iso('2026-10-06T13:00:00Z'), status: 'UPCOMING' };
    const { deps, calls } = rangeDeps(workWeek(), [lunch]);
    const out = await compute([cand('a', 30, WEEK), cand('b', 240, WEEK), cand('c', 300, WEEK), cand('d', 600, WEEK)], { planningDate: '2026-10-05', timezone: 'UTC', now: MON }, deps);
    check('multiple candidates: ONE availability load and ONE plan query regardless of candidate count', calls.config === 1 && calls.plans === 1);
    check('different durations are projected independently: 30 min -> 5, 240 min -> 5 (Tuesday 13-17 fits), 300 min -> 4 (Tuesday breaks), 600 min -> 0 (COMPLETE)', out.get('a')!.viableDays === 5 && out.get('b')!.viableDays === 5 && out.get('c')!.viableDays === 4 && out.get('d')!.viableDays === 0 && out.get('d')!.coverage === 'COMPLETE');
    check('candidate-local overlap: every candidate may report the same viable day (no capacity is allocated among them)', out.get('a')!.viableDays === 5 && out.get('b')!.viableDays === 5);
  }
  {
    // Different horizons: one load for the WIDEST range, then in-memory slicing.
    const { deps, calls } = rangeDeps(workWeek());
    const out = await compute([cand('a', 30, WEEK), cand('b', 30, recurrence('2026-10-12', '2026-10-18'))], { planningDate: '2026-10-07', timezone: 'UTC', now: iso('2026-10-07T00:00:00Z') }, deps);
    check('different horizons: still ONE load, covering the widest range 2026-10-07 .. 2026-10-18', calls.config === 1 && calls.plans === 1 && calls.bounds[0].from.toISOString() === '2026-10-07T00:00:00.000Z' && calls.bounds[0].to.toISOString() === '2026-10-19T00:00:00.000Z');
    check('different horizons: each candidate is evaluated over its OWN horizon (a: 10-07..10-11 viable 3; b: 10-12..10-18 viable 5)', out.get('a')!.evaluatedDays === 5 && out.get('a')!.viableDays === 3 && out.get('b')!.horizonStartDate === '2026-10-12' && out.get('b')!.evaluatedDays === 7 && out.get('b')!.viableDays === 5);
  }
  {
    // Future planning date: horizon starts at the planning date inside a later period; wall-clock week is unrelated.
    const { deps } = rangeDeps(workWeek());
    const f = (await compute([cand('a', 30, recurrence('2026-10-12', '2026-10-18'))], { planningDate: '2026-10-14', timezone: 'UTC', now: MON }, deps)).get('a')!;
    check('FUTURE planning date: horizon is the planning date through ITS period end (10-14..10-18), not the wall-clock week', f.horizonStartDate === '2026-10-14' && f.horizonEndDate === '2026-10-18' && f.evaluatedDays === 5 && f.viableDays === 3);
  }
  {
    // Past planning date: not reinterpreted as today; elapsed days are known-infeasible via O1; today is clipped.
    const { deps } = rangeDeps(workWeek());
    const f = (await compute([cand('a', 30, WEEK)], { planningDate: '2026-10-05', timezone: 'UTC', now: iso('2026-10-07T12:00:00Z') }, deps)).get('a')!;
    check('PAST planning date: Mon/Tue elapsed (known infeasible), Wed clipped to the remaining window, Thu/Fri full -> viable 3 of 7, COMPLETE', f.horizonStartDate === '2026-10-05' && f.evaluatedDays === 7 && f.viableDays === 3 && f.unknownDays === 0 && f.coverage === 'COMPLETE');
    const f2 = (await compute([cand('a', 30, WEEK)], { planningDate: '2026-10-05', timezone: 'UTC', now: iso('2026-10-12T00:00:00Z') }, rangeDeps(workWeek()).deps)).get('a')!;
    check('PAST planning date, whole period elapsed: every day known-infeasible -> viable 0, COMPLETE (no unknown added by elapsed days)', f2.viableDays === 0 && f2.unknownDays === 0 && f2.coverage === 'COMPLETE');
  }

  // ============================================================
  // Demand and supply are independent facts
  // ============================================================
  {
    const three = ['2026-10-05', '2026-10-06', '2026-10-07'].map(dayBlocker); // Mon-Wed consumed -> Thu, Fri viable
    for (const [label, remaining, expectViable] of [['demand 3 > supply 2', 3, 2], ['demand 2 = supply 2', 2, 2], ['demand 1 < supply 2', 1, 2]] as const) {
      const facts = recurrence('2026-10-05', '2026-10-11', remaining, 5);
      const out = await compute([cand('a', 30, facts)], { planningDate: '2026-10-05', timezone: 'UTC', now: MON }, rangeDeps(workWeek(), three).deps);
      const f = out.get('a')!;
      const merged = { ...facts, opportunity: f };
      check(`${label}: both facts present and independent (remaining ${remaining}, viable ${f.viableDays}); no shortfall/deficit/pressure/classification anywhere`, merged.recurrence!.remainingInPeriod === remaining && f.viableDays === expectViable && !/shortfall|deficit|pressure|scarc|risk|critical|safe|impossible|lastChance/i.test(JSON.stringify(merged)));
      check(`${label}: the opportunity entry never repeats the recurrence requirement`, !/targetPerPeriod|completedInPeriod|committedInPeriod|remainingInPeriod/.test(JSON.stringify(f)));
    }
    const unknown = (await compute([cand('a', 30, recurrence('2026-10-05', '2026-10-11', 3, 5))], { planningDate: '2026-10-05', timezone: 'UTC', now: MON }, rangeDeps(UNCONFIGURED).deps)).get('a')!;
    check('unknown supply with a known remaining count: coverage UNKNOWN and no inferred scarcity (viableDays 0 is a lower bound, never "none")', unknown.coverage === 'UNKNOWN' && unknown.unknownDays === 7);
  }

  // ============================================================
  // Absent inputs -> no facts, no load
  // ============================================================
  {
    const { deps, calls } = rangeDeps(workWeek());
    const none = await compute([], { planningDate: '2026-10-05', timezone: 'UTC', now: MON }, deps);
    const noHorizon = await compute([cand('manual', 30, undefined), cand('typed', 30, {})], { planningDate: '2026-10-05', timezone: 'UTC', now: MON }, deps);
    const noDuration = await compute([cand('x', undefined, WEEK)], { planningDate: '2026-10-05', timezone: 'UTC', now: MON }, deps);
    check('no candidates, no horizon, or no duration: no facts and ZERO loads', none.size === 0 && noHorizon.size === 0 && noDuration.size === 0 && calls.config === 0 && calls.plans === 0);
  }
  {
    const { deps, calls } = rangeDeps(workWeek());
    const bad = await compute([cand('a', 30, WEEK)], { planningDate: '2026-10-05', timezone: 'Not/A_Zone', now: MON }, deps);
    check('an invalid range request (bad timezone) yields no facts and loads nothing', bad.size === 0 && calls.config === 0 && calls.plans === 0);
  }
  {
    const f = (await compute([cand('a', 45, WEEK, 'GENERIC_FALLBACK')], { planningDate: '2026-10-05', timezone: 'UTC', now: MON }, rangeDeps(workWeek()).deps)).get('a')!;
    check('fallback duration: projected over the 45-minute fallback AND labelled GENERIC_FALLBACK (never passed off as RESOLVED)', f.durationMinutes === 45 && f.durationBasis === 'GENERIC_FALLBACK' && f.viableDays === 5);
  }
  {
    const a = (await compute([cand('a', 30, WEEK)], { planningDate: '2026-10-05', timezone: 'UTC', now: MON }, rangeDeps(workWeek()).deps)).get('a')!;
    const b = (await compute([cand('a', 30, WEEK)], { planningDate: '2026-10-05', timezone: 'Asia/Kolkata', now: MON }, rangeDeps(UNCONFIGURED).deps)).get('a')!;
    check('cross-user: independent timezone and availability configuration give independent facts (UTC configured COMPLETE vs Kolkata unconfigured UNKNOWN)', a.coverage === 'COMPLETE' && b.coverage === 'UNKNOWN');
  }

  // ============================================================
  // Through the REAL preview handler
  // ============================================================
  const orchestratorDeps: DayConstructorOrchestratorDeps = {
    loadBlockingPlans: async () => [],
    loadDurationContext: async () => ({ preferredDurationByActivityId: {}, behavioralDurationByActivityId: {} }),
    searchTiming: () => ({ candidates: [] }),
    loadAvailabilityConfiguration: async () => ({ configured: false, periods: [] }),
  };
  const NOW = iso('2026-10-07T09:00:00Z'); // Wednesday
  const body = (extra: Record<string, unknown> = {}, intents: Array<Record<string, unknown>> = [{ id: 'i1', title: 'Recurring one' }, { id: 'i2', title: 'Typed one' }]) => ({
    constructionWindowSource: 'EXPLICIT_RANGE',
    explicitStart: '2026-10-07T09:00:00Z',
    explicitEnd: '2026-10-07T17:00:00Z',
    intents: intents.map((i) => ({ flexibility: 'FLEXIBLE', ...i })),
    ...extra,
  });
  const provider = (facts: Record<string, DecisionFacts>) => async (_request: ConstructDayRequest) => new Map(Object.entries(facts));
  const resolved = (result: { body: unknown }, id: string) => JSON.parse(JSON.stringify(result.body)).preview.resolvedIntents.find((r: any) => r.requestedIntentId === id);
  const stripOpportunity = (b: unknown) => {
    const copy = JSON.parse(JSON.stringify(b));
    for (const r of copy.preview.resolvedIntents) if (r.dayIntent.decisionFacts) delete r.dayIntent.decisionFacts.opportunity;
    return JSON.stringify(copy);
  };
  {
    const { deps, calls } = rangeDeps(workWeek());
    const withOpp = await runDayConstructorPreview(body({}, [{ id: 'i1', title: 'Recurring one', durationMinutes: 30 }, { id: 'i2', title: 'Typed one', durationMinutes: 30 }]), 'UTC', NOW, orchestratorDeps, provider({ i1: WEEK }), deps);
    const without = await runDayConstructorPreview(body({}, [{ id: 'i1', title: 'Recurring one', durationMinutes: 30 }, { id: 'i2', title: 'Typed one', durationMinutes: 30 }]), 'UTC', NOW, orchestratorDeps, provider({ i1: WEEK }));
    const o = resolved(withOpp, 'i1')?.dayIntent.decisionFacts?.opportunity as OpportunityDecisionFacts | undefined;
    check('handler: a recurrence-backed intent gets opportunity facts from its horizon (planning Wed 10-07: 10-07..10-11, 3 viable) with the RESOLVED explicit duration', !!o && o.horizonStartDate === '2026-10-07' && o.horizonEndDate === '2026-10-11' && o.viableDays === 3 && o.durationMinutes === 30 && o.durationBasis === 'RESOLVED');
    check('handler: the recurrence entry the provider supplied is carried through unchanged beside the opportunity entry', JSON.stringify(resolved(withOpp, 'i1').dayIntent.decisionFacts.recurrence) === JSON.stringify(WEEK.recurrence));
    check('handler: a typed intent without recurrence facts gets NO facts at all (non-recurrent / manual stay untouched)', resolved(withOpp, 'i2').dayIntent.decisionFacts === undefined);
    check('handler: ONE load for the preview', calls.config === 1 && calls.plans === 1);
    check('handler: the constructed day, warnings and every other field are BYTE-IDENTICAL with and without enrichment', stripOpportunity(withOpp.body) === JSON.stringify(JSON.parse(JSON.stringify(without.body))) && JSON.stringify((withOpp.body as any).preview.constructedDay) === JSON.stringify((without.body as any).preview.constructedDay));
  }
  {
    // No explicit duration -> the generic fallback; the preview's own warning drives the basis.
    const { deps } = rangeDeps(workWeek());
    const r = await runDayConstructorPreview(body({}, [{ id: 'i1', title: 'Some unclassified thing' }]), 'UTC', NOW, orchestratorDeps, provider({ i1: WEEK }), deps);
    const o = resolved(r, 'i1')?.dayIntent.decisionFacts?.opportunity as OpportunityDecisionFacts | undefined;
    const warned = ((r.body as any).preview.warnings as Array<{ intentId: string; code: string }>).some((w) => w.intentId === 'i1' && w.code === 'DURATION_FROM_GENERIC_FALLBACK');
    check('handler: an intent resolved to the generic fallback duration is labelled GENERIC_FALLBACK (45 min) -- matching the preview\'s own warning', warned && !!o && o.durationBasis === 'GENERIC_FALLBACK' && o.durationMinutes === 45);
  }
  {
    // FIXED intents are not special: no recurrence facts -> no opportunity facts.
    const { deps, calls } = rangeDeps(workWeek());
    const r = await runDayConstructorPreview(body({}, [{ id: 'f1', title: 'Fixed thing', flexibility: 'FIXED', fixedStart: '2026-10-07T10:00:00Z', durationMinutes: 30 }]), 'UTC', NOW, orchestratorDeps, provider({}), deps);
    check('handler: a FIXED intent without a horizon gets no opportunity facts and triggers no load', (r.body as any).status === 'READY' && resolved(r, 'f1').dayIntent.decisionFacts === undefined && calls.config === 0 && calls.plans === 0);
  }
  {
    // Forged client values are ignored; the horizon comes only from provider facts.
    const forgedOpp = { horizonStartDate: '1999-01-04', horizonEndDate: '1999-01-10', evaluatedDays: 7, viableDays: 7, unknownDays: 0, coverage: 'COMPLETE', durationMinutes: 1, durationBasis: 'RESOLVED' };
    const forgedBody = body({ opportunity: forgedOpp, viableDays: 99, unknownDays: 0, coverage: 'COMPLETE', durationBasis: 'RESOLVED', periodStartDate: '1999-01-04', periodEndDate: '1999-01-10', decisionFacts: { opportunity: forgedOpp }, timezone: 'Pacific/Kiritimati' }, [
      { id: 'i1', title: 'Recurring one', durationMinutes: 30, opportunity: forgedOpp, decisionFacts: { opportunity: forgedOpp }, periodStartDate: '1999-01-04', periodEndDate: '1999-01-10', viableDays: 99 },
      { id: 'i2', title: 'Typed one', durationMinutes: 30, opportunity: forgedOpp, decisionFacts: { opportunity: forgedOpp } },
    ]);
    const { deps } = rangeDeps(workWeek());
    const r = await runDayConstructorPreview(forgedBody, 'UTC', NOW, orchestratorDeps, provider({ i1: WEEK }), deps);
    const o = resolved(r, 'i1').dayIntent.decisionFacts.opportunity as OpportunityDecisionFacts;
    check('forged client opportunity/range/timezone are ignored: the fact is server-derived (2026-10-07..2026-10-11, 3 viable, 30 min)', o.horizonStartDate === '2026-10-07' && o.horizonEndDate === '2026-10-11' && o.viableDays === 3 && o.durationMinutes === 30);
    check('forged client opportunity on an intent with no server facts never appears', resolved(r, 'i2').dayIntent.decisionFacts === undefined);
    const noDeps = await runDayConstructorPreview(forgedBody, 'UTC', NOW, orchestratorDeps);
    check('forged client opportunity with no provider and no range deps: no facts at all', resolved(noDeps, 'i1').dayIntent.decisionFacts === undefined && resolved(noDeps, 'i2').dayIntent.decisionFacts === undefined);
  }
  {
    // Failure isolation: a failing load never fails the preview and never fabricates supply.
    const warn = console.warn;
    console.warn = () => {};
    const failing: OpportunityRangeDeps = {
      loadAvailabilityConfiguration: async () => {
        throw new Error('availability down');
      },
      loadPlansOverlappingRange: async () => [],
    };
    const failingPlans: OpportunityRangeDeps = { loadAvailabilityConfiguration: async () => workWeek(), loadPlansOverlappingRange: async () => { throw new Error('plans down'); } };
    const baseline = await runDayConstructorPreview(body(), 'UTC', NOW, orchestratorDeps, provider({ i1: WEEK }));
    const a = await runDayConstructorPreview(body(), 'UTC', NOW, orchestratorDeps, provider({ i1: WEEK }), failing);
    const b = await runDayConstructorPreview(body(), 'UTC', NOW, orchestratorDeps, provider({ i1: WEEK }), failingPlans);
    console.warn = warn;
    check('failure isolation: an availability-load failure leaves a READY preview identical to the no-enrichment preview (no opportunity facts, no zero fabricated)', a.httpStatus === 200 && JSON.stringify(a.body) === JSON.stringify(baseline.body) && resolved(a, 'i1').dayIntent.decisionFacts.opportunity === undefined);
    check('failure isolation: a plan-load failure behaves the same', b.httpStatus === 200 && JSON.stringify(b.body) === JSON.stringify(baseline.body));
  }
  {
    // Provider supplies nothing (e.g. provider failure, or no eligible demand): no horizon, no load.
    const { deps, calls } = rangeDeps(workWeek());
    const r = await runDayConstructorPreview(body(), 'UTC', NOW, orchestratorDeps, provider({}), deps);
    check('no provider facts (provider failure / zero-remaining excluded upstream): no opportunity facts and no range load', resolved(r, 'i1').dayIntent.decisionFacts === undefined && calls.config === 0 && calls.plans === 0);
  }
  {
    // Non-READY outcomes are passed through untouched and never enriched.
    const { deps, calls } = rangeDeps(workWeek());
    const r = await runDayConstructorPreview(body({ constructionWindowSource: 'REMAINING_TODAY', targetDate: '2026-10-09', explicitStart: undefined, explicitEnd: undefined }), 'UTC', NOW, orchestratorDeps, provider({ i1: WEEK }), deps);
    check('a non-READY outcome (future date, unconfigured availability) is returned verbatim with no range load', (r.body as any).status === 'FUTURE_AVAILABILITY_REQUIRED' && calls.config === 0 && calls.plans === 0);
  }

  if (!allPassed) {
    console.error('SOME OPPORTUNITY DECISION FACTS CHECKS FAILED');
    process.exit(1);
  }
  console.log('ALL OPPORTUNITY DECISION FACTS CHECKS PASSED');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
