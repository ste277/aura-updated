/**
 * Product Structure V2 -- everyday shared timing (brief section 12).
 *
 * Deliberately NOT built on findSharedMuhurthams()/findMuhurthams(): those
 * are gated to SUPPORTED_MUHURTHAM_ACTIVITY_IDS (resolveMuhurthamSearchParams
 * in muhurthamFinder.ts throws for anything else), so calling them for a
 * LIGHT/STANDARD everyday activity like Date Night or Coffee is not just
 * architecturally wrong, it's not even possible without weakening that
 * gate -- which the brief explicitly forbids ("Do NOT simply expose
 * LIGHT/STANDARD activities through Muhurtham Finder").
 *
 * Instead this reuses the SAME primitives from a different angle:
 *   1. runTimingSearch({ mode: 'FIND', ... }) generates the GENERAL-ranked
 *      candidate pool (timingSearch.ts's own FIND, unmodified) -- a short
 *      practical-window search, not a wide date-range occasion search.
 *   2. For each candidate, evaluateTimingCandidate() is called twice more
 *      -- once with the user's own personalContext, once with the selected
 *      SavedPerson's -- exactly the same "general + personal layer" split
 *      PERSONAL scope already produces for a single person
 *      (evaluateActivityFit's existing personalPatternScore*0.10 term).
 *   3. blendSharedDelta() (muhurthamFinder.ts, already exported, already
 *      unit-tested) combines the two participants' deltas -- the exact
 *      same non-averaging, floor-weighted formula SHARED Muhurtham uses.
 *      No new astrology weight, no new shared formula.
 *
 * The result is re-ranked by sharedScore and capped to `limit` -- the same
 * general-favorable-moment-first, then-personalize, then-blend pipeline as
 * SHARED Muhurtham, just running on Timing Search's simpler short-window
 * candidate generation instead of Muhurtham's date-range occasion sampling.
 */

import { DailyAssistantContext, PlanningHorizon, profileFromActivity, TaskProfile } from './dailyAssistant';
import { evaluateTimingCandidate, runTimingSearch, TimingCandidate, TimingSearchDateRange, TimingTimePreference } from './timingSearch';
import { blendSharedDelta } from './muhurthamFinder';
import type { PersonalMuhurtaContext } from './auraFitEngine';
import { FULL_ACTIVITY_CATALOG } from './personalizedTasks';

/** Wider than the final display limit -- gives the shared re-rank step a
 * real pool to pick the best-for-both candidate from, rather than just
 * re-ordering the 3 candidates GENERAL alone would have shown. */
const CANDIDATE_POOL_SIZE = 12;

export type EverydayTimingRating = 'STRONG_TOGETHER_FIT' | 'GOOD_TOGETHER_FIT' | 'EASY_TOGETHER_FIT';

/**
 * Same 9.0/8.0 boundaries rateMuhurtham()/rateSharedMuhurthamRating() already
 * use on this identical 0-10 scale (muhurthamFinder.ts) -- no new score
 * thresholds invented, just everyday-appropriate vocabulary (never
 * "Muhurtham"/"auspicious" language for a LIGHT/STANDARD activity, per
 * brief section 14/15).
 */
function rateEverydaySharedFit(sharedScore: number): EverydayTimingRating {
  if (sharedScore >= 9.0) return 'STRONG_TOGETHER_FIT';
  if (sharedScore >= 8.0) return 'GOOD_TOGETHER_FIT';
  return 'EASY_TOGETHER_FIT';
}

export interface EverydaySharedCandidate {
  start: string;
  end: string;
  /** The GENERAL candidate this was derived from -- unmodified, still the
   * foundation (brief section 7 of the Shared Muhurtham brief, reused here:
   * personal/shared fit can never rescue a general friction-window block). */
  generalCandidate: TimingCandidate;
  /** 0-10, same scale as TimingCandidate.score. */
  sharedScore: number;
  rating: EverydayTimingRating;
  userScore: number;
  partnerScore: number;
}

export interface EverydaySharedFitRequest {
  activityId: string;
  durationMinutes: number;
  /** Either an explicit dateRange, or the same horizon/custom-date fields
   * runTimingSearch's own FIND mode already accepts -- passed straight
   * through, not re-resolved here, so this can never drift from Timing
   * Search's own horizon semantics. */
  dateRange?: TimingSearchDateRange;
  horizon?: PlanningHorizon;
  customStartDate?: string;
  customEndDate?: string;
  timePreference?: TimingTimePreference;
  limit?: number;
  /** The signed-in user's own context -- context.personalContext is used
   * for the "for you" score; a copy with personalContext undefined is used
   * for the GENERAL pool so a signed-in user's own profile never silently
   * biases what counts as "generally favorable" (same separation SHARED
   * Muhurtham already maintains). */
  context: DailyAssistantContext;
  partnerContext: PersonalMuhurtaContext;
}

export type EverydaySharedFitOutcome =
  | { status: 'OK'; candidates: EverydaySharedCandidate[] }
  | { status: 'UNSUPPORTED_ACTIVITY' };

/**
 * The per-candidate general+owner+partner+blend calculation -- extracted
 * (Ask Aura Scope-Aware Everyday TIMING_CHECK V1) so a caller evaluating a
 * SINGLE exact instant (generic SHARED TIMING_CHECK) can reuse the EXACT
 * same methodology findEverydaySharedTiming() already applies per-candidate
 * across its own search pool, without duplicating the general/owner/partner
 * evaluation, delta computation, blend, or clamp/round logic.
 *
 * `generalCandidate` is supplied by the caller (never computed here) so
 * this stays agnostic to HOW that baseline candidate was produced -- a FIND
 * pool entry for findEverydaySharedTiming below, or a single CHECK-mode
 * evaluation of one caller-specified instant for Ask Aura's SHARED CHECK.
 * Reasons stay general/base-only (generalCandidate.reasons, untouched) --
 * SAME existing convention this function's inline predecessor already
 * used: personalization is reflected in sharedScore/userScore/partnerScore
 * only, never as new owner-/partner-specific reason text (brief section 19
 * of the Scope-Aware TIMING_CHECK brief: "preserve that convention").
 */
export function evaluateEverydaySharedCandidate(params: {
  profile: TaskProfile;
  generalCandidate: TimingCandidate;
  durationMinutes: number;
  /** The signed-in owner's own context (context.personalContext is the
   * owner's natal data) -- NOT personalContext-stripped, unlike the context
   * used to produce `generalCandidate` itself. */
  context: DailyAssistantContext;
  partnerContext: PersonalMuhurtaContext;
}): EverydaySharedCandidate {
  const { profile, generalCandidate, durationMinutes, context, partnerContext } = params;
  const start = new Date(generalCandidate.start);
  const userEval = evaluateTimingCandidate({
    profile: { ...profile, personalContext: context.personalContext },
    start,
    durationMinutes,
    context,
  });
  const partnerEval = evaluateTimingCandidate({
    profile: { ...profile, personalContext: partnerContext },
    start,
    durationMinutes,
    context,
  });

  const userDelta = userEval.score - generalCandidate.score;
  const partnerDelta = partnerEval.score - generalCandidate.score;
  const sharedDelta = blendSharedDelta(userDelta, partnerDelta);
  const sharedScore = Math.max(0, Math.min(10, Math.round((generalCandidate.score + sharedDelta) * 10) / 10));

  return {
    start: generalCandidate.start,
    end: generalCandidate.end,
    generalCandidate,
    sharedScore,
    rating: rateEverydaySharedFit(sharedScore),
    userScore: userEval.score,
    partnerScore: partnerEval.score,
  };
}

/**
 * SHARED-scope everyday search. Requires a resolvable catalog activity (any
 * momentEligible activity -- not gated to Muhurtham eligibility) and a
 * partner's personal context. Unlike SHARED Muhurtham, an incomplete user or
 * partner profile is NOT an error here -- personal context is optional for
 * everyday activities (brief section 11: "Do not require birth data merely
 * to create an invitation"); a missing/incomplete context simply scores as
 * evaluatePersonalMuhurtaFit's own neutral default (65, see auraFitEngine.ts),
 * which is exactly how PERSONAL scope already treats a missing profile.
 */
export function findEverydaySharedTiming(request: EverydaySharedFitRequest): EverydaySharedFitOutcome {
  const activity = FULL_ACTIVITY_CATALOG.find((a) => a.id === request.activityId);
  if (!activity) return { status: 'UNSUPPORTED_ACTIVITY' };

  const generalContext: DailyAssistantContext = { ...request.context, personalContext: undefined };
  const pool = runTimingSearch({
    mode: 'FIND',
    activityId: request.activityId,
    durationMinutes: request.durationMinutes,
    dateRange: request.dateRange,
    horizon: request.horizon,
    customStartDate: request.customStartDate,
    customEndDate: request.customEndDate,
    timePreference: request.timePreference,
    limit: CANDIDATE_POOL_SIZE,
    context: generalContext,
  });

  const profile = profileFromActivity(activity);
  const limit = Math.max(1, request.limit ?? 3);

  const shared: EverydaySharedCandidate[] = pool.candidates.map((generalCandidate) =>
    evaluateEverydaySharedCandidate({
      profile,
      generalCandidate,
      durationMinutes: request.durationMinutes,
      context: request.context,
      partnerContext: request.partnerContext,
    })
  );

  const ranked = shared.sort((a, b) => b.sharedScore - a.sharedScore).slice(0, limit);
  return { status: 'OK', candidates: ranked };
}
