/**
 * Day Constructor V1 -- PR A: domain contracts.
 *
 * `DayIntent` is a NEW domain concept, not decomposable from any existing
 * type. Repository audit findings this file is built from (see the
 * architecture audit's own item 5/6):
 *
 *  - `PlannedActivity` (apps/web/lib/db.ts) has no flexibility field and
 *    no deadline/importance field -- a `DayIntent` never assumes either
 *    exists on the eventual Plan it may produce; it carries its own.
 *  - There is no deadline/urgency representation anywhere in the schema
 *    today (confirmed across `db.ts`, `activityPreferences.ts`,
 *    `dayBuilder.ts`). `importance`/`deadline` below are genuinely new,
 *    and are deliberately kept structurally separate from
 *    `DailyGuidanceRecommendation.personalRelevance`/`timing.label`
 *    (packages/personal-intelligence/src/context.ts) -- USER INTENT
 *    PRIORITY (this file) must never be conflated with TIMING/
 *    RECOMMENDATION QUALITY (the existing engines). The overload
 *    precedence this file's own domain supports (see dayCapacity.ts) is
 *    driven exclusively by fields on THIS type; nothing here reads or is
 *    read by `AuraFitEvaluation`/`TimingCandidate`.
 *  - `activityId` reuses the SAME optional, "explicit, never guessed"
 *    convention already established by `PlannedActivity.activityId` and
 *    `HabitLogRow.activityId` (see db.ts's own doc comments on Planned
 *    Activity/HabitLog Canonical Identity Propagation) -- resolution
 *    (via `findActivityIntent`/`classifyTask`,
 *    packages/recommendation/src/{personalizedTasks,dailyAssistant}.ts)
 *    is an ORCHESTRATION concern (future PR C), never performed here.
 *
 * PURE, presentation-independent: no React types, no `HomeTimelineItem`
 * shape reused merely because a field happens to look similar (per the
 * audit's own explicit instruction not to couple new domain contracts to
 * presentation types).
 */

import { isValidCalendarDateString } from '../../../packages/panchang/src/localDate';
import type { MuhurtaActivityFamily } from '../../../packages/muhurta/src/muhurtaEngine';

// ============================================================
// DayIntent
// ============================================================

/** USER-PROVIDED (optional, defaults to MEDIUM) or DEFAULTED. Deliberately
 * NOT reused from any existing enum: `UserPriorityGroup` (dayBuilder.ts)
 * is a taste/category preference, `AuraFitLabel`/`personalRelevance` are
 * timing-quality, and neither represents "how urgent is this task to me
 * today" -- see this file's own module doc comment. */
export type DayIntentImportance = 'HIGH' | 'MEDIUM' | 'LOW';

/** USER-PROVIDED or DEFAULTED (to FLEXIBLE). `PlannedActivity` has no
 * equivalent field (confirmed via repository audit) -- this is new. */
export type DayIntentFlexibility = 'FIXED' | 'FLEXIBLE';

/** ENGINE-DERIVED. `USER_TYPED` is the only V1 value. Deliberately an
 * extensible string union (not a single literal type) so a future
 * `EXTERNAL_MCP`/`LLM_DECOMPOSED` source can be added without changing
 * every existing `DayIntent` construction site -- this does NOT build
 * MCP/LLM support now (architecture audit section 18/19), it only avoids
 * a breaking rename later. */
export type DayIntentSource = 'USER_TYPED';

/**
 * One user-declared outcome/activity Aura should try to place into a day.
 * `id`/`originalOrder` are ENGINE-DERIVED (assigned once, at creation,
 * never recomputed); `title`/`targetDate`/`deadline`/`importance` are
 * USER-PROVIDED (or DEFAULTED per this type's own field doc comments);
 * `activityId`/`activityFamily`/`estimatedDurationMinutes` are INFERRED
 * by a future resolution step (PR C's orchestrator) -- this file performs
 * NO inference of its own, it only defines the shape those fields land
 * in. `flexibility === 'FIXED'` is used by the future placement engine
 * (PR B) purely as an overload-precedence signal (see dayCapacity.ts's
 * own `OVERLOAD_PRECEDENCE_ORDER` doc comment) -- it is NEVER a promise
 * that Aura has already scheduled this intent; only a real
 * `PlannedActivity` row is ever an actual commitment.
 *
 * Deliberately excludes `decomposable` (architecture audit section 7:
 * V1 requires an already-actionable intent; decomposition is explicitly
 * deferred, so a field for it here would be dead weight with no reader).
 */
export interface DayIntent {
  id: string;
  title: string;
  /** Local calendar date (YYYY-MM-DD) this intent should be placed on --
   * the SAME `dateStr` convention `apps/web/lib/timezone.ts`'s own
   * `getDatePartsInTimezone`/`addDaysToDateStr` already use throughout
   * the repository (Forward Planner, Daily Agenda), never a raw `Date`
   * or a server-local calendar day. */
  targetDate: string;
  /** USER-PROVIDED, optional. Same `dateStr` convention as `targetDate`.
   * A missing deadline is not "no urgency" -- it is "the user did not
   * state one"; `importance` is the only signal a caller may treat as an
   * urgency proxy when `deadline` is absent. */
  deadline?: string;
  /** DEFAULTED to `'MEDIUM'` by `buildDayIntent` below when the caller
   * omits it -- never silently defaulted to `'LOW'` or `'HIGH'`, both of
   * which are genuine user statements this file must never guess. */
  importance: DayIntentImportance;
  /** INFERRED. A real, already-validated `FULL_ACTIVITY_CATALOG` id
   * (packages/recommendation/src/personalizedTasks.ts), or `undefined`
   * when no catalog entry was resolved -- never a guessed/fabricated id.
   * This file never calls `findActivityIntent`/`getActivityProfileById`
   * itself; resolution is an orchestration concern. */
  activityId?: string;
  /** INFERRED, from `activityId` (via `familyForActivityProfile`) or a
   * fallback classifier (`classifyTask`) when no catalog id resolved.
   * Reused directly from `packages/muhurta/src/muhurtaEngine.ts` --a
   * real engine type, not a presentation type, so importing it here does
   * not violate the "don't couple to presentation types" rule the
   * architecture audit called out. */
  activityFamily?: MuhurtaActivityFamily;
  /** INFERRED via the SAME existing precedence chain
   * `dayBuilderOrchestrator.ts`'s own `durationMinutesFor` already
   * implements (explicit preference -> behavioral typical duration ->
   * catalog default -> catalog suggested -> 45min) -- this file does not
   * reimplement that chain, it only defines where its result is carried.
   * `undefined` means DURATION_UNKNOWN for this specific intent (see
   * `sumConstructibleDurationMinutes` below for how that is surfaced to
   * a caller, never silently treated as zero). */
  estimatedDurationMinutes?: number;
  /** DEFAULTED to `'FLEXIBLE'` by `buildDayIntent` below when omitted. */
  flexibility: DayIntentFlexibility;
  source: DayIntentSource;
  /** ENGINE-DERIVED: 0-based position in the order the caller supplied
   * this intent, alongside any sibling intents constructed in the same
   * batch. The ONLY tiebreaker in the overload precedence order (see
   * dayCapacity.ts) once fixed/deadline/importance are exhausted --
   * never re-derived from `title`/`id`, which carry no ordering meaning
   * of their own. */
  originalOrder: number;
}

/** Caller-supplied subset used to build a `DayIntent` -- every DEFAULTED/
 * ENGINE-DERIVED field is intentionally absent from this input shape, so
 * a caller cannot accidentally supply its own `id`/`originalOrder` and
 * bypass `buildDayIntent`'s own assignment of them. */
export type DayIntentInput = Pick<DayIntent, 'title' | 'targetDate'> &
  Partial<Pick<DayIntent, 'deadline' | 'importance' | 'activityId' | 'activityFamily' | 'estimatedDurationMinutes' | 'flexibility' | 'source'>>;

const DEFAULT_IMPORTANCE: DayIntentImportance = 'MEDIUM';
const DEFAULT_FLEXIBILITY: DayIntentFlexibility = 'FLEXIBLE';
const DEFAULT_SOURCE: DayIntentSource = 'USER_TYPED';

/** Pure validation, mirroring `apps/web/lib/activityPreferences.ts`'s own
 * `validateActivityId`/`validatePreferredDurationMinutes` convention:
 * REJECTS (throws), never silently coerces or clamps. */
export function validateDayIntentDateStr(value: string, fieldLabel: string): string {
  if (!isValidCalendarDateString(value)) {
    throw new Error(`${fieldLabel} must be a valid YYYY-MM-DD calendar date, got: "${value}".`);
  }
  return value;
}

/** REJECTS a non-positive/non-finite/non-integer duration -- mirrors
 * `validatePreferredDurationMinutes`'s own bounds discipline. `undefined`
 * (DURATION_UNKNOWN) is a separate, valid state and is not rejected --
 * this function is only called when a caller supplies a concrete value. */
export function validateEstimatedDurationMinutes(minutes: number): number {
  if (!Number.isInteger(minutes) || minutes <= 0 || minutes > 24 * 60) {
    throw new Error(`estimatedDurationMinutes must be a positive integer number of minutes (at most 1440), got: ${minutes}.`);
  }
  return minutes;
}

let dayIntentIdCounter = 0;

/** Deterministic-enough id generator for a single construction batch --
 * NOT a global uniqueness guarantee across processes/time (this file has
 * no DB, no UUID dependency by design -- see this module's own purity
 * contract). A future orchestration layer (PR C) that persists a
 * `DayIntent` is responsible for assigning a real, globally-unique id at
 * that boundary, exactly as `createPlannedActivity` already does with
 * `randomUUID()` (apps/web/lib/db.ts) for the Plan it eventually becomes. */
function nextDayIntentId(): string {
  dayIntentIdCounter += 1;
  return `intent-${dayIntentIdCounter}`;
}

/**
 * Builds one validated `DayIntent`, applying every DEFAULTED field's own
 * documented default. `originalOrder` is always exactly the caller's own
 * `batchIndex` argument -- never inferred from array position implicitly,
 * so a caller re-ordering/filtering a list before calling this function
 * cannot accidentally scramble the original user-entered order this
 * value exists to preserve (see dayCapacity.ts's overload precedence).
 */
export function buildDayIntent(input: DayIntentInput, batchIndex: number): DayIntent {
  if (!input.title.trim()) throw new Error('DayIntent.title must not be empty.');
  if (!Number.isInteger(batchIndex) || batchIndex < 0) throw new Error(`batchIndex must be a non-negative integer, got: ${batchIndex}.`);

  const targetDate = validateDayIntentDateStr(input.targetDate, 'DayIntent.targetDate');
  const deadline = input.deadline !== undefined ? validateDayIntentDateStr(input.deadline, 'DayIntent.deadline') : undefined;
  const estimatedDurationMinutes = input.estimatedDurationMinutes !== undefined ? validateEstimatedDurationMinutes(input.estimatedDurationMinutes) : undefined;

  return {
    id: nextDayIntentId(),
    title: input.title.trim(),
    targetDate,
    deadline,
    importance: input.importance ?? DEFAULT_IMPORTANCE,
    activityId: input.activityId,
    activityFamily: input.activityFamily,
    estimatedDurationMinutes,
    flexibility: input.flexibility ?? DEFAULT_FLEXIBILITY,
    source: input.source ?? DEFAULT_SOURCE,
    originalOrder: batchIndex,
  };
}

/**
 * Splits a batch of intents into those with a known, usable duration and
 * those without one (DURATION_UNKNOWN) -- deliberately a per-intent
 * result, never a single all-or-nothing failure for the whole batch: one
 * intent with an unresolved duration must not block capacity math for
 * every other intent that DOES have one. A caller (future PR B/C) decides
 * what to do with `unknownDurationIntentIds` (e.g. surface them for the
 * user to supply a duration before construction proceeds) -- this
 * function only reports the fact, it never guesses a fallback minute
 * value itself (that guessing, when appropriate, is `durationMinutesFor`'s
 * own existing job -- dayBuilderOrchestrator.ts -- run upstream during
 * intent resolution, before a `DayIntent` with a truly unknown duration
 * would even reach this function).
 */
export function sumConstructibleDurationMinutes(intents: readonly DayIntent[]): { totalMinutes: number; unknownDurationIntentIds: string[] } {
  let totalMinutes = 0;
  const unknownDurationIntentIds: string[] = [];
  for (const intent of intents) {
    if (intent.estimatedDurationMinutes === undefined) {
      unknownDurationIntentIds.push(intent.id);
      continue;
    }
    totalMinutes += intent.estimatedDurationMinutes;
  }
  return { totalMinutes, unknownDurationIntentIds };
}

// ============================================================
// ConstructionWindow
// ============================================================

/**
 * Honest about where a `ConstructionWindow`'s bounds came from -- the
 * architecture audit's own explicit rule ("the constructor must never
 * pretend that an application default represents known user
 * availability") means this file introduces NO `'DEFAULT_WORKING_HOURS'`
 * or `'DEFAULT_SLEEP_SCHEDULE'` source value. Only two honest sources
 * exist in V1:
 *
 *  - `'REMAINING_TODAY'`: the window's own `start` IS `now` (an explicit
 *    input the caller supplies -- see this file's purity contract) --
 *    elapsed time before `now` is excluded by construction, never
 *    subtracted separately as a blocked interval (see dayCapacity.ts's
 *    own module doc comment on why "elapsed" has no dedicated field).
 *  - `'EXPLICIT_RANGE'`: the caller (a future UI/API layer) supplied an
 *    explicit start/end with no ambiguity -- e.g. a user-entered "9am to
 *    6pm" range. Still never inferred.
 */
export type ConstructionWindowSource = 'REMAINING_TODAY' | 'EXPLICIT_RANGE';

/**
 * The interval Aura is allowed to place `DayIntent`s inside. `start`/`end`
 * are absolute UTC instants (real `Date` values, already resolved against
 * `timezone` by the caller via `apps/web/lib/timezone.ts`'s own
 * `localDateTimeToUTC`/current-instant read) -- this module never derives
 * a UTC instant from `date`+`timezone` itself, and never reads a server-
 * local clock (see purity contract below). `date`/`timezone` are kept for
 * reference/audit only (e.g. an explanation surface later wanting to say
 * "your Sep 16 window in Asia/Kolkata") -- `computeCapacitySnapshot`
 * (dayCapacity.ts) never re-derives `start`/`end` from them.
 */
export interface ConstructionWindow {
  /** Local calendar date (YYYY-MM-DD) this window was defined for. */
  date: string;
  /** Absolute UTC instant the window opens. */
  start: Date;
  /** Absolute UTC instant the window closes. Must be strictly after `start`. */
  end: Date;
  /** IANA timezone `date` (and, for an `'EXPLICIT_RANGE'` window, the
   * clock times that produced `start`/`end`) were resolved against.
   * Required -- never optional, never defaulted to a server zone. */
  timezone: string;
  source: ConstructionWindowSource;
}

// ============================================================
// Overload precedence (LOCKED product decision, architecture audit /
// this ticket's own section 1) -- a pure ranking utility only. This file
// NEVER decides what actually gets deferred/placed (see dayCapacity.ts's
// own module doc comment on why that stays a PR B concern) -- it only
// gives a future placement engine one canonical, tested ordering to
// consult, so the precedence rule is defined exactly once rather than
// re-derived per caller.
// ============================================================

/**
 * The LOCKED precedence order, exactly as specified (this ticket's own
 * section 1 "Overload precedence"), reproduced here as a doc comment so
 * the implementation below can be checked against it line by line:
 *
 *   1. existing fixed commitments   -- real Plans/BlockedIntervals, never
 *                                       DayIntents; out of scope for this
 *                                       comparator (they are never
 *                                       candidates for deferral at all).
 *   2. deadline today               -- intent.deadline === today
 *   3. HIGH importance
 *   4. MEDIUM importance
 *   5. LOW importance
 *   6. earlier deadline             -- ascending, among same importance
 *   7. original user-entered order  -- final tiebreak, ascending
 *
 * Deliberately does NOT read `flexibility` -- the locked list above never
 * mentions it, and inventing a rank for it here would be exactly the kind
 * of unrequested behavior this ticket's "do not blindly accept fields"
 * instruction warns against. `flexibility` still exists on `DayIntent`
 * (it governs HOW an intent may be placed -- a future PR B placement
 * concern) but plays no role in WHICH intent is deferred under overload.
 *
 * Timing/Muhurta quality (`AuraFitLabel`/`TimingCandidate.score`) is
 * structurally unreachable from this function -- it takes no such value
 * as input, by construction, not merely by convention. This is the
 * literal enforcement of this ticket's "Timing/Muhurta quality MUST NOT
 * determine which intent is deferred" rule.
 */
const IMPORTANCE_RANK: Record<DayIntentImportance, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };

/** Higher-precedence intents sort FIRST (index 0 = preserved before
 * anything after it under overload). `today` is an explicit input (the
 * caller's own already-resolved local `dateStr`, e.g. from
 * `getDatePartsInTimezone`) -- this function never reads a clock. */
export function compareByOverloadPrecedence(a: DayIntent, b: DayIntent, today: string): number {
  const aDeadlineToday = a.deadline === today;
  const bDeadlineToday = b.deadline === today;
  if (aDeadlineToday !== bDeadlineToday) return aDeadlineToday ? -1 : 1;

  const importanceDelta = IMPORTANCE_RANK[a.importance] - IMPORTANCE_RANK[b.importance];
  if (importanceDelta !== 0) return importanceDelta;

  const aHasDeadline = a.deadline !== undefined;
  const bHasDeadline = b.deadline !== undefined;
  if (aHasDeadline !== bHasDeadline) return aHasDeadline ? -1 : 1;
  if (aHasDeadline && bHasDeadline && a.deadline !== b.deadline) return a.deadline! < b.deadline! ? -1 : 1;

  return a.originalOrder - b.originalOrder;
}

/** Sorted copy (never mutates `intents`), highest precedence first --
 * i.e. the order a placement engine should attempt/preserve intents in
 * under overload. Pure convenience wrapper around
 * `compareByOverloadPrecedence` for callers that want a ready-made list
 * rather than a raw comparator. */
export function sortByOverloadPrecedence(intents: readonly DayIntent[], today: string): DayIntent[] {
  return [...intents].sort((a, b) => compareByOverloadPrecedence(a, b, today));
}

export type ConstructionWindowValidationError =
  | { code: 'TIMEZONE_MISSING' }
  | { code: 'INVALID_DATE'; reason: string }
  | { code: 'INVALID_RANGE'; reason: string };

/**
 * Pure structural validation only -- never persisted (per the architecture
 * audit's own instruction), never invents a substitute value on failure.
 * Returns `null` when `window` is structurally valid.
 */
export function validateConstructionWindow(window: ConstructionWindow): ConstructionWindowValidationError | null {
  if (!window.timezone || !window.timezone.trim()) return { code: 'TIMEZONE_MISSING' };
  if (!isValidCalendarDateString(window.date)) return { code: 'INVALID_DATE', reason: `date must be a valid YYYY-MM-DD calendar date, got: "${window.date}".` };
  if (!(window.start instanceof Date) || Number.isNaN(window.start.getTime())) return { code: 'INVALID_RANGE', reason: 'start is not a valid Date.' };
  if (!(window.end instanceof Date) || Number.isNaN(window.end.getTime())) return { code: 'INVALID_RANGE', reason: 'end is not a valid Date.' };
  if (window.start.getTime() >= window.end.getTime()) return { code: 'INVALID_RANGE', reason: 'start must be strictly before end.' };
  return null;
}
