/**
 * Daily Personal Fit Engine V1 -- public engine.
 *
 * PURE COMPOSITION. This function never calls deriveLifeWeather,
 * deriveThemeContext, calculateTransitActivation, calculateVimshottariDasha,
 * getNatalChart, getPanchangForDate, evaluateMuhurta, or evaluateActivityFit
 * -- the only input this engine reads is an already-computed
 * LifeWeatherContext (DailyPersonalFitInput). See README.md's
 * "Architecture" section for the full boundary this is the final,
 * projection-only stage of.
 *
 * HARD BOUNDARY (Option B, see README.md's own opening section): this
 * engine has NO Panchang, NO Muhurta evaluation, NO Aura Fit evaluation,
 * NO timing windows, NO window scores, NO Rahu/Yama/Gulika/Abhijit/Brahma
 * logic, NO ranking, NO conflict resolution, and NO natural-language
 * guidance. "Daily" refers to the current Life Weather snapshot
 * (`lifeWeather.evaluationTime`), never a Panchang-day calculation --
 * this engine introduces no date/timezone/location/localDate concept of
 * its own at all.
 *
 * NATAL STRENGTH / NATAL DIRECTION DO NOT DRIVE FIT (merge-critical): the
 * relevance derivation below reads ONLY `theme.state` from each mapped
 * theme -- `natalStrength` and `natalDirection` are read by validation.ts
 * for shape only, never consulted here. This is what allows a theme with
 * `natalStrength === 0` (SOCIAL/FINANCE, structurally always 0 in
 * Personal Themes V1) to still drive an activity family to
 * RELEVANT/HIGHLY_RELEVANT when its own `state` is ACTIVE/STRONGLY_ACTIVE.
 */
import { CANONICAL_ACTIVITY_FAMILIES } from './constants';
import { getThemesForActivityFamily } from './mapping';
import { deriveActivityRelevance } from './relevance';
import { buildRelevanceEvidence, buildSummaryEvidence, dedupeEvidenceRefs } from './evidence';
import { assertValidDailyPersonalFitInput } from './validation';
import { DAILY_PERSONAL_FIT_ENGINE_VERSION } from './provenance';
import type { DailyPersonalFitInput } from './types';
import type { DailyPersonalFitContext, DailyActivityFit, DailyPersonalFitRelevantTheme, LifeWeatherState } from '../../personal-intelligence/src/context';

/**
 * The core public entry point. Given an already-computed LifeWeatherContext,
 * deterministically derives, for each of the 13 canonical
 * MuhurtaActivityFamily values, which PersonalThemes it is semantically
 * mapped to, those themes' own current LifeWeatherState, and a structural
 * personalRelevance (max mapped state -- see relevance.ts). Always returns
 * exactly 13 entries, in CANONICAL_ACTIVITY_FAMILIES' own fixed order --
 * never sparse, never sorted by relevance.
 *
 * No `Date.now()`, no randomness, no network/DB/LLM call anywhere in this
 * function or anything it calls -- `evaluationTime` is read verbatim from
 * `input.lifeWeather.evaluationTime` and echoed straight through.
 */
export function deriveDailyPersonalFit(input: DailyPersonalFitInput): DailyPersonalFitContext {
  assertValidDailyPersonalFitInput(input);

  const statesByTheme = new Map<string, LifeWeatherState>(input.lifeWeather.themes.map((t) => [t.theme, t.state]));

  const activities: DailyActivityFit[] = CANONICAL_ACTIVITY_FAMILIES.map((family) => {
    const mappedThemes = getThemesForActivityFamily(family);
    // Presence guaranteed by assertValidDailyPersonalFitInput's own
    // "exactly all 10 canonical themes" check -- every mapped theme is
    // always found here.
    const relevantThemes: DailyPersonalFitRelevantTheme[] = mappedThemes.map((theme) => ({
      theme,
      state: statesByTheme.get(theme) as LifeWeatherState,
    }));

    const personalRelevance = deriveActivityRelevance(relevantThemes.map((t) => t.state));

    return {
      activityFamily: family,
      personalRelevance,
      relevantThemes,
      evidence: [buildRelevanceEvidence({ activityFamily: family, personalRelevance, relevantThemes })],
    };
  });

  const relevantCount = activities.filter((a) => a.personalRelevance === 'RELEVANT').length;
  const highlyRelevantCount = activities.filter((a) => a.personalRelevance === 'HIGHLY_RELEVANT').length;

  const evidence = dedupeEvidenceRefs([
    buildSummaryEvidence({
      evaluationTime: input.lifeWeather.evaluationTime,
      activityFamilyCount: activities.length,
      relevantCount,
      highlyRelevantCount,
    }),
  ]);

  return {
    engineVersion: DAILY_PERSONAL_FIT_ENGINE_VERSION,
    evaluationTime: input.lifeWeather.evaluationTime,
    activities,
    evidence,
  };
}
