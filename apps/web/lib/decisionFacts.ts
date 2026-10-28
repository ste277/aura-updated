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
 * `targetPerPeriod` times per period, and here is where the count stands
 * for the recurrence period containing the preview's planning date."
 * That period is the one containing the planning date the preview was
 * requested for -- which is the week of the wall-clock present only when
 * the planning date is today. `period` is an explicit literal rather than an
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
  /** Occurrences already completed in the recurrence period containing
   * the planning date. */
  completedInPeriod: number;
  /** Occurrences currently scheduled (committed but not yet completed)
   * in the recurrence period containing the planning date. */
  committedInPeriod: number;
  /** Never negative. A bare count only: it cannot by itself distinguish
   * "many viable opportunities remain" from "this is the last one", so a
   * consumer must not treat it as deferral pressure. */
  remainingInPeriod: number;
}

/** Where a duration came from. `GENERIC_FALLBACK` means no stronger
 * signal existed (no explicit request, stored preference, behavioral
 * pattern or catalog default) and the generic planning duration was used,
 * so anything derived from that duration is weaker knowledge than a
 * `RESOLVED` one. A consumer must keep the two apart. */
export type OpportunityDurationBasis = 'RESOLVED' | 'GENERIC_FALLBACK';

export type OpportunityCoverage = 'COMPLETE' | 'PARTIAL' | 'UNKNOWN';

/** What is known about ONE civil day for ONE candidate. UNKNOWN is a
 * different thing from KNOWN_INFEASIBLE: availability could not be
 * established, so the day must never be read as "no opportunity". */
export type OpportunityDayState = 'KNOWN_FEASIBLE' | 'KNOWN_INFEASIBLE' | 'UNKNOWN';

/**
 * Supply facts: for ONE candidate with ONE duration, over an explicit
 * inclusive local civil-date horizon, how many days are known to offer a
 * contiguous opportunity and how much of the horizon is unknown. These
 * are the supply side; the recurrence facts above are the demand side, and
 * the two are deliberately independent -- nothing here repeats a target,
 * a completed count, a committed count or a remaining count, and no
 * difference between the two sides is stored.
 *
 * CANDIDATE-LOCAL: each candidate is evaluated against the user's
 * availability and persisted commitments on its own. Two candidates may
 * each report the same day as viable; this is feasibility for one
 * candidate, never an allocation of shared capacity.
 *
 * `viableDays` is a LOWER BOUND whenever `coverage` is not 'COMPLETE': the
 * true count lies within `[viableDays, viableDays + unknownDays]`.
 * 'UNKNOWN' coverage means every evaluated day is unknown -- it does NOT
 * mean there are no opportunities. A zero `viableDays` with 'COMPLETE'
 * coverage is a factual zero for the evaluated horizon, nothing more.
 *
 * `horizonStartDate` is the later of the planning date and the start of
 * the period the horizon belongs to, so days that elapsed before the
 * planning date are never counted. Both dates are inclusive local civil
 * dates ('YYYY-MM-DD').
 *
 * The horizon's FIRST day is reported apart from the days after it, because
 * a total cannot say whether a single viable day is the first day or a
 * later one. `startDateState` is the state of `horizonStartDate` (for
 * today it reflects only the time still remaining). `afterStart*` count the
 * civil dates strictly after `horizonStartDate` through `horizonEndDate`;
 * with the first day they partition the totals exactly:
 *   evaluatedDays = 1 + afterStartEvaluatedDays
 *   viableDays    = (startDateState is KNOWN_FEASIBLE ? 1 : 0) + afterStartViableDays
 *   unknownDays   = (startDateState is UNKNOWN ? 1 : 0) + afterStartUnknownDays
 * An empty set of later days is a KNOWN empty set (counts of zero), never
 * unknown. `horizonStartDate` equals the preview's planning date whenever
 * the horizon begins at it; a consumer that needs the planning date itself
 * must compare the two dates rather than assume they are equal. Unknown
 * later days are never converted to zero opportunity, and no count says
 * what any state or count means.
 *
 * `durationBasis` is required and must be kept with `durationMinutes`: it
 * is what lets a later consumer tell a fact built on a real duration from
 * one built on the generic planning fallback.
 *
 * FACTS ONLY. No classification, shortfall, deficit or pressure field
 * exists or may be added here.
 *
 * PREREQUISITES for any future policy that consumes these facts (they are
 * inert today): (1) they exist only where a provider attached recurrence
 * facts, so an equivalent request reaching the planner through a
 * different path carries none -- that asymmetry must be resolved first;
 * (2) a provider or load failure yields NO facts, so a missing fact must
 * have a defined degradation and may never create an advantage or a
 * disadvantage; (3) `durationBasis` and `coverage` must be honoured, as a
 * fallback duration or an unknown horizon is weaker knowledge.
 */
export interface OpportunityDecisionFacts {
  horizonStartDate: string;
  horizonEndDate: string;
  evaluatedDays: number;
  viableDays: number;
  unknownDays: number;
  coverage: OpportunityCoverage;
  durationMinutes: number;
  durationBasis: OpportunityDurationBasis;
  startDateState: OpportunityDayState;
  afterStartEvaluatedDays: number;
  afterStartViableDays: number;
  afterStartUnknownDays: number;
}

export interface DecisionFacts {
  recurrence?: RecurrenceDecisionFacts;
  opportunity?: OpportunityDecisionFacts;
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
