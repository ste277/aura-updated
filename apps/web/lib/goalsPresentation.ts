/**
 * Goals -> Planning Integration V1 PR B -- pure, DI-testable presentation
 * helpers for the Goals UI. Kept separate from any component, matching
 * this repository's own established convention (dayPlanAcceptancePresentation.ts,
 * dayPlanPreviewPresentation.ts) of keeping every mapping/decision a plain
 * function, never inlined ad hoc in JSX.
 *
 * The wire-shaped types below deliberately do NOT import from lib/db.ts
 * (a server-only module using `pg`) -- they describe the JSON shape the
 * existing PR A API routes actually return, safe to import from client
 * components. DerivedGoalActivityState/GoalStatus/GoalActivityStatus/
 * GoalTemplateCategory are reused directly from lib/goals.ts, which is
 * already a pure, DB-free domain module (confirmed by PR A's own wiring
 * test: "lib/goals.ts has exactly one import, from the activity catalog
 * only") -- safe to share between server and client code.
 */

import { isValidCivilDateString, type DerivedGoalActivityState, type GoalActivityStatus, type GoalStatus, type GoalTemplateCategory } from './goals';
import type { CompletionRequirement } from './goalCompletion';
import { formatGoalActivityCompletion } from './goalActivityExecution';

export interface GoalSummary {
  id: string;
  title: string;
  targetDate: string | null;
  status: GoalStatus;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}

// ============================================================
// Goals V2 Rhythm R4 -- the canonical, additive Rhythm presentation shape
// (this ticket's own section 5). A discriminated union, same convention as
// CompletionRequirement's own kind-tagged shape: NONE carries nothing
// (there is nothing to present), N_PER_WEEK carries exactly the facts
// Goal Detail needs to render frequency + this week's factual progress +
// whether another occurrence may be planned -- no occurrence/plannedActivity
// IDs, no execution IDs, no window internals, no DB status strings (this
// ticket's own section 5 exclusion list). Every number here comes from the
// SAME single computation (computeGoalActivityRhythmEligibility, called
// once server-side in app/api/goals/[goalId]/route.ts) -- this type carries
// that result's shape, it does not define a second one.
// ============================================================
export type GoalActivityRhythmView =
  | { kind: 'NONE' }
  | {
      kind: 'N_PER_WEEK';
      targetPerWeek: number;
      completedThisWeek: number;
      committedThisWeek: number;
      remainingThisWeek: number;
      eligibleForAnotherOccurrence: boolean;
    };

export interface GoalActivityView {
  id: string;
  goalId: string;
  title: string;
  activityId: string | null;
  status: GoalActivityStatus;
  plannedActivityId: string | null;
  derivedState: DerivedGoalActivityState;
  // Goals V2 G2.1 -- additive, not yet consumed by any UI (the G2.1 ticket's
  // own scope boundary: no progress bars, no numeric controls, no UI
  // redesign). Always the canonical, normalized shape -- see
  // normalizeGoalActivityCompletionRequirement in ./goalCompletion.
  completionRequirement: CompletionRequirement;
  // Goals V2 G3.1 -- the CURRENT execution's measured fact (resolved
  // server-side via this activity's own plannedActivityId linkage -- see
  // db.ts's listGoalActivitiesWithLinkedPlanStatus). NULL when no
  // execution exists yet for the current link. Additive, not yet consumed
  // by any UI. No execution id/source/snapshot internals -- a plain number
  // or null, same "meaning, not storage" contract as completionRequirement
  // above.
  currentValue: number | null;
  // Goals V2 Rhythm R4 -- supersedes R3's own interim `rhythmEligibleForAnotherOccurrence`
  // flag with the full canonical shape above (R3's flag had exactly one
  // production consumer, GoalDetailClient.tsx's own `isSelectable`, which
  // this ticket updates to read `rhythm.eligibleForAnotherOccurrence`
  // instead -- see that file's own updated doc comment). Still
  // presentation-only, still server-computed against "today" (see
  // app/api/goals/[goalId]/route.ts), still never authoritative for any
  // write. `{ kind: 'NONE' }` for every finite activity.
  rhythm: GoalActivityRhythmView;
  createdAt: string;
  updatedAt: string;
}

export interface GoalProgressView {
  total: number;
  completed: number;
  // Goals V2 Rhythm R4 -- this ticket's own section 17-19 audit: a Goal
  // containing ANY N_PER_WEEK activity cannot be honestly represented as
  // finite "N of M completed" (an ongoing activity can go from "completed"
  // back to "eligible again" next week, which finite N-of-M has no concept
  // of). Server-computed once, from the SAME `activities` list the API
  // response already carries -- never a second Goal-level Rhythm query.
  // See formatGoalProgressLabel below for the one place this flag is acted
  // on (both GoalDetailClient.tsx and GoalsListClient.tsx consume that
  // formatter, so suppression is automatically consistent on both surfaces
  // without either needing its own copy of this rule).
  hasOngoingRhythmActivity: boolean;
}

export interface GoalDetailView {
  goal: GoalSummary;
  activities: GoalActivityView[];
  progress: GoalProgressView;
}

// ============================================================
// Template category -> human label (this ticket's own section 11). Never
// exposes the raw enum. "Start from scratch" is not a GoalTemplateCategory
// value at all -- it means omitting templateCategory entirely (section 12).
// ============================================================

export const GOAL_TEMPLATE_LABELS: Record<GoalTemplateCategory, string> = {
  GET_FITTER: 'Get fitter',
  MEDITATE_REGULARLY: 'Meditate regularly',
  FINISH_PROJECT: 'Finish a project',
  STUDY_CONSISTENTLY: 'Study consistently',
};

export function presentGoalTemplateCategory(category: GoalTemplateCategory): string {
  return GOAL_TEMPLATE_LABELS[category];
}

/** Options for the create-Goal template picker, in a fixed, deliberate
 * order -- "Start from scratch" (value null, this ticket's own section 11)
 * listed LAST so it reads as "or, do it yourself" rather than the default
 * suggestion. */
export const GOAL_TEMPLATE_OPTIONS: ReadonlyArray<{ value: GoalTemplateCategory | null; label: string }> = [
  { value: 'GET_FITTER', label: GOAL_TEMPLATE_LABELS.GET_FITTER },
  { value: 'MEDITATE_REGULARLY', label: GOAL_TEMPLATE_LABELS.MEDITATE_REGULARLY },
  { value: 'FINISH_PROJECT', label: GOAL_TEMPLATE_LABELS.FINISH_PROJECT },
  { value: 'STUDY_CONSISTENTLY', label: GOAL_TEMPLATE_LABELS.STUDY_CONSISTENTLY },
  { value: null, label: 'Start from scratch' },
];

// ============================================================
// Derived-state -> human label (this ticket's own section 17). SUGGESTED
// returns null deliberately -- "normal actionable row", no badge at all,
// never the literal word "Suggested" cluttering every untouched activity.
// ============================================================

export function presentGoalActivityStateLabel(state: DerivedGoalActivityState): string | null {
  switch (state) {
    case 'SUGGESTED':
      return null;
    case 'PLANNED':
      return 'Planned';
    case 'COMPLETED':
      return 'Completed';
    case 'DISMISSED':
      return 'Dismissed';
  }
}

// ============================================================
// Goals V2 Rhythm R4 -- pure, testable predicate behind GoalProgressView's
// own hasOngoingRhythmActivity flag (this ticket's own section 17-19/38).
// Exported so it can be tested independently of the API route that calls
// it, same "pure reusable formatter, not embedded logic" discipline as
// every other helper in this file.
// ============================================================

export function goalHasOngoingRhythmActivity(activities: ReadonlyArray<{ rhythm: GoalActivityRhythmView }>): boolean {
  return activities.some((activity) => activity.rhythm.kind === 'N_PER_WEEK');
}

// ============================================================
// Progress copy (this ticket's own section 7). Deliberately distinct
// wording for the zero-activity case -- "0 of 0 completed" would read as
// broken, not empty.
//
// Goals V2 Rhythm R4 -- returns null whenever hasOngoingRhythmActivity is
// true (this ticket's own section 17-19: finite "N of M completed" cannot
// honestly describe a Goal containing an ongoing N_PER_WEEK activity).
// Both consumers (GoalDetailClient.tsx and GoalsListClient.tsx) already
// treat an absent/null label as "render nothing" -- see each file's own
// updated/existing null-check -- so this one change suppresses the
// misleading progress line/bar on BOTH surfaces consistently.
// ============================================================

export function formatGoalProgressLabel(progress: GoalProgressView): string | null {
  if (progress.hasOngoingRhythmActivity) return null;
  if (progress.total === 0) return 'No activities yet';
  return `${progress.completed} of ${progress.total} completed`;
}

// ============================================================
// Goals V2 Rhythm R4 -- frequency copy (this ticket's own section 9). Pure,
// exact-N formatter -- never "Daily" for 7/week (not semantically
// identical to "every day" under the current model), never "A few times a
// week" (the exact number is always known for a valid N_PER_WEEK policy).
// Singular wording is "Once a week" (this ticket's own section 9 example),
// chosen as the one consistent form this app uses (section 52).
// ============================================================

export function formatGoalActivityRhythmFrequencyLabel(targetPerWeek: number): string {
  if (targetPerWeek === 1) return 'Once a week';
  return `${targetPerWeek} times a week`;
}

// ============================================================
// Goals V2 Rhythm R4 -- weekly progress copy (this ticket's own section
// 10/11/22). Factual, low-pressure, never a ratio ("2 of 3"), never a
// judgment word (behind/on track/streak/score/etc, this ticket's own
// section 10 DO-NOT list). completedThisWeek and committedThisWeek are
// distinguished explicitly (never silently summed into one "progress"
// number) per this ticket's own section 11/22 -- an UPCOMING occurrence is
// never presented as completed. Returns null for NONE (nothing to say).
// ============================================================

export function formatGoalActivityRhythmWeeklyProgressLabel(rhythm: GoalActivityRhythmView): string | null {
  if (rhythm.kind !== 'N_PER_WEEK') return null;
  const { completedThisWeek, committedThisWeek } = rhythm;
  const sessionWord = (n: number) => (n === 1 ? 'session' : 'sessions');

  if (completedThisWeek === 0 && committedThisWeek === 0) return 'No sessions completed this week';
  if (committedThisWeek === 0) return `${completedThisWeek} ${sessionWord(completedThisWeek)} this week`;
  if (completedThisWeek === 0) return `${committedThisWeek} planned this week`;
  return `${completedThisWeek} ${sessionWord(completedThisWeek)} completed this week · ${committedThisWeek} planned`;
}

// ============================================================
// Goals V2 Rhythm R4 -- ongoing-activity state label (this ticket's own
// section 15/16). `presentGoalActivityStateLabel` above is left completely
// unmodified (NONE activities must preserve current derivedState labels
// exactly, this ticket's own section 15) -- this is a SEPARATE, Rhythm-
// aware wrapper, consulted only for N_PER_WEEK activities, so a NONE
// activity never passes through any new code path at all.
//
// A permanent "Completed" badge is misleading for an ongoing activity (it
// can become eligible again next week -- this ticket's own key R4
// requirement, section 14/15/23). COMPLETED is the only derivedState this
// remaps: SUGGESTED (null badge)/PLANNED/DISMISSED read identically to the
// finite case, since only COMPLETED claims a permanence Rhythm doesn't
// have.
// ============================================================

export function presentGoalActivityRhythmAwareStateLabel(derivedState: DerivedGoalActivityState, rhythm: GoalActivityRhythmView): string | null {
  if (rhythm.kind !== 'N_PER_WEEK' || derivedState !== 'COMPLETED') return presentGoalActivityStateLabel(derivedState);
  return rhythm.eligibleForAnotherOccurrence ? 'Available' : "This week's target met";
}

// Goals V2 G3.2/G3.3 -- formatGoalActivityCompletion now lives in
// goalActivityExecution.ts (a neutral Goal-DOMAIN module, not a Goal-UI
// module): G3.3 needed the SAME formatter from Right Now (Home), and
// importing a "Goals UI" file from Home would have been exactly the
// inappropriate-dependency case this ticket's own section 3 warned
// against. Re-exported here unchanged so Goal Detail's existing import
// site (`from '../../../lib/goalsPresentation'`) keeps working without
// modification -- one canonical implementation, two import paths.
export { formatGoalActivityCompletion };

// ============================================================
// Civil-date display (this ticket's own section 13) -- "YYYY-MM-DD" in,
// a short human label out, WITHOUT ever letting the viewer's browser
// timezone reinterpret which calendar day this is. `timeZone: 'UTC'` on
// the formatter itself is what makes this safe: the string is parsed as
// UTC midnight (same convention as lib/goals.ts's own parseGoalTargetDate)
// and then formatted while PINNED to UTC, so no local offset can shift the
// displayed day backward or forward across a date line.
// ============================================================

const TARGET_DATE_FORMATTER = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

export function formatGoalTargetDateLabel(dateStr: string): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  return TARGET_DATE_FORMATTER.format(new Date(Date.UTC(year, month - 1, day)));
}

export { isValidCivilDateString };
