/**
 * Life Weather Engine V1 -- contributor construction.
 *
 * One small, pure builder per contributor kind (matching the discriminated
 * LifeWeatherContributor union in packages/personal-intelligence/src/context.ts).
 * Every builder attaches exactly one small, Life-Weather-authored evidence
 * entry documenting the one fact that contributor asserts -- see
 * evidence.ts's own module doc comment for why upstream evidence trees are
 * never forwarded wholesale.
 */
import { buildNatalBaselineEvidence, buildDashaThemeActivationEvidence, buildTransitTargetThemeActivationEvidence } from './evidence';
import type {
  LifeWeatherNatalContributor,
  LifeWeatherMahadashaContributor,
  LifeWeatherAntardashaContributor,
  LifeWeatherTransitContributor,
  TransitActivation,
} from '../../personal-intelligence/src/context';
import type { PersonalTheme, PersonalThemeSignal } from '../../personal-intelligence/src/types';

/** The person's own immutable natal baseline for this theme -- `strength`/evidence are never recomputed, never incremented by current activity (see types.ts's own LifeWeatherInput doc comment). */
export function buildNatalContributor(signal: PersonalThemeSignal): LifeWeatherNatalContributor {
  return {
    source: 'NATAL',
    strength: signal.strength,
    evidence: [buildNatalBaselineEvidence({ theme: signal.theme, strength: signal.strength, direction: signal.direction })],
  };
}

export function buildMahadashaContributor(theme: PersonalTheme, lord: string): LifeWeatherMahadashaContributor {
  return {
    source: 'DASHA_MAHADASHA',
    natalPlanet: lord,
    evidence: [buildDashaThemeActivationEvidence({ theme, lord, level: 'MAHADASHA' })],
  };
}

export function buildAntardashaContributor(theme: PersonalTheme, lord: string): LifeWeatherAntardashaContributor {
  return {
    source: 'DASHA_ANTARDASHA',
    natalPlanet: lord,
    evidence: [buildDashaThemeActivationEvidence({ theme, lord, level: 'ANTARDASHA' })],
  };
}

/** `transitingPlanet`/`natalPlanet`/`relationship`/`strength` are copied VERBATIM from the source pair -- no rescaling, no aggregation (see this engine's own README.md "Transit contribution is per-pair, never aggregated" section). */
export function buildTransitContributor(theme: PersonalTheme, activation: TransitActivation): LifeWeatherTransitContributor {
  return {
    source: 'TRANSIT',
    transitingPlanet: activation.transitingPlanet,
    natalPlanet: activation.natalPlanet,
    relationship: activation.relationship,
    strength: activation.strength,
    evidence: [
      buildTransitTargetThemeActivationEvidence({
        theme,
        transitingPlanet: activation.transitingPlanet,
        natalPlanet: activation.natalPlanet,
        relationship: activation.relationship,
        strength: activation.strength,
      }),
    ],
  };
}
