/**
 * Onboarding V1 PR 4 -- First Goal & Personalization.
 *
 * Pure, DI-free helpers for the onboarding Goal offer (OnboardingJourney.tsx's
 * own GoalStep/FirstActivityStep). Kept separate from the component, matching
 * this repo's established convention (planDayEntry.ts, dayPlanPreviewPresentation.ts)
 * of keeping every mapping/decision a plain, directly-testable function.
 *
 * Reuses the EXISTING Goal-creation contract (POST /api/goals) and the
 * EXISTING Day Constructor preview/accept pipeline (planDayEntry.ts,
 * dayConstructorPreviewClient.ts, acceptConstructedDay.ts, DayPlanPreviewController)
 * exactly as PlanDayClient.tsx's own Goal-handoff path already does for a
 * manually-added row -- this file introduces no new scheduling logic, no new
 * Goal fields, no new rhythm vocabulary, no new preview/accept request shape.
 */

import { getDatePartsInTimezone } from './timezone';
import { NONE_GOAL_ACTIVITY_RHYTHM, type GoalActivityRhythm } from './goalActivityRhythm';
import { createIntentRowFromGoalActivity, buildRequestedIntentsForSubmission, buildGoalActivityLinksForAccept, presentPlanDayPreviewFailure, type PlanDayIntentRow } from './planDayEntry';
import type { GoalActivityLink } from './acceptConstructedDay';
import type { ConstructDayPreviewClientResult, PreviewRequestIntentBody } from './dayConstructorPreviewClient';

// ============================================================
// Section B -- category chips are discovery aids only (the ticket's own
// instruction: "not new persistent Goal types unless the existing domain
// model already supports them" -- Goal/GoalActivity has no category field
// at all, so none is invented here). A chip only pre-fills the SAME
// editable free-text `title` field "Enter my own" produces; nothing below
// is ever sent to the server as a category/enum value.
// ============================================================

export interface OnboardingGoalCategory {
  id: string;
  label: string;
  /** Pre-fills the editable title field -- a suggestion, never submitted
   * verbatim without the user seeing/being able to change it first. */
  suggestedTitle: string;
}

export const ONBOARDING_GOAL_CATEGORIES: readonly OnboardingGoalCategory[] = [
  { id: 'health', label: 'Health and wellbeing', suggestedTitle: 'Move my body regularly' },
  { id: 'learning', label: 'Learning', suggestedTitle: 'Learn something new' },
  { id: 'work', label: 'Work and focus', suggestedTitle: 'Make progress on a work project' },
  { id: 'habits', label: 'Personal habits', suggestedTitle: 'Build a daily habit' },
];

// Mirrors apps/web/app/api/goals/route.ts's own MAX_TITLE_LENGTH exactly --
// never a second, independently-drifting limit.
export const ONBOARDING_GOAL_TITLE_MAX_LENGTH = 200;

export function isOnboardingGoalTitleValid(title: string): boolean {
  const trimmed = title.trim();
  return trimmed.length > 0 && trimmed.length <= ONBOARDING_GOAL_TITLE_MAX_LENGTH;
}

// ============================================================
// Section C -- minimum Goal input. `rhythm` defaults to NONE ("Once"), the
// SAME disclosed default CreateGoalModal's own RhythmPicker already shows
// for every new activity -- never a silently-invented frequency. No
// targetDate, no deadline, no duration: this request is a strict subset of
// CreateGoalModal's own EXPLICIT_REVIEW body, never a second shape.
// ============================================================

export const DEFAULT_ONBOARDING_GOAL_RHYTHM: GoalActivityRhythm = NONE_GOAL_ACTIVITY_RHYTHM;

export interface OnboardingGoalCreateRequestBody {
  title: string;
  activities: Array<{ title: string; rhythm: GoalActivityRhythm }>;
  clientRequestId: string;
}

export function buildOnboardingGoalCreateRequestBody(title: string, rhythm: GoalActivityRhythm, clientRequestId: string): OnboardingGoalCreateRequestBody {
  const trimmed = title.trim();
  return { title: trimmed, activities: [{ title: trimmed, rhythm }], clientRequestId };
}

// ============================================================
// Section D -- "Find time for your first activity." Reuses
// createIntentRowFromGoalActivity/buildRequestedIntentsForSubmission/
// buildGoalActivityLinksForAccept (planDayEntry.ts) and
// previewConstructedDay/acceptConstructedDay (via DayPlanPreviewController)
// EXACTLY as PlanDayClient.tsx's own Goal-handoff path already does for a
// manually-added row.
// ============================================================

export interface OnboardingGoalActivityRef {
  id: string;
  title: string;
  activityId: string | null;
}

/** Server-authoritative "today" in the user's own confirmed timezone -- the
 * SAME `getDatePartsInTimezone` helper `resolvePlanDayBootstrap` (the real
 * Plan My Day entry point) already uses for exactly this purpose.
 * Onboarding has no server-rendered bootstrap step of its own (unlike
 * /plan-day's Server Component), so `now` is the caller's own clock read --
 * never authoritative for persistence, only for shaping this PREVIEW
 * request; the existing accept pipeline's own staleness/fresh-blocker
 * checks (dayConstructorAcceptance.ts) independently re-validate against
 * the real server clock before anything is ever persisted, exactly as they
 * already do for every other caller of this same pipeline. */
export function resolveOnboardingPlanningDate(timezone: string, now: Date): string {
  return getDatePartsInTimezone(timezone, now).dateStr;
}

export interface OnboardingFirstActivityIntent {
  row: PlanDayIntentRow;
  intents: PreviewRequestIntentBody[];
}

export function buildOnboardingFirstActivityIntent(goalActivity: OnboardingGoalActivityRef, timezone: string, planningDate: string): OnboardingFirstActivityIntent {
  const row = createIntentRowFromGoalActivity(goalActivity);
  const intents = buildRequestedIntentsForSubmission([row], timezone, planningDate);
  return { row, intents };
}

export function buildOnboardingFirstActivityGoalLinks(row: PlanDayIntentRow, proposedItems: readonly { intentId: string }[]): GoalActivityLink[] {
  return buildGoalActivityLinksForAccept([row], proposedItems);
}

// ============================================================
// Preview-result presentation -- reuses planDayEntry.ts's own
// presentPlanDayPreviewFailure verbatim (never new copy/logic); onboarding
// always previews for 'TODAY' (no horizon-selection UI exists here).
// ============================================================

export interface OnboardingFirstActivityFailurePresentation {
  message: string;
  retryable: boolean;
}

export function presentOnboardingFirstActivityPreviewFailure(result: Exclude<ConstructDayPreviewClientResult, { status: 'READY' }>): OnboardingFirstActivityFailurePresentation {
  const presentation = presentPlanDayPreviewFailure(result, 'TODAY');
  return { message: presentation.message, retryable: presentation.actions.includes('RETRY') };
}
