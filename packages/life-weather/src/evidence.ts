/**
 * Life Weather Engine V1 -- structured evidence builders.
 *
 * Every contributor/theme/result-level fact gets its own small,
 * self-contained PersonalEvidenceRef, source: 'LIFE_WEATHER' -- these
 * document Life Weather's OWN synthesis facts (a planet-to-theme
 * projection, a structural state derivation), never a copy of an
 * upstream engine's own evidence tree (see README.md's "Evidence
 * discipline" section: a NATAL contributor's evidence does not forward
 * the entire natal PersonalThemeSignal.reasons array, a TRANSIT
 * contributor's evidence does not forward the entire
 * TransitActivationContext.evidence array -- each entry here documents
 * exactly, and only, the one fact its own contributor/theme asserts).
 * Stable rule ids only (provenance.ts) -- never generated at runtime.
 */
import {
  LIFE_WEATHER_SYNTHESIS_VERSION,
  LIFE_WEATHER_NATAL_BASELINE_V1,
  LIFE_WEATHER_DASHA_THEME_ACTIVATION_V1,
  LIFE_WEATHER_TRANSIT_TARGET_THEME_ACTIVATION_V1,
  LIFE_WEATHER_STRUCTURAL_STATE_V1,
  LIFE_WEATHER_CROSS_SYSTEM_REINFORCEMENT_V1,
  LIFE_WEATHER_SUMMARY_V1,
} from './provenance';
import type { PersonalEvidenceRef } from '../../personal-intelligence/src/evidence';
import type { PersonalTheme } from '../../personal-intelligence/src/types';
import type { LifeWeatherState, PersonalTransitRelationship } from '../../personal-intelligence/src/context';

export function buildNatalBaselineEvidence(params: { theme: PersonalTheme; strength: number; direction: string }): PersonalEvidenceRef {
  return {
    source: 'LIFE_WEATHER',
    ruleId: LIFE_WEATHER_NATAL_BASELINE_V1,
    ruleVersion: LIFE_WEATHER_SYNTHESIS_VERSION,
    summary: `${params.theme} carries a natal Personal Themes baseline of ${params.strength.toFixed(2)} (${params.direction}).`,
    data: { theme: params.theme, strength: params.strength, direction: params.direction },
  };
}

export function buildDashaThemeActivationEvidence(params: { theme: PersonalTheme; lord: string; level: 'MAHADASHA' | 'ANTARDASHA' }): PersonalEvidenceRef {
  return {
    source: 'LIFE_WEATHER',
    ruleId: LIFE_WEATHER_DASHA_THEME_ACTIVATION_V1,
    ruleVersion: LIFE_WEATHER_SYNTHESIS_VERSION,
    summary: `${params.lord} ${params.level.toLowerCase()} lord's own canonical Personal Themes mapping includes ${params.theme}.`,
    data: { theme: params.theme, lord: params.lord, level: params.level },
  };
}

export function buildTransitTargetThemeActivationEvidence(params: {
  theme: PersonalTheme;
  transitingPlanet: string;
  natalPlanet: string;
  relationship: PersonalTransitRelationship;
  strength: number;
}): PersonalEvidenceRef {
  return {
    source: 'LIFE_WEATHER',
    ruleId: LIFE_WEATHER_TRANSIT_TARGET_THEME_ACTIVATION_V1,
    ruleVersion: LIFE_WEATHER_SYNTHESIS_VERSION,
    summary: `Transiting ${params.transitingPlanet} is ${params.relationship} natal ${params.natalPlanet}, whose own canonical Personal Themes mapping includes ${params.theme}.`,
    data: { theme: params.theme, transitingPlanet: params.transitingPlanet, natalPlanet: params.natalPlanet, relationship: params.relationship, strength: params.strength },
  };
}

export function buildStructuralStateEvidence(params: { theme: PersonalTheme; state: LifeWeatherState; hasDasha: boolean; hasTransit: boolean }): PersonalEvidenceRef {
  return {
    source: 'LIFE_WEATHER',
    ruleId: LIFE_WEATHER_STRUCTURAL_STATE_V1,
    ruleVersion: LIFE_WEATHER_SYNTHESIS_VERSION,
    summary: `${params.theme} is ${params.state} (current Dasha reinforcement: ${params.hasDasha}, current transit reinforcement: ${params.hasTransit}).`,
    data: { theme: params.theme, state: params.state, hasDasha: params.hasDasha, hasTransit: params.hasTransit },
  };
}

export function buildCrossSystemReinforcementEvidence(params: { theme: PersonalTheme; reinforcementSources: readonly string[] }): PersonalEvidenceRef {
  return {
    source: 'LIFE_WEATHER',
    ruleId: LIFE_WEATHER_CROSS_SYSTEM_REINFORCEMENT_V1,
    ruleVersion: LIFE_WEATHER_SYNTHESIS_VERSION,
    summary: `${params.theme} is currently reinforced by ${params.reinforcementSources.length} independent systems: ${params.reinforcementSources.join(' and ')}.`,
    data: { theme: params.theme, reinforcementSources: [...params.reinforcementSources] },
  };
}

export function buildSummaryEvidence(params: { evaluationTime: string; themeCount: number; activeThemeCount: number; stronglyActiveThemeCount: number }): PersonalEvidenceRef {
  return {
    source: 'LIFE_WEATHER',
    ruleId: LIFE_WEATHER_SUMMARY_V1,
    ruleVersion: LIFE_WEATHER_SYNTHESIS_VERSION,
    summary: `Evaluated ${params.themeCount} themes at ${params.evaluationTime}: ${params.activeThemeCount} ACTIVE, ${params.stronglyActiveThemeCount} STRONGLY_ACTIVE.`,
    data: { evaluationTime: params.evaluationTime, themeCount: params.themeCount, activeThemeCount: params.activeThemeCount, stronglyActiveThemeCount: params.stronglyActiveThemeCount },
  };
}

/** Deduplicates a list of PersonalEvidenceRef by stable identity (source + ruleId + JSON-serialized data), matching the exact same pattern already established in packages/bhrigu, packages/personal-themes, packages/vimshottari, and packages/transit-activation. Preserves first-occurrence order. */
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
