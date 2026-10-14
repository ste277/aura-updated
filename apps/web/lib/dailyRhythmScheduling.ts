/**
 * Daily Rhythm V1 PR DR2 -- Work-Aware Scheduling: pure domain logic,
 * reused by both the primary and replenishment timing-search call sites
 * in dayConstructorOrchestrator.ts (see AURA_DAILY_RHYTHM_V1_ARCHITECTURE_
 * AUDIT.md section 1.5 for the identified insertion point). No DB import,
 * no fetch, no clock read of its own (every date/time is an explicit
 * input) -- same architectural boundary as availabilityContext.ts.
 *
 * SOFT PREFERENCE, NEVER A HARD RESTRICTION (DR2's own explicit
 * requirement): this module only ever FILTERS a `TimingCandidate[]`
 * that `runTimingSearch` already produced -- it never calls the search
 * engine itself, never invents a candidate, never changes a candidate's
 * own `timingFit`/`label`/score (those remain the Panchang/Muhurta
 * engine's own, untouched -- packages/astronomy, packages/panchang, and
 * packages/muhurta are never imported here). When filtering to the
 * preferred subset would leave ZERO candidates, the ORIGINAL, unfiltered
 * set is returned instead -- a personal activity during work hours is
 * deprioritized (tried last, across the filter-then-fallback behavior
 * below), never excluded outright.
 */

import type { ActivityCategory } from '../../../packages/recommendation/src/personalizedTasks';
import { getActivityProfileById } from '../../../packages/recommendation/src/personalizedTasks';
import type { TimingCandidate } from '../../../packages/recommendation/src/timingSearch';
import { getWeekdayForDateStr, type Weekday } from './availabilityContext';
import { localDateTimeToUTC } from './timezone';

// ============================================================
// Activity classification (DR2 section 2). Reuses the EXISTING
// ActivityProfile.category metadata -- no new database taxonomy, no new
// column, no change to the catalog itself. The mapping below was built
// by reading every one of the catalog's current entries (packages/
// recommendation/src/personalizedTasks.ts, ACTIVITY_CATALOG +
// EXTENDED_ACTIVITY_CATALOG), not inferred from category names alone --
// see the per-category rationale comments.
// ============================================================

export type DailyRhythmSchedulingBehavior = 'PERSONAL' | 'WORK' | 'FLEXIBLE_BREAK';

/**
 * Category -> behavior, audited against the real catalog content (not
 * just the category name) as of this PR:
 *
 *  - WORK, FOCUS: both existing entries in each (task-1/task-2 "High-
 *    Stakes Decision", "Sprint Backlog Execution"; task-4/deep-work
 *    "Deep Architecture & Writing", "Deep Work") are genuine professional
 *    work -- matches DR2's own "work meetings, professional focus
 *    sessions" example verbatim.
 *  - ROUTINE: its one current entry (task-5 "Process Optimization &
 *    Docs" -- "Organize documentation, clean up logs, structure routine
 *    workflows") is office/admin work, not a personal routine -- WORK.
 *  - WORKOUT: its one entry ("Workout" -- training/exercise/gym, aliases
 *    include "run"/"exercise"/"gym", which is how the Get-Fitter goal
 *    template's own "Go for a run"/"Strength training session"
 *    activities resolve) -- matches DR2's own "workout, running" example
 *    verbatim -- PERSONAL.
 *  - SPIRITUAL, TRAVEL, RELATIONSHIP, SOCIAL, FINANCE, NEW_BEGINNING,
 *    LEARNING, MEAL, HOME: every current entry in each is a personal-life
 *    activity (meditation, a trip, dating/marriage, a party or family
 *    outing, a financial decision, starting a new habit/business,
 *    studying, a family dinner) -- none is a workplace activity --
 *    PERSONAL. LEARNING matches DR2's own "personal learning" example
 *    verbatim; SOCIAL/RELATIONSHIP together cover "family activities."
 *  - MICRO_BREAK: its one entry ("Tea Break" -- "a short reset... no
 *    special auspicious start needed", 10 min) matches DR2's own "tea
 *    break" example verbatim -- FLEXIBLE_BREAK.
 *  - REST: its two ORIGINAL entries (task-6 "Active Rest & Hydration
 *    Check", task-7 "Light Stretch & Mobility", both short screen/work
 *    breaks) match DR2's own "brief rest" example -- FLEXIBLE_BREAK by
 *    default. But REST also contains 'quiet-time' ("Unstructured quiet
 *    time... downtime", 45 min) -- a genuinely different, longer,
 *    personal-leisure activity, not a quick break. Per DR2's own
 *    instruction ("do not infer that all activities within a broad
 *    category have identical scheduling needs"), this ONE entry is
 *    overridden below rather than forced into the category default.
 *
 * No standalone "short walk" catalog entry exists (only "walk-together",
 * a 45-minute two-person SOCIAL activity -- a different occasion from a
 * quick solo break, so it is correctly classified PERSONAL via SOCIAL,
 * not forced into FLEXIBLE_BREAK merely because its title contains
 * "walk"). A free-text "short walk" request that does not match any
 * catalog alias resolves to no activityId at all, which this module
 * correctly treats as UNKNOWN (see classifyActivityForDailyRhythm below)
 * -- DR2's own explicit "unknown activities retain previous scheduling
 * behavior" rule, not a bug.
 */
const CATEGORY_SCHEDULING_BEHAVIOR: Record<ActivityCategory, DailyRhythmSchedulingBehavior> = {
  WORK: 'WORK',
  FOCUS: 'WORK',
  ROUTINE: 'WORK',
  WORKOUT: 'PERSONAL',
  SPIRITUAL: 'PERSONAL',
  TRAVEL: 'PERSONAL',
  RELATIONSHIP: 'PERSONAL',
  SOCIAL: 'PERSONAL',
  FINANCE: 'PERSONAL',
  NEW_BEGINNING: 'PERSONAL',
  LEARNING: 'PERSONAL',
  MEAL: 'PERSONAL',
  HOME: 'PERSONAL',
  REST: 'FLEXIBLE_BREAK',
  MICRO_BREAK: 'FLEXIBLE_BREAK',
};

/** The one documented per-activity exception to the category default --
 * see CATEGORY_SCHEDULING_BEHAVIOR's own REST paragraph above. Kept as
 * its own small, explicit table (not a special case buried in a
 * function) so a future catalog change that needs another exception has
 * an obvious place to add one, and so this file's own structural tests
 * can assert its exact contents. */
const ACTIVITY_ID_OVERRIDES: Readonly<Record<string, DailyRhythmSchedulingBehavior>> = {
  'quiet-time': 'PERSONAL',
};

/**
 * Resolves an activityId (already resolved by dayConstructorOrchestrator.ts's
 * own `resolveActivity`, e.g. via `findActivityIntent`/a trusted caller-
 * supplied id) to its Daily Rhythm scheduling behavior. Returns `null` for
 * an unresolvable id or `undefined` (no catalog match, or a free-text
 * intent that never resolved to one) -- DR2's own explicit "unknown
 * activities should retain their previous scheduling behavior" rule.
 * `null` is a real, valid result, not an error.
 */
export function classifyActivityForDailyRhythm(activityId: string | undefined): DailyRhythmSchedulingBehavior | null {
  if (!activityId) return null;
  const override = ACTIVITY_ID_OVERRIDES[activityId];
  if (override) return override;
  const profile = getActivityProfileById(activityId);
  if (!profile) return null;
  return CATEGORY_SCHEDULING_BEHAVIOR[profile.category];
}

// ============================================================
// Workday + work-window resolution (DR2 section 3, steps 1-4). Mirrors
// availabilityContext.ts's own conventions exactly: `getWeekdayForDateStr`
// reused verbatim (same weekday arithmetic as UserAvailabilityPeriod),
// `localDateTimeToUTC` reused verbatim (same HH:mm-resolved-against-
// timezone convention as every other civil-time field in this codebase).
// ============================================================

export interface DailyRhythmPreferencesInput {
  workStart: string | null;
  workEnd: string | null;
  workDays: readonly number[];
}

/** `false` whenever Daily Rhythm is unconfigured (either time field null)
 * -- DR2's own "no work preferences -> unchanged behavior" rule. */
export function isDailyRhythmConfigured(prefs: DailyRhythmPreferencesInput): prefs is { workStart: string; workEnd: string; workDays: readonly number[] } {
  return prefs.workStart !== null && prefs.workEnd !== null;
}

/** DR2's own "non-workday -> unchanged behavior" rule. */
export function isConfiguredWorkday(targetDateStr: string, workDays: readonly number[]): boolean {
  const weekday: Weekday = getWeekdayForDateStr(targetDateStr);
  return workDays.includes(weekday);
}

/** The work window's absolute instants for one specific civil date, in
 * the user's own timezone -- the SAME resolution `availabilityContext.ts`'s
 * own `resolveAvailability` already performs for UserAvailabilityPeriod
 * rows, reused verbatim for Daily Rhythm's own, independent work-hours
 * fields. */
export function resolveWorkWindowInstants(targetDateStr: string, timezone: string, workStart: string, workEnd: string): { start: Date; end: Date } {
  return { start: localDateTimeToUTC(targetDateStr, workStart, timezone), end: localDateTimeToUTC(targetDateStr, workEnd, timezone) };
}

/** Half-open interval overlap -- the SAME formula dayCapacity.ts's own
 * `intervalsOverlap` already uses (`aStart < bEnd && bStart < aEnd`),
 * reused rather than reimplemented. Checked against the candidate's FULL
 * `[start, end)` span (DR2's own section 3 step 4: "calculate overlap
 * between the candidate's full duration and the working window"), never
 * just its start instant -- a candidate that only STARTS before work
 * hours but runs into them is still correctly treated as overlapping. */
function overlapsWorkWindow(candidateStart: Date, candidateEnd: Date, workWindow: { start: Date; end: Date }): boolean {
  return candidateStart.getTime() < workWindow.end.getTime() && workWindow.start.getTime() < candidateEnd.getTime();
}

// ============================================================
// Preference-aware ranking (DR2 section 3). The ONE function both
// dayConstructorOrchestrator.ts call sites (the primary per-intent loop
// and the replenishment loop) invoke -- never a second, duplicated
// implementation.
// ============================================================

export interface DailyRhythmFilterContext {
  targetDate: string;
  timezone: string;
  prefs: DailyRhythmPreferencesInput;
}

/**
 * Filters (never re-scores, never reorders by anything but presence/
 * absence) a `TimingCandidate[]` already ranked by the existing
 * Panchang/Muhurta-driven engine, applying the Daily Rhythm soft
 * preference:
 *
 *  - Unconfigured, or `activityId` doesn't resolve to a classification,
 *    or the target date isn't a configured workday, or the activity is
 *    WORK/FLEXIBLE_BREAK (both already "eligible during working hours"
 *    by definition, nothing to deprioritize away from) -> returns
 *    `candidates` completely unchanged, by reference-equal array
 *    identity where practical. This is the exact no-op DR2 requires for
 *    "no work preferences", "non-workday", "flexible break during
 *    work", and "work activity during work".
 *  - PERSONAL, on a configured workday, with Daily Rhythm configured:
 *    partitions `candidates` into those whose full `[start,end)` span
 *    does NOT overlap the resolved work window ("outside") vs. those
 *    that do ("inside"). If `outside` is non-empty, returns ONLY
 *    `outside` (in its original relative order, i.e. the existing
 *    engine's own ranking among just that subset) -- constructDay then
 *    ranks and places exclusively among preferred candidates. If
 *    `outside` is empty (no suitable outside-work candidate exists in
 *    THIS batch), returns the ORIGINAL, full, unfiltered `candidates` --
 *    the deprioritization naturally yields to the existing in-work
 *    option rather than deferring the intent outright. Because this
 *    function is called again, independently, on every replenishment
 *    round's own freshly-searched candidates (dayConstructorOrchestrator.ts's
 *    own Dynamic Candidate Replenishment V1 loop), a personal activity
 *    that loses its first-choice outside-work slot to a same-run
 *    sibling still gets a fresh outside-first attempt on the next round,
 *    falling back to in-work only once outside-work options are
 *    genuinely exhausted for that round -- never a silent, one-shot hard
 *    exclusion.
 */
export function applyDailyRhythmPreference(candidates: readonly TimingCandidate[], activityId: string | undefined, context: DailyRhythmFilterContext): TimingCandidate[] {
  if (!isDailyRhythmConfigured(context.prefs)) return [...candidates];
  if (!isConfiguredWorkday(context.targetDate, context.prefs.workDays)) return [...candidates];
  const behavior = classifyActivityForDailyRhythm(activityId);
  if (behavior !== 'PERSONAL') return [...candidates];

  const workWindow = resolveWorkWindowInstants(context.targetDate, context.timezone, context.prefs.workStart, context.prefs.workEnd);
  const outside = candidates.filter((candidate) => !overlapsWorkWindow(new Date(candidate.start), new Date(candidate.end), workWindow));
  return outside.length > 0 ? outside : [...candidates];
}

// ============================================================
// Recommendation explanations (DR2 section 4). Determines, for ONE
// already-PLACED item (after constructDay has run), whether a Daily
// Rhythm-specific explanation applies -- never generated speculatively
// for a candidate that wasn't actually chosen, and never for a FIXED
// placement (a user-selected time is never second-guessed with an
// unsolicited explanation of Aura's own, inapplicable preference logic).
// ============================================================

export type DailyRhythmPlacementExplanation = 'PERSONAL_OUTSIDE_WORK_HOURS' | 'PERSONAL_DURING_WORK_HOURS_FALLBACK' | 'FLEXIBLE_BREAK_DURING_WORK_HOURS';

/**
 * `null` whenever no Daily Rhythm explanation applies: unconfigured, a
 * non-workday, an unresolvable/WORK activity, or a FLEXIBLE_BREAK placed
 * outside work hours (nothing noteworthy to say -- the default-looking
 * placement needs no caveat).
 */
export function explainDailyRhythmPlacement(
  activityId: string | undefined,
  placedStart: Date,
  placedEnd: Date,
  context: DailyRhythmFilterContext
): DailyRhythmPlacementExplanation | null {
  if (!isDailyRhythmConfigured(context.prefs)) return null;
  if (!isConfiguredWorkday(context.targetDate, context.prefs.workDays)) return null;
  const behavior = classifyActivityForDailyRhythm(activityId);
  if (behavior === null || behavior === 'WORK') return null;

  const workWindow = resolveWorkWindowInstants(context.targetDate, context.timezone, context.prefs.workStart, context.prefs.workEnd);
  const overlapsWork = overlapsWorkWindow(placedStart, placedEnd, workWindow);

  if (behavior === 'PERSONAL') return overlapsWork ? 'PERSONAL_DURING_WORK_HOURS_FALLBACK' : 'PERSONAL_OUTSIDE_WORK_HOURS';
  // FLEXIBLE_BREAK
  return overlapsWork ? 'FLEXIBLE_BREAK_DURING_WORK_HOURS' : null;
}
