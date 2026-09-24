/**
 * Quick Capture V1 PR A -- pure domain logic (no I/O).
 *
 * A Capture is one user-authored, one-off desire: "I want to do this, but I
 * have not committed to when." It is NOT a Goal/GoalActivity/Habit/
 * PlannedActivity/DayIntent. Nothing here parses the title: dates, durations,
 * importance and activity ids are resolved (if ever) when a Capture enters
 * Plan My Day, never at capture time.
 */

export const MAX_CAPTURE_TITLE_LENGTH = 200;

export type CaptureStatus = 'OPEN' | 'DISMISSED';
export type DerivedCaptureState = 'OPEN' | 'PLANNED' | 'COMPLETED' | 'DISMISSED';
export type LinkedPlanStatus = 'UPCOMING' | 'LOGGED' | 'CANCELLED' | 'SKIPPED';

export type CaptureTitleResult = { ok: true; title: string } | { ok: false; error: string };

export function validateCaptureTitle(value: unknown): CaptureTitleResult {
  if (typeof value !== 'string') return { ok: false, error: 'A capture title is required.' };
  const title = value.trim();
  if (!title) return { ok: false, error: 'A capture title is required.' };
  if (title.length > MAX_CAPTURE_TITLE_LENGTH) return { ok: false, error: `A capture title can be at most ${MAX_CAPTURE_TITLE_LENGTH} characters.` };
  return { ok: true, title };
}

export interface CaptureLifecycleInput {
  status: CaptureStatus;
  completedAt: Date | null;
  /** The linked PlannedActivity's own status, or null when there is no link
   * (never linked, or the plan was hard-deleted and ON DELETE SET NULL
   * cleared the link). */
  linkedPlanStatus: LinkedPlanStatus | null;
}

/**
 * Precedence:
 *  1. DISMISSED controls visibility, even over a retained completion.
 *  2. completedAt is the durable completion fact.
 *  3. A live (UPCOMING) plan -> PLANNED.
 *  4. Transitional compatibility: a LOGGED link without a materialized
 *     completedAt still derives COMPLETED (it is what actually happened);
 *     the logging path is expected to materialize completedAt, after which
 *     this branch is never load-bearing.
 *  5. Otherwise OPEN -- including a CANCELLED or SKIPPED link (available again).
 */
export function deriveCaptureState(input: CaptureLifecycleInput): DerivedCaptureState {
  if (input.status === 'DISMISSED') return 'DISMISSED';
  if (input.completedAt) return 'COMPLETED';
  if (input.linkedPlanStatus === 'UPCOMING') return 'PLANNED';
  if (input.linkedPlanStatus === 'LOGGED') return 'COMPLETED';
  return 'OPEN';
}

/** The primary active-list filter: OPEN and PLANNED only. Kept separate from
 * the listing query so completed/dismissed rows stay retrievable for future
 * history/review. */
export function isActiveCaptureState(state: DerivedCaptureState): boolean {
  return state === 'OPEN' || state === 'PLANNED';
}
