import { findSharedMuhurthams } from '../../../packages/recommendation/src/muhurthamFinder';
import { getDatePartsInTimezone } from '../../../packages/panchang/src/localDate';
import type { AuraMoment, AuraMomentAlternativePreference } from './db';
import type { DailyAssistantContext } from '../../../packages/recommendation/src/dailyAssistant';
import type { PersonalMuhurtaContext } from '../../../packages/recommendation/src/auraFitEngine';

/**
 * Aura Moment Rescheduling V1 -- turns a recipient's "Another time"
 * preference into a fresh, private Shared Muhurtham search, run only when
 * the OWNER explicitly asks for it (never automatically on page open, brief
 * section 5). This file owns the preference -> date-range mapping and the
 * original-candidate exclusion rule; it reuses findSharedMuhurthams() for
 * every bit of actual scoring -- no second Muhurta/Aura Fit formula.
 *
 * Architecture (brief section 1): the public recipient only ever writes a
 * closed-enum preference to the AuraMoment row (see auraMomentRequest.ts's
 * isValidAlternativePreference + the response route). This file runs
 * entirely server-side, invoked only from the owner-authenticated
 * alternatives/suggest routes, which resolve the owner's and SavedPerson's
 * natal contexts fresh each time (never snapshotted -- brief section 11).
 */

/** Suggested V1 bound from the brief, kept here as the one place that
 * decides it -- a wide enough window to usually find something without
 * degrading into an expensive unbounded search (Muhurtham Finder's own
 * request-layer cap is 180 days; this is deliberately far smaller). */
export const ALTERNATIVE_SEARCH_HORIZON_DAYS = 14;

/** Approximately 3 per brief section 12 ("Keep it to approximately 3
 * candidates... do not dump the full Finder UI"). Fetched with a small
 * buffer (see findAuraMomentAlternatives) so excluding the original
 * candidate/date never leaves fewer than this when alternatives genuinely
 * exist. */
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
   * itself (brief section 8). */
  excludeDate?: string;
}

/**
 * Brief section 8's deterministic preference -> date-range mapping, pure
 * and exported for direct unit testing. `todayLocalDate` is the floor: this
 * never searches a date that has already passed, regardless of how the
 * preference math alone would have shaped the range.
 *
 *   EARLIER        -> [floor, originalDate - 1]
 *   LATER           -> [originalDate + 1, originalDate + HORIZON]
 *   DIFFERENT_DAY   -> [floor, originalDate + HORIZON], excluding originalDate
 *   NO_PREFERENCE   -> [floor, originalDate + HORIZON] (original CANDIDATE,
 *                       not date, is excluded separately -- section 9)
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

/**
 * The one entry point this feature needs. Reuses findSharedMuhurthams()
 * exactly -- same candidate generation, same balance-weighted shared
 * ranking, same hard-block/friction rules; this function adds nothing to
 * scoring, only a date-range restriction (from the stored preference) and a
 * final exclusion pass so the original moment's own instant can never
 * reappear as an "alternative" (brief section 9).
 */
export function findAuraMomentAlternatives(params: {
  auraMoment: AuraMoment;
  ownerContext: DailyAssistantContext;
  savedPersonContext: PersonalMuhurtaContext;
}): FindAuraMomentAlternativesOutcome {
  const { auraMoment, ownerContext, savedPersonContext } = params;

  // Brief section 17: SHARED is the primary use case for V1; GENERAL/
  // PERSONAL rescheduling is explicitly out of scope, not forced in.
  if (auraMoment.scope !== 'SHARED' || !auraMoment.savedPersonId) return { status: 'NOT_APPLICABLE' };
  if (auraMoment.responseState !== 'ANOTHER_TIME' || !auraMoment.responsePreference) return { status: 'NOT_APPLICABLE' };

  const originalLocalDate = getDatePartsInTimezone(auraMoment.timezone, auraMoment.startAt).dateStr;
  const todayLocalDate = getDatePartsInTimezone(auraMoment.timezone, new Date()).dateStr;
  const range = computeAlternativeDateRange(originalLocalDate, auraMoment.responsePreference, todayLocalDate);
  if (range.start > range.end) return { status: 'OK', candidates: [] };

  const durationMinutes = Math.round((auraMoment.endAt.getTime() - auraMoment.startAt.getTime()) / 60_000);

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

  const originalStartIso = auraMoment.startAt.toISOString();
  const candidates = outcome.dates
    .filter((d) => (range.excludeDate ? d.date !== range.excludeDate : true))
    .filter((d) => d.bestWindow.start !== originalStartIso)
    .sort((a, b) => b.sharedScore - a.sharedScore)
    .slice(0, MAX_ALTERNATIVES)
    .map((d) => ({ date: d.date, startAt: d.bestWindow.start, endAt: d.bestWindow.end, ratingLabel: d.rating }));

  return { status: 'OK', candidates };
}
