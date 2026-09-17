/**
 * Availability Settings V1 -- PR H2: pure editor logic for the weekly
 * availability editor (AvailabilitySettings.tsx). Row creation, add/
 * remove/copy operations, sorting, and validation -- kept separate from
 * the component, matching this repository's own established convention
 * (planDayEntry.ts, dayPlanPreviewPresentation.ts) of keeping every
 * mapping/decision a plain, directly-testable function.
 *
 * H1 CONTRACT (this ticket's own section 40): this file never redefines
 * `resolveAvailability`/`Weekday`/`AvailabilityPeriodInput`/
 * `validateAvailabilityPeriodInput` -- it imports and reuses them
 * verbatim from availabilityContext.ts. This is a CAPTURE/PERSISTENCE
 * layer over H1, never a second duration/availability engine.
 */

import { validateAvailabilityPeriodInput, type Weekday, type AvailabilityPeriodInput } from './availabilityContext';

export const WEEKDAY_LABELS: readonly string[] = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']; // index === Weekday (0=Sunday), same convention availabilityContext.ts's own getWeekdayForDateStr already uses.

/** Tue-Fri, this ticket's own section 8/9 -- "Copy Monday to weekdays"
 * copies Monday's periods to exactly these four weekdays, never
 * Saturday/Sunday. */
const WEEKDAY_COPY_TARGETS: readonly Weekday[] = [2, 3, 4, 5];
const MONDAY: Weekday = 1;

// ============================================================
// Draft row model (component-local editing state, never persisted
// verbatim) -- `id` is a client-generated, opaque, STABLE local key
// (this ticket's own section 33/34's "keep business rules outside JSX"
// spirit: React needs a stable key for add/remove/edit before save, but
// that key carries no meaning to the server at all -- flattenWeekDraft
// below drops it entirely).
// ============================================================

export interface AvailabilityPeriodDraft {
  id: string;
  startTime: string;
  endTime: string;
}

/** One entry per weekday, always exactly 7, always in weekday order --
 * `periods` may legitimately be `[]` ("Not available" for that day,
 * this ticket's own section 11). */
export type WeekAvailabilityDraft = { weekday: Weekday; periods: AvailabilityPeriodDraft[] }[];

let draftPeriodIdCounter = 0;

/** Deterministic-enough per-session id -- mirrors planDayEntry.ts's own
 * `createEmptyIntentRow` counter convention exactly (no `crypto`
 * dependency, trivially testable). */
function nextDraftPeriodId(): string {
  draftPeriodIdCounter += 1;
  return `availability-period-${draftPeriodIdCounter}`;
}

/** A fresh, entirely empty week -- the correct initial draft for BOTH an
 * UNCONFIGURED user (this ticket's own section 7: never silently infer
 * Mon-Fri 9-5, never infer weekends unavailable) and the starting point
 * before the user adds their first period. */
export function createEmptyWeekDraft(): WeekAvailabilityDraft {
  return [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday: weekday as Weekday, periods: [] }));
}

/** Builds a draft from the server's own already-CONFIGURED period list
 * (this ticket's own section 14: GET response `periods`). Never called
 * for an UNCONFIGURED user -- the caller (AvailabilitySettings.tsx) uses
 * `createEmptyWeekDraft` for that case instead, so this function never
 * has to guess which state it's hydrating for. */
export function hydrateWeekDraft(periods: readonly AvailabilityPeriodInput[]): WeekAvailabilityDraft {
  const draft = createEmptyWeekDraft();
  for (const period of periods) {
    draft[period.weekday].periods.push({ id: nextDraftPeriodId(), startTime: period.startTime, endTime: period.endTime });
  }
  for (const day of draft) sortPeriodsInPlace(day.periods);
  return draft;
}

function sortPeriodsInPlace(periods: AvailabilityPeriodDraft[]): void {
  periods.sort((a, b) => (a.startTime < b.startTime ? -1 : a.startTime > b.startTime ? 1 : 0));
}

// ============================================================
// Editing operations (this ticket's own sections 12/13/19) -- every
// function returns a NEW draft, never mutates its input, matching this
// repository's own established immutable-update convention throughout
// (planDayEntry.ts's own `updateRow`, dayCapacity.ts's own
// `normalizeBlockedIntervals`).
// ============================================================

/** New UI default: 09:00-17:00, a reasonable, clearly-a-placeholder
 * starting interval the user is expected to adjust -- never inferred
 * from `now`/browser time (this ticket's own section 12). */
const DEFAULT_NEW_PERIOD_START = '09:00';
const DEFAULT_NEW_PERIOD_END = '17:00';

export function addPeriod(draft: WeekAvailabilityDraft, weekday: Weekday): WeekAvailabilityDraft {
  return draft.map((day) => (day.weekday === weekday ? { ...day, periods: [...day.periods, { id: nextDraftPeriodId(), startTime: DEFAULT_NEW_PERIOD_START, endTime: DEFAULT_NEW_PERIOD_END }] } : day));
}

/** Removing the final period from a weekday leaves `periods: []` --
 * "Not available" for that day, never a signal to unconfigure the whole
 * feature (this ticket's own section 13/23: only the distinct Reset
 * action does that). */
export function removePeriod(draft: WeekAvailabilityDraft, weekday: Weekday, periodId: string): WeekAvailabilityDraft {
  return draft.map((day) => (day.weekday === weekday ? { ...day, periods: day.periods.filter((p) => p.id !== periodId) } : day));
}

export function updatePeriodTime(draft: WeekAvailabilityDraft, weekday: Weekday, periodId: string, field: 'startTime' | 'endTime', value: string): WeekAvailabilityDraft {
  return draft.map((day) => (day.weekday === weekday ? { ...day, periods: day.periods.map((p) => (p.id === periodId ? { ...p, [field]: value } : p)) } : day));
}

/**
 * "Copy Monday to weekdays" (this ticket's own section 8/9) -- copies
 * Monday's COMPLETE period list, exactly, to Tuesday-Friday, replacing
 * whatever those four days previously held. Saturday/Sunday and Monday
 * itself are untouched. Each copied period gets its OWN new local id
 * (never a shared id across weekdays -- draft ids are per-row React
 * identity, not a "same period" grouping key). No server call is
 * required for this local operation (this ticket's own section 9); the
 * user still saves explicitly afterward.
 */
export function copyMondayToWeekdays(draft: WeekAvailabilityDraft): WeekAvailabilityDraft {
  const mondayPeriods = draft.find((day) => day.weekday === MONDAY)?.periods ?? [];
  return draft.map((day) =>
    WEEKDAY_COPY_TARGETS.includes(day.weekday)
      ? { ...day, periods: mondayPeriods.map((p) => ({ id: nextDraftPeriodId(), startTime: p.startTime, endTime: p.endTime })) }
      : day
  );
}

// ============================================================
// Flatten / validate for submission (this ticket's own section 16-18,
// section 49 test items 13-19).
// ============================================================

/** `aStart < bEnd && bStart < aEnd` on zero-padded "HH:mm" strings --
 * lexical comparison is exact for this format, so no Date conversion is
 * needed (the SAME reasoning `validateAvailabilityPeriodInput`'s own
 * `start >= end` check already relies on). Touching periods
 * (`aEnd === bStart`) are NOT overlapping by this formula -- this
 * ticket's own section 17 locked recommendation: reject overlap, accept
 * touching (H1's own resolver already merges touching periods safely at
 * resolution time; Settings does not need to pre-normalize them). */
export function periodsOverlap(a: Pick<AvailabilityPeriodDraft, 'startTime' | 'endTime'>, b: Pick<AvailabilityPeriodDraft, 'startTime' | 'endTime'>): boolean {
  return a.startTime < b.endTime && b.startTime < a.endTime;
}

export type WeekDraftValidationResult = { ok: true } | { ok: false; error: string };

/** Pure, synchronous, client-side pre-check (this ticket's own section
 * 16: reject invalid weekday/time/start>=end/cross-midnight, reusing
 * `validateAvailabilityPeriodInput` -- never a second, conflicting
 * validation contract) PLUS the Settings-specific overlap policy
 * (section 17), which `validateAvailabilityPeriodInput` itself has no
 * opinion on (it validates one period in isolation, never a pair). The
 * server (route.ts) re-runs the exact same two checks independently --
 * this function is a UX convenience, never the sole gate. */
export function validateWeekDraft(draft: WeekAvailabilityDraft): WeekDraftValidationResult {
  for (const day of draft) {
    for (const period of day.periods) {
      try {
        validateAvailabilityPeriodInput({ weekday: day.weekday, startTime: period.startTime, endTime: period.endTime });
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : 'Invalid period.' };
      }
    }
    const sorted = [...day.periods].sort((a, b) => (a.startTime < b.startTime ? -1 : a.startTime > b.startTime ? 1 : 0));
    for (let i = 0; i < sorted.length - 1; i += 1) {
      if (periodsOverlap(sorted[i], sorted[i + 1])) {
        return { ok: false, error: `${WEEKDAY_LABELS[day.weekday]} has two overlapping periods (${sorted[i].startTime}–${sorted[i].endTime} and ${sorted[i + 1].startTime}–${sorted[i + 1].endTime}).` };
      }
    }
  }
  return { ok: true };
}

/** Deterministic (weekday, then startTime, then endTime) flatten to the
 * exact wire shape the API PUT body/H1 storage expects (this ticket's
 * own section 18) -- draft-only `id` is dropped entirely; row insertion
 * order never affects this output. An entirely-empty week flattens to
 * `[]`, a valid, real payload (this ticket's own section 22), never
 * rejected by this function. */
export function flattenWeekDraft(draft: WeekAvailabilityDraft): AvailabilityPeriodInput[] {
  const flattened: AvailabilityPeriodInput[] = [];
  for (const day of draft) {
    for (const period of day.periods) flattened.push({ weekday: day.weekday, startTime: period.startTime, endTime: period.endTime });
  }
  return flattened.sort((a, b) => (a.weekday !== b.weekday ? a.weekday - b.weekday : a.startTime < b.startTime ? -1 : a.startTime > b.startTime ? 1 : a.endTime < b.endTime ? -1 : a.endTime > b.endTime ? 1 : 0));
}
