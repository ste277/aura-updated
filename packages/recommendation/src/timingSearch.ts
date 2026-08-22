/**
 * Reusable ranked timing-search engine: FIND ("when should I do this?"),
 * CHECK ("how good is this specific time?"), and COMPARE ("which of these
 * times is better?") all share ONE canonical slot evaluator
 * (evaluateTimingCandidate) and the same candidate-generation / scoring /
 * diversity primitives the existing planner (dailyAssistant.ts) already
 * uses -- exported from there for this purpose rather than re-implemented
 * here. See the PR completion report for the full inspection notes.
 *
 * Deliberately NOT wired into apps/web/app/api/daily-assistant/slot-task:
 * that route, recommendTaskSlot(), and findOptimalTaskTimes() are untouched
 * by this file (only a handful of their internal helpers gained `export` or
 * were extracted verbatim, see dailyAssistant.ts) and keep producing byte-
 * identical output. This is intentionally a new domain-layer module sitting
 * ALONGSIDE the legacy planner, sharing its core primitives rather than
 * being layered underneath it in this PR -- see "legacy slot-task
 * compatibility strategy" in the completion report for why, and what a
 * follow-up PR that actually re-routes the route would look like.
 */

import type { SolarWindowType } from '../../panchang/src/windows';
import type { MuhurtaReason } from '../../muhurta/src/activityOntology';
import {
  DailyAssistantContext,
  PlanningHorizon,
  SlotCandidate,
  TaskProfile,
  buildDateOffsets,
  buildSlotCandidates,
  classifyTask,
  computeAssistantWindows,
  containsMinute,
  evaluateCandidateMuhurta,
  formatMinute,
  formatWindowLabel,
  localDateForContext,
  localInstantForMinute,
  matchesTimePreference,
  normalizeTaskTitle,
  profileFromActivity,
  resolveHorizonDayOffsets,
  scoreCandidate,
  scoreContinuousBlock,
  selectDailyBestPlanningOptions,
  selectDiversePlanningOptions,
} from './dailyAssistant';
import { evaluateActivityFit } from './auraFitEngine';
import { FULL_ACTIVITY_CATALOG } from './personalizedTasks';

export type TimingSearchMode = 'FIND' | 'CHECK' | 'COMPARE';

/** 'ANY' maps onto dailyAssistant.ts's existing 'ANYTIME'; see
 * mapTimingTimePreference() and the "time-of-day boundaries" note in the
 * completion report for where NIGHT's range differs from the brief's sketch. */
export type TimingTimePreference = 'ANY' | 'MORNING' | 'AFTERNOON' | 'EVENING' | 'NIGHT';

export interface TimingSearchDateRange {
  /** Local calendar date, 'YYYY-MM-DD'. */
  start: string;
  end: string;
}

export interface TimingSearchRequest {
  mode: TimingSearchMode;

  /** Known catalog activity (see personalizedTasks.ts / activityDefinitions.ts).
   * Takes precedence over taskTitle when both are given. */
  activityId?: string;
  /** Free text; resolved via the exact same catalog-alias-then-regex-fallback
   * flow classifyTask() already uses, so this PR cannot regress the ontology
   * ordering established in the previous PR. */
  taskTitle?: string;

  durationMinutes: number;

  /** Explicit range (FIND only). Takes precedence over `horizon` when both
   * are given. */
  dateRange?: TimingSearchDateRange;
  /** Legacy-horizon adapter (FIND only) -- converted to day offsets via
   * dailyAssistant.ts's resolveHorizonDayOffsets(), the exact function
   * findOptimalTaskTimes() itself uses. */
  horizon?: PlanningHorizon;
  customStartDate?: string;
  customEndDate?: string;

  timePreference?: TimingTimePreference;

  /** Location/timezone/personal-Muhurta-context fields the existing engine
   * requires -- reusing DailyAssistantContext as-is rather than duplicating
   * its shape (per the brief's "adapt to the existing architecture" note). */
  context: DailyAssistantContext;

  /** FIND only. Default 3. */
  limit?: number;

  /** CHECK only: exact ISO instant to evaluate. */
  candidateStart?: string;
  /** CHECK only: how far (minutes, each direction, same local day) to look
   * for a better alternative. Default 180. Set 0 to disable the search. */
  checkNearbyWindowMinutes?: number;

  /** COMPARE only: 2+ ISO instants to evaluate and rank. */
  candidateStarts?: string[];
}

export type TimingCandidateLabel = 'EXCELLENT' | 'VERY_GOOD' | 'GOOD' | 'USABLE' | 'CAUTION';

export interface TimingConflict {
  type: 'FRICTION_WINDOW_BLOCKED' | 'DURATION_EXCEEDS_DAY';
  message: string;
}

export interface TimingCandidate {
  start: string;
  end: string;

  /** 0-10, one decimal -- a presentation rescale (rawScore / 10) of the
   * existing 0-100 engine score, not a new formula. See auraFitScore/
   * muhurtaScore for the untouched native-scale numbers. */
  score: number;

  label: TimingCandidateLabel;

  /** Raw Muhurta modifier (muhurtaEngine.ts's native scale, roughly -30..+20),
   * unchanged. */
  muhurtaScore: number;
  /** Raw 0-100 Aura Fit score (auraFitEngine.ts's native scale), only present
   * when the activity resolved to a catalog ActivityProfile -- the free-text
   * fallback path has no Aura Fit evaluation to report (see dailyAssistant.ts
   * scoreCandidate(), which is the same split this reuses). */
  auraFitScore?: number;

  /** Canonical structured reasons (see activityOntology.ts) -- the source of
   * truth; nothing here is newly-generated English prose. */
  reasons: MuhurtaReason[];

  conflicts?: TimingConflict[];

  metadata: {
    windowType: SolarWindowType;
    windowLabel: string;
    activityType: string;
    dateLabel: string;
  };
}

export interface TimingSearchResponse {
  mode: TimingSearchMode;
  /** FIND: ranked top-`limit` candidates. CHECK: exactly [requestedCandidate].
   * COMPARE: every supplied candidateStarts, evaluated and ranked. */
  candidates: TimingCandidate[];
  /** CHECK only -- explicit, unambiguous alias for candidates[0] so "the
   * original candidate must always remain clearly identified" holds even if
   * a caller only looks at named fields. */
  requestedCandidate?: TimingCandidate;
  /** CHECK only -- present only when a strictly better nearby slot exists. */
  betterNearby?: TimingCandidate;
}

const DEFAULT_FIND_LIMIT = 3;
const DEFAULT_CHECK_NEARBY_WINDOW_MINUTES = 180;
const CANDIDATE_SEARCH_STEP_MINUTES = 15;
/** Range length (inclusive day count) at which FIND switches from
 * "diverse clock times, avoid same-day repeats" (selectDiversePlanningOptions)
 * to "best slot per day" (selectDailyBestPlanningOptions) -- see section 5 of
 * the completion report. Matches findOptimalTaskTimes's own SEVEN_DAYS cutover
 * in spirit (that one hardcodes 7; here any range this long or longer behaves
 * the same way). */
const MULTI_DAY_DIVERSITY_THRESHOLD_DAYS = 4;

function mapTimingTimePreference(preference: TimingTimePreference | undefined): 'ANYTIME' | 'MORNING' | 'AFTERNOON' | 'EVENING' | 'NIGHT' {
  if (!preference || preference === 'ANY') return 'ANYTIME';
  return preference;
}

/** Section 10's known-vs-fallback activity resolution, built entirely from
 * existing exports: activityId -> FULL_ACTIVITY_CATALOG lookup ->
 * profileFromActivity() (explicit Muhurta profile); otherwise taskTitle ->
 * classifyTask() (catalog-alias match, then the existing regex fallback
 * classifier -- unchanged, per the previous ontology PR's brief). */
function resolveTaskProfile(request: TimingSearchRequest): TaskProfile {
  if (request.activityId) {
    const activity = FULL_ACTIVITY_CATALOG.find((candidate) => candidate.id === request.activityId);
    if (activity) {
      const profile = profileFromActivity(activity);
      profile.personalContext = request.context.personalContext;
      return profile;
    }
  }
  const profile = classifyTask(normalizeTaskTitle(request.taskTitle ?? ''));
  profile.personalContext = request.context.personalContext;
  return profile;
}

function labelForRawScore(rawScore: number): TimingCandidateLabel {
  if (rawScore < 0) return 'CAUTION';
  if (rawScore >= 90) return 'EXCELLENT';
  if (rawScore >= 80) return 'VERY_GOOD';
  if (rawScore >= 70) return 'GOOD';
  if (rawScore >= 55) return 'USABLE';
  return 'CAUTION';
}

function toPresentationScore(rawScore: number): number {
  return Math.round(Math.max(0, rawScore) * 10) / 100;
}

/**
 * THE canonical single-slot evaluator -- FIND, CHECK, and COMPARE all call
 * this and nothing else to score a candidate. Built from dailyAssistant.ts's
 * existing scoreContinuousBlock() (duration-spanning-multiple-windows score,
 * identical to what findOptimalTaskTimes uses) plus evaluateActivityFit()/
 * evaluateCandidateMuhurta() for the structured reasons -- no new scoring
 * formula.
 */
export function evaluateTimingCandidate(params: {
  profile: TaskProfile;
  start: Date;
  durationMinutes: number;
  context: DailyAssistantContext;
}): TimingCandidate {
  const { profile, start, durationMinutes, context } = params;
  const dayContext: DailyAssistantContext = { ...context, now: start };
  const windows = computeAssistantWindows(dayContext);
  const candidates = buildSlotCandidates(windows);
  const localStart = localDateForContext(dayContext);
  const startMinute = localStart.getUTCHours() * 60 + localStart.getUTCMinutes();
  const endMinute = startMinute + durationMinutes;

  const conflicts: TimingConflict[] = [];
  let rawScore: number;
  if (endMinute > 1440) {
    // Existing planner limitation (findOptimalTaskTimes never searches a
    // start past `1440 - duration`) -- surfaced explicitly here rather than
    // silently scored, since evaluateTimingCandidate accepts an arbitrary
    // instant a caller could ask about directly (CHECK/COMPARE).
    rawScore = scoreContinuousBlock(candidates, profile, startMinute, 1440, (minute) => localInstantForMinute(dayContext, minute));
    conflicts.push({ type: 'DURATION_EXCEEDS_DAY', message: 'This duration extends past midnight; scored against the remainder of the day only.' });
  } else {
    rawScore = scoreContinuousBlock(candidates, profile, startMinute, endMinute, (minute) => localInstantForMinute(dayContext, minute));
  }
  if (rawScore < 0) {
    conflicts.push({ type: 'FRICTION_WINDOW_BLOCKED', message: 'This time falls in a high-friction period this activity should avoid.' });
  }

  const primaryCandidate: SlotCandidate = candidates.find((candidate) => containsMinute(candidate, startMinute)) ?? candidates[0];
  const muhurta = evaluateCandidateMuhurta(primaryCandidate, profile, start);
  const auraFit = profile.activity
    ? evaluateActivityFit({ activity: profile.activity, date: start, windowType: primaryCandidate.type, personalContext: profile.personalContext, classification: profile.muhurtaClassification })
    : undefined;

  const end = new Date(start.getTime() + durationMinutes * 60000);
  const localDay = localDateForContext(dayContext);

  return {
    start: start.toISOString(),
    end: end.toISOString(),
    score: toPresentationScore(rawScore),
    label: labelForRawScore(rawScore),
    muhurtaScore: muhurta.modifier,
    auraFitScore: auraFit?.score,
    reasons: auraFit?.reasons ?? muhurta.reasons,
    conflicts: conflicts.length > 0 ? conflicts : undefined,
    metadata: {
      windowType: primaryCandidate.type,
      windowLabel: formatWindowLabel(primaryCandidate.type),
      activityType: profile.type,
      dateLabel: localDay.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }),
    },
  };
}

type RankedTimingCandidate = TimingCandidate & { dateLabel: string; startMinute: number; rawScore: number; startTime: string };

function toRanked(candidate: TimingCandidate, startMinute: number, rawScore: number): RankedTimingCandidate {
  return { ...candidate, dateLabel: candidate.metadata.dateLabel, startMinute, rawScore, startTime: formatMinute(startMinute) };
}

function stripRankingFields(candidate: RankedTimingCandidate): TimingCandidate {
  const { dateLabel: _dateLabel, startMinute: _startMinute, rawScore: _rawScore, startTime: _startTime, ...rest } = candidate;
  return rest;
}

function resolveSearchDayOffsets(request: TimingSearchRequest): number[] {
  if (request.dateRange) {
    return buildDateOffsets(localDateForContext(request.context), request.dateRange.start, request.dateRange.end);
  }
  if (request.horizon) {
    return resolveHorizonDayOffsets(request.horizon, request.context, request.customStartDate, request.customEndDate);
  }
  return [0];
}

function dayContextForOffset(context: DailyAssistantContext, dayOffset: number): DailyAssistantContext {
  const localNow = localDateForContext(context);
  const targetLocalTimestamp = Date.UTC(
    localNow.getUTCFullYear(),
    localNow.getUTCMonth(),
    localNow.getUTCDate() + dayOffset,
    localNow.getUTCHours(),
    localNow.getUTCMinutes()
  );
  // localInstantForMinute below needs a context whose local-day matches the
  // target day; reuse its own timezone recomputation by feeding it a `now`
  // already shifted to that day (same approach dailyAssistant.ts's
  // contextForDayOffset uses internally).
  return { ...context, now: new Date(targetLocalTimestamp - context.tzOffsetMinutes * 60000) };
}

/**
 * FIND: search the requested range, evaluate every duration-fitting slot at
 * a 15-minute step (matching findOptimalTaskTimes's own granularity -- see
 * the completion report's Performance section for why 15 minutes and the
 * resulting evaluation-count bound), then rank + diversify.
 */
function runFind(request: TimingSearchRequest): TimingSearchResponse {
  const profile = resolveTaskProfile(request);
  const safeDuration = Math.min(360, Math.max(15, Math.round(request.durationMinutes)));
  const limit = Math.max(1, request.limit ?? DEFAULT_FIND_LIMIT);
  const dayOffsets = resolveSearchDayOffsets(request);
  const preference = mapTimingTimePreference(request.timePreference);
  const currentMinute = (() => {
    const local = localDateForContext(request.context);
    return local.getUTCHours() * 60 + local.getUTCMinutes();
  })();

  const ranked: RankedTimingCandidate[] = [];
  for (const dayOffset of dayOffsets) {
    const dayContext = dayContextForOffset(request.context, dayOffset);
    const dayStart = dayOffset === 0 ? currentMinute : 0;
    const maxStart = 1440 - safeDuration;
    for (let startMinute = dayStart; startMinute <= maxStart; startMinute += CANDIDATE_SEARCH_STEP_MINUTES) {
      if (!matchesTimePreference(startMinute, preference)) continue;
      const start = localInstantForMinute(dayContext, startMinute);
      const candidate = evaluateTimingCandidate({ profile, start, durationMinutes: safeDuration, context: request.context });
      if (candidate.conflicts?.some((conflict) => conflict.type === 'FRICTION_WINDOW_BLOCKED')) continue;
      ranked.push(toRanked(candidate, startMinute, candidate.auraFitScore ?? candidate.muhurtaScore * 5 + 55));
    }
  }

  const diversified = dayOffsets.length >= MULTI_DAY_DIVERSITY_THRESHOLD_DAYS
    ? selectDailyBestPlanningOptions(ranked, Math.min(limit, dayOffsets.length))
    : selectDiversePlanningOptions(ranked, limit);
  const finalCandidates = diversified
    .sort((a, b) => b.rawScore - a.rawScore)
    .slice(0, limit)
    .map(stripRankingFields);

  return { mode: 'FIND', candidates: finalCandidates };
}

/**
 * CHECK: score exactly the requested instant (never moved), then optionally
 * scan a constrained nearby window on the same local day for a strictly
 * better alternative.
 */
function runCheck(request: TimingSearchRequest): TimingSearchResponse {
  if (!request.candidateStart) throw new Error('CHECK mode requires candidateStart.');
  const profile = resolveTaskProfile(request);
  const start = new Date(request.candidateStart);
  const requested = evaluateTimingCandidate({ profile, start, durationMinutes: request.durationMinutes, context: request.context });

  const nearbyWindow = request.checkNearbyWindowMinutes ?? DEFAULT_CHECK_NEARBY_WINDOW_MINUTES;
  let betterNearby: TimingCandidate | undefined;
  if (nearbyWindow > 0) {
    const dayContext: DailyAssistantContext = { ...request.context, now: start };
    const localStart = localDateForContext(dayContext);
    const startMinute = localStart.getUTCHours() * 60 + localStart.getUTCMinutes();
    const safeDuration = Math.min(360, Math.max(15, Math.round(request.durationMinutes)));
    const rangeStart = Math.max(0, startMinute - nearbyWindow);
    const rangeEnd = Math.min(1440 - safeDuration, startMinute + nearbyWindow);
    let best: TimingCandidate | undefined;
    for (let minute = rangeStart; minute <= rangeEnd; minute += CANDIDATE_SEARCH_STEP_MINUTES) {
      if (minute === startMinute) continue;
      const candidateStart = localInstantForMinute(dayContext, minute);
      const candidate = evaluateTimingCandidate({ profile, start: candidateStart, durationMinutes: request.durationMinutes, context: request.context });
      if (!best || candidate.score > best.score) best = candidate;
    }
    // "Strictly better" -- a half-point (out of 10) margin so a same-quality
    // slot 15 minutes away doesn't get flagged as an "improvement".
    if (best && best.score >= requested.score + 0.5) betterNearby = best;
  }

  return { mode: 'CHECK', candidates: [requested], requestedCandidate: requested, betterNearby };
}

/**
 * COMPARE: evaluate exactly the supplied candidates, rank them, and return --
 * no search for unrelated alternatives.
 */
function runCompare(request: TimingSearchRequest): TimingSearchResponse {
  const starts = request.candidateStarts ?? [];
  const profile = resolveTaskProfile(request);
  const evaluated = starts.map((iso) => evaluateTimingCandidate({ profile, start: new Date(iso), durationMinutes: request.durationMinutes, context: request.context }));
  const ranked = [...evaluated].sort((a, b) => b.score - a.score);
  return { mode: 'COMPARE', candidates: ranked };
}

export function runTimingSearch(request: TimingSearchRequest): TimingSearchResponse {
  if (request.mode === 'FIND') return runFind(request);
  if (request.mode === 'CHECK') return runCheck(request);
  return runCompare(request);
}
