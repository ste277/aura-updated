/**
 * Vimshottari Dasha Engine V1 -- structured evidence builders.
 *
 * Every calculated fact this engine derives (Nakshatra from Moon,
 * starting lord, birth balance, each Mahadasha/Antardasha's own
 * duration/boundary) gets its own PersonalEvidenceRef, source:
 * 'VIMSHOTTARI_DASHA' (already part of packages/personal-intelligence's
 * own PersonalEvidenceSource union -- no contract change needed). Stable
 * rule ids only (provenance.ts) -- never generated at runtime. None of
 * these ever contain prediction prose.
 */
import {
  VIMSHOTTARI_RULE_VERSION,
  VIMSHOTTARI_NAKSHATRA_FROM_MOON_V1,
  VIMSHOTTARI_STARTING_LORD_V1,
  VIMSHOTTARI_BIRTH_BALANCE_V1,
  VIMSHOTTARI_MAHADASHA_DURATION_V1,
  VIMSHOTTARI_ANTARDASHA_DURATION_V1,
  VIMSHOTTARI_YEAR_LENGTH_365_25_V1,
  VIMSHOTTARI_INTERVAL_BOUNDARY_V1,
} from './provenance';
import type { PersonalEvidenceRef } from '../../personal-intelligence/src/evidence';
import type { VimshottariLord } from './types';

export function buildNakshatraFromMoonEvidence(params: { moonLongitude: number; nakshatraIndex: number; nakshatraName: string }): PersonalEvidenceRef {
  return {
    source: 'VIMSHOTTARI_DASHA',
    ruleId: VIMSHOTTARI_NAKSHATRA_FROM_MOON_V1,
    ruleVersion: VIMSHOTTARI_RULE_VERSION,
    summary: `Natal Moon at ${params.moonLongitude.toFixed(4)}deg sidereal falls in ${params.nakshatraName}.`,
    data: { moonLongitude: params.moonLongitude, nakshatraIndex: params.nakshatraIndex, nakshatraName: params.nakshatraName },
  };
}

export function buildStartingLordEvidence(params: { nakshatraIndex: number; nakshatraName: string; lord: VimshottariLord }): PersonalEvidenceRef {
  return {
    source: 'VIMSHOTTARI_DASHA',
    ruleId: VIMSHOTTARI_STARTING_LORD_V1,
    ruleVersion: VIMSHOTTARI_RULE_VERSION,
    summary: `${params.nakshatraName}'s ruling lord, ${params.lord}, is the Mahadasha active at birth.`,
    data: { nakshatraIndex: params.nakshatraIndex, nakshatraName: params.nakshatraName, lord: params.lord },
  };
}

export function buildBirthBalanceEvidence(params: {
  lord: VimshottariLord;
  fractionElapsed: number;
  fractionRemaining: number;
  elapsedMs: number;
  remainingMs: number;
}): PersonalEvidenceRef {
  return {
    source: 'VIMSHOTTARI_DASHA',
    ruleId: VIMSHOTTARI_BIRTH_BALANCE_V1,
    ruleVersion: VIMSHOTTARI_RULE_VERSION,
    summary: `${(params.fractionRemaining * 100).toFixed(2)}% of the ${params.lord} Mahadasha remains at birth.`,
    data: {
      lord: params.lord,
      fractionElapsed: params.fractionElapsed,
      fractionRemaining: params.fractionRemaining,
      elapsedMs: params.elapsedMs,
      remainingMs: params.remainingMs,
    },
  };
}

export function buildYearLengthEvidence(): PersonalEvidenceRef {
  return {
    source: 'VIMSHOTTARI_DASHA',
    ruleId: VIMSHOTTARI_YEAR_LENGTH_365_25_V1,
    ruleVersion: VIMSHOTTARI_RULE_VERSION,
    summary: '1 Vimshottari year = 365.25 days (V1 calculation convention).',
    data: { vimshottariYearDays: 365.25, vimshottariYearMs: 31_557_600_000 },
  };
}

export function buildMahadashaDurationEvidence(params: { lord: VimshottariLord; years: number; durationMs: number }): PersonalEvidenceRef {
  return {
    source: 'VIMSHOTTARI_DASHA',
    ruleId: VIMSHOTTARI_MAHADASHA_DURATION_V1,
    ruleVersion: VIMSHOTTARI_RULE_VERSION,
    summary: `${params.lord} Mahadasha lasts ${params.years} years.`,
    data: { lord: params.lord, years: params.years, durationMs: params.durationMs },
  };
}

export function buildAntardashaDurationEvidence(params: { mahadashaLord: VimshottariLord; antardashaLord: VimshottariLord; durationMs: number }): PersonalEvidenceRef {
  return {
    source: 'VIMSHOTTARI_DASHA',
    ruleId: VIMSHOTTARI_ANTARDASHA_DURATION_V1,
    ruleVersion: VIMSHOTTARI_RULE_VERSION,
    summary: `${params.mahadashaLord}/${params.antardashaLord} Antardasha duration.`,
    data: { mahadashaLord: params.mahadashaLord, antardashaLord: params.antardashaLord, durationMs: params.durationMs },
  };
}

export function buildIntervalBoundaryEvidence(params: { level: 'MAHADASHA' | 'ANTARDASHA'; lord: VimshottariLord; start: string; end: string }): PersonalEvidenceRef {
  return {
    source: 'VIMSHOTTARI_DASHA',
    ruleId: VIMSHOTTARI_INTERVAL_BOUNDARY_V1,
    ruleVersion: VIMSHOTTARI_RULE_VERSION,
    summary: `${params.lord} ${params.level.toLowerCase()} spans [${params.start}, ${params.end}).`,
    data: { level: params.level, lord: params.lord, start: params.start, end: params.end },
  };
}

/**
 * Deduplicates a list of PersonalEvidenceRef by stable identity
 * (source + ruleId + JSON-serialized data), never by `summary` alone --
 * matching the exact same pattern already established in
 * packages/bhrigu/src/chains.ts and packages/personal-themes/src/evidence.ts.
 * Preserves first-occurrence order.
 */
export function dedupeEvidenceRefs(refs: PersonalEvidenceRef[]): PersonalEvidenceRef[] {
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
