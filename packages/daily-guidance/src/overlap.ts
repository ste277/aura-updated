/**
 * Daily Guidance Composer V1 -- temporal overlap.
 *
 * STRICT interval overlap only -- deliberately NOT
 * packages/recommendation/src/dailyAssistant.ts's own
 * selectDiversePlanningOptions() 90-minute clock-time-proximity buffer.
 * That buffer solves a DIFFERENT problem (perceived variety across ONE
 * activity's own multi-day/multi-time candidates); this package's own
 * problem is "can the user physically do both", which is a real interval
 * conflict, not a proximity heuristic. Adjacent windows (end of one ==
 * start of the next) do NOT overlap under this definition -- see
 * README.md's "Exact overlap rule" section.
 */

/** `true` iff the two [start, end) instants genuinely overlap. Compares ISO instant strings directly via `Date` parsing -- both inputs are already-materialized, already-validated timestamps from upstream `RankedTimingWindow`s (validation.ts has already confirmed they're non-empty strings), never re-interpreted in any timezone. */
export function windowsOverlap(a: { start: string; end: string }, b: { start: string; end: string }): boolean {
  const startA = new Date(a.start).getTime();
  const endA = new Date(a.end).getTime();
  const startB = new Date(b.start).getTime();
  const endB = new Date(b.end).getTime();
  return startA < endB && startB < endA;
}
