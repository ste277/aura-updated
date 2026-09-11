/**
 * Personal Guidance Orchestration V1 -- concrete-intent candidate
 * collection.
 *
 * NO GENERIC REVERSE MAPPING (merge-critical): this file never contains
 * anything shaped like `Record<MuhurtaActivityFamily, ActivityProfile>`
 * or a `switch (family) { case 'RELATIONSHIP': return 'date-night'; ... }`
 * -- every candidate below traces to an ACTUAL, already-persisted or
 * already-computed user activity (a real PlannedActivity row, or a real
 * Day Builder IntentionalDaySuggestion), never a fabricated
 * representative for an abstract family. Family is derived only in the
 * ALLOWED forward direction: `getActivityProfileById(activityId) ->
 * familyForActivityProfile(profile)` (packages/recommendation) -- the
 * exact same composition #103's own architecture audit confirmed is
 * total and safe.
 *
 * V1 sources only (see ../README section in dailyGuidanceOrchestrator.ts
 * for the full product rationale): today's Plans with a resolved
 * `activityId`, and Day Builder's own already-resolved SOLO intentions.
 * Habits, free-text Plans, logged/completed activities, and generic
 * family suggestions are all explicitly excluded -- see this file's own
 * per-function doc comments for exactly why.
 */
import { listPlannedActivitiesForDay } from './db';
import { localDayBoundsUTC, buildMyDay } from './myDayOrchestrator';
import { buildIntentionalDaySuggestions, discoverDayBuilderIntentionCandidates } from './dayBuilderOrchestrator';
import { resolveTzOffsetMinutes, getDatePartsInTimezone, getMinuteOfDayInTimezone } from './timezone';
import { buildPersonalMuhurtaContextForUser } from './natalContext';
import { getActivityProfileById } from '../../../packages/recommendation/src/personalizedTasks';
import { familyForActivityProfile } from '../../../packages/recommendation/src/auraFitEngine';
import { runTimingSearch } from '../../../packages/recommendation/src/timingSearch';
import type { User, PlannedActivity } from './db';
import type { DailyAgenda } from './dailyAgenda';
import type { ConcreteGuidanceCandidate } from './dailyGuidanceTypes';

/**
 * Today's Plans, filtered to exactly the ones eligible to enter the
 * family-grained pipeline (brief section 6/7):
 *   - `activityId` must be present (a free-text Plan cannot derive a
 *     family -- never guessed, never fuzzy-matched, excluded but still
 *     visible elsewhere in the product, per this repo's own established
 *     "eligibility is a fact, never a guess" convention, see
 *     insightsAuraFit.ts).
 *   - `status` must be `'UPCOMING'` (not `'LOGGED'` -- already completed
 *     -- and not `'CANCELLED'`, though `listPlannedActivitiesForDay`'s
 *     own SQL already excludes CANCELLED at the query level).
 *   - the Plan must not already be MISSED -- the exact same elapsed-and-
 *     unlogged rule `dailyAgenda.ts`'s own `timeBasedStatus()` uses
 *     (`plannedEndAt < now`), reused here as the identical fact rather
 *     than re-derived independently.
 *
 * Each eligible Plan is evaluated via CHECK (never FIND) against its own
 * already-chosen `plannedStartAt`/`plannedEndAt` -- Aura never suggests
 * moving a user's own explicit commitment in V1 (see this PR's own
 * README "Non-goals" section).
 */
export async function collectPlanCandidates(user: User, now: Date): Promise<ConcreteGuidanceCandidate[]> {
  const localDate = getDatePartsInTimezone(user.timezone, now).dateStr;
  const { from, to } = localDayBoundsUTC(localDate, user.timezone);
  const plans = await listPlannedActivitiesForDay(user.id, from, to);
  const tzOffsetMinutes = resolveTzOffsetMinutes(user.timezone, now);
  const personalContext = buildPersonalMuhurtaContextForUser(user);

  const candidates: ConcreteGuidanceCandidate[] = [];
  for (const plan of plans) {
    if (!isEligiblePlan(plan, now)) continue;
    const activityId = plan.activityId as string; // isEligiblePlan already confirmed non-null
    const profile = getActivityProfileById(activityId);
    if (!profile) continue; // stale/unknown catalog id -- structurally shouldn't happen for a validated Plan, but never silently guessed

    const response = runTimingSearch({
      mode: 'CHECK',
      activityId,
      durationMinutes: plan.durationMinutes,
      candidateStart: plan.plannedStartAt.toISOString(),
      context: { now, latitude: user.latitude, longitude: user.longitude, timezone: user.timezone, tzOffsetMinutes, personalContext },
    });

    candidates.push({
      source: 'PLAN',
      sourceEntityId: plan.id,
      activityId,
      title: plan.title,
      activityFamily: familyForActivityProfile(profile),
      durationMinutes: plan.durationMinutes,
      scheduledStart: plan.plannedStartAt.toISOString(),
      scheduledEnd: plan.plannedEndAt.toISOString(),
      timingCandidates: response.candidates,
    });
  }
  return candidates;
}

function isEligiblePlan(plan: PlannedActivity, now: Date): boolean {
  if (!plan.activityId) return false;
  if (plan.status !== 'UPCOMING') return false; // excludes LOGGED (completed); CANCELLED already excluded by the query itself
  if (plan.plannedEndAt.getTime() < now.getTime()) return false; // MISSED -- the identical rule dailyAgenda.ts's own timeBasedStatus() uses
  return true;
}

/**
 * Behavior-aware Day Builder Duration V1 -- the result of the cheap,
 * agenda-only discovery phase: `agenda`/`minuteOfDay` are fetched/derived
 * exactly once here and threaded through to `resolveDayBuilderCandidates`
 * below (never re-fetched), and `hasIntent` is the caller's own signal for
 * "should I fetch a behavioral profile before resolving this further" --
 * the architecture audit's own resolution to the "can NO_ACTIVITY_INTENT
 * stay zero-behavioral-query" question.
 */
export interface DayBuilderDiscovery {
  agenda: DailyAgenda;
  minuteOfDay: number;
  hasIntent: boolean;
}

/**
 * Day Builder's own cheap, agenda-only discovery phase (brief section
 * 8/9's first half) -- fetches the SAME agenda `GET /api/my-day/suggestions`
 * already fetches (reused, never a second read), then runs
 * `discoverDayBuilderIntentionCandidates` (dayBuilderOrchestrator.ts) --
 * pure, synchronous, no further DB, no timing search, no behavioral
 * profile -- to determine whether ANY raw Day Builder intent exists today.
 * Callers use `hasIntent` to decide whether fetching a behavioral profile
 * (needed to resolve implicit Day Builder durations, Behavior-aware Day
 * Builder Duration V1) is worthwhile BEFORE calling
 * `resolveDayBuilderCandidates` -- never call that function needlessly
 * when there is no raw intent to resolve.
 */
export async function discoverDayBuilderCandidates(user: User, now: Date): Promise<DayBuilderDiscovery> {
  const { agenda } = await buildMyDay(user, undefined, now);
  const minuteOfDay = getMinuteOfDayInTimezone(user.timezone, now);
  const { intentionCandidates } = discoverDayBuilderIntentionCandidates(user, agenda, minuteOfDay);
  return { agenda, minuteOfDay, hasIntent: intentionCandidates.length > 0 };
}

/**
 * Day Builder's own already-resolved intention suggestions (brief section
 * 8/9's second half). Reuses `buildIntentionalDaySuggestions` wholesale --
 * the exact same function `GET /api/my-day/suggestions` already calls --
 * rather than re-deriving any Day Builder logic. Only `kind: 'SOLO'`
 * suggestions participate in V1: a `'SHARED'` suggestion's own
 * `candidates` are `EverydaySharedCandidate[]`, a structurally different
 * shape (a second person's own profile/consent semantics), explicitly out
 * of scope for this PR's own single-user Daily Guidance pipeline.
 *
 * TIMING REUSE DECISION (confirmed during implementation, matching brief
 * section 9/102): `IntentionalDayCandidateSolo.candidates` is already a
 * real `TimingCandidate[]` from an already-completed FIND search -- reused
 * VERBATIM here, never re-run. This was verified directly from
 * apps/web/lib/dayBuilder.ts's own `IntentionalDayCandidateSolo` type
 * before writing this function.
 *
 * `discovery` must be the SAME object `discoverDayBuilderCandidates`
 * already returned for this exact request -- `agenda`/`minuteOfDay` are
 * reused verbatim, never re-fetched/re-derived here (Behavior-aware Day
 * Builder Duration V1: avoids a second `buildMyDay` DB read).
 * `behavioralDurationByActivityId` is OPTIONAL and purely additive --
 * omitting it reproduces this function's exact pre-existing behavior.
 */
export async function resolveDayBuilderCandidates(
  user: User,
  now: Date,
  discovery: Pick<DayBuilderDiscovery, 'agenda' | 'minuteOfDay'>,
  behavioralDurationByActivityId?: Readonly<Record<string, number>>
): Promise<ConcreteGuidanceCandidate[]> {
  const suggestions = await buildIntentionalDaySuggestions({ user, agenda: discovery.agenda, minuteOfDay: discovery.minuteOfDay, now, behavioralDurationByActivityId });

  const candidates: ConcreteGuidanceCandidate[] = [];
  for (const suggestion of suggestions) {
    if (suggestion.candidate.kind !== 'SOLO') continue; // SHARED excluded from V1, see this function's own doc comment
    const profile = getActivityProfileById(suggestion.activityId);
    if (!profile) continue;

    candidates.push({
      source: 'DAY_BUILDER_INTENTION',
      sourceEntityId: suggestion.id,
      activityId: suggestion.activityId,
      title: suggestion.label,
      activityFamily: familyForActivityProfile(profile),
      durationMinutes: suggestion.durationMinutes,
      timingCandidates: suggestion.candidate.candidates,
    });
  }
  return candidates;
}

/**
 * Backward-compatible wrapper preserving the exact pre-Behavior-aware-Day-
 * Builder-Duration-V1 signature/behavior of this module's own original
 * `collectDayBuilderCandidates` -- discovers then resolves with no
 * behavioral map (byte-identical to today's output), matching this
 * repo's own established wrapper convention (see
 * dailyGuidanceBehavior.ts's own `buildBehavioralAffinityByFamily`). Kept
 * so existing call sites/tests written against this exact name (e.g.
 * test/dailyGuidanceOrchestratorDb.test.ts) continue to work unmodified;
 * `buildPersonalDailyGuidance` itself now calls `discoverDayBuilderCandidates`
 * + `resolveDayBuilderCandidates` directly so it can gate the behavioral
 * profile fetch on real raw intent first.
 */
export async function collectDayBuilderCandidates(user: User, now: Date): Promise<ConcreteGuidanceCandidate[]> {
  const discovery = await discoverDayBuilderCandidates(user, now);
  if (!discovery.hasIntent) return [];
  return resolveDayBuilderCandidates(user, now, discovery);
}

/**
 * Deterministic, stable-ID-only dedupe (brief section 13/14/74) -- never
 * title normalization, never fuzzy matching. If today's Plans already
 * cover an `activityId`, any Day Builder suggestion for that SAME
 * `activityId` is dropped: a Plan represents an explicit user commitment,
 * a Day Builder suggestion is an auto-generated idea for something not
 * yet committed -- once committed, the auto-suggestion is redundant, not
 * competing information.
 */
export function dedupeCandidates(candidates: ConcreteGuidanceCandidate[]): ConcreteGuidanceCandidate[] {
  const planActivityIds = new Set(candidates.filter((c) => c.source === 'PLAN').map((c) => c.activityId));
  return candidates.filter((c) => c.source === 'PLAN' || !planActivityIds.has(c.activityId));
}
