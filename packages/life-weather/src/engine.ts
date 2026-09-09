/**
 * Life Weather Engine V1 -- public engine.
 *
 * PURE COMPOSITION. This function never calls getNatalChart, never calls
 * calculateVimshottariDasha, never calls calculateTransitActivation, never
 * traverses the Bhrigu natal graph, never calls deriveThemeContext, and
 * never calls any Ashtakavarga calculation -- every one of those results
 * is already an input (PersonalThemeContext / LifePeriodContext /
 * TransitActivationContext), computed upstream by a caller. See
 * README.md's "Architecture" section for the full pipeline this engine is
 * the final, synthesis-only stage of.
 *
 * MODEL D (merge-critical, see mapping.ts): a Dasha lord or a transiting
 * planet never asserts a theme by itself -- only the NATAL TARGET's own
 * canonical theme eligibility does. "Transiting Saturn activates natal
 * Moon" projects through Moon's own themes, never Saturn's own themes; a
 * Mahadasha lord projects through its OWN themes (the lord IS the natal
 * target in the Dasha case). This is what keeps Life Weather
 * person-specific rather than a generic "Jupiter transit = LEARNING for
 * everybody" horoscope (see README.md's "No generic horoscope" section).
 *
 * ZERO NATAL STRENGTH DOES NOT BLOCK CURRENT ACTIVATION (merge-critical):
 * eligibility for a contributor comes entirely from the canonical
 * planet-to-theme mapping (mapping.ts), never from `natalStrength`. A
 * theme with `natalStrength === 0` (SOCIAL/FINANCE, structurally always 0
 * in Personal Themes V1 -- see that package's own README.md) can still
 * reach ACTIVE/STRONGLY_ACTIVE from current Dasha/transit contributors.
 */
import { PERSONAL_THEMES } from '../../personal-intelligence/src/themes';
import { getThemesForPlanet } from './mapping';
import { buildNatalContributor, buildMahadashaContributor, buildAntardashaContributor, buildTransitContributor } from './contributors';
import { deriveLifeWeatherState } from './state';
import { buildStructuralStateEvidence, buildCrossSystemReinforcementEvidence, buildSummaryEvidence, dedupeEvidenceRefs } from './evidence';
import { assertValidLifeWeatherInput } from './validation';
import { LIFE_WEATHER_ENGINE_VERSION } from './provenance';
import { REINFORCEMENT_SOURCE_ORDER } from './constants';
import type { LifeWeatherInput } from './types';
import type { LifeWeatherContext, LifeWeatherTheme, LifeWeatherContributor } from '../../personal-intelligence/src/context';
import type { PersonalThemeSignal } from '../../personal-intelligence/src/types';

/**
 * The core public entry point. Given already-computed natal Personal
 * Themes, the current Vimshottari life period, the current Transit
 * Activation context (Personal Intelligence CONTRACT_V2's own pair-level
 * shape), and an explicit evaluation instant, deterministically derives
 * which of the 10 canonical PersonalTheme values are currently active and
 * which independent systems (Dasha, Transit) are reinforcing them.
 *
 * No `Date.now()`, no randomness, no network/DB/LLM call anywhere in this
 * function or anything it calls -- `evaluationTime` is validated for
 * shape only and echoed straight through (see types.ts's own
 * LifeWeatherInput doc comment: it records the instant of SYNTHESIS, it
 * is never used to recompute any of the three input contexts).
 */
export function deriveLifeWeather(input: LifeWeatherInput): LifeWeatherContext {
  assertValidLifeWeatherInput(input);

  const signalsByTheme = new Map<string, PersonalThemeSignal>(input.natalThemes.signals.map((signal) => [signal.theme, signal]));

  const majorLord = input.lifePeriod.majorPeriod?.ruler;
  const subLord = input.lifePeriod.subPeriod?.ruler;

  const themes: LifeWeatherTheme[] = PERSONAL_THEMES.map((theme) => {
    // Presence guaranteed by assertValidLifeWeatherInput's own
    // "exactly all 10 canonical themes" check above.
    const signal = signalsByTheme.get(theme) as PersonalThemeSignal;
    const natalContributor = buildNatalContributor(signal);

    // DASHA contributors: NATAL_BASELINE is never gated on this; Mahadasha
    // and Antardasha are always evaluated independently, even when both
    // lords are the same planet (see contributors.ts's own doc comment --
    // two separate, separately-inspectable contributors, never collapsed).
    const dashaContributors: LifeWeatherContributor[] = [];
    if (majorLord !== undefined && getThemesForPlanet(majorLord).includes(theme)) {
      dashaContributors.push(buildMahadashaContributor(theme, majorLord));
    }
    if (subLord !== undefined && getThemesForPlanet(subLord).includes(theme)) {
      dashaContributors.push(buildAntardashaContributor(theme, subLord));
    }

    // TRANSIT contributors: iterates transitActivations.activations in
    // its own already-deterministic order (never re-sorted) -- see
    // README.md's "Contributor ordering" section.
    const transitContributors: LifeWeatherContributor[] = [];
    for (const activation of input.transitActivations.activations) {
      if (getThemesForPlanet(activation.natalPlanet).includes(theme)) {
        transitContributors.push(buildTransitContributor(theme, activation));
      }
    }

    // hasDasha counts MD+AD as ONE system, never two -- see state.ts's own doc comment.
    const hasDasha = dashaContributors.length > 0;
    const hasTransit = transitContributors.length > 0;
    const state = deriveLifeWeatherState(hasDasha, hasTransit);
    const reinforcementSources = REINFORCEMENT_SOURCE_ORDER.filter((source) => (source === 'DASHA' ? hasDasha : hasTransit));

    const themeEvidence = [buildStructuralStateEvidence({ theme, state, hasDasha, hasTransit })];
    if (hasDasha && hasTransit) {
      themeEvidence.push(buildCrossSystemReinforcementEvidence({ theme, reinforcementSources }));
    }

    return {
      theme,
      natalStrength: signal.strength,
      natalDirection: signal.direction,
      state,
      reinforcementSources,
      contributors: [natalContributor, ...dashaContributors, ...transitContributors],
      evidence: themeEvidence,
    };
  });

  const activeThemeCount = themes.filter((t) => t.state === 'ACTIVE').length;
  const stronglyActiveThemeCount = themes.filter((t) => t.state === 'STRONGLY_ACTIVE').length;

  const evidence = dedupeEvidenceRefs([
    buildSummaryEvidence({ evaluationTime: input.evaluationTime, themeCount: themes.length, activeThemeCount, stronglyActiveThemeCount }),
  ]);

  return {
    engineVersion: LIFE_WEATHER_ENGINE_VERSION,
    evaluationTime: input.evaluationTime,
    themes,
    evidence,
  };
}
