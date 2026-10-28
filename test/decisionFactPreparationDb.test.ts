/**
 * Constructor Decision Intelligence -- O5 P1: live-database proof that
 * decision facts are PREPARED before the Constructor and attached unchanged
 * afterwards, through the real production chain:
 *
 *   real Goal + Rhythm persistence -> O3 recurrence facts (provider)
 *   -> real orchestrator (real availability + real persisted blockers,
 *      real timing search) -> PREPARE (generic preparer: O2 range load +
 *      O1 projection) -> constructDay (existing decision behavior)
 *   -> attach the SAME prepared facts -> sign
 * (through the real preview boundary, wired exactly as route.ts wires it).
 *
 * Also proves preparation is inert (the constructed day is identical with
 * and without it, including a real contested slot with replenishment),
 * that queries do not grow with candidate count, and that nothing is
 * written.
 *
 *   DATABASE_URL="postgresql://..." npx ts-node test/decisionFactPreparationDb.test.ts
 */
import { upsertUserByEmail, updateBirthProfile, createGoalWithActivities, addGoalActivity, beginTransaction, createPlannedActivity, replaceUserAvailabilityConfiguration, getUserById } from '../apps/web/lib/db';
import { encodeGoalDemandIntentId } from '../apps/web/lib/goalDemandIntentId';
import { createRealGoalDemandCandidatesDeps, type GoalDemandCandidatesDeps } from '../apps/web/lib/goalDemandCandidates';
import { createRealDayConstructorOrchestratorDeps, type DayConstructorOrchestratorDeps } from '../apps/web/lib/dayConstructorOrchestrator';
import { handleDayConstructorPreviewRequest } from '../apps/web/lib/dayConstructorPreviewRequest';
import { loadGoalDecisionFacts } from '../apps/web/lib/goalDecisionFactsProvider';
import { createRealOpportunityRangeDeps } from '../apps/web/lib/opportunityRangeRealDeps';
import { computeOpportunityDecisionFacts } from '../apps/web/lib/opportunityDecisionFacts';
import type { OpportunityRangeDeps } from '../apps/web/lib/opportunityRangeAdapter';
import { localDateTimeToUTC } from '../apps/web/lib/timezone';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}
const KOLKATA = 'Asia/Kolkata';
const DATE = '2026-10-07'; // Wednesday

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

interface Counters {
  goalDiscovery: number;
  goalFacts: number;
  rangeAvailability: number;
  rangePlans: number;
  orchestratorAvailability: number;
  orchestratorPlans: number;
}
const zero = (): Counters => ({ goalDiscovery: 0, goalFacts: 0, rangeAvailability: 0, rangePlans: 0, orchestratorAvailability: 0, orchestratorPlans: 0 });

async function main() {
  const mkUser = async (key: string, timezone: string) => {
    const u = await upsertUserByEmail({ email: `test-p1-${key}@example.com`, cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone });
    await sql(`UPDATE "User" SET timezone = $1 WHERE id = $2`, [timezone, u.id]);
    await updateBirthProfile(u.id, { birthDate: '1990-06-15', birthTime: '08:30', birthCityName: 'Chennai', birthLatitude: 13.0827, birthLongitude: 80.2707, birthTimezone: timezone });
    return u;
  };
  const K = await mkUser('k-contest', KOLKATA);
  const U = await mkUser('u-unconfigured', KOLKATA);
  const M = await mkUser('m-many', KOLKATA);
  const ids = [K.id, U.id, M.id];
  const cleanup = async () => {
    await sql(`UPDATE "GoalActivityOccurrence" SET "plannedActivityId" = NULL WHERE "userId" = ANY($1::text[])`, [ids]);
    await sql(`DELETE FROM "PlannedActivity" WHERE "userId" = ANY($1::text[])`, [ids]);
    await sql(`DELETE FROM "GoalActivity" WHERE "userId" = ANY($1::text[])`, [ids]);
    await sql(`DELETE FROM "Goal" WHERE "userId" = ANY($1::text[])`, [ids]);
    await sql(`DELETE FROM "UserAvailabilityPeriod" WHERE "userId" = ANY($1::text[])`, [ids]);
    await sql(`UPDATE "User" SET "availabilityConfigured" = false WHERE id = ANY($1::text[])`, [ids]);
  };
  await cleanup();

  const at = (hhmm: string) => localDateTimeToUTC(DATE, hhmm, KOLKATA);
  const NOW = at('09:00');
  const workWeek = Array.from({ length: 5 }, (_, i) => ({ weekday: i + 1, startTime: '09:00', endTime: '17:00' }));
  const goalOf = async (userId: string, title: string) => (await createGoalWithActivities({ userId, title, targetDate: null, activities: [] })).goal;
  const activity = async (userId: string, goalId: string, title: string, target: number) => {
    const ga = await addGoalActivity(userId, goalId, { title, activityId: 'workout' });
    await sql(`UPDATE "GoalActivity" SET "rhythmKind" = 'N_PER_WEEK', "rhythmTargetPerWeek" = $1 WHERE id = $2`, [target, ga!.id]);
    return ga!;
  };
  const busy = async (userId: string, from: string, to: string) => createPlannedActivity({ userId, title: `p1-busy-${from}-${to}`, plannedStartAt: at(from), plannedEndAt: at(to), durationMinutes: 60, windowType: 'NEUTRAL' });

  /** The real production preview boundary, wired as route.ts wires it; wrappers only record, never alter. */
  const previewAs = async (userId: string, body: Record<string, unknown>, opts: { prepare: boolean; counters?: Counters; log?: string[] } = { prepare: true }) => {
    const c = opts.counters;
    const log = opts.log;
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
      now: () => NOW,
      createOrchestratorDeps: (u, n) => {
        const real = createRealDayConstructorOrchestratorDeps(u, n);
        const wrapped: DayConstructorOrchestratorDeps = {
          ...real,
          loadBlockingPlans: async (b) => {
            if (c) c.orchestratorPlans += 1;
            log?.push('orchestrator:plans');
            return real.loadBlockingPlans(b);
          },
          loadAvailabilityConfiguration: async () => {
            if (c) c.orchestratorAvailability += 1;
            log?.push('orchestrator:availability');
            return real.loadAvailabilityConfiguration();
          },
          searchTiming: (request) => {
            log?.push('search');
            return real.searchTiming(request);
          },
        };
        return wrapped;
      },
      loadDecisionFacts: (u, request) => loadGoalDecisionFacts(u, request, goalDeps),
      ...(opts.prepare
        ? {
            createOpportunityRangeDeps: (u: any): OpportunityRangeDeps => {
              const real = createRealOpportunityRangeDeps(u);
              return {
                loadAvailabilityConfiguration: async () => {
                  if (c) c.rangeAvailability += 1;
                  log?.push('range:availability');
                  return real.loadAvailabilityConfiguration();
                },
                loadPlansOverlappingRange: async (bounds) => {
                  if (c) c.rangePlans += 1;
                  log?.push('range:plans');
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
  const facts = (r: { body: unknown }, id: string) => resolved(r, id)?.dayIntent?.decisionFacts;
  // Constructor-visible output: the constructed day, warnings and window. Signatures are HMACs over the items.
  const constructed = (r: { body: unknown }) => {
    const b = json(r).preview;
    return JSON.stringify({ day: { ...b.constructedDay, proposedItems: b.constructedDay.proposedItems.map(({ acceptanceToken, ...rest }: any) => rest) }, warnings: b.warnings, window: b.constructionWindow });
  };
  const counts = async () => (await sql(`SELECT (SELECT count(*)::int FROM "PlannedActivity" WHERE "userId" = ANY($1::text[])) AS plans, (SELECT count(*)::int FROM "GoalActivityOccurrence" WHERE "userId" = ANY($1::text[])) AS occ, (SELECT count(*)::int FROM "UserAvailabilityPeriod" WHERE "userId" = ANY($1::text[])) AS avail`, [ids]))[0];

  try {
    // ------------------------------------------------------------------
    // K: the P0c-style scarce slot, with REAL Goal + Rhythm candidates
    // ------------------------------------------------------------------
    await replaceUserAvailabilityConfiguration(K.id, workWeek);
    await busy(K.id, '09:00', '11:00');
    await busy(K.id, '12:00', '17:00'); // one contiguous 60-minute slot remains: 11:00-12:00
    const gHigh = await goalOf(K.id, 'High goal');
    const gLow = await goalOf(K.id, 'Low goal');
    const gaHigh = await activity(K.id, gHigh.id, 'High priority workout', 3);
    const gaLow = await activity(K.id, gLow.id, 'Low priority workout', 3);
    const idHigh = encodeGoalDemandIntentId(DATE, gaHigh.id);
    const idLow = encodeGoalDemandIntentId(DATE, gaLow.id);
    const contest = (order: 'HL' | 'LH') => {
      const high = { id: idHigh, title: 'High priority workout', flexibility: 'FLEXIBLE', activityId: 'workout', durationMinutes: 60, importance: 'HIGH' };
      const low = { id: idLow, title: 'Low priority workout', flexibility: 'FLEXIBLE', activityId: 'workout', durationMinutes: 60, importance: 'LOW' };
      return { intents: order === 'HL' ? [high, low] : [low, high] };
    };
    const before = await counts();

    console.log('=== real contested slot: facts prepared BEFORE construction, attached unchanged AFTER ===');
    const log: string[] = [];
    const on = await previewAs(K.id, contest('HL'), { prepare: true, log });
    const off = await previewAs(K.id, contest('HL'), { prepare: false });
    check('the real preview is READY with a real contest: exactly one proposed, one deferred', json(on).status === 'READY' && json(on).preview.constructedDay.proposedItems.length === 1 && json(on).preview.constructedDay.deferredItems.length === 1);
    check('P0c baseline preserved: the HIGH candidate is proposed and the LOW candidate is deferred', json(on).preview.constructedDay.proposedItems[0].intentId === idHigh && json(on).preview.constructedDay.deferredItems[0].intentId === idLow);
    const searches = log.reduce<number[]>((acc, e, i) => (e === 'search' ? [...acc, i] : acc), []);
    const rangeAt = log.reduce<number[]>((acc, e, i) => (e.startsWith('range:') ? [...acc, i] : acc), []);
    check('real sequence: both initial searches, THEN the two range loads, THEN the replenishment re-search (which only follows the first construction)', searches.length === 3 && rangeAt.length === 2 && rangeAt.every((i) => i > searches[1] && i < searches[2]));
    check('PREPARED BEFORE CONSTRUCTION, not recomputed after: exactly one availability load and one plan query for the range, both before the replenishment re-search', log.filter((e) => e === 'range:availability').length === 1 && log.filter((e) => e === 'range:plans').length === 1);
    check('the Constructor output is byte-identical with and without preparation', constructed(on) === constructed(off));
    const fHigh = facts(on, idHigh);
    const fLow = facts(on, idLow);
    check('both candidates carry real recurrence AND opportunity facts (the loser\'s facts survive in the resolved-intent metadata)', !!fHigh?.recurrence && !!fHigh?.opportunity && !!fLow?.recurrence && !!fLow?.opportunity);
    check('candidate-local supply: both report the same viable days (3: Wed, Thu, Fri) -- nothing allocated between them -- over their own 60-minute durations', fHigh.opportunity.viableDays === fLow.opportunity.viableDays && fHigh.opportunity.durationMinutes === 60 && fLow.opportunity.durationMinutes === 60 && fHigh.opportunity.durationBasis === 'RESOLVED');
    const independent = await computeOpportunityDecisionFacts(
      [
        { intentId: idHigh, durationMinutes: 60, durationBasis: 'RESOLVED', facts: { recurrence: fHigh.recurrence } },
        { intentId: idLow, durationMinutes: 60, durationBasis: 'RESOLVED', facts: { recurrence: fLow.recurrence } },
      ],
      { planningDate: DATE, timezone: KOLKATA, now: NOW },
      createRealOpportunityRangeDeps((await getUserById(K.id))!)
    );
    check('independent recomputation equals the attached opportunity facts for both candidates', JSON.stringify(independent.get(idHigh)) === JSON.stringify(fHigh.opportunity) && JSON.stringify(independent.get(idLow)) === JSON.stringify(fLow.opportunity));
    check('the real persisted blockers shaped the supply: the planning day (Wed) is KNOWN_FEASIBLE only through its single 11:00-12:00 slot, and Thu/Fri contribute the 2 after-start viable days', fHigh.opportunity.startDateState === 'KNOWN_FEASIBLE' && fHigh.opportunity.afterStartViableDays === 2 && fHigh.opportunity.viableDays === 3);

    console.log('=== input reversal and no consumption ===');
    const reversedOn = await previewAs(K.id, contest('LH'), { prepare: true });
    const reversedOff = await previewAs(K.id, contest('LH'), { prepare: false });
    check('reversed submission order: HIGH still wins, LOW still deferred, byte-identical with and without preparation', json(reversedOn).preview.constructedDay.proposedItems[0].intentId === idHigh && constructed(reversedOn) === constructed(reversedOff));
    check('the prepared facts do not depend on submission order (same facts for the same intent)', JSON.stringify(facts(reversedOn, idHigh)) === JSON.stringify(fHigh) && JSON.stringify(facts(reversedOn, idLow)) === JSON.stringify(fLow));
    check('without a range-deps wiring no opportunity facts exist at all (pre-O4 behavior)', facts(off, idHigh)?.opportunity === undefined && !!facts(off, idHigh)?.recurrence);

    console.log('=== zero writes ===');
    const after = await counts();
    check('previews wrote nothing: no plan, occurrence or availability row changed', after.plans === before.plans && after.occ === before.occ && after.avail === before.avail);

    // ------------------------------------------------------------------
    // U: unconfigured availability -> UNKNOWN survives the move
    // ------------------------------------------------------------------
    console.log('=== unconfigured availability ===');
    const gu = await goalOf(U.id, 'U goal');
    const gau = await activity(U.id, gu.id, 'U workout', 2);
    const uIntent = { id: encodeGoalDemandIntentId(DATE, gau.id), title: 'U workout', flexibility: 'FLEXIBLE', activityId: 'workout', durationMinutes: 30 };
    const ru = await previewAs(U.id, { intents: [uIntent] });
    const ou = facts(ru, uIntent.id)?.opportunity;
    check('UNCONFIGURED stays UNKNOWN: every evaluated day unknown, 0 viable, coverage UNKNOWN (not a COMPLETE zero)', json(ru).status === 'READY' && !!ou && ou.unknownDays === ou.evaluatedDays && ou.viableDays === 0 && ou.coverage === 'UNKNOWN');
    const ruOff = await previewAs(U.id, { intents: [uIntent] }, { prepare: false });
    check('and the day built is unchanged by it', constructed(ru) === constructed(ruOff));

    // ------------------------------------------------------------------
    // M: loads do not grow with candidate count (0 / 1 / 3 / 10 fact-bearing)
    // ------------------------------------------------------------------
    console.log('=== query counts: 0 / 1 / 3 / 10 fact-bearing candidates ===');
    await replaceUserAvailabilityConfiguration(M.id, workWeek);
    const gm = await goalOf(M.id, 'M goal');
    const mas: Array<{ id: string }> = [];
    for (let i = 0; i < 10; i++) mas.push(await activity(M.id, gm.id, `M activity ${i}`, 3));
    const measured: Array<[number, Counters]> = [];
    for (const n of [0, 1, 3, 10]) {
      const counters = zero();
      const goalIntents = mas.slice(0, n).map((ga, i) => ({ id: encodeGoalDemandIntentId(DATE, ga.id), title: `M activity ${i}`, flexibility: 'FLEXIBLE', activityId: 'workout', durationMinutes: 30 }));
      const intents = n === 0 ? [{ id: 'typed-1', title: 'Write report', flexibility: 'FLEXIBLE', durationMinutes: 30 }] : goalIntents;
      const r = await previewAs(M.id, { intents }, { prepare: true, counters });
      check(`${n} fact-bearing candidate(s): preview READY and ${n === 0 ? 'no candidate has opportunity facts' : 'every candidate carries opportunity facts'}`, json(r).status === 'READY' && (n === 0 ? facts(r, 'typed-1') === undefined : intents.every((i) => !!facts(r, i.id)?.opportunity)));
      measured.push([n, counters]);
      console.log(`     ${n} fact-bearing -> goal discovery ${counters.goalDiscovery}, goal facts ${counters.goalFacts}, orchestrator availability ${counters.orchestratorAvailability}, orchestrator plans ${counters.orchestratorPlans}, range availability ${counters.rangeAvailability}, range plans ${counters.rangePlans}`);
    }
    check('0 fact-bearing candidates: no range load at all (one orchestrator availability load and one orchestrator plan query only)', measured[0][1].rangeAvailability === 0 && measured[0][1].rangePlans === 0 && measured[0][1].orchestratorAvailability === 1 && measured[0][1].orchestratorPlans === 1);
    check('1, 3 and 10 candidates: exactly ONE range availability load and ONE range plan query each (no candidate-linear growth)', measured.slice(1).every(([, c]) => c.rangeAvailability === 1 && c.rangePlans === 1));
    check('the orchestrator\'s own availability and plan loads are one each for every candidate count (unchanged)', measured.every(([, c]) => c.orchestratorAvailability === 1 && c.orchestratorPlans === 1));
    check('Goal discovery and Rhythm-facts queries are one each regardless of candidate count (unchanged)', measured.every(([, c]) => c.goalDiscovery === 1 && c.goalFacts === 1));

    if (!allPassed) {
      console.error('SOME DECISION FACT PREPARATION DB CHECKS FAILED');
      process.exit(1);
    }
    console.log('ALL DECISION FACT PREPARATION DB CHECKS PASSED');
  } finally {
    await cleanup();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
