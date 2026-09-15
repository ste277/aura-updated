/**
 * Day Constructor V1 -- PR A: pure capacity model.
 *
 * PURITY CONTRACT (this ticket's own section 11, enforced by what this
 * file imports -- there is nothing to grep for that would violate it):
 * no DB import, no fetch, no API call, no `runTimingSearch`, no
 * `evaluateMuhurta`, no server clock read (`new Date()` never appears
 * below), no `process.env`. Every instant this file ever reasons about
 * (a `ConstructionWindow.start/end`, a `BlockedInterval.start/end`) is an
 * explicit argument. The same inputs always produce the same output.
 *
 * SCOPE (this ticket's own section 13/14 "NO PLACEMENT"/"NO TIMING
 * ENGINE IN PURE CONSTRUCTOR"): this file answers ONLY "how much usable
 * time is there, and how full is it" -- never "which intent goes where."
 * It has no opinion on `DayIntent.activityId`/`activityFamily`/timing fit
 * at all; `computeCapacitySnapshot` below takes a single already-summed
 * `requestedMinutes` number, not a `DayIntent[]` -- keeping this module's
 * only real dependency on dayIntent.ts limited to
 * `sumConstructibleDurationMinutes` at the CALLER's own discretion, never
 * imported here. A future `dayConstructorOrchestrator.ts` (PR C) is
 * responsible for calling `runTimingSearch` to turn a `DayIntent` into
 * real candidate windows -- that call never happens inside this file or
 * any future pure `dayConstructor.ts` placement engine (architecture
 * audit's own correction, this ticket's section 14).
 *
 * "Elapsed portion of today" has NO dedicated field/function here by
 * design: a `ConstructionWindow` with `source: 'REMAINING_TODAY'`
 * already has `start === now` (the caller's own explicit `now` input,
 * see dayIntent.ts's own `ConstructionWindowSource` doc comment) --
 * anything before `window.start` is excluded simply because it is
 * outside the window, exactly like any other moment outside
 * `[window.start, window.end)`. Modeling "elapsed" as a second,
 * redundant blocked interval would double-represent the same fact.
 */

import type { ConstructionWindow } from './dayIntent';
import { validateConstructionWindow, type ConstructionWindowValidationError } from './dayIntent';

// ============================================================
// BlockedInterval
// ============================================================

/**
 * Where a block of otherwise-usable time came from. `'FIXED_PLAN'` is
 * the only real V1 source (an existing `PlannedActivity` with
 * `status === 'UPCOMING'`, the SAME row set Forward Planner's own
 * `filterConflictingCandidates`/`ForwardPlannerBlockingInterval`
 * already treats as an absolute filter -- apps/web/lib/forwardPlanner.ts
 * -- reused here as convention, not as an import: `BlockedInterval`
 * deliberately does NOT import `ForwardPlannerBlockingInterval`, since
 * capacity math is a more general domain than Forward Planner's single-
 * activity multi-day search, and the architecture audit's own section 18
 * calls for this exact shape to later admit non-Plan sources without any
 * Forward Planner coupling). `'EXTERNAL'` is reserved, unused in V1, for
 * a future MCP/calendar adapter (architecture audit section 18) -- no
 * adapter is implemented here.
 */
export type BlockedIntervalSource = 'FIXED_PLAN' | 'EXTERNAL';

/**
 * One normalized span of time the constructor may not place anything
 * into. `start`/`end` are absolute UTC instants, exactly like
 * `ConstructionWindow.start/end` -- this file never converts between
 * timezones; every instant it touches already IS one.
 */
export interface BlockedInterval {
  start: Date;
  end: Date;
  source: BlockedIntervalSource;
}

/** `aStart < bEnd && bStart < aEnd` -- the exact formula already
 * established by `packages/panchang/src/windows.ts`'s own
 * `intervalsOverlap` and reused verbatim by
 * `apps/web/lib/forwardPlanner.ts`'s own (private) `intervalsOverlap`;
 * reproduced here (not imported, to keep this file's own import list
 * free of any Forward-Planner-specific module) rather than reinvented.
 * Two intervals that merely touch at an endpoint are NOT overlapping by
 * this formula -- `mergeBlockedIntervals` below merges touching
 * intervals separately, for a different reason (avoiding an artificial
 * zero-length gap in the merged output), not because this formula
 * considers them to overlap. */
function intervalsOverlap(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart.getTime() < bEnd.getTime() && bStart.getTime() < aEnd.getTime();
}

/**
 * Clips one interval to `[windowStart, windowEnd]`, or returns `null`
 * when the interval does not overlap the window at all (fully before or
 * fully after it) -- never a negative-length or NaN result.
 */
function clipToWindow(start: Date, end: Date, windowStart: Date, windowEnd: Date): { start: Date; end: Date } | null {
  const clippedStart = start.getTime() > windowStart.getTime() ? start : windowStart;
  const clippedEnd = end.getTime() < windowEnd.getTime() ? end : windowEnd;
  if (clippedStart.getTime() >= clippedEnd.getTime()) return null;
  return { start: clippedStart, end: clippedEnd };
}

/**
 * Normalizes a raw list of blocked intervals against one construction
 * window: clips every interval to the window's own bounds (a block that
 * starts before the window or ends after it is trimmed to the part that
 * actually falls inside; a block entirely outside the window is
 * dropped), drops zero-length/empty-after-clip intervals, then merges
 * overlapping AND adjacent (touching-endpoint) survivors into the
 * smallest possible set of disjoint spans, sorted by start.
 *
 * Merging adjacent (not just overlapping) intervals is deliberate: two
 * blocks `[9:00,9:30)` and `[9:30,10:00)` represent one continuous
 * unavailable stretch, and reporting them as two separate spans would
 * invite a future caller to (incorrectly) treat the single instant
 * 9:30 as a placeable zero-width gap. The returned list is always the
 * minimal disjoint representation `computeBlockedMinutes` below sums
 * WITHOUT any risk of double-counting overlap -- by construction, no two
 * entries in the returned array can overlap or touch.
 */
export function normalizeBlockedIntervals(blockedIntervals: readonly BlockedInterval[], window: ConstructionWindow): BlockedInterval[] {
  const clipped = blockedIntervals
    .map((interval) => {
      const clippedRange = clipToWindow(interval.start, interval.end, window.start, window.end);
      return clippedRange ? { ...clippedRange, source: interval.source } : null;
    })
    .filter((interval): interval is BlockedInterval => interval !== null)
    .sort((a, b) => a.start.getTime() - b.start.getTime());

  const merged: BlockedInterval[] = [];
  for (const interval of clipped) {
    const last = merged[merged.length - 1];
    if (last && interval.start.getTime() <= last.end.getTime()) {
      // Overlapping or exactly touching `last` -- extend it rather than
      // appending a second entry. `source` of the merged span is kept as
      // `last`'s own source (the earliest contributor) -- provenance of a
      // merged span is inherently approximate once two blocks combine;
      // no consumer in V1 reads a merged interval's `source` for anything
      // beyond display, and none exists yet that would need per-segment
      // provenance preserved through a merge.
      if (interval.end.getTime() > last.end.getTime()) last.end = interval.end;
    } else {
      merged.push({ ...interval });
    }
  }
  return merged;
}

/** Sum of a normalized (already merged/disjoint) interval list's own
 * duration, in whole minutes. Callers should pass the OUTPUT of
 * `normalizeBlockedIntervals`, never a raw/unmerged list, or overlap
 * will be double-counted -- `computeCapacitySnapshot` below only ever
 * calls this on normalized output itself, never exposes a raw-list path. */
function sumIntervalMinutes(intervals: readonly BlockedInterval[]): number {
  return intervals.reduce((total, interval) => total + (interval.end.getTime() - interval.start.getTime()) / 60000, 0);
}

// ============================================================
// Capacity snapshot
// ============================================================

export type CapacityState = 'OPEN' | 'BALANCED' | 'BUSY' | 'OVERLOADED';

/**
 * Deterministic classification, exactly the LOCKED thresholds (this
 * ticket's own section 1/9):
 *
 *   OPEN      utilization <  0.40
 *   BALANCED  0.40 <= utilization <  0.75
 *   BUSY      0.75 <= utilization <= 1.00
 *   OVERLOADED  utilization >  1.00
 *
 * `utilization` here is ALWAYS a finite, non-negative number -- see
 * `computeCapacitySnapshot`'s own handling of the `usableMinutes === 0`
 * case, which never reaches this function with a non-finite value.
 * A capacity STATE is a descriptive output only (this ticket's own
 * section 1: "Do NOT use capacity-state labels themselves as scheduling
 * rules") -- nothing in this file or dayIntent.ts branches on
 * `CapacityState` to decide behavior; only `utilization`/`remainingMinutes`
 * are ever consulted for that by a future placement engine.
 */
export function classifyCapacityState(utilization: number): CapacityState {
  if (utilization > 1) return 'OVERLOADED';
  if (utilization >= 0.75) return 'BUSY';
  if (utilization >= 0.4) return 'BALANCED';
  return 'OPEN';
}

export interface CapacitySnapshot {
  /** Whole minutes between `window.start` and `window.end`. */
  constructionWindowMinutes: number;
  /** Whole minutes of `window` actually consumed by normalized blocked
   * intervals -- never more than `constructionWindowMinutes` (blocks are
   * clipped to the window before summing). */
  blockedMinutes: number;
  /** `constructionWindowMinutes - blockedMinutes`, floored at 0. This is
   * the utilization DENOMINATOR (this ticket's own section 7: "usable
   * capacity after fixed blocks" -- existing fixed commitments consume
   * the window but are never counted a second time as requested work). */
  usableMinutes: number;
  /** The caller's own already-summed constructible `DayIntent` minutes
   * (see dayIntent.ts's `sumConstructibleDurationMinutes`) -- copied
   * through verbatim, never recomputed here. */
  requestedMinutes: number;
  /** `usableMinutes - requestedMinutes` -- deliberately SIGNED (can go
   * negative under overload) so a caller can read "how far over" without
   * re-deriving it from `utilization`. */
  remainingMinutes: number;
  /** `requestedMinutes / usableMinutes`. Always a finite number in a
   * `'READY'` result (see `DayCapacityResult` below for the
   * `usableMinutes === 0` case, which never produces a `CapacitySnapshot`
   * at all, avoiding both a division by zero and a fabricated `Infinity`). */
  utilization: number;
  capacityState: CapacityState;
}

/**
 * Fail-closed domain results (this ticket's own section 10), as a
 * discriminated union rather than a thrown error or a stringly-typed
 * status field -- mirrors this repository's own established convention
 * for a multi-outcome pure result (e.g.
 * `apps/web/lib/forwardPlanner.ts`'s own `ForwardPlannerResult`:
 * `'READY' | 'NO_SUITABLE_WINDOW' | 'BIRTH_PROFILE_REQUIRED'`).
 *
 * REQUIRED INVARIANT (pre-commit review fix): `usableMinutes === 0`
 * ALWAYS produces `'NO_USABLE_CAPACITY'`, regardless of
 * `requestedMinutes` -- there is zero constructible capacity, so the
 * system fails closed rather than ever reporting `'READY'`. This is
 * deliberately true whether `requestedMinutes` is zero (nothing was
 * asked, and there is also no room) or positive (something was asked,
 * against zero room): in BOTH cases the utilization ratio has a zero
 * denominator and is mathematically undefined -- there is no honest
 * finite number to classify, so `classifyCapacityState` is never called
 * and no `CapacitySnapshot` is ever constructed for this case (a
 * `CapacitySnapshot.utilization` therefore can never be `Infinity`,
 * `NaN`, `Number.MAX_VALUE`, or any other manufactured sentinel -- the
 * type does not need to guard against those values because this
 * function never produces one). `requestedMinutes` is preserved
 * alongside `constructionWindowMinutes`/`blockedMinutes` on the failure
 * result itself, purely as factual context for a caller (e.g. to phrase
 * "you asked for 45 minutes but the day is fully booked") -- never as
 * an input to a fabricated ratio.
 */
export type DayCapacityResult =
  | { status: 'READY'; snapshot: CapacitySnapshot }
  | { status: 'NO_USABLE_CAPACITY'; constructionWindowMinutes: number; blockedMinutes: number; requestedMinutes: number }
  | { status: 'INVALID_CONSTRUCTION_WINDOW'; error: ConstructionWindowValidationError }
  | { status: 'TIMEZONE_MISSING' };

/**
 * The single pure entry point this file exposes for capacity math.
 * `blockedIntervals` is expected to be the RAW (not yet normalized) list
 * -- this function calls `normalizeBlockedIntervals` itself exactly once,
 * so a caller never has to remember to normalize first (and cannot
 * accidentally double-normalize).
 */
export function computeCapacitySnapshot(window: ConstructionWindow, blockedIntervals: readonly BlockedInterval[], requestedMinutes: number): DayCapacityResult {
  const windowError = validateConstructionWindow(window);
  if (windowError) {
    return windowError.code === 'TIMEZONE_MISSING' ? { status: 'TIMEZONE_MISSING' } : { status: 'INVALID_CONSTRUCTION_WINDOW', error: windowError };
  }
  if (!Number.isFinite(requestedMinutes) || requestedMinutes < 0) {
    throw new Error(`requestedMinutes must be a non-negative finite number, got: ${requestedMinutes}.`);
  }

  const constructionWindowMinutes = (window.end.getTime() - window.start.getTime()) / 60000;
  const normalized = normalizeBlockedIntervals(blockedIntervals, window);
  const blockedMinutes = Math.min(sumIntervalMinutes(normalized), constructionWindowMinutes);
  const usableMinutes = Math.max(constructionWindowMinutes - blockedMinutes, 0);

  // REQUIRED INVARIANT (pre-commit review fix): zero usable capacity
  // ALWAYS fails closed to NO_USABLE_CAPACITY, regardless of
  // requestedMinutes -- see DayCapacityResult's own doc comment. No
  // CapacitySnapshot/utilization value is ever constructed for this
  // case; classifyCapacityState is never reached with a zero
  // denominator.
  if (usableMinutes === 0) {
    return { status: 'NO_USABLE_CAPACITY', constructionWindowMinutes, blockedMinutes, requestedMinutes };
  }

  const utilization = requestedMinutes / usableMinutes;
  const snapshot: CapacitySnapshot = {
    constructionWindowMinutes,
    blockedMinutes,
    usableMinutes,
    requestedMinutes,
    remainingMinutes: usableMinutes - requestedMinutes,
    utilization,
    capacityState: classifyCapacityState(utilization),
  };
  return { status: 'READY', snapshot };
}
