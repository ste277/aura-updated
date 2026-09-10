/**
 * Forward Planner V1 -- request validation, result/option contracts, and
 * top-level orchestration.
 *
 * App-level glue, exactly like dailyGuidanceOrchestrator.ts before it: no
 * astrology math, no new timing engine, no new personalization engine.
 * Every real calculation is delegated to its own already-built package or
 * to buildDailyPersonalFitForUser (unchanged, #105) / runTimingSearch
 * (unchanged, existing multi-day FIND). This file only threads an
 * already-validated request through, in order:
 *
 *   resolveForwardPlannerRange (forwardPlanner.ts, pure)
 *     -> ForwardPlannerRange
 *   runTimingSearch({ mode: 'FIND', dateRange, ... })            UNCHANGED, packages/recommendation
 *     -> TimingCandidate[] (already globally score-ranked)
 *   selectOneCandidatePerLocalDate + isAboveForwardPlannerFloor    forwardPlanner.ts, pure
 *     -> at most one CAUTION-free candidate per local date
 *   listPlannedActivitiesForDay + filterConflictingCandidates      db.ts (unchanged) + forwardPlanner.ts (pure)
 *     -> candidates that don't overlap an existing UPCOMING Plan
 *   buildDailyPersonalFitForUser(user, noonOfThatDate) PER SURVIVING DATE   UNCHANGED, #105
 *     -> that date's own DailyActivityFit for the requested family
 *   rankForwardPlannerCandidates                                   forwardPlanner.ts, pure
 *     -> top ForwardPlannerOption[]
 *
 * REQUEST-NOW VS TARGET-EVALUATION-TIME (merge-critical): `now` (the
 * caller's own single request instant, captured once via
 * resolveRequestNow(req) at the API boundary -- exactly #105's own
 * established discipline) owns ONLY "what counts as tomorrow"/weekend
 * resolution/past-date rejection. It is NEVER passed as the personalization
 * evaluation time. Each candidate date's own local-noon instant (computed
 * fresh per date, see buildTargetEvaluationTime below) is what
 * buildDailyPersonalFitForUser actually evaluates Dasha/Transit/Life
 * Weather/Daily Personal Fit at -- there is no hidden Date.now() anywhere
 * in this file.
 */
import { getActivityProfileById } from '../../../packages/recommendation/src/personalizedTasks';
import { familyForActivityProfile } from '../../../packages/recommendation/src/auraFitEngine';
import { runTimingSearch } from '../../../packages/recommendation/src/timingSearch';
import type { DailyAssistantContext } from '../../../packages/recommendation/src/dailyAssistant';
import type { TimingCandidateLabel } from '../../../packages/recommendation/src/timingSearch';
import type { PersonalRelevance, DailyPersonalFitRelevantTheme } from '../../../packages/personal-intelligence/src/context';
import { buildDailyPersonalFitForUser } from './dailyGuidancePipeline';
import { buildPersonalMuhurtaContextForUser } from './natalContext';
import { listPlannedActivitiesForDay } from './db';
import { localDayBoundsUTC } from './myDayOrchestrator';
import { getDatePartsInTimezone, resolveTzOffsetMinutes } from './timezone';
import {
  resolveForwardPlannerRange,
  selectOneCandidatePerLocalDate,
  isAboveForwardPlannerFloor,
  filterConflictingCandidates,
  rankForwardPlannerCandidates,
  buildTargetEvaluationTime,
  rangeDayCount,
  MAX_FORWARD_PLANNER_RESULTS,
  MAX_FORWARD_PLANNER_RANGE_DAYS,
} from './forwardPlanner';
import type { ForwardPlannerHorizon, ForwardPlannerRange, ForwardPlannerBlockingInterval, ForwardPlannerRankInput } from './forwardPlanner';
import type { User } from './db';

// ============================================================
// Public result / option contracts.
// ============================================================

/** Deliberately excludes timingScore/muhurtaScore/auraFitScore/reasons/conflicts/metadata/engineVersion/ruleIds/birth data -- all internal provenance, never customer-facing (matches BestForYouItem's own established minimality). */
export interface ForwardPlannerOption {
  rank: number;
  localDate: string;
  start: string;
  end: string;
  personalRelevance: PersonalRelevance;
  relevantThemes: DailyPersonalFitRelevantTheme[];
  timingLabel: TimingCandidateLabel;
}

export type ForwardPlannerResult =
  | { status: 'READY'; activity: { id: string; title: string }; range: ForwardPlannerRange; options: ForwardPlannerOption[] }
  | { status: 'NO_SUITABLE_WINDOW'; range: ForwardPlannerRange }
  | { status: 'BIRTH_PROFILE_REQUIRED' };

// ============================================================
// Request validation -- separate from the route module (which, per this
// repo's own established convention, may only export HTTP method
// handlers) and separate from orchestration itself, mirroring
// timingSearchRequest.ts's own {ok:true,...}|{ok:false,error,status}
// pattern exactly.
// ============================================================

const MIN_DURATION_MINUTES = 15;
const MAX_DURATION_MINUTES = 360;
const VALID_HORIZONS: ForwardPlannerHorizon[] = ['TOMORROW', 'WEEKEND', 'SEVEN_DAYS', 'CUSTOM'];

export interface ForwardPlannerRequest {
  activityId: string;
  durationMinutes?: number;
  range: ForwardPlannerRange;
}

export type ForwardPlannerRequestValidation = { ok: true; request: ForwardPlannerRequest } | { ok: false; error: string; status: number };

export function buildForwardPlannerRequest(rawBody: unknown, now: Date, timezone: string): ForwardPlannerRequestValidation {
  if (!rawBody || typeof rawBody !== 'object') return { ok: false, error: 'Invalid request body.', status: 400 };
  const body = rawBody as Record<string, unknown>;

  if (typeof body.activityId !== 'string' || body.activityId.length === 0 || body.activityId.length > 100) {
    return { ok: false, error: 'activityId is required.', status: 400 };
  }
  if (!getActivityProfileById(body.activityId)) {
    return { ok: false, error: 'Unknown activity.', status: 400 };
  }

  if (typeof body.horizon !== 'string' || !(VALID_HORIZONS as string[]).includes(body.horizon)) {
    return { ok: false, error: `horizon must be one of: ${VALID_HORIZONS.join(', ')}.`, status: 400 };
  }
  const horizon = body.horizon as ForwardPlannerHorizon;

  let durationMinutes: number | undefined;
  if (body.durationMinutes !== undefined) {
    if (typeof body.durationMinutes !== 'number' || !Number.isFinite(body.durationMinutes) || body.durationMinutes < MIN_DURATION_MINUTES || body.durationMinutes > MAX_DURATION_MINUTES) {
      return { ok: false, error: `durationMinutes must be between ${MIN_DURATION_MINUTES} and ${MAX_DURATION_MINUTES}.`, status: 400 };
    }
    durationMinutes = body.durationMinutes;
  }

  const customStartDate = typeof body.customStartDate === 'string' ? body.customStartDate : undefined;
  const customEndDate = typeof body.customEndDate === 'string' ? body.customEndDate : undefined;
  const resolved = resolveForwardPlannerRange(horizon, now, timezone, customStartDate, customEndDate);
  if (!resolved.ok) return { ok: false, error: resolved.error, status: 400 };

  return { ok: true, request: { activityId: body.activityId, durationMinutes, range: resolved.range } };
}

// ============================================================
// Orchestration.
// ============================================================

function candidateLocalDate(startIso: string, timezone: string): string {
  return getDatePartsInTimezone(timezone, new Date(startIso)).dateStr;
}

/**
 * The single public entry point. `now` must be captured ONCE by the
 * caller (resolveRequestNow(req) at the API route boundary) and passed in
 * explicitly -- this function and everything it calls never reads
 * Date.now()/new Date() for "the current time" itself. `request` must
 * already be the output of buildForwardPlannerRequest -- this function
 * performs no further input validation of its own.
 */
export async function buildForwardPlannerResult(user: User, now: Date, request: ForwardPlannerRequest): Promise<ForwardPlannerResult> {
  // Cheapest, most-blocking check first -- mirrors buildDailyPersonalFitForUser's
  // own early-return condition exactly (never duplicating the real
  // calculation, only this trivial three-field presence check), so a user
  // with no birth profile never pays for a Plans query or a FIND search.
  if (!user.birthDate || !user.birthTime || !user.birthTimezone) return { status: 'BIRTH_PROFILE_REQUIRED' };

  const activityProfile = getActivityProfileById(request.activityId)!; // already confirmed to exist by buildForwardPlannerRequest
  const activityFamily = familyForActivityProfile(activityProfile);
  const durationMinutes = request.durationMinutes ?? activityProfile.defaultDurationMinutes ?? MIN_DURATION_MINUTES;
  const { range } = request;

  const tzOffsetMinutes = resolveTzOffsetMinutes(user.timezone, now);
  const context: DailyAssistantContext = {
    now,
    latitude: user.latitude,
    longitude: user.longitude,
    timezone: user.timezone,
    tzOffsetMinutes,
    personalContext: buildPersonalMuhurtaContextForUser(user),
  };

  // ONE FIND call across the whole requested range (the engine already
  // iterates every date internally) -- a generous limit so the per-date
  // dedup below has real same-day alternatives to choose the best of,
  // regardless of which internal diversity path the engine takes for this
  // range's length.
  const dayCount = Math.min(MAX_FORWARD_PLANNER_RANGE_DAYS, rangeDayCount(range));
  const findResponse = runTimingSearch({
    mode: 'FIND',
    activityId: request.activityId,
    durationMinutes,
    dateRange: { start: range.startLocalDate, end: range.endLocalDate },
    context,
    limit: Math.min(21, dayCount * 3),
  });

  const oneCandidatePerDate = selectOneCandidatePerLocalDate(findResponse.candidates, user.timezone);
  const aboveFloor = oneCandidatePerDate.filter((candidate) => isAboveForwardPlannerFloor(candidate.label));

  // Plan-conflict filtering -- loaded once for the whole range, only
  // UPCOMING Plans block a candidate (LOGGED is historical, CANCELLED
  // already excluded at the query level by listPlannedActivitiesForDay
  // itself).
  const { from } = localDayBoundsUTC(range.startLocalDate, user.timezone);
  const { to } = localDayBoundsUTC(range.endLocalDate, user.timezone);
  const plans = await listPlannedActivitiesForDay(user.id, from, to);
  const blockingIntervals: ForwardPlannerBlockingInterval[] = plans.filter((plan) => plan.status === 'UPCOMING').map((plan) => ({ start: plan.plannedStartAt, end: plan.plannedEndAt }));
  const conflictFree = filterConflictingCandidates(aboveFloor, blockingIntervals);

  if (conflictFree.length === 0) return { status: 'NO_SUITABLE_WINDOW', range };

  // Future personalization -- ONCE per surviving candidate DATE (never per
  // window, matching today's own established one-evaluation-per-request
  // granularity), at that date's own local noon (never `now`/requestNow).
  const rankInputs: ForwardPlannerRankInput[] = [];
  for (const candidate of conflictFree) {
    const localDate = candidateLocalDate(candidate.start, user.timezone);
    const targetEvaluationTime = buildTargetEvaluationTime(localDate, user.timezone);
    const dailyFit = buildDailyPersonalFitForUser(user, targetEvaluationTime);
    if (!dailyFit) continue; // structurally unreachable here (birth profile already confirmed complete above), defensive only
    const activityFit = dailyFit.activities.find((activity) => activity.activityFamily === activityFamily);
    if (!activityFit) continue; // structurally unreachable -- DailyPersonalFitContext always has one entry per canonical family
    rankInputs.push({
      localDate,
      start: candidate.start,
      end: candidate.end,
      personalRelevance: activityFit.personalRelevance,
      relevantThemes: activityFit.relevantThemes,
      timingLabel: candidate.label,
      timingScore: candidate.score,
    });
  }

  if (rankInputs.length === 0) return { status: 'NO_SUITABLE_WINDOW', range };

  const ranked = rankForwardPlannerCandidates(rankInputs).slice(0, MAX_FORWARD_PLANNER_RESULTS);
  const options: ForwardPlannerOption[] = ranked.map((item, index) => ({
    rank: index + 1,
    localDate: item.localDate,
    start: item.start,
    end: item.end,
    personalRelevance: item.personalRelevance,
    relevantThemes: item.relevantThemes,
    timingLabel: item.timingLabel,
  }));

  return { status: 'READY', activity: { id: activityProfile.id, title: activityProfile.title }, range, options };
}
