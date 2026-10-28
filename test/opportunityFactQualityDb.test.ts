/**
 * O5 P0b -- opportunity fact quality, live-database proof.
 *
 * REAL chain, no mocked projection result:
 *   real user + Goal + recurring GoalActivity + Rhythm + availability +
 *   persisted blocking plans
 *   -> O3 recurrence facts + period bounds (goalDecisionFactsProvider)
 *   -> O2 range adapter over the user's real data
 *   -> O1 projection (one pass) -> O4 transport
 *   -> DecisionFacts.opportunity, through the real preview boundary wired
 *      as route.ts wires it.
 *
 * Proves the first-day / after-first-day facts through real data, the
 * manual/automatic parity of the NEW facts (P0a), unchanged constructed
 * days, unchanged query counts, fail-open behavior, and zero writes.
 *
 *   DATABASE_URL="postgresql://..." npx ts-node test/opportunityFactQualityDb.test.ts
 */
import { upsertUserByEmail, updateBirthProfile, createGoalWithActivities, addGoalActivity, beginTransaction, createPlannedActivity, replaceUserAvailabilityConfiguration, getUserById, listGoalActivitiesWithLinkedPlanStatus, loadGoalActivityRhythmFacts } from '../apps/web/lib/db';
import { createRealDayConstructorOrchestratorDeps } from '../apps/web/lib/dayConstructorOrchestrator';
import { handleDayConstructorPreviewRequest } from '../apps/web/lib/dayConstructorPreviewRequest';
import { loadGoalDecisionFacts } from '../apps/web/lib/goalDecisionFactsProvider';
import { createRealOpportunityRangeDeps } from '../apps/web/lib/opportunityRangeRealDeps';
import { createRealGoalDemandCandidatesDeps, loadEligibleGoalDemand } from '../apps/web/lib/goalDemandCandidates';
import { resolveGoalActivityHandoff, resolveAutomaticGoalDemand, markCanonicalGoalDemandHandoff } from '../apps/web/lib/planDayBootstrap';
import { createIntentRowFromGoalHandoffItem, createIntentRowFromAutoGoalSuggestion, buildRequestedIntentsForSubmission } from '../apps/web/lib/planDayEntry';
import { encodeGoalDemandIntentId } from '../apps/web/lib/goalDemandIntentId';
import type { OpportunityRangeDeps } from '../apps/web/lib/opportunityRangeAdapter';
import { localDateTimeToUTC } from '../apps/web/lib/timezone';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}
const KOLKATA = 'Asia/Kolkata';
const NEW_KEYS = ['startDateState', 'afterStartEvaluatedDays', 'afterStartViableDays', 'afterStartUnknownDays'];

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

async function main() {
  const mk = async (key: string, tz: string) => {
    const u = await upsertUserByEmail({ email: `test-p0b-${key}@example.com`, cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: tz });
    await sql(`UPDATE "User" SET timezone = $1 WHERE id = $2`, [tz, u.id]);
    await updateBirthProfile(u.id, { birthDate: '1990-06-15', birthTime: '08:30', birthCityName: 'Chennai', birthLatitude: 13.0827, birthLongitude: 80.2707, birthTimezone: tz });
    return u;
  };
  const A = await mk('a', KOLKATA);
  const B = await mk('b-unconfigured', KOLKATA);
  const D = await mk('d-dst', 'America/New_York');
  const E = await mk('e-la', 'America/Los_Angeles');
  const ids = [A.id, B.id, D.id, E.id];
  const cleanup = async () => {
    await sql(`UPDATE "GoalActivityOccurrence" SET "plannedActivityId" = NULL WHERE "userId" = ANY($1::text[])`, [ids]);
    await sql(`DELETE FROM "PlannedActivity" WHERE "userId" = ANY($1::text[])`, [ids]);
    await sql(`DELETE FROM "GoalActivity" WHERE "userId" = ANY($1::text[])`, [ids]);
    await sql(`DELETE FROM "Goal" WHERE "userId" = ANY($1::text[])`, [ids]);
    await sql(`DELETE FROM "UserAvailabilityPeriod" WHERE "userId" = ANY($1::text[])`, [ids]);
    await sql(`UPDATE "User" SET "availabilityConfigured" = false WHERE id = ANY($1::text[])`, [ids]);
  };
  await cleanup();

  const workWeek = [1, 2, 3, 4, 5].map((weekday) => ({ weekday, startTime: '09:00', endTime: '17:00' }));
  const goalOf = async (userId: string, title: string) => (await createGoalWithActivities({ userId, title, targetDate: null, activities: [] })).goal;
  const activity = async (userId: string, goalId: string, title: string, target = 3) => {
    const ga = (await addGoalActivity(userId, goalId, { title, activityId: 'workout' }))!;
    await sql(`UPDATE "GoalActivity" SET "rhythmKind" = 'N_PER_WEEK', "rhythmTargetPerWeek" = $1 WHERE id = $2`, [target, ga.id]);
    return ga;
  };
  const addPlan = async (userId: string, start: Date, end: Date) => createPlannedActivity({ userId, title: `p0b-blocker-${Math.random()}`, plannedStartAt: start, plannedEndAt: end, durationMinutes: Math.round((end.getTime() - start.getTime()) / 60000), windowType: 'NEUTRAL' });
  const at = (date: string, hhmm: string, tz: string) => localDateTimeToUTC(date, hhmm, tz);

  interface Opts {
    enrich?: boolean;
    failO2?: boolean;
    counters?: { availability: number; blockers: number };
  }
  const previewAs = async (userId: string, now: Date, body: Record<string, unknown>, opts: Opts = {}) => {
    const c = opts.counters;
    const result = await handleDayConstructorPreviewRequest({
      getSession: () => ({ userId }),
      getUser: (id) => getUserById(id),
      getBody: async () => body,
      now: () => now,
      createOrchestratorDeps: createRealDayConstructorOrchestratorDeps,
      loadDecisionFacts: (u, request) => loadGoalDecisionFacts(u, request),
      ...(opts.enrich === false
        ? {}
        : {
            createOpportunityRangeDeps: (u: any): OpportunityRangeDeps => {
              const real = createRealOpportunityRangeDeps(u);
              return {
                loadAvailabilityConfiguration: async () => {
                  if (c) c.availability += 1;
                  if (opts.failO2) throw new Error('availability down');
                  return real.loadAvailabilityConfiguration();
                },
                loadPlansOverlappingRange: async (bounds) => {
                  if (c) c.blockers += 1;
                  return real.loadPlansOverlappingRange(bounds);
                },
              };
            },
          }),
    });
    return JSON.parse(JSON.stringify(result.body));
  };
  const evening = (date: string, tz: string) => ({ constructionWindowSource: 'EXPLICIT_RANGE', explicitStart: at(date, '18:00', tz).toISOString(), explicitEnd: at(date, '22:00', tz).toISOString() });
  const intentFor = (date: string, ga: { id: string }, title = 'Cardio') => ({ id: encodeGoalDemandIntentId(date, ga.id), title, flexibility: 'FLEXIBLE', activityId: 'workout', durationMinutes: 30 });
  const opp = (preview: any, id: string) => preview.preview?.resolvedIntents?.find((r: any) => r.requestedIntentId === id)?.dayIntent?.decisionFacts?.opportunity;
  const partition = (o: any) => o.evaluatedDays === 1 + o.afterStartEvaluatedDays && o.viableDays === (o.startDateState === 'KNOWN_FEASIBLE' ? 1 : 0) + o.afterStartViableDays && o.unknownDays === (o.startDateState === 'UNKNOWN' ? 1 : 0) + o.afterStartUnknownDays;
  const constructorView = (preview: any) => {
    const copy = JSON.parse(JSON.stringify(preview));
    for (const r of copy.preview.resolvedIntents) if (r.dayIntent.decisionFacts) delete r.dayIntent.decisionFacts.opportunity;
    return JSON.stringify(copy);
  };
  const rowCount = async () => (await sql(`SELECT (SELECT count(*)::int FROM "PlannedActivity" WHERE "userId" = ANY($1::text[])) AS plans, (SELECT count(*)::int FROM "GoalActivityOccurrence" WHERE "userId" = ANY($1::text[])) AS occ, (SELECT count(*)::int FROM "UserAvailabilityPeriod" WHERE "userId" = ANY($1::text[])) AS avail`, [ids]))[0];

  try {
    await replaceUserAvailabilityConfiguration(A.id, workWeek);
    const g = await goalOf(A.id, 'Goal');
    const R = await activity(A.id, g.id, 'Cardio');
    const WED = '2026-10-07';
    const NOW_WED = at(WED, '09:00', KOLKATA);

    console.log('=== baseline: planning Wednesday, configured Mon-Fri ===');
    const base = await previewAs(A.id, NOW_WED, { ...evening(WED, KOLKATA), intents: [intentFor(WED, R)] });
    const o1 = opp(base, intentFor(WED, R).id);
    check('preview READY and carries all four new facts, explicitly', base.status === 'READY' && !!o1 && NEW_KEYS.every((k) => o1[k] !== undefined));
    check('first day (Wed) KNOWN_FEASIBLE; 4 later days (Thu, Fri, Sat, Sun) of which 2 viable, 0 unknown', o1.startDateState === 'KNOWN_FEASIBLE' && o1.afterStartEvaluatedDays === 4 && o1.afterStartViableDays === 2 && o1.afterStartUnknownDays === 0);
    check('the ORIGINAL facts are unchanged in meaning: 5 evaluated, 3 viable, 0 unknown, COMPLETE, horizon 10-07..10-11', o1.horizonStartDate === WED && o1.horizonEndDate === '2026-10-11' && o1.evaluatedDays === 5 && o1.viableDays === 3 && o1.unknownDays === 0 && o1.coverage === 'COMPLETE' && o1.durationMinutes === 30 && o1.durationBasis === 'RESOLVED');
    check('the new facts partition the totals exactly (real data)', partition(o1));
    const baseOff = await previewAs(A.id, NOW_WED, { ...evening(WED, KOLKATA), intents: [intentFor(WED, R)] }, { enrich: false });
    check('constructed day byte-identical with and without the enrichment', constructorView(base) === constructorView(baseOff) && JSON.stringify(base.preview.constructedDay) === JSON.stringify(baseOff.preview.constructedDay));

    console.log('=== blockers: today only vs a future day only ===');
    const todayBlock = await addPlan(A.id, at(WED, '09:00', KOLKATA), at(WED, '17:00', KOLKATA));
    const pvToday = await previewAs(A.id, NOW_WED, { ...evening(WED, KOLKATA), intents: [intentFor(WED, R)] });
    const ot = opp(pvToday, intentFor(WED, R).id);
    check('blocking TODAY only: the first day turns KNOWN_INFEASIBLE; later counts are unchanged (2 viable of 4)', ot.startDateState === 'KNOWN_INFEASIBLE' && ot.afterStartViableDays === 2 && ot.afterStartEvaluatedDays === 4 && ot.viableDays === 2 && partition(ot));
    await sql(`DELETE FROM "PlannedActivity" WHERE id = $1`, [todayBlock.id]);
    const thuBlock = await addPlan(A.id, at('2026-10-08', '09:00', KOLKATA), at('2026-10-08', '17:00', KOLKATA));
    const pvThu = await previewAs(A.id, NOW_WED, { ...evening(WED, KOLKATA), intents: [intentFor(WED, R)] });
    const oth = opp(pvThu, intentFor(WED, R).id);
    check('blocking THURSDAY only: the first day stays KNOWN_FEASIBLE; later viable drops to 1; evaluated unchanged', oth.startDateState === 'KNOWN_FEASIBLE' && oth.afterStartViableDays === 1 && oth.afterStartEvaluatedDays === 4 && partition(oth));
    await sql(`DELETE FROM "PlannedActivity" WHERE id = $1`, [thuBlock.id]);

    console.log('=== horizon shapes: Monday (six later days), Sunday (period end, one-day horizon) ===');
    const MON = '2026-10-05';
    const pvMon = await previewAs(A.id, at(MON, '09:00', KOLKATA), { ...evening(MON, KOLKATA), intents: [intentFor(MON, R)] });
    const om = opp(pvMon, intentFor(MON, R).id);
    check('Monday: horizon Mon..Sun gives SIX later days; first day feasible; 4 later viable', om.afterStartEvaluatedDays === 6 && om.startDateState === 'KNOWN_FEASIBLE' && om.afterStartViableDays === 4 && om.evaluatedDays === 7 && partition(om));
    const SUN = '2026-10-11';
    const pvSun = await previewAs(A.id, at(SUN, '09:00', KOLKATA), { ...evening(SUN, KOLKATA), intents: [intentFor(SUN, R)] });
    const os = opp(pvSun, intentFor(SUN, R).id);
    check('Sunday (period end): ONE-day horizon; first day KNOWN_INFEASIBLE (configured, no Sunday window); later counts all zero -- a known empty set, never unknown', os.horizonStartDate === SUN && os.horizonEndDate === SUN && os.evaluatedDays === 1 && os.startDateState === 'KNOWN_INFEASIBLE' && os.afterStartEvaluatedDays === 0 && os.afterStartViableDays === 0 && os.afterStartUnknownDays === 0 && os.coverage === 'COMPLETE');

    console.log('=== unconfigured availability: UNKNOWN, never zero ===');
    const gB = await goalOf(B.id, 'B goal');
    const RB = await activity(B.id, gB.id, 'B cardio');
    const pvB = await previewAs(B.id, NOW_WED, { intents: [intentFor(WED, RB, 'B cardio')] });
    const ob = opp(pvB, intentFor(WED, RB).id);
    check('UNCONFIGURED: first day UNKNOWN and every later day UNKNOWN (no Constructor fallback): 4 later, 0 viable, 4 unknown; coverage UNKNOWN', pvB.status === 'READY' && ob.startDateState === 'UNKNOWN' && ob.afterStartEvaluatedDays === 4 && ob.afterStartViableDays === 0 && ob.afterStartUnknownDays === 4 && ob.coverage === 'UNKNOWN' && partition(ob));

    console.log('=== DST: O2 uncertainty propagates (America/New_York, fall back Sunday 2026-11-01) ===');
    await replaceUserAvailabilityConfiguration(D.id, [...workWeek, { weekday: 0, startTime: '01:30', endTime: '03:00' }]);
    const gD = await goalOf(D.id, 'D goal');
    const RD = await activity(D.id, gD.id, 'D cardio');
    const NYMON = '2026-10-26';
    const pvDm = await previewAs(D.id, at(NYMON, '09:00', 'America/New_York'), { ...evening(NYMON, 'America/New_York'), intents: [intentFor(NYMON, RD, 'D cardio')] });
    const od = opp(pvDm, intentFor(NYMON, RD).id);
    check('the ambiguous Sunday is a LATER UNKNOWN day: first day feasible; 6 later, 4 viable, 1 unknown; coverage PARTIAL', od.startDateState === 'KNOWN_FEASIBLE' && od.afterStartEvaluatedDays === 6 && od.afterStartViableDays === 4 && od.afterStartUnknownDays === 1 && od.coverage === 'PARTIAL' && partition(od));
    const NYSUN = '2026-11-01';
    const pvDs = await previewAs(D.id, at(NYSUN, '00:30', 'America/New_York'), { ...evening(NYSUN, 'America/New_York'), intents: [intentFor(NYSUN, RD, 'D cardio')] });
    const ods = opp(pvDs, intentFor(NYSUN, RD).id);
    check('the ambiguous Sunday as the FIRST day of a one-day horizon: startDateState UNKNOWN, later counts zero', ods.startDateState === 'UNKNOWN' && ods.afterStartEvaluatedDays === 0 && ods.unknownDays === 1 && ods.coverage === 'UNKNOWN');

    console.log('=== timezones at the same instant (2026-10-11T20:00Z) ===');
    await replaceUserAvailabilityConfiguration(E.id, workWeek);
    const gE = await goalOf(E.id, 'E goal');
    const RE = await activity(E.id, gE.id, 'E cardio');
    const INSTANT = new Date('2026-10-11T20:00:00Z');
    const pvE = await previewAs(E.id, INSTANT, { ...evening('2026-10-11', 'America/Los_Angeles'), intents: [intentFor('2026-10-11', RE, 'E cardio')] });
    const oe = opp(pvE, intentFor('2026-10-11', RE).id);
    const pvA2 = await previewAs(A.id, INSTANT, { ...evening('2026-10-12', KOLKATA), intents: [intentFor('2026-10-12', R)] });
    const oa2 = opp(pvA2, intentFor('2026-10-12', R).id);
    check('Los Angeles (still local Sunday): one-day horizon, no later days', oe.horizonStartDate === '2026-10-11' && oe.afterStartEvaluatedDays === 0 && oe.startDateState === 'KNOWN_INFEASIBLE');
    check('Kolkata at the same instant (already Monday 10-12): the next period, six later days', oa2.horizonStartDate === '2026-10-12' && oa2.afterStartEvaluatedDays === 6 && oa2.afterStartViableDays === 4);

    console.log('=== manual / automatic parity of the NEW facts (P0a canonical identity) ===');
    const realBoot = { getSessionToken: () => 'tok', verifySession: () => ({ userId: A.id }) };
    const handoff = await resolveGoalActivityHandoff({ ...realBoot, listGoalActivities: (uid, gid) => listGoalActivitiesWithLinkedPlanStatus(uid, gid), loadGoalActivityRhythmFacts: (uid, gaId, tz) => loadGoalActivityRhythmFacts(uid, gaId, tz) }, g.id, R.id, WED, KOLKATA);
    const autoDemand = await resolveAutomaticGoalDemand({ ...realBoot, ...createRealGoalDemandCandidatesDeps() }, WED, KOLKATA, handoff.map((h) => h.id));
    const marked = markCanonicalGoalDemandHandoff(handoff, autoDemand.status === 'OK' ? autoDemand.manualCanonicalGoalActivityIds : []);
    const manualRows = marked.map((m) => createIntentRowFromGoalHandoffItem(m, encodeGoalDemandIntentId(WED, m.id)));
    const elig = await loadEligibleGoalDemand(createRealGoalDemandCandidatesDeps(), A.id, WED, KOLKATA);
    const cand = elig.status === 'OK' ? elig.candidates.find((c) => c.goalActivityId === R.id)! : undefined;
    const autoRows = [createIntentRowFromAutoGoalSuggestion({ title: cand!.title, activityId: cand!.activityId, goalActivityId: cand!.goalActivityId }, encodeGoalDemandIntentId(WED, R.id))];
    const bodyOf = (rows: any[]) => ({ ...evening(WED, KOLKATA), intents: buildRequestedIntentsForSubmission(rows, KOLKATA, WED) });
    const pvAuto = await previewAs(A.id, NOW_WED, bodyOf(autoRows));
    const pvManual = await previewAs(A.id, NOW_WED, bodyOf(manualRows));
    const cid = encodeGoalDemandIntentId(WED, R.id);
    check('manual and automatic canonical entry receive IDENTICAL opportunity facts including all four new fields', !!opp(pvAuto, cid) && JSON.stringify(opp(pvAuto, cid)) === JSON.stringify(opp(pvManual, cid)) && NEW_KEYS.every((k) => opp(pvManual, cid)[k] !== undefined));
    const legacy = await previewAs(A.id, NOW_WED, { ...evening(WED, KOLKATA), intents: [{ id: `plan-day-goal-${R.id}`, title: 'Cardio', flexibility: 'FLEXIBLE', activityId: 'workout', durationMinutes: 30 }] });
    check('a LEGACY manual row stays fact-free (P0b does not special-case it)', legacy.preview.resolvedIntents[0].dayIntent.decisionFacts === undefined);

    console.log('=== queries, fail-open, writes ===');
    const gM = await goalOf(A.id, 'Many');
    const many = [await activity(A.id, gM.id, 'M1'), await activity(A.id, gM.id, 'M2'), await activity(A.id, gM.id, 'M3')];
    const counters = { availability: 0, blockers: 0 };
    const pvMany = await previewAs(A.id, NOW_WED, { ...evening(WED, KOLKATA), intents: many.map((m, i) => intentFor(WED, m, `M${i + 1}`)) }, { counters });
    check('three candidates: every one carries the new facts, with exactly ONE availability load and ONE plan query (unchanged by P0b)', many.every((m) => !!opp(pvMany, intentFor(WED, m).id)) && counters.availability === 1 && counters.blockers === 1);
    const originalWarn = console.warn;
    console.warn = () => {};
    const pvFail = await previewAs(A.id, NOW_WED, { ...evening(WED, KOLKATA), intents: [intentFor(WED, R)] }, { failO2: true });
    console.warn = originalWarn;
    check('O2 failure keeps the existing fail-open behavior: preview READY, no opportunity facts, nothing fabricated', pvFail.status === 'READY' && opp(pvFail, intentFor(WED, R).id) === undefined && constructorView(pvFail) === constructorView(baseOff));
    const before = await rowCount();
    await previewAs(A.id, NOW_WED, { ...evening(WED, KOLKATA), intents: [intentFor(WED, R)] });
    const after = await rowCount();
    check('previews performed zero writes (no plan, occurrence or availability row changed)', JSON.stringify(before) === JSON.stringify(after));

    if (!allPassed) {
      console.error('SOME OPPORTUNITY FACT QUALITY DB CHECKS FAILED');
      process.exit(1);
    }
    console.log('ALL OPPORTUNITY FACT QUALITY DB CHECKS PASSED');
  } finally {
    await cleanup();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
