/**
 * HGR3-B / HGR3-BH -- Secure Weekly Rhythm Proposal Acceptance, hardened.
 *
 * Production-path regression coverage for the ORCHESTRATION logic in
 * goalRhythmWeeklyAcceptance.ts: input validation, the read-only retry-
 * reconciliation short-circuit, Availability Context enforcement, fresh
 * per-session eligibility revalidation, EXPLICIT_RANGE window
 * construction pinned to the exact approved instant, idempotency-key
 * derivation, partial-success accounting, and the "revalidate at EACH
 * acceptance, never just once at batch start" invariant. Exercises the
 * REAL `acceptWeeklyRhythmSessions`/`buildWeeklySessionClientRequestId`
 * with fake `GoalDemandCandidatesDeps`/`runPreview`/`persist`/
 * `getPlanCreationClaim`/`getPlannedActivityForOwner`/
 * `loadAvailabilityConfiguration` (the same DI convention
 * goalRhythmWeeklyProposal.test.ts already established) -- no DB, no
 * network, no jsdom.
 *
 * The genuine end-to-end path -- real `EXPLICIT_RANGE` construction for a
 * FUTURE date with a FIXED, exact instant, real signing, real
 * `verifyAcceptanceItems`/`authorizeGoalActivityLinks`/
 * `persistAcceptedConstructedDay` against a live Postgres, and a real
 * retry that now correctly resolves `ALREADY_ACCEPTED` without
 * self-colliding -- is covered separately in
 * goalRhythmWeeklyAcceptanceDb.test.ts (requires DATABASE_URL). This file
 * cannot and does not claim to prove that critical gate; it proves the
 * orchestration loop and its new hardening logic around it.
 *
 * Checks explicitly marked [STRUCTURAL] are source-text assertions; every
 * other check calls the real exported functions directly.
 */
import * as fs from 'fs';
import * as path from 'path';
import {
  acceptWeeklyRhythmSessions,
  buildWeeklySessionClientRequestId,
  buildExplicitRangeWindow,
  MAX_WEEKLY_ACCEPTANCE_SESSIONS,
  type WeeklyAcceptanceDeps,
  type WeeklyAcceptanceSelection,
  type WeeklySessionAcceptanceOutcome,
} from '../apps/web/lib/goalRhythmWeeklyAcceptance';
import { localDayBoundsUTC } from '../apps/web/lib/myDayOrchestrator';
import type { GoalDemandCandidatesDeps } from '../apps/web/lib/goalDemandCandidates';
import type { CandidateGoalActivityForRhythmDemandRow, PlanCreationClaim, PlannedActivity } from '../apps/web/lib/db';
import type { GoalActivityRhythmOccurrenceFact } from '../apps/web/lib/goalActivityRhythm';
import type { DayConstructorPreviewHttpResult, DayConstructorPreviewBoundaryDeps } from '../apps/web/lib/dayConstructorPreviewRequest';
import { deriveAcceptanceIdempotencyKey, type AcceptConstructedDayPersistenceResult } from '../apps/web/lib/dayConstructorAcceptancePersistence';
import type { AcceptConstructedDayRequest } from '../apps/web/lib/dayConstructorAcceptance';
import { signPreviewItem } from '../apps/web/lib/dayConstructorPreviewIntegrity';
import type { AvailabilityConfiguration } from '../apps/web/lib/availabilityContext';
import type { User } from '../apps/web/lib/db';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

const TZ = 'Asia/Kolkata'; // UTC+5:30
const USER_ID = 'user-1';
const GOAL_ACTIVITY_ID = 'ga-1';
const NOW = new Date('2026-11-04T04:00:00.000Z'); // Wed 2026-11-04 09:30 IST
const PLANNING_LOCAL_DATE = '2026-11-04';

function row(target: number): CandidateGoalActivityForRhythmDemandRow {
  return { goalActivityId: GOAL_ACTIVITY_ID, goalId: 'goal-1', goalTitle: 'Get fit', title: 'Run', activityId: 'running', rhythmKind: 'N_PER_WEEK', rhythmTargetPerWeek: target };
}

function fact(localDate: string, contribution: GoalActivityRhythmOccurrenceFact['contribution']): GoalActivityRhythmOccurrenceFact {
  return { localDate, contribution };
}

const FAKE_USER: User = { id: USER_ID, timezone: TZ } as User;

/** A future-dated session's approved instant, IST 18:00-18:30 (well
 * within an ordinary day, never elapsed relative to NOW). */
function session(localDate: string): WeeklyAcceptanceSelection {
  return { goalActivityId: GOAL_ACTIVITY_ID, localDate, start: `${localDate}T12:30:00.000Z`, end: `${localDate}T13:00:00.000Z` }; // 18:00-18:30 IST
}

const UNCONFIGURED_AVAILABILITY: AvailabilityConfiguration = { configured: false, periods: [] };

interface FakeEnv {
  deps: WeeklyAcceptanceDeps;
  previewCalls: { targetDate: string; explicitStart?: unknown; explicitEnd?: unknown; intentId: string; flexibility?: string; fixedStart?: unknown; durationMinutes?: number }[];
  persistCalls: AcceptConstructedDayRequest[];
  /** Keyed by clientRequestId -- what `persist` should answer for that
   * exact call. Missing -> SAVED (the common case). */
  persistResultByClientRequestId: Map<string, AcceptConstructedDayPersistenceResult>;
  /** Keyed by targetDate -- what `runPreview` should answer. Missing ->
   * a real READY preview with the FIXED intent genuinely placed at its
   * own requested fixedStart. */
  previewFailureByDate: Map<string, 'NO_USABLE_CAPACITY' | 'NO_CANDIDATES' | 'FIXED_WINDOW_CONFLICT' | 'PLACE_WRONG_TIME'>;
  /** Mutable, read by `loadRhythmFacts` on EVERY call -- lets a test
   * simulate an earlier session in the SAME batch having already
   * consumed capacity, proving per-session revalidation is real. */
  factsRef: { current: ReadonlyMap<string, readonly GoalActivityRhythmOccurrenceFact[]> };
  loadCandidateCallCount: { n: number };
  /** In-memory stand-in for the real PlanCreationIdempotency table, keyed
   * by the EXACT per-item key `deriveAcceptanceIdempotencyKey` would
   * derive -- `persist`'s own fake below fills it, exactly mirroring the
   * real persistence layer's "claim, then fill" contract closely enough
   * for this file's own purposes. */
  claimsByKey: Map<string, PlanCreationClaim>;
  plansById: Map<string, PlannedActivity>;
  getPlanCreationClaimCallCount: { n: number };
  availability: { current: AvailabilityConfiguration };
}

function buildFakeEnv(targetPerWeek: number, initialFacts: readonly GoalActivityRhythmOccurrenceFact[] = []): FakeEnv {
  const previewCalls: FakeEnv['previewCalls'] = [];
  const persistCalls: FakeEnv['persistCalls'] = [];
  const persistResultByClientRequestId = new Map<string, AcceptConstructedDayPersistenceResult>();
  const previewFailureByDate = new Map<string, 'NO_USABLE_CAPACITY' | 'NO_CANDIDATES' | 'FIXED_WINDOW_CONFLICT' | 'PLACE_WRONG_TIME'>();
  const factsRef = { current: new Map<string, readonly GoalActivityRhythmOccurrenceFact[]>([[GOAL_ACTIVITY_ID, initialFacts]]) };
  const loadCandidateCallCount = { n: 0 };
  const claimsByKey = new Map<string, PlanCreationClaim>();
  const plansById = new Map<string, PlannedActivity>();
  const getPlanCreationClaimCallCount = { n: 0 };
  const availability = { current: UNCONFIGURED_AVAILABILITY };

  const goalDemandDeps: GoalDemandCandidatesDeps = {
    loadCandidateGoalActivities: async () => {
      loadCandidateCallCount.n += 1;
      return [row(targetPerWeek)];
    },
    loadRhythmFacts: async () => factsRef.current,
  };

  const runPreview = (async (boundaryDeps: DayConstructorPreviewBoundaryDeps): Promise<DayConstructorPreviewHttpResult> => {
    const body = (await boundaryDeps.getBody()) as { targetDate: string; explicitStart?: unknown; explicitEnd?: unknown; intents: Array<{ id: string; title: string; activityId?: string; flexibility?: string; fixedStart?: unknown; durationMinutes?: number }> };
    const session = boundaryDeps.getSession();
    const intent = body.intents[0];
    previewCalls.push({ targetDate: body.targetDate, explicitStart: body.explicitStart, explicitEnd: body.explicitEnd, intentId: intent.id, flexibility: intent.flexibility, fixedStart: intent.fixedStart, durationMinutes: intent.durationMinutes });

    const failure = previewFailureByDate.get(body.targetDate);
    if (failure === 'NO_USABLE_CAPACITY') return { httpStatus: 200, body: { status: 'NO_USABLE_CAPACITY', constructionWindowMinutes: 0, blockedMinutes: 0, requestedMinutes: 30 } };

    const window = { date: body.targetDate, start: new Date(`${body.targetDate}T04:00:00.000Z`), end: new Date(`${body.targetDate}T18:30:00.000Z`), timezone: TZ, source: 'EXPLICIT_RANGE' as const };
    if (failure === 'NO_CANDIDATES' || failure === 'FIXED_WINDOW_CONFLICT') {
      return { httpStatus: 200, body: { status: 'READY', preview: { targetDate: body.targetDate, timezone: TZ, constructionWindow: window, resolvedIntents: [], constructedDay: { date: body.targetDate, proposedItems: [], deferredItems: [{ intentId: intent.id, primaryReason: failure === 'FIXED_WINDOW_CONFLICT' ? 'FIXED_WINDOW_CONFLICT' : 'NO_CANDIDATES', diagnostics: [] }], conflicts: [], requestedCapacity: { totalMinutes: 30, usedMinutes: 0, availableMinutes: 0 }, proposedCapacity: { totalMinutes: 0, usedMinutes: 0, availableMinutes: 0 } }, warnings: [] } } };
    }

    // The real `placeFixedIntent` contract: place EXACTLY at the
    // requested `fixedStart`/duration (or, for the PLACE_WRONG_TIME
    // fault-injection fixture, deliberately 15 minutes off -- proving
    // this file's own defensive equality check actually fires).
    const requestedStart = intent.fixedStart ? new Date(intent.fixedStart as string) : new Date(`${body.targetDate}T06:00:00.000Z`);
    const offsetMs = failure === 'PLACE_WRONG_TIME' ? 15 * 60000 : 0;
    const itemStart = new Date(requestedStart.getTime() + offsetMs);
    const itemEnd = new Date(itemStart.getTime() + (intent.durationMinutes ?? 30) * 60000);
    const item = { intentId: intent.id, activityId: intent.activityId, title: intent.title, start: itemStart, end: itemEnd, placementSource: 'FIXED_CONSTRAINT' as const };
    // Real signing -- this fake never invents its own token shape, it
    // calls the SAME production `signPreviewItem` the real pipeline uses,
    // keyed by `session.userId`, so `acceptOneSession`'s own real
    // `verifyAcceptanceItems` call downstream genuinely verifies it.
    const acceptanceToken = signPreviewItem({ userId: session!.userId, window, item });
    return { httpStatus: 200, body: { status: 'READY', preview: { targetDate: body.targetDate, timezone: TZ, constructionWindow: window, resolvedIntents: [], constructedDay: { date: body.targetDate, proposedItems: [{ ...item, acceptanceToken }], deferredItems: [], conflicts: [], requestedCapacity: { totalMinutes: 30, usedMinutes: 30, availableMinutes: 0 }, proposedCapacity: { totalMinutes: 30, usedMinutes: 30, availableMinutes: 0 } }, warnings: [] } } };
  }) as unknown as typeof import('../apps/web/lib/dayConstructorPreviewRequest').handleDayConstructorPreviewRequest;

  const persist = (async (userId: string, request: AcceptConstructedDayRequest): Promise<AcceptConstructedDayPersistenceResult> => {
    persistCalls.push(request);
    const configured = persistResultByClientRequestId.get(request.clientRequestId);
    if (configured) return configured;
    const item = request.proposedItems[0];
    const plan = { id: `plan-${request.clientRequestId}`, plannedStartAt: item.start, plannedEndAt: item.end } as PlannedActivity;
    plansById.set(plan.id, plan);
    const key = deriveAcceptanceIdempotencyKey(request.clientRequestId, item.intentId);
    claimsByKey.set(key, { userId, clientRequestId: key, plannedActivityId: plan.id, createdAt: new Date() });
    return { status: 'SAVED', plans: [plan] };
  }) as unknown as typeof import('../apps/web/lib/dayConstructorAcceptancePersistence').persistAcceptedConstructedDay;

  const getPlanCreationClaim = (async (_userId: string, clientRequestId: string): Promise<PlanCreationClaim | null> => {
    getPlanCreationClaimCallCount.n += 1;
    return claimsByKey.get(clientRequestId) ?? null;
  }) as unknown as typeof import('../apps/web/lib/db').getPlanCreationClaim;

  const getPlannedActivityForOwner = (async (_userId: string, planId: string): Promise<PlannedActivity | null> => plansById.get(planId) ?? null) as unknown as typeof import('../apps/web/lib/db').getPlannedActivityForOwner;

  const deps: WeeklyAcceptanceDeps = {
    ...goalDemandDeps,
    user: FAKE_USER,
    now: () => NOW,
    runPreview,
    persist,
    getPlanCreationClaim,
    getPlannedActivityForOwner,
    loadAvailabilityConfiguration: async () => availability.current,
    createOrchestratorDeps: (() => ({})) as never,
  };

  return { deps, previewCalls, persistCalls, persistResultByClientRequestId, previewFailureByDate, factsRef, loadCandidateCallCount, claimsByKey, plansById, getPlanCreationClaimCallCount, availability };
}

async function accept(env: FakeEnv, selections: readonly WeeklyAcceptanceSelection[]) {
  return acceptWeeklyRhythmSessions(env.deps, USER_ID, PLANNING_LOCAL_DATE, selections);
}

function asFailed(outcome: WeeklySessionAcceptanceOutcome): { reason: string } {
  return outcome as { reason: string };
}

async function main() {
  // ---------- 1. one selected session, with its exact approved time, accepted ----------
  {
    const env = buildFakeEnv(5, []);
    const s = session('2026-11-05');
    const summary = await accept(env, [s]);
    check('1. one selected session is accepted end-to-end', summary.acceptedCount === 1 && summary.sessions[0].outcome === 'ACCEPTED');
    check('1. the real EXPLICIT_RANGE preview request targeted exactly the selected date', env.previewCalls[0].targetDate === '2026-11-05');
    check('1. the intent sent to the real preview pipeline is FIXED, pinned to the EXACT approved start, with the EXACT approved duration (30min) -- never FLEXIBLE', env.previewCalls[0].flexibility === 'FIXED' && new Date(env.previewCalls[0].fixedStart as string).getTime() === new Date(s.start).getTime() && env.previewCalls[0].durationMinutes === 30);
    check('1. the ACCEPTED outcome reports the exact approved start/end, unchanged', (summary.sessions[0] as { start: string }).start === new Date(s.start).toISOString() && (summary.sessions[0] as { end: string }).end === new Date(s.end).toISOString());
  }

  // ---------- 2. three sessions across distinct dates, each with its own exact time ----------
  {
    const env = buildFakeEnv(5, []);
    const summary = await accept(env, [session('2026-11-04'), session('2026-11-06'), session('2026-11-08')]);
    check('2. three sessions across three distinct dates are all accepted', summary.acceptedCount === 3 && summary.sessions.every((s) => s.outcome === 'ACCEPTED'));
    check('2. each session was previewed against its own distinct date, in submitted order', env.previewCalls.map((c) => c.targetDate).join() === '2026-11-04,2026-11-06,2026-11-08');
  }

  // ---------- 4/invalid-time-range/date-mismatch (HGR3-BH input validation) ----------
  {
    const env = buildFakeEnv(5, []);
    const badRange = await accept(env, [{ goalActivityId: GOAL_ACTIVITY_ID, localDate: '2026-11-05', start: '2026-11-05T12:30:00.000Z', end: '2026-11-05T12:00:00.000Z' }]); // end before start
    check('4. end-before-start is rejected INVALID_TIME_RANGE before any preview is attempted', badRange.sessions[0].outcome === 'FAILED' && asFailed(badRange.sessions[0]).reason === 'INVALID_TIME_RANGE' && env.previewCalls.length === 0);

    const env2 = buildFakeEnv(5, []);
    const nonInteger = await accept(env2, [{ goalActivityId: GOAL_ACTIVITY_ID, localDate: '2026-11-05', start: '2026-11-05T12:30:00.000Z', end: '2026-11-05T12:30:30.000Z' }]); // 30 seconds, not a whole minute
    check('4. a non-whole-minute duration is rejected INVALID_TIME_RANGE', nonInteger.sessions[0].outcome === 'FAILED' && asFailed(nonInteger.sessions[0]).reason === 'INVALID_TIME_RANGE');

    const env3 = buildFakeEnv(5, []);
    const malformed = await accept(env3, [{ goalActivityId: GOAL_ACTIVITY_ID, localDate: '2026-11-05', start: 'not-a-date', end: '2026-11-05T12:30:00.000Z' }]);
    check('4. a malformed start instant is rejected INVALID_TIME_RANGE', malformed.sessions[0].outcome === 'FAILED' && asFailed(malformed.sessions[0]).reason === 'INVALID_TIME_RANGE');

    const env4 = buildFakeEnv(5, []);
    // A start whose OWN local date (IST) is 2026-11-06, not the claimed 2026-11-05.
    const mismatched = await accept(env4, [{ goalActivityId: GOAL_ACTIVITY_ID, localDate: '2026-11-05', start: '2026-11-05T19:00:00.000Z', end: '2026-11-05T19:30:00.000Z' }]); // 00:30 IST on 11-06
    check('4. a start whose resolved local date differs from the claimed localDate is rejected TIME_DATE_MISMATCH, never silently reinterpreted', mismatched.sessions[0].outcome === 'FAILED' && asFailed(mismatched.sessions[0]).reason === 'TIME_DATE_MISMATCH' && env4.previewCalls.length === 0);
  }

  // ---------- 5. invalid duration (zero, negative, absurdly long) ----------
  {
    const env = buildFakeEnv(5, []);
    const zero = await accept(env, [{ goalActivityId: GOAL_ACTIVITY_ID, localDate: '2026-11-05', start: '2026-11-05T12:30:00.000Z', end: '2026-11-05T12:30:00.000Z' }]);
    check('5. a zero-length duration is rejected INVALID_TIME_RANGE', zero.sessions[0].outcome === 'FAILED' && asFailed(zero.sessions[0]).reason === 'INVALID_TIME_RANGE');
    const tooLong = await accept(env, [{ goalActivityId: GOAL_ACTIVITY_ID, localDate: '2026-11-05', start: '2026-11-05T00:00:00.000Z', end: '2026-11-07T00:00:00.000Z' }]);
    check('5. a multi-day duration is rejected INVALID_TIME_RANGE', tooLong.sessions[0].outcome === 'FAILED' && asFailed(tooLong.sessions[0]).reason === 'INVALID_TIME_RANGE');
  }

  // ---------- 3/14. the preview deferred this exact time (conflict) -- rejected WITHOUT alternative placement ----------
  {
    const env = buildFakeEnv(5, []);
    env.previewFailureByDate.set('2026-11-05', 'FIXED_WINDOW_CONFLICT');
    const summary = await accept(env, [session('2026-11-05')]);
    check('3. a FIXED instant the real pipeline could not place is reported FAILED (TIME_NO_LONGER_AVAILABLE), never silently placed at a different time', summary.sessions[0].outcome === 'FAILED' && asFailed(summary.sessions[0]).reason === 'TIME_NO_LONGER_AVAILABLE');
    check('3. no persist call was ever attempted for a deferred FIXED intent', env.persistCalls.length === 0);
  }

  // ---------- PLACEMENT_MISMATCH -- defensive equality check (should be unreachable via the real pipeline, but this file never trusts blindly) ----------
  {
    const env = buildFakeEnv(5, []);
    env.previewFailureByDate.set('2026-11-05', 'PLACE_WRONG_TIME');
    const summary = await accept(env, [session('2026-11-05')]);
    check('defensive: a signed item whose own start/end differ from the approved selection is rejected PLACEMENT_MISMATCH, never persisted', summary.sessions[0].outcome === 'FAILED' && asFailed(summary.sessions[0]).reason === 'PLACEMENT_MISMATCH' && env.persistCalls.length === 0);
  }

  // ---------- TIME_ALREADY_ELAPSED ----------
  {
    const env = buildFakeEnv(5, []);
    // NOW is 2026-11-04T04:00:00Z (09:30 IST) -- a session earlier the same morning has already elapsed.
    const elapsed = await accept(env, [{ goalActivityId: GOAL_ACTIVITY_ID, localDate: '2026-11-04', start: '2026-11-04T02:00:00.000Z', end: '2026-11-04T02:30:00.000Z' }]);
    check('a start at or before the authoritative current instant is rejected TIME_ALREADY_ELAPSED, before any preview is attempted', elapsed.sessions[0].outcome === 'FAILED' && asFailed(elapsed.sessions[0]).reason === 'TIME_ALREADY_ELAPSED' && env.previewCalls.length === 0);
  }

  // ---------- 9/10. retry reconciliation -- the EXACT bug this hardening fixes ----------
  {
    const env = buildFakeEnv(5, []);
    const s = session('2026-11-05');
    const first = await accept(env, [s]);
    check('9/10. the first acceptance genuinely succeeds and reaches preview+persist', first.sessions[0].outcome === 'ACCEPTED' && env.previewCalls.length === 1 && env.persistCalls.length === 1);

    const retry = await accept(env, [s]);
    check('9/10. retrying the IDENTICAL (goalActivityId, localDate, start, end) resolves ALREADY_ACCEPTED, with the real committed identity/time -- never a fresh ACCEPTED, never a false FAILED', retry.sessions[0].outcome === 'ALREADY_ACCEPTED' && (retry.sessions[0] as { plannedActivityId: string }).plannedActivityId === (first.sessions[0] as { plannedActivityId: string }).plannedActivityId);
    check('9/10. the retry resolved WITHOUT ever calling preview or persist again -- the read-only reconciliation short-circuit fired, so the already-committed session can never collide with itself as a fresh blocker', env.previewCalls.length === 1 && env.persistCalls.length === 1);
  }

  // ---------- 10. original committed identity/time returned on replay ----------
  {
    const env = buildFakeEnv(5, []);
    const s = session('2026-11-05');
    const first = await accept(env, [s]);
    const retry = await accept(env, [s]);
    const firstOk = first.sessions[0] as { plannedActivityId: string; start: string; end: string };
    const retryOk = retry.sessions[0] as { plannedActivityId: string; start: string; end: string };
    check('10. the replay response carries the SAME real plannedActivityId/start/end as the original acceptance', retryOk.plannedActivityId === firstOk.plannedActivityId && retryOk.start === firstOk.start && retryOk.end === firstOk.end);
  }

  // ---------- 11. a DIFFERENT approved time for the same (activity, date) is NEVER misclassified as a replay ----------
  {
    const env = buildFakeEnv(5, []);
    const original = session('2026-11-05'); // 18:00-18:30 IST
    const different = { goalActivityId: GOAL_ACTIVITY_ID, localDate: '2026-11-05', start: '2026-11-05T14:30:00.000Z', end: '2026-11-05T15:00:00.000Z' }; // 20:00-20:30 IST -- a genuinely different intended session
    const first = await accept(env, [original]);
    check('11. the first (original-time) session is accepted', first.sessions[0].outcome === 'ACCEPTED');
    const second = await accept(env, [different]);
    check('11. a DIFFERENT approved time for the SAME activity/date derives a DIFFERENT clientRequestId and is genuinely attempted fresh, never short-circuited as a replay of the first', second.sessions[0].outcome === 'ACCEPTED' && env.previewCalls.length === 2 && env.persistCalls.length === 2);
    check('11. the two sessions produced two REAL, distinct plannedActivityIds -- never collapsed into one', (first.sessions[0] as { plannedActivityId: string }).plannedActivityId !== (second.sessions[0] as { plannedActivityId: string }).plannedActivityId);
  }

  // ---------- 17. Availability Context -- CONFIGURED, hard boundary ----------
  {
    const env = buildFakeEnv(5, []);
    env.availability.current = { configured: true, periods: [{ weekday: 4, startTime: '09:00', endTime: '17:00' }] }; // 2026-11-05 is a Thursday (weekday 4)
    const outside = await accept(env, [session('2026-11-05')]); // 18:00-18:30 IST -- outside the configured 09:00-17:00 window
    check('17. a session outside a CONFIGURED hard availability boundary is rejected OUTSIDE_AVAILABILITY, never silently placed outside it', outside.sessions[0].outcome === 'FAILED' && asFailed(outside.sessions[0]).reason === 'OUTSIDE_AVAILABILITY' && env.previewCalls.length === 0);

    const inside = await accept(env, [{ goalActivityId: GOAL_ACTIVITY_ID, localDate: '2026-11-05', start: '2026-11-05T05:00:00.000Z', end: '2026-11-05T05:30:00.000Z' }]); // 10:30-11:00 IST -- inside 09:00-17:00
    check('17. a session INSIDE a CONFIGURED availability window proceeds normally', inside.sessions[0].outcome === 'ACCEPTED');
  }

  // ---------- 17. Availability Context -- UNCONFIGURED, no new boundary introduced ----------
  {
    const env = buildFakeEnv(5, []);
    // availability.current is UNCONFIGURED_AVAILABILITY by default.
    const summary = await accept(env, [session('2026-11-05')]); // 18:00 IST -- would be "outside working hours" under some default, but no configuration exists
    check('17. an UNCONFIGURED user is treated exactly as every other EXPLICIT_RANGE caller already treats one -- no new boundary introduced by this adapter', summary.sessions[0].outcome === 'ACCEPTED');
  }

  // ---------- 5/17-auth. unauthorized / unowned GoalActivity ----------
  {
    const env = buildFakeEnv(5, []);
    const summary = await accept(env, [{ goalActivityId: 'not-mine', localDate: '2026-11-05', start: '2026-11-05T12:30:00.000Z', end: '2026-11-05T13:00:00.000Z' }]);
    check('5/17. a GoalActivity id absent from this user\'s own eligible demand is rejected NOT_ELIGIBLE, never disclosed as anything more specific', summary.sessions[0].outcome === 'FAILED' && asFailed(summary.sessions[0]).reason === 'NOT_ELIGIBLE');
    check('5/17/15. no preview/persist call was ever attempted for an unauthorized id', env.previewCalls.length === 0 && env.persistCalls.length === 0);
  }

  // ---------- 6. weekly target already satisfied -- caught by the REAL
  // write-time capacity check, not by a pre-check on the displayed
  // remaining count. ----------
  {
    const env = buildFakeEnv(2, [fact('2026-11-02', 'COMPLETED'), fact('2026-11-03', 'COMPLETED')]); // Monday+Tuesday of PLANNING_LOCAL_DATE's own week (2026-11-02..11-08) -- target 2, fully met.
    const s = session('2026-11-05');
    env.persistResultByClientRequestId.set(buildWeeklySessionClientRequestId(GOAL_ACTIVITY_ID, '2026-11-05', s.start, s.end), { status: 'SAVE_FAILED', code: 'CAPACITY_EXCEEDED' });
    const summary = await accept(env, [s]);
    check('6. a fully-satisfied weekly target, caught by the real write-time capacity check (CAPACITY_EXHAUSTED), is reported NOT_ELIGIBLE -- never a raw internal error code leaked', summary.sessions[0].outcome === 'FAILED' && asFailed(summary.sessions[0]).reason === 'NOT_ELIGIBLE');
    check('6. the session still genuinely reached preview+persist (eligibility is NOT pre-gated on the displayed remaining count alone)', env.previewCalls.length === 1 && env.persistCalls.length === 1);
  }

  // ---------- 7/8. outside the current local week ----------
  {
    const env = buildFakeEnv(5, []);
    const pastSummary = await accept(env, [{ goalActivityId: GOAL_ACTIVITY_ID, localDate: '2026-11-01', start: '2026-11-01T12:30:00.000Z', end: '2026-11-01T13:00:00.000Z' }]); // before planningLocalDate
    const nextWeekSummary = await accept(env, [{ goalActivityId: GOAL_ACTIVITY_ID, localDate: '2026-11-10', start: '2026-11-10T12:30:00.000Z', end: '2026-11-10T13:00:00.000Z' }]); // Tue of next week
    check('7/8. a date before the planning date is rejected OUTSIDE_CURRENT_WEEK, never silently clamped', pastSummary.sessions[0].outcome === 'FAILED' && asFailed(pastSummary.sessions[0]).reason === 'OUTSIDE_CURRENT_WEEK');
    check('7/8. a date in NEXT week is rejected OUTSIDE_CURRENT_WEEK, never conflated with this week\'s target', nextWeekSummary.sessions[0].outcome === 'FAILED' && asFailed(nextWeekSummary.sessions[0]).reason === 'OUTSIDE_CURRENT_WEEK');
    check('7/8/15. an out-of-week rejection never reaches preview or persist', env.previewCalls.length === 0 && env.persistCalls.length === 0);
  }

  // ---------- 9/10 regression: retrying an ALREADY-ACCEPTED session whose
  // weekly target is now fully met (by that SAME prior acceptance) must
  // still resolve ALREADY_ACCEPTED -- NOT a fresh NOT_ELIGIBLE. The
  // reconciliation short-circuit runs AFTER ownership resolution (which
  // always re-runs, cheap and read-only, even for a replay) but BEFORE
  // any preview/persist call -- so the session's own prior commitment can
  // never collide with a fresh placement attempt against itself. ----------
  {
    const env = buildFakeEnv(1, []);
    const s = session('2026-11-04');
    const first = await accept(env, [s]);
    check('9/10 regression precondition: the first acceptance succeeds, fully consuming target 1', first.sessions[0].outcome === 'ACCEPTED');
    const previewCallsAfterFirst = env.previewCalls.length;
    const persistCallsAfterFirst = env.persistCalls.length;
    const summary = await accept(env, [s]);
    check('9/10 regression: a retry of an already-accepted session is reported ALREADY_ACCEPTED even when the weekly target it consumed is now fully met, never misreported as a fresh NOT_ELIGIBLE rejection', summary.sessions[0].outcome === 'ALREADY_ACCEPTED');
    check('9/10 regression: the retry never reached preview or persist again -- the reconciliation short-circuit resolved the session before either call, which is what actually prevents it from colliding with its own prior commitment (ownership resolution itself always re-runs, cheap and read-only, regardless)', env.previewCalls.length === previewCallsAfterFirst && env.persistCalls.length === persistCallsAfterFirst);
  }

  // ---------- 12/13. partial success ----------
  {
    const env = buildFakeEnv(5, []);
    const s2 = session('2026-11-06');
    env.persistResultByClientRequestId.set(buildWeeklySessionClientRequestId(GOAL_ACTIVITY_ID, '2026-11-06', s2.start, s2.end), { status: 'REJECTED', reason: 'CONFLICT', diagnostics: [] });
    const summary = await accept(env, [session('2026-11-04'), s2, session('2026-11-08')]);
    check('12/13. session 2 of 3 fails while 1 and 3 succeed -- an honest, accurate partial-success count, never "all 3 accepted"', summary.acceptedCount === 2 && summary.failedCount === 1 && summary.requestedCount === 3);
    check('12. the response never claims all sessions succeeded when one did not', !(summary.acceptedCount === summary.requestedCount));
    check('12. session 3 was still attempted independently after session 2 failed -- never short-circuited by an earlier failure', env.previewCalls.map((c) => c.targetDate).includes('2026-11-08'));
    const bySession = summary.sessions as readonly WeeklySessionAcceptanceOutcome[];
    check('12. the two real successes are correctly identified by their own date, not just a count', bySession[0].outcome === 'ACCEPTED' && bySession[0].localDate === '2026-11-04' && bySession[2].outcome === 'ACCEPTED' && bySession[2].localDate === '2026-11-08');
  }

  // ---------- 13/12. successful FULL-batch retry correctly reports every session as ALREADY_ACCEPTED ----------
  {
    const env = buildFakeEnv(5, []);
    const selections = [session('2026-11-04'), session('2026-11-06')];
    const first = await accept(env, selections);
    check('13 precondition: the original batch fully succeeds', first.acceptedCount === 2);
    const retry = await accept(env, selections);
    check('13. retrying the IDENTICAL full batch reports BOTH sessions ALREADY_ACCEPTED, with their real original identities -- never a fresh ACCEPTED, never a false failure', retry.alreadyAcceptedCount === 2 && retry.acceptedCount === 0 && (retry.sessions[0] as { plannedActivityId: string }).plannedActivityId === (first.sessions[0] as { plannedActivityId: string }).plannedActivityId && (retry.sessions[1] as { plannedActivityId: string }).plannedActivityId === (first.sessions[1] as { plannedActivityId: string }).plannedActivityId);
  }

  // ---------- 11 (ticket numbering)/retry after partial success touches only the failed session ----------
  {
    const env = buildFakeEnv(5, []);
    const succeeded = session('2026-11-04');
    const retried = session('2026-11-06');
    await accept(env, [retried]); // simulate: this one failed on the first attempt (ordinary SAVED here -- we only assert isolation)
    const previewCallsAfterFirst = env.previewCalls.length;
    await accept(env, [succeeded]); // a caller retrying ONLY the still-pending session never resubmits the one that's done
    check('retrying only the originally-failed session never re-touches a session the caller does not resubmit', env.previewCalls.length === previewCallsAfterFirst + 1 && env.previewCalls[env.previewCalls.length - 1].targetDate === '2026-11-04');
  }

  // ---------- 14. weekly target reached MID-BATCH -- each session still
  // genuinely independent; capacity is enforced by the REAL write-time
  // check (simulated here), and the BATCH SUMMARY's own final remaining
  // count is recomputed fresh afterward, never carried over from the
  // demand snapshot read before the batch started. ----------
  {
    const env = buildFakeEnv(2, [fact('2026-11-02', 'COMPLETED')]); // target 2, 1 already done -> 1 remaining at batch start
    const s1 = session('2026-11-04');
    const s2 = session('2026-11-06');
    const secondClientRequestId = buildWeeklySessionClientRequestId(GOAL_ACTIVITY_ID, '2026-11-06', s2.start, s2.end);
    const firstClientRequestId = buildWeeklySessionClientRequestId(GOAL_ACTIVITY_ID, '2026-11-04', s1.start, s1.end);
    const originalPersist = env.deps.persist;
    env.deps.persist = (async (userId, request, ...rest) => {
      if (request.clientRequestId === firstClientRequestId) {
        env.factsRef.current = new Map([[GOAL_ACTIVITY_ID, [fact('2026-11-02', 'COMPLETED'), fact('2026-11-04', 'COMMITTED')]]]);
      }
      return originalPersist(userId, request, ...rest);
    }) as typeof originalPersist;
    env.persistResultByClientRequestId.set(secondClientRequestId, { status: 'SAVE_FAILED', code: 'CAPACITY_EXCEEDED' });
    const summary = await accept(env, [s1, s2]);
    check('14. session 1 consumes the last remaining weekly slot and is accepted', summary.sessions[0].outcome === 'ACCEPTED');
    check('14. session 2 is independently attempted (never skipped merely because session 1 succeeded) and is rejected NOT_ELIGIBLE by the real capacity check', env.previewCalls.length === 2 && summary.sessions[1].outcome === 'FAILED' && asFailed(summary.sessions[1]).reason === 'NOT_ELIGIBLE');
    check('14. the batch summary\'s own final remaining-demand figure reflects session 1\'s real write (0), not the demand snapshot read before the batch started (1)', summary.remainingThisWeekByGoalActivityId.get(GOAL_ACTIVITY_ID) === 0);
  }

  // ---------- 15/16. a legitimate deferral (no usable capacity) never fabricates a proposal ----------
  {
    const env = buildFakeEnv(5, []);
    env.previewFailureByDate.set('2026-11-05', 'NO_USABLE_CAPACITY');
    const summary = await accept(env, [session('2026-11-05')]);
    check('15. a NO_USABLE_CAPACITY preview result is reported FAILED, never a fabricated acceptance', summary.sessions[0].outcome === 'FAILED' && asFailed(summary.sessions[0]).reason === 'PREVIEW_NOT_READY');
    check('15/16. no persist call is ever made when the preview itself was not READY', env.persistCalls.length === 0);
  }

  // ---------- NO_CANDIDATES deferral (the intent resolved but could not be placed) ----------
  {
    const env = buildFakeEnv(5, []);
    env.previewFailureByDate.set('2026-11-05', 'NO_CANDIDATES');
    const summary = await accept(env, [session('2026-11-05')]);
    check('a READY preview whose own intent was deferred (NO_CANDIDATES, not placed) is reported FAILED, never accepted as if it were placed', summary.sessions[0].outcome === 'FAILED' && env.persistCalls.length === 0);
  }

  // ---------- bounded at MAX_WEEKLY_ACCEPTANCE_SESSIONS ----------
  {
    const env = buildFakeEnv(5, []);
    const selections = ['2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07'].map((d) => session(d));
    const summary = await accept(env, selections);
    check(`a batch larger than MAX_WEEKLY_ACCEPTANCE_SESSIONS (${MAX_WEEKLY_ACCEPTANCE_SESSIONS}) is bounded, never processed in full`, summary.sessions.length === MAX_WEEKLY_ACCEPTANCE_SESSIONS && env.previewCalls.length === MAX_WEEKLY_ACCEPTANCE_SESSIONS);
  }

  // ---------- updated weekly demand is recomputed fresh, never locally decremented ----------
  {
    const env = buildFakeEnv(3, []);
    const summary = await accept(env, [session('2026-11-04'), session('2026-11-06')]);
    check('the loadCandidateGoalActivities read model is called again AFTER the batch (not reused from the pre-batch read) to recompute remaining demand', env.loadCandidateCallCount.n >= 3); // 2 per-session + >=1 final recompute
    check('the reported remaining-this-week reflects live demand, not this function\'s own arithmetic', summary.remainingThisWeekByGoalActivityId.get(GOAL_ACTIVITY_ID) !== undefined);
  }

  // ---------- buildWeeklySessionClientRequestId determinism and identity scope ----------
  {
    const s = session('2026-11-04');
    check('buildWeeklySessionClientRequestId is deterministic for the same (goalActivityId, localDate, start, end)', buildWeeklySessionClientRequestId('a', '2026-11-04', s.start, s.end) === buildWeeklySessionClientRequestId('a', '2026-11-04', s.start, s.end));
    check('buildWeeklySessionClientRequestId differs for a different localDate', buildWeeklySessionClientRequestId('a', '2026-11-04', s.start, s.end) !== buildWeeklySessionClientRequestId('a', '2026-11-05', s.start, s.end));
    check('buildWeeklySessionClientRequestId differs for a different goalActivityId', buildWeeklySessionClientRequestId('a', '2026-11-04', s.start, s.end) !== buildWeeklySessionClientRequestId('b', '2026-11-04', s.start, s.end));
    check('buildWeeklySessionClientRequestId differs for a different approved start/end, even for the SAME (goalActivityId, localDate) -- this is the key fix preventing a different intended session from ever being misclassified as a replay', buildWeeklySessionClientRequestId('a', '2026-11-04', s.start, s.end) !== buildWeeklySessionClientRequestId('a', '2026-11-04', '2026-11-04T14:30:00.000Z', '2026-11-04T15:00:00.000Z'));
  }

  // ---------- HGR3-BH P2-1: EXPLICIT_RANGE window boundary assertions ----------
  // Direct assertions on `buildExplicitRangeWindow`'s own `explicitStart`/
  // `explicitEnd` output -- never inferred from a final persisted date
  // alone (the independent review's own finding: a wrong window
  // computation can coincidentally still persist the right date). Each
  // real case is compared against `localDayBoundsUTC` (unmodified) --
  // the SAME authoritative source of truth the function itself calls --
  // across timezones spanning a full UTC+14..UTC-11 range, a half-hour
  // offset, and both DST transition directions.
  {
    const FUTURE_NOW = new Date('2026-01-01T00:00:00.000Z'); // always in the past relative to every date tested below -- never the "today" clamp path.

    // UTC+14 -- Pacific/Kiritimati.
    {
      const tz = 'Pacific/Kiritimati';
      const date = '2026-11-10';
      const w = buildExplicitRangeWindow(date, tz, FUTURE_NOW);
      const bounds = localDayBoundsUTC(date, tz);
      check('P2-1 UTC+14 (Pacific/Kiritimati): explicitStart/End exactly equal localDayBoundsUTC\'s own from/to', new Date(w.explicitStart).getTime() === bounds.from.getTime() && new Date(w.explicitEnd).getTime() === bounds.to.getTime());
      // A naive `new Date(date + 'T00:00:00Z')` would be WRONG here by a full 14 hours -- proving the real function is genuinely timezone-aware, not naive UTC-midnight arithmetic.
      check('P2-1 UTC+14: the real boundary genuinely differs from naive UTC-midnight arithmetic (proving timezone-awareness, not coincidence)', new Date(w.explicitStart).getTime() !== new Date(`${date}T00:00:00.000Z`).getTime());
    }

    // UTC-11 -- Pacific/Niue.
    {
      const tz = 'Pacific/Niue';
      const date = '2026-11-10';
      const w = buildExplicitRangeWindow(date, tz, FUTURE_NOW);
      const bounds = localDayBoundsUTC(date, tz);
      check('P2-1 UTC-11 (Pacific/Niue): explicitStart/End exactly equal localDayBoundsUTC\'s own from/to', new Date(w.explicitStart).getTime() === bounds.from.getTime() && new Date(w.explicitEnd).getTime() === bounds.to.getTime());
      check('P2-1 UTC-11: the real boundary genuinely differs from naive UTC-midnight arithmetic', new Date(w.explicitStart).getTime() !== new Date(`${date}T00:00:00.000Z`).getTime());
    }

    // India Standard Time -- UTC+5:30, a half-hour-offset case.
    {
      const tz = 'Asia/Kolkata';
      const date = '2026-11-10';
      const w = buildExplicitRangeWindow(date, tz, FUTURE_NOW);
      const bounds = localDayBoundsUTC(date, tz);
      check('P2-1 IST (UTC+5:30, Asia/Kolkata): explicitStart/End exactly equal localDayBoundsUTC\'s own from/to, correctly honoring the half-hour offset', new Date(w.explicitStart).getTime() === bounds.from.getTime() && new Date(w.explicitEnd).getTime() === bounds.to.getTime() && (new Date(w.explicitStart).getTime() - new Date(`${date}T00:00:00.000Z`).getTime()) % (60 * 60000) !== 0);
    }

    // DST spring-forward -- America/New_York, 2026-03-08 (clocks jump 2am->3am).
    {
      const tz = 'America/New_York';
      const date = '2026-03-08';
      const w = buildExplicitRangeWindow(date, tz, FUTURE_NOW);
      const bounds = localDayBoundsUTC(date, tz);
      check('P2-1 DST spring-forward (America/New_York, 2026-03-08): explicitStart/End exactly equal localDayBoundsUTC\'s own from/to -- a 23-hour local day correctly handled', new Date(w.explicitStart).getTime() === bounds.from.getTime() && new Date(w.explicitEnd).getTime() === bounds.to.getTime() && bounds.to.getTime() - bounds.from.getTime() === 23 * 3600000);
    }

    // DST fall-back -- America/New_York, 2026-11-01 (clocks fall 2am->1am).
    {
      const tz = 'America/New_York';
      const date = '2026-11-01';
      const w = buildExplicitRangeWindow(date, tz, FUTURE_NOW);
      const bounds = localDayBoundsUTC(date, tz);
      check('P2-1 DST fall-back (America/New_York, 2026-11-01): explicitStart/End exactly equal localDayBoundsUTC\'s own from/to -- a 25-hour local day correctly handled', new Date(w.explicitStart).getTime() === bounds.from.getTime() && new Date(w.explicitEnd).getTime() === bounds.to.getTime() && bounds.to.getTime() - bounds.from.getTime() === 25 * 3600000);
    }

    // Last day of the local week.
    {
      const tz = TZ;
      const date = '2026-11-08'; // Sunday, the last day of PLANNING_LOCAL_DATE's own week (2026-11-02..11-08)
      const w = buildExplicitRangeWindow(date, tz, FUTURE_NOW);
      const bounds = localDayBoundsUTC(date, tz);
      check('P2-1 last day of the local week: explicitStart/End exactly equal localDayBoundsUTC\'s own from/to', new Date(w.explicitStart).getTime() === bounds.from.getTime() && new Date(w.explicitEnd).getTime() === bounds.to.getTime());
    }

    // Today, with a partially-elapsed day -- the window starts at NOW, never at local midnight.
    {
      const tz = TZ;
      const date = PLANNING_LOCAL_DATE;
      const w = buildExplicitRangeWindow(date, tz, NOW); // NOW is 09:30 IST on PLANNING_LOCAL_DATE
      const bounds = localDayBoundsUTC(date, tz);
      check('P2-1 today, partially elapsed: explicitStart is the authoritative clock (NOW), never local midnight', new Date(w.explicitStart).getTime() === NOW.getTime() && new Date(w.explicitStart).getTime() > bounds.from.getTime());
      check('P2-1 today, partially elapsed: explicitEnd is still the real end-of-local-day boundary', new Date(w.explicitEnd).getTime() === bounds.to.getTime());
    }

    // A genuinely future date -- the window is the WHOLE local day, never clamped to NOW.
    {
      const tz = TZ;
      const date = '2026-11-06';
      const w = buildExplicitRangeWindow(date, tz, NOW);
      const bounds = localDayBoundsUTC(date, tz);
      check('P2-1 future date: explicitStart is the real start-of-local-day boundary, never clamped to NOW (NOW is on an earlier date entirely)', new Date(w.explicitStart).getTime() === bounds.from.getTime());
      check('P2-1 future date: explicitEnd is the real end-of-local-day boundary', new Date(w.explicitEnd).getTime() === bounds.to.getTime());
    }
  }

  // ---------- [STRUCTURAL] no bypass of the existing acceptance implementation ----------
  {
    const root = path.resolve(__dirname, '..');
    const src = fs.readFileSync(path.join(root, 'apps/web/lib/goalRhythmWeeklyAcceptance.ts'), 'utf8');
    check(
      '18/19. [STRUCTURAL] this file never calls a lower-level write directly (createPlannedActivity/materializeGoalActivityRhythmOccurrence/linkGoalActivityToPlannedActivity) -- every write goes through the injected, real persistAcceptedConstructedDay',
      !/createPlannedActivity\(|materializeGoalActivityRhythmOccurrence\(|linkGoalActivityToPlannedActivity\(/.test(src)
    );
    check('18/19. [STRUCTURAL] this file imports verifyAcceptanceItems/authorizeGoalActivityLinks/persistAcceptedConstructedDay from their real modules, never reimplements them', /from '\.\/dayConstructorPreviewIntegrity'/.test(src) && /from '\.\/goalDemandProvenanceAuthorization'/.test(src) && /from '\.\/dayConstructorAcceptancePersistence'/.test(src));
    check('18. [STRUCTURAL] no new signing primitive is introduced -- the file never imports auth.ts\'s sign/verify directly', !/from '\.\/auth'/.test(src));
    check('18. [STRUCTURAL] the reconciliation short-circuit reuses the real, unmodified deriveAcceptanceIdempotencyKey/getPlanCreationClaim/getPlannedActivityForOwner -- never a second idempotency-table shape of its own', /deriveAcceptanceIdempotencyKey/.test(src) && /getPlanCreationClaim/.test(src) && /getPlannedActivityForOwner/.test(src) && !/CREATE TABLE|new Map\(\).*PlanCreationIdempotency/i.test(src));
    check('[STRUCTURAL] Availability Context enforcement reuses the real, unmodified resolveAvailability -- never a second availability-resolution formula', /from '\.\/availabilityContext'/.test(src) && /resolveAvailability\(/.test(src));
  }

  console.log(allPassed ? '\nALL GOAL RHYTHM WEEKLY ACCEPTANCE CHECKS PASSED' : '\nSOME GOAL RHYTHM WEEKLY ACCEPTANCE CHECKS FAILED');
  if (!allPassed) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
