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

import { DailyAssistantContext, TaskProfile, buildSlotCandidates, computeAssistantWindows, isTimingSensitiveActivity, matchesTimePreference, profileFromActivity } from './dailyAssistant';
import { evaluateTimingCandidate, TimingCandidate, TimingCandidateLabel, TimingTimePreference } from './timingSearch';
import { formatMinutes } from '../../astronomy/src/ephemeris';
import { getPanchangForDate, PanchangWindowSpan } from '../../panchang/src/panchangDay';
import { isInauspiciousCommencementWindow } from '../../panchang/src/windows';
import { isValidCalendarDateString, localDateTimeToUTC } from '../../panchang/src/localDate';
import { FULL_ACTIVITY_CATALOG } from './personalizedTasks';
import { ACTIVITY_DEFINITIONS, ActivityDefinition } from './activityDefinitions';
import { computeMuhurtaSupportLevel, resolveMuhurtaRulePack, isAuthoritativeAvoidNakshatra, isAuthoritativeAvoidTithi, AURA_MUHURTA_METHODOLOGY_ID } from '../../muhurta/src/muhurtaRulePacks';
import { evaluatePersonalMuhurtaFit, AURA_PERSONAL_FIT_METHODOLOGY_ID, PersonalMuhurtaContext } from './auraFitEngine';
import { getTaraBala } from '../../vedic/src/natalChart';
import { findNextTransition, getNakshatra, getTithi } from '../../vedic/src/panchangElements';
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
  /** SHARED scope only -- the SavedPerson's resolved natal context, plus the
   * minimal display fields the response is allowed to carry back (brief
   * section 17: never the SavedPerson's raw birth data). Ownership
   * enforcement (does this savedPersonId actually belong to the requesting
   * user?) happens entirely server-side, before this request is built --
   * see apps/web/app/api/muhurtham-search/route.ts. findSharedMuhurthams()
   * never touches a database or an id/ownership check; it only ever sees an
   * already-resolved, already-owned natal context. Left undefined for
   * GENERAL/PERSONAL. */
  partner?: { savedPersonId: string; name: string; context: PersonalMuhurtaContext };
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
 * inauspicious-commencement window (RAHU_KALAM/YAMA/GULIKA -- Inauspicious
 * Period Precedence Fix V1 widened this from RAHU_KALAM/YAMA only, since a
 * significant commencement must be protected from a Gulika overlap exactly
 * the same way) in `panchangWindows` -- the overlap-preserving list from
 * getPanchangForDate(), not the shared, priority-resolved candidate list
 * scoreContinuousBlock uses internally. See this file's module doc comment
 * ("Interval overlap") for why this extra check exists alongside, not
 * instead of, evaluateTimingCandidate()'s own FRICTION_WINDOW_BLOCKED
 * conflict (which itself now also carries this same Gulika-aware overlap
 * check -- see dailyAssistant.ts's scoreContinuousBlock -- so this remains
 * a belt-and-suspenders check, not the only one, matching this file's own
 * prior design intent).
 */
function spanOverlapsInauspiciousCommencementWindow(startISO: string, endISO: string, panchangWindows: PanchangWindowSpan[]): boolean {
  return panchangWindows.some((w) => isInauspiciousCommencementWindow(w.type) && instantSpansOverlap(startISO, endISO, w.start, w.end));
}

/**
 * Ceremonial Muhurtham Eligibility + Interval Safety V1: bounds how many
 * transition instants spanOverlapsAuthoritativeEventAvoid() will walk per
 * factor (Nakshatra, Tithi) for one candidate span. A Nakshatra averages
 * ~24h and a Tithi ~23.6h; Muhurtham Finder's longest allowed duration is
 * 360 minutes (6h -- resolveMuhurthamSearchParams' own cap below), so a real
 * candidate should never touch more than 2 distinct values of either
 * factor. This guard is a defensive ceiling against a pathological/
 * near-zero-length transition gap, never expected to bind in practice.
 */
const TRANSITION_WALK_GUARD = 8;

/**
 * Walks `getValue`/`findNextTransitionOf` forward from `start`, collecting
 * every distinct value the half-open interval [start, end) actually
 * touches -- reusing the exact same canonical transition-search primitive
 * (findNextTransition, packages/vedic/src/panchangElements.ts) already used
 * for Panchang display data, never a second astronomy algorithm and never
 * per-minute sampling. Shared by both Nakshatra and Tithi in
 * spanOverlapsAuthoritativeEventAvoid() below. findNextTransition('TITHI')
 * can throw if no transition is found within its own 2-day search bound
 * (see its doc comment) -- defensively treated the same as "no further
 * transition to walk to" rather than propagating and failing the whole
 * candidate evaluation.
 */
function valuesTouchedByInterval(start: Date, end: Date, getValue: (d: Date) => string, findNextTransitionOf: (d: Date) => Date): string[] {
  const endMs = end.getTime();
  const values: string[] = [];
  let cursor = start;
  for (let i = 0; i < TRANSITION_WALK_GUARD; i++) {
    values.push(getValue(cursor));
    if (cursor.getTime() >= endMs) break;
    let next: Date | undefined;
    try {
      next = findNextTransitionOf(cursor);
    } catch {
      break;
    }
    if (!next || next.getTime() <= cursor.getTime() || next.getTime() >= endMs) break;
    cursor = next;
  }
  return values;
}

/**
 * Ceremonial Muhurtham Eligibility core check: true if [start, end) touches
 * ANY Nakshatra or Tithi value the resolved rule pack genuinely,
 * intent-specifically (coverage === 'IMPLEMENTED') marks as avoid for this
 * occasion -- see isAuthoritativeAvoidNakshatra/isAuthoritativeAvoidTithi
 * (packages/muhurta/src/muhurtaRulePacks.ts), the single authority this
 * derives from rather than duplicating. A REUSABLE_BASE_RULE or MISSING
 * pack (every Muhurtham-eligible activity except Griha Pravesh today)
 * short-circuits to false immediately -- this never hard-rejects on
 * generic/reused data, only on data that was actually sourced FOR this
 * specific event.
 *
 * This is what turns the Jyeshtha-plus-everything-else-positive case (a
 * Griha Pravesh candidate landing on Jyeshtha, an authoritative avoid
 * Nakshatra for this occasion, while Yoga/Karana/Abhijit are each
 * independently positive) into a hard exclusion instead of a scoring input
 * an unrelated positive factor can outweigh: this check runs in
 * evaluateMuhurthamCandidate() below BEFORE that candidate's computed score
 * is allowed to stand, so there is no modifier large enough to offset it.
 *
 * Exported for direct unit testing in isolation from the rest of the search
 * pipeline -- same convention as blendStartSensitiveScore()/blendSharedDelta()
 * above/below.
 */
export function spanOverlapsAuthoritativeEventAvoid(start: Date, end: Date, classification: MuhurtaClassification): boolean {
  const pack = resolveMuhurtaRulePack(classification);
  if (pack.coverage.nakshatra !== 'IMPLEMENTED' && pack.coverage.tithi !== 'IMPLEMENTED') return false;

  if (pack.coverage.nakshatra === 'IMPLEMENTED') {
    const nakshatras = valuesTouchedByInterval(start, end, (d) => getNakshatra(d).name, (d) => findNextTransition(d, 'NAKSHATRA'));
    if (nakshatras.some((n) => isAuthoritativeAvoidNakshatra(pack, n))) return true;
  }

  if (pack.coverage.tithi === 'IMPLEMENTED') {
    const tithis = valuesTouchedByInterval(start, end, (d) => getTithi(d).name, (d) => findNextTransition(d, 'TITHI'));
    if (tithis.some((t) => isAuthoritativeAvoidTithi(pack, t))) return true;
  }

  return false;
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
/**
 * Evaluates ONE candidate start instant end-to-end: the full-duration score,
 * the section-7 friction/overlap safety check, and (when start-sensitive)
 * the commencement-probe blend -- the exact per-candidate logic
 * findBestWindowsForDate()'s scan loop needs, extracted so
 * findPersonalMuhurthams() can also call it directly for a single instant
 * (its general-only comparison score) without duplicating this logic.
 * Returns null when the candidate is hard-excluded (friction-blocked, on
 * either the full window or, for start-sensitive activities, the
 * commencement probe).
 */
function evaluateMuhurthamCandidate(
  profile: TaskProfile,
  start: Date,
  durationMinutes: number,
  context: DailyAssistantContext,
  panchangWindows: PanchangWindowSpan[],
  classification: MuhurtaClassification | undefined
): TimingCandidate | null {
  // Inauspicious Period Precedence Fix V1: unified with Timing Search's own
  // commencement-sensitivity signal (isTimingSensitiveActivity, muhurta
  // classification-based) rather than the legacy `profile.significance`
  // field this file previously used here alone -- confirmed safe: every
  // Muhurtham-supported activity's legacy significance already agreed with
  // its classification (both HIGH/DEEP-or-CEREMONIAL for all six), so this
  // changes no existing behavior, it just removes a second, independently-
  // drifting definition of "commencement-sensitive."
  const isCommencementSensitive = isTimingSensitiveActivity(classification);
  const isStartSensitive = classification?.timingSensitivity.start === 'HIGH';

  const candidate = evaluateTimingCandidate({ profile, start, durationMinutes, context });
  if (candidate.conflicts?.some((c) => c.type === 'FRICTION_WINDOW_BLOCKED')) return null;
  if (isCommencementSensitive && spanOverlapsInauspiciousCommencementWindow(candidate.start, candidate.end, panchangWindows)) return null;
  // Ceremonial Muhurtham Eligibility + Interval Safety V1: checked against
  // the FULL requested-duration span (never the shortened commencementProbe
  // below) so a longer booking that only starts clean but runs into an
  // avoid Nakshatra/Tithi partway through is still excluded.
  if (classification && spanOverlapsAuthoritativeEventAvoid(new Date(candidate.start), new Date(candidate.end), classification)) return null;

  if (!isStartSensitive) return candidate;

  const probeDurationMinutes = Math.min(durationMinutes, START_SENSITIVITY_PROBE_MINUTES);
  const commencementProbe = evaluateTimingCandidate({ profile, start, durationMinutes: probeDurationMinutes, context });
  if (commencementProbe.conflicts?.some((c) => c.type === 'FRICTION_WINDOW_BLOCKED')) return null;
  if (isCommencementSensitive && spanOverlapsInauspiciousCommencementWindow(commencementProbe.start, commencementProbe.end, panchangWindows)) return null;

  const blendedScore = blendStartSensitiveScore(candidate.score, commencementProbe.score);
  return { ...candidate, score: blendedScore, label: labelForBlendedScore(blendedScore) };
}

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

  const candidates: SampledCandidate[] = [];
  for (const slot of slotCandidates) {
    if (slot.endMinute - slot.startMinute < durationMinutes) continue;
    if (!matchesTimePreference(slot.startMinute, preference === 'ANY' ? 'ANYTIME' : preference)) continue;
    const start = localDateTimeToUTC(dateStr, formatMinutes(slot.startMinute), context.timezone);
    const effectiveCandidate = evaluateMuhurthamCandidate(profile, start, durationMinutes, context, panchangWindows, classification);
    if (!effectiveCandidate) continue;
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
 * Shared activity/date-range validation + parameter normalization used by
 * BOTH findMuhurthams() (GENERAL) and findPersonalMuhurthams() (PERSONAL) --
 * kept in one place so the two entry points can never silently drift on
 * what counts as a valid request.
 */
function resolveMuhurthamSearchParams(request: MuhurthamSearchRequest, callerName: string) {
  const activity = FULL_ACTIVITY_CATALOG.find((a) => a.id === request.activityId);
  if (!activity) {
    throw new Error(`${callerName}: unknown activityId "${request.activityId}".`);
  }
  if (!isSupportedMuhurthamActivity(request.activityId)) {
    throw new Error(`${callerName}: "${request.activityId}" is not yet supported by Muhurtham Finder.`);
  }
  if (!isValidCalendarDateString(request.dateRange.start) || !isValidCalendarDateString(request.dateRange.end) || request.dateRange.end < request.dateRange.start) {
    throw new Error(`${callerName}: dateRange must be a valid { start, end } with end on or after start.`);
  }

  return {
    activity,
    durationMinutes: Math.min(360, Math.max(15, Math.round(request.durationMinutes ?? DEFAULT_DURATION_MINUTES))),
    limit: Math.max(1, Math.min(MAX_LIMIT, Math.round(request.limit ?? DEFAULT_LIMIT))),
    preference: request.timePreference ?? 'ANY',
    dateStrs: enumerateLocalDates(request.dateRange.start, request.dateRange.end),
  };
}

/**
 * The canonical Muhurtham Finder entry point -- GENERAL scope. For every
 * local date in the requested range: fetches that date's Panchang
 * (getPanchangForDate() -- both for the display summary AND for its
 * overlap-preserving `windows`, which findBestWindowsForDate's section-7
 * safety check needs), then samples and evaluates candidate windows (via
 * evaluateTimingCandidate(), never a second formula), keeping the best
 * (plus up to 2 diverse alternates). Dates are ranked globally by their
 * best window's score, then the top `limit` are re-sorted chronologically
 * for display (matching the brief's own example: top-ranked dates shown in
 * date order, not strictly descending score order).
 *
 * Deliberately NEVER reads request.context.personalContext, even when the
 * caller's resolved context happens to carry one (e.g. the API route
 * resolves it unconditionally for the PERSONAL path) -- GENERAL must answer
 * "when is this generally favorable", with zero natal-data influence on
 * ranking or score. See findPersonalMuhurthams() for the PERSONAL scope
 * that intentionally does use it. (Before this PR, this function DID
 * accidentally thread personalContext through when present -- a genuine,
 * intentionally-fixed bug; see the Personal Muhurtham completion report.)
 */
export function findMuhurthams(request: MuhurthamSearchRequest): MuhurthamSearchResult {
  const { activity, durationMinutes, limit, preference, dateStrs } = resolveMuhurthamSearchParams(request, 'findMuhurthams');
  const generalContext: DailyAssistantContext = { ...request.context, personalContext: undefined };
  const profile = profileFromActivity(activity);

  const dateCandidates: MuhurthamDateCandidate[] = [];
  for (const dateStr of dateStrs) {
    const panchangDay = getPanchangForDate({
      localDate: dateStr,
      latitude: request.context.latitude,
      longitude: request.context.longitude,
      timezone: request.context.timezone,
    });

    const evaluated = findBestWindowsForDate(profile, dateStr, generalContext, durationMinutes, preference, panchangDay.windows, profile.muhurtaClassification);
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

/**
 * ## Personal Muhurtham ("General | For Me")
 *
 * findPersonalMuhurthams() answers "when is this favorable FOR THIS USER",
 * layering personal factors on top of (never instead of) the exact same
 * general Muhurta evaluation findMuhurthams() uses. It does not duplicate
 * any scoring logic: every candidate still goes through
 * evaluateMuhurthamCandidate() (the identical friction/overlap/
 * start-sensitivity pipeline), just with the profile's personalContext
 * populated -- the ONLY difference from GENERAL is whether
 * evaluateActivityFit()'s existing `personalContext` parameter is passed.
 *
 * ## Personal factor audit (brief section 1) -- what's actually implemented
 *
 * IMPLEMENTED_AND_VALIDATED: Tara Bala (getTaraBala(), packages/vedic/src/
 * natalChart.ts) -- a standard, unambiguous distance-counting technique
 * (today's Nakshatra's position relative to the natal Nakshatra, mod 9),
 * already in production (natal chart display) and already wired into Aura
 * Fit's `personalPatternScore` at a fixed 10% weight. This PR reuses it
 * exactly as-is -- no second Tara calculation.
 *
 * IMPLEMENTED_BUT_HEURISTIC: the moon-element-affinity bonus inside
 * evaluatePersonalMuhurtaFit() (auraFitEngine.ts) -- matching the natal
 * Moon's Rashi element against an activity's `elementAffinity` is a
 * designed scoring heuristic layered on top of real astrology (the Rashi
 * placement itself), not itself a named classical Muhurta technique. Also
 * heuristic: the "-8 penalty when Tara is unfavorable AND the activity is
 * HIGH significance/requiresFreshStart" amplifier.
 *
 * AVAILABLE_BUT_UNUSED: janmaRashi (the natal Moon's Rashi name) is
 * computed (buildPersonalMuhurtaContext, apps/web/app/api/muhurtham-search/
 * route.ts) but only consumed indirectly via the element-affinity mapping
 * above -- there is no direct Rashi-based rule (e.g. Chandra Bala) reading
 * it on its own. `UserChartContext.lagnaSign` (personalizedTasks.ts) is
 * declared but never populated with a real value or read by any scoring
 * path.
 *
 * NOT_IMPLEMENTED: Chandra Bala, Lagna-based Muhurta, Navamsha, Dasha/
 * Antardasha, Ashtakavarga -- none of these exist anywhere in this
 * codebase. This PR does not add any of them (brief section 17); Tara Bala
 * is the only personal factor this PR uses, per brief section 5's explicit
 * instruction not to add new astrology merely to make personalization look
 * richer.
 *
 * ## Minimum profile requirement
 *
 * Only birthDate + birthTime + birthTimezone (brief section 9) --
 * NOT birth location/lat-lng, Lagna, or Navamsha. This is the exact gate
 * buildPersonalMuhurtaContext() (the route-level context builder) already
 * uses to decide whether `personalContext` exists at all; this file cannot
 * (and does not) know which of the three raw fields is missing (it only
 * sees the resolved PersonalMuhurtaContext, or its absence), so
 * PERSONAL_PROFILE_INCOMPLETE always names all three as the required set.
 *
 * ## generalScore / personalScore / combinedScore (brief section 7)
 *
 * No new weight is invented. `combinedScore` is exactly what
 * evaluateTimingCandidate() already produces when `profile.personalContext`
 * is set -- i.e. the EXISTING evaluateActivityFit() formula's
 * `personalPatternScore * 0.10` term (general Muhurta dominates at 90% of
 * the weight; personal factors are a bounded ≤10%-of-total modifier).
 * `generalScore` is the exact same instant/duration scored a second time
 * WITHOUT personalContext (evaluateMuhurthamCandidate() again, on a profile
 * copy with personalContext stripped) -- "what GENERAL would have said
 * about this same moment". `personalScore` is evaluatePersonalMuhurtaFit()'s
 * own raw 0-100 score (Tara Bala + element affinity, unchanged), rescaled to
 * the 0-10 presentation scale for display consistency with the other two.
 * Ranking uses combinedScore -- see PERSONALIZATION MUST RE-RANK below.
 *
 * ## Re-ranking (brief section 8) and hard blocks (brief section 4)
 *
 * Every date's best window is selected by scanning candidates with
 * combinedScore (personalContext applied throughout the scan, exactly like
 * findBestWindowsForDate()'s GENERAL scan but with a personalized profile),
 * so a date whose Tara Bala is favorable can out-rank a date with a
 * marginally higher general score, and vice versa -- genuine re-ranking,
 * not a cosmetic label change. Hard blocks are untouched: friction/overlap
 * exclusion (evaluateMuhurthamCandidate()'s FRICTION_WINDOW_BLOCKED and
 * spanOverlapsFrictionWindow() checks) never reads personalContext at all,
 * so a generally-blocked candidate cannot be rescued by a favorable Tara
 * Bala, and a favorable general candidate is never excluded by an
 * unfavorable one either (personal factors only ever adjust the ~10%-bounded
 * score of an ALREADY-valid candidate).
 *
 * ## Methodology separation (brief section 16)
 *
 * Tara Bala/element-affinity are NOT part of AURA_MUHURTA_V1 (the
 * traditional-rule methodology, packages/muhurta/src/muhurtaRulePacks.ts) --
 * MuhurthamPersonalSearchResult.provenance carries both identifiers
 * separately (muhurtaMethodology + personalMethodology), never merged.
 */

export type MuhurthamSearchScope = 'GENERAL' | 'PERSONAL' | 'SHARED';

/** The Tara Bala factor as surfaced in a personal evaluation -- 'NEUTRAL' is
 * declared for interface completeness (brief section 6: "keep extensible
 * for future personal factors") but unreachable today, since
 * getTaraBala().favorable is a strict boolean (no neutral tara in the
 * existing calculation). */
export interface PersonalTaraBalaFactor {
  tara: string;
  status: 'SUPPORT' | 'NEUTRAL' | 'CAUTION';
  score?: number;
}

export interface PersonalMuhurtaFactors {
  taraBala?: PersonalTaraBalaFactor;
}

export interface MuhurthamPersonalDateCandidate {
  date: string;
  /** Derived from combinedScore, same thresholds as GENERAL's rateMuhurtham. */
  rating: MuhurthamRating;
  /** What GENERAL would score this exact instant/duration -- 0-10. */
  generalScore: number;
  /** evaluatePersonalMuhurtaFit()'s own score (Tara Bala + element affinity),
   * rescaled from its native 0-100 to 0-10. */
  personalScore: number;
  /** The actual ranking score -- general Muhurta blended with personal
   * factors via the EXISTING evaluateActivityFit() weighting (10% personal,
   * unchanged formula). Same value as bestWindow.score. */
  combinedScore: number;
  /** The combined-scored window -- reasons include both general Panchanga
   * reasons and personal (Tara Bala/element) reasons, already merged by
   * evaluateActivityFit(). */
  bestWindow: MuhurthamWindowCandidate;
  alternateWindows: MuhurthamWindowCandidate[];
  reasons: MuhurtaReason[];
  cautions: MuhurtaReason[];
  personalFactors: PersonalMuhurtaFactors;
  panchangSummary: MuhurthamPanchangSummary;
}

export interface MuhurthamPersonalSearchResult {
  scope: 'PERSONAL';
  status: 'OK';
  activity: { id: string; title: string; icon: string };
  dateRange: MuhurthamDateRange;
  dates: MuhurthamPersonalDateCandidate[];
  evaluatedDateCount: number;
  provenance: { muhurtaMethodology: string; personalMethodology: string };
}

/** Returned instead of a result when PERSONAL scope was requested but the
 * user's profile doesn't have what Tara Bala needs -- never a silent
 * fallback to GENERAL (brief section 9). */
export interface MuhurthamProfileIncomplete {
  scope: 'PERSONAL';
  status: 'PERSONAL_PROFILE_INCOMPLETE';
  requiredFields: Array<'birthDate' | 'birthTime' | 'birthTimezone'>;
}

export type MuhurthamPersonalSearchOutcome = MuhurthamPersonalSearchResult | MuhurthamProfileIncomplete;

const REQUIRED_PERSONAL_PROFILE_FIELDS: MuhurthamProfileIncomplete['requiredFields'] = ['birthDate', 'birthTime', 'birthTimezone'];

function taraBalaFactor(personalContext: PersonalMuhurtaContext, at: Date): PersonalTaraBalaFactor {
  const taraBala = getTaraBala(personalContext.natalNakshatraIndex!, at);
  return { tara: taraBala.name, status: taraBala.favorable ? 'SUPPORT' : 'CAUTION' };
}

/**
 * PERSONAL scope entry point -- see this file's "Personal Muhurtham" doc
 * comment above for the full architecture. Same request shape as
 * findMuhurthams() (activityId/dateRange/timePreference/durationMinutes/
 * limit/context); PERSONAL-ness comes entirely from actually USING
 * request.context.personalContext, which findMuhurthams() deliberately
 * ignores.
 */
export function findPersonalMuhurthams(request: MuhurthamSearchRequest): MuhurthamPersonalSearchOutcome {
  const { activity, durationMinutes, limit, preference, dateStrs } = resolveMuhurthamSearchParams(request, 'findPersonalMuhurthams');

  const personalContext = request.context.personalContext;
  if (!personalContext || personalContext.natalNakshatraIndex === undefined) {
    return { scope: 'PERSONAL', status: 'PERSONAL_PROFILE_INCOMPLETE', requiredFields: REQUIRED_PERSONAL_PROFILE_FIELDS };
  }

  const personalProfile = profileFromActivity(activity);
  personalProfile.personalContext = personalContext;
  const generalOnlyProfile: TaskProfile = { ...personalProfile, personalContext: undefined };
  const generalContext: DailyAssistantContext = { ...request.context, personalContext: undefined };

  const dateCandidates: MuhurthamPersonalDateCandidate[] = [];
  for (const dateStr of dateStrs) {
    const panchangDay = getPanchangForDate({
      localDate: dateStr,
      latitude: request.context.latitude,
      longitude: request.context.longitude,
      timezone: request.context.timezone,
    });

    // Scan and rank by combinedScore -- the personalized profile is used
    // throughout, so a date's best window is chosen WITH personal factors
    // in mind, not merely re-scored after the fact.
    const evaluated = findBestWindowsForDate(personalProfile, dateStr, request.context, durationMinutes, preference, panchangDay.windows, personalProfile.muhurtaClassification);
    if (!evaluated) continue;

    const bestStart = new Date(evaluated.best.start);
    const generalCandidate = evaluateMuhurthamCandidate(generalOnlyProfile, bestStart, durationMinutes, generalContext, panchangDay.windows, personalProfile.muhurtaClassification) ?? evaluated.best;
    const personalFit = evaluatePersonalMuhurtaFit(activity, bestStart, personalContext);

    const supportReasons = evaluated.best.reasons.filter((r) => r.polarity === 'SUPPORT');
    const cautionReasons = evaluated.best.reasons.filter((r) => r.polarity === 'CAUTION' || r.polarity === 'BLOCK');
    const hasCautionOrConflict = cautionReasons.length > 0 || Boolean(evaluated.best.conflicts?.length);

    dateCandidates.push({
      date: dateStr,
      rating: rateMuhurtham(evaluated.best.score, hasCautionOrConflict),
      generalScore: generalCandidate.score,
      personalScore: Math.round(personalFit.score) / 10,
      combinedScore: evaluated.best.score,
      bestWindow: toWindowCandidate(evaluated.best),
      alternateWindows: evaluated.alternates.map(toWindowCandidate),
      reasons: supportReasons,
      cautions: cautionReasons,
      personalFactors: { taraBala: taraBalaFactor(personalContext, bestStart) },
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
    .sort((a, b) => b.combinedScore - a.combinedScore)
    .slice(0, limit)
    .sort((a, b) => a.date.localeCompare(b.date));

  return {
    scope: 'PERSONAL',
    status: 'OK',
    activity: { id: activity.id, title: activity.title, icon: activity.icon },
    dateRange: request.dateRange,
    dates: ranked,
    evaluatedDateCount: dateStrs.length,
    provenance: { muhurtaMethodology: AURA_MUHURTA_METHODOLOGY_ID, personalMethodology: AURA_PERSONAL_FIT_METHODOLOGY_ID },
  };
}

/**
 * ## Shared Muhurtham ("General | Me | Us")
 *
 * findSharedMuhurthams() answers "when is this favorable for BOTH the
 * authenticated user and one SavedPerson" -- shared TIMING, not
 * compatibility. It is not a third scoring formula: every candidate window
 * is still selected by the exact same findBestWindowsForDate() GENERAL scan
 * findMuhurthams() uses (generalContext, personalContext stripped) -- SHARED
 * never re-picks a date's best window using either person's personal
 * context, so candidate generation is never duplicated (brief section 1).
 * Once a date's general-valid best window is chosen, each person's fit on
 * that EXACT window is evaluated independently, by calling
 * evaluateMuhurthamCandidate() again per person (the identical
 * friction/overlap/start-sensitivity pipeline PERSONAL already uses, just
 * with that one person's personalContext threaded onto a fresh profile
 * copy) -- i.e. "what would this person's own PERSONAL combinedScore be for
 * this candidate". There is no synastry: person A's Tara Bala is computed
 * against the candidate's Nakshatra, person B's Tara Bala is computed
 * against the same candidate's Nakshatra, completely independently of one
 * another (brief section 3) -- neither evaluation ever reads the other
 * person's natal data.
 *
 * ## Why not a simple average (brief section 4)
 *
 * `shared = (userScore + partnerScore) / 2` would let a strong participant
 * mask a weak one (9.5 and 4.0 averaging to a misleadingly acceptable 6.75).
 * Shared ranking must instead reward BALANCED suitability and let the
 * weaker participant's fit matter strongly (brief section 6:
 * "min(userFit, personFit) should matter strongly"). This file computes
 * each participant's own bounded personal DELTA on top of the shared
 * generalScore -- combinedScore minus generalScore, i.e. exactly the same
 * ≤10%-weighted personal modifier PERSONAL scope already produces for a
 * single person (evaluateActivityFit's existing `personalPatternScore *
 * 0.10` term; no new weight invented) -- then blends the two deltas as
 * SHARED_FLOOR_WEIGHT (70%) of the WEAKER delta plus (1 - SHARED_FLOOR_WEIGHT)
 * (30%) of their average. When both deltas are equal (perfectly balanced
 * fit) this blend reduces exactly to their average -- a balanced pair is
 * never penalized relative to a plain-average model. When they diverge, the
 * blend leans toward the weaker participant's delta, so a candidate with one
 * strong and one poor personal fit scores lower than a comparable candidate
 * where both are supportive, even at an equal or slightly better general
 * score -- without ever hard-rejecting a CAUTION Tara on its own (brief
 * section 6: "do not necessarily make every Tara CAUTION a hard rejection").
 * See blendSharedDelta() below for the exact, minimal formula.
 *
 * ## General Muhurta remains the foundation (brief section 7)
 *
 * Personal/shared fit can never rescue a general BLOCK, an invalid
 * duration, a friction-window overlap, or an unsupported activity --
 * findBestWindowsForDate() is called with generalContext exactly like
 * findMuhurthams(), so every hard-exclusion rule (evaluateMuhurthamCandidate's
 * FRICTION_WINDOW_BLOCKED conflict and spanOverlapsFrictionWindow() check)
 * runs before either person's personal fit is even computed. A date that
 * findMuhurthams() would exclude entirely is excluded here too, for the
 * identical reason.
 *
 * ## Profile requirements (brief section 11)
 *
 * SHARED requires BOTH a complete user profile (request.context.personalContext,
 * the same PERSONAL_PROFILE_INCOMPLETE gate reused as USER_PROFILE_INCOMPLETE)
 * AND a complete SavedPerson profile (request.partner, resolved server-side).
 * Never a silent fallback to GENERAL -- an incomplete state is always a typed,
 * explicit outcome. SavedPerson's birthTime/birthTimezone are DB-required
 * (NOT NULL, see apps/web/prisma/schema.prisma), so SAVED_PERSON_PROFILE_INCOMPLETE
 * is not reachable through the current SavedPerson creation flow -- kept as a
 * real, checked typed state anyway (not dead code deleted, just currently
 * unreachable via this app's own UI) for the same reason PersonalTaraBalaFactor
 * declares an unreachable 'NEUTRAL' status: interface correctness and
 * forward-compatibility, not speculative engineering.
 *
 * ## Methodology (brief section 9)
 *
 * AURA_SHARED_FIT_V1 is explicitly NOT a compatibility methodology -- it
 * does not compare the two people's charts against each other (no synastry,
 * no Guna Milan/Ashtakoota, no relationship score). It evaluates shared
 * TIMING only: does the same general-favorable moment work reasonably well
 * for each person independently, and does it do so for BOTH of them rather
 * than just the stronger one. provenance carries all three methodology
 * identifiers separately (muhurtaMethodology, personalMethodology,
 * sharedMethodology), never merged.
 */

export const AURA_SHARED_FIT_METHODOLOGY_ID = 'AURA_SHARED_FIT_V1' as const;

/**
 * Section 6's "min(userFit, personFit) should matter strongly": the WEAKER
 * participant's personal delta gets this fraction of the blend; the
 * remaining (1 - SHARED_FLOOR_WEIGHT) comes from the two deltas' plain
 * average. When the two deltas are equal, min === average, so the blend is
 * identical to a plain average in the perfectly-balanced case -- this
 * weight only ever matters, and only ever pulls the score DOWN relative to
 * a plain average, when the two participants' fit actually diverges. 0.7 is
 * the smallest weight that reliably lets a single poor Tara Bala (the
 * ~0.25-wide swing evaluatePersonalMuhurtaFit's HIGH-significance CAUTION
 * penalty produces on the 0-10 scale, see the completion report's
 * score-distribution audit) outweigh a plain-average blend for these
 * already-small personal deltas, without being 1.0 (which would ignore the
 * stronger participant's fit entirely -- not what brief section 6 asks for:
 * "do not necessarily make every Tara CAUTION a hard rejection").
 */
export const SHARED_FLOOR_WEIGHT = 0.7;

/** Pure blend of two participants' personal deltas (each: combinedScore -
 * generalScore, on the 0-10 scale) into one shared delta -- exported for
 * direct unit testing of the balance/floor weighting model in isolation
 * from the rest of the search pipeline. See this file's "Shared Muhurtham"
 * doc comment above for the full reasoning; this is deliberately NOT
 * `(userDelta + personDelta) / 2` (brief section 4). */
export function blendSharedDelta(userDelta: number, personDelta: number): number {
  const weaker = Math.min(userDelta, personDelta);
  const average = (userDelta + personDelta) / 2;
  return Math.round((weaker * SHARED_FLOOR_WEIGHT + average * (1 - SHARED_FLOOR_WEIGHT)) * 1000) / 1000;
}

export type SharedMuhurthamRating = 'EXCELLENT_SHARED_FIT' | 'STRONG_SHARED_FIT' | 'GOOD_SHARED_FIT' | 'MIXED_SHARED_FIT';

/**
 * Brief section 16: "Do not reuse romantic compatibility labels... the
 * lowest participant fit should influence the label." Any CAUTION Tara on
 * EITHER side caps the label at MIXED_SHARED_FIT, regardless of sharedScore
 * -- that is literally what "mixed" means here (one or both participants'
 * own Tara Bala is unsupportive for this candidate), and it's the most
 * direct, smallest-possible way to let the weaker fit influence the label
 * without inventing a second threshold system. When both are SUPPORT, the
 * same 9.0/8.0/7.0 boundaries rateMuhurtham() already uses classify the
 * blended sharedScore (with the same caution/conflict cap on the top label
 * rateMuhurtham() applies) -- no new score thresholds invented.
 */
function rateSharedMuhurtham(sharedScore: number, userTaraStatus: PersonalTaraBalaFactor['status'], personTaraStatus: PersonalTaraBalaFactor['status'], hasCautionOrConflict: boolean): SharedMuhurthamRating {
  if (userTaraStatus === 'CAUTION' || personTaraStatus === 'CAUTION') return 'MIXED_SHARED_FIT';
  if (sharedScore >= 9.0 && !hasCautionOrConflict) return 'EXCELLENT_SHARED_FIT';
  if (sharedScore >= 8.0) return 'STRONG_SHARED_FIT';
  return 'GOOD_SHARED_FIT';
}

/** One participant's own PERSONAL-equivalent combinedScore (general Muhurta
 * + their own personal layer, identical formula/weight to PERSONAL scope)
 * for an ALREADY-chosen general-valid candidate window -- reuses
 * evaluateMuhurthamCandidate() again (never a second scoring formula), on a
 * cheap spread copy of the shared general profile with only personalContext
 * swapped in, exactly like findPersonalMuhurthams()'s own
 * generalOnlyProfile/generalContext split. The `?? generalFallbackScore`
 * mirrors findPersonalMuhurthams()'s identical defensive fallback -- not a
 * reachable path today, since none of the friction/overlap checks this
 * candidate already passed as GENERAL depend on personalContext, but kept
 * for the same robustness reason. */
function participantCombinedScore(
  generalProfile: TaskProfile,
  bestStart: Date,
  durationMinutes: number,
  context: DailyAssistantContext,
  personalContext: PersonalMuhurtaContext,
  panchangWindows: PanchangWindowSpan[],
  generalFallbackScore: number
): number {
  const participantProfile: TaskProfile = { ...generalProfile, personalContext };
  const evaluated = evaluateMuhurthamCandidate(participantProfile, bestStart, durationMinutes, context, panchangWindows, generalProfile.muhurtaClassification);
  return evaluated?.score ?? generalFallbackScore;
}

/** One participant's fit on a SHARED candidate -- structurally the same
 * `{score, factors, reasons}` sketch brief section 8 asks for. */
export interface SharedParticipantFit {
  /** This participant's own combinedScore (0-10) for this exact candidate
   * window -- general Muhurta blended with their personal factors, the
   * identical scale/semantics as PERSONAL's own combinedScore. */
  score: number;
  factors: PersonalMuhurtaFactors;
  reasons: MuhurtaReason[];
}

export interface MuhurthamSharedDateCandidate {
  date: string;
  rating: SharedMuhurthamRating;
  /** What GENERAL scores this exact candidate -- 0-10, identical semantics
   * to MuhurthamPersonalDateCandidate.generalScore. */
  generalScore: number;
  user: SharedParticipantFit;
  person: SharedParticipantFit & { savedPersonId: string; name: string };
  /** The actual ranking score: generalScore + blendSharedDelta(userDelta,
   * personDelta). Same 0-10 scale as generalScore/user.score/person.score. */
  sharedScore: number;
  /** Informational only (never used in ranking beyond already being part of
   * sharedScore's own inputs) -- 10 when the two participants' personal
   * deltas for this candidate are identical (perfectly even fit), lower as
   * they diverge. Brief section 8's optional `balance?` field. */
  balance: number;
  bestWindow: MuhurthamWindowCandidate;
  alternateWindows: MuhurthamWindowCandidate[];
  /** SUPPORT-polarity GENERAL reasons (Panchanga/solar-window), same as
   * MuhurthamDateCandidate.reasons -- personal reasons live under
   * user.reasons/person.reasons instead, kept separate so the UI can render
   * "General Muhurta" / "For you" / "For {name}" as distinct sections
   * (brief section 15). */
  reasons: MuhurtaReason[];
  cautions: MuhurtaReason[];
  panchangSummary: MuhurthamPanchangSummary;
}

export interface MuhurthamSharedSearchResult {
  scope: 'SHARED';
  status: 'OK';
  activity: { id: string; title: string; icon: string };
  dateRange: MuhurthamDateRange;
  /** Brief section 17: id + display name only -- never the SavedPerson's
   * birth date/time/timezone/coordinates. The UI already knows which person
   * it selected; natal details stay server-side. */
  savedPerson: { id: string; name: string };
  dates: MuhurthamSharedDateCandidate[];
  evaluatedDateCount: number;
  provenance: { muhurtaMethodology: string; personalMethodology: string; sharedMethodology: string };
}

export interface MuhurthamUserProfileIncomplete {
  scope: 'SHARED';
  status: 'USER_PROFILE_INCOMPLETE';
  requiredFields: Array<'birthDate' | 'birthTime' | 'birthTimezone'>;
}

/** See this file's "Shared Muhurtham" doc comment ("Profile requirements")
 * for why this state is currently unreachable via the app's own SavedPerson
 * creation flow, but kept as a real typed outcome. */
export interface MuhurthamSavedPersonProfileIncomplete {
  scope: 'SHARED';
  status: 'SAVED_PERSON_PROFILE_INCOMPLETE';
  requiredFields: Array<'birthDate' | 'birthTime' | 'birthTimezone'>;
}

export type MuhurthamSharedSearchOutcome = MuhurthamSharedSearchResult | MuhurthamUserProfileIncomplete | MuhurthamSavedPersonProfileIncomplete;

/**
 * SHARED scope entry point -- see this file's "Shared Muhurtham" doc comment
 * above for the full architecture. Same request shape as findMuhurthams()/
 * findPersonalMuhurthams() plus `request.partner` (resolved server-side,
 * ownership already enforced by the caller before this function is ever
 * invoked).
 */
export function findSharedMuhurthams(request: MuhurthamSearchRequest): MuhurthamSharedSearchOutcome {
  const { activity, durationMinutes, limit, preference, dateStrs } = resolveMuhurthamSearchParams(request, 'findSharedMuhurthams');

  const userContext = request.context.personalContext;
  if (!userContext || userContext.natalNakshatraIndex === undefined) {
    return { scope: 'SHARED', status: 'USER_PROFILE_INCOMPLETE', requiredFields: REQUIRED_PERSONAL_PROFILE_FIELDS };
  }

  const partner = request.partner;
  if (!partner || partner.context.natalNakshatraIndex === undefined) {
    return { scope: 'SHARED', status: 'SAVED_PERSON_PROFILE_INCOMPLETE', requiredFields: REQUIRED_PERSONAL_PROFILE_FIELDS };
  }

  const generalContext: DailyAssistantContext = { ...request.context, personalContext: undefined };
  const generalProfile = profileFromActivity(activity);

  const dateCandidates: MuhurthamSharedDateCandidate[] = [];
  for (const dateStr of dateStrs) {
    const panchangDay = getPanchangForDate({
      localDate: dateStr,
      latitude: request.context.latitude,
      longitude: request.context.longitude,
      timezone: request.context.timezone,
    });

    // Same GENERAL candidate generation findMuhurthams() uses -- SHARED
    // never re-derives or re-picks window candidates using either person's
    // personal context (brief section 1 / section 7).
    const evaluated = findBestWindowsForDate(generalProfile, dateStr, generalContext, durationMinutes, preference, panchangDay.windows, generalProfile.muhurtaClassification);
    if (!evaluated) continue;

    const bestStart = new Date(evaluated.best.start);
    const generalScore = evaluated.best.score;

    const userCombined = participantCombinedScore(generalProfile, bestStart, durationMinutes, generalContext, userContext, panchangDay.windows, generalScore);
    const personCombined = participantCombinedScore(generalProfile, bestStart, durationMinutes, generalContext, partner.context, panchangDay.windows, generalScore);

    const userTara = taraBalaFactor(userContext, bestStart);
    const personTara = taraBalaFactor(partner.context, bestStart);
    const userFit = evaluatePersonalMuhurtaFit(activity, bestStart, userContext);
    const personFit = evaluatePersonalMuhurtaFit(activity, bestStart, partner.context);

    const userDelta = userCombined - generalScore;
    const personDelta = personCombined - generalScore;
    const sharedDelta = blendSharedDelta(userDelta, personDelta);
    const sharedScore = Math.max(0, Math.min(10, Math.round((generalScore + sharedDelta) * 10) / 10));
    const balance = Math.round(Math.max(0, 10 - Math.abs(userDelta - personDelta) * 10) * 10) / 10;

    const supportReasons = evaluated.best.reasons.filter((r) => r.polarity === 'SUPPORT');
    const cautionReasons = evaluated.best.reasons.filter((r) => r.polarity === 'CAUTION' || r.polarity === 'BLOCK');
    const hasCautionOrConflict = cautionReasons.length > 0 || Boolean(evaluated.best.conflicts?.length);

    dateCandidates.push({
      date: dateStr,
      rating: rateSharedMuhurtham(sharedScore, userTara.status, personTara.status, hasCautionOrConflict),
      generalScore,
      user: { score: Math.round(userCombined * 10) / 10, factors: { taraBala: userTara }, reasons: userFit.reasons ?? [] },
      person: { savedPersonId: partner.savedPersonId, name: partner.name, score: Math.round(personCombined * 10) / 10, factors: { taraBala: personTara }, reasons: personFit.reasons ?? [] },
      sharedScore,
      balance,
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
    .sort((a, b) => b.sharedScore - a.sharedScore)
    .slice(0, limit)
    .sort((a, b) => a.date.localeCompare(b.date));

  return {
    scope: 'SHARED',
    status: 'OK',
    activity: { id: activity.id, title: activity.title, icon: activity.icon },
    dateRange: request.dateRange,
    savedPerson: { id: partner.savedPersonId, name: partner.name },
    dates: ranked,
    evaluatedDateCount: dateStrs.length,
    provenance: { muhurtaMethodology: AURA_MUHURTA_METHODOLOGY_ID, personalMethodology: AURA_PERSONAL_FIT_METHODOLOGY_ID, sharedMethodology: AURA_SHARED_FIT_METHODOLOGY_ID },
  };
}
