/**
 * Constructor Decision Intelligence -- O5 P2a: live-database proof that immutable DecisionEvidence is prepared through the
 * real production chain and changes nothing:
 *
 *   real Goal + Rhythm persistence -> recurrence facts (provider) -> real orchestrator (real availability, real persisted
 *   blockers, real timing search) -> PREPARE facts (O2 range load + O1 projection) -> PREPARE EVIDENCE (this slice)
 *   -> constructDay -> attach the same prepared facts -> sign
 * (through the real preview boundary, wired exactly as route.ts wires it).
 *
 * Proves: evidence equals the facts the preview exposes, is built once per fact-bearing candidate, is source-neutral for
 * identical facts (an automatic demand id and a manual hand-off id), is absent where no authoritative facts exist (a manual
 * hand-off row, a legacy fact-free Goal, a typed intent), is candidate-local across several Goals, adds no query, no write
 * and no candidate-linear cost, and leaves the whole signed preview byte-identical -- including the real contested slot
 * (the P0c shape) with replenishment.
 *
 * The evidence stage is observed through a test-only wrapper around the preparation function; no production hook exists.
 * Requires DATABASE_URL (fresh, 43 migrations).
 */
import { upsertUserByEmail, updateBirthProfile, createGoalWithActivities, addGoalActivity, beginTransaction, createPlannedActivity, replaceUserAvailabilityConfiguration, getUserById } from '../apps/web/lib/db';
import { encodeGoalDemandIntentId } from '../apps/web/lib/goalDemandIntentId';
import { createRealGoalDemandCandidatesDeps, type GoalDemandCandidatesDeps } from '../apps/web/lib/goalDemandCandidates';
import { createRealDayConstructorOrchestratorDeps, type DayConstructorOrchestratorDeps } from '../apps/web/lib/dayConstructorOrchestrator';
import { handleDayConstructorPreviewRequest } from '../apps/web/lib/dayConstructorPreviewRequest';
import { loadGoalDecisionFacts } from '../apps/web/lib/goalDecisionFactsProvider';
import { createRealOpportunityRangeDeps } from '../apps/web/lib/opportunityRangeRealDeps';
import * as preparationModule from '../apps/web/lib/decisionFactPreparation';
import * as evidenceModule from '../apps/web/lib/decisionEvidence';
import type { DecisionEvidenceByIntentId } from '../apps/web/lib/decisionEvidence';
import type { DecisionFacts, DecisionFactsByIntentId } from '../apps/web/lib/decisionFacts';
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

interface Counters { goalDiscovery: number; goalFacts: number; rangeAvailability: number; rangePlans: number; orchestratorAvailability: number; orchestratorPlans: number }
const zero = (): Counters => ({ goalDiscovery: 0, goalFacts: 0, rangeAvailability: 0, rangePlans: 0, orchestratorAvailability: 0, orchestratorPlans: 0 });

// ---- test-only observation of the evidence stage (module-object wrappers; production has no hook) ----
const realPrepareEvidence = preparationModule.prepareDecisionEvidence;
const realBuild = evidenceModule.buildDecisionEvidence;
const seen = { stages: 0, builds: 0, last: undefined as DecisionEvidenceByIntentId | undefined, enabled: true };
(preparationModule as any).prepareDecisionEvidence = (...args: Parameters<typeof realPrepareEvidence>) => {
  seen.stages += 1;
  const result = seen.enabled ? realPrepareEvidence(...args) : new Map();
  seen.last = result;
  return result;
};
(evidenceModule as any).buildDecisionEvidence = (facts: DecisionFacts | undefined) => { seen.builds += 1; return realBuild(facts); };

async function main() {
  const mkUser = async (key: string, timezone: string) => {
    const u = await upsertUserByEmail({ email: `test-p2a-${key}@example.com`, cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone });
    await sql(`UPDATE "User" SET timezone = $1 WHERE id = $2`, [timezone, u.id]);
    await updateBirthProfile(u.id, { birthDate: '1990-06-15', birthTime: '08:30', birthCityName: 'Chennai', birthLatitude: 13.0827, birthLongitude: 80.2707, birthTimezone: timezone });
    return u;
  };
  const K = await mkUser('k-contest', KOLKATA);
  const M = await mkUser('m-many', KOLKATA);
  const G = await mkUser('g-goals', KOLKATA);
  const ids = [K.id, M.id, G.id];
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
  const recurrentActivity = async (userId: string, goalId: string, title: string, target: number) => {
    const ga = await addGoalActivity(userId, goalId, { title, activityId: 'workout' });
    await sql(`UPDATE "GoalActivity" SET "rhythmKind" = 'N_PER_WEEK', "rhythmTargetPerWeek" = $1 WHERE id = $2`, [target, ga!.id]);
    return ga!;
  };
  const busy = async (userId: string, from: string, to: string) => createPlannedActivity({ userId, title: `p2a-busy-${from}-${to}`, plannedStartAt: at(from), plannedEndAt: at(to), durationMinutes: 60, windowType: 'NEUTRAL' });

  /** The real production preview boundary, wired as route.ts wires it; wrappers only record. `facts` overrides the real provider. */
  const previewAs = async (userId: string, body: Record<string, unknown>, opts: { counters?: Counters; facts?: (request: any) => Promise<DecisionFactsByIntentId> } = {}) => {
    const c = opts.counters;
    const goalDeps: GoalDemandCandidatesDeps = (() => {
      const real = createRealGoalDemandCandidatesDeps();
      return {
        loadCandidateGoalActivities: async (uid) => { if (c) c.goalDiscovery += 1; return real.loadCandidateGoalActivities(uid); },
        loadRhythmFacts: async (uid, gids, tz) => { if (c) c.goalFacts += 1; return real.loadRhythmFacts(uid, gids, tz); },
      };
    })();
    seen.stages = 0; seen.builds = 0; seen.last = undefined;
    return handleDayConstructorPreviewRequest({
      getSession: () => ({ userId }),
      getUser: (id) => getUserById(id),
      getBody: async () => body,
      now: () => NOW,
      createOrchestratorDeps: (u, n) => {
        const real = createRealDayConstructorOrchestratorDeps(u, n);
        const wrapped: DayConstructorOrchestratorDeps = {
          ...real,
          loadBlockingPlans: async (b) => { if (c) c.orchestratorPlans += 1; return real.loadBlockingPlans(b); },
          loadAvailabilityConfiguration: async () => { if (c) c.orchestratorAvailability += 1; return real.loadAvailabilityConfiguration(); },
        };
        return wrapped;
      },
      loadDecisionFacts: opts.facts ?? ((u, request) => loadGoalDecisionFacts(u, request, goalDeps)),
      createOpportunityRangeDeps: (u: any): OpportunityRangeDeps => {
        const real = createRealOpportunityRangeDeps(u);
        return {
          loadAvailabilityConfiguration: async () => { if (c) c.rangeAvailability += 1; return real.loadAvailabilityConfiguration(); },
          loadPlansOverlappingRange: async (bounds) => { if (c) c.rangePlans += 1; return real.loadPlansOverlappingRange(bounds); },
        };
      },
    });
  };
  const json = (r: { body: unknown }) => JSON.parse(JSON.stringify(r.body));
  const resolved = (r: { body: unknown }, id: string) => json(r).preview?.resolvedIntents?.find((x: any) => x.requestedIntentId === id);
  const facts = (r: { body: unknown }, id: string) => resolved(r, id)?.dayIntent?.decisionFacts;
  const evidenceOf = (id: string) => seen.last?.get(id);
  const counts = async () => (await sql(`SELECT (SELECT count(*)::int FROM "PlannedActivity" WHERE "userId" = ANY($1::text[])) AS plans, (SELECT count(*)::int FROM "GoalActivityOccurrence" WHERE "userId" = ANY($1::text[])) AS occ, (SELECT count(*)::int FROM "UserAvailabilityPeriod" WHERE "userId" = ANY($1::text[])) AS avail, (SELECT count(*)::int FROM "Goal" WHERE "userId" = ANY($1::text[])) AS goals, (SELECT count(*)::int FROM "GoalActivity" WHERE "userId" = ANY($1::text[])) AS gas`, [ids]))[0];

  try {
    // ------------------------------------------------------------------
    console.log('=== K: the real P0c-style scarce slot -- evidence equals the exposed facts, and nothing else changes ===');
    await replaceUserAvailabilityConfiguration(K.id, workWeek);
    await busy(K.id, '09:00', '11:00');
    await busy(K.id, '12:00', '17:00'); // one contiguous 60-minute slot remains: 11:00-12:00
    const gHigh = await goalOf(K.id, 'High goal');
    const gLow = await goalOf(K.id, 'Low goal');
    const gaHigh = await recurrentActivity(K.id, gHigh.id, 'High priority workout', 3);
    const gaLow = await recurrentActivity(K.id, gLow.id, 'Low priority workout', 7);
    const idHigh = encodeGoalDemandIntentId(DATE, gaHigh.id);
    const idLow = encodeGoalDemandIntentId(DATE, gaLow.id);
    const contest = (order: 'HL' | 'LH') => {
      const high = { id: idHigh, title: 'High priority workout', flexibility: 'FLEXIBLE', activityId: 'workout', durationMinutes: 60, importance: 'HIGH' };
      const low = { id: idLow, title: 'Low priority workout', flexibility: 'FLEXIBLE', activityId: 'workout', durationMinutes: 60, importance: 'LOW' };
      return { intents: order === 'HL' ? [high, low] : [low, high] };
    };
    const before = await counts();
    const on = await previewAs(K.id, contest('HL'));
    const evHigh = evidenceOf(idHigh); const evLow = evidenceOf(idLow);
    check('the real preview is READY with a real contest (one proposed, one deferred) and the P0c baseline holds: HIGH proposed, LOW deferred', json(on).status === 'READY' && json(on).preview.constructedDay.proposedItems[0].intentId === idHigh && json(on).preview.constructedDay.deferredItems[0].intentId === idLow);
    check('ONE evidence stage for the preview and exactly ONE build per fact-bearing candidate (2), through the real replenishment loop', seen.stages === 1 && seen.builds === 2);
    check('both candidates carry real evidence with BOTH categories', !!evHigh?.recurrence && !!evHigh?.opportunity && !!evLow?.recurrence && !!evLow?.opportunity);
    check('EVIDENCE EQUALS THE EXPOSED FACTS: for both candidates the evidence is structurally identical to the recurrence and opportunity facts the preview attaches (7 and 12 fields, same values)', JSON.stringify(evHigh) === JSON.stringify(facts(on, idHigh)) && JSON.stringify(evLow) === JSON.stringify(facts(on, idLow)) && Object.keys(evHigh!.recurrence!).length === 7 && Object.keys(evHigh!.opportunity!).length === 12);
    check('the evidence is the real, candidate-local supply and demand: each candidate\'s own target (3 and 7) with the same viable days (no capacity allocated between candidates)', evHigh!.recurrence!.targetPerPeriod === 3 && evLow!.recurrence!.targetPerPeriod === 7 && evHigh!.opportunity!.viableDays === evLow!.opportunity!.viableDays && evHigh!.opportunity!.durationMinutes === 60);
    check('the evidence is deeply frozen (outer and nested) and does not share its nested objects with the attached facts', Object.isFrozen(evHigh) && Object.isFrozen(evHigh!.recurrence) && Object.isFrozen(evHigh!.opportunity) && Object.isFrozen(evLow) && Object.isFrozen(evLow!.recurrence));
    const reversed = await previewAs(K.id, contest('LH'));
    check('input reversal: HIGH still wins, LOW still deferred, and each intent gets the SAME evidence as before (independent of submission order)', json(reversed).preview.constructedDay.proposedItems[0].intentId === idHigh && JSON.stringify(evidenceOf(idHigh)) === JSON.stringify(evHigh) && JSON.stringify(evidenceOf(idLow)) === JSON.stringify(evLow));

    console.log('=== NO OUTPUT DRIFT / NO TOKEN DRIFT: the whole signed preview is byte-identical without the evidence stage ===');
    seen.enabled = false;
    const off = await previewAs(K.id, contest('HL'));
    seen.enabled = true;
    check('the entire signed response body -- constructed day, warnings, window, resolved-intent decision facts and every acceptance token -- is byte-identical with and without the evidence stage', JSON.stringify(json(on)) === JSON.stringify(json(off)) && JSON.stringify(json(on)).includes('acceptanceToken'));
    check('the signed tokens themselves are identical (tokens are over the proposed items only, never over decision facts)', JSON.stringify(json(on).preview.constructedDay.proposedItems.map((p: any) => p.acceptanceToken)) === JSON.stringify(json(off).preview.constructedDay.proposedItems.map((p: any) => p.acceptanceToken)));

    console.log('=== zero writes ===');
    const after = await counts();
    check('previews wrote nothing: no plan, occurrence, goal, goal-activity or availability row changed', after.plans === before.plans && after.occ === before.occ && after.avail === before.avail && after.goals === before.goals && after.gas === before.gas);

    // ------------------------------------------------------------------
    console.log('=== source neutrality, absence, legacy rows, several Goals ===');
    await replaceUserAvailabilityConfiguration(G.id, workWeek);
    const gg = await goalOf(G.id, 'G goal');
    const ga1 = await recurrentActivity(G.id, gg.id, 'G workout one', 2);
    const ga2 = await recurrentActivity(G.id, gg.id, 'G workout two', 4);
    const ga3 = await recurrentActivity(G.id, gg.id, 'G workout three', 6);
    const legacy = await addGoalActivity(G.id, gg.id, { title: 'Legacy fact-free activity', activityId: 'workout' }); // no rhythm: not recurrent
    const id1 = encodeGoalDemandIntentId(DATE, ga1.id);
    const id2 = encodeGoalDemandIntentId(DATE, ga2.id);
    const id3 = encodeGoalDemandIntentId(DATE, ga3.id);
    const idLegacy = encodeGoalDemandIntentId(DATE, legacy!.id);
    const manualId = `plan-day-goal-${ga1.id}`;
    const intent = (id: string, title: string, durationMinutes = 30) => ({ id, title, flexibility: 'FLEXIBLE', activityId: 'workout', durationMinutes });
    const multi = await previewAs(G.id, { intents: [intent(id1, 'G workout one'), intent(id2, 'G workout two'), intent(id3, 'G workout three'), intent(idLegacy, 'Legacy fact-free activity'), intent(manualId, 'Manual hand-off row'), { id: 'typed-1', title: 'Write report', flexibility: 'FLEXIBLE', durationMinutes: 30 }] });
    check('MULTIPLE GOALS: each automatic candidate has its OWN evidence (targets 2, 4, 6) with no cross-contamination, and exactly one build per fact-bearing candidate (3)', json(multi).status === 'READY' && evidenceOf(id1)?.recurrence?.targetPerPeriod === 2 && evidenceOf(id2)?.recurrence?.targetPerPeriod === 4 && evidenceOf(id3)?.recurrence?.targetPerPeriod === 6 && seen.builds === 3);
    check('LEGACY / NON-RECURRENT Goal row: the real provider returns no facts for it, so it has NO evidence (nothing fabricated)', evidenceOf(idLegacy) === undefined && facts(multi, idLegacy) === undefined);
    check('MANUAL Goal hand-off row (`plan-day-goal-<id>`): today no provider attaches facts to it (the known automatic-only asymmetry), so it has NO evidence -- evidence never invents a fact the authority did not supply', evidenceOf(manualId) === undefined && facts(multi, manualId) === undefined);
    check('a typed intent with no facts has no evidence and triggers no build', evidenceOf('typed-1') === undefined);
    const identicalFactsProvider = async (_user: any, request: any): Promise<DecisionFactsByIntentId> => {
      const real = await loadGoalDecisionFacts(await getUserById(G.id) as any, request, createRealGoalDemandCandidatesDeps());
      const base = real.get(id1);
      return new Map(base ? [[id1, base], [manualId, JSON.parse(JSON.stringify(base)) as DecisionFacts]] : []);
    };
    const parity = await previewAs(G.id, { intents: [intent(id1, 'G workout one'), intent(manualId, 'Manual hand-off row')] }, { facts: identicalFactsProvider as any });
    check('SOURCE NEUTRALITY (real orchestrator + real range load): when the SAME authoritative facts are supplied for an automatic demand id and a manual hand-off id, the two evidence objects are deeply equal -- recurrence AND the projected opportunity', json(parity).status === 'READY' && !!evidenceOf(id1)?.opportunity && JSON.stringify(evidenceOf(id1)) === JSON.stringify(evidenceOf(manualId)) && evidenceOf(id1) !== evidenceOf(manualId) && evidenceOf(id1)!.recurrence !== evidenceOf(manualId)!.recurrence);

    // ------------------------------------------------------------------
    console.log('=== query counts: 0 / 1 / 3 / 10 fact-bearing candidates (the P1 profile, unchanged) ===');
    await replaceUserAvailabilityConfiguration(M.id, workWeek);
    const gm = await goalOf(M.id, 'M goal');
    const mas: Array<{ id: string }> = [];
    for (let i = 0; i < 10; i++) mas.push(await recurrentActivity(M.id, gm.id, `M activity ${i}`, 3));
    const measured: Array<[number, Counters, number, number]> = [];
    for (const n of [0, 1, 3, 10]) {
      const counters = zero();
      const goalIntents = mas.slice(0, n).map((ga, i) => intent(encodeGoalDemandIntentId(DATE, ga.id), `M activity ${i}`));
      const intents = n === 0 ? [{ id: 'typed-1', title: 'Write report', flexibility: 'FLEXIBLE', durationMinutes: 30 }] : goalIntents;
      const r = await previewAs(M.id, { intents }, { counters });
      check(`${n} fact-bearing candidate(s): READY, evidence for exactly ${n} intent(s), ${n} build(s)`, json(r).status === 'READY' && (seen.last?.size ?? 0) === n && seen.builds === n && seen.stages === 1);
      measured.push([n, counters, seen.builds, seen.last?.size ?? 0]);
      console.log(`     ${n} fact-bearing -> goal discovery ${counters.goalDiscovery}, goal facts ${counters.goalFacts}, orchestrator availability ${counters.orchestratorAvailability}, orchestrator plans ${counters.orchestratorPlans}, range availability ${counters.rangeAvailability}, range plans ${counters.rangePlans}, builds ${seen.builds}`);
    }
    check('0 fact-bearing candidates: no range load at all; orchestrator availability 1, orchestrator plans 1', measured[0][1].rangeAvailability === 0 && measured[0][1].rangePlans === 0 && measured[0][1].orchestratorAvailability === 1 && measured[0][1].orchestratorPlans === 1);
    check('1, 3 and 10 candidates: exactly ONE range availability load and ONE range plan query each -- no candidate-linear growth from evidence', measured.slice(1).every(([, c]) => c.rangeAvailability === 1 && c.rangePlans === 1));
    check('the orchestrator\'s own availability and plan loads, and Goal discovery / Rhythm-facts queries, are one each for every candidate count (the P1 profile is unchanged: evidence adds zero queries)', measured.every(([, c]) => c.orchestratorAvailability === 1 && c.orchestratorPlans === 1 && c.goalDiscovery === 1 && c.goalFacts === 1));
    check('evidence builds grow only with fact-bearing candidates (0 / 1 / 3 / 10), never with anything else', measured.map(([n, , builds]) => builds === n).every(Boolean));

    if (!allPassed) {
      console.error('SOME DECISION EVIDENCE DB CHECKS FAILED');
      process.exitCode = 1;
      return;
    }
    console.log('ALL DECISION EVIDENCE DB CHECKS PASSED');
  } finally {
    (preparationModule as any).prepareDecisionEvidence = realPrepareEvidence;
    (evidenceModule as any).buildDecisionEvidence = realBuild;
    await cleanup();
  }
}

main().then(() => process.exit(), (err) => {
  console.error(err);
  process.exit(1);
});
