/**
 * Plan-blocker lifecycle -- the one canonical answer to "does this
 * persisted Plan occupy time?", extracted VERBATIM from
 * dayConstructorOrchestrator.ts (which re-exports it, so every existing
 * importer is unaffected) so that other generic modules can reuse the same
 * rule without importing the orchestrator. Pure: no I/O, no clock (the
 * caller supplies the reference instant). Behavior is unchanged.
 */

/**
 * The persisted status of a real `PlannedActivity` row (db.ts) --
 * exactly the three real DB-column values, reproduced here rather than
 * imported so this file's own lifecycle adapter has a self-contained,
 * directly-testable input shape independent of the full `PlannedActivity`
 * interface (which carries many fields irrelevant to blocking, e.g.
 * `recommendation`/`score`/`calendarUrl`).
 */
export type PlanBlockerStatus = 'UPCOMING' | 'LOGGED' | 'CANCELLED' | 'SKIPPED' | 'MOVED';

/** The minimal shape `isActivePlanBlocker` needs to decide whether one
 * Plan blocks time -- deliberately NOT the full `PlannedActivity`
 * interface. */
export interface PlanBlockerCandidate {
  start: Date;
  end: Date;
  status: PlanBlockerStatus;
}

/**
 * PlannedActivity + reference instant -> blocking or non-blocking (this
 * ticket's own section 6 adapter; kept in the orchestrator layer, never
 * added to PR A/B, never a new schema field, never a new general
 * lifecycle framework). Reproduces -- never imports, since
 * `dailyAgenda.ts`'s own `timeBasedStatus` is a private, unexported
 * helper, and PR A already established the precedent of reproducing a
 * tiny formula rather than cross-importing across module boundaries --
 * the EXACT distinguishing fact that file's own doc comment states
 * verbatim: "a Plan whose window has elapsed is NOT automatically
 * 'completed' -- completion is decided exclusively by
 * plan.status === 'LOGGED'... An elapsed, unlogged Plan is 'MISSED'."
 *
 *   - `'CANCELLED'` never blocks. Already excluded by
 *     `listPlannedActivitiesForDay`'s own SQL filter in production
 *     (`status <> 'CANCELLED'`); re-checked here defensively for any
 *     other caller of this function.
 *   - `'SKIPPED'` never blocks (terminal, nothing occupied the slot).
 *   - `'MOVED'` never blocks (superseded; its successor blocks instead).
 *   - `'LOGGED'` ALWAYS blocks, regardless of the reference instant.
 *     `dailyAgenda.ts`'s own rule --
 *     `plan.status === 'LOGGED' ? 'COMPLETED' : timeBasedStatus(...)` --
 *     never runs the elapsed-time check for a LOGGED row at all: real
 *     historical execution occupies its own time slot exactly as
 *     immutably as a future commitment does (this ticket's own section
 *     4's option A -- confirmed correct by re-reading the actual
 *     lifecycle code, not assumed).
 *   - `'UPCOMING'` blocks ONLY while it has not yet elapsed relative to
 *     `referenceInstant` (`end >= referenceInstant`) -- the exact
 *     complement of `dailyAgenda.ts`'s own `endAt < now -> 'MISSED'`
 *     rule. A derived-MISSED row (committed to, never logged, already
 *     elapsed) represents a slot nothing actually occupies, and must
 *     not block a new proposal (this ticket's own section 5, verbatim:
 *     "an old persisted UPCOMING row must NOT automatically become a
 *     blocker ... merely because storage still says UPCOMING").
 *
 * `referenceInstant` is always the orchestration request's own explicit
 * `now` (§7: "no hidden new Date()") -- for `REMAINING_TODAY` this is
 * the same instant the window itself starts from; for `EXPLICIT_RANGE`
 * it is the SAME field, reused for lifecycle purposes only (the window's
 * own bounds still come from `explicitStart`/`explicitEnd` verbatim).
 */
export function isActivePlanBlocker(plan: PlanBlockerCandidate, referenceInstant: Date): boolean {
  if (plan.status === 'CANCELLED') return false;
  // SKIPPED: the user decided not to do it -- the slot is free (unlike LOGGED, nothing occupied it).
  if (plan.status === 'SKIPPED') return false;
  // MOVED: the commitment lives on in its successor, which blocks in its own right.
  if (plan.status === 'MOVED') return false;
  if (plan.status === 'LOGGED') return true;
  return plan.end.getTime() >= referenceInstant.getTime();
}
