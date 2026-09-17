/**
 * Day Constructor V1 -- PR F2 "Plan my day" entry-form logic.
 *
 * Pure, DI-testable helpers for the structured intent-row form
 * (PlanDayClient.tsx): row creation, submittability, mapping rows to F1's
 * own request contract (dayConstructorPreviewClient.ts), the FIXED-time
 * date assembly (this ticket's own section 16), and domain-result-to-copy
 * presentation (sections 27-30). Kept separate from the component, matching
 * this repository's own established convention
 * (dayPlanPreviewPresentation.ts, dayPlanAcceptancePresentation.ts) of
 * keeping every mapping/decision a plain function -- and the only way any
 * of this logic is testable at all, since this repo's test suite never
 * renders React components (see e.g. homeDashboardLogic.test.ts: it tests
 * the imported pure helpers, never the component itself).
 */

import { localDateTimeToUTC, addDaysToDateStr } from './timezone';
import type { PreviewRequestIntentBody } from './dayConstructorPreviewClient';
import type { ConstructDayPreviewClientResult } from './dayConstructorPreviewClient';

// ============================================================
// Row model (this ticket's own section 10) -- deliberately NOT every
// `RequestedDayIntent` field (section 10: "Do not surface every
// RequestedDayIntent field"). `id` is the STABLE, client-generated,
// opaque intent id (section 23) -- never regenerated, never derived from
// title.
//
// Intent Fidelity V1 PR G3/G4 -- `important`/`deadlineChoice` added.
// LOCKED UX (this ticket's own section 3/4): `important` is a plain
// boolean, never HIGH/MEDIUM/LOW as UI vocabulary, and LOW is not
// exposed at all -- the row model has no way to represent it, by
// construction, not merely by convention.
// ============================================================

/**
 * A discriminated deadline choice (this ticket's own section 11: "prefer
 * a discriminated representation if it makes invalid states
 * impossible") -- `'CUSTOM'` is the only variant that carries a `date`,
 * so there is no reachable state where a non-custom choice has a
 * dangling/stale date payload the mapper would need to remember to
 * ignore.
 */
export type PlanDayDeadlineChoice = { kind: 'NONE' } | { kind: 'TODAY' } | { kind: 'TOMORROW' } | { kind: 'THIS_WEEK' } | { kind: 'CUSTOM'; date: string };

export const NO_DEADLINE: PlanDayDeadlineChoice = { kind: 'NONE' };

export interface PlanDayIntentRow {
  id: string;
  title: string;
  /** `null` == "Automatic" (this ticket's own section 13) -- omitted from
   * the request entirely, letting PR C's own existing resolution chain
   * decide, never sent as a fabricated/guessed number. */
  durationMinutes: number | null;
  /** `'FLEXIBLE'` is the default (this ticket's own section 14) -- no
   * time chosen. `'FIXED'` only becomes a real, submittable FIXED intent
   * once `fixedTime` is also set (see `isRowSubmittable` below); toggling
   * FIXED alone never silently manufactures a fixedStart. */
  timeMode: 'FLEXIBLE' | 'FIXED';
  /** Raw `<input type="time">` value ("HH:mm"), or `null` before the user
   * has picked one. Only meaningful when `timeMode === 'FIXED'`. */
  fixedTime: string | null;
  /** `false` is the default (this ticket's own section 12) -- maps to
   * `importance: 'HIGH'` only when `true`; when `false` the field is
   * OMITTED from the request entirely (never an explicit `'MEDIUM'`), so
   * the domain's own `DEFAULT_IMPORTANCE` (dayIntent.ts) remains the
   * single source of truth for "no explicit priority stated." */
  important: boolean;
  /** `NO_DEADLINE` is the default. Resolved to a concrete `YYYY-MM-DD`
   * civil-date string (or omitted entirely) only at submission time --
   * see `resolveDeadline`/`buildRequestedIntentsForSubmission` below. */
  deadlineChoice: PlanDayDeadlineChoice;
}

export const MAX_PLAN_DAY_INTENTS = 12; // mirrors F1's own MAX_INTENTS_PER_REQUEST (dayConstructorPreviewRequest.ts) -- the hard upper bound, not a new limit.

/** Same numeric options `ForwardPlannerView.tsx` already uses
 * (`DURATION_OPTIONS_MINUTES`) -- reused verbatim rather than inventing a
 * second duration taxonomy (this ticket's own section 13). `null`
 * ("Automatic") is this form's own addition, since Forward Planner always
 * has a selected activity's own default to fall back to and this form
 * deliberately does not. */
export const PLAN_DAY_DURATION_OPTIONS_MINUTES = [15, 30, 60, 90, 120] as const;

let rowIdCounter = 0;

/** Deterministic-enough per-session id -- this module has no `crypto`
 * dependency (kept trivially testable in a plain ts-node process); the
 * component itself may prefer `crypto.randomUUID()` at the call site if
 * it wants global uniqueness, but every row created via this function
 * within one session already has a distinct, stable id. */
export function createEmptyIntentRow(): PlanDayIntentRow {
  rowIdCounter += 1;
  return { id: `plan-day-row-${rowIdCounter}`, title: '', durationMinutes: null, timeMode: 'FLEXIBLE', fixedTime: null, important: false, deadlineChoice: NO_DEADLINE };
}

// ============================================================
// Submittability (this ticket's own sections 11/19/20) -- a blank row is
// simply excluded, never a hard form error; a row toggled to FIXED with
// no time chosen yet is treated as INCOMPLETE (not submittable, not
// silently downgraded to FLEXIBLE -- this ticket's own section 16/34's
// "never manufacture/never silently downgrade" principle, extended
// client-side to "never silently reinterpret an incomplete choice").
//
// Intent Fidelity V1 PR G3/G4 (implementation ticket's own section 8) --
// a `CUSTOM` deadline earlier than `planningDate` is ALSO treated as
// INCOMPLETE, the exact same shape as the pre-existing FIXED/no-time-yet
// rule: it blocks submission (Submit stays disabled) rather than being
// silently normalized, cleared, or sent anyway. `planningDate` is now a
// required parameter of this gate for exactly that reason.
// ============================================================

function hasTitle(row: PlanDayIntentRow): boolean {
  return row.title.trim().length > 0;
}

function isRowComplete(row: PlanDayIntentRow, planningDate: string): boolean {
  if (!hasTitle(row)) return true; // a blank row is simply excluded, not a blocking error.
  if (row.timeMode === 'FIXED' && !row.fixedTime) return false;
  if (row.deadlineChoice.kind === 'CUSTOM' && row.deadlineChoice.date < planningDate) return false;
  return true;
}

export function countSubmittableIntentRows(rows: readonly PlanDayIntentRow[]): number {
  return rows.filter(hasTitle).length;
}

/** Never allow submission with zero valid intents, and never while any
 * non-blank row is an incomplete FIXED selection or an incomplete/past
 * deadline selection (this ticket's own section 19, extended by G3/G4's
 * own section 8). */
export function canSubmitPlanDay(rows: readonly PlanDayIntentRow[], planningDate: string): boolean {
  return countSubmittableIntentRows(rows) > 0 && rows.every((row) => isRowComplete(row, planningDate));
}

export function canAddAnotherRow(rows: readonly PlanDayIntentRow[]): boolean {
  return rows.length < MAX_PLAN_DAY_INTENTS;
}

// ============================================================
// FIXED-time date assembly (planning-date hardening, this ticket's own
// section 4) -- the ONE place a wall-clock "HH:mm" becomes a real UTC
// instant. Reuses `localDateTimeToUTC` (timezone.ts), the SAME canonical
// helper already used elsewhere in this app for exactly this operation --
// never a second, bespoke implementation, and never the browser's own
// local timezone OR clock. `planningDate` is ALWAYS the server-established
// civil date (planDayBootstrap.ts's own `resolvePlanDayBootstrap`, derived
// from a real server clock read) -- this file reads no clock of its own
// anywhere, by construction, so there is no client-clock-dependent
// code path left to accidentally reintroduce (this ticket's own section 13).
// ============================================================

export function resolveFixedStart(row: Pick<PlanDayIntentRow, 'timeMode' | 'fixedTime'>, planningDate: string, timezone: string): Date | undefined {
  if (row.timeMode !== 'FIXED' || !row.fixedTime) return undefined;
  return localDateTimeToUTC(planningDate, row.fixedTime, timezone);
}

// ============================================================
// Deadline resolution (implementation ticket's own sections 5-7) --
// EVERY branch is a pure civil-date-string operation on `planningDate`
// (the same server-established anchor `resolveFixedStart` above already
// uses) -- never a `Date` instant, never the browser's own clock or
// timezone (this ticket's own section 14: preserves F2's existing
// two-clock hardening exactly, extended to deadlines rather than
// reintroducing a second, independent client-clock-dependent path).
// ============================================================

/**
 * "This week" = the Sunday of the week containing `planningDate` (this
 * ticket's own section 7, locked definition), computed via
 * `addDaysToDateStr` (timezone.ts) -- NEVER `planningDate + 7 days`. Uses
 * the exact same `Date.UTC(...).getUTCDay()` calendar-arithmetic
 * technique `addDaysToDateStr` itself already uses internally, so this
 * stays a pure date-string operation, never an instant read.
 * `getUTCDay()`: Sunday=0 ... Saturday=6. `(7 - weekday) % 7` is 0 for
 * Sunday itself (same day), 6 for Monday, ..., 1 for Saturday --
 * matching this ticket's own worked examples exactly.
 */
function resolveThisWeekDeadline(planningDate: string): string {
  const [year, month, day] = planningDate.split('-').map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  const daysUntilSunday = (7 - weekday) % 7;
  return addDaysToDateStr(planningDate, daysUntilSunday);
}

/** Never sends `deadline` at all for `'NONE'` (this ticket's own section
 * 6: "No deadline -> undefined"). */
export function resolveDeadline(choice: PlanDayDeadlineChoice, planningDate: string): string | undefined {
  switch (choice.kind) {
    case 'NONE':
      return undefined;
    case 'TODAY':
      return planningDate;
    case 'TOMORROW':
      return addDaysToDateStr(planningDate, 1);
    case 'THIS_WEEK':
      return resolveThisWeekDeadline(planningDate);
    case 'CUSTOM':
      return choice.date;
  }
}

// ============================================================
// Row -> F1 request mapping (this ticket's own section 22, updated by the
// planning-date hardening ticket's own section 7, and by Intent Fidelity
// V1 PR G3/G4's own section 13) -- blank rows excluded, `originalOrder`
// never sent (array position IS the order, F1 derives it itself),
// `activityId`/`constructionWindowSource` never sent (this ticket's own
// sections 12/20/21/7). `targetDate` is ALWAYS the same server-established
// `planningDate` used for FIXED-time assembly (planning-date hardening's
// own section 7: "ensures FIXED fixedStart date == preview targetDate" --
// never independently re-derived).
//
// `importance`/`deadline` are now sent (G3/G4's own section 13):
// `important: true` -> `importance: 'HIGH'`; `important: false` -> the
// field is OMITTED (never an explicit `'MEDIUM'`, this ticket's own
// section 3/12). `deadlineChoice.kind === 'NONE'` -> `deadline` OMITTED;
// any other choice resolves to a concrete `YYYY-MM-DD` string via
// `resolveDeadline` above.
//
// Fail-closed past-deadline guard (this ticket's own section 8): a
// resolved deadline earlier than `planningDate` THROWS rather than being
// silently normalized, cleared, or sent anyway -- defense-in-depth
// behind the primary UI gate (`canSubmitPlanDay`'s own `isRowComplete`
// check above, plus the date input's own `min={planningDate}`
// constraint at the component layer), mirroring `dayIntent.ts`'s own
// established "REJECTS, never silently coerces" convention for exactly
// this class of date-validity guard. This should never actually trigger
// through the real UI; it exists so a row that "somehow" bypasses the
// UI gate cannot silently produce a stale-urgency request instead.
// ============================================================

export function buildRequestedIntentsForSubmission(rows: readonly PlanDayIntentRow[], timezone: string, planningDate: string): PreviewRequestIntentBody[] {
  const intents: PreviewRequestIntentBody[] = [];
  for (const row of rows) {
    if (!hasTitle(row)) continue;
    const deadline = resolveDeadline(row.deadlineChoice, planningDate);
    if (deadline !== undefined && deadline < planningDate) {
      throw new Error(`Row "${row.title.trim()}" has a deadline before today. This must never be sent to the server.`);
    }
    const intent: PreviewRequestIntentBody = {
      id: row.id,
      title: row.title.trim(),
      flexibility: row.timeMode,
    };
    if (row.durationMinutes !== null) intent.durationMinutes = row.durationMinutes;
    if (row.important) intent.importance = 'HIGH';
    if (deadline !== undefined) intent.deadline = deadline;
    const fixedStart = resolveFixedStart(row, planningDate, timezone);
    if (fixedStart) intent.fixedStart = fixedStart;
    intents.push(intent);
  }
  return intents;
}

// ============================================================
// Domain-result presentation (this ticket's own sections 27-30) -- every
// non-READY outcome (both F1's own typed domain statuses and this
// client's own protocol-level ones) maps to plain human copy, never a raw
// enum/diagnostic surfaced directly. `retryable` distinguishes "Try
// again" (the same request might succeed) from a case where only editing
// the input could help (NO_USABLE_CAPACITY, this ticket's own section 28:
// "Allow user to return/edit," never "automatically alter the
// construction window").
// ============================================================

export interface PlanDayEntryErrorPresentation {
  message: string;
  retryable: boolean;
}

export function presentPlanDayPreviewFailure(result: Exclude<ConstructDayPreviewClientResult, { status: 'READY' }>): PlanDayEntryErrorPresentation {
  switch (result.status) {
    case 'NO_USABLE_CAPACITY':
      return { message: "There's no usable time left in the part of today Aura can plan.", retryable: false };
    case 'TIMING_SEARCH_FAILED':
      return { message: "Aura couldn't finish checking timing just now.", retryable: true };
    case 'INVALID_CONSTRUCTION_WINDOW':
    case 'TIMEZONE_MISSING':
      // Defensive-only in practice (this form never sends an explicit
      // construction window, and the server always has a real
      // user.timezone) -- generic copy, never raw diagnostics (this
      // ticket's own section 30).
      return { message: "Aura couldn't build a plan for today right now.", retryable: true };
    case 'INVALID_REQUEST':
      return { message: "Something about your day didn't come through correctly. Try again.", retryable: true };
    case 'HTTP_ERROR':
      return result.httpStatus === 401
        ? { message: 'Your session expired. Please sign in again.', retryable: false }
        : { message: "Aura couldn't build a plan for today right now.", retryable: true };
    case 'NETWORK_ERROR':
      return { message: "Aura couldn't be reached. Check your connection and try again.", retryable: true };
    case 'UNKNOWN_RESPONSE':
      return { message: 'Something went wrong. Try again.', retryable: true };
  }
}
