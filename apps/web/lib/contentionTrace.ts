/**
 * Constructor Decision Intelligence -- O5 P3a: the CONTENTION TRACE (data model and aggregation).
 *
 * WHAT HAPPENED, NOT WHAT SHOULD HAVE HAPPENED. A contention event records one historical scheduling fact observed
 * while the Day Constructor evaluated a candidate interval:
 *
 *   the LOSER attempted a concrete candidate interval that was otherwise individually usable (a valid candidate that
 *   fits its required duration inside the construction window and overlaps no external blocker), and that interval was
 *   rejected because it overlaps an interval ALREADY OWNED by a Proposed candidate (the WINNER) -- and that Proposed
 *   overlap is the reason the interval was rejected at that evaluation point.
 *
 * "WINNER" IS DESCRIPTIVE HISTORICAL OWNERSHIP ONLY. It means "the candidate that already held that interval when the
 * attempt was made". It does NOT mean the policy-approved, deserving, more important or more urgent candidate, and no
 * field of this model says so. The Constructor's existing greedy order (overload precedence, then placement ranking)
 * decides who owned an interval first; this trace never judges that and never changes it.
 *
 * NOT CONTENTION (never recorded): a candidate with no candidate intervals; an interval rejected by an external blocker
 * (an existing PlannedActivity or an availability gap) -- candidate-vs-blocker is not candidate-vs-candidate; an interval
 * outside the construction window or configured availability; a candidate too short for its duration; timing-quality
 * ranking; a capacity classification (BUSY / BALANCED / OPEN / OVERLOADED) on its own; and a final Deferred reason such as
 * NO_CANDIDATES, which never proves the ABSENCE of an earlier contention. Touching half-open intervals ([start, end))
 * do not conflict.
 *
 * PER ATTEMPTED INTERVAL, NOT PER OUTCOME. An event exists for each attempted interval that lost to an owner, whether or
 * not the loser was later placed elsewhere. A later stage (P3b) decides what a Deferred candidate's history means by
 * joining `loserIntentId` with the final outcome; this module does not infer outcomes.
 *
 * WHY A SEPARATE, ACCUMULATED TRACE. The orchestrator may run the Constructor more than once (bounded replenishment);
 * a later round can leave the loser with NO_CANDIDATES and so erase the earlier reason from the final Deferred item. The
 * trace is therefore collected where the conflict is observed (the placement gate) and accumulated across rounds.
 *
 * ROUND numbering is deterministic: 0 is the first Constructor pass; replenishment re-runs are 1, 2, ...
 *
 * SOURCE-NEUTRAL: Constructor identity only (intent ids and instants). No Goal, activity, manual/automatic, provenance,
 * title or user-facing field exists here. Instants are ISO-8601 UTC strings (immutable primitives), so a returned trace
 * cannot be used to mutate a Constructor input and cannot be mutated into another event.
 *
 * PURE and INTERNAL: no I/O, no clock, no environment, no logging, no async. It is not part of the public Day Constructor
 * contract, the signed preview, any persisted row or any user-facing surface. Nothing in production consumes it for
 * policy: it is read only by tests and diagnostics.
 *
 * ORTHOGONAL TO DECISION PRESSURE. ContentionTrace = what happened (a scheduling-mechanics fact). DecisionPressure = the
 * temporal cost of deferral (decision evidence). This module imports neither and reads no recurrence, opportunity or
 * evidence. A later slice (P3b) combines the two observations in shadow; an eventual active policy (P4) would use a typed
 * promotion input. Neither is implemented here.
 */

export interface ContentionEvent {
  /** The candidate whose attempted interval was rejected because of the owner. */
  readonly loserIntentId: string;
  /** The already-Proposed candidate that owned the overlapping interval. Descriptive ownership, never a policy judgment. */
  readonly winnerIntentId: string;
  /** The exact interval the loser attempted ([start, end), ISO-8601 UTC) -- not merely its requested day. */
  readonly attemptedStart: string;
  readonly attemptedEnd: string;
  /** The exact Proposed interval responsible for the overlap ([start, end), ISO-8601 UTC). */
  readonly winnerStart: string;
  readonly winnerEnd: string;
  /** 0 for the first Constructor pass, then 1, 2, ... for each replenishment re-run. */
  readonly round: number;
}

export interface ContentionTrace {
  /** Chronological: by round, then by the loser's evaluation order, then by attempted interval, then by owner placement order. */
  readonly events: readonly ContentionEvent[];
}

/**
 * One attempted-and-rejected interval together with EVERY Proposed owner whose interval overlaps it, recorded as a
 * fully DETACHED snapshot taken at the moment of observation: only strings and numbers (instants are ISO-8601 UTC
 * strings, which order chronologically as strings). It holds no Date, interval, candidate, Proposed item or any other
 * Constructor-owned object, so nothing a trace consumer does can reach Constructor state. Created only by the
 * Constructor's own internal collector; no exported API accepts one.
 */
export interface ContentionAttempt {
  /** The loser's position in the Constructor's own evaluation order (the chronology of placement attempts). */
  readonly evaluationIndex: number;
  readonly loserIntentId: string;
  readonly attemptedStart: string;
  readonly attemptedEnd: string;
  /** Overlapping Proposed intervals, in the order they were placed (construction chronology). Never empty. */
  readonly owners: readonly { readonly intentId: string; readonly start: string; readonly end: string }[];
}

export const EMPTY_CONTENTION_TRACE: ContentionTrace = Object.freeze({ events: Object.freeze([] as ContentionEvent[]) });

/** The identity of an event: the same loser, owner, attempted interval, owner interval and round is ONE event. */
export function contentionEventKey(event: ContentionEvent): string {
  return [event.round, event.loserIntentId, event.winnerIntentId, event.attemptedStart, event.attemptedEnd, event.winnerStart, event.winnerEnd].join('|');
}

/** ISO-8601 UTC instants of one format order chronologically as strings. */
const compareInstants = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Turns the attempts observed during ONE Constructor pass into immutable events, in a deterministic total order
 * (loser evaluation order, attempted start, attempted end, owner placement order). An interval that overlaps several
 * Proposed owners yields one event per owner (each genuinely held part of it); the same interval offered twice for one
 * loser yields one event. Pure.
 */
export function buildContentionEvents(round: number, attempts: readonly ContentionAttempt[]): ContentionEvent[] {
  const ordered = attempts
    .map((attempt, position) => ({ attempt, position }))
    .sort((a, b) =>
      a.attempt.evaluationIndex - b.attempt.evaluationIndex ||
      compareInstants(a.attempt.attemptedStart, b.attempt.attemptedStart) ||
      compareInstants(a.attempt.attemptedEnd, b.attempt.attemptedEnd) ||
      a.position - b.position
    );
  const events: ContentionEvent[] = [];
  const seen = new Set<string>();
  for (const { attempt } of ordered) {
    for (const owner of attempt.owners) {
      const event: ContentionEvent = Object.freeze({
        loserIntentId: attempt.loserIntentId,
        winnerIntentId: owner.intentId,
        attemptedStart: attempt.attemptedStart,
        attemptedEnd: attempt.attemptedEnd,
        winnerStart: owner.start,
        winnerEnd: owner.end,
        round,
      });
      const key = contentionEventKey(event);
      if (seen.has(key)) continue;
      seen.add(key);
      events.push(event);
    }
  }
  return events;
}

export function createContentionTrace(events: readonly ContentionEvent[]): ContentionTrace {
  return Object.freeze({ events: Object.freeze([...events]) });
}

/**
 * Accumulates the traces of successive Constructor passes (round order as supplied). History is only ever APPENDED: an
 * earlier round's events are never replaced, merged away or reinterpreted by a later round's outcome. An event identical
 * in every field, including the round, is kept once.
 */
export function aggregateContentionTraces(traces: readonly ContentionTrace[]): ContentionTrace {
  const events: ContentionEvent[] = [];
  const seen = new Set<string>();
  for (const trace of traces) {
    for (const event of trace.events) {
      const key = contentionEventKey(event);
      if (seen.has(key)) continue;
      seen.add(key);
      events.push(event);
    }
  }
  return createContentionTrace(events);
}
