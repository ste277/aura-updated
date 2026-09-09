/**
 * Daily Personal Fit Engine V1 -- structured evidence builders.
 *
 * Every activity family gets exactly one small, self-contained
 * PersonalEvidenceRef (source: 'DAILY_PERSONAL_FIT') documenting the one
 * synthesis fact it asserts: which mapped themes were inspected, and
 * which maximum LifeWeatherState determined the relevance result --
 * never a forwarded copy of LifeWeatherTheme.contributors, transit
 * details, Dasha details, or natalStrength (see README.md's "Evidence
 * discipline" section). Stable rule ids only (provenance.ts) -- never
 * generated at runtime.
 */
import { ACTIVITY_THEME_MAPPING_VERSION, DAILY_PERSONAL_FIT_RELEVANCE_DERIVATION_V1, DAILY_PERSONAL_FIT_SUMMARY_V1 } from './provenance';
import type { PersonalEvidenceRef } from '../../personal-intelligence/src/evidence';
import type { PersonalRelevance, LifeWeatherState } from '../../personal-intelligence/src/context';
import type { PersonalTheme } from '../../personal-intelligence/src/types';

export function buildRelevanceEvidence(params: {
  activityFamily: string;
  personalRelevance: PersonalRelevance;
  relevantThemes: readonly { theme: PersonalTheme; state: LifeWeatherState }[];
}): PersonalEvidenceRef {
  const themeSummary = params.relevantThemes.map((t) => `${t.theme}:${t.state}`).join(', ');
  return {
    source: 'DAILY_PERSONAL_FIT',
    ruleId: DAILY_PERSONAL_FIT_RELEVANCE_DERIVATION_V1,
    ruleVersion: ACTIVITY_THEME_MAPPING_VERSION,
    summary: `${params.activityFamily} is ${params.personalRelevance}, derived from the maximum state among its own mapped themes (${themeSummary || 'none'}).`,
    data: {
      activityFamily: params.activityFamily,
      personalRelevance: params.personalRelevance,
      relevantThemes: params.relevantThemes.map((t) => ({ theme: t.theme, state: t.state })),
    },
  };
}

export function buildSummaryEvidence(params: { evaluationTime: string; activityFamilyCount: number; relevantCount: number; highlyRelevantCount: number }): PersonalEvidenceRef {
  return {
    source: 'DAILY_PERSONAL_FIT',
    ruleId: DAILY_PERSONAL_FIT_SUMMARY_V1,
    ruleVersion: ACTIVITY_THEME_MAPPING_VERSION,
    summary: `Evaluated ${params.activityFamilyCount} activity families at ${params.evaluationTime}: ${params.relevantCount} RELEVANT, ${params.highlyRelevantCount} HIGHLY_RELEVANT.`,
    data: {
      evaluationTime: params.evaluationTime,
      activityFamilyCount: params.activityFamilyCount,
      relevantCount: params.relevantCount,
      highlyRelevantCount: params.highlyRelevantCount,
    },
  };
}

/** Deduplicates a list of PersonalEvidenceRef by stable identity (source + ruleId + JSON-serialized data), matching the exact same pattern already established in packages/bhrigu, packages/personal-themes, packages/vimshottari, packages/transit-activation, and packages/life-weather. Preserves first-occurrence order. */
export function dedupeEvidenceRefs(refs: readonly PersonalEvidenceRef[]): PersonalEvidenceRef[] {
  const seen = new Set<string>();
  const result: PersonalEvidenceRef[] = [];
  for (const ref of refs) {
    const key = `${ref.source}|${ref.ruleId}|${JSON.stringify(ref.data ?? null)}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(ref);
    }
  }
  return result;
}
