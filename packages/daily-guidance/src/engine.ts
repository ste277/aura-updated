/**
 * Daily Guidance Composer V1 -- public engine.
 *
 * PURE COMPOSITION. This function never calls runTimingSearch,
 * evaluateActivityFit, evaluateMuhurta, getPanchangForDate,
 * deriveLifeWeather, or deriveDailyPersonalFit -- the only inputs this
 * engine reads are an already-computed DailyPersonalFitContext (the
 * personal-relevance axis) and already-ranked, per-family
 * WindowRankingContext results (the timing axis). See README.md's
 * "Architecture" section for the full boundary this composes across, and
 * this file's own module doc comment sections below for the staged
 * selection policy this orchestrates.
 *
 * NEVER A NUMERIC COMPOSITE (merge-critical): nowhere in this file (or
 * anything it calls) is `personalRelevance` combined arithmetically with
 * any timing value. Selection is staged eligibility (eligibility.ts) +
 * lexicographic tuple ordering (ordering.ts) + greedy non-overlapping
 * selection (this file, using overlap.ts) -- see README.md's "No numeric
 * composite" section.
 */
import { assertValidDailyGuidanceInput } from './validation';
import { buildCandidates, isEligibleForStage, SELECTION_STAGES } from './eligibility';
import { sortCandidates } from './ordering';
import { windowsOverlap } from './overlap';
import { buildSelectionEvidence, buildTimingEvidence, buildResultSummaryEvidence } from './evidence';
import { DAILY_GUIDANCE_ENGINE_VERSION, DAILY_GUIDANCE_SELECTION_POLICY_VERSION } from './provenance';
import { DEFAULT_LIMIT } from './constants';
import type { DailyGuidanceInput, DailyGuidanceCandidate } from './types';
import type { DailyGuidanceContext, DailyGuidanceRecommendation, DailyGuidanceSelectionReason } from '../../personal-intelligence/src/context';

interface StagedSelection {
  candidate: DailyGuidanceCandidate;
  reason: DailyGuidanceSelectionReason;
}

/**
 * The core public entry point. Runs Stage 1 (PRIMARY_FLOOR_MET) to
 * completion before Stage 2 (RELAXED_TIMING_FLOOR) is ever consulted,
 * and Stage 2 to completion before Stage 3 (RELAXED_RELEVANCE_FLOOR) is
 * ever consulted -- each stage only runs at all if fewer than `limit`
 * recommendations have been selected so far (see eligibility.ts's own
 * module doc comment for the exact per-stage rule table). Within a
 * stage, candidates are sorted by the lexicographic tuple
 * (ordering.ts) and selected greedily, skipping any candidate whose
 * rank-1 window exactly overlaps an already-selected recommendation's
 * own window (overlap.ts) -- a skipped family is never revisited with
 * its rank-2/3 window (see eligibility.ts's own "best window only" doc
 * comment). If fewer than `limit` candidates survive all three stages,
 * the result simply contains fewer recommendations -- never padded with
 * a weak or fabricated pick.
 *
 * No `Date.now()`, no randomness, no network/DB/LLM call anywhere in
 * this function or anything it calls -- `evaluationTime` is read
 * verbatim from `input.dailyPersonalFit.evaluationTime` and echoed
 * straight through.
 */
export function deriveDailyGuidance(input: DailyGuidanceInput): DailyGuidanceContext {
  assertValidDailyGuidanceInput(input);

  const limit = input.limit ?? DEFAULT_LIMIT;
  const candidates = buildCandidates(input);

  const selected: StagedSelection[] = [];
  const selectedFamilies = new Set<string>();

  for (const stage of SELECTION_STAGES) {
    if (selected.length >= limit) break;

    const eligible = candidates.filter((candidate) => !selectedFamilies.has(candidate.family) && isEligibleForStage(candidate, stage));
    const ordered = sortCandidates(eligible);

    for (const candidate of ordered) {
      if (selected.length >= limit) break;
      const overlapsSelected = selected.some((entry) => windowsOverlap(entry.candidate.window, candidate.window));
      if (overlapsSelected) continue; // skip this family -- never substitute its rank-2/3 window

      selected.push({ candidate, reason: stage });
      selectedFamilies.add(candidate.family);
    }
  }

  const recommendations: DailyGuidanceRecommendation[] = selected.map((entry, index) => {
    const timingEvidence = buildTimingEvidence(entry.candidate);
    return {
      rank: index + 1,
      activityFamily: entry.candidate.family,
      personalRelevance: entry.candidate.personalRelevance,
      relevantThemes: entry.candidate.relevantThemes,
      timing: {
        start: entry.candidate.window.start,
        end: entry.candidate.window.end,
        score: entry.candidate.window.score,
        label: entry.candidate.window.label,
        windowRank: entry.candidate.window.rank,
      },
      selectionReason: entry.reason,
      evidence: [buildSelectionEvidence(entry.candidate, entry.reason), ...(timingEvidence ? [timingEvidence] : [])],
    };
  });

  return {
    engineVersion: DAILY_GUIDANCE_ENGINE_VERSION,
    selectionPolicyVersion: DAILY_GUIDANCE_SELECTION_POLICY_VERSION,
    evaluationTime: input.dailyPersonalFit.evaluationTime,
    recommendations,
    evidence: [
      buildResultSummaryEvidence({
        engineVersion: DAILY_GUIDANCE_ENGINE_VERSION,
        selectionPolicyVersion: DAILY_GUIDANCE_SELECTION_POLICY_VERSION,
        requestedLimit: limit,
        selectedCount: recommendations.length,
      }),
    ],
  };
}
