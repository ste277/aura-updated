import { findSharedMuhurthams, isSupportedMuhurthamActivity } from '../../../packages/recommendation/src/muhurthamFinder';
import { runTimingSearch } from '../../../packages/recommendation/src/timingSearch';
import { findEverydaySharedTiming } from '../../../packages/recommendation/src/everydayTimingFit';
import { getDatePartsInTimezone } from '../../../packages/panchang/src/localDate';
import type { AuraMoment, AuraMomentAlternativePreference } from './db';
import type { DailyAssistantContext } from '../../../packages/recommendation/src/dailyAssistant';
import type { PersonalMuhurtaContext } from '../../../packages/recommendation/src/auraFitEngine';

/**
 * Aura Moment Rescheduling -- turns a recipient's "Another time" preference
 * into a fresh, private search, run only when the OWNER explicitly asks for
 * it (never automatically on page open). This file owns the preference ->
 * date-range mapping and the original-candidate exclusion rule; all actual
 * scoring is reused from elsewhere -- no second Muhurta/Aura Fit/shared-fit
 * formula lives here.
 *
 * Everyday Moment Rescheduling V1: the single entry point
 * (findAuraMomentAlternatives) now routes by `auraMoment.source`:
 *
 *   MUHURTHAM -> findSharedMuhurthams() (unchanged, byte-for-byte -- see
 *                the MUHURTHAM branch below, which is the exact logic this
 *                file always had)
 *   PLAN      -> runTimingSearch() for GENERAL/PERSONAL scope, or
 *                findEverydaySharedTiming() for SHARED scope -- the same
 *                engines Plan's own "Find a Time" and "Who's this with?"
 *                flows already use, never Muhurtham Finder (which throws
 *                for a non-eligible activityId like Date Night).
 *
 * The UI/API only ever sees ONE contract: findAuraMomentAlternatives() ->
 * FindAuraMomentAlternativesOutcome, carrying the same
 * AuraMomentAlternativeCandidate[] DTO regardless of which strategy
 * produced it (brief section 3: "the UI/API should not need to understand
 * two completely different rescheduling products").
 *
 * Architecture: the public recipient only ever writes a closed-enum
 * preference to the AuraMoment row (see auraMomentRequest.ts's
 * isValidAlternativePreference + the response route). This file runs
 * entirely server-side, invoked only from the owner-authenticated
 * alternatives/suggest routes, which resolve the owner's and SavedPerson's
 * natal contexts fresh each time (never snapshotted).
 */

/** Suggested V1 bound, kept here as the one place that decides it -- a wide
 * enough window to usually find something without degrading into an
 * expensive unbounded search (Muhurtham Finder's own request-layer cap is
 * 180 days; this is deliberately far smaller, and identical for every
 * source/scope -- brief section 19: "this is coordination, not
 * exploration"). */
export const ALTERNATIVE_SEARCH_HORIZON_DAYS = 14;

/** Approximately 3 ("Keep it to approximately 3 candidates... do not dump
 * the full Finder UI"). Fetched with a small buffer (see
 * findAuraMomentAlternatives) so excluding the original candidate/date
 * never leaves fewer than this when alternatives genuinely exist. */
export const MAX_ALTERNATIVES = 3;

function addDaysToDateStr(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + days));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-${String(next.getUTCDate()).padStart(2, '0')}`;
}

export interface AlternativeDateRange {
  start: string;
  end: string;
  /** Set only for DIFFERENT_DAY -- the one preference that names an
   * exclusion explicitly rather than getting it for free from the range
   * itself. */
  excludeDate?: string;
}

/**
 * Deterministic preference -> date-range mapping, pure and exported for
 * direct unit testing. `todayLocalDate` is the floor: this never searches a
 * date that has already passed, regardless of how the preference math alone
 * would have shaped the range. Identical for every AuraMoment source --
 * "PLAN rescheduling must respect the exact same recipient preference"
 * semantics as MUHURTHAM.
 *
 *   EARLIER        -> [floor, originalDate - 1]
 *   LATER           -> [originalDate + 1, originalDate + HORIZON]
 *   DIFFERENT_DAY   -> [floor, originalDate + HORIZON], excluding originalDate
 *   NO_PREFERENCE   -> [floor, originalDate + HORIZON] (original CANDIDATE,
 *                       not date, is excluded separately)
 *
 * EARLIER's range collapses to a single day (today) rather than becoming
 * invalid when the original moment is already very close (e.g. tomorrow) --
 * see the `end < floor` clamp below. If it's still empty after that (the
 * original moment is today or earlier), the caller gets a start > end range
 * and returns zero candidates rather than erroring (findAuraMomentAlternatives
 * checks this explicitly).
 */
export function computeAlternativeDateRange(
  originalLocalDate: string,
  preference: AuraMomentAlternativePreference,
  todayLocalDate: string
): AlternativeDateRange {
  // "YYYY-MM-DD" strings compare lexicographically == chronologically, so
  // plain string comparison is enough for the floor/clamp logic throughout.
  const horizonStart = addDaysToDateStr(originalLocalDate, -ALTERNATIVE_SEARCH_HORIZON_DAYS);
  const floor = todayLocalDate > horizonStart ? todayLocalDate : horizonStart;
  const horizonEnd = addDaysToDateStr(originalLocalDate, ALTERNATIVE_SEARCH_HORIZON_DAYS);

  if (preference === 'EARLIER') {
    const rawEnd = addDaysToDateStr(originalLocalDate, -1);
    return { start: floor, end: rawEnd < floor ? floor : rawEnd };
  }
  if (preference === 'LATER') {
    const rawStart = addDaysToDateStr(originalLocalDate, 1);
    return { start: rawStart < floor ? floor : rawStart, end: horizonEnd };
  }
  if (preference === 'DIFFERENT_DAY') {
    return { start: floor, end: horizonEnd, excludeDate: originalLocalDate };
  }
  return { start: floor, end: horizonEnd };
}

export interface AuraMomentAlternativeCandidate {
  date: string;
  startAt: string;
  endAt: string;
  ratingLabel: string;
}

export type FindAuraMomentAlternativesOutcome =
  | { status: 'OK'; candidates: AuraMomentAlternativeCandidate[] }
  | { status: 'NOT_APPLICABLE' }
  | { status: 'USER_PROFILE_INCOMPLETE' }
  | { status: 'SAVED_PERSON_PROFILE_INCOMPLETE' };

/** Shared exclusion/rank/cap/DTO-shaping pass, used by every strategy below
 * (MUHURTHAM's own inline equivalent is left untouched to preserve that
 * path byte-for-byte -- this is only used by the three new PLAN
 * strategies). Excludes the original candidate's exact start instant
 * (brief section 9), excludes the DIFFERENT_DAY preference's own date,
 * ranks by score descending, and caps to MAX_ALTERNATIVES. */
function finalizeAlternatives<T>(
  items: T[],
  getStartIso: (item: T) => string,
  getEndIso: (item: T) => string,
  getScore: (item: T) => number,
  getRatingLabel: (item: T) => string,
  timezone: string,
  originalStartIso: string,
  excludeDate: string | undefined
): AuraMomentAlternativeCandidate[] {
  return items
    .filter((item) => getStartIso(item) !== originalStartIso)
    .filter((item) => {
      if (!excludeDate) return true;
      return getDatePartsInTimezone(timezone, new Date(getStartIso(item))).dateStr !== excludeDate;
    })
    .sort((a, b) => getScore(b) - getScore(a))
    .slice(0, MAX_ALTERNATIVES)
    .map((item) => ({
      date: getDatePartsInTimezone(timezone, new Date(getStartIso(item))).dateStr,
      startAt: getStartIso(item),
      endAt: getEndIso(item),
      ratingLabel: getRatingLabel(item),
    }));
}

/**
 * The one entry point this feature needs, for every AuraMoment source and
 * scope. Routes internally by `auraMoment.source` (and, for PLAN, by
 * `auraMoment.scope`) -- the caller never needs to know which underlying
 * engine actually ran.
 */
export function findAuraMomentAlternatives(params: {
  auraMoment: AuraMoment;
  ownerContext: DailyAssistantContext;
  /** Optional: absent for GENERAL/PERSONAL scope, and for PLAN+SHARED an
   * incomplete/missing context degrades gracefully rather than erroring
   * (see the PLAN+SHARED branch below) -- only the MUHURTHAM branch ever
   * hard-requires this. */
  savedPersonContext?: PersonalMuhurtaContext;
}): FindAuraMomentAlternativesOutcome {
  const { auraMoment, ownerContext, savedPersonContext } = params;

  if (auraMoment.responseState !== 'ANOTHER_TIME' || !auraMoment.responsePreference) return { status: 'NOT_APPLICABLE' };

  const originalLocalDate = getDatePartsInTimezone(auraMoment.timezone, auraMoment.startAt).dateStr;
  const todayLocalDate = getDatePartsInTimezone(auraMoment.timezone, new Date()).dateStr;
  const range = computeAlternativeDateRange(originalLocalDate, auraMoment.responsePreference, todayLocalDate);
  const originalStartIso = auraMoment.startAt.toISOString();
  const durationMinutes = Math.round((auraMoment.endAt.getTime() - auraMoment.startAt.getTime()) / 60_000);

  // ============================================================
  // MUHURTHAM -- the exact logic this file always had, untouched.
  // ============================================================
  if (auraMoment.source === 'MUHURTHAM') {
    // SHARED is the primary use case for V1; GENERAL/PERSONAL rescheduling
    // is explicitly out of scope for Muhurtham moments, not forced in.
    if (auraMoment.scope !== 'SHARED' || !auraMoment.savedPersonId) return { status: 'NOT_APPLICABLE' };
    // findSharedMuhurthams() throws for any activityId outside
    // SUPPORTED_MUHURTHAM_ACTIVITY_IDS -- defensive, since every MUHURTHAM
    // moment's activityId was already Muhurtham-eligible at creation time.
    if (!isSupportedMuhurthamActivity(auraMoment.activityId)) return { status: 'NOT_APPLICABLE' };
    if (range.start > range.end) return { status: 'OK', candidates: [] };

    if (!ownerContext.personalContext) return { status: 'USER_PROFILE_INCOMPLETE' };
    if (!savedPersonContext) return { status: 'SAVED_PERSON_PROFILE_INCOMPLETE' };

    const outcome = findSharedMuhurthams({
      activityId: auraMoment.activityId,
      dateRange: { start: range.start, end: range.end },
      durationMinutes,
      // A small buffer over MAX_ALTERNATIVES so the exclusion pass below
      // still has enough left to fill the display list when possible.
      limit: MAX_ALTERNATIVES + 5,
      context: ownerContext,
      partner: { savedPersonId: auraMoment.savedPersonId, name: auraMoment.sharedPersonDisplayName ?? '', context: savedPersonContext },
    });

    if (outcome.status === 'USER_PROFILE_INCOMPLETE') return { status: 'USER_PROFILE_INCOMPLETE' };
    if (outcome.status === 'SAVED_PERSON_PROFILE_INCOMPLETE') return { status: 'SAVED_PERSON_PROFILE_INCOMPLETE' };

    const candidates = outcome.dates
      .filter((d) => (range.excludeDate ? d.date !== range.excludeDate : true))
      .filter((d) => d.bestWindow.start !== originalStartIso)
      .sort((a, b) => b.sharedScore - a.sharedScore)
      .slice(0, MAX_ALTERNATIVES)
      .map((d) => ({ date: d.date, startAt: d.bestWindow.start, endAt: d.bestWindow.end, ratingLabel: d.rating }));

    return { status: 'OK', candidates };
  }

  // ============================================================
  // PLAN -- everyday activities. Never routes through Muhurtham Finder.
  // Every scope degrades gracefully on missing profile data rather than
  // erroring (brief section 11: "Do not require birth data merely to
  // create an invitation" applies here just as it does to creation).
  // ============================================================
  if (range.start > range.end) return { status: 'OK', candidates: [] };

  if (auraMoment.scope === 'SHARED') {
    if (!auraMoment.savedPersonId) return { status: 'NOT_APPLICABLE' };
    const outcome = findEverydaySharedTiming({
      activityId: auraMoment.activityId,
      durationMinutes,
      dateRange: { start: range.start, end: range.end },
      limit: MAX_ALTERNATIVES + 5,
      context: ownerContext,
      partnerContext: savedPersonContext ?? {},
    });
    if (outcome.status === 'UNSUPPORTED_ACTIVITY') return { status: 'NOT_APPLICABLE' };
    const candidates = finalizeAlternatives(
      outcome.candidates,
      (c) => c.start,
      (c) => c.end,
      (c) => c.sharedScore,
      (c) => c.rating,
      auraMoment.timezone,
      originalStartIso,
      range.excludeDate
    );
    return { status: 'OK', candidates };
  }

  // GENERAL and PERSONAL both run the same Timing Search FIND Plan's own
  // "Find a Time" already uses -- PERSONAL keeps the owner's personalContext
  // (Timing Search always personalizes when profile data exists, exactly
  // like a fresh Plan search would), GENERAL strips it so a signed-in
  // owner's own profile never silently biases what counts as "generally
  // favorable" (the same separation SHARED/everyday-shared maintain).
  const searchContext: DailyAssistantContext = auraMoment.scope === 'GENERAL' ? { ...ownerContext, personalContext: undefined } : ownerContext;
  const pool = runTimingSearch({
    mode: 'FIND',
    activityId: auraMoment.activityId,
    durationMinutes,
    dateRange: { start: range.start, end: range.end },
    limit: MAX_ALTERNATIVES + 5,
    context: searchContext,
  });
  const candidates = finalizeAlternatives(
    pool.candidates,
    (c) => c.start,
    (c) => c.end,
    (c) => c.score,
    (c) => c.label,
    auraMoment.timezone,
    originalStartIso,
    range.excludeDate
  );
  return { status: 'OK', candidates };
}
