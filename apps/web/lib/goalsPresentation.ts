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

export interface GoalSummary {
  id: string;
  title: string;
  targetDate: string | null;
  status: GoalStatus;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}

export interface GoalActivityView {
  id: string;
  goalId: string;
  title: string;
  activityId: string | null;
  status: GoalActivityStatus;
  plannedActivityId: string | null;
  derivedState: DerivedGoalActivityState;
  createdAt: string;
  updatedAt: string;
}

export interface GoalProgressView {
  total: number;
  completed: number;
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
// Progress copy (this ticket's own section 7). Deliberately distinct
// wording for the zero-activity case -- "0 of 0 completed" would read as
// broken, not empty.
// ============================================================

export function formatGoalProgressLabel(progress: GoalProgressView): string {
  if (progress.total === 0) return 'No activities yet';
  return `${progress.completed} of ${progress.total} completed`;
}

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
