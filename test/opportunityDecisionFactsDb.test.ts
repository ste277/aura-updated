/**
 * Opportunity Scarcity V1 -- O4: live-database proof of the REAL chain
 *
 *   real GoalActivity + Rhythm persistence
 *   -> O3 recurrence facts + period bounds (goalDecisionFactsProvider)
 *   -> generic opportunity enrichment (opportunityDecisionFacts)
 *   -> O2 range adapter over the user's REAL availability + REAL plans
 *   -> O1 candidate-local projection
 *   -> DecisionFacts.opportunity on the resolved intent
 *   (through the real preview boundary, wired exactly as route.ts wires it).
 *
 * No test-local fact injection anywhere. Also proves: the Constructor's
 * output is byte-identical with and without enrichment, supply changes
 * factually with availability/blockers, unconfigured -> UNKNOWN, fully
 * blocked -> COMPLETE zero, DST uncertainty survives, per-user timezones,
 * forged values are ignored, loads do not grow with candidate count, and
 * nothing is written.
 *
 *   DATABASE_URL="postgresql://..." npx ts-node test/opportunityDecisionFactsDb.test.ts
 */
import { upsertUserByEmail, updateBirthProfile, createGoalWithActivities, addGoalActivity, beginTransaction, createPlannedActivity, replaceUserAvailabilityConfiguration, getUserById } from '../apps/web/lib/db';
import { encodeGoalDemandIntentId } from '../apps/web/lib/goalDemandIntentId';
import { createRealGoalDemandCandidatesDeps, type GoalDemandCandidatesDeps } from '../apps/web/lib/goalDemandCandidates';
import { createRealDayConstructorOrchestratorDeps, type DayConstructorOrchestratorDeps } from '../apps/web/lib/dayConstructorOrchestrator';
import { handleDayConstructorPreviewRequest } from '../apps/web/lib/dayConstructorPreviewRequest';
import { loadGoalDecisionFacts } from '../apps/web/lib/goalDecisionFactsProvider';
import { createRealOpportunityRangeDeps } from '../apps/web/lib/opportunityRangeRealDeps';
import type { OpportunityRangeDeps } from '../apps/web/lib/opportunityRangeAdapter';
import { localDateTimeToUTC } from '../apps/web/lib/timezone';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}
const iso = (s: string) => new Date(s);
const KOLKATA = 'Asia/Kolkata';

async function sql(text: string, params: unknown[] = []): Promise<any[]> {
  const c = await beginTransaction();
  try {
    const r = await c.query(text, params);
    await c.query('COMMIT');
    return r.rows;
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}
const setRhythm = (goalActivityId: string, target: number) => sql(`UPDATE "GoalActivity" SET "rhythmKind" = 'N_PER_WEEK', "rhythmTargetPerWeek" = $1 WHERE id = $2`, [target, goalActivityId]);

interface Counters {
  goalDiscovery: number;
  goalFacts: number;
  availability: number;
  blockers: number;
  orchestratorPlans: number;
  orchestratorAvailability: number;
}
const zero = (): Counters => ({ goalDiscovery: 0, goalFacts: 0, availability: 0, blockers: 0, orchestratorPlans: 0, orchestratorAvailability: 0 });

async function main() {
  const mkUser = async (key: string, timezone: string) => {
    const u = await upsertUserByEmail({ email: `test-o4-${key}@example.com`, cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone });
    await sql(`UPDATE "User" SET timezone = $1 WHERE id = $2`, [timezone, u.id]);
    await updateBirthProfile(u.id, { birthDate: '1990-06-15', birthTime: '08:30', birthCityName: 'Chennai', birthLatitude: 13.0827, birthLongitude: 80.2707, birthTimezone: timezone });
    return u;
  };
  const A = await mkUser('a-configured', KOLKATA);
  const B = await mkUser('b-unconfigured', KOLKATA);
  const C = await mkUser('c-blocked', KOLKATA);
  const D = await mkUser('d-dst', 'America/New_York');
  const E = await mkUser('e-la', 'America/Los_Angeles');
  const F = await mkUser('f-many', KOLKATA);
  const users = [A, B, C, D, E, F];
  const ids = users.map((u) => u.id);

  const cleanup = async () => {
    await sql(`UPDATE "GoalActivityOccurrence" SET "plannedActivityId" = NULL WHERE "userId" = ANY($1::text[])`, [ids]);
    await sql(`DELETE FROM "PlannedActivity" WHERE "userId" = ANY($1::text[])`, [ids]);
    await sql(`DELETE FROM "GoalActivity" WHERE "userId" = ANY($1::text[])`, [ids]);
    await sql(`DELETE FROM "Goal" WHERE "userId" = ANY($1::text[])`, [ids]);
    await sql(`DELETE FROM "UserAvailabilityPeriod" WHERE "userId" = ANY($1::text[])`, [ids]);
    await sql(`UPDATE "User" SET "availabilityConfigured" = false WHERE id = ANY($1::text[])`, [ids]);
  };
  await cleanup();

  // The real production preview boundary, wired as route.ts wires it; counters wrap the real loaders.
  const previewAs = async (userId: string, now: Date, body: Record<string, unknown>, opts: { enrich: boolean; counters?: Counters } = { enrich: true }) => {
    const c = opts.counters;
    const goalDeps: GoalDemandCandidatesDeps = (() => {
      const real = createRealGoalDemandCandidatesDeps();
      return {
        loadCandidateGoalActivities: async (uid) => {
          if (c) c.goalDiscovery += 1;
          return real.loadCandidateGoalActivities(uid);
        },
        loadRhythmFacts: async (uid, gids, tz) => {
          if (c) c.goalFacts += 1;
          return real.loadRhythmFacts(uid, gids, tz);
        },
      };
    })();
    return handleDayConstructorPreviewRequest({
      getSession: () => ({ userId }),
      getUser: (id) => getUserById(id),
      getBody: async () => body,
      now: () => now,
      createOrchestratorDeps: (u, n) => {
        const real = createRealDayConstructorOrchestratorDeps(u, n);
        const wrapped: DayConstructorOrchestratorDeps = {
          ...real,
          loadBlockingPlans: async (b) => {
            if (c) c.orchestratorPlans += 1;
            return real.loadBlockingPlans(b);
          },
          loadAvailabilityConfiguration: async () => {
            if (c) c.orchestratorAvailability += 1;
            return real.loadAvailabilityConfiguration();
          },
        };
        return wrapped;
      },
      loadDecisionFacts: (u, request) => loadGoalDecisionFacts(u, request, goalDeps),
      ...(opts.enrich
        ? {
            createOpportunityRangeDeps: (u: any): OpportunityRangeDeps => {
              const real = createRealOpportunityRangeDeps(u);
              return {
                loadAvailabilityConfiguration: async () => {
                  if (c) c.availability += 1;
                  return real.loadAvailabilityConfiguration();
                },
                loadPlansOverlappingRange: async (bounds) => {
                  if (c) c.blockers += 1;
                  return real.loadPlansOverlappingRange(bounds);
                },
              };
            },
          }
        : {}),
    });
  };
  const json = (r: { body: unknown }) => JSON.parse(JSON.stringify(r.body));
  const resolved = (r: { body: unknown }, id: string) => json(r).preview?.resolvedIntents?.find((x: any) => x.requestedIntentId === id);
  const opp = (r: { body: unknown }, id: string) => resolved(r, id)?.dayIntent?.decisionFacts?.opportunity;
  const rec = (r: { body: unknown }, id: string) => resolved(r, id)?.dayIntent?.decisionFacts?.recurrence;
  // Constructor-visible output: everything except the opportunity entry (and the per-call signatures, which are HMACs over the items).
  const constructorView = (r: { body: unknown }) => {
    const b = json(r);
    if (!b.preview) return JSON.stringify(b);
    for (const x of b.preview.resolvedIntents) if (x.dayIntent.decisionFacts) delete x.dayIntent.decisionFacts.opportunity;
    return JSON.stringify(b);
  };
  const counts = async () =>
    (
      await sql(
        `SELECT (SELECT count(*)::int FROM "PlannedActivity" WHERE "userId" = ANY($1::text[])) AS plans,
                (SELECT count(*)::int FROM "GoalActivityOccurrence" WHERE "userId" = ANY($1::text[])) AS occ,
                (SELECT count(*)::int FROM "GoalActivityExecution" WHERE "userId" = ANY($1::text[])) AS exec,
                (SELECT count(*)::int FROM "UserAvailabilityPeriod" WHERE "userId" = ANY($1::text[])) AS avail`,
        [ids]
      )
    )[0];
  const at = (date: string, hhmm: string, tz: string) => localDateTimeToUTC(date, hhmm, tz);
  let planSeq = 0;
  const addPlan = async (userId: string, start: Date, end: Date, status?: string) => {
    const p = await createPlannedActivity({ userId, title: `o4-blocker-${planSeq++}`, plannedStartAt: start, plannedEndAt: end, durationMinutes: Math.round((end.getTime() - start.getTime()) / 60000), windowType: 'NEUTRAL' });
    if (status) await sql(`UPDATE "PlannedActivity" SET status = $2 WHERE id = $1`, [p.id, status]);
    return p;
  };
  const workWeek = Array.from({ length: 5 }, (_, i) => ({ weekday: i + 1, startTime: '09:00', endTime: '17:00' }));
  const goalOf = async (userId: string, title: string) => (await createGoalWithActivities({ userId, title, targetDate: null, activities: [] })).goal;
  const activity = async (userId: string, goalId: string, title: string, target: number) => {
    const ga = await addGoalActivity(userId, goalId, { title, activityId: 'workout' });
    await setRhythm(ga!.id, target);
    return ga!;
  };

  try {
    // ------------------------------------------------------------------
    // A: configured Mon-Fri 09-17 IST, two Goals, recurring activities with different durations/targets.
    // ------------------------------------------------------------------
    await replaceUserAvailabilityConfiguration(A.id, workWeek);
    const g1 = await goalOf(A.id, 'Goal one');
    const g2 = await goalOf(A.id, 'Goal two');
    const ga1 = await activity(A.id, g1.id, 'Cardio 30', 3); // supply 4 > demand 3
    const ga2 = await activity(A.id, g1.id, 'Strength 120', 3);
    const ga3 = await activity(A.id, g1.id, 'Unclassifiable thing', 3); // generic fallback duration
    const ga5 = await activity(A.id, g2.id, 'Study 60', 5); // demand 5 > supply 4
    const ga6 = await activity(A.id, g1.id, 'Walk 30', 4); // demand 4 = supply 4
    const ga4 = await activity(A.id, g2.id, 'Exhausted', 1); // will be exhausted this week
    // ga4 exhausted: one LOGGED occurrence in the planning week (Mon 10-05, IST).
    const done = await addPlan(A.id, at('2026-10-05', '08:00', KOLKATA), at('2026-10-05', '08:30', KOLKATA), 'LOGGED');
    await sql(`INSERT INTO "GoalActivityOccurrence"(id, "userId", "goalActivityId", "plannedActivityId") VALUES ($1, $2, $3, $4)`, ['o4-occ-done', A.id, ga4.id, done.id]);

    const NOW = at('2026-10-05', '09:00', KOLKATA); // Monday 09:00 IST == 03:30Z
    const DATE = '2026-10-05';
    const iid = (ga: { id: string }) => encodeGoalDemandIntentId(DATE, ga.id);
    const intentsA = [
      { id: iid(ga1), title: 'Cardio 30', flexibility: 'FLEXIBLE', activityId: 'workout', durationMinutes: 30 },
      { id: iid(ga2), title: 'Strength 120', flexibility: 'FLEXIBLE', activityId: 'workout', durationMinutes: 120 },
      { id: iid(ga3), title: 'Zzqx unclassifiable', flexibility: 'FLEXIBLE' },
      { id: iid(ga5), title: 'Study 60', flexibility: 'FLEXIBLE', activityId: 'workout', durationMinutes: 60 },
      { id: iid(ga6), title: 'Walk 30', flexibility: 'FLEXIBLE', activityId: 'workout', durationMinutes: 30 },
      { id: iid(ga4), title: 'Exhausted', flexibility: 'FLEXIBLE', activityId: 'workout', durationMinutes: 30 },
      { id: 'typed-1', title: 'Write report', flexibility: 'FLEXIBLE', durationMinutes: 30 },
      { id: `plan-day-goal-${ga1.id}`, title: 'Cardio 30 (manual handoff)', flexibility: 'FLEXIBLE', activityId: 'workout', durationMinutes: 30 },
    ];

    console.log('=== S1: configured availability, no blockers ===');
    const before = await counts();
    const s1On = await previewAs(A.id, NOW, { intents: intentsA });
    const s1Off = await previewAs(A.id, NOW, { intents: intentsA }, { enrich: false });
    check('S1: preview READY through the real boundary with the real chain', json(s1On).status === 'READY');
    const o1 = opp(s1On, iid(ga1));
    check('S1: O3 bounds -> O2 range -> O1 projection: horizon Mon 10-05 .. Sun 10-11, 7 evaluated, 5 viable (Mon-Fri), 0 unknown, COMPLETE', !!o1 && o1.horizonStartDate === '2026-10-05' && o1.horizonEndDate === '2026-10-11' && o1.evaluatedDays === 7 && o1.viableDays === 5 && o1.unknownDays === 0 && o1.coverage === 'COMPLETE');
    check('S1: effective horizon start is the planning date (the recurrence period start is the same Monday here)', rec(s1On, iid(ga1))?.periodStartDate === '2026-10-05' && o1?.horizonStartDate === '2026-10-05');
    check('S1: byte-identical Constructor output with and without enrichment (selection/placement unchanged)', constructorView(s1On) === constructorView(s1Off));
    check('S1: pre-O4 behavior: without the enrichment wired, no intent carries opportunity facts', !opp(s1Off, iid(ga1)));

    console.log('=== S2: active blockers change supply factually, never the Constructor ===');
    await addPlan(A.id, at('2026-10-06', '09:00', KOLKATA), at('2026-10-06', '17:00', KOLKATA)); // Tue fully blocked (UPCOMING)
    await addPlan(A.id, at('2026-10-07', '10:00', KOLKATA), at('2026-10-07', '16:00', KOLKATA)); // Wed leaves 09-10 and 16-17
    await addPlan(A.id, at('2026-10-05', '15:00', KOLKATA), at('2026-10-05', '16:00', KOLKATA)); // today 15-16
    const s2On = await previewAs(A.id, NOW, { intents: intentsA });
    const s2Off = await previewAs(A.id, NOW, { intents: intentsA }, { enrich: false });
    const f = (ga: { id: string }) => opp(s2On, iid(ga));
    check('S2: 30 min fits Mon/Wed/Thu/Fri -> viable 4 (down from 5), COMPLETE', f(ga1).viableDays === 4 && f(ga1).coverage === 'COMPLETE' && f(ga1).unknownDays === 0);
    check('S2: 120 min fits only Mon/Thu/Fri -> viable 3 (candidate-local, per its own duration)', f(ga2).viableDays === 3 && f(ga2).durationMinutes === 120);
    check('S2: supply differs from S1 while the recurrence facts are unchanged', f(ga1).viableDays < o1.viableDays && JSON.stringify(rec(s2On, iid(ga1))) === JSON.stringify(rec(s1On, iid(ga1))));
    check('S2: byte-identical Constructor output with and without enrichment', constructorView(s2On) === constructorView(s2Off));
    check('S2: the day\'s proposed/deferred selection is the same with the enrichment wired', JSON.stringify(json(s2On).preview.constructedDay) === JSON.stringify(json(s2Off).preview.constructedDay));

    console.log('=== demand and supply stay independent facts ===');
    const r5 = rec(s2On, iid(ga5));
    const r1 = rec(s2On, iid(ga1));
    const r6 = rec(s2On, iid(ga6));
    check('demand 5 > supply 4 (60 min): both carried, no shortfall field', r5.remainingInPeriod === 5 && f(ga5).viableDays === 4 && !/shortfall|deficit|pressure/i.test(JSON.stringify(resolved(s2On, iid(ga5)).dayIntent.decisionFacts)));
    check('demand 4 = supply 4 (30 min): both carried, no interpretation', r6.remainingInPeriod === 4 && f(ga6).viableDays === 4);
    check('demand 3 < supply 4 (30 min): both carried, no interpretation', r1.remainingInPeriod === 3 && f(ga1).viableDays === 4);
    check('the opportunity entry never repeats the requirement fields', !/targetPerPeriod|completedInPeriod|committedInPeriod|remainingInPeriod/.test(JSON.stringify(f(ga1))));

    console.log('=== durationBasis ===');
    const fb = f(ga3);
    const fbWarned = (json(s2On).preview.warnings as any[]).some((w) => w.intentId === iid(ga3) && w.code === 'DURATION_FROM_GENERIC_FALLBACK');
    check('an intent with no resolvable duration signal is labelled GENERIC_FALLBACK (45 min) and the preview warns the same', fbWarned && fb.durationBasis === 'GENERIC_FALLBACK' && fb.durationMinutes === 45);
    check('explicitly-specified durations are RESOLVED', f(ga1).durationBasis === 'RESOLVED' && f(ga2).durationBasis === 'RESOLVED');

    console.log('=== multiple Goals / non-recurrent / manual / exhausted ===');
    check('multiple Goals share the same architecture and the same horizon (Goal one and Goal two intents)', f(ga1).horizonEndDate === f(ga5).horizonEndDate && f(ga1).horizonStartDate === f(ga5).horizonStartDate);
    check('a typed (non-recurrent) intent carries no decision facts at all', resolved(s2On, 'typed-1').dayIntent.decisionFacts === undefined);
    check('the MANUAL Goal handoff intent (plan-day-goal-*) still carries no facts (existing source-path asymmetry, unchanged)', resolved(s2On, `plan-day-goal-${ga1.id}`).dayIntent.decisionFacts === undefined);
    check('an exhausted activity (excluded upstream) gets no recurrence facts and NO opportunity facts', resolved(s2On, iid(ga4)).dayIntent.decisionFacts === undefined);

    console.log('=== forged client values are ignored ===');
    const forgedOpp = { horizonStartDate: '1999-01-04', horizonEndDate: '1999-01-10', evaluatedDays: 7, viableDays: 7, unknownDays: 0, coverage: 'COMPLETE', durationMinutes: 1, durationBasis: 'RESOLVED' };
    const forged = await previewAs(A.id, NOW, {
      opportunity: forgedOpp,
      viableDays: 99,
      coverage: 'COMPLETE',
      periodStartDate: '1999-01-04',
      periodEndDate: '1999-01-10',
      timezone: 'Pacific/Kiritimati',
      decisionFacts: { opportunity: forgedOpp },
      intents: intentsA.map((i) => ({ ...i, opportunity: forgedOpp, decisionFacts: { opportunity: forgedOpp }, periodStartDate: '1999-01-04', periodEndDate: '1999-01-10', viableDays: 99 })),
    });
    check('forged opportunity/range/timezone: the facts equal the server-derived S2 facts exactly', JSON.stringify(opp(forged, iid(ga1))) === JSON.stringify(f(ga1)) && JSON.stringify(opp(forged, iid(ga2))) === JSON.stringify(f(ga2)));
    check('forged opportunity on typed and manual intents never appears', resolved(forged, 'typed-1').dayIntent.decisionFacts === undefined && resolved(forged, `plan-day-goal-${ga1.id}`).dayIntent.decisionFacts === undefined);

    console.log('=== zero writes ===');
    const after = await counts();
    check('previews wrote nothing: since the S1 snapshot only the 3 fixture plans S2 inserted were added; no occurrence, execution or availability row changed', after.plans === before.plans + 3 && after.occ === before.occ && after.exec === before.exec && after.avail === before.avail);

    // ------------------------------------------------------------------
    // B: unconfigured availability -> coverage UNKNOWN (never a COMPLETE zero)
    // ------------------------------------------------------------------
    console.log('=== unconfigured availability ===');
    const gb = await goalOf(B.id, 'B goal');
    const gab = await activity(B.id, gb.id, 'B cardio', 2);
    const bIntent = { id: encodeGoalDemandIntentId(DATE, gab.id), title: 'B cardio', flexibility: 'FLEXIBLE', activityId: 'workout', durationMinutes: 30 };
    const rb = await previewAs(B.id, NOW, { intents: [bIntent] });
    const ob = opp(rb, bIntent.id);
    check('unconfigured user: preview READY (the constructor\'s today fallback still builds a day) but supply is UNKNOWN: 7 evaluated, 7 unknown, 0 viable, UNKNOWN', json(rb).status === 'READY' && !!ob && ob.evaluatedDays === 7 && ob.unknownDays === 7 && ob.viableDays === 0 && ob.coverage === 'UNKNOWN');

    // ------------------------------------------------------------------
    // C: configured availability completely consumed by blockers -> COMPLETE zero
    // ------------------------------------------------------------------
    console.log('=== fully blocked availability ===');
    await replaceUserAvailabilityConfiguration(C.id, workWeek);
    for (const d of ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09']) await addPlan(C.id, at(d, '09:00', KOLKATA), at(d, '17:00', KOLKATA), 'LOGGED');
    const gc = await goalOf(C.id, 'C goal');
    const gac = await activity(C.id, gc.id, 'C cardio', 3);
    const cIntent = { id: encodeGoalDemandIntentId(DATE, gac.id), title: 'C cardio', flexibility: 'FLEXIBLE', activityId: 'workout', durationMinutes: 30 };
    const evening = { constructionWindowSource: 'EXPLICIT_RANGE', explicitStart: at(DATE, '18:00', KOLKATA).toISOString(), explicitEnd: at(DATE, '22:00', KOLKATA).toISOString() };
    const rc = await previewAs(C.id, NOW, { ...evening, intents: [cIntent] });
    const oc = opp(rc, cIntent.id);
    const rcOff = await previewAs(C.id, NOW, { ...evening, intents: [cIntent] }, { enrich: false });
    check('fully blocked: COMPLETE with viableDays 0 and no unknown days -- a factual zero, no classification', json(rc).status === 'READY' && !!oc && oc.viableDays === 0 && oc.unknownDays === 0 && oc.coverage === 'COMPLETE' && oc.evaluatedDays === 7);
    check('fully blocked: no policy consequence -- the Constructor output is byte-identical with and without enrichment', constructorView(rc) === constructorView(rcOff));

    // ------------------------------------------------------------------
    // D: DST uncertainty survives the whole chain
    // ------------------------------------------------------------------
    console.log('=== DST uncertainty (America/New_York, fall back Sunday 2026-11-01) ===');
    await replaceUserAvailabilityConfiguration(D.id, [...workWeek, { weekday: 0, startTime: '01:30', endTime: '03:00' }]);
    const gd = await goalOf(D.id, 'D goal');
    const gad = await activity(D.id, gd.id, 'D cardio', 3);
    const DNOW = iso('2026-10-26T13:00:00Z'); // Monday 09:00 EDT
    const dIntent = { id: encodeGoalDemandIntentId('2026-10-26', gad.id), title: 'D cardio', flexibility: 'FLEXIBLE', activityId: 'workout', durationMinutes: 30 };
    const rd = await previewAs(D.id, DNOW, { constructionWindowSource: 'EXPLICIT_RANGE', explicitStart: '2026-10-26T14:00:00Z', explicitEnd: '2026-10-26T22:00:00Z', intents: [dIntent] });
    const od = opp(rd, dIntent.id);
    check('the ambiguous 01:30 Sunday window is UNKNOWN, not zero: 7 evaluated, 5 viable (lower bound), 1 unknown, PARTIAL', json(rd).status === 'READY' && !!od && od.evaluatedDays === 7 && od.viableDays === 5 && od.unknownDays === 1 && od.coverage === 'PARTIAL' && od.horizonStartDate === '2026-10-26' && od.horizonEndDate === '2026-11-01');

    // ------------------------------------------------------------------
    // Cross-user at the SAME instant: 2026-10-11T20:00Z
    // ------------------------------------------------------------------
    console.log('=== cross-user: same instant, different authoritative timezones ===');
    await replaceUserAvailabilityConfiguration(E.id, workWeek);
    const ge = await goalOf(E.id, 'E goal');
    const gae = await activity(E.id, ge.id, 'E cardio', 2);
    const INSTANT = iso('2026-10-11T20:00:00Z');
    const eIntent = { id: encodeGoalDemandIntentId('2026-10-11', gae.id), title: 'E cardio', flexibility: 'FLEXIBLE', activityId: 'workout', durationMinutes: 30 };
    const re = await previewAs(E.id, INSTANT, { constructionWindowSource: 'EXPLICIT_RANGE', explicitStart: '2026-10-11T21:00:00Z', explicitEnd: '2026-10-11T23:00:00Z', intents: [eIntent] });
    const oe = opp(re, eIntent.id);
    check('Los Angeles (Sunday 13:00 local): horizon is just Sunday 10-11 (period end), 1 evaluated, a known-empty Sunday -> 0 viable, COMPLETE', !!oe && oe.horizonStartDate === '2026-10-11' && oe.horizonEndDate === '2026-10-11' && oe.evaluatedDays === 1 && oe.viableDays === 0 && oe.coverage === 'COMPLETE');
    const aIntentNext = { id: encodeGoalDemandIntentId('2026-10-12', ga1.id), title: 'Cardio 30', flexibility: 'FLEXIBLE', activityId: 'workout', durationMinutes: 30 };
    const ra = await previewAs(A.id, INSTANT, { intents: [aIntentNext] });
    const oa = opp(ra, aIntentNext.id);
    check('Kolkata at the same instant (already Monday 10-12 01:30): the NEXT period, 10-12..10-18, 5 viable -- no cross-user leakage', !!oa && oa.horizonStartDate === '2026-10-12' && oa.horizonEndDate === '2026-10-18' && oa.viableDays === 5);

    // ------------------------------------------------------------------
    // F: loads do not grow with candidate count
    // ------------------------------------------------------------------
    console.log('=== query counts: 1 / 3 / 10 candidates ===');
    await replaceUserAvailabilityConfiguration(F.id, workWeek);
    const gf = await goalOf(F.id, 'F goal');
    const fas: Array<{ id: string }> = [];
    for (let i = 0; i < 10; i++) fas.push(await activity(F.id, gf.id, `F activity ${i}`, 3));
    const measured: Array<[number, Counters]> = [];
    for (const n of [1, 3, 10]) {
      const counters = zero();
      const intents = fas.slice(0, n).map((ga, i) => ({ id: encodeGoalDemandIntentId(DATE, ga.id), title: `F activity ${i}`, flexibility: 'FLEXIBLE', activityId: 'workout', durationMinutes: 30 }));
      const r = await previewAs(F.id, NOW, { intents }, { enrich: true, counters });
      check(`${n} candidate(s): every candidate got opportunity facts`, intents.every((i) => !!opp(r, i.id)));
      measured.push([n, counters]);
      console.log(`     ${n} candidates -> goal discovery ${counters.goalDiscovery}, goal facts ${counters.goalFacts}, availability ${counters.availability}, blockers ${counters.blockers} (orchestrator own: plans ${counters.orchestratorPlans}, availability ${counters.orchestratorAvailability})`);
    }
    check('availability and blocker queries are exactly one each for 1, 3 and 10 candidates (no candidate-linear growth)', measured.every(([, c]) => c.availability === 1 && c.blockers === 1));
    check('Goal discovery and Rhythm-facts queries are also one each regardless of candidate count (unchanged by O4)', measured.every(([, c]) => c.goalDiscovery === 1 && c.goalFacts === 1));

    console.log('=== no candidates / no horizon: no load ===');
    const noIntents = zero();
    const rn = await previewAs(F.id, NOW, { intents: [] }, { enrich: true, counters: noIntents });
    check('an empty request is rejected before anything loads: no goal facts, no availability, no blockers', rn.httpStatus === 400 && noIntents.goalDiscovery === 0 && noIntents.availability === 0 && noIntents.blockers === 0);
    const typedOnly = zero();
    const rt = await previewAs(F.id, NOW, { intents: [{ id: 'typed-1', title: 'Write report', flexibility: 'FLEXIBLE', durationMinutes: 30 }] }, { enrich: true, counters: typedOnly });
    check('a typed-only request: no opportunity facts and NO range load (no horizon exists)', json(rt).status === 'READY' && resolved(rt, 'typed-1').dayIntent.decisionFacts === undefined && typedOnly.availability === 0 && typedOnly.blockers === 0);

    console.log('=== cleanliness ===');
    const end = await counts();
    check('still no writes after every scenario (only fixture rows exist)', end.occ === 1 && end.exec === 0 && end.avail === (await counts()).avail);

    if (!allPassed) {
      console.error('SOME OPPORTUNITY DECISION FACTS DB CHECKS FAILED');
      process.exit(1);
    }
    console.log('ALL OPPORTUNITY DECISION FACTS DB CHECKS PASSED');
  } finally {
    await cleanup();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
