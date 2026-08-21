/**
 * Muhurtham Finder: occasion/activity + date range + location -> ranked
 * favorable dates, each with a ranked favorable window.
 *
 * Reuses evaluateTimingCandidate() (packages/recommendation/src/timingSearch.ts)
 * as the ONLY scoring primitive -- the same function Timing Search's FIND
 * mode uses. This file adds no new Aura Fit/Muhurta formula; it only
 * differs from Timing Search in search DIRECTION (a wide date range,
 * surfacing the strongest dates) rather than a short practical window.
 *
 * ## Supported activities
 *
 * Only activities genuinely suited to date-range occasion search are
 * exposed (see SUPPORTED_MUHURTHAM_ACTIVITY_IDS below) -- DEEP
 * evaluationDepth (packages/recommendation/src/activityDefinitions.ts) with
 * CANONICAL or LEGACY_ALIAS ontology status. Activities whose ontology
 * status is AMBIGUOUS (e.g. "High-Stakes Decision or Pitch", which
 * genuinely spans two different activities per its own notes) are
 * deliberately excluded even though their underlying rules compute fine --
 * see the completion report's SUPPORTED/PARTIALLY_SUPPORTED/NOT_YET_SUPPORTED
 * breakdown for the full reasoning.
 *
 * ## Interval overlap (Panchang windows are overlap-preserving)
 *
 * getPanchangForDate()'s `windows` array deliberately preserves overlapping
 * windows rather than flattening them (see its own doc comment in
 * packages/panchang/src/panchangDay.ts) -- e.g. ABHIJIT may overlap
 * RAHU_KALAM. The shared scoreContinuousBlock() primitive (dailyAssistant.ts)
 * that evaluateTimingCandidate() calls internally resolves an overlapping
 * instant to whichever window appears FIRST in computePanchangWindows()'s
 * fixed [BRAHMA, ABHIJIT, RAHU_KALAM, GULIKA, YAMA] array -- in practice this
 * means an ABHIJIT/RAHU_KALAM overlap resolves in ABHIJIT's favor for that
 * shared function, which is existing, already-shipped scoring behavior this
 * PR must not change (Timing Search and Plan depend on it, and REGRESSION
 * testing requires it stay identical).
 *
 * That per-instant resolution is too coarse for what this feature needs,
 * though: a start-sensitive, avoid-Rahu activity whose requested duration
 * extends PAST the Abhijit window and into Rahu Kalam should not be treated
 * as clean just because its start instant landed inside Abhijit. So
 * findBestWindowsForDate() below adds one narrow, LOCAL safety check on top
 * of (never instead of) evaluateTimingCandidate()'s own scoring: using
 * getPanchangForDate()'s overlap-preserving `windows` (not the shared,
 * priority-resolved candidate list), it independently rejects any candidate
 * whose actual [start, start+duration) span intersects ANY RAHU_KALAM/YAMA
 * window at all, for the significance-HIGH/requiresFreshStart activities
 * this feature exposes -- the exact same friction/significance criteria
 * scoreContinuousBlock already uses, just checked against the full
 * unflattened window set instead of a single per-instant lookup. This adds
 * no new Muhurta rule (RAHU_KALAM/YAMA are already-defined friction windows;
 * HIGH significance / requiresFreshStart already trigger hard rejection
 * elsewhere) and touches no shared file, so Timing Search's and Plan's
 * scoring are unaffected.
 *
 * ## Start sensitivity (first real use of ActivityDefinition.muhurta.timingSensitivity)
 *
 * ActivityDefinition.muhurta.timingSensitivity (packages/recommendation/src/
 * activityDefinitions.ts) records, per activity, whether the START moment
 * matters more than filling the full requested duration. Every Muhurtham
 * Finder-eligible activity today (start-journey, financial-decision,
 * new-beginning, business-start, property-purchase, engagement,
 * griha-pravesh) has `timingSensitivity.start: 'HIGH'` -- these are all,
 * definitionally, occasions defined by their commencement instant.
 *
 * For a START_HIGH activity, findBestWindowsForDate() blends the
 * full-duration score (from evaluateTimingCandidate(), unchanged) with a
 * SECOND evaluateTimingCandidate() call at the exact same start instant but
 * a short probe duration (START_SENSITIVITY_PROBE_MINUTES) -- i.e. "how good
 * is the moment of commencement on its own", reusing the identical scoring
 * primitive rather than inventing new Panchanga math. blendStartSensitiveScore()
 * combines the two with a single small, explicit, documented weight
 * (START_SENSITIVITY_WEIGHT) -- the "smallest explicit weighting model
 * necessary" the brief asks for, not a new scoring formula.
 *
 * Hard caution/block intervals are still fully respected: the commencement
 * probe goes through the exact same FRICTION_WINDOW_BLOCKED and
 * spanOverlapsFrictionWindow() checks as the full-duration candidate before
 * blending, so a start instant that itself crosses into Rahu Kalam/Yama
 * disqualifies the candidate regardless of how well the rest of the window
 * scores -- blending only ever adjusts the RANKING of already-valid
 * candidates, never bypasses rejection.
 *
 * A DURATION_HIGH or START-insensitive activity (start !== 'HIGH') is
 * completely unaffected -- the blend is only computed and applied when the
 * gate matches, so its score is identical to before this change (see
 * test/muhurthamFinder.test.ts's synthetic-classification unit test for
 * blendStartSensitiveScore() proving the gate, since every activity
 * currently exposed in Finder happens to be START_HIGH).
 *
 * This intentionally CAN and DOES change start-journey's/financial-decision's/
 * new-beginning's own Muhurtham Finder scores and best-window selection
 * relative to the previous PR -- that is the documented, intentional
 * improvement this section exists to make (brief section 12's regression
 * note explicitly carves this out). Timing Search's own FIND/CHECK/COMPARE
 * modes are untouched (this file never modifies evaluateTimingCandidate()
 * or scoreContinuousBlock()), so Timing Search's scores for the same
 * activities are byte-identical to before.
 *
 * ## Known limitation: search range is unbounded here by design
 *
 * findMuhurthams() itself enforces no maximum date-range length -- the
 * 180-day cap (brief section 9) is HTTP-request validation (a 400 belongs to
 * an API concern, not a domain one) and lives in
 * apps/web/lib/muhurthamSearchRequest.ts, mirroring how
 * MAX_DATE_RANGE_DAYS is enforced in timingSearchRequest.ts rather than in
 * timingSearch.ts itself. Callers outside that route (tests, future
 * server-side callers) are trusted to pass reasonable ranges.
 */

import { DailyAssistantContext, TaskProfile, buildSlotCandidates, computeAssistantWindows, isFriction, matchesTimePreference, profileFromActivity } from './dailyAssistant';
import { evaluateTimingCandidate, TimingCandidate, TimingCandidateLabel, TimingTimePreference } from './timingSearch';
import { formatMinutes } from '../../astronomy/src/ephemeris';
import { getPanchangForDate, PanchangWindowSpan } from '../../panchang/src/panchangDay';
import { isValidCalendarDateString, localDateTimeToUTC } from '../../panchang/src/localDate';
import { FULL_ACTIVITY_CATALOG } from './personalizedTasks';
import { ACTIVITY_DEFINITIONS, ActivityDefinition } from './activityDefinitions';
import { computeMuhurtaSupportLevel, resolveMuhurtaRulePack } from '../../muhurta/src/muhurtaRulePacks';
import type { MuhurtaClassification, MuhurtaReason } from '../../muhurta/src/activityOntology';

/**
 * Finder eligibility (brief section 10): derived from ActivityDefinition +
 * MuhurtaRulePack + MuhurtaSupportLevel metadata, NOT a hand-maintained id
 * list. An activity is eligible when:
 *   - its ontology status isn't AMBIGUOUS (an activity that genuinely spans
 *     two different intents per its own notes -- e.g. "High-Stakes Decision
 *     or Pitch" -- shouldn't be offered as a single occasion search target);
 *   - its evaluationDepth is DEEP or CEREMONIAL (LIGHT/STANDARD activities
 *     like Tea Break or routine admin were never occasion-search material);
 *   - its resolved MuhurtaRulePack reaches SUPPORTED (not PARTIAL/
 *     NOT_YET_SUPPORTED) -- see muhurtaRulePacks.ts's computeMuhurtaSupportLevel
 *     for exactly what that requires (stricter for CEREMONIAL activities).
 * A PARTIAL activity (today: Engagement, Griha Pravesh -- both CEREMONIAL
 * with incomplete Tithi/Nakshatra coverage) is automatically excluded here,
 * per brief section 10's "PARTIAL activities may be hidden from normal
 * Finder results for now" -- computed from the SAME rule-pack data the
 * completion report's coverage matrix is built from, so this list can never
 * silently drift from that audit.
 */
function isMuhurthamEligible(definition: ActivityDefinition): boolean {
  if (definition.status === 'AMBIGUOUS') return false;
  if (definition.muhurta.evaluationDepth !== 'DEEP' && definition.muhurta.evaluationDepth !== 'CEREMONIAL') return false;
  const rulePack = resolveMuhurtaRulePack(definition.muhurta);
  return computeMuhurtaSupportLevel(definition.muhurta, rulePack) === 'SUPPORTED';
}

export const SUPPORTED_MUHURTHAM_ACTIVITY_IDS: string[] = ACTIVITY_DEFINITIONS.filter(isMuhurthamEligible).map((definition) => definition.id);
export type SupportedMuhurthamActivityId = string;

export function isSupportedMuhurthamActivity(activityId: string): boolean {
  return SUPPORTED_MUHURTHAM_ACTIVITY_IDS.includes(activityId);
}

export type MuhurthamRating = 'EXCELLENT' | 'STRONG' | 'FAVORABLE' | 'ACCEPTABLE';

export interface MuhurthamDateRange {
  /** Local calendar date, "YYYY-MM-DD". */
  start: string;
  end: string;
}

export interface MuhurthamSearchRequest {
  activityId: string;
  dateRange: MuhurthamDateRange;
  timePreference?: TimingTimePreference;
  durationMinutes?: number;
  limit?: number;
  /** Location/timezone/personal-Muhurta-context, resolved server-side from
   * the session user -- same pattern as TimingSearchRequest.context. */
  context: DailyAssistantContext;
}

/** A window candidate IS a TimingCandidate, unmodified -- not a parallel
 * type -- specifically so the UI's "Use this time -> " action can pass
 * bestWindow/alternateWindows straight into
 * PlanWithAuraView.planPayloadFromCandidate() (POST /api/plans), the same
 * save pipeline FIND/CHECK/COMPARE already use, with no second adapter. */
export type MuhurthamWindowCandidate = TimingCandidate;

export interface MuhurthamPanchangSummary {
  vara: string;
  tithi: string;
  nakshatra: string;
  yoga: string;
  karana: string;
}

export interface MuhurthamDateCandidate {
  date: string;
  rating: MuhurthamRating;
  /** Same 0-10 scale as bestWindow.score / TimingCandidate.score. */
  score: number;
  bestWindow: MuhurthamWindowCandidate;
  alternateWindows: MuhurthamWindowCandidate[];
  /** SUPPORT-polarity reasons from the best window. */
  reasons: MuhurtaReason[];
  /** CAUTION/BLOCK-polarity reasons from the best window -- never hidden,
   * even for a date that otherwise ranks well. */
  cautions: MuhurtaReason[];
  panchangSummary: MuhurthamPanchangSummary;
}

export interface MuhurthamSearchResult {
  activity: { id: string; title: string; icon: string };
  dateRange: MuhurthamDateRange;
  dates: MuhurthamDateCandidate[];
  evaluatedDateCount: number;
}

const DEFAULT_DURATION_MINUTES = 60;
const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 20;
/** Matches evaluateTimingCandidate's own USABLE floor (raw score 55, i.e.
 * 5.5/10) -- the reused, not reinvented, minimum bar for even being
 * considered a candidate date. Below this, a date is excluded from results
 * entirely rather than manufactured as "ACCEPTABLE". */
const MIN_INCLUSION_SCORE = 5.5;
/** Matches the diversity separation dailyAssistant.ts/timingSearch.ts
 * already use elsewhere (selectDiversePlanningOptions) for "not the same
 * moment again". */
const ALTERNATE_WINDOW_SEPARATION_MINUTES = 90;
const MAX_ALTERNATE_WINDOWS = 2;

/**
 * Section 7 start-sensitivity model -- see this file's module doc comment
 * ("Start sensitivity") for the full reasoning. Both constants are small,
 * explicit, and the minimum needed to give commencement quality real but
 * bounded influence: the probe covers only the first
 * START_SENSITIVITY_PROBE_MINUTES of the window (or the whole window if
 * shorter), and the blend gives it START_SENSITIVITY_WEIGHT of the final
 * score -- the full-duration evaluation still dominates (65%).
 */
export const START_SENSITIVITY_PROBE_MINUTES = 15;
export const START_SENSITIVITY_WEIGHT = 0.35;

/** Pure blend of a full-duration score with a commencement-instant probe
 * score -- exported for direct unit testing of the weighting model in
 * isolation from the rest of the search pipeline. */
export function blendStartSensitiveScore(fullDurationScore: number, commencementScore: number): number {
  return Math.round((fullDurationScore * (1 - START_SENSITIVITY_WEIGHT) + commencementScore * START_SENSITIVITY_WEIGHT) * 10) / 10;
}

/** Mirrors timingSearch.ts's internal labelForRawScore(), on the 0-10
 * presentation scale instead of the 0-100 raw scale, so a blended score
 * gets a label consistent with what that score would have produced if
 * evaluateTimingCandidate() had computed it directly. */
function labelForBlendedScore(score: number): TimingCandidateLabel {
  if (score < 0) return 'CAUTION';
  if (score >= 9.0) return 'EXCELLENT';
  if (score >= 8.0) return 'VERY_GOOD';
  if (score >= 7.0) return 'GOOD';
  if (score >= 5.5) return 'USABLE';
  return 'CAUTION';
}

/**
 * Section 6 rating thresholds, on evaluateTimingCandidate's existing 0-10
 * score scale (documented in timingSearch.ts as rawScore/10) -- the exact
 * same boundaries timingSearch.ts's own labelForRawScore() uses (90/80/70/55
 * raw -> 9.0/8.0/7.0/5.5 here), just a different vocabulary
 * (EXCELLENT/STRONG/FAVORABLE/ACCEPTABLE vs
 * EXCELLENT/VERY_GOOD/GOOD/USABLE/CAUTION) appropriate to "favorable date"
 * language. A date whose best window carries any CAUTION/BLOCK reason or
 * conflict is capped below EXCELLENT, however high the raw score --
 * "serious concerns" (even soft ones the engine chose not to hard-reject)
 * must not be hidden behind a top-tier rating.
 */
function rateMuhurtham(score: number, hasCautionOrConflict: boolean): MuhurthamRating {
  if (score >= 9.0 && !hasCautionOrConflict) return 'EXCELLENT';
  if (score >= 8.0) return 'STRONG';
  if (score >= 7.0) return 'FAVORABLE';
  return 'ACCEPTABLE';
}

/** Pure calendar-date enumeration, "YYYY-MM-DD" inclusive on both ends --
 * timezone-independent (a calendar date is the same date everywhere), the
 * timezone-sensitive step happens later when each date+minute is converted
 * to an absolute instant via localDateTimeToUTC(). Mirrors the same
 * UTC-arithmetic approach getMonthOfPanchangSummaries() already uses. */
function enumerateLocalDates(startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  const endMs = Date.parse(`${endDate}T00:00:00Z`);
  for (let cursor = Date.parse(`${startDate}T00:00:00Z`); cursor <= endMs; cursor += 86_400_000) {
    const d = new Date(cursor);
    dates.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`);
  }
  return dates;
}

type SampledCandidate = TimingCandidate & { startMinute: number };

function toWindowCandidate(candidate: SampledCandidate): MuhurthamWindowCandidate {
  const { startMinute, ...rest } = candidate;
  return rest;
}

/** True if [aStart, aEnd) and [bStart, bEnd) (all ISO instants) intersect at all. */
function instantSpansOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return Date.parse(aStart) < Date.parse(bEnd) && Date.parse(bStart) < Date.parse(aEnd);
}

/**
 * The section-7 safety check: true if [startISO, endISO) intersects any
 * RAHU_KALAM/YAMA window in `panchangWindows` -- the overlap-preserving list
 * from getPanchangForDate(), not the shared, priority-resolved candidate
 * list scoreContinuousBlock uses internally. See this file's module doc
 * comment ("Interval overlap") for why this extra check exists alongside,
 * not instead of, evaluateTimingCandidate()'s own FRICTION_WINDOW_BLOCKED
 * conflict.
 */
function spanOverlapsFrictionWindow(startISO: string, endISO: string, panchangWindows: PanchangWindowSpan[]): boolean {
  return panchangWindows.some((w) => isFriction(w.type) && instantSpansOverlap(startISO, endISO, w.start, w.end));
}

/**
 * Evaluates one candidate per actual solar-window boundary for the date
 * (reusing computeAssistantWindows()/buildSlotCandidates() -- the exact
 * candidate-window generation Timing Search and the legacy planner already
 * use -- rather than a blind per-minute time grid) via
 * evaluateTimingCandidate(), the same scoring function, unchanged.
 *
 * This is Muhurtham Finder's one deliberate departure from Timing Search's
 * 15-minute grid, and it's a performance-motivated SAMPLING difference, not
 * a methodology change: a date-range occasion search cares about "which
 * window regime is favorable", not minute-level scheduling precision, and
 * each window is evaluated at its own start instant, where
 * scoreContinuousBlock's interval-overlap rejection already inspects the
 * full [start, start+duration) span for any caution-window boundary
 * crossing regardless of which exact instant within the window is sampled.
 * Measured ~8 candidates/day this way vs ~93 with a 15-minute grid -- see
 * the completion report's performance section for the full before/after
 * numbers.
 *
 * A candidate is excluded before ranking (not merely flagged after the
 * fact) if either: (a) its evaluation carries a FRICTION_WINDOW_BLOCKED
 * conflict (scoreContinuousBlock's own hard rejection), or (b) for a
 * significance-HIGH/requiresFreshStart profile, its actual
 * [start, start+duration) span intersects a RAHU_KALAM/YAMA window in the
 * date's overlap-preserving Panchang windows (this file's own section-7
 * safety check -- see spanOverlapsFrictionWindow above). Returns null if no
 * candidate for this date reaches MIN_INCLUSION_SCORE.
 */
function findBestWindowsForDate(
  profile: TaskProfile,
  dateStr: string,
  context: DailyAssistantContext,
  durationMinutes: number,
  preference: TimingTimePreference,
  panchangWindows: PanchangWindowSpan[],
  classification: MuhurtaClassification | undefined
): { best: SampledCandidate; alternates: SampledCandidate[] } | null {
  const dayContext: DailyAssistantContext = { ...context, now: localDateTimeToUTC(dateStr, '12:00', context.timezone) };
  const slotCandidates = buildSlotCandidates(computeAssistantWindows(dayContext));
  const isFrictionSensitive = profile.significance === 'HIGH' || profile.requiresFreshStart;
  const isStartSensitive = classification?.timingSensitivity.start === 'HIGH';

  const candidates: SampledCandidate[] = [];
  for (const slot of slotCandidates) {
    if (slot.endMinute - slot.startMinute < durationMinutes) continue;
    if (!matchesTimePreference(slot.startMinute, preference === 'ANY' ? 'ANYTIME' : preference)) continue;
    const start = localDateTimeToUTC(dateStr, formatMinutes(slot.startMinute), context.timezone);
    const candidate = evaluateTimingCandidate({ profile, start, durationMinutes, context });
    if (candidate.conflicts?.some((c) => c.type === 'FRICTION_WINDOW_BLOCKED')) continue;
    if (isFrictionSensitive && spanOverlapsFrictionWindow(candidate.start, candidate.end, panchangWindows)) continue;

    let effectiveCandidate: TimingCandidate = candidate;
    if (isStartSensitive) {
      const probeDurationMinutes = Math.min(durationMinutes, START_SENSITIVITY_PROBE_MINUTES);
      const commencementProbe = evaluateTimingCandidate({ profile, start, durationMinutes: probeDurationMinutes, context });
      if (commencementProbe.conflicts?.some((c) => c.type === 'FRICTION_WINDOW_BLOCKED')) continue;
      if (isFrictionSensitive && spanOverlapsFrictionWindow(commencementProbe.start, commencementProbe.end, panchangWindows)) continue;
      const blendedScore = blendStartSensitiveScore(candidate.score, commencementProbe.score);
      effectiveCandidate = { ...candidate, score: blendedScore, label: labelForBlendedScore(blendedScore) };
    }

    if (effectiveCandidate.score < MIN_INCLUSION_SCORE) continue;
    candidates.push({ ...effectiveCandidate, startMinute: slot.startMinute });
  }

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];

  const alternates: SampledCandidate[] = [];
  for (const candidate of candidates.slice(1)) {
    if (alternates.length >= MAX_ALTERNATE_WINDOWS) break;
    const tooCloseToSelected = [best, ...alternates].some((chosen) => Math.abs(chosen.startMinute - candidate.startMinute) < ALTERNATE_WINDOW_SEPARATION_MINUTES);
    if (!tooCloseToSelected) alternates.push(candidate);
  }

  return { best, alternates };
}

/**
 * The canonical Muhurtham Finder entry point. For every local date in the
 * requested range: fetches that date's Panchang (getPanchangForDate() --
 * both for the display summary AND for its overlap-preserving `windows`,
 * which findBestWindowsForDate's section-7 safety check needs), then
 * samples and evaluates candidate windows (via evaluateTimingCandidate(),
 * never a second formula), keeping the best (plus up to 2 diverse
 * alternates). Dates are ranked globally by their best window's score, then
 * the top `limit` are re-sorted chronologically for display (matching the
 * brief's own example: top-ranked dates shown in date order, not strictly
 * descending score order).
 */
export function findMuhurthams(request: MuhurthamSearchRequest): MuhurthamSearchResult {
  const activity = FULL_ACTIVITY_CATALOG.find((a) => a.id === request.activityId);
  if (!activity) {
    throw new Error(`findMuhurthams: unknown activityId "${request.activityId}".`);
  }
  if (!isSupportedMuhurthamActivity(request.activityId)) {
    throw new Error(`findMuhurthams: "${request.activityId}" is not yet supported by Muhurtham Finder.`);
  }
  if (!isValidCalendarDateString(request.dateRange.start) || !isValidCalendarDateString(request.dateRange.end) || request.dateRange.end < request.dateRange.start) {
    throw new Error('findMuhurthams: dateRange must be a valid { start, end } with end on or after start.');
  }

  const profile = profileFromActivity(activity);
  profile.personalContext = request.context.personalContext;
  const durationMinutes = Math.min(360, Math.max(15, Math.round(request.durationMinutes ?? DEFAULT_DURATION_MINUTES)));
  const limit = Math.max(1, Math.min(MAX_LIMIT, Math.round(request.limit ?? DEFAULT_LIMIT)));
  const preference = request.timePreference ?? 'ANY';
  const dateStrs = enumerateLocalDates(request.dateRange.start, request.dateRange.end);

  const dateCandidates: MuhurthamDateCandidate[] = [];
  for (const dateStr of dateStrs) {
    const panchangDay = getPanchangForDate({
      localDate: dateStr,
      latitude: request.context.latitude,
      longitude: request.context.longitude,
      timezone: request.context.timezone,
    });

    const evaluated = findBestWindowsForDate(profile, dateStr, request.context, durationMinutes, preference, panchangDay.windows, profile.muhurtaClassification);
    if (!evaluated) continue;

    const supportReasons = evaluated.best.reasons.filter((r) => r.polarity === 'SUPPORT');
    const cautionReasons = evaluated.best.reasons.filter((r) => r.polarity === 'CAUTION' || r.polarity === 'BLOCK');
    const hasCautionOrConflict = cautionReasons.length > 0 || Boolean(evaluated.best.conflicts?.length);

    dateCandidates.push({
      date: dateStr,
      rating: rateMuhurtham(evaluated.best.score, hasCautionOrConflict),
      score: evaluated.best.score,
      bestWindow: toWindowCandidate(evaluated.best),
      alternateWindows: evaluated.alternates.map(toWindowCandidate),
      reasons: supportReasons,
      cautions: cautionReasons,
      panchangSummary: {
        vara: panchangDay.panchanga.vara,
        tithi: panchangDay.panchanga.tithi.name,
        nakshatra: panchangDay.panchanga.nakshatra.name,
        yoga: panchangDay.panchanga.yoga.name,
        karana: panchangDay.panchanga.karana.name,
      },
    });
  }

  const ranked = dateCandidates
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .sort((a, b) => a.date.localeCompare(b.date));

  return {
    activity: { id: activity.id, title: activity.title, icon: activity.icon },
    dateRange: request.dateRange,
    dates: ranked,
    evaluatedDateCount: dateStrs.length,
  };
}
