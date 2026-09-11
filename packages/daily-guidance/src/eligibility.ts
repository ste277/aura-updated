/**
 * Daily Guidance Composer V1 -- join + staged eligibility.
 *
 * BEST WINDOW ONLY (merge-critical): every candidate here is built from
 * `windowRanking.windows[0]` alone -- rank 2/3 are never read, and never
 * substituted for a rank-1 window that later turns out to overlap an
 * already-selected recommendation (see ordering.ts's own greedy-selection
 * doc comment). This preserves #103's own exclusive ownership of
 * within-family timing ranking.
 *
 * THREE STAGES, NEVER A FOURTH (merge-critical, see README.md's "Selection
 * policy" section for the full product rationale):
 *   Stage 1 PRIMARY_FLOOR_MET:        relevance in {HIGHLY_RELEVANT, RELEVANT}, label in {EXCELLENT, VERY_GOOD, GOOD}
 *   Stage 2 RELAXED_TIMING_FLOOR:     relevance in {HIGHLY_RELEVANT, RELEVANT}, label = USABLE
 *   Stage 3 RELAXED_RELEVANCE_FLOOR:  relevance = BASELINE,                    label in {EXCELLENT, VERY_GOOD, GOOD}
 * CAUTION is never eligible in any stage -- it is absent from every
 * stage's own label set above, not filtered out by a separate check.
 * BASELINE + USABLE is never eligible in V1 -- there is deliberately no
 * fourth stage; if fewer than `limit` candidates survive Stage 3, the
 * result simply contains fewer recommendations (see engine.ts).
 */
import { PRIMARY_TIMING_LABELS, RELAXED_TIMING_LABELS } from './constants';
import type { DailyGuidanceCandidate } from './types';
import type { DailyGuidanceInput } from './types';
import type { MuhurtaActivityFamily } from '../../muhurta/src/muhurtaEngine';
import type { DailyGuidanceSelectionReason } from '../../personal-intelligence/src/context';

/**
 * Joins `dailyPersonalFit` with `windowRankings` on `activityFamily`.
 * A family is included only when a WindowRankingContext was actually
 * supplied for it AND that context's own `windows` is non-empty --
 * "HIGHLY_RELEVANT with no window" (or with a WindowRankingContext simply
 * never supplied) produces no candidate at all, never a fabricated one
 * (see README.md's "Empty/missing window handling" section).
 *
 * Behavioral Integration V1: `behavioralAffinity` is resolved here from
 * the OPTIONAL `input.behavioralAffinityByFamily` -- an omitted map, or a
 * family missing from it, both resolve to `NEUTRAL` (never thrown; see
 * types.ts's own `DailyGuidanceInput.behavioralAffinityByFamily` doc
 * comment). This is purely a join-time lookup, never consulted by
 * `isEligibleForStage` below -- stage membership stays exactly as before.
 *
 * Preferred Daypart Personalization V1: `preferredDaypartMatch` is
 * resolved the identical way from the OPTIONAL
 * `input.preferredDaypartMatchByFamily` -- an omitted map, a family
 * missing from it, or an explicit `false` entry all resolve to `false`
 * (never thrown, never distinguished from one another downstream; see
 * types.ts's own doc comment on why a genuine mismatch, no behavioral
 * history, and an app-excluded Plan candidate must collapse to the
 * identical "no boost" outcome). Also purely a join-time lookup, never
 * consulted by `isEligibleForStage` below.
 */
export function buildCandidates(input: DailyGuidanceInput): DailyGuidanceCandidate[] {
  const fitByFamily = new Map(input.dailyPersonalFit.activities.map((a) => [a.activityFamily, a]));

  const candidates: DailyGuidanceCandidate[] = [];
  for (const ranking of input.windowRankings) {
    if (ranking.windows.length === 0) continue;
    const fit = fitByFamily.get(ranking.activityFamily);
    // Presence guaranteed by validation.ts's own assertJoinCompleteness check.
    if (!fit) continue;

    candidates.push({
      family: ranking.activityFamily as MuhurtaActivityFamily,
      personalRelevance: fit.personalRelevance,
      relevantThemes: fit.relevantThemes,
      window: ranking.windows[0],
      behavioralAffinity: input.behavioralAffinityByFamily?.[ranking.activityFamily] ?? 'NEUTRAL',
      preferredDaypartMatch: input.preferredDaypartMatchByFamily?.[ranking.activityFamily] === true,
    });
  }
  return candidates;
}

const HIGH_OR_RELEVANT = new Set(['HIGHLY_RELEVANT', 'RELEVANT']);

/** `true` iff `candidate` clears the given stage's own eligibility bar. Stages are mutually exclusive by construction (a BASELINE candidate never clears Stage 1/2; a CAUTION-labeled candidate never clears any stage) -- see this file's own module doc comment for the exact rule table. */
export function isEligibleForStage(candidate: DailyGuidanceCandidate, stage: DailyGuidanceSelectionReason): boolean {
  const label = candidate.window.label;
  if (stage === 'PRIMARY_FLOOR_MET') {
    return HIGH_OR_RELEVANT.has(candidate.personalRelevance) && (PRIMARY_TIMING_LABELS as readonly string[]).includes(label);
  }
  if (stage === 'RELAXED_TIMING_FLOOR') {
    return HIGH_OR_RELEVANT.has(candidate.personalRelevance) && (RELAXED_TIMING_LABELS as readonly string[]).includes(label);
  }
  // RELAXED_RELEVANCE_FLOOR
  return candidate.personalRelevance === 'BASELINE' && (PRIMARY_TIMING_LABELS as readonly string[]).includes(label);
}

/** The fixed stage order this engine always runs in -- Stage 1 fully before Stage 2, Stage 2 fully before Stage 3 (see engine.ts's own orchestration). */
export const SELECTION_STAGES: readonly DailyGuidanceSelectionReason[] = ['PRIMARY_FLOOR_MET', 'RELAXED_TIMING_FLOOR', 'RELAXED_RELEVANCE_FLOOR'];
