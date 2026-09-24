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
import type { PlanningHorizon } from './planningHorizon';
import type { GoalActivityLink } from './acceptConstructedDay';

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
  /** Plan My Day UX V2 PR U1 -- set only by a Quick Pick tap
   * (planDayQuickPicks.ts), to a real, current catalog id. Untrusted
   * once it reaches the server, exactly like any other client-supplied
   * value (F1/the orchestrator's own `resolveActivity` already
   * re-validate it via `getActivityProfileById`, falling through to
   * ordinary title resolution otherwise -- this ticket's own section 5,
   * zero new trust boundary). MUST be cleared the instant the row's own
   * title is edited by the user (this ticket's own section 6/21: visible
   * text and hidden identity must never silently diverge) -- the ONLY
   * call site that ever clears it is the title input's own onChange
   * (PlanDayClient.tsx), never this file, never a generic patch merge. */
  activityId?: string;
  /** Goals -> Planning Integration V1 PR C -- CLIENT-ONLY provenance (this
   * ticket's own section 9/10). Set only by `createIntentRowFromGoalActivity`
   * below, for a row seeded from the Goal handoff. Deliberately never
   * serialized into `PreviewRequestIntentBody`/`RequestedDayIntent`/
   * `DayIntent` -- `buildRequestedIntentsForSubmission` below never reads
   * this field, by construction (this ticket's own section 15/16). It
   * survives editing/preview/retry for free: every `setRows` call site in
   * PlanDayClient.tsx either patch-merges (`{...row, ...patch}`, never
   * including this field in a patch) or filters/spreads the existing row
   * objects -- nothing reconstructs a row from server/preview data. It is
   * NOT cleared when the row's title is edited (unlike `activityId`
   * above): `activityId` is a CATALOG IDENTITY claim that an edited title
   * may no longer match, but `goalActivityId` is a PROVENANCE fact about
   * where this row came from, which editing the planning-session wording
   * does not change (this ticket's own section 13 -- "the provenance link
   * may still point back to the originating GoalActivity"). Consumed only
   * at accept time, by `buildGoalActivityLinksForAccept` below. */
  goalActivityId?: string;
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

/** Id of the single blank row a fresh page starts with. Fixed (never drawn
 * from `rowIdCounter`) because that row is created inside a `useState`
 * initializer, which runs on the server AND again on the client -- a
 * module-level counter would hand each side a different id and mismatch
 * the hydrated `htmlFor`/`id` attributes. */
export const INITIAL_INTENT_ROW_ID = 'plan-day-row-initial';

/** The blank starting row. Deterministic, so safe to create during SSR. */
export function createInitialIntentRow(): PlanDayIntentRow {
  return { ...blankIntentRow(INITIAL_INTENT_ROW_ID) };
}

function blankIntentRow(id: string): PlanDayIntentRow {
  return { id, title: '', durationMinutes: null, timeMode: 'FLEXIBLE', fixedTime: null, important: false, deadlineChoice: NO_DEADLINE };
}

/** A blank row for a user action (`+ Something else`, Quick Pick). Draws
 * from a per-page-load counter, so it must only be called from client event
 * handlers, never during render/`useState` initialization (see
 * `createInitialIntentRow`). Its `plan-day-row-<n>` ids can never equal the
 * fixed initial id or a Goal-derived id. */
export function createEmptyIntentRow(): PlanDayIntentRow {
  rowIdCounter += 1;
  return blankIntentRow(`plan-day-row-${rowIdCounter}`);
}

// ============================================================
// Plan My Day UX V2 PR U1 -- Quick Picks (this ticket's own sections
// 10-16). Row CREATION only; picker configuration itself lives in
// planDayQuickPicks.ts (never duplicated here).
// ============================================================

/** A Quick Pick tap always produces a row with every OTHER field at its
 * exact `createEmptyIntentRow()` default (this ticket's own section 39:
 * "No additional interaction required before Preview") -- reuses that
 * same factory (same id-counter, same defaults) rather than a second,
 * parallel row-construction path, then overrides only `title`/
 * `activityId`. */
export function createIntentRowFromQuickPick(pick: { label: string; activityId?: string }): PlanDayIntentRow {
  return { ...createEmptyIntentRow(), title: pick.label, activityId: pick.activityId };
}

// ============================================================
// Goals -> Planning Integration V1 PR C (this ticket's own section 10) --
// a small, explicit sibling factory, reusing `createEmptyIntentRow`'s own
// defaults exactly like `createIntentRowFromQuickPick` above, rather than
// a second, parallel row-construction path. `goalActivity.activityId`
// is preserved verbatim where present (this ticket's own section 11); a
// `null`/absent value is left `undefined` on the row, letting the exact
// same downstream activity-resolution/classification behavior operate as
// it already does for a typed row with no `activityId` -- no GoalActivity
// is required to map to the static catalog.
// ============================================================

export function createIntentRowFromGoalActivity(goalActivity: { id: string; title: string; activityId: string | null }): PlanDayIntentRow {
  return { ...blankIntentRow(`plan-day-goal-${goalActivity.id}`), title: goalActivity.title, activityId: goalActivity.activityId ?? undefined, goalActivityId: goalActivity.id };
}

/** True only for a row that is BYTE-IDENTICAL to a freshly-created empty
 * row in every field except `id` (this ticket's own section 15: "Define
 * 'blank' using row state, not title alone if other fields have been
 * configured... A row with scheduling customization but blank title
 * should not be silently overwritten"). Used both to decide whether a
 * Quick Pick/`+ Something else` tap may reuse the single existing row in
 * place, rather than appending a second one alongside an untouched
 * default row. */
export function isRowUntouched(row: PlanDayIntentRow): boolean {
  return (
    row.title === '' &&
    row.durationMinutes === null &&
    row.timeMode === 'FLEXIBLE' &&
    row.fixedTime === null &&
    row.important === false &&
    row.deadlineChoice.kind === 'NONE' &&
    row.activityId === undefined
  );
}

// ============================================================
// Plan My Day UX V2 PR U1 -- collapsed-card summary (this ticket's own
// sections 18-19/58-59). Presentation only: reads the exact same fields
// the expanded controls already edit, never a new domain fact. Kept as a
// pure function (not inline JSX string-building) so it is directly
// testable, matching this file's own established convention.
// ============================================================

/** "HH:mm" (24h) -> "H:MM AM/PM" -- pure string/number formatting, no
 * Date instant, no timezone (the underlying value is already a plain
 * civil clock-time string; see `resolveFixedStart`'s own doc comment). */
function formatFixedTimeLabel(fixedTime: string): string {
  const [hourStr, minuteStr] = fixedTime.split(':');
  const hour24 = Number(hourStr);
  const period = hour24 >= 12 ? 'PM' : 'AM';
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${hour12}:${minuteStr} ${period}`;
}

/** `undefined` for `NONE` (never shown in the summary at all -- this
 * ticket's own section 19: "Deadline only if set"). `'TODAY'` reuses the
 * SAME horizon-aware wording `DueByControl`'s own first chip already
 * shows (PlanDayClient.tsx) -- "same day" under Tomorrow, "today"
 * otherwise -- so the collapsed summary and the expanded control can
 * never disagree about what "today" currently means. */
function formatDeadlineSummaryLabel(choice: PlanDayDeadlineChoice, horizon: PlanningHorizon | null): string | undefined {
  switch (choice.kind) {
    case 'NONE':
      return undefined;
    case 'TODAY':
      return horizon === 'TOMORROW' ? 'Deadline same day' : 'Deadline today';
    case 'TOMORROW':
      return 'Deadline tomorrow';
    case 'THIS_WEEK':
      return 'Deadline this week';
    case 'CUSTOM':
      return `Deadline ${choice.date}`;
  }
}

/** The exact compact line a collapsed task card shows (this ticket's own
 * section 19 worked examples, reproduced verbatim by this function):
 * flexibility/time, then duration, then Important only if true, then
 * Deadline only if set -- joined with " · ", never exposing a raw enum
 * name. */
export function formatIntentRowSummary(row: PlanDayIntentRow, horizon: PlanningHorizon | null): string {
  const parts: string[] = [];
  parts.push(row.timeMode === 'FIXED' && row.fixedTime ? `Specific time ${formatFixedTimeLabel(row.fixedTime)}` : 'Flexible');
  parts.push(row.durationMinutes === null ? 'Automatic' : `${row.durationMinutes} min`);
  if (row.important) parts.push('Important');
  const deadlineLabel = formatDeadlineSummaryLabel(row.deadlineChoice, horizon);
  if (deadlineLabel) parts.push(deadlineLabel);
  return parts.join(' · ');
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
// `constructionWindowSource` never sent (this ticket's own sections
// 12/20/21/7). Plan My Day UX V2 PR U1 -- `activityId` IS now sent, but
// only when a row actually carries one (a Quick Pick tap, never a typed
// row): F1/the orchestrator already accept and re-validate this exact
// optional field (dayConstructorPreviewRequest.ts/dayConstructorOrchestrator.ts,
// zero server change required -- this ticket's own section 9). `targetDate` is ALWAYS the same server-established
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
    if (row.activityId !== undefined) intent.activityId = row.activityId;
    const fixedStart = resolveFixedStart(row, planningDate, timezone);
    if (fixedStart) intent.fixedStart = fixedStart;
    intents.push(intent);
  }
  return intents;
}

// ============================================================
// Goals -> Planning Integration V1 PR C, this ticket's own section 21/22
// -- built ONLY at accept time, entirely separate from
// `buildRequestedIntentsForSubmission` above (which never reads
// `goalActivityId` at all, preserving the preview boundary exactly).
// Includes a row only when it BOTH carries Goal provenance AND was
// actually placed by the Constructor (present in the accepted preview's
// own `proposedItems`) -- a deferred item, or a row the user removed
// before ever previewing it, is silently excluded here by construction,
// never producing a phantom link (this ticket's own section 22).
// ============================================================

export function buildGoalActivityLinksForAccept(rows: readonly PlanDayIntentRow[], proposedItems: readonly { intentId: string }[]): GoalActivityLink[] {
  const proposedIntentIds = new Set(proposedItems.map((item) => item.intentId));
  const links: GoalActivityLink[] = [];
  for (const row of rows) {
    if (row.goalActivityId && proposedIntentIds.has(row.id)) {
      links.push({ intentId: row.id, goalActivityId: row.goalActivityId });
    }
  }
  return links;
}

// ============================================================
// Domain-result presentation (this ticket's own sections 27-30; Plan My
// Day U3's own sections 9-14 amendment below) -- every non-READY outcome
// (both F1's own typed domain statuses and this client's own protocol-
// level ones) maps to plain human copy, never a raw enum/diagnostic
// surfaced directly.
//
// U3 replaces the original single `retryable: boolean` with an explicit
// `actions` list plus `showEdit`, because a boolean could only ever
// express "resubmit or don't" -- it had no way to express a DIFFERENT
// corrective action (Configure availability, Sign in) without the
// calling component inventing its own ad hoc branching per status (this
// ticket's own section 9: "map deterministic problems to useful existing
// actions... every rendered action must have a real implemented
// destination"). Every `action` here corresponds to a real, already-
// wired destination in PlanDayClient.tsx -- never a placeholder.
//
// DETERMINISTIC VS TRANSIENT (U3's own sections 10/11, verified per-
// status rather than assumed): `NO_USABLE_CAPACITY`, `FUTURE_
// AVAILABILITY_REQUIRED`, `INVALID_CONSTRUCTION_WINDOW`, `TIMEZONE_
// MISSING`, and `INVALID_REQUEST` all describe a fact about the CURRENT
// server-side state (stored availability, or a malformed request body)
// that an unchanged resubmission cannot change -- none of these ever
// offer 'RETRY' (U3 correction: the four non-NO_USABLE_CAPACITY cases
// were previously marked retryable, which was untrue -- resubmitting the
// identical request against unchanged server state was always expected
// to reproduce the identical failure). `TIMING_SEARCH_FAILED`,
// `HTTP_ERROR` (non-401), `NETWORK_ERROR`, and `UNKNOWN_RESPONSE` are
// genuinely transient/system-level and keep 'RETRY'.
// ============================================================

export type PlanDayEntryRecoveryAction = 'RETRY' | 'CONFIGURE_AVAILABILITY' | 'SIGN_IN';

export interface PlanDayEntryErrorPresentation {
  message: string;
  /** Whether the always-available "return to editing, rows preserved"
   * action should render. `false` only for a 401 (U3's own section 14):
   * editing activity rows cannot resolve an expired session, and
   * offering it there would be a real, not merely cosmetic, dead end. */
  showEdit: boolean;
  /** Zero or more corrective/recovery actions, in display order, beyond
   * plain Edit. */
  actions: readonly PlanDayEntryRecoveryAction[];
}

/**
 * Planning Horizon V1 PR P2 -- `horizon` makes the copy below correct
 * for a future day too (this ticket's own section 19: `NO_USABLE_
 * CAPACITY`'s pre-P2 wording hardcoded "today," which would misleadingly
 * describe a Tomorrow CONFIGURED_EMPTY day as though it were still
 * today's own elapsed capacity). `FUTURE_AVAILABILITY_REQUIRED` is
 * handled here only defensively/for completeness -- the real UI
 * (PlanDayClient.tsx) intercepts that status before ever calling this
 * function, routing it to the same actionable "Set your availability
 * first" card the bootstrap-known case already shows (this ticket's own
 * section 16/17), never this generic message.
 */
export function presentPlanDayPreviewFailure(result: Exclude<ConstructDayPreviewClientResult, { status: 'READY' }>, horizon: PlanningHorizon): PlanDayEntryErrorPresentation {
  const dayDescription = horizon === 'TOMORROW' ? 'tomorrow' : 'today';
  switch (result.status) {
    case 'NO_USABLE_CAPACITY':
      // Plan My Day U3, this ticket's own section 2/9/11 truthfulness fix
      // -- final review (PR #147) found this status is reachable through
      // TWO genuinely distinct causes the client cannot tell apart (the
      // HTTP response collapses both to the same bare status, discarding
      // `dayCapacity.ts`'s own `constructionWindowMinutes`/`blockedMinutes`
      // fields that would distinguish them):
      //
      //   1. CONFIGURED_EMPTY (dayConstructorOrchestrator.ts's own
      //      `resolveAvailabilityAwareWindow`): a real, deliberate saved
      //      schedule with zero periods for this specific weekday --
      //      genuinely distinct from "no availability configured" (that
      //      unconfigured case is `FUTURE_AVAILABILITY_REQUIRED`, handled
      //      separately below).
      //   2. Real configured hours exist for this weekday, but an
      //      EXISTING blocking Plan already occupies all of them --
      //      `computeCapacitySnapshot` (dayCapacity.ts) fails closed to
      //      this exact same status whenever `usableMinutes === 0`,
      //      regardless of why (that function's own doc comment: "zero
      //      usable capacity ALWAYS produces NO_USABLE_CAPACITY").
      //
      // An earlier draft of this fix claimed "your availability schedule
      // doesn't include usable time on that day" -- TRUE for cause 1, but
      // FALSE for cause 2 (a schedule that genuinely does include time,
      // simply already spoken for). Since the diagnostic cannot prove
      // which cause applies, the message now states only the observable
      // FACT (no usable time remains) without asserting why -- the exact
      // same non-committal pattern the pre-existing, already-accepted
      // TODAY message below already uses ("There's no usable time left in
      // the part of today Aura can plan" -- itself never claims a specific
      // cause either, and reaches this same dual-cause status). Configure
      // availability remains offered because it is a real, non-dead-end
      // destination that can genuinely help under EITHER cause (directly
      // for cause 1; by adding non-conflicting hours elsewhere in the day
      // for cause 2) -- offering a real, possibly-helpful action is not
      // the same claim as asserting a specific unproven cause.
      return horizon === 'TOMORROW'
        ? { message: "There's no usable time left in tomorrow's availability for Aura to plan.", showEdit: true, actions: ['CONFIGURE_AVAILABILITY'] }
        : { message: "There's no usable time left in the part of today Aura can plan.", showEdit: true, actions: [] };
    case 'FUTURE_AVAILABILITY_REQUIRED':
      return { message: 'Aura needs to know when you\'re usually available before it can plan a future day.', showEdit: true, actions: ['CONFIGURE_AVAILABILITY'] };
    case 'TIMING_SEARCH_FAILED':
      return { message: "Aura couldn't finish checking timing just now.", showEdit: true, actions: ['RETRY'] };
    case 'INVALID_CONSTRUCTION_WINDOW':
    case 'TIMEZONE_MISSING':
      // Defensive-only in practice (this form never sends an explicit
      // construction window, and the server always has a real
      // user.timezone) -- generic copy, never raw diagnostics (this
      // ticket's own section 30). U3 correction: this is a deterministic
      // fact about server-side request validation, not a transient
      // failure -- an unchanged resubmission was never expected to
      // succeed, so 'RETRY' no longer renders (this ticket's own section
      // 11, verified rather than assumed for this exact status).
      return { message: `Aura couldn't build a plan for ${dayDescription} right now.`, showEdit: true, actions: [] };
    case 'INVALID_REQUEST':
      // U3 correction (this ticket's own section 11): a malformed request
      // BODY is a deterministic fact about what this client just sent --
      // resubmitting the SAME rows would reconstruct the SAME body and
      // reproduce the SAME failure. 'RETRY' removed; Edit (which lets the
      // user actually change something first) remains the honest path.
      return { message: "Something about your day didn't come through correctly.", showEdit: true, actions: [] };
    case 'HTTP_ERROR':
      // U3, this ticket's own section 14 -- a 401 previously claimed
      // "Please sign in again" with no actual sign-in action rendered
      // anywhere (Edit was the only button shown, and editing activity
      // rows cannot restore an expired session). `/` already hosts this
      // app's real, only sign-in surface (its own LoginScreen, rendered
      // there for any unauthenticated visitor -- confirmed by direct
      // audit of PlanDayClient.tsx's own existing "Back to Home"
      // navigation, the SAME destination reused here, never a new auth
      // flow). `showEdit: false` because there is nothing edit-and-
      // resubmit could accomplish while unauthenticated.
      return result.httpStatus === 401
        ? { message: 'Your session expired.', showEdit: false, actions: ['SIGN_IN'] }
        : { message: `Aura couldn't build a plan for ${dayDescription} right now.`, showEdit: true, actions: ['RETRY'] };
    case 'NETWORK_ERROR':
      return { message: "Aura couldn't be reached. Check your connection and try again.", showEdit: true, actions: ['RETRY'] };
    case 'UNKNOWN_RESPONSE':
      return { message: 'Something went wrong.', showEdit: true, actions: ['RETRY'] };
  }
}
