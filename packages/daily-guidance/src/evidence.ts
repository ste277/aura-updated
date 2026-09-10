/**
 * Daily Guidance Composer V1 -- structured evidence builders.
 *
 * ZERO-COUPLING BOUNDARY (merge-critical): packages/personal-intelligence
 * cannot import `MuhurtaReason`/`TimingConflict` (packages/muhurta /
 * packages/recommendation) without breaking its own zero-cross-package-
 * import guarantee. This file is where that boundary is actually crossed
 * -- packages/daily-guidance IS allowed to import those types, and this
 * file converts their JSON-safe fields into the generic
 * `PersonalEvidenceRef` envelope every Personal Intelligence contract
 * already uses for exactly this situation (see
 * packages/personal-intelligence/src/evidence.ts's own module doc
 * comment). The composer's OWN selection-rule fact is tagged
 * 'DAILY_GUIDANCE'; forwarded Muhurta reasons/conflicts are tagged
 * 'MUHURTA' -- evidence is tagged by ORIGINATING calculation, never by
 * whichever engine merely forwards it (see
 * packages/personal-intelligence/src/evidence.ts's own doc comment on
 * `PersonalEvidenceSource`).
 *
 * COMPACT ONLY: at most two evidence entries per recommendation (one
 * selection-rule fact, one forwarded-timing-facts bundle) -- never a full
 * copy of any upstream engine's own evidence tree (no Life Weather
 * contributors, no Daily Personal Fit evidence, no full Panchang object).
 */
import { DAILY_GUIDANCE_SELECTION_V1, DAILY_GUIDANCE_SUMMARY_V1 } from './provenance';
import type { DailyGuidanceCandidate } from './types';
import type { PersonalEvidenceRef } from '../../personal-intelligence/src/evidence';
import type { DailyGuidanceSelectionReason } from '../../personal-intelligence/src/context';

/** The composer's own selection-rule fact: which stage selected this candidate, and the tuple values that stage compared. */
export function buildSelectionEvidence(candidate: DailyGuidanceCandidate, selectionReason: DailyGuidanceSelectionReason): PersonalEvidenceRef {
  return {
    source: 'DAILY_GUIDANCE',
    ruleId: DAILY_GUIDANCE_SELECTION_V1,
    ruleVersion: DAILY_GUIDANCE_SELECTION_V1,
    summary: `${candidate.family} selected (${selectionReason}): personal relevance ${candidate.personalRelevance}, timing ${candidate.window.label}.`,
    data: {
      activityFamily: candidate.family,
      personalRelevance: candidate.personalRelevance,
      timingLabel: candidate.window.label,
      timingScore: candidate.window.score,
      windowRank: candidate.window.rank,
      selectionReason,
    },
  };
}

/**
 * Forwards the selected window's own `reasons`/`conflicts` as one compact,
 * JSON-safe bundle -- only fields that are JSON-safe and actually present
 * are copied (no wording/type reinterpretation, see README.md's "Timing
 * evidence" / "Conflict evidence" sections). Returns `undefined` (no
 * entry) when the window has neither reasons nor conflicts, rather than
 * an empty placeholder entry.
 */
export function buildTimingEvidence(candidate: DailyGuidanceCandidate): PersonalEvidenceRef | undefined {
  const reasons = candidate.window.reasons ?? [];
  const conflicts = candidate.window.conflicts ?? [];
  if (reasons.length === 0 && conflicts.length === 0) return undefined;

  return {
    source: 'MUHURTA',
    ruleId: 'MUHURTA_WINDOW_REASONS_V1',
    ruleVersion: 'MUHURTA_WINDOW_REASONS_V1',
    summary: `Timing facts for ${candidate.family}'s selected window: ${reasons.length} reason(s), ${conflicts.length} conflict(s).`,
    data: {
      reasons: reasons.map((reason) => ({
        code: reason.code,
        factor: reason.factor,
        polarity: reason.polarity,
        ...(reason.impact !== undefined ? { impact: reason.impact } : {}),
        ...(reason.value !== undefined ? { value: reason.value } : {}),
        ...(reason.params !== undefined ? { params: reason.params } : {}),
      })),
      conflicts: conflicts.map((conflict) => ({ type: conflict.type, message: conflict.message })),
    },
  };
}

/** One top-level, result-level summary entry -- requested limit, selected count, engine/policy version. Never enumerates rejected/omitted families (see README.md's "No omittedActivities in V1" section). */
export function buildResultSummaryEvidence(params: { engineVersion: string; selectionPolicyVersion: string; requestedLimit: number; selectedCount: number }): PersonalEvidenceRef {
  return {
    source: 'DAILY_GUIDANCE',
    ruleId: DAILY_GUIDANCE_SUMMARY_V1,
    ruleVersion: params.engineVersion,
    summary: `Selected ${params.selectedCount} of up to ${params.requestedLimit} requested recommendations (${params.engineVersion} / ${params.selectionPolicyVersion}).`,
    data: {
      engineVersion: params.engineVersion,
      selectionPolicyVersion: params.selectionPolicyVersion,
      requestedLimit: params.requestedLimit,
      selectedCount: params.selectedCount,
    },
  };
}
