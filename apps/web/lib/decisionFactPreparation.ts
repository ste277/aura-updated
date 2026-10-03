/**
 * Constructor Decision Intelligence -- O5 P1: pre-Constructor decision
 * fact PREPARATION.
 *
 * Moves the preparation of trusted decision facts to a generic stage that
 * runs BEFORE `constructDay`, so a future decision policy can have them
 * available at selection time. This slice changes fact AVAILABILITY only:
 *
 *   PREPARED before the Constructor  !=  CONSUMED by the Constructor.
 *
 * Nothing here reads, ranks, compares or interprets a fact. The prepared
 * facts are kept OUTSIDE the minimal Constructor input (the orchestrator
 * builds the `constructDay` intents from the intents as they were before
 * preparation) and are attached to the preview's resolved-intent metadata
 * only AFTER construction, exactly as the one prepared object -- never
 * recomputed.
 *
 * Ownership is unchanged and not duplicated here:
 *   - O3: recurrence period bounds come from the facts a provider already
 *     attached (read only through `deriveOpportunityHorizon`).
 *   - O2: the one availability/blocker range load.
 *   - O1: the one candidate-local day-state projection.
 *   - this module: orchestration of the above for a set of candidates,
 *     fail-open isolation, and merging the result into the existing facts.
 *
 * GENERIC: it knows intent ids, a duration and a facts object. It does not
 * know what produced a fact or why one exists, and it carries no ranking,
 * classification or reason concept.
 *
 * FAILURE: preparation failure never fails a preview. The previous O4
 * stage was fail-open after construction; moving it earlier must not make
 * construction depend on it, so a failure here resolves to "no prepared
 * facts" and construction proceeds exactly as it would without them.
 */

import type { DecisionFacts } from './decisionFacts';
import { buildDecisionEvidence, type DecisionEvidence, type DecisionEvidenceByIntentId } from './decisionEvidence';
import { computeOpportunityDecisionFacts, type OpportunityCandidateInput, type OpportunityEnrichmentContext } from './opportunityDecisionFacts';
import type { OpportunityRangeDeps } from './opportunityRangeAdapter';

/** What preparation needs to know about one resolved intent. Generic: an
 * id, the already-resolved duration (never resolved again here), whether
 * that duration came from the generic fallback, and the facts a provider
 * already attached. */
export interface PreparationIntentInput {
  intentId: string;
  durationMinutes: number | undefined;
  durationFromGenericFallback: boolean;
  facts: DecisionFacts | undefined;
}

export interface DecisionFactPreparationInput {
  /** One entry per resolved intent, in the request's own order. */
  intents: readonly PreparationIntentInput[];
  context: OpportunityEnrichmentContext;
}

/** The prepared facts for the intents that gained any, keyed by the
 * server-owned intent id. An intent absent from the map has nothing new. */
export type PreparedDecisionFacts = ReadonlyMap<string, DecisionFacts>;

export type DecisionFactPreparer = (input: DecisionFactPreparationInput) => Promise<PreparedDecisionFacts>;

const NO_PREPARED_FACTS: PreparedDecisionFacts = new Map();

/**
 * The one production preparer: ONE range load for the widest horizon and
 * ONE projection per fact-bearing candidate (both inside
 * `computeOpportunityDecisionFacts`), merged onto the facts the candidate
 * already had. The merged objects are frozen: they are one immutable
 * snapshot for the whole preview.
 */
export function createDecisionFactPreparer(rangeDeps: OpportunityRangeDeps): DecisionFactPreparer {
  return async ({ intents, context }) => {
    const candidates: OpportunityCandidateInput[] = intents.map((intent) => ({
      intentId: intent.intentId,
      durationMinutes: intent.durationMinutes,
      durationBasis: intent.durationFromGenericFallback ? 'GENERIC_FALLBACK' : 'RESOLVED',
      facts: intent.facts,
    }));
    const opportunityByIntentId = await computeOpportunityDecisionFacts(candidates, context, rangeDeps);
    if (opportunityByIntentId.size === 0) return NO_PREPARED_FACTS;
    const prepared = new Map<string, DecisionFacts>();
    for (const candidate of candidates) {
      const opportunity = opportunityByIntentId.get(candidate.intentId);
      if (!opportunity) continue;
      prepared.set(candidate.intentId, Object.freeze({ ...candidate.facts, opportunity: Object.freeze({ ...opportunity }) }));
    }
    return prepared;
  };
}

/**
 * Runs a preparer with failure isolation. No preparer, or any failure,
 * yields no prepared facts (never fabricated ones).
 */
export async function prepareDecisionFactsFailOpen(preparer: DecisionFactPreparer | undefined, input: DecisionFactPreparationInput): Promise<PreparedDecisionFacts> {
  if (!preparer) return NO_PREPARED_FACTS;
  try {
    return await preparer(input);
  } catch (err) {
    console.warn('day-constructor: decision facts preparation unavailable, continuing without', err);
    return NO_PREPARED_FACTS;
  }
}

/**
 * O5 P2a -- builds the immutable `DecisionEvidence` for every fact-bearing
 * intent, ONCE, at this preparation stage (after the authoritative durations
 * exist and the facts are prepared, before the first `constructDay`). For each
 * intent the evidence is built from the facts as prepared (the prepared facts
 * when the preparer produced any, else the facts the intent already carried),
 * so it reflects exactly what the preview will expose -- and is then OWNED:
 * every value is copied and frozen (decisionEvidence.ts), so later changes to
 * a provider's objects cannot reach it.
 *
 * PURE and SYNCHRONOUS: no I/O, no query, no write, no clock; an intent whose
 * facts carry no evidence category gets no entry (absence stays absence).
 * FAIL-OPEN like the rest of this stage: evidence that cannot be built for one
 * intent is skipped (never fabricated, never a failed preview) and does not
 * affect any other intent.
 *
 * Preparing evidence is not consuming it: nothing in the Constructor reads the
 * result. It is held for the future decision-policy stage, never recomputed.
 */
export function prepareDecisionEvidence(intents: readonly PreparationIntentInput[], prepared: PreparedDecisionFacts): DecisionEvidenceByIntentId {
  const evidenceByIntentId = new Map<string, DecisionEvidence>();
  for (const intent of intents) {
    const facts = prepared.get(intent.intentId) ?? intent.facts;
    if (!facts) continue; // nothing carried, nothing prepared: no evidence, and no build is attempted
    try {
      const evidence = buildDecisionEvidence(facts);
      if (evidence) evidenceByIntentId.set(intent.intentId, evidence);
    } catch (err) {
      console.warn('day-constructor: decision evidence unavailable for one intent, continuing without', err);
    }
  }
  return evidenceByIntentId;
}

/**
 * Attaches the EXACT prepared object to the matching resolved intent,
 * matched by the server-owned `requestedIntentId` only. Never recomputes,
 * never reorders, never touches an intent that had nothing prepared, and
 * never mutates its input.
 */
export function attachPreparedDecisionFacts<T extends { requestedIntentId: string; dayIntent: { decisionFacts?: DecisionFacts } }>(resolved: readonly T[], prepared: PreparedDecisionFacts): T[] {
  if (prepared.size === 0) return [...resolved];
  return resolved.map((entry) => {
    const decisionFacts = prepared.get(entry.requestedIntentId);
    return decisionFacts ? { ...entry, dayIntent: { ...entry.dayIntent, decisionFacts } } : entry;
  });
}
