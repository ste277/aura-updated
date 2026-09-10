/**
 * Personal Guidance Orchestration V1 -- same-family consolidation.
 *
 * #104 (packages/daily-guidance) accepts exactly one WindowRankingContext
 * per activityFamily and rejects a duplicate. When today's concrete
 * activities include two or more DIFFERENT activities sharing one family
 * (e.g. "Date Night" and "Call Parents" both RELATIONSHIP), this
 * orchestration layer -- not #103, not #104 -- must pick exactly one to
 * represent that family before calling deriveWindowRanking.
 *
 * ORDINAL ONLY, NO NUMERIC COMPOSITE (merge-critical, mirrors #104's own
 * discipline exactly): the tuple below is compared one key at a time,
 * never blended into a score. Cross-family score comparison is NEVER
 * performed here or anywhere in this orchestrator -- this module only
 * ever compares candidates that already share one activityFamily (see
 * this file's own module-level guarantee: `selectOneCandidatePerFamily`
 * groups by family before any comparison happens).
 *
 * Approved tuple, in order:
 *   1. timing label tier   (reuses packages/daily-guidance's own
 *      TIMING_LABEL_TIER_ORDER -- not a second classification)
 *   2. timing score, descending (verbatim upstream presentation score --
 *      defensible ONLY within one family, since same-family candidates
 *      share the same Muhurta RULES[family] base table; see this PR's
 *      own architecture audit for why cross-family comparison is NOT
 *      defensible)
 *   3. earlier start, ascending
 *   4. source priority: PLAN before DAY_BUILDER_INTENTION (an explicit
 *      user commitment beats an auto-suggestion, ordinal only -- never
 *      PLAN=100/DAY_BUILDER=50)
 *   5. stable activityId (final deterministic tie-break -- never title,
 *      never object insertion order)
 *
 * Only each candidate's own BEST (rank-1) timing window is ever compared
 * -- never a candidate's rank-2/3 against another candidate's rank-1.
 */
import { TIMING_LABEL_TIER_ORDER } from '../../../packages/daily-guidance/src/index';
import { deriveWindowRanking } from '../../../packages/window-ranking/src/engine';
import type { ConcreteGuidanceCandidate, ConcreteGuidanceCandidateSource } from './dailyGuidanceTypes';
import type { WindowRankingContext } from '../../../packages/window-ranking/src/types';

const SOURCE_PRIORITY: Record<ConcreteGuidanceCandidateSource, number> = { PLAN: 0, DAY_BUILDER_INTENTION: 1 };

/** `undefined` when `candidate.timingCandidates` is empty -- a candidate with no timing at all cannot represent its family (brief section 56). */
function bestWindow(candidate: ConcreteGuidanceCandidate) {
  return candidate.timingCandidates[0];
}

/** Compares two SAME-FAMILY candidates by their own best (rank-1) window only. Never called across different families -- see this file's own module doc comment. */
function compareSameFamilyCandidates(a: ConcreteGuidanceCandidate, b: ConcreteGuidanceCandidate): number {
  const windowA = bestWindow(a)!;
  const windowB = bestWindow(b)!;

  const labelDiff = TIMING_LABEL_TIER_ORDER[windowA.label] - TIMING_LABEL_TIER_ORDER[windowB.label];
  if (labelDiff !== 0) return labelDiff;

  const scoreDiff = windowB.score - windowA.score; // higher score wins -> descending
  if (scoreDiff !== 0) return scoreDiff;

  const startDiff = new Date(windowA.start).getTime() - new Date(windowB.start).getTime(); // earlier start wins -> ascending
  if (startDiff !== 0) return startDiff;

  const sourceDiff = SOURCE_PRIORITY[a.source] - SOURCE_PRIORITY[b.source]; // PLAN before DAY_BUILDER_INTENTION
  if (sourceDiff !== 0) return sourceDiff;

  return a.activityId < b.activityId ? -1 : a.activityId > b.activityId ? 1 : 0; // final stable tie-break
}

/**
 * Groups `candidates` by `activityFamily`, then picks exactly one
 * candidate per family via `compareSameFamilyCandidates` above. A
 * candidate with no timing windows at all is excluded from consideration
 * (brief section 56) -- if every candidate in a family has no timing, that
 * family is simply absent from the result (partial family coverage is
 * valid, #104's own established contract, never fabricated).
 */
export function selectOneCandidatePerFamily(candidates: readonly ConcreteGuidanceCandidate[]): Map<string, ConcreteGuidanceCandidate> {
  const byFamily = new Map<string, ConcreteGuidanceCandidate[]>();
  for (const candidate of candidates) {
    if (candidate.timingCandidates.length === 0) continue;
    const list = byFamily.get(candidate.activityFamily) ?? [];
    list.push(candidate);
    byFamily.set(candidate.activityFamily, list);
  }

  const selected = new Map<string, ConcreteGuidanceCandidate>();
  for (const [family, familyCandidates] of byFamily) {
    const winner = [...familyCandidates].sort(compareSameFamilyCandidates)[0];
    selected.set(family, winner);
  }
  return selected;
}

/**
 * One WindowRankingContext per selected candidate, built via the pure
 * core (`deriveWindowRanking`) directly -- never the FIND-only
 * convenience adapter (`rankActivityWindowsFromTimingSearch`), since a
 * PLAN candidate's `timingCandidates` came from CHECK, not FIND. The
 * core is mode-agnostic by design (see packages/window-ranking's own
 * architecture) -- a CHECK-derived single-candidate array normalizes to
 * rank 1 exactly the same way a FIND-derived array would. Never re-sorts,
 * re-scores, or re-labels `candidate.timingCandidates` -- #103 already
 * owns that order.
 */
export function buildWindowRankingContexts(selected: Map<string, ConcreteGuidanceCandidate>): WindowRankingContext[] {
  return Array.from(selected.entries()).map(([family, candidate]) =>
    deriveWindowRanking({ activityFamily: family as WindowRankingContext['activityFamily'], candidates: candidate.timingCandidates })
  );
}
