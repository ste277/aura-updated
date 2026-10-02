/**
 * Constructor Decision Intelligence -- Decision Facts V1.
 *
 * The one generic, source-neutral contract a candidate source may attach
 * to a `DayIntent` so a FUTURE decision policy can reason about it.
 * Never consumed by any placement/precedence/eligibility logic in V1 --
 * carried purely as inert metadata.
 *
 * FACTS, NOT POLICY: every field is a plain, canonically-computed factual
 * input. There is deliberately no priority/score/rank/weight/boost field
 * on this type; any derived value belongs to a future policy layer that
 * CONSUMES these facts.
 *
 * SOURCE-NEUTRAL: this module has no imports at all and knows nothing
 * about any candidate source, intent-id scheme, or storage. Source-
 * specific code (upstream of the Constructor stack) is responsible for
 * extracting facts and translating them into these shapes, keyed by the
 * intent id it already knows.
 */

/**
 * A fixed-period recurrence fact: "this activity is meant to recur
 * `targetPerPeriod` times per period, and here is where the current
 * period's count stands." `period` is an explicit literal rather than an
 * implied unit so the semantics are never silently reinterpreted:
 * 'LOCAL_CALENDAR_WEEK' means a Monday-start week in the user's local
 * timezone, with counts that never carry over between weeks. Any other
 * period kind must be added as a new literal with its own documented
 * semantics, never folded into this one.
 *
 * `periodStartDate` / `periodEndDate` are the period's own extent as
 * local civil dates ('YYYY-MM-DD', both INCLUSIVE -- the end is the
 * period's last day, never the first day of the next period). They are
 * calendar labels, not instants: they carry no timezone offset and never
 * change length with a clock change. They are resolved by the provider,
 * for the very period the counts below are taken over; this module only
 * carries them and never computes them.
 */
export interface RecurrenceDecisionFacts {
  period: 'LOCAL_CALENDAR_WEEK';
  periodStartDate: string;
  periodEndDate: string;
  targetPerPeriod: number;
  /** Occurrences already completed in the current period. */
  completedInPeriod: number;
  /** Occurrences currently scheduled (committed but not yet completed)
   * in the current period. */
  committedInPeriod: number;
  /** Never negative. A bare count only: it cannot by itself distinguish
   * "many viable opportunities remain" from "this is the last one", so a
   * consumer must not treat it as deferral pressure. */
  remainingInPeriod: number;
}

export interface DecisionFacts {
  recurrence?: RecurrenceDecisionFacts;
}

/** Generic transport shape: facts already resolved by a source-specific
 * provider, keyed by the caller's own intent id. */
export type DecisionFactsByIntentId = ReadonlyMap<string, DecisionFacts>;

/**
 * Pure lookup -- the V1 policy seam. No decoding of ids, no I/O, no
 * ranking; returns the facts a provider already associated with this
 * intent id, or `undefined`.
 */
export function resolveDecisionFactsForIntent(intentId: string, factsByIntentId: DecisionFactsByIntentId | undefined): DecisionFacts | undefined {
  return factsByIntentId?.get(intentId);
}
