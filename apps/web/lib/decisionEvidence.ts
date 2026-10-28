/**
 * Constructor Decision Intelligence -- O5 P2a: immutable DecisionEvidence.
 *
 * TWO DIFFERENT THINGS, kept apart on purpose:
 *
 *   DecisionFacts     (decisionFacts.ts) -- the facts carried through the
 *                     existing planning / preview-result contracts. A
 *                     transport and presentation shape: a provider builds
 *                     it, the preparation stage merges onto it, the preview
 *                     exposes it. Its nested objects are owned by whoever
 *                     built them and are not copied on the way through.
 *   DecisionEvidence  (this module) -- the immutable, server-derived
 *                     authority prepared for ONE planning evaluation, which
 *                     a future decision policy may consume. It OWNS every
 *                     value it holds: each nested object is copied by value
 *                     at construction and then frozen, so nothing a
 *                     provider, a request, a resolved intent or another
 *                     candidate's evidence does afterwards can change it.
 *
 * INFRASTRUCTURE ONLY. Nothing consumes evidence yet: it is built once at
 * the preparation stage (decisionFactPreparation.ts), kept out of the
 * Constructor input, and read by no precedence, placement, capacity or
 * replenishment logic. It carries no pressure, priority, score, ranking or
 * policy concept, and it contains exactly the facts the preparation stage
 * already holds -- nothing is derived, interpreted or fabricated here.
 *
 * SOURCE-NEUTRAL and PURE: it takes a facts object and nothing else (no
 * intent id, no source, no clock), performs no I/O and has no runtime
 * imports. Identical facts always give structurally identical evidence.
 * ABSENCE STAYS ABSENCE: a category the facts do not carry is not
 * evidence (never a zero or an UNKNOWN invented to fill it), and facts
 * carrying no category yield no evidence at all.
 *
 * NOT A SNAPSHOT OF THE DATABASE: immutability starts once evidence is
 * built. It says nothing about whether the underlying reads came from one
 * coherent database snapshot; that is separate work.
 */

import type { DecisionFacts, OpportunityDecisionFacts, RecurrenceDecisionFacts } from './decisionFacts';

/** The recurrence evidence: exactly the seven `RecurrenceDecisionFacts` fields, copied by value. */
export type RecurrenceEvidence = Readonly<RecurrenceDecisionFacts>;

/** The opportunity evidence: exactly the twelve `OpportunityDecisionFacts` fields, copied by value. */
export type OpportunityEvidence = Readonly<OpportunityDecisionFacts>;

export interface DecisionEvidence {
  readonly recurrence?: RecurrenceEvidence;
  readonly opportunity?: OpportunityEvidence;
}

/** Evidence keyed by the server-owned intent id; an intent with no evidence is simply absent. */
export type DecisionEvidenceByIntentId = ReadonlyMap<string, DecisionEvidence>;

function copyRecurrence(source: RecurrenceDecisionFacts): RecurrenceEvidence {
  return Object.freeze({
    period: source.period,
    periodStartDate: source.periodStartDate,
    periodEndDate: source.periodEndDate,
    targetPerPeriod: source.targetPerPeriod,
    completedInPeriod: source.completedInPeriod,
    committedInPeriod: source.committedInPeriod,
    remainingInPeriod: source.remainingInPeriod,
  });
}

function copyOpportunity(source: OpportunityDecisionFacts): OpportunityEvidence {
  return Object.freeze({
    horizonStartDate: source.horizonStartDate,
    horizonEndDate: source.horizonEndDate,
    evaluatedDays: source.evaluatedDays,
    viableDays: source.viableDays,
    unknownDays: source.unknownDays,
    coverage: source.coverage,
    durationMinutes: source.durationMinutes,
    durationBasis: source.durationBasis,
    startDateState: source.startDateState,
    afterStartEvaluatedDays: source.afterStartEvaluatedDays,
    afterStartViableDays: source.afterStartViableDays,
    afterStartUnknownDays: source.afterStartUnknownDays,
  });
}

/**
 * Builds the immutable evidence for ONE candidate from the facts already
 * prepared for it. Returns `undefined` when the facts carry no evidence
 * category. Every nested object is a fresh frozen copy; no reference to the
 * input (or to anything inside it) survives.
 */
export function buildDecisionEvidence(facts: DecisionFacts | undefined): DecisionEvidence | undefined {
  if (!facts) return undefined;
  const recurrence = facts.recurrence ? copyRecurrence(facts.recurrence) : undefined;
  const opportunity = facts.opportunity ? copyOpportunity(facts.opportunity) : undefined;
  if (!recurrence && !opportunity) return undefined;
  return Object.freeze({
    ...(recurrence ? { recurrence } : {}),
    ...(opportunity ? { opportunity } : {}),
  });
}
