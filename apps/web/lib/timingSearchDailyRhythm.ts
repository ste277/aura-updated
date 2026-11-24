/**
 * Daily Rhythm V1 PR DR4-B -- Find a Time integration adapter.
 *
 * ARCHITECTURE (see this PR's own completion report for the full
 * inspection notes). Find a Time (apps/web/components/PlanWithAuraView.tsx)
 * and Plan My Day (apps/web/lib/dayConstructorOrchestrator.ts) are two
 * independent callers of the SAME shared engine, `runTimingSearch`
 * (packages/recommendation/src/timingSearch.ts) -- confirmed by the DR4
 * audit, not assumed. Day Constructor already wraps that engine with a
 * Daily Rhythm soft-preference layer (dailyRhythmScheduling.ts); Find a
 * Time never did, which is exactly the contradiction the DR4 audit
 * reproduced (Plan My Day preferring 6:14 AM for "Go for a run" while
 * Find a Time offered 3:33 PM, inside configured work hours, with no
 * explanation).
 *
 * REUSE, NOT DUPLICATION -- every one of dailyRhythmScheduling.ts's own
 * exported primitives (isDailyRhythmConfigured, isConfiguredWorkday,
 * classifyActivityForDailyRhythm, resolveWorkWindowInstants,
 * overlapsWorkWindow, DAILY_RHYTHM_EXPANDED_SEARCH_LIMIT) is reused
 * VERBATIM here, completely unmodified except for exporting
 * overlapsWorkWindow (it was private; the formula itself is untouched).
 * Nothing in dailyRhythmScheduling.ts changed its own existing behavior
 * for Day Constructor's two call sites.
 *
 * THE ONE REAL ADAPTER NEEDED -- dailyRhythmScheduling.ts's own
 * `applyDailyRhythmPreference`/`explainDailyRhythmPlacement`/
 * `resolveDailyRhythmSearchLimit` all take a SINGLE `DailyRhythmFilterContext.
 * targetDate`, because Day Constructor only ever plans ONE civil day at a
 * time. Find a Time's FIND mode can search a multi-day range (a week, a
 * custom range, "this weekend") -- a single global date would be WRONG
 * for candidates on different days (a Tuesday candidate and a Saturday
 * candidate need their OWN workday-ness and OWN work-window instants,
 * not one shared date's). So this file does NOT reuse those three
 * higher-level functions directly; instead it recomposes the lower-level,
 * genuinely date-INDEPENDENT primitives (isConfiguredWorkday,
 * classifyActivityForDailyRhythm, resolveWorkWindowInstants,
 * overlapsWorkWindow all already accept an explicit date/take no date at
 * all) PER CANDIDATE, deriving each candidate's own civil date from its
 * own `start` instant via timezone.ts's existing getDatePartsInTimezone
 * (the same "derive the civil day from an instant in the user's own
 * timezone" primitive the rest of this codebase already uses for exactly
 * this reason -- see that function's own doc comment).
 *
 * DELIBERATE SIMPLIFICATION (documented per this ticket's own "document
 * tradeoffs" instruction) -- resolveFindATimeSearchLimit's widening
 * decision does NOT check day-by-day workday-ness the way Day
 * Constructor's resolveDailyRhythmSearchLimit does (it only checks
 * "configured AND the activity is PERSONAL"). For a single-day search
 * (the overwhelming majority in practice -- Find a Time's own UI defaults
 * to "Today") this is exactly equivalent to Day Constructor's own check.
 * For a genuine multi-day search, this can occasionally widen the search
 * even when every day in range turns out to be a non-workday -- that
 * costs a slightly larger (still bounded at
 * DAILY_RHYTHM_EXPANDED_SEARCH_LIMIT, never unbounded) diversification
 * pass for nothing, but produces ZERO behavior difference, because
 * applyDailyRhythmToFindCandidates's own per-candidate check will
 * correctly find no applicable candidate and pass the original ranked
 * set through completely unfiltered. Computing exact per-day-offset
 * workday-ness up front would require re-deriving runFind's own day-
 * offset resolution (resolveSearchDayOffsets, private to timingSearch.ts)
 * for a marginal efficiency gain in an already-bounded, already-rare
 * case -- not worth the added surface for this PR.
 *
 * EXPLANATION WORDING -- deliberately its OWN small text table, not a
 * reuse of dayPlanPreviewPresentation.ts's DR4-A wording. The ticket's own
 * section 5 specifies different copy for Find a Time's fallback case
 * ("No preferred outside-work option was found in the available
 * results.", explicitly scoped to "the available results" -- Find a
 * Time's own bounded result panel) and adds a THIRD case Plan My Day
 * never needed ("This time overlaps your usual working hours." for an
 * explicitly CHECKed/COMPAREd time, which is never "found" or "fell back
 * to" anything -- the user picked it themselves). The underlying
 * CLASSIFICATION (is this candidate preferred/inside-work-fallback/a
 * flexible break inside work) is the same three-way split
 * explainDailyRhythmPlacement already established; only the final prose
 * differs per presentation surface, matching this codebase's own existing
 * separation between classification (dailyRhythmScheduling.ts) and
 * wording (dayPlanPreviewPresentation.ts for Plan My Day, this file for
 * Find a Time).
 */
import { runTimingSearch, DEFAULT_FIND_LIMIT, type TimingCandidate, type TimingSearchMode, type TimingSearchRequest, type TimingSearchResponse } from '../../../packages/recommendation/src/timingSearch';
import {
  isDailyRhythmConfigured,
  isConfiguredWorkday,
  classifyActivityForDailyRhythm,
  resolveWorkWindowInstants,
  overlapsWorkWindow,
  DAILY_RHYTHM_EXPANDED_SEARCH_LIMIT,
  type DailyRhythmPreferencesInput,
} from './dailyRhythmScheduling';
import { getDatePartsInTimezone, localDateTimeToUTC } from './timezone';

/** The one new type the client needs: the real `TimingSearchResponse` the
 * engine returns, plus an OPTIONAL sibling map (never a change to the
 * engine's own response shape) -- `{candidate.start ISO -> note text}`.
 * Keyed by `start` (not `findCandidateKey`'s own `activityType-start-end`
 * composite) because `start` alone is already guaranteed unique within
 * one response (runFind's own per-minute generation, runCompare's own
 * distinct candidateStarts) and is the one field identical byte-for-byte
 * between this server response and the client's own `TimingCandidate`,
 * with no risk of a client-side formatting mismatch. Absent entirely
 * (never an empty object) whenever Daily Rhythm produced nothing to say
 * -- an unconfigured user's response is byte-identical to before this PR. */
export type TimingSearchResponseWithDailyRhythm = TimingSearchResponse & { dailyRhythmNotes?: Record<string, string> };

type FindATimeDailyRhythmFit =
  | 'PREFERRED_OUTSIDE_WORK'
  | 'FALLBACK_INSIDE_WORK'
  | 'FLEXIBLE_BREAK_INSIDE_WORK'
  // AURA-PREF-01: work activities now prefer the user's own working hours
  // on configured workdays (the mirror image of the personal rule).
  | 'WORK_INSIDE_WORK'
  | 'WORK_FALLBACK_OUTSIDE_WORK';

/** Per-candidate classification -- the one place this file touches
 * dailyRhythmScheduling.ts's lower-level primitives, each already
 * date-independent or explicitly date-parameterized. `null` means "Daily
 * Rhythm has nothing to say about this specific candidate" (unconfigured,
 * this candidate's own day isn't a configured workday, the activity is
 * WORK, or it's unresolvable) -- the exact same gate order
 * isDailyRhythmApplicable (dailyRhythmScheduling.ts) already established
 * for Day Constructor, just evaluated per-candidate instead of once. */
function classifyCandidate(candidate: Pick<TimingCandidate, 'start' | 'end'>, activityId: string | undefined, timezone: string, prefs: DailyRhythmPreferencesInput): FindATimeDailyRhythmFit | null {
  if (!isDailyRhythmConfigured(prefs)) return null;
  const start = new Date(candidate.start);
  const end = new Date(candidate.end);
  const dateStr = getDatePartsInTimezone(timezone, start).dateStr;
  if (!isConfiguredWorkday(dateStr, prefs.workDays)) return null;
  const behavior = classifyActivityForDailyRhythm(activityId);
  if (behavior === null) return null;

  const workWindow = resolveWorkWindowInstants(dateStr, timezone, prefs.workStart, prefs.workEnd);
  const overlaps = overlapsWorkWindow(start, end, workWindow);
  if (behavior === 'WORK') {
    const inside = start.getTime() >= workWindow.start.getTime() && end.getTime() <= workWindow.end.getTime();
    return inside ? 'WORK_INSIDE_WORK' : 'WORK_FALLBACK_OUTSIDE_WORK';
  }
  if (behavior === 'PERSONAL') return overlaps ? 'FALLBACK_INSIDE_WORK' : 'PREFERRED_OUTSIDE_WORK';
  // FLEXIBLE_BREAK
  return overlaps ? 'FLEXIBLE_BREAK_INSIDE_WORK' : null;
}

/**
 * FIND only (section 1/3's "inspect candidate limits and diversification
 * before filtering... avoid introducing a new top-three blind spot").
 * `undefined` means "do not override the request's own limit at all" --
 * the exact same contract resolveDailyRhythmSearchLimit (Day Constructor)
 * already established, reused here only as a VALUE-LEVEL constant
 * (DAILY_RHYTHM_EXPANDED_SEARCH_LIMIT), never a second definition of "how
 * much wider." See this file's own module doc comment for why this gate
 * is deliberately NOT day-offset-aware.
 */
/** Behaviours that get a work-hours preference in Find a Time (AURA-PREF-01:
 * PERSONAL avoids working hours, WORK prefers them). FLEXIBLE_BREAK and
 * unknown activities are unaffected. */
function preferenceBehavior(activityId: string | undefined, prefs: DailyRhythmPreferencesInput): 'PERSONAL' | 'WORK' | null {
  if (!isDailyRhythmConfigured(prefs)) return null;
  const behavior = classifyActivityForDailyRhythm(activityId);
  return behavior === 'PERSONAL' || behavior === 'WORK' ? behavior : null;
}

export function resolveFindATimeSearchLimit(mode: TimingSearchMode, activityId: string | undefined, prefs: DailyRhythmPreferencesInput): number | undefined {
  if (mode !== 'FIND') return undefined;
  if (preferenceBehavior(activityId, prefs) === null) return undefined;
  return DAILY_RHYTHM_EXPANDED_SEARCH_LIMIT;
}

/** How many local days ahead the preference intervals cover when the
 * request doesn't say (comfortably beyond every planning horizon). */
const PREFERENCE_SPAN_DAYS = 62;

function addDaysToDateStr(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/**
 * AURA-PREF-01 -- the time a work-hours preference steers AWAY from, as
 * `excludedIntervals` for one extra engine pass. On each configured workday:
 * PERSONAL -> that day's working hours; WORK -> the rest of that day.
 * Non-workdays contribute nothing (any time is fine there). Pure; no clock.
 */
export function buildWorkHoursPreferenceExclusions(
  behavior: 'PERSONAL' | 'WORK',
  prefs: DailyRhythmPreferencesInput,
  timezone: string,
  fromDateStr: string,
  toDateStr: string
): { start: Date; end: Date }[] {
  if (!isDailyRhythmConfigured(prefs)) return [];
  const intervals: { start: Date; end: Date }[] = [];
  for (let date = fromDateStr; date <= toDateStr; date = addDaysToDateStr(date, 1)) {
    if (!isConfiguredWorkday(date, prefs.workDays)) continue;
    const work = resolveWorkWindowInstants(date, timezone, prefs.workStart, prefs.workEnd);
    if (behavior === 'PERSONAL') {
      intervals.push(work);
    } else {
      intervals.push({ start: localDateTimeToUTC(date, '00:00', timezone), end: work.start });
      intervals.push({ start: work.end, end: localDateTimeToUTC(addDaysToDateStr(date, 1), '00:00', timezone) });
    }
  }
  return intervals;
}

function preferenceSpan(request: TimingSearchRequest, timezone: string): { from: string; to: string } {
  const today = getDatePartsInTimezone(timezone, request.context.now).dateStr;
  const requestedEnd = request.dateRange?.end ?? request.customEndDate;
  const defaultEnd = addDaysToDateStr(today, PREFERENCE_SPAN_DAYS);
  return { from: addDaysToDateStr(today, -1), to: requestedEnd && requestedEnd > defaultEnd ? requestedEnd : defaultEnd };
}

function engineRankKey(candidate: TimingCandidate): number {
  // The engine's own ranking key (timingSearch.ts toRanked) -- used only to
  // interleave the two passes back into the engine's order, never to re-score.
  return candidate.auraFitScore ?? candidate.muhurtaScore * 5 + 55;
}

/**
 * AURA-PREF-01 -- soft work-hours preference for FIND, applied BEFORE the
 * engine's own per-day selection (the previous post-filter only ever saw each
 * day's single best slot in a multi-day search, so a configured work day
 * almost never moved a personal activity out of working hours).
 *
 * 1. Preferred pass: the same request with the steered-away time added to
 *    `excludedIntervals`. Panchang still ranks everything that remains.
 * 2. Full pass: the unchanged request.
 * 3. Per local day: keep the preferred candidates; a day with NO preferred
 *    candidate keeps its full-pass candidates instead (soft, never a hard
 *    exclusion -- e.g. an explicit "afternoon" request on a workday, or a day
 *    whose only usable time is inside working hours).
 */
function runFindWithWorkHoursPreference(request: TimingSearchRequest, timezone: string, prefs: DailyRhythmPreferencesInput, behavior: 'PERSONAL' | 'WORK'): TimingSearchResponse {
  const span = preferenceSpan(request, timezone);
  const exclusions = buildWorkHoursPreferenceExclusions(behavior, prefs, timezone, span.from, span.to);
  const preferred = runTimingSearch({ ...request, excludedIntervals: [...(request.excludedIntervals ?? []), ...exclusions] });
  const full = runTimingSearch(request);
  const dayOf = (c: TimingCandidate) => getDatePartsInTimezone(timezone, new Date(c.start)).dateStr;
  const preferredDays = new Set(preferred.candidates.map(dayOf));
  const fallback = full.candidates.filter((c) => !preferredDays.has(dayOf(c)));
  const merged = [...preferred.candidates, ...fallback].sort((a, b) => engineRankKey(b) - engineRankKey(a));
  return { ...full, candidates: merged };
}

/** Kept for callers/tests that post-filter an existing candidate list. */
export function applyDailyRhythmToFindCandidates(candidates: readonly TimingCandidate[], activityId: string | undefined, timezone: string, prefs: DailyRhythmPreferencesInput): TimingCandidate[] {
  const behavior = preferenceBehavior(activityId, prefs);
  if (behavior === null) return [...candidates];
  const preferredFit = behavior === 'PERSONAL' ? 'PREFERRED_OUTSIDE_WORK' : 'WORK_INSIDE_WORK';
  const notSteered = (candidate: TimingCandidate) => {
    const fit = classifyCandidate(candidate, activityId, timezone, prefs);
    return fit === null || fit === preferredFit; // non-workday candidates count as preferred
  };
  const preferred = candidates.filter(notSteered);
  return preferred.length > 0 ? preferred : [...candidates];
}

const FIND_TEXT = {
  preferred: 'Fits your preferred personal time.',
  fallback: 'No preferred outside-work option was found in the available results.',
  explicitOverlap: 'This time overlaps your usual working hours.',
  flexibleBreak: 'Short break that fits into your workday',
  workInside: 'Fits your working hours.',
  workFallback: 'Outside your usual working hours.',
} as const;

/**
 * Builds the `{candidate.start -> note text}` map returned alongside the
 * response. `isExplicitSelection` is true for CHECK/COMPARE (the user, or
 * a caller acting on the user's behalf, picked these exact instants) and
 * false for FIND (these were searched/ranked by the engine): the
 * classification is identical either way, only the INSIDE-WORK-HOURS
 * copy differs (a bounded-search "fallback" framing for FIND vs. a plain
 * "this overlaps your hours" statement for an explicit pick, since
 * nothing was ever "searched" for an explicit CHECK/COMPARE instant).
 * `null` classifications (unconfigured, non-workday for that candidate's
 * own date, WORK activity, non-overlapping flexible break, unresolvable
 * activity) contribute no entry at all -- "only display explanations
 * supported by actual candidate-selection evidence."
 */
export function buildDailyRhythmNotes(candidates: readonly TimingCandidate[], activityId: string | undefined, timezone: string, prefs: DailyRhythmPreferencesInput, isExplicitSelection: boolean): Record<string, string> {
  const notes: Record<string, string> = {};
  for (const candidate of candidates) {
    const fit = classifyCandidate(candidate, activityId, timezone, prefs);
    if (fit === 'PREFERRED_OUTSIDE_WORK') notes[candidate.start] = FIND_TEXT.preferred;
    else if (fit === 'FALLBACK_INSIDE_WORK') notes[candidate.start] = isExplicitSelection ? FIND_TEXT.explicitOverlap : FIND_TEXT.fallback;
    else if (fit === 'FLEXIBLE_BREAK_INSIDE_WORK') notes[candidate.start] = FIND_TEXT.flexibleBreak;
    else if (fit === 'WORK_INSIDE_WORK') notes[candidate.start] = FIND_TEXT.workInside;
    else if (fit === 'WORK_FALLBACK_OUTSIDE_WORK') notes[candidate.start] = FIND_TEXT.workFallback;
  }
  return notes;
}

/**
 * THE single orchestration entry point -- everything apps/web/app/api/
 * timing-search/route.ts needs, as one pure, I/O-free, directly-testable
 * function (same "pure logic lives in lib/, the route is a thin HTTP
 * wrapper" convention apps/web/lib/timingSearchRequest.ts's own module
 * doc comment already establishes for this exact route). Takes the
 * already-validated `TimingSearchRequest` (buildTimingSearchRequest) and
 * the caller's already-resolved timezone/prefs -- no DB access, no
 * session, nothing to mock to test it.
 *
 * Composes the three functions above in the only order that satisfies
 * section 3's "inspect candidate limits and diversification before
 * filtering": widen BEFORE runTimingSearch (so diversification happens
 * across the wider pool), filter/fallback AFTER (on that wider pool),
 * THEN re-slice down to the real client-requested count (never more than
 * what was actually asked for), THEN annotate exactly the final
 * candidates that will actually be returned (never a candidate that was
 * searched but not shown).
 */
export function runTimingSearchWithDailyRhythm(request: TimingSearchRequest, timezone: string, prefs: DailyRhythmPreferencesInput): TimingSearchResponseWithDailyRhythm {
  const requestedLimit = request.limit;
  const widenedLimit = resolveFindATimeSearchLimit(request.mode, request.activityId, prefs);
  const searchRequest = widenedLimit !== undefined ? { ...request, limit: widenedLimit } : request;

  let result: TimingSearchResponse;
  let dailyRhythmNotes: Record<string, string>;

  if (searchRequest.mode === 'FIND') {
    const behavior = preferenceBehavior(searchRequest.activityId, prefs);
    result = behavior === null ? runTimingSearch(searchRequest) : runFindWithWorkHoursPreference(searchRequest, timezone, prefs, behavior);
    const finalCandidates = result.candidates.slice(0, requestedLimit ?? DEFAULT_FIND_LIMIT);
    result = { ...result, candidates: finalCandidates };
    dailyRhythmNotes = buildDailyRhythmNotes(finalCandidates, searchRequest.activityId, timezone, prefs, false);
  } else {
    result = runTimingSearch(searchRequest);
    dailyRhythmNotes = buildDailyRhythmNotes(result.candidates, searchRequest.activityId, timezone, prefs, true);
  }

  return Object.keys(dailyRhythmNotes).length > 0 ? { ...result, dailyRhythmNotes } : result;
}
