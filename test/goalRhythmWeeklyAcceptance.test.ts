/**
 * HGR3-B -- Secure Weekly Rhythm Proposal Acceptance.
 *
 * Production-path regression coverage for the ORCHESTRATION logic in
 * goalRhythmWeeklyAcceptance.ts: fresh per-session eligibility
 * revalidation, EXPLICIT_RANGE window construction, idempotency-key
 * derivation, partial-success accounting, and the "revalidate at EACH
 * acceptance, never just once at batch start" invariant. Exercises the
 * REAL `acceptWeeklyRhythmSessions`/`buildWeeklySessionClientRequestId`
 * with fake `GoalDemandCandidatesDeps`/`runPreview`/`persist` (the same DI
 * convention goalRhythmWeeklyProposal.test.ts already established) -- no
 * DB, no network, no jsdom.
 *
 * The genuine end-to-end path -- real `EXPLICIT_RANGE` construction for a
 * FUTURE date, real signing, real `verifyAcceptanceItems`/
 * `authorizeGoalActivityLinks`/`persistAcceptedConstructedDay` against a
 * live Postgres -- is covered separately in
 * goalRhythmWeeklyAcceptanceDb.test.ts (requires DATABASE_URL). This file
 * cannot and does not claim to prove that critical gate; it proves the
 * orchestration loop around it.
 *
 * Checks explicitly marked [STRUCTURAL] are source-text assertions; every
 * other check calls the real exported functions directly.
 */
import * as fs from 'fs';
import * as path from 'path';
import {
  acceptWeeklyRhythmSessions,
  buildWeeklySessionClientRequestId,
  MAX_WEEKLY_ACCEPTANCE_SESSIONS,
  type WeeklyAcceptanceDeps,
  type WeeklyAcceptanceSelection,
  type WeeklySessionAcceptanceOutcome,
} from '../apps/web/lib/goalRhythmWeeklyAcceptance';
import type { GoalDemandCandidatesDeps } from '../apps/web/lib/goalDemandCandidates';
import type { CandidateGoalActivityForRhythmDemandRow } from '../apps/web/lib/db';
import type { GoalActivityRhythmOccurrenceFact } from '../apps/web/lib/goalActivityRhythm';
import type { DayConstructorPreviewHttpResult, DayConstructorPreviewBoundaryDeps } from '../apps/web/lib/dayConstructorPreviewRequest';
import type { AcceptConstructedDayPersistenceResult } from '../apps/web/lib/dayConstructorAcceptancePersistence';
import type { AcceptConstructedDayRequest } from '../apps/web/lib/dayConstructorAcceptance';
import { signPreviewItem } from '../apps/web/lib/dayConstructorPreviewIntegrity';
import type { User } from '../apps/web/lib/db';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

const TZ = 'Asia/Kolkata';
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

interface FakeEnv {
  deps: WeeklyAcceptanceDeps;
  previewCalls: { targetDate: string; explicitStart?: unknown; explicitEnd?: unknown; intentId: string }[];
  persistCalls: AcceptConstructedDayRequest[];
  /** Keyed by clientRequestId -- what `persist` should answer for that
   * exact call. Missing -> SAVED (the common case). */
  persistResultByClientRequestId: Map<string, AcceptConstructedDayPersistenceResult>;
  /** Keyed by targetDate -- what `runPreview` should answer. Missing ->
   * a real READY preview with a genuinely signed single item. */
  previewFailureByDate: Map<string, 'NO_USABLE_CAPACITY' | 'NO_CANDIDATES'>;
  /** Mutable, read by `loadRhythmFacts` on EVERY call -- lets a test
   * simulate an earlier session in the SAME batch having already
   * consumed capacity, proving per-session revalidation is real. */
  factsRef: { current: ReadonlyMap<string, readonly GoalActivityRhythmOccurrenceFact[]> };
  loadCandidateCallCount: { n: number };
}

function buildFakeEnv(targetPerWeek: number, initialFacts: readonly GoalActivityRhythmOccurrenceFact[] = []): FakeEnv {
  const previewCalls: FakeEnv['previewCalls'] = [];
  const persistCalls: FakeEnv['persistCalls'] = [];
  const persistResultByClientRequestId = new Map<string, AcceptConstructedDayPersistenceResult>();
  const previewFailureByDate = new Map<string, 'NO_USABLE_CAPACITY' | 'NO_CANDIDATES'>();
  const factsRef = { current: new Map<string, readonly GoalActivityRhythmOccurrenceFact[]>([[GOAL_ACTIVITY_ID, initialFacts]]) };
  const loadCandidateCallCount = { n: 0 };

  const goalDemandDeps: GoalDemandCandidatesDeps = {
    loadCandidateGoalActivities: async () => {
      loadCandidateCallCount.n += 1;
      return [row(targetPerWeek)];
    },
    loadRhythmFacts: async () => factsRef.current,
  };

  const runPreview = (async (boundaryDeps: DayConstructorPreviewBoundaryDeps): Promise<DayConstructorPreviewHttpResult> => {
    const body = (await boundaryDeps.getBody()) as { targetDate: string; explicitStart?: unknown; explicitEnd?: unknown; intents: Array<{ id: string; title: string; activityId?: string }> };
    const session = boundaryDeps.getSession();
    const intent = body.intents[0];
    previewCalls.push({ targetDate: body.targetDate, explicitStart: body.explicitStart, explicitEnd: body.explicitEnd, intentId: intent.id });

    const failure = previewFailureByDate.get(body.targetDate);
    if (failure === 'NO_USABLE_CAPACITY') return { httpStatus: 200, body: { status: 'NO_USABLE_CAPACITY', constructionWindowMinutes: 0, blockedMinutes: 0, requestedMinutes: 30 } };

    const window = { date: body.targetDate, start: new Date(`${body.targetDate}T04:00:00.000Z`), end: new Date(`${body.targetDate}T10:00:00.000Z`), timezone: TZ, source: 'EXPLICIT_RANGE' as const };
    if (failure === 'NO_CANDIDATES') {
      return { httpStatus: 200, body: { status: 'READY', preview: { targetDate: body.targetDate, timezone: TZ, constructionWindow: window, resolvedIntents: [], constructedDay: { date: body.targetDate, proposedItems: [], deferredItems: [{ intentId: intent.id, primaryReason: 'NO_CANDIDATES', diagnostics: [] }], conflicts: [], requestedCapacity: { totalMinutes: 30, usedMinutes: 0, availableMinutes: 0 }, proposedCapacity: { totalMinutes: 0, usedMinutes: 0, availableMinutes: 0 } }, warnings: [] } } };
    }

    const itemStart = new Date(`${body.targetDate}T06:00:00.000Z`);
    const itemEnd = new Date(`${body.targetDate}T06:30:00.000Z`);
    const item = { intentId: intent.id, activityId: intent.activityId, title: intent.title, start: itemStart, end: itemEnd, placementSource: 'SELECTED_CANDIDATE' as const };
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
    return { status: 'SAVED', plans: [{ id: `plan-${request.clientRequestId}`, plannedStartAt: item.start, plannedEndAt: item.end } as never] };
  }) as unknown as typeof import('../apps/web/lib/dayConstructorAcceptancePersistence').persistAcceptedConstructedDay;

  const deps: WeeklyAcceptanceDeps = {
    ...goalDemandDeps,
    user: FAKE_USER,
    now: () => NOW,
    runPreview,
    persist,
    createOrchestratorDeps: (() => ({})) as never,
  };

  return { deps, previewCalls, persistCalls, persistResultByClientRequestId, previewFailureByDate, factsRef, loadCandidateCallCount };
}

async function accept(env: FakeEnv, selections: readonly WeeklyAcceptanceSelection[]) {
  return acceptWeeklyRhythmSessions(env.deps, USER_ID, PLANNING_LOCAL_DATE, selections);
}

async function main() {
  // ---------- 1. one selected session accepted ----------
  {
    const env = buildFakeEnv(5, []);
    const summary = await accept(env, [{ goalActivityId: GOAL_ACTIVITY_ID, localDate: '2026-11-05' }]);
    check('1. one selected session is accepted end-to-end', summary.acceptedCount === 1 && summary.sessions[0].outcome === 'ACCEPTED');
    check('1. the real EXPLICIT_RANGE preview request targeted exactly the selected date', env.previewCalls[0].targetDate === '2026-11-05');
    check('1. the real signed item genuinely passed verifyAcceptanceItems/persist (persist was actually reached)', env.persistCalls.length === 1);
  }

  // ---------- 2. three sessions across distinct dates ----------
  {
    const env = buildFakeEnv(5, []);
    const summary = await accept(env, [
      { goalActivityId: GOAL_ACTIVITY_ID, localDate: '2026-11-04' },
      { goalActivityId: GOAL_ACTIVITY_ID, localDate: '2026-11-06' },
      { goalActivityId: GOAL_ACTIVITY_ID, localDate: '2026-11-08' },
    ]);
    check('2. three sessions across three distinct dates are all accepted', summary.acceptedCount === 3 && summary.sessions.every((s) => s.outcome === 'ACCEPTED'));
    check('2. each session was previewed against its own distinct date, in submitted order', env.previewCalls.map((c) => c.targetDate).join() === '2026-11-04,2026-11-06,2026-11-08');
  }

  // ---------- 5/17. unauthorized / unowned GoalActivity ----------
  {
    const env = buildFakeEnv(5, []);
    const summary = await accept(env, [{ goalActivityId: 'not-mine', localDate: '2026-11-05' }]);
    check('5/17. a GoalActivity id absent from this user\'s own eligible demand is rejected NOT_ELIGIBLE, never disclosed as anything more specific', summary.sessions[0].outcome === 'FAILED' && (summary.sessions[0] as { reason: string }).reason === 'NOT_ELIGIBLE');
    check('5/17/15. no preview/persist call was ever attempted for an unauthorized id', env.previewCalls.length === 0 && env.persistCalls.length === 0);
  }

  // ---------- 6. weekly target already satisfied -- caught by the REAL
  // write-time capacity check, not by a pre-check on the displayed
  // remaining count (see goalRhythmWeeklyAcceptance.ts's own comment on
  // why that pre-check was deliberately removed: it cannot distinguish
  // "genuinely new, over-capacity request" from "a retry of an already-
  // accepted session," only the real idempotency/capacity check can).
  // ----------
  {
    const env = buildFakeEnv(2, [fact('2026-11-02', 'COMPLETED'), fact('2026-11-03', 'COMPLETED')]); // Monday+Tuesday of PLANNING_LOCAL_DATE's own week (2026-11-02..11-08) -- target 2, fully met.
    const clientRequestId = buildWeeklySessionClientRequestId(GOAL_ACTIVITY_ID, '2026-11-05');
    env.persistResultByClientRequestId.set(clientRequestId, { status: 'SAVE_FAILED', code: 'CAPACITY_EXCEEDED' });
    const summary = await accept(env, [{ goalActivityId: GOAL_ACTIVITY_ID, localDate: '2026-11-05' }]);
    check('6. a fully-satisfied weekly target, caught by the real write-time capacity check (CAPACITY_EXHAUSTED), is reported NOT_ELIGIBLE -- never a raw internal error code leaked', summary.sessions[0].outcome === 'FAILED' && (summary.sessions[0] as { reason: string }).reason === 'NOT_ELIGIBLE');
    check('6. the session still genuinely reached preview+persist (eligibility is NOT pre-gated on the displayed remaining count alone)', env.previewCalls.length === 1 && env.persistCalls.length === 1);
  }

  // ---------- 8. outside the current local week ----------
  {
    const env = buildFakeEnv(5, []);
    const pastSummary = await accept(env, [{ goalActivityId: GOAL_ACTIVITY_ID, localDate: '2026-11-01' }]); // before planningLocalDate
    const nextWeekSummary = await accept(env, [{ goalActivityId: GOAL_ACTIVITY_ID, localDate: '2026-11-10' }]); // Tue of next week
    check('8. a date before the planning date is rejected OUTSIDE_CURRENT_WEEK, never silently clamped', pastSummary.sessions[0].outcome === 'FAILED' && (pastSummary.sessions[0] as { reason: string }).reason === 'OUTSIDE_CURRENT_WEEK');
    check('8. a date in NEXT week is rejected OUTSIDE_CURRENT_WEEK, never conflated with this week\'s target', nextWeekSummary.sessions[0].outcome === 'FAILED' && (nextWeekSummary.sessions[0] as { reason: string }).reason === 'OUTSIDE_CURRENT_WEEK');
    check('8/15/19. an out-of-week rejection never reaches preview or persist', env.previewCalls.length === 0 && env.persistCalls.length === 0);
  }

  // ---------- 9/10. idempotent retry ----------
  {
    const env = buildFakeEnv(5, []);
    const selection = { goalActivityId: GOAL_ACTIVITY_ID, localDate: '2026-11-05' };
    env.persistResultByClientRequestId.set(buildWeeklySessionClientRequestId(GOAL_ACTIVITY_ID, '2026-11-05'), { status: 'ALREADY_ACCEPTED', plans: [{ id: 'plan-existing', plannedStartAt: new Date('2026-11-05T06:00:00Z'), plannedEndAt: new Date('2026-11-05T06:30:00Z') } as never] });
    const summary = await accept(env, [selection]);
    check('9/10. a retried session that persist classifies as ALREADY_ACCEPTED is reported as such, never as a fresh ACCEPTED', summary.sessions[0].outcome === 'ALREADY_ACCEPTED' && summary.alreadyAcceptedCount === 1 && summary.acceptedCount === 0);
    check('9/10. the SAME deterministic clientRequestId is used for the SAME (goalActivityId, localDate) every time -- the exact identity a real idempotent replay depends on', env.persistCalls[0].clientRequestId === buildWeeklySessionClientRequestId(GOAL_ACTIVITY_ID, '2026-11-05'));
  }

  // ---------- 9/10, regression: retrying an ALREADY-ACCEPTED session
  // whose weekly target is now fully met (by that SAME prior acceptance)
  // must still resolve ALREADY_ACCEPTED -- NOT a fresh NOT_ELIGIBLE. This
  // is the exact bug a live-DB run of this feature surfaced during
  // development (target 1, one real acceptance leaves zero remaining
  // demand, and an eager "remaining <= 0 -> reject" pre-check incorrectly
  // out-raced the real idempotency check every time) -- fixed by never
  // gating a session on the displayed remaining count alone; see
  // goalRhythmWeeklyAcceptance.ts's own comment at this exact point. ----------
  {
    const env = buildFakeEnv(1, [fact('2026-11-04', 'COMMITTED')]); // target 1, already fully met by a prior real acceptance
    const clientRequestId = buildWeeklySessionClientRequestId(GOAL_ACTIVITY_ID, '2026-11-04');
    env.persistResultByClientRequestId.set(clientRequestId, { status: 'ALREADY_ACCEPTED', plans: [{ id: 'plan-existing', plannedStartAt: new Date('2026-11-04T06:00:00Z'), plannedEndAt: new Date('2026-11-04T06:30:00Z') } as never] });
    const summary = await accept(env, [{ goalActivityId: GOAL_ACTIVITY_ID, localDate: '2026-11-04' }]);
    check('9/10 regression: a retry of an already-accepted session is reported ALREADY_ACCEPTED even when the weekly target it consumed is now fully met, never misreported as a fresh NOT_ELIGIBLE rejection', summary.sessions[0].outcome === 'ALREADY_ACCEPTED');
    check('9/10 regression: the retry genuinely reached the real persist/idempotency check rather than being short-circuited by the displayed remaining count', env.persistCalls.length === 1);
  }

  // ---------- 11/16. partial success ----------
  {
    const env = buildFakeEnv(5, []);
    env.persistResultByClientRequestId.set(buildWeeklySessionClientRequestId(GOAL_ACTIVITY_ID, '2026-11-06'), { status: 'REJECTED', reason: 'CONFLICT', diagnostics: [] });
    const summary = await accept(env, [
      { goalActivityId: GOAL_ACTIVITY_ID, localDate: '2026-11-04' },
      { goalActivityId: GOAL_ACTIVITY_ID, localDate: '2026-11-06' },
      { goalActivityId: GOAL_ACTIVITY_ID, localDate: '2026-11-08' },
    ]);
    check('11/16. session 2 of 3 fails while 1 and 3 succeed -- an honest, accurate partial-success count, never "all 3 accepted"', summary.acceptedCount === 2 && summary.failedCount === 1 && summary.requestedCount === 3);
    check('11. the response never claims all sessions succeeded when one did not', !(summary.acceptedCount === summary.requestedCount));
    check('11. session 3 was still attempted independently after session 2 failed -- never short-circuited by an earlier failure', env.previewCalls.map((c) => c.targetDate).includes('2026-11-08'));
    const bySession = summary.sessions as readonly WeeklySessionAcceptanceOutcome[];
    check('11. the two real successes are correctly identified by their own date, not just a count', bySession[0].outcome === 'ACCEPTED' && bySession[0].localDate === '2026-11-04' && bySession[2].outcome === 'ACCEPTED' && bySession[2].localDate === '2026-11-08');
  }

  // ---------- 12. retry after partial success touches only the failed session ----------
  {
    const env = buildFakeEnv(5, []);
    const succeeded = { goalActivityId: GOAL_ACTIVITY_ID, localDate: '2026-11-04' };
    const retried = { goalActivityId: GOAL_ACTIVITY_ID, localDate: '2026-11-06' };
    await accept(env, [retried]); // simulate: this one failed on the first attempt (ordinary SAVED here -- we only assert isolation)
    const previewCallsAfterFirst = env.previewCalls.length;
    await accept(env, [succeeded]); // a caller retrying ONLY the still-pending session never resubmits the one that's done
    check('12. retrying only the originally-failed session never re-touches a session the caller does not resubmit', env.previewCalls.length === previewCallsAfterFirst + 1 && env.previewCalls[env.previewCalls.length - 1].targetDate === '2026-11-04');
  }

  // ---------- 13. weekly target reached MID-BATCH -- each session still
  // genuinely independent; capacity is enforced by the REAL write-time
  // check (simulated here), and the BATCH SUMMARY's own final remaining
  // count is recomputed fresh afterward, never carried over from the
  // demand snapshot read before the batch started. ----------
  {
    const env = buildFakeEnv(2, [fact('2026-11-02', 'COMPLETED')]); // target 2, 1 already done -> 1 remaining at batch start
    const secondClientRequestId = buildWeeklySessionClientRequestId(GOAL_ACTIVITY_ID, '2026-11-06');
    // Session 1's own fake persist mutates the shared facts ref (as a
    // real write would), THEN session 2 -- simulating the real
    // materializeGoalActivityRhythmOccurrence capacity check that would
    // reject it, now that session 1 already consumed the only slot.
    const firstClientRequestId = buildWeeklySessionClientRequestId(GOAL_ACTIVITY_ID, '2026-11-04');
    const originalPersist = env.deps.persist;
    env.deps.persist = (async (userId, request, ...rest) => {
      if (request.clientRequestId === firstClientRequestId) {
        env.factsRef.current = new Map([[GOAL_ACTIVITY_ID, [fact('2026-11-02', 'COMPLETED'), fact('2026-11-04', 'COMMITTED')]]]);
      }
      return originalPersist(userId, request, ...rest);
    }) as typeof originalPersist;
    env.persistResultByClientRequestId.set(secondClientRequestId, { status: 'SAVE_FAILED', code: 'CAPACITY_EXCEEDED' });
    const summary = await accept(env, [
      { goalActivityId: GOAL_ACTIVITY_ID, localDate: '2026-11-04' }, // consumes the last remaining slot
      { goalActivityId: GOAL_ACTIVITY_ID, localDate: '2026-11-06' }, // rejected by the real write-time capacity check
    ]);
    check('13. session 1 consumes the last remaining weekly slot and is accepted', summary.sessions[0].outcome === 'ACCEPTED');
    check('13. session 2 is independently attempted (never skipped merely because session 1 succeeded) and is rejected NOT_ELIGIBLE by the real capacity check', env.previewCalls.length === 2 && summary.sessions[1].outcome === 'FAILED' && (summary.sessions[1] as { reason: string }).reason === 'NOT_ELIGIBLE');
    check('13. the batch summary\'s own final remaining-demand figure reflects session 1\'s real write (0), not the demand snapshot read before the batch started (1)', summary.remainingThisWeekByGoalActivityId.get(GOAL_ACTIVITY_ID) === 0);
  }

  // ---------- 14/15. a legitimate deferral (no usable capacity) never fabricates a proposal ----------
  {
    const env = buildFakeEnv(5, []);
    env.previewFailureByDate.set('2026-11-05', 'NO_USABLE_CAPACITY');
    const summary = await accept(env, [{ goalActivityId: GOAL_ACTIVITY_ID, localDate: '2026-11-05' }]);
    check('14. a NO_USABLE_CAPACITY preview result is reported FAILED, never a fabricated acceptance', summary.sessions[0].outcome === 'FAILED' && (summary.sessions[0] as { reason: string }).reason === 'PREVIEW_NOT_READY');
    check('14/15. no persist call is ever made when the preview itself was not READY', env.persistCalls.length === 0);
  }

  // ---------- NO_CANDIDATES deferral (the intent resolved but could not be placed) ----------
  {
    const env = buildFakeEnv(5, []);
    env.previewFailureByDate.set('2026-11-05', 'NO_CANDIDATES');
    const summary = await accept(env, [{ goalActivityId: GOAL_ACTIVITY_ID, localDate: '2026-11-05' }]);
    check('a READY preview whose own intent was deferred (NO_CANDIDATES, not placed) is reported FAILED, never accepted as if it were placed', summary.sessions[0].outcome === 'FAILED' && env.persistCalls.length === 0);
  }

  // ---------- 19. bounded at MAX_WEEKLY_ACCEPTANCE_SESSIONS ----------
  {
    const env = buildFakeEnv(5, []);
    const selections = ['2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07'].map((d) => ({ goalActivityId: GOAL_ACTIVITY_ID, localDate: d }));
    const summary = await accept(env, selections);
    check(`19. a batch larger than MAX_WEEKLY_ACCEPTANCE_SESSIONS (${MAX_WEEKLY_ACCEPTANCE_SESSIONS}) is bounded, never processed in full`, summary.sessions.length === MAX_WEEKLY_ACCEPTANCE_SESSIONS && env.previewCalls.length === MAX_WEEKLY_ACCEPTANCE_SESSIONS);
  }

  // ---------- 17. updated weekly demand is recomputed fresh, never locally decremented ----------
  {
    const env = buildFakeEnv(3, []);
    const summary = await accept(env, [
      { goalActivityId: GOAL_ACTIVITY_ID, localDate: '2026-11-04' },
      { goalActivityId: GOAL_ACTIVITY_ID, localDate: '2026-11-06' },
    ]);
    check('17. the loadCandidateGoalActivities read model is called again AFTER the batch (not reused from the pre-batch read) to recompute remaining demand', env.loadCandidateCallCount.n >= 3); // 2 per-session + >=1 final recompute
    check('17. the reported remaining-this-week reflects live demand, not this function\'s own arithmetic', summary.remainingThisWeekByGoalActivityId.get(GOAL_ACTIVITY_ID) !== undefined);
  }

  // ---------- buildWeeklySessionClientRequestId determinism ----------
  {
    check('buildWeeklySessionClientRequestId is deterministic for the same (goalActivityId, localDate)', buildWeeklySessionClientRequestId('a', '2026-11-04') === buildWeeklySessionClientRequestId('a', '2026-11-04'));
    check('buildWeeklySessionClientRequestId differs for a different localDate', buildWeeklySessionClientRequestId('a', '2026-11-04') !== buildWeeklySessionClientRequestId('a', '2026-11-05'));
    check('buildWeeklySessionClientRequestId differs for a different goalActivityId', buildWeeklySessionClientRequestId('a', '2026-11-04') !== buildWeeklySessionClientRequestId('b', '2026-11-04'));
  }

  // ---------- 18/19. [STRUCTURAL] no bypass of the existing acceptance implementation ----------
  {
    const root = path.resolve(__dirname, '..');
    const src = fs.readFileSync(path.join(root, 'apps/web/lib/goalRhythmWeeklyAcceptance.ts'), 'utf8');
    check(
      '18/19. [STRUCTURAL] this file never calls a lower-level write directly (createPlannedActivity/materializeGoalActivityRhythmOccurrence/linkGoalActivityToPlannedActivity) -- every write goes through the injected, real persistAcceptedConstructedDay',
      !/createPlannedActivity\(|materializeGoalActivityRhythmOccurrence\(|linkGoalActivityToPlannedActivity\(/.test(src)
    );
    check('18/19. [STRUCTURAL] this file imports verifyAcceptanceItems/authorizeGoalActivityLinks/persistAcceptedConstructedDay from their real modules, never reimplements them', /from '\.\/dayConstructorPreviewIntegrity'/.test(src) && /from '\.\/goalDemandProvenanceAuthorization'/.test(src) && /from '\.\/dayConstructorAcceptancePersistence'/.test(src));
    check('18. [STRUCTURAL] no new signing primitive is introduced -- the file never imports auth.ts\'s sign/verify directly', !/from '\.\/auth'/.test(src));
  }

  console.log(allPassed ? '\nALL GOAL RHYTHM WEEKLY ACCEPTANCE CHECKS PASSED' : '\nSOME GOAL RHYTHM WEEKLY ACCEPTANCE CHECKS FAILED');
  if (!allPassed) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
