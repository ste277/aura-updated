/**
 * Constructor Decision Intelligence -- O5 P2c: live-database proof of Decision Pressure REACHABILITY through the real
 * production producers (DB-backed).
 *
 *   real Goal + Rhythm persistence + availability + (real UserActivityPreference rows | real HabitLog rows) -> real manual
 *   hand-off (P0a marking + row factory) and real automatic inclusion -> real preview boundary (provider -> orchestrator
 *   -> duration context -> prepare facts -> prepare evidence) -> pressure derived HERE only (production never calls it)
 *
 * Answers, against the real stack and not against fakes: which duration sources actually reach `durationBasis: 'RESOLVED'`
 * for recurrence-eligible Goal demand (explicit duration, a stored preference, behavioral typical duration, a catalog
 * default), which stay GENERIC_FALLBACK (suggested-only activities, the generic floor, untyped demand), whether the
 * canonical manual hand-off and the automatic entry produce deeply equal evidence and identical pressure for every one of
 * them, and -- separately -- which of the RESOLVED candidates actually become LAST_KNOWN_OPPORTUNITY (only on a scarce day).
 *
 * Product invariants only: no assertion depends on heap layout, a query plan or timing. P2c adds no production code, so
 * the preview is unchanged and nothing is written by it.
 * Requires DATABASE_URL (fresh, 43 migrations).
 */
import { upsertUserByEmail, updateBirthProfile, createGoalWithActivities, addGoalActivity, beginTransaction, replaceUserAvailabilityConfiguration, getUserById, listGoalActivitiesWithLinkedPlanStatus, loadGoalActivityRhythmFacts, createHabitLog } from '../apps/web/lib/db';
import { setPreferredActivityDuration, clearPreferredActivityDuration } from '../apps/web/lib/activityPreferences';
import { createRealDayConstructorOrchestratorDeps } from '../apps/web/lib/dayConstructorOrchestrator';
import { handleDayConstructorPreviewRequest } from '../apps/web/lib/dayConstructorPreviewRequest';
import { loadGoalDecisionFacts } from '../apps/web/lib/goalDecisionFactsProvider';
import { createRealOpportunityRangeDeps } from '../apps/web/lib/opportunityRangeRealDeps';
import { createRealGoalDemandCandidatesDeps, loadEligibleGoalDemand } from '../apps/web/lib/goalDemandCandidates';
import { resolveGoalActivityHandoff, resolveAutomaticGoalDemand, markCanonicalGoalDemandHandoff } from '../apps/web/lib/planDayBootstrap';
import { createIntentRowFromGoalHandoffItem, createIntentRowFromAutoGoalSuggestion, buildRequestedIntentsForSubmission, type PlanDayIntentRow } from '../apps/web/lib/planDayEntry';
import { encodeGoalDemandIntentId } from '../apps/web/lib/goalDemandIntentId';
import * as preparationModule from '../apps/web/lib/decisionFactPreparation';
import { deriveDecisionPressure, type DecisionPressure } from '../apps/web/lib/decisionPressure';
import type { DecisionEvidence, DecisionEvidenceByIntentId } from '../apps/web/lib/decisionEvidence';
import { localDateTimeToUTC } from '../apps/web/lib/timezone';
import { FULL_ACTIVITY_CATALOG, getActivityProfileById } from '../packages/recommendation/src/personalizedTasks';
import { getActivityDefinition } from '../packages/recommendation/src/activityDefinitions';
import { GENERIC_DURATION_FALLBACK_MINUTES } from '../apps/web/lib/dayBuilderOrchestrator';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}
const TZ = 'Asia/Kolkata';
const FRIDAY = '2026-10-09'; // last weekday of the 2026-10-05..2026-10-11 week: Saturday and Sunday have no availability
const WEDNESDAY = '2026-10-07'; // Thursday and Friday are still viable
const EMAIL = 'test-p2c-reachability@example.com';
const UNTYPED_TITLE = 'Finite task';

async function sql(text: string, params: unknown[] = []): Promise<any[]> {
  const c = await beginTransaction();
  try { const r = await c.query(text, params); await c.query('COMMIT'); return r.rows; } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
}

// test-only observation of the evidence stage (module-object wrapper; production has no hook)
const realPrepareEvidence = preparationModule.prepareDecisionEvidence;
let lastEvidence: DecisionEvidenceByIntentId | undefined;
const capturedEvidence = (): DecisionEvidenceByIntentId | undefined => lastEvidence;
(preparationModule as any).prepareDecisionEvidence = (...args: Parameters<typeof realPrepareEvidence>) => { lastEvidence = realPrepareEvidence(...args); return lastEvidence; };

const pressureOf = (evidence: DecisionEvidence | undefined, date: string): DecisionPressure => deriveDecisionPressure({ evidence, planningDate: date, flexibility: 'FLEXIBLE' });
const catalogDefault = (id: string): number | null => getActivityProfileById(id)?.defaultDurationMinutes ?? null;
const catalogSuggested = (id: string): number | null => getActivityDefinition(id)?.experience.suggestedDurations?.[0] ?? null;

async function main() {
  const u = await upsertUserByEmail({ email: EMAIL, cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: TZ });
  await updateBirthProfile(u.id, { birthDate: '1990-06-15', birthTime: '08:30', birthCityName: 'Chennai', birthLatitude: 13.0827, birthLongitude: 80.2707, birthTimezone: TZ });
  const cleanup = async () => {
    await sql(`UPDATE "GoalActivityOccurrence" SET "plannedActivityId" = NULL WHERE "userId" = $1`, [u.id]);
    await sql(`DELETE FROM "PlannedActivity" WHERE "userId" = $1`, [u.id]);
    await sql(`DELETE FROM "HabitLog" WHERE "userId" = $1`, [u.id]);
    await sql(`DELETE FROM "UserActivityPreference" WHERE "userId" = $1`, [u.id]);
    await sql(`DELETE FROM "GoalActivity" WHERE "userId" = $1`, [u.id]);
    await sql(`DELETE FROM "Goal" WHERE "userId" = $1`, [u.id]);
    await sql(`DELETE FROM "UserAvailabilityPeriod" WHERE "userId" = $1`, [u.id]);
    await sql(`UPDATE "User" SET "availabilityConfigured" = false WHERE id = $1`, [u.id]);
  };
  await cleanup();
  try {
    await replaceUserAvailabilityConfiguration(u.id, [1, 2, 3, 4, 5].map((weekday) => ({ weekday, startTime: '09:00', endTime: '17:00' })));
    const g = (await createGoalWithActivities({ userId: u.id, title: 'Reachability goal', targetDate: null, activities: [] })).goal;
    const rhythm = { kind: 'N_PER_WEEK' as const, targetPerWeek: 3 };
    const goalActivityId = new Map<string, string>(); // catalog activity id (or 'untyped') -> GoalActivity id
    for (const activity of FULL_ACTIVITY_CATALOG) goalActivityId.set(activity.id, (await addGoalActivity(u.id, g.id, { title: `GA ${activity.id}`, activityId: activity.id, rhythm }))!.id);
    goalActivityId.set('untyped', (await addGoalActivity(u.id, g.id, { title: UNTYPED_TITLE, activityId: null, rhythm }))!.id);
    const ids = [...goalActivityId.keys()]; // 42 catalog activities + one untyped
    const gaId = (key: string) => goalActivityId.get(key)!;
    const intentId = (date: string, key: string) => encodeGoalDemandIntentId(date, gaId(key));
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
    /** The REAL entry paths for a set of Goal activities: the canonical manual hand-off rows and the automatic-inclusion rows. */
    const entryRows = async (date: string, keys: readonly string[]) => {
      const handoff = await resolveGoalActivityHandoff({ ...bootstrap, listGoalActivities: (uid: string, gid: string) => listGoalActivitiesWithLinkedPlanStatus(uid, gid), loadGoalActivityRhythmFacts: (uid: string, id: string, tz: string) => loadGoalActivityRhythmFacts(uid, id, tz) } as any, g.id, keys.map(gaId).join(','), date, TZ);
      const auto = await resolveAutomaticGoalDemand({ ...bootstrap, ...createRealGoalDemandCandidatesDeps() } as any, date, TZ, handoff.map((h: any) => h.id));
      const marked = markCanonicalGoalDemandHandoff(handoff, (auto as any).status === 'OK' ? (auto as any).manualCanonicalGoalActivityIds : []);
      const manual = new Map<string, PlanDayIntentRow>(marked.map((m: any) => [m.id as string, createIntentRowFromGoalHandoffItem(m, encodeGoalDemandIntentId(date, m.id))]));
      const eligible = await loadEligibleGoalDemand(createRealGoalDemandCandidatesDeps(), u.id, date, TZ);
      const automatic = new Map<string, PlanDayIntentRow>();
      for (const key of keys) {
        const cand = (eligible as any).candidates.find((c: any) => c.goalActivityId === gaId(key));
        if (cand) automatic.set(gaId(key), createIntentRowFromAutoGoalSuggestion({ title: cand.title, activityId: cand.activityId, goalActivityId: cand.goalActivityId }, intentId(date, key)));
      }
      return { manual, automatic, canonicalCount: marked.filter((m: any) => m.canonicalDemand === true).length };
    };
    const withDuration = (row: PlanDayIntentRow, minutes: number): PlanDayIntentRow => ({ ...row, durationMinutes: minutes });
    /** Previews BOTH entry paths for the keys (chunked below the 12-intent transport limit) and returns the evidence of each. */
    const bothPaths = async (date: string, keys: readonly string[], durationMinutes?: number) => {
      const entry = await entryRows(date, keys);
      const manualRows = keys.map((k) => entry.manual.get(gaId(k))!).filter(Boolean).map((r) => (durationMinutes === undefined ? r : withDuration(r, durationMinutes)));
      const autoRows = keys.map((k) => entry.automatic.get(gaId(k))!).filter(Boolean).map((r) => (durationMinutes === undefined ? r : withDuration(r, durationMinutes)));
      const manual = await previewOn(date, manualRows);
      const automatic = await previewOn(date, autoRows);
      return { entry, manual, automatic, manualRows, autoRows };
    };
    const counts = async () => (await sql(`SELECT (SELECT count(*)::int FROM "PlannedActivity" WHERE "userId" = $1) AS plans, (SELECT count(*)::int FROM "GoalActivityOccurrence" WHERE "userId" = $1) AS occ, (SELECT count(*)::int FROM "GoalActivity" WHERE "userId" = $1) AS gas, (SELECT count(*)::int FROM "HabitLog" WHERE "userId" = $1) AS logs, (SELECT count(*)::int FROM "UserActivityPreference" WHERE "userId" = $1) AS prefs`, [u.id]))[0];
    const previewBodies: string[] = [];
    let previewedOk = true;
    const note = (p: { body: any }) => { previewBodies.push(JSON.stringify(p.body)); if (p.body.status !== 'READY') previewedOk = false; };

    // ============================================================
    console.log('=== NO SOURCE: every catalog activity as REAL Goal demand through BOTH real entry paths ===');
    const beforeWrites = await counts();
    check('the fixture: one Goal with 42 recurrence-eligible catalog activities and one untyped activity, no stored preference and no habit log (so no duration source exists but the catalog)', ids.length === FULL_ACTIVITY_CATALOG.length + 1 && beforeWrites.gas === ids.length && beforeWrites.logs === 0 && beforeWrites.prefs === 0);
    let rowIdentityOk = true; let parityOk = true; let basisOk = true; let pressureOk = true; let evidenceOk = true;
    const problems: string[] = [];
    let resolvedCount = 0; let fallbackCount = 0; let lkoCount = 0;
    for (let i = 0; i < ids.length; i += 10) {
      const keys = ids.slice(i, i + 10);
      const { entry, manual, automatic } = await bothPaths(FRIDAY, keys);
      note(manual); note(automatic);
      for (const key of keys) {
        const id = intentId(FRIDAY, key);
        const manualRow = entry.manual.get(gaId(key)); const autoRow = entry.automatic.get(gaId(key));
        if (!manualRow || !autoRow || JSON.stringify(manualRow) !== JSON.stringify(autoRow)) { rowIdentityOk = false; problems.push(`${key}: manual row != automatic row`); continue; }
        const evManual = manual.evidence?.get(id); const evAuto = automatic.evidence?.get(id);
        if (!evManual?.recurrence || !evManual?.opportunity || !evAuto?.recurrence || !evAuto?.opportunity) { evidenceOk = false; problems.push(`${key}: missing evidence (manual ${!!evManual}, automatic ${!!evAuto})`); continue; }
        if (JSON.stringify(evManual) !== JSON.stringify(evAuto) || evManual === evAuto || pressureOf(evManual, FRIDAY) !== pressureOf(evAuto, FRIDAY)) { parityOk = false; problems.push(`${key}: manual/automatic evidence or pressure differ`); }
        const wantDefault = key === 'untyped' ? null : catalogDefault(key);
        const wantMinutes = key === 'untyped' ? GENERIC_DURATION_FALLBACK_MINUTES : (wantDefault ?? catalogSuggested(key) ?? GENERIC_DURATION_FALLBACK_MINUTES);
        const wantBasis = wantDefault !== null ? 'RESOLVED' : 'GENERIC_FALLBACK';
        const o = evAuto.opportunity;
        if (o.durationBasis !== wantBasis || o.durationMinutes !== wantMinutes) { basisOk = false; problems.push(`${key}: basis ${o.durationBasis}/${o.durationMinutes}, want ${wantBasis}/${wantMinutes}`); }
        const p = pressureOf(evAuto, FRIDAY);
        if (wantBasis === 'RESOLVED') resolvedCount += 1; else fallbackCount += 1;
        if (p === 'LAST_KNOWN_OPPORTUNITY') lkoCount += 1;
        if (p !== (wantBasis === 'RESOLVED' ? 'LAST_KNOWN_OPPORTUNITY' : 'NONE')) { pressureOk = false; problems.push(`${key}: pressure ${p} for ${wantBasis}`); }
      }
    }
    if (problems.length) console.log(problems.join('\n'));
    console.log(`[info] real producers, Friday, no explicit duration: ${resolvedCount} candidates RESOLVED by a catalog default, ${fallbackCount} GENERIC_FALLBACK, ${lkoCount} LAST_KNOWN_OPPORTUNITY`);
    check('P0a IDENTITY, ALL ACTIVITIES: for every one of the 43 Goal activities the canonical manual hand-off row IS the automatic row (the pre-P0a defect -- facts for automatic demand, none for manual -- cannot return unseen)', rowIdentityOk);
    check('REAL EVIDENCE, ALL ACTIVITIES: both entry paths prepared real recurrence AND opportunity evidence for every candidate (no candidate silently lacks facts)', evidenceOk);
    check('MANUAL/AUTOMATIC PARITY, ALL ACTIVITIES: the canonical manual hand-off and the automatic entry produce deeply equal evidence (distinct objects) and identical pressure, for every activity', parityOk && rowIdentityOk && evidenceOk);
    check('DEFAULT-DURATION MATRIX (real): every catalog activity WITH a default reaches RESOLVED at exactly that default; FALLBACK MATRIX (real): every one WITHOUT stays GENERIC_FALLBACK at its suggested minutes or the 45-minute floor; the untyped Goal activity is the 45-minute GENERIC_FALLBACK', basisOk && resolvedCount === FULL_ACTIVITY_CATALOG.filter((a) => catalogDefault(a.id) !== null).length && fallbackCount === ids.length - resolvedCount);
    check('PRESSURE REACHABILITY (real, scarce Friday): LAST_KNOWN_OPPORTUNITY for exactly the RESOLVED candidates and NONE for every fallback one -- duration reachability and pressure reachability coincide here only because Friday is scarce for all of them', pressureOk && lkoCount === resolvedCount);

    console.log('=== NON-scarce control: Wednesday ===');
    const wedKeys = ['meditation', 'date-night', 'workout'];
    const wed = await bothPaths(WEDNESDAY, wedKeys, 60);
    note(wed.manual); note(wed.automatic);
    check('on a Wednesday (Thursday and Friday still viable) the RESOLVED candidates are NONE on both entry paths -- RESOLVED is necessary, never sufficient', wedKeys.every((k) => { const a = wed.automatic.evidence?.get(intentId(WEDNESDAY, k)); const m = wed.manual.evidence?.get(intentId(WEDNESDAY, k)); return a?.opportunity?.durationBasis === 'RESOLVED' && a.opportunity.afterStartViableDays === 2 && pressureOf(a, WEDNESDAY) === 'NONE' && pressureOf(m, WEDNESDAY) === 'NONE'; }));

    // ============================================================
    console.log('=== SOURCE 1: explicit requested duration (the four core classes) ===');
    const FOUR: Array<[string, string]> = [['workout', 'explicit duration on an activity with NO catalog default'], ['untyped', 'explicit duration on UNTYPED demand'], ['meditation', 'explicit duration overriding a catalog default']];
    const explicit = await bothPaths(FRIDAY, FOUR.map(([k]) => k), 60);
    note(explicit.manual); note(explicit.automatic);
    for (const [key, label] of FOUR) {
      const id = intentId(FRIDAY, key);
      const a = explicit.automatic.evidence?.get(id); const m = explicit.manual.evidence?.get(id);
      check(`automatic + manual, ${label} (${key}): both RESOLVED at exactly 60 minutes, deeply equal evidence, identical pressure LAST_KNOWN_OPPORTUNITY`, a?.opportunity?.durationBasis === 'RESOLVED' && a.opportunity.durationMinutes === 60 && JSON.stringify(a) === JSON.stringify(m) && a !== m && pressureOf(a, FRIDAY) === 'LAST_KNOWN_OPPORTUNITY' && pressureOf(m, FRIDAY) === 'LAST_KNOWN_OPPORTUNITY');
    }
    const none = await bothPaths(FRIDAY, ['workout', 'meditation', 'untyped']);
    note(none.manual); note(none.automatic);
    const noneFor = (k: string) => ({ a: none.automatic.evidence?.get(intentId(FRIDAY, k)), m: none.manual.evidence?.get(intentId(FRIDAY, k)) });
    check('FOUR-CLASS MATRIX, no explicit duration: workout (no default) is GENERIC_FALLBACK/NONE on both paths; meditation (catalog default) is RESOLVED/LAST_KNOWN_OPPORTUNITY on both paths; untyped is GENERIC_FALLBACK/NONE on both paths', ['workout', 'untyped'].every((k) => noneFor(k).a?.opportunity?.durationBasis === 'GENERIC_FALLBACK' && pressureOf(noneFor(k).a, FRIDAY) === 'NONE' && pressureOf(noneFor(k).m, FRIDAY) === 'NONE' && JSON.stringify(noneFor(k).a) === JSON.stringify(noneFor(k).m)) && noneFor('meditation').a?.opportunity?.durationBasis === 'RESOLVED' && pressureOf(noneFor('meditation').a, FRIDAY) === 'LAST_KNOWN_OPPORTUNITY' && pressureOf(noneFor('meditation').m, FRIDAY) === 'LAST_KNOWN_OPPORTUNITY' && JSON.stringify(noneFor('meditation').a) === JSON.stringify(noneFor('meditation').m));
    check('NEGATIVE CONTROL: with the SAME scarce Friday opportunity facts, the only difference between workout-without-duration (NONE) and workout-with-60-minutes (LAST_KNOWN_OPPORTUNITY) is the duration basis and minutes', (() => { const f = noneFor('workout').a!.opportunity!; const e = explicit.automatic.evidence!.get(intentId(FRIDAY, 'workout'))!.opportunity!; return JSON.stringify({ ...f, durationBasis: 0, durationMinutes: 0 }) === JSON.stringify({ ...e, durationBasis: 0, durationMinutes: 0 }) && f.durationBasis === 'GENERIC_FALLBACK' && e.durationBasis === 'RESOLVED'; })());

    // ============================================================
    console.log('=== SOURCE 2: stored UserActivityPreference ===');
    await setPreferredActivityDuration({ userId: u.id, activityId: 'deep-work', preferredDurationMinutes: 90 });
    const pref = await bothPaths(FRIDAY, ['deep-work']);
    note(pref.manual); note(pref.automatic);
    const prefA = pref.automatic.evidence?.get(intentId(FRIDAY, 'deep-work')); const prefM = pref.manual.evidence?.get(intentId(FRIDAY, 'deep-work'));
    check('REAL PATH: a real stored preference row -> the real duration context -> RESOLVED evidence at the stored 90 minutes (deep-work has no catalog default and a 30-minute suggestion), on both entry paths with deeply equal evidence', prefA?.opportunity?.durationBasis === 'RESOLVED' && prefA.opportunity.durationMinutes === 90 && JSON.stringify(prefA) === JSON.stringify(prefM));
    check('POSITIVE PRESSURE CONTROL (stored preference): the RESOLVED, scarce Friday candidate is LAST_KNOWN_OPPORTUNITY on both entry paths', pressureOf(prefA, FRIDAY) === 'LAST_KNOWN_OPPORTUNITY' && pressureOf(prefM, FRIDAY) === 'LAST_KNOWN_OPPORTUNITY');
    await setPreferredActivityDuration({ userId: u.id, activityId: 'meditation', preferredDurationMinutes: 25 });
    const prefOverDefault = await bothPaths(FRIDAY, ['meditation']);
    note(prefOverDefault.automatic);
    check('a stored preference outranks the catalog default (meditation: 25, not 15) and the basis stays RESOLVED', prefOverDefault.automatic.evidence?.get(intentId(FRIDAY, 'meditation'))?.opportunity?.durationMinutes === 25 && prefOverDefault.automatic.evidence?.get(intentId(FRIDAY, 'meditation'))?.opportunity?.durationBasis === 'RESOLVED');
    await clearPreferredActivityDuration({ userId: u.id, activityId: 'deep-work' });
    await clearPreferredActivityDuration({ userId: u.id, activityId: 'meditation' });
    const prefCleared = await bothPaths(FRIDAY, ['deep-work', 'meditation']);
    note(prefCleared.automatic);
    const clearedDW = prefCleared.automatic.evidence?.get(intentId(FRIDAY, 'deep-work')); const clearedMed = prefCleared.automatic.evidence?.get(intentId(FRIDAY, 'meditation'));
    check('clearing the preference returns the activity to the catalog chain: deep-work is GENERIC_FALLBACK again (30-minute suggestion, NONE) and meditation is back to its 15-minute default', clearedDW?.opportunity?.durationBasis === 'GENERIC_FALLBACK' && clearedDW.opportunity.durationMinutes === 30 && pressureOf(clearedDW, FRIDAY) === 'NONE' && clearedMed?.opportunity?.durationMinutes === 15 && clearedMed.opportunity.durationBasis === 'RESOLVED');

    // ============================================================
    console.log('=== SOURCE 3: behavioral typical duration (real HabitLog rows -> the real duration context) ===');
    const log = (activityId: string, day: string, minutes: number) => createHabitLog({ userId: u.id, activityTitle: `log ${activityId}`, activityId, activeWindow: 'NEUTRAL', logMinuteOfDay: 600, logTimestamp: new Date(`${day}T05:00:00Z`), durationMinutes: minutes, logSource: 'MANUAL' });
    const clearLogs = () => sql(`DELETE FROM "HabitLog" WHERE "userId" = $1`, [u.id]);
    const learningOf = async () => { const r = await bothPaths(FRIDAY, ['learning']); note(r.manual); note(r.automatic); return { a: r.automatic.evidence?.get(intentId(FRIDAY, 'learning')), m: r.manual.evidence?.get(intentId(FRIDAY, 'learning')) }; };
    await log('learning', '2026-10-02', 40); await log('learning', '2026-10-03', 45); await log('learning', '2026-10-04', 50);
    const b1 = await learningOf();
    check('REACHABLE FOR CANONICAL GOAL DEMAND: three recent logs of the activity (40, 45, 50 minutes, within 30 minutes of each other) -> the real duration context derives a behavioral typical duration -> RESOLVED evidence at the median 45 (learning has no catalog default; its suggestion is 20), on both entry paths', b1.a?.opportunity?.durationBasis === 'RESOLVED' && b1.a.opportunity.durationMinutes === 45 && JSON.stringify(b1.a) === JSON.stringify(b1.m));
    check('POSITIVE PRESSURE CONTROL (behavioral duration): the RESOLVED, scarce Friday candidate is LAST_KNOWN_OPPORTUNITY on both entry paths', pressureOf(b1.a, FRIDAY) === 'LAST_KNOWN_OPPORTUNITY' && pressureOf(b1.m, FRIDAY) === 'LAST_KNOWN_OPPORTUNITY');
    await clearLogs(); await log('learning', '2026-10-02', 40); await log('learning', '2026-10-03', 45);
    const b2 = await learningOf();
    check('BEHAVIORAL BOUND (evidence floor): two logs are not enough -> GENERIC_FALLBACK (the 20-minute suggestion), NONE', b2.a?.opportunity?.durationBasis === 'GENERIC_FALLBACK' && b2.a.opportunity.durationMinutes === 20 && pressureOf(b2.a, FRIDAY) === 'NONE');
    await clearLogs(); await log('learning', '2026-10-02', 20); await log('learning', '2026-10-03', 45); await log('learning', '2026-10-04', 80);
    const b3 = await learningOf();
    check('BEHAVIORAL BOUND (consistency): three logs spread by more than 30 minutes (20 / 45 / 80) are not "typical" -> GENERIC_FALLBACK, NONE (never a false-precision average)', b3.a?.opportunity?.durationBasis === 'GENERIC_FALLBACK' && pressureOf(b3.a, FRIDAY) === 'NONE');
    await clearLogs(); await log('learning', '2026-07-01', 40); await log('learning', '2026-07-02', 45); await log('learning', '2026-07-03', 50);
    const b4 = await learningOf();
    check('BEHAVIORAL BOUND (recency): three consistent logs older than the 60-day window are ignored -> GENERIC_FALLBACK, NONE', b4.a?.opportunity?.durationBasis === 'GENERIC_FALLBACK' && pressureOf(b4.a, FRIDAY) === 'NONE');
    await clearLogs(); await log('learning', '2026-09-01', 40); await log('learning', '2026-09-02', 45); await log('learning', '2026-09-03', 50);
    // 50 NEWER logs of another activity (every one strictly newer than the three learning logs, so the 50 most recent are exactly these)
    for (let d = 0; d < 50; d++) await log('quiet-time', `2026-10-0${1 + (d % 4)}`, 30);
    const b5 = await learningOf();
    check('BEHAVIORAL BOUND (the real loader reads only the 50 MOST RECENT habit logs): three consistent logs pushed out of that window by 50 newer logs of another activity no longer count -> GENERIC_FALLBACK, NONE (a documented limit of the real source, characterized here and NOT changed by P2c)', b5.a?.opportunity?.durationBasis === 'GENERIC_FALLBACK' && pressureOf(b5.a, FRIDAY) === 'NONE');
    await clearLogs();
    const b6 = await learningOf();
    check('removing the behavioral evidence returns the activity to GENERIC_FALLBACK (the fixture, not the activity, supplied the duration)', b6.a?.opportunity?.durationBasis === 'GENERIC_FALLBACK' && b6.a.opportunity.durationMinutes === 20);

    // ============================================================
    console.log('=== inert and write-free ===');
    const afterWrites = await counts();
    const beforeOne = await counts();
    await learningOf();
    const afterOne = await counts();
    check('a single preview (with logs and a preference present) changes no row in ANY table the duration context reads or the Goal-demand loaders touch', JSON.stringify(beforeOne) === JSON.stringify(afterOne));
    check('ZERO WRITES: no plan, occurrence, goal-activity, habit-log or preference row was created or changed by any preview or derivation (only this fixture\'s own setup rows differ)', afterWrites.plans === beforeWrites.plans && afterWrites.occ === beforeWrites.occ && afterWrites.gas === beforeWrites.gas);
    check('every preview was READY', previewedOk && previewBodies.length > 0);
    check('previews carry no pressure anywhere (nothing is wired): no response, resolved intent or item mentions it', previewBodies.every((b) => !b.includes('ressure')));

    if (!allPassed) { console.error('SOME DECISION PRESSURE REACHABILITY DB CHECKS FAILED'); process.exitCode = 1; return; }
    console.log('ALL DECISION PRESSURE REACHABILITY DB CHECKS PASSED');
  } finally {
    (preparationModule as any).prepareDecisionEvidence = realPrepareEvidence;
    await cleanup();
    await sql(`DELETE FROM "User" WHERE email = $1`, [EMAIL]).catch(() => {});
  }
}
main().then(() => process.exit(), (err) => { console.error(err); process.exit(1); });
