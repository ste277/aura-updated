/**
 * Constructor Decision Intelligence -- O5 P2b: live-database proof that the pure pressure deriver, fed the immutable
 * DecisionEvidence the REAL production chain prepares, classifies correctly and source-neutrally:
 *
 *   real Goal + Rhythm persistence + availability -> real manual hand-off (P0a marking + row factory) and real automatic
 *   inclusion -> real preview boundary (provider -> orchestrator -> prepare facts -> prepare evidence) -> pressure
 *
 * Pressure is derived in this test only; nothing in production calls it (P2b is unwired), so the preview itself is
 * unchanged. Proves: canonical manual and automatic entry reach the SAME evidence and the SAME pressure; a Friday with
 * no later feasible day is LAST_KNOWN_OPPORTUNITY while a Wednesday with later viable days is NONE; the legacy
 * non-canonical hand-off row and a FIXED candidate are NONE; the real producers' evidence satisfies every invariant
 * the deriver checks; and deriving adds no query and no write.
 * Requires DATABASE_URL (fresh, 43 migrations).
 */
import { upsertUserByEmail, updateBirthProfile, createGoalWithActivities, addGoalActivity, beginTransaction, replaceUserAvailabilityConfiguration, getUserById, listGoalActivitiesWithLinkedPlanStatus, loadGoalActivityRhythmFacts } from '../apps/web/lib/db';
import { createRealDayConstructorOrchestratorDeps } from '../apps/web/lib/dayConstructorOrchestrator';
import { handleDayConstructorPreviewRequest } from '../apps/web/lib/dayConstructorPreviewRequest';
import { loadGoalDecisionFacts } from '../apps/web/lib/goalDecisionFactsProvider';
import { createRealOpportunityRangeDeps } from '../apps/web/lib/opportunityRangeRealDeps';
import { createRealGoalDemandCandidatesDeps, loadEligibleGoalDemand } from '../apps/web/lib/goalDemandCandidates';
import { resolveGoalActivityHandoff, resolveAutomaticGoalDemand, markCanonicalGoalDemandHandoff } from '../apps/web/lib/planDayBootstrap';
import { createIntentRowFromGoalHandoffItem, createIntentRowFromAutoGoalSuggestion, buildRequestedIntentsForSubmission, type PlanDayIntentRow } from '../apps/web/lib/planDayEntry';
import { encodeGoalDemandIntentId } from '../apps/web/lib/goalDemandIntentId';
import * as preparationModule from '../apps/web/lib/decisionFactPreparation';
import { deriveDecisionPressure } from '../apps/web/lib/decisionPressure';
import type { DecisionEvidenceByIntentId } from '../apps/web/lib/decisionEvidence';
import { localDateTimeToUTC } from '../apps/web/lib/timezone';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}
const TZ = 'Asia/Kolkata';
const FRIDAY = '2026-10-09';
const WEDNESDAY = '2026-10-07';

async function sql(text: string, params: unknown[] = []): Promise<any[]> {
  const c = await beginTransaction();
  try { const r = await c.query(text, params); await c.query('COMMIT'); return r.rows; } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
}

// test-only observation of the evidence stage (module-object wrapper; production has no hook)
const realPrepareEvidence = preparationModule.prepareDecisionEvidence;
let lastEvidence: DecisionEvidenceByIntentId | undefined;
const capturedEvidence = (): DecisionEvidenceByIntentId | undefined => lastEvidence;
(preparationModule as any).prepareDecisionEvidence = (...args: Parameters<typeof realPrepareEvidence>) => { lastEvidence = realPrepareEvidence(...args); return lastEvidence; };

async function main() {
  const u = await upsertUserByEmail({ email: 'test-p2b-pressure@example.com', cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: TZ });
  await updateBirthProfile(u.id, { birthDate: '1990-06-15', birthTime: '08:30', birthCityName: 'Chennai', birthLatitude: 13.0827, birthLongitude: 80.2707, birthTimezone: TZ });
  const cleanup = async () => {
    await sql(`UPDATE "GoalActivityOccurrence" SET "plannedActivityId" = NULL WHERE "userId" = $1`, [u.id]);
    await sql(`DELETE FROM "PlannedActivity" WHERE "userId" = $1`, [u.id]);
    await sql(`DELETE FROM "GoalActivity" WHERE "userId" = $1`, [u.id]);
    await sql(`DELETE FROM "Goal" WHERE "userId" = $1`, [u.id]);
    await sql(`DELETE FROM "UserAvailabilityPeriod" WHERE "userId" = $1`, [u.id]);
    await sql(`UPDATE "User" SET "availabilityConfigured" = false WHERE id = $1`, [u.id]);
  };
  await cleanup();
  try {
    await replaceUserAvailabilityConfiguration(u.id, [1, 2, 3, 4, 5].map((weekday) => ({ weekday, startTime: '09:00', endTime: '17:00' })));
    const g = (await createGoalWithActivities({ userId: u.id, title: 'Pressure goal', targetDate: null, activities: [] })).goal;
    const R = (await addGoalActivity(u.id, g.id, { title: 'Cardio', activityId: 'workout' }))!;
    await sql(`UPDATE "GoalActivity" SET "rhythmKind" = 'N_PER_WEEK', "rhythmTargetPerWeek" = 3 WHERE id = $1`, [R.id]);
    const F = (await addGoalActivity(u.id, g.id, { title: 'Finite task', activityId: null }))!;
    const idOf = (date: string) => encodeGoalDemandIntentId(date, R.id);
    const bootstrap = { getSessionToken: () => 'tok', verifySession: () => ({ userId: u.id }) };

    const previewOn = async (date: string, rows: PlanDayIntentRow[]) => {
      lastEvidence = undefined;
      const now = localDateTimeToUTC(date, '09:00', TZ);
      const r = await handleDayConstructorPreviewRequest({
        getSession: () => ({ userId: u.id }), getUser: (id) => getUserById(id), getBody: async () => ({ intents: buildRequestedIntentsForSubmission(rows, TZ, date) }), now: () => now,
        createOrchestratorDeps: createRealDayConstructorOrchestratorDeps,
        loadDecisionFacts: (usr, request) => loadGoalDecisionFacts(usr, request, createRealGoalDemandCandidatesDeps()),
        createOpportunityRangeDeps: (usr) => createRealOpportunityRangeDeps(usr),
      });
      return { body: JSON.parse(JSON.stringify(r.body)), evidence: capturedEvidence() };
    };
    const rowsFor = async (date: string) => {
      const handoff = await resolveGoalActivityHandoff({ ...bootstrap, listGoalActivities: (uid: string, gid: string) => listGoalActivitiesWithLinkedPlanStatus(uid, gid), loadGoalActivityRhythmFacts: (uid: string, gaId: string, tz: string) => loadGoalActivityRhythmFacts(uid, gaId, tz) } as any, g.id, [R.id, F.id].join(','), date, TZ);
      const auto = await resolveAutomaticGoalDemand({ ...bootstrap, ...createRealGoalDemandCandidatesDeps() } as any, date, TZ, handoff.map((h: any) => h.id));
      const marked = markCanonicalGoalDemandHandoff(handoff, (auto as any).status === 'OK' ? (auto as any).manualCanonicalGoalActivityIds : []);
      const manual = marked.map((m: any) => createIntentRowFromGoalHandoffItem(m, encodeGoalDemandIntentId(date, m.id)));
      const elig = await loadEligibleGoalDemand(createRealGoalDemandCandidatesDeps(), u.id, date, TZ);
      const cand = (elig as any).candidates.find((c: any) => c.goalActivityId === R.id);
      return { manual, automatic: createIntentRowFromAutoGoalSuggestion({ title: cand.title, activityId: cand.activityId, goalActivityId: cand.goalActivityId }, idOf(date)) };
    };
    /** A user-chosen 60-minute duration: a RESOLVED duration (the hand-off row's default is no duration, i.e. the generic fallback). */
    const withDuration = (row: PlanDayIntentRow): PlanDayIntentRow => ({ ...row, durationMinutes: 60 });
    const counts = async () => (await sql(`SELECT (SELECT count(*)::int FROM "PlannedActivity" WHERE "userId" = $1) AS plans, (SELECT count(*)::int FROM "GoalActivityOccurrence" WHERE "userId" = $1) AS occ, (SELECT count(*)::int FROM "GoalActivity" WHERE "userId" = $1) AS gas`, [u.id]))[0];
    const before = await counts();

    console.log('=== FRIDAY: today is the last known opportunity ===');
    const fri = await rowsFor(FRIDAY);
    const canonicalManual = fri.manual.filter((r) => r.id === idOf(FRIDAY));
    check('the canonical manual row is exactly the automatic row (P0a identity)', canonicalManual.length === 1 && JSON.stringify(canonicalManual[0]) === JSON.stringify(fri.automatic));
    const pDefault = await previewOn(FRIDAY, [fri.automatic]);
    const evDefault = pDefault.evidence?.get(idOf(FRIDAY));
    check('REAL DEFAULT ROW: a hand-off / automatic row with no chosen duration resolves to the generic fallback, so its evidence says GENERIC_FALLBACK and its pressure is NONE even though every other fact is scarce (fallback is weaker knowledge)', evDefault?.opportunity?.durationBasis === 'GENERIC_FALLBACK' && evDefault?.opportunity?.afterStartViableDays === 0 && evDefault?.opportunity?.startDateState === 'KNOWN_FEASIBLE' && deriveDecisionPressure({ evidence: evDefault, planningDate: FRIDAY, flexibility: 'FLEXIBLE' }) === 'NONE');
    const pAuto = await previewOn(FRIDAY, [withDuration(fri.automatic)]);
    const evAuto = pAuto.evidence?.get(idOf(FRIDAY));
    const pManual = await previewOn(FRIDAY, canonicalManual.map(withDuration));
    const evManual = pManual.evidence?.get(idOf(FRIDAY));
    check('both previews are READY and each prepared real evidence with recurrence AND opportunity', pAuto.body.status === 'READY' && pManual.body.status === 'READY' && !!evAuto?.recurrence && !!evAuto?.opportunity && !!evManual?.recurrence && !!evManual?.opportunity);
    check('the real producers\' evidence is what the pressure model expects: aligned horizon (Fri .. Sun), RESOLVED duration, first day KNOWN_FEASIBLE, Saturday and Sunday known infeasible, COMPLETE coverage, remaining 3', evAuto!.opportunity!.horizonStartDate === FRIDAY && evAuto!.opportunity!.horizonEndDate === '2026-10-11' && evAuto!.opportunity!.durationBasis === 'RESOLVED' && evAuto!.opportunity!.startDateState === 'KNOWN_FEASIBLE' && evAuto!.opportunity!.afterStartViableDays === 0 && evAuto!.opportunity!.afterStartUnknownDays === 0 && evAuto!.opportunity!.coverage === 'COMPLETE' && evAuto!.recurrence!.remainingInPeriod === 3);
    const pressureAuto = deriveDecisionPressure({ evidence: evAuto, planningDate: FRIDAY, flexibility: 'FLEXIBLE' });
    const pressureManual = deriveDecisionPressure({ evidence: evManual, planningDate: FRIDAY, flexibility: 'FLEXIBLE' });
    check('PRESSURE: the automatic candidate on Friday is LAST_KNOWN_OPPORTUNITY', pressureAuto === 'LAST_KNOWN_OPPORTUNITY');
    check('CANONICAL MANUAL PARITY: the canonical manual hand-off candidate has deeply equal evidence (distinct objects) and IDENTICAL pressure', JSON.stringify(evAuto) === JSON.stringify(evManual) && evAuto !== evManual && pressureManual === pressureAuto);
    check('FIXED: the very same evidence for a FIXED candidate is NONE (pressure is for deferrable work)', deriveDecisionPressure({ evidence: evAuto, planningDate: FRIDAY, flexibility: 'FIXED' }) === 'NONE');

    console.log('=== LEGACY / FACT-FREE rows ===');
    const legacyRows = fri.manual.filter((r) => r.id.startsWith('plan-day-goal-'));
    const pLegacy = await previewOn(FRIDAY, legacyRows);
    check('the legacy non-canonical hand-off row (a finite activity) has no evidence and NONE pressure (nothing is fabricated for a fact-free row)', legacyRows.length === 1 && pLegacy.evidence?.get(legacyRows[0].id) === undefined && deriveDecisionPressure({ evidence: pLegacy.evidence?.get(legacyRows[0].id), planningDate: FRIDAY, flexibility: 'FLEXIBLE' }) === 'NONE');

    console.log('=== WEDNESDAY: later viable days -> NONE ===');
    const wed = await rowsFor(WEDNESDAY);
    const pWedAuto = await previewOn(WEDNESDAY, [withDuration(wed.automatic)]);
    const evWed = pWedAuto.evidence?.get(idOf(WEDNESDAY));
    check('Wednesday: Thursday and Friday are still known viable (afterStartViableDays 2) -> NONE', evWed?.opportunity?.afterStartViableDays === 2 && deriveDecisionPressure({ evidence: evWed, planningDate: WEDNESDAY, flexibility: 'FLEXIBLE' }) === 'NONE');
    const pWedManual = await previewOn(WEDNESDAY, wed.manual.filter((r) => r.id === idOf(WEDNESDAY)).map(withDuration));
    check('Wednesday canonical manual: identical evidence and identical (NONE) pressure', JSON.stringify(pWedManual.evidence?.get(idOf(WEDNESDAY))) === JSON.stringify(evWed) && deriveDecisionPressure({ evidence: pWedManual.evidence?.get(idOf(WEDNESDAY)), planningDate: WEDNESDAY, flexibility: 'FLEXIBLE' }) === 'NONE');
    check('the planning date is part of the input: Friday evidence read against a Wednesday planning date is NONE (it must lie inside, and be aligned with, its own horizon)', deriveDecisionPressure({ evidence: evAuto, planningDate: WEDNESDAY, flexibility: 'FLEXIBLE' }) === 'NONE');

    console.log('=== inert: the preview is unchanged and nothing was written ===');
    check('previews carry no pressure anywhere (P2b is unwired): no response, resolved intent or item mentions it', !JSON.stringify(pAuto.body).includes('ressure') && !JSON.stringify(pManual.body).includes('ressure') && !JSON.stringify(pWedAuto.body).includes('ressure'));
    const after = await counts();
    check('ZERO WRITES: no plan, occurrence or goal-activity row changed across all previews and derivations', after.plans === before.plans && after.occ === before.occ && after.gas === before.gas);

    if (!allPassed) { console.error('SOME DECISION PRESSURE DB CHECKS FAILED'); process.exitCode = 1; return; }
    console.log('ALL DECISION PRESSURE DB CHECKS PASSED');
  } finally {
    (preparationModule as any).prepareDecisionEvidence = realPrepareEvidence;
    await cleanup();
    await sql(`DELETE FROM "User" WHERE email = 'test-p2b-pressure@example.com'`).catch(() => {});
  }
}
main().then(() => process.exit(), (err) => { console.error(err); process.exit(1); });
